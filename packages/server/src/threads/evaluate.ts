// The `thread.evaluate` job (spec §5.6). After any event that touches a thread, it recomputes
// stage, state and next action from the facts, writes only what changed under an optimistic lock,
// and logs one activity per stage or state change. Running it twice changes nothing the second time.

import { addWait, deriveThread, ESCALATION_RULES, intlZoneCalendar, type DerivedThread, type ZoneCalendar } from '@catalyst/core';
import { activities, escalations, newId, threads, type Db } from '@catalyst/db';
import { and, eq } from 'drizzle-orm';

import { loadThread, type Executor, type LoadedThread, type ThreadRow } from './load-facts.ts';

export interface EvaluateOptions {
  now: Date;
  calendar?: ZoneCalendar;
  /** How often to start over when another evaluation wrote the thread first. */
  maxAttempts?: number;
}

export interface Evaluation {
  /** Thread columns that were written; empty when the stored row was already right. */
  changed: string[];
  derived: DerivedThread;
  /** Set when evaluation itself raised an escalation: `went_quiet` or `reopened`. */
  escalationId: string | null;
}

class VersionConflict extends Error {}

/** The thread columns evaluation owns, as derived. */
function derivedColumns(derived: DerivedThread, openEscalations: number) {
  return {
    stage: derived.stage,
    stage_rank: derived.stageRank,
    achieved_goal_id: derived.achievedGoalId,
    state: derived.state,
    state_reason: derived.stateReason,
    next_action_type: derived.nextAction.type,
    next_action_at: derived.nextAction.at,
    next_action_message_id: derived.nextAction.messageId,
    throttle_reason: derived.throttleReason,
    waiting_since: derived.followUp.waitingSince,
    follow_up_sequence_id: derived.followUp.sequenceId,
    follow_up_step_position: derived.followUp.stepPosition,
    open_status: derived.openStatus,
    open_count: derived.counters.openCount,
    first_opened_at: derived.counters.firstOpenedAt,
    last_opened_at: derived.counters.lastOpenedAt,
    clicked: derived.counters.clicked,
    follow_ups_sent: derived.counters.followUpsSent,
    ai_replies_sent: derived.counters.aiRepliesSent,
    first_sent_at: derived.timestamps.firstSentAt,
    received_at: derived.timestamps.receivedAt,
    responded_at: derived.timestamps.respondedAt,
    completed_at: derived.timestamps.completedAt,
    last_message_at: derived.timestamps.lastMessageAt,
    last_inbound_at: derived.timestamps.lastInboundAt,
    last_outbound_at: derived.timestamps.lastOutboundAt,
    open_escalations: openEscalations,
  } satisfies Partial<ThreadRow>;
}

const same = (a: unknown, b: unknown) => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b);

async function evaluateOnce(tx: Executor, threadId: string, now: Date, calendar: ZoneCalendar): Promise<Evaluation | null> {
  const loaded = await loadThread(tx, threadId);
  if (!loaded) return null;
  const { row, facts } = loaded;

  let derived = deriveThread({ ...facts, now, calendar });
  const patch: Partial<ThreadRow> = {};
  let escalationId: string | null = null;

  // A wait ran out: carry out its finish rule once, then derive again with the new facts.
  if (derived.finishDue === 'close_lost') {
    Object.assign(patch, { closed_at: now, closed_reason: 'went_quiet', finish_applied_at: now });
    facts.thread = { ...facts.thread, closedAt: now, closedReason: 'went_quiet', finishAppliedAt: now };
    derived = deriveThread({ ...facts, now, calendar });
  } else if (derived.finishDue === 'notify_owner') {
    escalationId = await raiseEscalation(tx, loaded, 'went_quiet', now, calendar);
    patch.finish_applied_at = now;
    facts.thread = { ...facts.thread, finishAppliedAt: now };
    facts.openEscalations += 1;
    derived = deriveThread({ ...facts, now, calendar });
  } else if (row.state === 'closed_lost' && row.closed_at !== null && REOPENED_STATES.includes(derived.state)) {
    // The close record is still there, so only a human reply stored after it can have ended it (§5.4).
    escalationId = await raiseEscalation(tx, loaded, 'reopened', now, calendar);
    facts.openEscalations += 1;
    derived = deriveThread({ ...facts, now, calendar });
  }

  for (const [column, value] of Object.entries(derivedColumns(derived, facts.openEscalations))) {
    if (!same(row[column as keyof ThreadRow], value)) Object.assign(patch, { [column]: value });
  }
  const changed = Object.keys(patch);
  if (changed.length === 0) return { changed, derived, escalationId };

  const written = await tx
    .update(threads)
    .set({ ...patch, version: row.version + 1, updated_at: now })
    .where(and(eq(threads.id, threadId), eq(threads.version, row.version)))
    .returning({ id: threads.id });
  if (written.length === 0) throw new VersionConflict();

  const base = {
    workspace_id: row.workspace_id,
    contact_id: row.contact_id,
    thread_id: row.id,
    campaign_id: row.campaign_id,
    actor_type: 'system' as const,
    occurred_at: now,
  };
  const log: (typeof activities.$inferInsert)[] = [];
  if (row.stage_rank !== derived.stageRank || row.stage !== derived.stage) {
    log.push({
      ...base,
      id: newId('activity'),
      type: 'thread.stage_changed',
      data: { from: row.stage, to: derived.stage, from_rank: row.stage_rank, to_rank: derived.stageRank, goal_id: derived.achievedGoalId },
    });
  }
  if (row.state !== derived.state) {
    log.push({ ...base, id: newId('activity'), type: 'thread.state_changed', data: { from: row.state, to: derived.state, reason: derived.stateReason } });
  }
  if (log.length > 0) await tx.insert(activities).values(log);

  return { changed, derived, escalationId };
}

const ESCALATION_TEXT = {
  went_quiet: {
    title: 'Went quiet',
    explanation: 'The contact engaged, then stopped answering. The follow-ups for this stage have all gone out. Decide whether to call, close the thread, or leave it.',
  },
  reopened: {
    title: 'Replied after the thread was closed',
    explanation: 'The contact wrote again on a thread that was closed as lost. Nothing is sent until you decide: reply, let the agent carry on, or close it again.',
  },
} as const;

/** States a closed thread can land in once a reply has ended the close. */
const REOPENED_STATES: readonly ThreadRow['state'][] = ['active', 'pending_approval', 'needs_human', 'paused', 'exhausted'];

/** Raises an escalation that evaluation itself is responsible for (§5.4, §5.10, §11.1). */
async function raiseEscalation(
  tx: Executor,
  loaded: LoadedThread,
  reason: keyof typeof ESCALATION_TEXT,
  now: Date,
  calendar: ZoneCalendar,
): Promise<string> {
  const { row } = loaded;
  const rule = ESCALATION_RULES[reason];
  const id = newId('escalation');
  await tx.insert(escalations).values({
    id,
    workspace_id: row.workspace_id,
    thread_id: row.id,
    reason,
    reasons: [reason],
    priority: rule.priority,
    ...ESCALATION_TEXT[reason],
    assigned_user_id: loaded.defaultAssigneeId,
    // Both reasons have a one-business-day SLA; hour-based SLAs will use the workspace's business hours.
    due_at: addWait(now, { amount: rule.sla.amount, unit: 'business_days' }, { zone: loaded.workspaceTimezone, calendar }),
  });
  await tx.insert(activities).values({
    id: newId('activity'),
    workspace_id: row.workspace_id,
    contact_id: row.contact_id,
    thread_id: row.id,
    campaign_id: row.campaign_id,
    type: 'escalation.created',
    actor_type: 'system',
    data: { escalation_id: id, reason, priority: rule.priority },
    occurred_at: now,
  });
  return id;
}

/** Evaluates one thread. Returns null if the thread doesn't exist. */
export async function evaluateThread(db: Db, threadId: string, options: EvaluateOptions): Promise<Evaluation | null> {
  const calendar = options.calendar ?? intlZoneCalendar;
  const maxAttempts = options.maxAttempts ?? 5;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await db.transaction((tx) => evaluateOnce(tx, threadId, options.now, calendar));
    } catch (error) {
      if (!(error instanceof VersionConflict) || attempt >= maxAttempts) throw error;
    }
  }
}
