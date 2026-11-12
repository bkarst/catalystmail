// Raising an escalation (spec §11.1): priority and SLA from the reason, assigned to the thread's
// assignee, else the campaign owner, else the mailbox owner. The same reason is never raised twice
// on a thread while one is still open.

import { ESCALATION_RULES, escalationDueAt, intlZoneCalendar, type EscalationReason } from '@catalyst/core';
import { activities, campaigns, escalations, mailboxes, newId, threads, type Executor } from '@catalyst/db';
import { and, eq, inArray } from 'drizzle-orm';

import { slaClockFor } from '../settings/service.ts';

export interface RaiseInput {
  workspaceId: string;
  threadId: string | null;
  reason: EscalationReason;
  /** Every reason that applies; the first is `reason`. */
  reasons?: EscalationReason[];
  title: string;
  explanation: string;
  triggerMessageId?: string | null;
  suggestedDraftId?: string | null;
  questions?: { text: string; why_unanswerable: string }[];
  /** goal_confirmation: the goal to confirm and its probability. One escalation per goal. */
  goal?: { id: string; p: number };
}

export async function raiseEscalation(db: Executor, input: RaiseInput, now: Date): Promise<{ id: string; created: boolean }> {
  if (input.threadId) {
    const [open] = await db
      .select({ id: escalations.id })
      .from(escalations)
      .where(and(eq(escalations.thread_id, input.threadId), eq(escalations.reason, input.reason), inArray(escalations.status, ['open', 'snoozed']), input.goal ? eq(escalations.goal_id, input.goal.id) : undefined));
    if (open) return { id: open.id, created: false };
  }
  const clock = await slaClockFor(db, input.workspaceId);
  let assignee: string | null = null;
  let thread: { contact_id: string; campaign_id: string } | undefined;
  if (input.threadId) {
    const [row] = await db
      .select({ assigned: threads.assigned_user_id, campaignOwner: campaigns.owner_user_id, mailboxOwner: mailboxes.owner_user_id, contact_id: threads.contact_id, campaign_id: threads.campaign_id })
      .from(threads)
      .innerJoin(campaigns, eq(campaigns.id, threads.campaign_id))
      .leftJoin(mailboxes, eq(mailboxes.id, threads.mailbox_id))
      .where(eq(threads.id, input.threadId));
    assignee = row?.assigned ?? row?.campaignOwner ?? row?.mailboxOwner ?? null;
    thread = row;
  }
  const rule = ESCALATION_RULES[input.reason];
  const id = newId('escalation');
  await db.insert(escalations).values({
    id,
    workspace_id: input.workspaceId,
    thread_id: input.threadId,
    trigger_message_id: input.triggerMessageId ?? null,
    reason: input.reason,
    reasons: input.reasons ?? [input.reason],
    priority: rule.priority,
    title: input.title,
    explanation: input.explanation,
    questions: input.questions ?? [],
    suggested_draft_id: input.suggestedDraftId ?? null,
    goal_id: input.goal?.id ?? null,
    goal_p: input.goal ? input.goal.p.toFixed(3) : null,
    assigned_user_id: assignee,
    due_at: escalationDueAt(rule, now, { zone: clock.zone, calendar: intlZoneCalendar }, clock.businessHours),
    created_at: now,
    updated_at: now,
  });
  await db.insert(activities).values({
    id: newId('activity'),
    workspace_id: input.workspaceId,
    contact_id: thread?.contact_id ?? null,
    thread_id: input.threadId,
    campaign_id: thread?.campaign_id ?? null,
    type: 'escalation.created',
    actor_type: 'system',
    data: { escalation_id: id, reason: input.reason, priority: rule.priority, title: input.title },
    occurred_at: now,
  });
  return { id, created: true };
}
