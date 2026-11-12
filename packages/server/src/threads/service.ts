// Threads (spec §5.3–§5.10, §13.4): reading them, and the changes a person or agent can make by
// hand. Every change is written with its activity, then the thread is evaluated straight away so
// the response shows the new stage, state and next action (and evaluation is queued as a fallback).

import { addDays, intlZoneCalendar, isoDate, parseIsoDate } from '@catalyst/core';
import type { Thread } from '@catalyst/contract';
import {
  activities,
  ai_runs,
  campaign_goals,
  campaigns,
  companies,
  contact_tags,
  contacts,
  escalations,
  knowledge_items,
  messages,
  newId,
  tags,
  thread_goal_achievements,
  threads,
  users,
  workspaces,
  type Db,
  type Executor,
} from '@catalyst/db';
import type { LintFinding } from '@catalyst/email';
import type { JobQueue } from '@catalyst/jobs';
import { ObjectNotFound, type ObjectStorage } from '@catalyst/storage';
import { and, asc, desc, eq, gt, gte, inArray, isNull, like, or, sql, type SQL } from 'drizzle-orm';

import type { Principal } from '../api/auth.ts';
import { ApiError, conflict, invalidField, notFound } from '../api/errors.ts';
import { assertFresh } from '../api/etag.ts';
import { decodeCursor, page } from '../api/pagination.ts';
import { serializeActivity } from '../contacts/timeline.ts';
import { actorOf, audit, escapeLike, iso } from '../shared.ts';
import { suppress } from '../suppressions/service.ts';
import { evaluateThread } from './evaluate.ts';
import { evaluateContactThreads } from './evaluation.ts';

type ThreadRow = typeof threads.$inferSelect;
type MessageRow = typeof messages.$inferSelect;

const STAGE_LABELS: Record<string, string> = { queued: 'Queued', sent: 'Sent', received: 'Received', responded: 'Responded' };
export const STAGE_RANKS = { queued: 0, sent: 1, received: 2, responded: 3 } as const;

const selection = {
  thread: threads,
  campaign_name: campaigns.name,
  contact_email: contacts.email,
  first_name: contacts.first_name,
  last_name: contacts.last_name,
  company_name: companies.name,
  goal_name: campaign_goals.name,
};
type Selected = { thread: ThreadRow; campaign_name: string; contact_email: string; first_name: string | null; last_name: string | null; company_name: string | null; goal_name: string | null };

function joined(db: Executor) {
  return db
    .select(selection)
    .from(threads)
    .innerJoin(campaigns, eq(campaigns.id, threads.campaign_id))
    .innerJoin(contacts, eq(contacts.id, threads.contact_id))
    .leftJoin(companies, eq(companies.id, contacts.company_id))
    .leftJoin(campaign_goals, eq(campaign_goals.id, threads.achieved_goal_id));
}

const number = (value: string | null) => (value === null ? null : Number(value));

export function serializeThread(entry: Selected): Thread {
  const row = entry.thread;
  const name = [entry.first_name, entry.last_name].filter(Boolean).join(' ');
  return {
    id: row.id,
    campaign: { id: row.campaign_id, name: entry.campaign_name },
    contact: { id: row.contact_id, email: entry.contact_email, name: name || null, company: entry.company_name },
    mailbox_id: row.mailbox_id,
    stage: row.stage,
    stage_rank: row.stage_rank,
    stage_label: row.stage === 'goal_achieved' ? `${entry.goal_name ?? 'Goal'} achieved` : STAGE_LABELS[row.stage]!,
    achieved_goal_id: row.achieved_goal_id,
    manual_floor_rank: row.manual_floor_rank,
    state: row.state,
    state_reason: row.state_reason,
    next_action: { type: row.next_action_type, at: iso(row.next_action_at), message_id: row.next_action_message_id, throttle_reason: row.throttle_reason },
    follow_up: { sequence_id: row.follow_up_sequence_id, step_position: row.follow_up_step_position, stopped: row.follow_ups_stopped, waiting_since: iso(row.waiting_since), sent: row.follow_ups_sent, check_in_at: iso(row.check_in_at) },
    open: { status: row.open_status, count: row.open_count, first_opened_at: iso(row.first_opened_at), last_opened_at: iso(row.last_opened_at), clicked: row.clicked },
    classification: { intent: row.latest_intent, intent_p: number(row.latest_intent_p), sentiment: row.latest_sentiment, temperature: number(row.temperature), fallback: row.classification_fallback },
    ai_paused: row.ai_paused,
    manually_paused: row.manually_paused,
    closed_reason: row.closed_reason,
    closed_at: iso(row.closed_at),
    subject: row.subject,
    summary: row.ai_summary,
    assigned_user_id: row.assigned_user_id,
    open_escalations: row.open_escalations,
    ai_replies_sent: row.ai_replies_sent,
    first_sent_at: iso(row.first_sent_at),
    received_at: iso(row.received_at),
    responded_at: iso(row.responded_at),
    completed_at: iso(row.completed_at),
    last_message_at: iso(row.last_message_at),
    last_inbound_at: iso(row.last_inbound_at),
    last_outbound_at: iso(row.last_outbound_at),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

export async function findThread(db: Executor, workspaceId: string, threadId: string): Promise<ThreadRow> {
  const [row] = await db.select().from(threads).where(and(eq(threads.id, threadId), eq(threads.workspace_id, workspaceId)));
  if (!row) throw notFound('The thread');
  return row;
}

async function threadResource(db: Executor, threadId: string): Promise<Thread> {
  const [entry] = await joined(db).where(eq(threads.id, threadId));
  return serializeThread(entry!);
}

// ── Listing ────────────────────────────────────────────────────────────────────────────────────

const SORTS = {
  '-last_message_at': [`coalesce(t.last_message_at, '-infinity'::timestamptz)`],
  '-temperature': [`coalesce(t.temperature, -1)`, `coalesce(t.last_message_at, '-infinity'::timestamptz)`],
  '-updated_at': [`t.updated_at`],
  '-created_at': [`t.created_at`],
} as const;
export type ThreadSort = keyof typeof SORTS;

const keyColumns = (keys: readonly string[], alias: string) => [...keys.map((key) => key.replaceAll('t.', `${alias}.`)), `${alias}.id`].join(', ');
const keyList = (keys: readonly string[], alias: string) => sql.raw(`(${keyColumns(keys, alias)})`);

export interface ListThreadsQuery {
  limit: number;
  cursor?: string | undefined;
  campaign_id?: string | undefined;
  contact_id?: string | undefined;
  mailbox_id?: string | undefined;
  stage?: ThreadRow['stage'] | undefined;
  min_stage_rank?: number | undefined;
  goal_id?: string | undefined;
  state?: ThreadRow['state'] | undefined;
  open_status?: ThreadRow['open_status'] | undefined;
  intent?: string | undefined;
  min_temperature?: number | undefined;
  assigned_to?: string | undefined;
  needs_attention?: 'true' | 'false' | undefined;
  q?: string | undefined;
  updated_after?: string | undefined;
  sort?: ThreadSort | undefined;
}

export async function listThreads(db: Db, workspaceId: string, query: ListThreadsQuery) {
  const sortName = query.sort ?? '-last_message_at';
  const keys = SORTS[sortName];
  const where: SQL[] = [eq(threads.workspace_id, workspaceId)];
  if (query.campaign_id) where.push(eq(threads.campaign_id, query.campaign_id));
  if (query.contact_id) where.push(eq(threads.contact_id, query.contact_id));
  if (query.mailbox_id) where.push(eq(threads.mailbox_id, query.mailbox_id));
  if (query.stage) where.push(eq(threads.stage, query.stage));
  if (query.min_stage_rank !== undefined) where.push(gte(threads.stage_rank, query.min_stage_rank));
  if (query.state) where.push(eq(threads.state, query.state));
  if (query.open_status) where.push(eq(threads.open_status, query.open_status));
  if (query.intent) where.push(eq(threads.latest_intent, query.intent));
  if (query.min_temperature !== undefined) where.push(gte(threads.temperature, query.min_temperature.toFixed(2)));
  if (query.assigned_to) where.push(eq(threads.assigned_user_id, query.assigned_to));
  if (query.needs_attention === 'true') where.push(inArray(threads.state, ['needs_human', 'pending_approval']));
  if (query.needs_attention === 'false') where.push(sql`${threads.state} not in ('needs_human', 'pending_approval')`);
  if (query.updated_after) where.push(gt(threads.updated_at, new Date(query.updated_after)));
  if (query.goal_id) {
    where.push(sql`exists (select 1 from thread_goal_achievements a where a.thread_id = threads.id and a.goal_id = ${query.goal_id} and a.revoked_at is null)`);
  }
  if (query.q?.trim()) {
    const like = `%${escapeLike(query.q.trim())}%`;
    where.push(sql`(${contacts.email}::text ilike ${like} or (coalesce(${contacts.first_name}, '') || ' ' || coalesce(${contacts.last_name}, '')) ilike ${like} or ${threads.subject} ilike ${like})`);
  }
  if (query.cursor) {
    const cursorId = decodeCursor(query.cursor, sortName);
    where.push(sql`${keyList(keys, 'threads')} < (select ${sql.raw(keyColumns(keys, 't'))} from threads t where t.id = ${cursorId} and t.workspace_id = ${workspaceId})`);
  }
  const order = [...keys.map((key) => sql.raw(`${key.replaceAll('t.', 'threads.')} desc`)), desc(threads.id)];
  const rows = await joined(db).where(and(...where)).orderBy(...order).limit(query.limit + 1);
  const { rows: kept, next_cursor } = page(rows.map((entry) => ({ ...entry, id: entry.thread.id })), query.limit, sortName);
  return { data: kept.map(serializeThread), next_cursor };
}

export async function getThread(db: Db, workspaceId: string, threadId: string): Promise<Thread> {
  await findThread(db, workspaceId, threadId);
  return threadResource(db, threadId);
}

// ── Messages and activity ──────────────────────────────────────────────────────────────────────

export function serializeMessage(row: MessageRow) {
  return {
    id: row.id,
    thread_id: row.thread_id,
    direction: row.direction,
    status: row.status,
    author: row.author,
    match_method: row.match_method,
    step_id: row.step_id,
    variant_id: row.variant_id,
    subject: row.subject,
    from_email: row.from_email,
    from_name: row.from_name,
    to_emails: row.to_emails as unknown[],
    body_text: row.body_text,
    stripped_text: row.stripped_text,
    snippet: row.snippet,
    has_attachments: row.has_attachments,
    scheduled_for: iso(row.scheduled_for),
    sent_at: iso(row.sent_at),
    received_at: iso(row.received_at),
    inbound_kind: row.inbound_kind,
    open_count: row.open_count,
    human_open: row.human_open,
    error: row.error,
    lint: row.direction === 'outbound' ? ((row.lint_report as LintFinding[] | null) ?? null) : null,
    approved_at: iso(row.approved_at),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

const MESSAGE_ORDER = sql`coalesce(messages.sent_at, messages.received_at, messages.created_at)`;

export async function listThreadMessages(db: Db, workspaceId: string, threadId: string, query: { limit: number; cursor?: string | undefined }) {
  await findThread(db, workspaceId, threadId);
  const where: SQL[] = [eq(messages.thread_id, threadId)];
  if (query.cursor) {
    const cursorId = decodeCursor(query.cursor, 'time');
    where.push(sql`(${MESSAGE_ORDER}, messages.id) > (select coalesce(m.sent_at, m.received_at, m.created_at), m.id from messages m where m.id = ${cursorId})`);
  }
  const rows = await db.select().from(messages).where(and(...where)).orderBy(MESSAGE_ORDER, asc(messages.id)).limit(query.limit + 1);
  const { rows: kept, next_cursor } = page(rows, query.limit, 'time');
  return { data: kept.map(serializeMessage), next_cursor };
}

export async function getMessage(db: Db, workspaceId: string, messageId: string) {
  const [row] = await db.select().from(messages).where(and(eq(messages.id, messageId), eq(messages.workspace_id, workspaceId)));
  if (!row) throw notFound('The message');
  return serializeMessage(row);
}

const ACTIVITY_SORT = '-occurred_at';

/** The MIME source kept in storage: what went over SMTP, or what came in over IMAP. */
export async function getMessageRaw(db: Db, storage: ObjectStorage, workspaceId: string, messageId: string) {
  const [row] = await db.select({ id: messages.id, key: messages.raw_storage_key }).from(messages).where(and(eq(messages.id, messageId), eq(messages.workspace_id, workspaceId)));
  if (!row) throw notFound('The email');
  if (!row.key) throw new ApiError(404, 'not_found', 'No copy of this email was kept: it was never sent.');
  try {
    return { body: await storage.get(row.key), filename: `${row.id}.eml` };
  } catch (error) {
    if (error instanceof ObjectNotFound) throw new ApiError(404, 'not_found', 'The stored copy of this email is gone.');
    throw error;
  }
}

export async function listActivities(
  db: Db,
  workspaceId: string,
  query: { limit: number; cursor?: string | undefined; thread_id?: string | undefined; contact_id?: string | undefined; campaign_id?: string | undefined; type?: string | undefined },
) {
  const where: SQL[] = [eq(activities.workspace_id, workspaceId)];
  if (query.thread_id) where.push(eq(activities.thread_id, query.thread_id));
  if (query.contact_id) where.push(eq(activities.contact_id, query.contact_id));
  if (query.campaign_id) where.push(eq(activities.campaign_id, query.campaign_id));
  if (query.type) where.push(query.type.endsWith('.') ? like(activities.type, `${escapeLike(query.type)}%`) : eq(activities.type, query.type));
  if (query.cursor) {
    const cursorId = decodeCursor(query.cursor, ACTIVITY_SORT);
    where.push(sql`(${activities.occurred_at}, ${activities.id}) < (select a.occurred_at, a.id from activities a where a.id = ${cursorId} and a.workspace_id = ${workspaceId})`);
  }
  const rows = await db.select().from(activities).where(and(...where)).orderBy(desc(activities.occurred_at), desc(activities.id)).limit(query.limit + 1);
  const { rows: kept, next_cursor } = page(rows, query.limit, ACTIVITY_SORT);
  return { data: kept.map(serializeActivity), next_cursor };
}

export async function listThreadActivity(db: Db, workspaceId: string, threadId: string, query: { limit: number; cursor?: string | undefined }) {
  await findThread(db, workspaceId, threadId);
  return listActivities(db, workspaceId, { ...query, thread_id: threadId });
}

export async function listThreadClassifications(db: Db, workspaceId: string, threadId: string, query: { limit: number; cursor?: string | undefined }) {
  await findThread(db, workspaceId, threadId);
  // Claude's analyses count while Jev isn't connected: they are the classifications then (§10.4).
  const where: SQL[] = [eq(ai_runs.thread_id, threadId), inArray(ai_runs.task, ['classify_conversation', 'analyze_inbound'])];
  if (query.cursor) {
    const cursorId = decodeCursor(query.cursor, '-created_at');
    where.push(sql`(${ai_runs.created_at}, ${ai_runs.id}) < (select r.created_at, r.id from ai_runs r where r.id = ${cursorId})`);
  }
  const rows = await db.select().from(ai_runs).where(and(...where)).orderBy(desc(ai_runs.created_at), desc(ai_runs.id)).limit(query.limit + 1);
  const { rows: kept, next_cursor } = page(rows, query.limit, '-created_at');
  return {
    data: kept.map((run) => ({
      id: run.id,
      trigger_message_id: run.trigger_message_id,
      provider: run.provider,
      model: run.model,
      classifier_version: run.prompt_version,
      status: run.status,
      output: (run.output as Record<string, unknown> | null) ?? null,
      created_at: run.created_at.toISOString(),
    })),
    next_cursor,
  };
}

// ── Changes ────────────────────────────────────────────────────────────────────────────────────

export interface ThreadDeps {
  jobs: JobQueue;
  now: Date;
}

/**
 * Applies a change to one thread under a row lock, logs it, and evaluates the thread once the
 * change is committed, so the response shows its new stage, state and next action.
 */
async function changeThread(
  db: Db,
  principal: Principal,
  threadId: string,
  deps: ThreadDeps,
  change: (tx: Executor, row: ThreadRow) => Promise<{ patch?: Partial<typeof threads.$inferInsert>; activity?: { type: string; data: Record<string, unknown> } } | void>,
): Promise<Thread> {
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(threads).where(and(eq(threads.id, threadId), eq(threads.workspace_id, principal.workspace.id))).for('update');
    if (!row) throw notFound('The thread');
    const result = (await change(tx, row)) ?? {};
    if (result.patch && Object.keys(result.patch).length > 0) await tx.update(threads).set({ ...result.patch, updated_at: deps.now }).where(eq(threads.id, threadId));
    if (result.activity) {
      await tx.insert(activities).values({
        id: newId('activity'),
        workspace_id: principal.workspace.id,
        contact_id: row.contact_id,
        thread_id: threadId,
        campaign_id: row.campaign_id,
        type: result.activity.type,
        ...actorOf(principal),
        data: result.activity.data,
        occurred_at: deps.now,
      });
    }
  });
  try {
    await evaluateThread(db, threadId, { now: deps.now });
  } catch (error) {
    console.error(`[threads] evaluating ${threadId} inline failed; queued instead`, error);
    await deps.jobs.enqueue('thread.evaluate', { thread_id: threadId });
  }
  return threadResource(db, threadId);
}

export async function updateThread(db: Db, principal: Principal, threadId: string, input: { assigned_user_id?: string | null | undefined; ai_paused?: boolean | undefined }, ifMatch: string | null, deps: ThreadDeps) {
  return changeThread(db, principal, threadId, deps, async (tx, row) => {
    assertFresh({ id: row.id, updated_at: row.updated_at.toISOString() }, ifMatch);
    if (input.assigned_user_id) {
      const [user] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, input.assigned_user_id), eq(users.workspace_id, principal.workspace.id), isNull(users.deactivated_at)));
      if (!user) throw invalidField('body.assigned_user_id', 'No such user in this workspace.');
    }
    const patch: Partial<typeof threads.$inferInsert> = {};
    if (input.assigned_user_id !== undefined && input.assigned_user_id !== row.assigned_user_id) patch.assigned_user_id = input.assigned_user_id;
    if (input.ai_paused !== undefined && input.ai_paused !== row.ai_paused) {
      patch.ai_paused = input.ai_paused;
      // Taking back over from a person restarts follow-ups from now (§5.10 rule 6).
      if (!input.ai_paused) patch.follow_ups_not_before = deps.now;
    }
    if ('ai_paused' in patch) return { patch, activity: { type: patch.ai_paused ? 'thread.ai_paused' : 'thread.ai_resumed', data: {} } };
    if ('assigned_user_id' in patch) return { patch, activity: { type: 'thread.assigned', data: { from: row.assigned_user_id, to: patch.assigned_user_id } } };
    return { patch };
  });
}

const TERMINAL = ['completed', 'bounced', 'unsubscribed', 'stopped'] as const;

export function pauseThread(db: Db, principal: Principal, threadId: string, deps: ThreadDeps) {
  return changeThread(db, principal, threadId, deps, async (_tx, row) => {
    if (row.manually_paused) throw conflict('The thread is already paused.');
    if ((TERMINAL as readonly string[]).includes(row.state)) throw conflict(`A ${row.state} thread can’t be paused.`);
    return { patch: { manually_paused: true }, activity: { type: 'thread.paused', data: {} } };
  });
}

export function resumeThread(db: Db, principal: Principal, threadId: string, deps: ThreadDeps) {
  return changeThread(db, principal, threadId, deps, async (_tx, row) => {
    if (!row.manually_paused) throw conflict('The thread is not paused.');
    return { patch: { manually_paused: false, follow_ups_not_before: deps.now }, activity: { type: 'thread.resumed', data: {} } };
  });
}

export function stopFollowUps(db: Db, principal: Principal, threadId: string, deps: ThreadDeps) {
  return changeThread(db, principal, threadId, deps, async (_tx, row) => {
    if (row.follow_ups_stopped) throw conflict('Follow-ups are already stopped on this thread.');
    return { patch: { follow_ups_stopped: true }, activity: { type: 'follow_up.stopped', data: { sequence_id: row.follow_up_sequence_id } } };
  });
}

export function resumeFollowUps(db: Db, principal: Principal, threadId: string, deps: ThreadDeps) {
  return changeThread(db, principal, threadId, deps, async (_tx, row) => {
    if (!row.follow_ups_stopped) throw conflict('Follow-ups are not stopped on this thread.');
    return { patch: { follow_ups_stopped: false, follow_ups_not_before: deps.now }, activity: { type: 'follow_up.resumed', data: { sequence_id: row.follow_up_sequence_id } } };
  });
}

export function skipNextAction(db: Db, principal: Principal, threadId: string, deps: ThreadDeps) {
  return changeThread(db, principal, threadId, deps, async (tx, row) => {
    if (row.next_action_type !== 'send_follow_up' || !row.follow_up_sequence_id || !row.follow_up_step_position) {
      throw conflict('Only a due follow-up can be skipped; this thread’s next action is not one.');
    }
    if (row.next_action_message_id) {
      await tx.update(messages).set({ status: 'cancelled', updated_at: deps.now }).where(and(eq(messages.id, row.next_action_message_id), inArray(messages.status, ['draft', 'pending_approval', 'scheduled'])));
    }
    // Evaluation counts a skipped step as taken (§5.6), so the sequence moves on.
    return { activity: { type: 'follow_up.skipped', data: { sequence_id: row.follow_up_sequence_id, step_position: row.follow_up_step_position } } };
  });
}

export function rescheduleNextAction(db: Db, principal: Principal, threadId: string, input: { at: string }, deps: ThreadDeps) {
  return changeThread(db, principal, threadId, deps, async (_tx, row) => {
    const at = new Date(input.at);
    if (row.next_action_type !== 'send_initial' && row.next_action_type !== 'send_follow_up') throw conflict('Only a due initial email or follow-up can be rescheduled.');
    if (at <= deps.now || (row.next_action_at && at <= row.next_action_at)) {
      throw invalidField('body.at', 'Rescheduling only postpones; pick a later time than now and than the current due time, or use sendNextActionNow.');
    }
    // A postponement is kept by evaluation while the same send is still pending (§5.6).
    return { patch: { next_action_at: at, throttle_reason: 'rescheduled' }, activity: { type: 'follow_up.scheduled', data: { at: at.toISOString(), by_hand: true } } };
  });
}

export function setThreadStageFloor(db: Db, principal: Principal, threadId: string, input: { stage: keyof typeof STAGE_RANKS; reason: string }, deps: ThreadDeps) {
  return changeThread(db, principal, threadId, deps, async (tx, row) => {
    const rank = STAGE_RANKS[input.stage];
    // threads requires a mailbox for any stage past Queued, and a thread gets its mailbox at its first send (§20.1 open issue).
    if (rank > 0 && row.mailbox_id === null) throw conflict('Nothing was sent on this thread yet, so it has no mailbox and can’t move past Queued. Send the initial email first.');
    await audit(tx, principal, 'thread.stage_floor_set', { type: 'thread', id: row.id }, { from: row.manual_floor_rank, to: rank, reason: input.reason }, deps.now);
    return { patch: { manual_floor_rank: rank }, activity: { type: 'thread.stage_floor_set', data: { from: row.manual_floor_rank, to: rank, reason: input.reason } } };
  });
}

const NOT_INTERESTED_TAG = 'not-interested';

/** §5.9, §10.4: closed as lost because the contact declined; the stage stays, the contact is tagged. */
export async function closeAsNotInterested(db: Db, thread: ThreadRow, now: Date): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(threads).set({ closed_at: now, closed_reason: 'not_interested', updated_at: now }).where(eq(threads.id, thread.id));
    await tagNotInterested(tx, thread.workspace_id, thread.contact_id);
    await tx.insert(activities).values({ id: newId('activity'), workspace_id: thread.workspace_id, contact_id: thread.contact_id, thread_id: thread.id, campaign_id: thread.campaign_id, type: 'thread.closed', actor_type: 'ai', data: { reason: 'not_interested' }, occurred_at: now });
  });
}

async function tagNotInterested(tx: Executor, workspaceId: string, contactId: string): Promise<void> {
  await tx.insert(tags).values({ id: newId('tag'), workspace_id: workspaceId, name: NOT_INTERESTED_TAG }).onConflictDoNothing();
  const [tag] = await tx.select({ id: tags.id }).from(tags).where(and(eq(tags.workspace_id, workspaceId), eq(tags.name, NOT_INTERESTED_TAG)));
  await tx.insert(contact_tags).values({ contact_id: contactId, tag_id: tag!.id }).onConflictDoNothing();
}

export function closeThread(db: Db, principal: Principal, threadId: string, input: { reason: string; note?: string | undefined; unsubscribe?: boolean | undefined }, deps: ThreadDeps) {
  return changeThread(db, principal, threadId, deps, async (tx, row) => {
    if ((TERMINAL as readonly string[]).includes(row.state) && !input.unsubscribe) throw conflict(`The thread is already ${row.state}.`);
    if (input.unsubscribe) {
      const [contact] = await tx.select().from(contacts).where(eq(contacts.id, row.contact_id));
      await tx
        .update(contacts)
        .set({ subscription_status: 'unsubscribed', unsubscribed_at: contact!.unsubscribed_at ?? deps.now, updated_at: deps.now })
        .where(and(eq(contacts.id, row.contact_id), eq(contacts.subscription_status, 'subscribed')));
      await suppress(tx, principal.workspace.id, { email: contact!.email, reason: 'unsubscribed', source: 'manual', note: input.note ?? null, createdBy: principal.kind === 'user' ? principal.id : null }, deps.now);
      await tx.insert(activities).values({ id: newId('activity'), workspace_id: principal.workspace.id, contact_id: row.contact_id, thread_id: row.id, type: 'contact.unsubscribed', ...actorOf(principal), data: { source: 'manual' }, occurred_at: deps.now });
      // Every other thread the contact is in stops too.
      await evaluateContactThreads(tx, deps.jobs, [row.contact_id]);
    }
    if (input.reason === 'not_interested') {
      // §5.9: the lifecycle stage stays where it is, and the contact is tagged instead.
      await tagNotInterested(tx, principal.workspace.id, row.contact_id);
    }
    return {
      patch: { closed_at: deps.now, closed_reason: input.reason },
      activity: { type: 'thread.closed', data: { reason: input.reason, ...(input.note && { note: input.note }), ...(input.unsubscribe && { unsubscribed: true }) } },
    };
  });
}

// ── Goals ──────────────────────────────────────────────────────────────────────────────────────

const LIFECYCLE_ORDER = ['lead', 'prospect', 'engaged', 'opportunity', 'customer'];

export interface AchievementInput {
  method: 'manual' | 'external_event' | 'ai';
  confidence: string;
  evidence: string | null;
  eventAt: Date | null;
  confirmedBy: string | null;
  integrationEventId?: string | null;
}

/**
 * Writes a goal achievement and its consequences in the caller's transaction: the goals below it
 * implied (§5.2) and the contact's lifecycle moved forward, never back (§5.9). Used by people
 * (markGoalAchieved) and by integration events (§13.7).
 */
export async function writeAchievement(tx: Executor, thread: ThreadRow, goalId: string, input: AchievementInput, now: Date) {
  const goals = await tx.select().from(campaign_goals).where(eq(campaign_goals.campaign_id, thread.campaign_id)).orderBy(asc(campaign_goals.position));
  const goal = goals.find((entry) => entry.id === goalId);
  if (!goal) throw notFound('The goal');
  const existing = await tx.select().from(thread_goal_achievements).where(eq(thread_goal_achievements.thread_id, thread.id));
  const write = async (goalRow: (typeof goals)[number], method: AchievementInput['method'] | 'implied') => {
    const values = {
      thread_id: thread.id,
      goal_id: goalRow.id,
      achieved_at: now,
      method,
      confidence: method === 'implied' ? '1.000' : input.confidence,
      evidence: method === 'implied' ? `Implied by "${goal.name}"` : input.evidence,
      event_at: method === 'implied' ? null : input.eventAt,
      integration_event_id: method === 'implied' ? null : (input.integrationEventId ?? null),
      confirmed_by: input.confirmedBy,
      revoked_at: null,
      revoked_by: null,
      revoke_reason: null,
    };
    await tx.insert(thread_goal_achievements).values(values).onConflictDoUpdate({ target: [thread_goal_achievements.thread_id, thread_goal_achievements.goal_id], set: values });
  };
  await write(goal, input.method);
  for (const lower of goals.filter((entry) => entry.position < goal.position)) {
    const held = existing.find((entry) => entry.goal_id === lower.id && entry.revoked_at === null);
    if (!held) await write(lower, 'implied');
  }
  const target = goal.marks_customer && goal.position === goals.at(-1)!.position ? 'customer' : goal.lifecycle_stage_on_achieve;
  if (target) {
    const [contact] = await tx.select({ lifecycle_stage: contacts.lifecycle_stage }).from(contacts).where(eq(contacts.id, thread.contact_id));
    const from = LIFECYCLE_ORDER.indexOf(contact!.lifecycle_stage);
    if (LIFECYCLE_ORDER.indexOf(target) > from && from >= 0) await tx.update(contacts).set({ lifecycle_stage: target, updated_at: now }).where(eq(contacts.id, thread.contact_id));
  }
  return { goal, alreadyHeld: existing.some((entry) => entry.goal_id === goalId && entry.revoked_at === null && entry.method !== 'implied') };
}

export function markGoalAchieved(db: Db, principal: Principal, threadId: string, goalId: string, input: { note?: string | undefined; event_at?: string | undefined }, deps: ThreadDeps) {
  return changeThread(db, principal, threadId, deps, async (tx, row) => {
    const [goal] = await tx.select().from(campaign_goals).where(and(eq(campaign_goals.id, goalId), eq(campaign_goals.campaign_id, row.campaign_id)));
    if (!goal) throw notFound('The goal');
    if (row.mailbox_id === null) throw conflict('Nothing was sent on this thread yet, so it has no mailbox and can’t reach a goal. Send the initial email first.');
    const [current] = await tx.select().from(thread_goal_achievements).where(and(eq(thread_goal_achievements.thread_id, threadId), eq(thread_goal_achievements.goal_id, goalId)));
    if (current && current.revoked_at === null && current.method !== 'implied') throw conflict(`"${goal.name}" is already achieved on this thread.`);
    await writeAchievement(
      tx,
      row,
      goalId,
      { method: 'manual', confidence: '1.000', evidence: input.note ?? null, eventAt: input.event_at ? new Date(input.event_at) : null, confirmedBy: principal.kind === 'user' ? principal.id : null },
      deps.now,
    );
    return { activity: { type: 'goal.achieved', data: { goal_id: goalId, goal_name: goal.name, method: 'manual', ...(input.note && { note: input.note }) } } };
  });
}

export function revokeGoalAchievement(db: Db, principal: Principal, threadId: string, goalId: string, input: { reason: string }, deps: ThreadDeps) {
  return changeThread(db, principal, threadId, deps, async (tx, row) => {
    const goals = await tx.select().from(campaign_goals).where(eq(campaign_goals.campaign_id, row.campaign_id));
    const goal = goals.find((entry) => entry.id === goalId);
    if (!goal) throw notFound('The goal');
    const held = await tx.select().from(thread_goal_achievements).where(and(eq(thread_goal_achievements.thread_id, threadId), isNull(thread_goal_achievements.revoked_at)));
    if (!held.some((entry) => entry.goal_id === goalId)) throw conflict(`"${goal.name}" is not achieved on this thread.`);
    const revokedBy = principal.kind === 'user' ? principal.id : null;
    const revoke = (ids: string[]) =>
      ids.length === 0
        ? Promise.resolve()
        : tx.update(thread_goal_achievements).set({ revoked_at: deps.now, revoked_by: revokedBy, revoke_reason: input.reason }).where(and(eq(thread_goal_achievements.thread_id, threadId), inArray(thread_goal_achievements.goal_id, ids)));
    await revoke([goalId]);
    // Goals that were only implied by this one go too, unless a higher goal still implies them.
    const position = (id: string) => goals.find((entry) => entry.id === id)!.position;
    const remainingReal = held.filter((entry) => entry.goal_id !== goalId && entry.method !== 'implied');
    const highest = Math.max(0, ...remainingReal.map((entry) => position(entry.goal_id)));
    await revoke(held.filter((entry) => entry.method === 'implied' && position(entry.goal_id) > highest).map((entry) => entry.goal_id));
    await audit(tx, principal, 'goal.revoked', { type: 'thread', id: threadId }, { goal_id: goalId, reason: input.reason }, deps.now);
    return { activity: { type: 'goal.revoked', data: { goal_id: goalId, goal_name: goal.name, reason: input.reason } } };
  });
}

// ── Context for agents (§14.5) ─────────────────────────────────────────────────────────────────

const TEMPERATURES = ['cold', 'curious', 'evaluating', 'ready to buy'];

export async function getThreadContext(db: Db, workspaceId: string, threadId: string) {
  const thread = await getThread(db, workspaceId, threadId);
  const row = await findThread(db, workspaceId, threadId);
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, row.campaign_id));
  const [contact] = await db.select().from(contacts).where(eq(contacts.id, row.contact_id));
  const goals = await db.select().from(campaign_goals).where(eq(campaign_goals.campaign_id, row.campaign_id)).orderBy(asc(campaign_goals.position));
  const achieved = await db.select().from(thread_goal_achievements).where(and(eq(thread_goal_achievements.thread_id, threadId), isNull(thread_goal_achievements.revoked_at)));
  const transcript = await db.select().from(messages).where(and(eq(messages.thread_id, threadId), or(eq(messages.direction, 'inbound'), inArray(messages.status, ['sent', 'scheduled', 'pending_approval'])))).orderBy(MESSAGE_ORDER).limit(50);
  const open = await db.select({ title: escalations.title, reason: escalations.reason, priority: escalations.priority }).from(escalations).where(and(eq(escalations.thread_id, threadId), inArray(escalations.status, ['open', 'snoozed'])));
  const kb = await db
    .select({ id: knowledge_items.id, title: knowledge_items.title, content: knowledge_items.content })
    .from(knowledge_items)
    .where(and(eq(knowledge_items.workspace_id, workspaceId), eq(knowledge_items.visibility, 'shareable'), eq(knowledge_items.active, true), isNull(knowledge_items.deleted_at), or(isNull(knowledge_items.campaign_id), eq(knowledge_items.campaign_id, row.campaign_id))))
    .orderBy(asc(knowledge_items.title));

  const reached = new Set(achieved.map((entry) => entry.goal_id));
  const current = goals.find((goal) => !reached.has(goal.id));
  const custom = Object.entries(contact!.custom_fields as Record<string, unknown>);
  const lines = [
    `# ${thread.contact.name ?? thread.contact.email}${thread.contact.company ? ` (${thread.contact.company})` : ''}`,
    '',
    `- Title: ${contact!.title ?? 'unknown'}`,
    `- Timezone: ${contact!.timezone ?? 'unknown'}`,
    `- Lifecycle: ${contact!.lifecycle_stage}`,
    ...custom.map(([key, value]) => `- ${key}: ${String(value)}`),
    ...(contact!.notes ? [`- Notes: ${contact!.notes}`] : []),
    '',
    `## Campaign: ${campaign!.name}`,
    '',
    campaign!.objective,
    '',
    '## Goals',
    '',
    ...goals.map((goal) => `${goal.position}. ${goal.name}${reached.has(goal.id) ? ' (achieved)' : goal.id === current?.id ? ' ← current goal' : ''}: ${goal.success_criteria}`),
    ...(current ? ['', `### Playbook for "${current.name}"`, '', current.playbook] : []),
    '',
    '## Status',
    '',
    `- Stage: ${thread.stage_label}; state: ${thread.state}${thread.state_reason ? ` (${thread.state_reason})` : ''}`,
    `- Next action: ${thread.next_action.type}${thread.next_action.at ? ` at ${thread.next_action.at}` : ''}`,
    `- Opens: ${thread.open.status}${thread.open.count ? `, ${thread.open.count}×` : ''}`,
    ...(thread.classification.intent
      ? [`- Latest classification: intent ${thread.classification.intent} (${thread.classification.intent_p}), sentiment ${thread.classification.sentiment ?? 'unknown'}, temperature ${thread.classification.temperature !== null ? TEMPERATURES[Math.round(thread.classification.temperature)] : 'unknown'}${thread.classification.fallback ? ' (Claude only)' : ''}`]
      : []),
    ...open.map((escalation) => `- Open escalation (${escalation.priority}): ${escalation.title} [${escalation.reason}]`),
    '',
    '## Transcript (oldest first; quoted history removed)',
    '',
    ...transcript.flatMap((message) => [
      `<email direction="${message.direction}" from="${message.direction === 'inbound' ? 'contact' : message.author}" date="${(message.sent_at ?? message.received_at ?? message.created_at).toISOString()}" status="${message.status}">`,
      (message.stripped_text ?? message.body_text ?? '').trim(),
      '</email>',
      '',
    ]),
  ];
  return {
    thread_id: threadId,
    markdown: lines.join('\n'),
    allowed_links: campaign!.links as Record<string, string>,
    kb_items: kb,
    constraints: {
      autonomy: campaign!.autonomy,
      agent_mode: campaign!.agent_mode,
      sending_window: campaign!.sending_window,
      reply_delay_minutes: [campaign!.reply_delay_min_minutes, campaign!.reply_delay_max_minutes],
      max_ai_replies_per_thread: campaign!.max_ai_replies_per_thread,
      ai_replies_sent: row.ai_replies_sent,
      ai_paused: row.ai_paused,
    },
  };
}


const MAX_CHECK_IN_DAYS = 366;

/** The contact's zone, as the composer resolves it (§12.5). */
async function contactZoneOf(tx: Executor, row: ThreadRow): Promise<string> {
  const [found] = await tx
    .select({ contact: contacts.timezone, window: campaigns.sending_window, workspace: workspaces.default_timezone })
    .from(threads)
    .innerJoin(contacts, eq(contacts.id, threads.contact_id))
    .innerJoin(campaigns, eq(campaigns.id, threads.campaign_id))
    .innerJoin(workspaces, eq(workspaces.id, threads.workspace_id))
    .where(eq(threads.id, row.id));
  return found?.contact ?? (found?.window as { fallback_tz?: string } | null)?.fallback_tz ?? found?.workspace ?? 'UTC';
}

/** §5.10 rule 5: one check-in on the date the contact asked for, in place of the sequence. */
export function scheduleCheckIn(db: Db, principal: Principal, threadId: string, input: { date: string }, deps: ThreadDeps) {
  return changeThread(db, principal, threadId, deps, async (tx, row) => {
    if ((TERMINAL as readonly string[]).includes(row.state) || row.state === 'closed_lost') throw conflict(`A ${row.state} thread gets no check-in.`);
    if (!row.first_sent_at) throw conflict('Nothing has been sent on this thread yet, so there is nothing to check in on.');
    const zone = await contactZoneOf(tx, row);
    const today = intlZoneCalendar.toLocal(deps.now, zone);
    if (input.date <= isoDate(today)) throw invalidField('body.date', `The date must be after today (${isoDate(today)} in ${zone}).`);
    if (input.date > isoDate(addDays(today, MAX_CHECK_IN_DAYS))) throw invalidField('body.date', 'A check-in can be at most a year ahead.');
    const at = intlZoneCalendar.fromLocal({ ...parseIsoDate(input.date), hour: 0, minute: 0, second: 0 }, zone);
    // It replaces the sequence: a follow-up already written for the thread doesn't go.
    if (row.next_action_message_id && row.next_action_type === 'send_follow_up') {
      await tx.update(messages).set({ status: 'cancelled', updated_at: deps.now }).where(and(eq(messages.id, row.next_action_message_id), inArray(messages.status, ['draft', 'pending_approval', 'scheduled'])));
    }
    return {
      patch: { check_in_at: at, check_in_set_at: deps.now },
      activity: { type: 'follow_up.check_in_scheduled', data: { date: input.date, at: at.toISOString(), zone, replaced: iso(row.check_in_at) } },
    };
  });
}

export function cancelCheckIn(db: Db, principal: Principal, threadId: string, deps: ThreadDeps) {
  return changeThread(db, principal, threadId, deps, async (_tx, row) => {
    if (!row.check_in_at) throw conflict('This thread has no check-in.');
    // The sequence takes over from now, so missed steps never go out in a burst.
    return { patch: { check_in_at: null, check_in_set_at: null, follow_ups_not_before: deps.now }, activity: { type: 'follow_up.check_in_cancelled', data: { at: row.check_in_at.toISOString() } } };
  });
}
