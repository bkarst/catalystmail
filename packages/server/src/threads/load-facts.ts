// Loads everything `deriveThread` needs for one thread and turns rows into facts (spec §5.6).

import type {
  DeriveThreadInput,
  FollowUpSequence,
  GoalRef,
  MessageFacts,
  StageKey,
} from '@catalyst/core';
import {
  activities,
  campaign_goals,
  campaign_steps,
  campaigns,
  contacts,
  escalations,
  follow_up_sequences,
  mailboxes,
  messages,
  thread_goal_achievements,
  threads,
  tracking_events,
  suppressionsFor,
  workspaces,
  type Db,
} from '@catalyst/db';
import { and, asc, count, eq, inArray, isNull } from 'drizzle-orm';

/** A database handle or an open transaction. */
export type Executor = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

export type ThreadRow = typeof threads.$inferSelect;

export interface LoadedThread {
  row: ThreadRow;
  /** Everything `deriveThread` takes except the clock and the zone calendar. */
  facts: Omit<DeriveThreadInput, 'now' | 'calendar'>;
  /** Where a new escalation on this thread goes: thread assignee, campaign owner, then mailbox owner (§11.1). */
  defaultAssigneeId: string | null;
  workspaceTimezone: string;
}

const SKIPPED_STEP_ACTIVITY = 'follow_up.skipped';

export async function loadThread(db: Executor, threadId: string): Promise<LoadedThread | null> {
  const [row] = await db.select().from(threads).where(eq(threads.id, threadId));
  if (!row) return null;

  // One query at a time: inside a transaction they all share a single connection.
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, row.campaign_id));
  const [contact] = await db.select().from(contacts).where(eq(contacts.id, row.contact_id));
  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, row.workspace_id));
  const goalRows = await db.select().from(campaign_goals).where(eq(campaign_goals.campaign_id, row.campaign_id)).orderBy(asc(campaign_goals.position));
  const sequenceRows = await db.select().from(follow_up_sequences).where(eq(follow_up_sequences.campaign_id, row.campaign_id));
  const stepRows = await db.select().from(campaign_steps).where(eq(campaign_steps.campaign_id, row.campaign_id)).orderBy(asc(campaign_steps.position));
  const messageRows = await db
    .select({
      id: messages.id,
      direction: messages.direction,
      status: messages.status,
      author: messages.author,
      step_id: messages.step_id,
      tracking_token: messages.tracking_token,
      scheduled_for: messages.scheduled_for,
      sent_at: messages.sent_at,
      received_at: messages.received_at,
      inbound_kind: messages.inbound_kind,
      needs_reply_p: messages.needs_reply_p,
      auto_reply_until: messages.auto_reply_until,
      created_at: messages.created_at,
    })
    .from(messages)
    .where(eq(messages.thread_id, threadId));
  const trackingRows = await db.select().from(tracking_events).where(eq(tracking_events.thread_id, threadId));
  const achievementRows = await db
    .select()
    .from(thread_goal_achievements)
    .where(and(eq(thread_goal_achievements.thread_id, threadId), isNull(thread_goal_achievements.revoked_at)));
  const [escalationCount] = await db
    .select({ open: count() })
    .from(escalations)
    .where(and(eq(escalations.thread_id, threadId), inArray(escalations.status, ['open', 'snoozed'])));
  const skipRows = await db
    .select({ data: activities.data, occurred_at: activities.occurred_at })
    .from(activities)
    .where(and(eq(activities.thread_id, threadId), eq(activities.type, SKIPPED_STEP_ACTIVITY)));
  if (!campaign || !contact || !workspace) throw new Error(`Thread ${threadId} points at a missing campaign, contact or workspace`);
  const suppressed = (await suppressionsFor(db, row.workspace_id, contact.email)).length > 0;

  const [mailbox] = row.mailbox_id ? await db.select({ owner: mailboxes.owner_user_id }).from(mailboxes).where(eq(mailboxes.id, row.mailbox_id)) : [];

  const stepsById = new Map(stepRows.map((step) => [step.id, step]));
  const goals: GoalRef[] = goalRows.map((goal) => ({ id: goal.id, key: goal.key, name: goal.name, position: goal.position }));

  const sequences: FollowUpSequence[] = sequenceRows.map((sequence) => ({
    id: sequence.id,
    name: sequence.name,
    stages: sequence.stages as StageKey[],
    steps: stepRows
      .filter((step) => step.sequence_id === sequence.id)
      .map((step) => ({
        position: step.position,
        wait: { amount: step.wait_amount, unit: step.wait_unit },
        waitFrom: step.wait_from as 'last_message' | 'goal_event',
        mode: step.mode,
      })),
    finish: sequence.finish,
    finalWait: { amount: sequence.final_wait_amount, unit: sequence.final_wait_unit },
    active: sequence.active,
  }));

  const messageFacts: MessageFacts[] = messageRows.map((message) => {
    // A step with no sequence is the campaign's initial email; a message with no step is a reply.
    const step = message.step_id ? stepsById.get(message.step_id) : undefined;
    return {
      id: message.id,
      direction: message.direction,
      status: message.status,
      author: message.author,
      createdAt: message.created_at,
      ...(message.direction === 'outbound' && {
        purpose: step ? (step.sequence_id ? 'follow_up' : 'initial') : 'reply',
        sequenceId: step?.sequence_id ?? null,
        stepPosition: step?.sequence_id ? step.position : null,
        tracked: message.tracking_token !== null,
        scheduledFor: message.scheduled_for,
        sentAt: message.sent_at,
      }),
      ...(message.direction === 'inbound' && {
        inboundKind: message.inbound_kind,
        receivedAt: message.received_at,
        needsReply: message.needs_reply_p === null ? null : Number(message.needs_reply_p),
        autoReplyUntil: message.auto_reply_until,
      }),
    };
  });

  const window = campaign.sending_window as { fallback_tz?: string };

  return {
    row,
    defaultAssigneeId: row.assigned_user_id ?? campaign.owner_user_id ?? mailbox?.owner ?? null,
    workspaceTimezone: workspace.default_timezone,
    facts: {
      thread: {
        enrolledAt: row.created_at,
        manualFloorRank: row.manual_floor_rank,
        receivedAt: row.received_at,
        stopped: row.stopped_at !== null,
        paused: row.manually_paused,
        aiPaused: row.ai_paused,
        closedAt: row.closed_at,
        closedReason: row.closed_reason,
        followUpsStopped: row.follow_ups_stopped,
        followUpsNotBefore: row.follow_ups_not_before,
        checkIn: row.check_in_at && row.check_in_set_at ? { at: row.check_in_at, setAt: row.check_in_set_at } : null,
        finishAppliedAt: row.finish_applied_at,
        // The scheduler postpones a send by moving next_action_at and saying why.
        postponement:
          row.throttle_reason !== null && row.next_action_at !== null
            ? { actionType: row.next_action_type, until: row.next_action_at, reason: row.throttle_reason }
            : null,
      },
      campaign: {
        archived: campaign.status === 'archived',
        deliveryGraceMinutes: campaign.delivery_grace_minutes,
        finalWaitBusinessDays: campaign.final_wait_business_days,
        blackoutDates: campaign.blackout_dates,
      },
      goals,
      sequences,
      messages: messageFacts,
      tracking: trackingRows.map((event) => ({
        messageId: event.message_id,
        type: event.type,
        source: event.source,
        occurredAt: event.occurred_at,
      })),
      achievements: achievementRows.map((achievement) => ({
        goalId: achievement.goal_id,
        achievedAt: achievement.achieved_at,
        eventAt: achievement.event_at,
      })),
      skippedSteps: skipRows.flatMap((skip) => {
        const data = skip.data as { sequence_id?: string; step_position?: number };
        return data.sequence_id && data.step_position ? [{ sequenceId: data.sequence_id, stepPosition: data.step_position, at: skip.occurred_at }] : [];
      }),
      openEscalations: escalationCount?.open ?? 0,
      contact: {
        unsubscribed: contact.subscription_status !== 'subscribed',
        hardBounced: contact.email_verification === 'bounced',
        deleted: contact.deleted_at !== null,
        suppressed,
        doNotContact: contact.do_not_contact,
        // City and country inference (§12.5) comes with the contact module; until then the
        // explicit zone, the campaign fallback, then the workspace default.
        timezone: contact.timezone ?? window.fallback_tz ?? workspace.default_timezone,
      },
    },
  };
}
