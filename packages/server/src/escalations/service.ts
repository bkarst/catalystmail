// The "Needs you" queue (spec §11): listing escalations, settling them, and the SLA clock that
// wakes snoozed ones and raises the priority of those left past their due time.

import { escalationDueAt, intlZoneCalendar, PRIORITY_RULES, priorityAfterBreach } from '@catalyst/core';
import type { Escalation } from '@catalyst/contract';
import { activities, escalations, newId, thread_goal_achievements, threads, users, workspaces, type Db, type Executor } from '@catalyst/db';
import type { JobQueue } from '@catalyst/jobs';
import { and, eq, isNull, lte, sql, type SQL } from 'drizzle-orm';

import type { Principal } from '../api/auth.ts';
import { conflict, invalidField, notFound } from '../api/errors.ts';
import { decodeCursor, page } from '../api/pagination.ts';
import { actorOf, iso } from '../shared.ts';
import { businessHoursOf } from '../settings/service.ts';
import { evaluateThread } from '../threads/evaluate.ts';
import { writeAchievement } from '../threads/service.ts';

type EscalationRow = typeof escalations.$inferSelect;
type Joined = { escalation: EscalationRow; contactId: string | null; campaignId: string | null };

/** Unsettled: still holding its thread (§11.1). */
const LIVE = ['open', 'snoozed'] as const;
const SNOOZE_MAX_DAYS = 30;

export function serializeEscalation({ escalation: row, contactId, campaignId }: Joined, now: Date): Escalation {
  return {
    id: row.id,
    thread_id: row.thread_id,
    contact_id: contactId,
    campaign_id: campaignId,
    trigger_message_id: row.trigger_message_id,
    reason: row.reason,
    reasons: row.reasons,
    priority: row.priority,
    title: row.title,
    explanation: row.explanation,
    questions: row.questions as Escalation['questions'],
    suggested_draft_id: row.suggested_draft_id,
    goal_id: row.goal_id,
    goal_p: row.goal_p === null ? null : Number(row.goal_p),
    status: row.status,
    assigned_user_id: row.assigned_user_id,
    due_at: row.due_at.toISOString(),
    overdue: row.status === 'open' && row.due_at.getTime() < now.getTime(),
    snoozed_until: iso(row.snoozed_until),
    resolution: row.resolution as Escalation['resolution'],
    resolution_note: row.resolution_note,
    resolved_by: row.resolved_by,
    resolved_at: iso(row.resolved_at),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

const joined = (db: Executor) =>
  db
    .select({ escalation: escalations, contactId: threads.contact_id, campaignId: threads.campaign_id })
    .from(escalations)
    .leftJoin(threads, eq(threads.id, escalations.thread_id));

const PRIORITY_RANK = sql<number>`case ${escalations.priority} when 'urgent' then 0 when 'high' then 1 else 2 end`;
const SORT = 'priority';

export interface ListEscalationsQuery {
  limit: number;
  cursor?: string | undefined;
  status: 'open' | 'snoozed' | 'resolved' | 'dismissed' | 'all';
  priority?: EscalationRow['priority'] | undefined;
  reason?: EscalationRow['reason'] | undefined;
  thread_id?: string | undefined;
  campaign_id?: string | undefined;
  assigned_user_id?: string | undefined;
  overdue?: 'true' | 'false' | undefined;
}

/** Most urgent first, then soonest due (§15 "Needs you"). */
export async function listEscalations(db: Db, workspaceId: string, query: ListEscalationsQuery, now: Date) {
  const where: SQL[] = [eq(escalations.workspace_id, workspaceId)];
  if (query.status !== 'all') where.push(eq(escalations.status, query.status));
  if (query.priority) where.push(eq(escalations.priority, query.priority));
  if (query.reason) where.push(eq(escalations.reason, query.reason));
  if (query.thread_id) where.push(eq(escalations.thread_id, query.thread_id));
  if (query.campaign_id) where.push(eq(threads.campaign_id, query.campaign_id));
  if (query.assigned_user_id) where.push(eq(escalations.assigned_user_id, query.assigned_user_id));
  if (query.overdue === 'true') where.push(eq(escalations.status, 'open'), sql`${escalations.due_at} < ${now}`);
  if (query.overdue === 'false') where.push(sql`not (${escalations.status} = 'open' and ${escalations.due_at} < ${now})`);
  if (query.cursor) {
    const cursorId = decodeCursor(query.cursor, SORT);
    where.push(
      sql`(${PRIORITY_RANK}, ${escalations.due_at}, ${escalations.id}) > (select case e.priority when 'urgent' then 0 when 'high' then 1 else 2 end, e.due_at, e.id from escalations e where e.id = ${cursorId})`,
    );
  }
  const rows = await joined(db)
    .where(and(...where))
    .orderBy(PRIORITY_RANK, escalations.due_at, escalations.id)
    .limit(query.limit + 1);
  const { rows: kept, next_cursor } = page(rows.map((row) => ({ ...row, id: row.escalation.id })), query.limit, SORT);
  return { data: kept.map((row) => serializeEscalation(row, now)), next_cursor };
}

export async function getEscalation(db: Db, workspaceId: string, escalationId: string, now: Date): Promise<Escalation> {
  const [row] = await joined(db).where(and(eq(escalations.id, escalationId), eq(escalations.workspace_id, workspaceId)));
  if (!row) throw notFound('The escalation');
  return serializeEscalation(row, now);
}

export interface EscalationDeps {
  jobs: JobQueue;
  now: Date;
}

/**
 * Changes one escalation under a row lock and logs it. When it stops holding its thread, the
 * thread is evaluated so it leaves `needs_human` (§11.1).
 */
async function changeEscalation(
  db: Db,
  principal: Principal,
  escalationId: string,
  deps: EscalationDeps,
  change: (tx: Executor, row: EscalationRow) => Promise<{ patch: Partial<typeof escalations.$inferInsert>; activity: { type: string; data: Record<string, unknown> } }>,
): Promise<Escalation> {
  const { now } = deps;
  const { threadId, settled } = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(escalations).where(and(eq(escalations.id, escalationId), eq(escalations.workspace_id, principal.workspace.id))).for('update');
    if (!row) throw notFound('The escalation');
    const { patch, activity } = await change(tx, row);
    await tx.update(escalations).set({ ...patch, updated_at: now }).where(eq(escalations.id, row.id));
    const [thread] = row.thread_id ? await tx.select({ contact_id: threads.contact_id, campaign_id: threads.campaign_id }).from(threads).where(eq(threads.id, row.thread_id)) : [];
    await tx.insert(activities).values({
      id: newId('activity'),
      workspace_id: principal.workspace.id,
      contact_id: thread?.contact_id ?? null,
      thread_id: row.thread_id,
      campaign_id: thread?.campaign_id ?? null,
      type: activity.type,
      ...actorOf(principal),
      data: { escalation_id: row.id, reason: row.reason, ...activity.data },
      occurred_at: now,
    });
    return { threadId: row.thread_id, settled: patch.status === 'resolved' || patch.status === 'dismissed' };
  });
  if (threadId && settled) {
    try {
      await evaluateThread(db, threadId, { now });
    } catch (error) {
      console.error(`[escalations] evaluating ${threadId} inline failed; queued instead`, error);
      await deps.jobs.enqueue('thread.evaluate', { thread_id: threadId });
    }
  }
  return getEscalation(db, principal.workspace.id, escalationId, now);
}

function assertLive(row: EscalationRow, action: string): void {
  if (!(LIVE as readonly string[]).includes(row.status)) throw conflict(`This escalation is already ${row.status}; only an open or snoozed one can be ${action}.`);
}

const settledBy = (principal: Principal) => (principal.kind === 'user' ? principal.id : null);

export function resolveEscalation(db: Db, principal: Principal, escalationId: string, input: { resolution: NonNullable<Escalation['resolution']>; note?: string | undefined }, deps: EscalationDeps) {
  return changeEscalation(db, principal, escalationId, deps, async (tx, row) => {
    assertLive(row, 'resolved');
    if (input.resolution === 'took_over') {
      // "Take over thread" (§11.3): the agent stands back on this thread.
      if (!row.thread_id) throw invalidField('body.resolution', 'This escalation is about no thread, so there is nothing to take over.');
      const [thread] = await tx.select().from(threads).where(eq(threads.id, row.thread_id)).for('update');
      if (thread && !thread.ai_paused) {
        await tx.update(threads).set({ ai_paused: true, updated_at: deps.now }).where(eq(threads.id, thread.id));
        await tx.insert(activities).values({ id: newId('activity'), workspace_id: row.workspace_id, contact_id: thread.contact_id, thread_id: thread.id, campaign_id: thread.campaign_id, type: 'thread.ai_paused', ...actorOf(principal), data: { reason: 'Taken over from an escalation', escalation_id: row.id }, occurred_at: deps.now });
      }
    }
    if (input.resolution === 'goal_confirmed' && row.goal_id && row.thread_id) await confirmGoal(tx, principal, row, deps.now);
    return {
      patch: { status: 'resolved', resolution: input.resolution, resolution_note: input.note ?? null, resolved_by: settledBy(principal), resolved_at: deps.now, snoozed_until: null },
      activity: { type: 'escalation.resolved', data: { resolution: input.resolution, note: input.note ?? null } },
    };
  });
}

/**
 * "Confirm" on a goal confirmation (§5.2, §15.5): the goal is recorded as the classifier read it
 * (`method = ai`, its probability), confirmed by the person. Nothing changes when it is already held.
 */
async function confirmGoal(tx: Executor, principal: Principal, row: EscalationRow, now: Date): Promise<void> {
  const [thread] = await tx.select().from(threads).where(eq(threads.id, row.thread_id!)).for('update');
  if (!thread) return;
  const [held] = await tx
    .select({ goal_id: thread_goal_achievements.goal_id })
    .from(thread_goal_achievements)
    .where(and(eq(thread_goal_achievements.thread_id, thread.id), eq(thread_goal_achievements.goal_id, row.goal_id!), isNull(thread_goal_achievements.revoked_at)));
  if (held) return;
  const confirmedBy = principal.kind === 'user' ? principal.id : null;
  await writeAchievement(tx, thread, row.goal_id!, { method: 'ai', confidence: row.goal_p ?? '1.000', evidence: row.explanation.slice(0, 1000), eventAt: null, confirmedBy }, now);
  await tx.insert(activities).values({ id: newId('activity'), workspace_id: row.workspace_id, contact_id: thread.contact_id, thread_id: thread.id, campaign_id: thread.campaign_id, type: 'goal.achieved', ...actorOf(principal), data: { goal_id: row.goal_id, method: 'ai', p: row.goal_p === null ? null : Number(row.goal_p), confirmed: true, escalation_id: row.id }, occurred_at: now });
}

export function dismissEscalation(db: Db, principal: Principal, escalationId: string, input: { reason: string }, deps: EscalationDeps) {
  return changeEscalation(db, principal, escalationId, deps, async (_tx, row) => {
    assertLive(row, 'dismissed');
    return {
      patch: { status: 'dismissed', resolution: 'dismissed', resolution_note: input.reason, resolved_by: settledBy(principal), resolved_at: deps.now, snoozed_until: null },
      activity: { type: 'escalation.resolved', data: { resolution: 'dismissed', note: input.reason } },
    };
  });
}

export function snoozeEscalation(db: Db, principal: Principal, escalationId: string, input: { until: string; note?: string | undefined }, deps: EscalationDeps) {
  return changeEscalation(db, principal, escalationId, deps, async (_tx, row) => {
    assertLive(row, 'snoozed');
    const until = new Date(input.until);
    if (until.getTime() <= deps.now.getTime()) throw invalidField('body.until', 'Pick a time in the future.');
    if (until.getTime() > deps.now.getTime() + SNOOZE_MAX_DAYS * 86_400_000) throw invalidField('body.until', `At most ${SNOOZE_MAX_DAYS} days ahead.`);
    // The SLA is paused while it sleeps: the due time moves by the time snoozed (§11.3).
    const sleepsFrom = row.status === 'snoozed' && row.snoozed_until ? row.snoozed_until : deps.now;
    const dueAt = new Date(row.due_at.getTime() + (until.getTime() - sleepsFrom.getTime()));
    return {
      patch: { status: 'snoozed', snoozed_until: until, due_at: dueAt },
      activity: { type: 'escalation.snoozed', data: { until: until.toISOString(), note: input.note ?? null } },
    };
  });
}

export function assignEscalation(db: Db, principal: Principal, escalationId: string, input: { user_id: string | null }, deps: EscalationDeps) {
  return changeEscalation(db, principal, escalationId, deps, async (tx, row) => {
    assertLive(row, 'assigned');
    if (input.user_id) {
      const [user] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, input.user_id), eq(users.workspace_id, principal.workspace.id), isNull(users.deactivated_at)));
      if (!user) throw invalidField('body.user_id', 'No such person in this workspace.');
    }
    return { patch: { assigned_user_id: input.user_id }, activity: { type: 'escalation.assigned', data: { from: row.assigned_user_id, to: input.user_id } } };
  });
}

/**
 * `escalation.sla_check` (every 15 minutes, §4.4): snoozed escalations whose time has come are
 * open again, and each open one past its due time goes up one priority with a new due time from
 * now, so it is flagged again if it stays untouched (§11.1).
 */
export async function escalationSlaCheck(db: Db, now: Date): Promise<{ woken: number; breached: number }> {
  const woken = await db
    .update(escalations)
    .set({ status: 'open', snoozed_until: null, updated_at: now })
    .where(and(eq(escalations.status, 'snoozed'), lte(escalations.snoozed_until, now)))
    .returning({ id: escalations.id });
  const due = await db
    .select({ escalation: escalations, zone: workspaces.default_timezone, settings: workspaces.settings, contactId: threads.contact_id, campaignId: threads.campaign_id })
    .from(escalations)
    .innerJoin(workspaces, eq(workspaces.id, escalations.workspace_id))
    .leftJoin(threads, eq(threads.id, escalations.thread_id))
    .where(and(eq(escalations.status, 'open'), lte(escalations.due_at, now)));
  for (const { escalation, zone, settings, contactId, campaignId } of due) {
    const priority = priorityAfterBreach(escalation.priority);
    const dueAt = escalationDueAt(PRIORITY_RULES[priority], now, { zone, calendar: intlZoneCalendar }, businessHoursOf(settings));
    await db.transaction(async (tx) => {
      const [current] = await tx.update(escalations).set({ priority, due_at: dueAt, updated_at: now }).where(and(eq(escalations.id, escalation.id), eq(escalations.status, 'open'), lte(escalations.due_at, now))).returning({ id: escalations.id });
      if (!current) return;
      await tx.insert(activities).values({
        id: newId('activity'),
        workspace_id: escalation.workspace_id,
        contact_id: contactId,
        thread_id: escalation.thread_id,
        campaign_id: campaignId,
        type: 'escalation.sla_breached',
        actor_type: 'system',
        data: { escalation_id: escalation.id, reason: escalation.reason, from: escalation.priority, to: priority, was_due: escalation.due_at.toISOString(), due_at: dueAt.toISOString() },
        occurred_at: now,
      });
    });
  }
  return { woken: woken.length, breached: due.length };
}
