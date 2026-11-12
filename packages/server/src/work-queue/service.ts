// The work queue (spec §14.5): everything waiting for a person in one list, most urgent first,
// each with why it is there and the tools that settle it. Built for agents working through
// Catalyst over MCP as much as for the "Needs you" view.

import { campaigns, contacts, escalations, mailboxes, messages, threads, type Db } from '@catalyst/db';
import { and, count, eq, inArray, isNull, notExists, sql } from 'drizzle-orm';

import { BREAKER_PREFIX } from '../sending/mailboxes.ts';

type Priority = 'urgent' | 'high' | 'normal';
export interface WorkItem {
  kind: 'escalation' | 'draft' | 'unmatched_reply' | 'mailbox' | 'reply_needed' | 'follow_up_needed';
  id: string;
  priority: Priority;
  title: string;
  why: string;
  thread_id: string | null;
  contact_id: string | null;
  due_at: string | null;
  created_at: string;
  suggested_tools: string[];
}

const RANK: Record<Priority, number> = { urgent: 0, high: 1, normal: 2 };

/** The tools that settle an escalation, by its reason (§11.3). */
function toolsFor(reason: string): string[] {
  switch (reason) {
    case 'ai_unavailable':
    case 'knowledge_gap':
    case 'human_requested':
    case 'identity_question':
    case 'pricing_negotiation':
      return ['get_thread_context', 'create_reply', 'resolve_escalation'];
    case 'goal_confirmation':
      return ['get_thread_context', 'mark_goal_achieved', 'resolve_escalation'];
    case 'send_failure':
      return ['get_thread_context', 'list_thread_messages', 'resolve_escalation'];
    case 'unmatched_reply':
      return ['list_unmatched_messages', 'attach_message_to_thread', 'ignore_unmatched_message'];
    case 'complaint':
    case 'legal_or_compliance':
      return ['get_thread_context', 'close_thread', 'resolve_escalation'];
    case 'low_confidence':
      // Proposals to close the thread or check in later, and uncertain unsubscribes.
      return ['get_thread_context', 'schedule_check_in', 'close_thread', 'resolve_escalation', 'dismiss_escalation'];
    default:
      return ['get_thread_context', 'resolve_escalation', 'dismiss_escalation'];
  }
}

const unmatchedWithoutEscalation = (workspaceId: string) =>
  and(
    eq(messages.workspace_id, workspaceId),
    eq(messages.direction, 'inbound'),
    isNull(messages.thread_id),
    isNull(messages.ignored_at),
    // One with an open `unmatched_reply` escalation is listed as that escalation. (`messages.id` is
    // written out: Drizzle leaves columns unqualified in a one-table select.)
    notExists(sql`(select 1 from escalations e where e.trigger_message_id = messages.id and e.status in ('open', 'snoozed'))`),
  );

/** Threads waiting on a campaign's external agent (§10.7): a reply to answer, or a follow-up to write. */
const awaitingAgent = (workspaceId: string, kind: 'reply' | 'follow_up') =>
  and(
    eq(threads.workspace_id, workspaceId),
    eq(threads.state, 'active'),
    isNull(threads.next_action_message_id),
    eq(campaigns.agent_mode, 'external'),
    kind === 'reply' ? eq(threads.next_action_type, 'send_reply') : and(eq(threads.next_action_type, 'send_follow_up'), eq(threads.throttle_reason, 'awaiting_agent')),
    // Once it has a draft, the draft is the item.
    notExists(sql`(select 1 from messages m where m.thread_id = threads.id and m.direction = 'outbound' and m.status in ('draft', 'pending_approval'))`),
  );

export async function getWorkQueue(db: Db, workspaceId: string, query: { limit: number }, now: Date) {
  const limit = query.limit;
  const openEscalations = and(eq(escalations.workspace_id, workspaceId), eq(escalations.status, 'open'));
  const drafts = and(eq(messages.workspace_id, workspaceId), eq(messages.direction, 'outbound'), inArray(messages.status, ['draft', 'pending_approval']));
  const troubled = and(eq(mailboxes.workspace_id, workspaceId), sql`(${mailboxes.status} = 'error' or (${mailboxes.status} = 'paused' and ${mailboxes.status_reason} like ${`${BREAKER_PREFIX}%`}))`);

  const agentRows = (kind: 'reply' | 'follow_up') =>
    db
      .select({ thread: threads, email: contacts.email, firstName: contacts.first_name, lastName: contacts.last_name })
      .from(threads)
      .innerJoin(campaigns, eq(campaigns.id, threads.campaign_id))
      .innerJoin(contacts, eq(contacts.id, threads.contact_id))
      .where(awaitingAgent(workspaceId, kind))
      .orderBy(kind === 'reply' ? threads.last_inbound_at : threads.next_action_at)
      .limit(limit);
  const [replyRows, followUpRows] = await Promise.all([agentRows('reply'), agentRows('follow_up')]);
  const [escalationRows, draftRows, unmatchedRows, mailboxRows] = await Promise.all([
    db
      .select({ escalation: escalations, contactId: threads.contact_id })
      .from(escalations)
      .leftJoin(threads, eq(threads.id, escalations.thread_id))
      .where(openEscalations)
      .orderBy(sql`case ${escalations.priority} when 'urgent' then 0 when 'high' then 1 else 2 end`, escalations.due_at)
      .limit(limit),
    db.select({ message: messages, contactId: threads.contact_id }).from(messages).leftJoin(threads, eq(threads.id, messages.thread_id)).where(drafts).orderBy(messages.created_at).limit(limit),
    db.select().from(messages).where(unmatchedWithoutEscalation(workspaceId)).orderBy(messages.created_at).limit(limit),
    db.select().from(mailboxes).where(troubled).limit(limit),
  ]);

  const items: WorkItem[] = [
    ...escalationRows.map(({ escalation, contactId }) => ({
      kind: 'escalation' as const,
      id: escalation.id,
      priority: escalation.priority,
      title: escalation.title,
      why: escalation.due_at.getTime() < now.getTime() ? `Overdue. ${escalation.explanation}` : escalation.explanation,
      thread_id: escalation.thread_id,
      contact_id: contactId,
      due_at: escalation.due_at.toISOString(),
      created_at: escalation.created_at.toISOString(),
      suggested_tools: toolsFor(escalation.reason),
    })),
    ...draftRows.map(({ message, contactId }) => ({
      kind: 'draft' as const,
      id: message.id,
      // An email the agent wrote waits on a person to go out; a person's own draft can wait.
      priority: (message.status === 'pending_approval' ? 'high' : 'normal') as Priority,
      title: message.status === 'pending_approval' ? `Approve: ${message.subject}` : `Draft: ${message.subject}`,
      why: message.status === 'pending_approval' ? 'This email waits for approval before it is sent.' : 'A saved draft that hasn’t been sent.',
      thread_id: message.thread_id,
      contact_id: contactId,
      due_at: null,
      created_at: message.created_at.toISOString(),
      suggested_tools: ['get_message', 'update_draft', 'approve_draft', 'reject_draft'],
    })),
    ...unmatchedRows.map((message) => ({
      kind: 'unmatched_reply' as const,
      id: message.id,
      priority: 'normal' as Priority,
      title: `Unmatched: ${message.subject}`,
      why: `Mail from ${message.from_email} that matched no thread.`,
      thread_id: null,
      contact_id: null,
      due_at: null,
      created_at: message.created_at.toISOString(),
      suggested_tools: ['list_threads', 'attach_message_to_thread', 'ignore_unmatched_message'],
    })),
    ...mailboxRows.map((mailbox) => {
      const broken = mailbox.status === 'error';
      return {
        kind: 'mailbox' as const,
        id: mailbox.id,
        // A broken mailbox stops sending and replies alike.
        priority: (broken ? 'urgent' : 'high') as Priority,
        title: broken ? `${mailbox.email} is not working` : `${mailbox.email} was paused`,
        why: mailbox.status_reason ?? (broken ? 'The mailbox is in error.' : 'A circuit breaker paused the mailbox.'),
        thread_id: null,
        contact_id: null,
        due_at: null,
        created_at: mailbox.updated_at.toISOString(),
        suggested_tools: broken ? ['get_mailbox', 'list_poll_runs', 'test_mailbox_connection'] : ['get_mailbox', 'get_mailbox_stats', 'resume_mailbox'],
      };
    }),
    ...replyRows.map(({ thread, email, firstName, lastName }) => {
      const name = [firstName, lastName].filter(Boolean).join(' ') || email;
      return {
        kind: 'reply_needed' as const,
        id: thread.id,
        // A reply waiting is the most time-sensitive thing an agent can do (§11.1 SLAs are hours).
        priority: 'high' as Priority,
        title: `${name} replied`,
        why: `${name} replied and is waiting for an answer. This campaign uses an external agent, so Catalyst drafted nothing: read the thread and reply, or settle it another way.`,
        thread_id: thread.id,
        contact_id: thread.contact_id,
        due_at: null,
        created_at: (thread.last_inbound_at ?? thread.updated_at).toISOString(),
        suggested_tools: ['get_thread_context', 'create_reply', 'schedule_check_in', 'mark_goal_achieved', 'close_thread'],
      };
    }),
    ...followUpRows.map(({ thread, email, firstName, lastName }) => {
      const name = [firstName, lastName].filter(Boolean).join(' ') || email;
      const checkIn = thread.check_in_at !== null && thread.follow_up_sequence_id === null;
      return {
        kind: 'follow_up_needed' as const,
        id: thread.id,
        priority: 'normal' as Priority,
        title: checkIn ? `Check in with ${name}` : `Follow up with ${name}`,
        why: checkIn
          ? `${name} asked to hear from us again around now. This campaign uses an external agent: write the check-in with create_reply, or cancel it.`
          : `Follow-up ${thread.follow_up_step_position} is due and this campaign’s external agent writes it. A reply written with create_reply now is taken as that follow-up.`,
        thread_id: thread.id,
        contact_id: thread.contact_id,
        due_at: null,
        created_at: (thread.next_action_at ?? thread.updated_at).toISOString(),
        suggested_tools: checkIn ? ['get_thread_context', 'create_reply', 'cancel_check_in'] : ['get_thread_context', 'create_reply', 'skip_next_action', 'stop_follow_ups'],
      };
    }),
  ];
  items.sort((a, b) => RANK[a.priority] - RANK[b.priority] || (a.due_at ?? '￿').localeCompare(b.due_at ?? '￿') || a.created_at.localeCompare(b.created_at));

  const agentCount = (kind: 'reply' | 'follow_up') => db.select({ n: count() }).from(threads).innerJoin(campaigns, eq(campaigns.id, threads.campaign_id)).where(awaitingAgent(workspaceId, kind));
  const [[escalationCount], [draftCount], [unmatchedCount], [mailboxCount], [replyCount], [followUpCount]] = await Promise.all([
    db.select({ n: count() }).from(escalations).where(openEscalations),
    db.select({ n: count() }).from(messages).where(drafts),
    db.select({ n: count() }).from(messages).where(unmatchedWithoutEscalation(workspaceId)),
    db.select({ n: count() }).from(mailboxes).where(troubled),
    agentCount('reply'),
    agentCount('follow_up'),
  ]);
  return {
    items: items.slice(0, limit),
    counts: { escalation: escalationCount?.n ?? 0, draft: draftCount?.n ?? 0, unmatched_reply: unmatchedCount?.n ?? 0, mailbox: mailboxCount?.n ?? 0, reply_needed: replyCount?.n ?? 0, follow_up_needed: followUpCount?.n ?? 0 },
  };
}
