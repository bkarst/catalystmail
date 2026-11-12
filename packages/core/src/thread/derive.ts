// Thread evaluation (§5.3–§5.6, §5.8, §5.10): stage, state, next action and open status, derived
// from facts. Pure and idempotent: the same facts always give the same result, so the worker can
// run it after every event and write only what changed.

import {
  defaultFinishRule,
  MAX_FOLLOW_UPS_PER_30_DAYS,
  sequenceForStage,
  stageKeyForRank,
  type FollowUpSequence,
  type FollowUpStep,
  type GoalRef,
  type StageKey,
} from '../follow-ups/sequences.ts';
import { addBusinessDays, addWait, type ZoneContext } from '../time/schedule.ts';
import { parseIsoDate, type ZoneCalendar } from '../time/zone.ts';
import {
  DAY_MS,
  MINUTE_MS,
  type InboundKind,
  type MessageAuthor,
  type MessageDirection,
  type MessageStatus,
  type NextActionType,
  type OpenStatus,
  type SequenceFinish,
  type ThreadStage,
  type ThreadState,
  type TrackingSource,
  type TrackingType,
  type Wait,
} from '../types.ts';

export interface MessageFacts {
  id: string;
  direction: MessageDirection;
  status: MessageStatus;
  author?: MessageAuthor;
  /** When the row was stored. For inbound mail this is the ingestion time, not the mail's date. */
  createdAt: Date;

  // Outbound
  /** What the message is: the campaign's initial email, a follow-up step, or a reply (anything else we send). */
  purpose?: 'initial' | 'follow_up' | 'reply';
  /** Follow-ups: the sequence and step the message belongs to. */
  sequenceId?: string | null;
  stepPosition?: number | null;
  /** Open tracking was on for this message. */
  tracked?: boolean;
  scheduledFor?: Date | null;
  /** Set once the SMTP server accepted the message. */
  sentAt?: Date | null;

  // Inbound
  inboundKind?: InboundKind | null;
  receivedAt?: Date | null;
  /** Jev's `needs_reply` probability; null until the message is classified. */
  needsReply?: number | null;
  /** Out-of-office return date, `YYYY-MM-DD`. */
  autoReplyUntil?: string | null;
}

export interface TrackingFacts {
  messageId: string;
  type: TrackingType;
  source: TrackingSource;
  occurredAt: Date;
}

/** A goal achievement that hasn't been revoked. */
export interface GoalAchievementFacts {
  goalId: string;
  achievedAt: Date;
  /** When the goal's event happens, such as the start of a booked call. */
  eventAt: Date | null;
}

/** The stored facts about a thread that evaluation reads but never derives. */
export interface ThreadFacts {
  enrolledAt: Date;
  manualFloorRank: number;
  /** Delivery is latched: once proven it stays proven, so a late bounce can't lower the stage. */
  receivedAt: Date | null;
  /** Stopped by hand. */
  stopped: boolean;
  /** Paused by a person. */
  paused: boolean;
  /** A person took the thread over from the agent. */
  aiPaused: boolean;
  closedAt: Date | null;
  closedReason: string | null;
  /** A person stopped follow-ups for this thread. */
  followUpsStopped: boolean;
  /** Earliest moment the next follow-up may go: set when a hold ends or follow-ups are resumed. */
  followUpsNotBefore: Date | null;
  /** When the finish rule of a wait was last carried out (an escalation raised or the thread closed). */
  finishAppliedAt: Date | null;
  /** A due send the scheduler pushed back for capacity or the sending window (§8.3.5). */
  postponement: { actionType: NextActionType; until: Date; reason: string } | null;
  /**
   * A check-in the contact asked for ("not now, try in March", §5.10 rule 5): due `at`, set at
   * `setAt`. It replaces the stage's sequence until it is composed (the composer then clears it);
   * a human reply after `setAt` cancels it.
   */
  checkIn?: { at: Date; setAt: Date } | null;
}

export interface CampaignFacts {
  archived: boolean;
  deliveryGraceMinutes: number;
  finalWaitBusinessDays: number;
  blackoutDates: readonly string[];
}

export interface ContactFacts {
  /** Unsubscribed or complained: global, no further email of any kind. */
  unsubscribed: boolean;
  hardBounced: boolean;
  deleted: boolean;
  /** The address or its domain is on the suppression list (§8.6). */
  suppressed?: boolean;
  /** A person set do-not-contact on the contact. */
  doNotContact?: boolean;
  /** Resolved IANA zone (§12.5). */
  timezone: string;
}

export interface DeriveThreadInput {
  thread: ThreadFacts;
  campaign: CampaignFacts;
  goals: readonly GoalRef[];
  sequences: readonly FollowUpSequence[];
  messages: readonly MessageFacts[];
  tracking: readonly TrackingFacts[];
  achievements: readonly GoalAchievementFacts[];
  /**
   * Follow-up steps a person skipped (`follow_up.skipped` activities). A skipped step counts as
   * taken at that moment without being sent, so the sequence moves on to the next one.
   */
  skippedSteps?: readonly { sequenceId: string; stepPosition: number; at: Date }[];
  openEscalations: number;
  contact: ContactFacts;
  now: Date;
  calendar: ZoneCalendar;
  /** Below this `needs_reply` probability the contact's message needs no answer (§10.4). */
  needsReplyThreshold?: number;
}

export interface NextAction {
  type: NextActionType;
  /** When it is due. Null for a reply still being drafted and for an open-ended wait. */
  at: Date | null;
  messageId: string | null;
}

export interface DerivedThread {
  stage: ThreadStage;
  stageRank: number;
  achievedGoalId: string | null;
  state: ThreadState;
  stateReason: string | null;
  nextAction: NextAction;
  throttleReason: string | null;
  followUp: { sequenceId: string | null; stepPosition: number | null; waitingSince: Date | null; checkIn: boolean };
  /**
   * A wait has run out and its finish rule needs a side effect from the caller: raise a
   * `went_quiet` escalation (`notify_owner`) or close the thread (`close_lost`), then record
   * `finishAppliedAt`. The `exhaust` rule needs none: the state itself becomes `exhausted`.
   */
  finishDue: Extract<SequenceFinish, 'notify_owner' | 'close_lost'> | null;
  openStatus: OpenStatus;
  counters: {
    openCount: number;
    firstOpenedAt: Date | null;
    lastOpenedAt: Date | null;
    clicked: boolean;
    followUpsSent: number;
    aiRepliesSent: number;
  };
  timestamps: {
    firstSentAt: Date | null;
    receivedAt: Date | null;
    respondedAt: Date | null;
    completedAt: Date | null;
    lastMessageAt: Date | null;
    lastInboundAt: Date | null;
    lastOutboundAt: Date | null;
  };
}

const DEFAULT_NEEDS_REPLY_THRESHOLD = 0.3;

const ms = (date: Date) => date.getTime();
const earliest = (dates: (Date | null | undefined)[]): Date | null =>
  dates.reduce<Date | null>((best, date) => (date && (!best || ms(date) < ms(best)) ? date : best), null);
const latest = (dates: (Date | null | undefined)[]): Date | null =>
  dates.reduce<Date | null>((best, date) => (date && (!best || ms(date) > ms(best)) ? date : best), null);

const isBounce = (message: MessageFacts) => message.inboundKind === 'bounce_hard' || message.inboundKind === 'bounce_soft';
const inboundTime = (message: MessageFacts) => message.receivedAt ?? message.createdAt;

interface Timed {
  message: MessageFacts;
  at: Date;
}

type WaitAnalysis =
  | { kind: 'not_started' }
  | { kind: 'reply_needed' }
  | {
      kind: 'waiting';
      since: Date;
      sequence: FollowUpSequence | null;
      step: FollowUpStep | null;
      /** Due time of `step`, or the moment the finish rule applies when there is no step left. */
      dueAt: Date | null;
      finishRule: SequenceFinish;
      /** The last message of the current run: what the final wait counts from. */
      lastRunAt: Date;
      /** The due follow-up is a check-in the contact asked for, not a step. */
      checkIn?: boolean;
    };

export function deriveThread(input: DeriveThreadInput): DerivedThread {
  const { thread, campaign, contact, now, messages } = input;
  const goals = [...input.goals].sort((a, b) => a.position - b.position);
  const zone: ZoneContext = { zone: contact.timezone, blackoutDates: new Set(campaign.blackoutDates), calendar: input.calendar };

  const sent: Timed[] = messages
    .filter((message) => message.direction === 'outbound' && message.sentAt)
    .map((message) => ({ message, at: message.sentAt! }))
    .sort((a, b) => ms(a.at) - ms(b.at));
  const inbound: Timed[] = messages
    .filter((message) => message.direction === 'inbound')
    .map((message) => ({ message, at: inboundTime(message) }))
    .sort((a, b) => ms(a.at) - ms(b.at));
  const humanReplies = inbound.filter(({ message }) => message.inboundKind === 'human_reply');
  // Fetches by the sender's own session are ignored everywhere (§9.2).
  const tracking = input.tracking.filter((event) => event.source !== 'sender_self');

  // ── Stage ────────────────────────────────────────────────────────────────────────────────────
  const firstSentAt = sent[0]?.at ?? null;
  let receivedAt = thread.receivedAt;
  if (!receivedAt && firstSentAt) {
    const graceEnds = new Date(ms(firstSentAt) + campaign.deliveryGraceMinutes * MINUTE_MS);
    const bouncedInGrace =
      sent[0]!.message.status === 'bounced' || inbound.some(({ message, at }) => isBounce(message) && ms(at) <= ms(graceEnds));
    receivedAt = earliest([
      ...tracking.map((event) => event.occurredAt),
      inbound.find(({ message }) => !isBounce(message))?.at,
      ms(now) >= ms(graceEnds) && !bouncedInGrace ? graceEnds : null,
    ]);
  }
  const respondedAt = humanReplies[0]?.at ?? null;

  const achievedAtByPosition = new Map<number, Date>();
  for (const achievement of input.achievements) {
    const goal = goals.find((entry) => entry.id === achievement.goalId);
    if (goal) achievedAtByPosition.set(goal.position, achievement.achievedAt);
  }
  const highestGoal = Math.max(0, ...achievedAtByPosition.keys());

  const factRank = highestGoal > 0 ? 3 + highestGoal : respondedAt ? 3 : receivedAt ? 2 : firstSentAt ? 1 : 0;
  const stageRank = Math.min(3 + goals.length, Math.max(factRank, thread.manualFloorRank));
  const stage: ThreadStage =
    stageRank >= 4 ? 'goal_achieved' : (['queued', 'sent', 'received', 'responded'] as const)[stageRank]!;
  const achievedGoalId = stageRank >= 4 ? (goals.find((goal) => goal.position === stageRank - 3)?.id ?? null) : null;

  /** When the thread first reached `rank` or beyond, as far as the facts say. */
  const enteredAt = (rank: number): Date | null => {
    const known: (Date | null | undefined)[] = [];
    for (let r = rank; r <= stageRank; r += 1) {
      known.push(r === 1 ? firstSentAt : r === 2 ? receivedAt : r === 3 ? respondedAt : achievedAtByPosition.get(r - 3));
    }
    return earliest(known);
  };

  // ── Open status ──────────────────────────────────────────────────────────────────────────────
  const humanOpens = tracking.filter((event) => event.type === 'open' && event.source === 'human');
  const humanClick = tracking.some((event) => event.type === 'click' && event.source === 'human');
  let openStatus: OpenStatus;
  if (humanOpens.length > 0 || humanClick || humanReplies.length > 0) openStatus = 'opened';
  else if (tracking.length > 0) openStatus = 'machine_only';
  else if (sent.length > 0 && sent.every(({ message }) => message.tracked === false)) openStatus = 'not_tracked';
  else openStatus = 'unopened';

  // ── Waiting on the contact, and the follow-up that goes with it ────────────────────────────────
  const stageKey = stageKeyForRank(stageRank, goals);
  const wait = analyseWait();

  function analyseWait(): WaitAnalysis {
    if (sent.length === 0 || stageKey === null) return { kind: 'not_started' };

    // The anchor is the last message that isn't a follow-up: every exchange restarts the sequence.
    const conversational = [...sent.filter(({ message }) => message.purpose !== 'follow_up'), ...humanReplies].sort(
      (a, b) => ms(a.at) - ms(b.at),
    );
    const anchor = conversational.at(-1) ?? sent[0]!;
    if (anchor.message.direction === 'inbound') {
      const needsReply = anchor.message.needsReply;
      const threshold = input.needsReplyThreshold ?? DEFAULT_NEEDS_REPLY_THRESHOLD;
      if (needsReply === null || needsReply === undefined || needsReply >= threshold) return { kind: 'reply_needed' };
    }

    // A date the contact asked for wins (§5.10 rule 5): one check-in then, instead of the sequence.
    const checkIn = thread.checkIn;
    if (checkIn && !thread.followUpsStopped && !humanReplies.some(({ message }) => ms(message.createdAt) > ms(checkIn.setAt))) {
      const floors: (Date | null)[] = [checkIn.at, thread.followUpsNotBefore];
      const outOfOffice = inbound.filter(({ message, at }) => message.inboundKind === 'out_of_office' && message.autoReplyUntil && ms(at) > ms(anchor.at)).at(-1);
      if (outOfOffice) {
        const backOn = addBusinessDays(parseIsoDate(outOfOffice.message.autoReplyUntil!), 1, zone.blackoutDates);
        floors.push(zone.calendar.fromLocal({ ...backOn, hour: 0, minute: 0, second: 0 }, zone.zone));
      }
      return { kind: 'waiting', since: anchor.at, sequence: null, step: null, dueAt: latest(floors), finishRule: 'keep_waiting', lastRunAt: anchor.at, checkIn: true };
    }

    const sequence = sequenceForStage(input.sequences, stageKey);

    // A stage change switches sequence, timed from the change. If the same sequence also covered
    // the stage before, it carries on where it was.
    let firstCoveredRank = stageRank;
    while (sequence && firstCoveredRank > 1) {
      const previous = stageKeyForRank(firstCoveredRank - 1, goals);
      if (!previous || !sequence.stages.includes(previous)) break;
      firstCoveredRank -= 1;
    }
    // A stage with no sequence simply waits from the last message.
    const since = sequence ? latest([anchor.at, enteredAt(firstCoveredRank)])! : anchor.at;

    // Steps of this sequence already taken in the current run, by sending or by skipping.
    const taken = [
      ...sent
        .filter(({ message }) => message.purpose === 'follow_up' && message.sequenceId === sequence?.id)
        .map(({ message, at }) => ({ position: message.stepPosition ?? 0, at })),
      ...(input.skippedSteps ?? [])
        .filter((skip) => skip.sequenceId === sequence?.id)
        .map((skip) => ({ position: skip.stepPosition, at: skip.at })),
    ]
      .filter(({ at }) => sequence !== null && ms(at) > ms(anchor.at))
      .sort((a, b) => ms(a.at) - ms(b.at));
    const lastTaken = taken.at(-1) ?? null;
    const lastRunAt = sequence ? latest([since, lastTaken?.at])! : latest([anchor.at, sent.at(-1)!.at])!;
    const nextPosition = Math.max(0, ...taken.map(({ position }) => position)) + 1;
    const step = thread.followUpsStopped ? null : (sequence?.steps.find((entry) => entry.position === nextPosition) ?? null);

    if (!step) {
      // No follow-up left: wait the final wait, then apply the finish rule.
      const finishRule: SequenceFinish = thread.followUpsStopped
        ? 'keep_waiting'
        : (sequence?.finish ?? defaultFinishRule(stageKey!));
      const finalWait: Wait = sequence?.finalWait ?? { amount: campaign.finalWaitBusinessDays, unit: 'business_days' };
      const dueAt = finishRule === 'keep_waiting' ? null : addWait(lastRunAt, finalWait, zone);
      return { kind: 'waiting', since, sequence, step: null, dueAt, finishRule, lastRunAt };
    }

    const goalEventAt =
      step.waitFrom === 'goal_event'
        ? (input.achievements.find((achievement) => `goal:${goals.find((goal) => goal.id === achievement.goalId)?.key}` === stageKey)
            ?.eventAt ?? null)
        : null;
    const floors: (Date | null)[] = [
      addWait(goalEventAt ?? (lastTaken ? lastTaken.at : since), step.wait, zone),
      thread.followUpsNotBefore,
    ];

    // An out-of-office pushes the follow-up to the return date plus one business day.
    const outOfOffice = inbound
      .filter(({ message, at }) => message.inboundKind === 'out_of_office' && message.autoReplyUntil && ms(at) > ms(lastRunAt))
      .at(-1);
    if (outOfOffice) {
      const backOn = addBusinessDays(parseIsoDate(outOfOffice.message.autoReplyUntil!), 1, zone.blackoutDates);
      floors.push(zone.calendar.fromLocal({ ...backOn, hour: 0, minute: 0, second: 0 }, zone.zone));
    }

    // At most 8 automated follow-ups per thread in any 30 days, across all sequences.
    const followUpsSent = sent.filter(({ message }) => message.purpose === 'follow_up');
    if (followUpsSent.length >= MAX_FOLLOW_UPS_PER_30_DAYS) {
      floors.push(new Date(ms(followUpsSent.at(-MAX_FOLLOW_UPS_PER_30_DAYS)!.at) + 30 * DAY_MS));
    }

    return { kind: 'waiting', since, sequence, step, dueAt: latest(floors), finishRule: sequence!.finish, lastRunAt };
  }

  const waitOver = wait.kind === 'waiting' && wait.step === null && wait.dueAt !== null && ms(now) >= ms(wait.dueAt);
  const finishApplied =
    wait.kind === 'waiting' && thread.finishAppliedAt !== null && ms(thread.finishAppliedAt) >= ms(wait.lastRunAt);

  // ── State, in priority order (§5.4) ──────────────────────────────────────────────────────────
  const finalGoalAchieved = goals.length > 0 && highestGoal === goals.at(-1)!.position;
  const closed = thread.closedAt !== null && !humanReplies.some(({ message }) => ms(message.createdAt) > ms(thread.closedAt!));
  const hardBounced =
    contact.hardBounced ||
    messages.some(
      (message) => (message.direction === 'outbound' && message.status === 'bounced') || message.inboundKind === 'bounce_hard',
    );

  let state: ThreadState;
  let stateReason: string | null = null;
  if (thread.stopped || campaign.archived || contact.deleted) {
    state = 'stopped';
    stateReason = thread.stopped ? 'stopped_manually' : campaign.archived ? 'campaign_archived' : 'contact_deleted';
  } else if (contact.unsubscribed) state = 'unsubscribed';
  else if (hardBounced) state = 'bounced';
  else if (contact.doNotContact || contact.suppressed) {
    // Nothing may be sent (§7.2 pre-send guard), so automation stops. It comes back on its own if
    // the block is lifted, because state is derived.
    state = 'stopped';
    stateReason = contact.doNotContact ? 'do_not_contact' : 'suppressed';
  }
  else if (finalGoalAchieved) state = 'completed';
  else if (closed) {
    state = 'closed_lost';
    stateReason = thread.closedReason;
  } else if (thread.paused || thread.aiPaused) {
    state = 'paused';
    stateReason = thread.paused ? 'paused_manually' : 'human_took_over';
  } else if (input.openEscalations > 0) state = 'needs_human';
  else if (messages.some((message) => message.direction === 'outbound' && message.status === 'pending_approval')) {
    state = 'pending_approval';
  } else if (waitOver && wait.kind === 'waiting' && wait.finishRule === 'exhaust') {
    state = 'exhausted';
    stateReason = 'no_reply';
  } else state = 'active';

  // ── Next action (§5.5) ───────────────────────────────────────────────────────────────────────
  let nextAction: NextAction = { type: 'none', at: null, messageId: null };
  let throttleReason: string | null = null;
  let finishDue: DerivedThread['finishDue'] = null;

  if (state === 'active') {
    const scheduled = messages
      .filter((message) => message.direction === 'outbound' && (message.status === 'scheduled' || message.status === 'sending'))
      .sort((a, b) => ms(a.scheduledFor ?? a.createdAt) - ms(b.scheduledFor ?? b.createdAt))[0];
    if (scheduled) {
      const type = scheduled.purpose === 'initial' ? 'send_initial' : scheduled.purpose === 'follow_up' ? 'send_follow_up' : 'send_reply';
      nextAction = { type, at: scheduled.scheduledFor ?? null, messageId: scheduled.id };
    } else if (wait.kind === 'not_started') {
      nextAction = { type: 'send_initial', at: thread.enrolledAt, messageId: null };
    } else if (wait.kind === 'reply_needed') {
      // The AI pipeline is working on it; a draft or an escalation follows.
      nextAction = { type: 'send_reply', at: null, messageId: null };
    } else if (wait.step || wait.checkIn) {
      nextAction = { type: 'send_follow_up', at: wait.dueAt, messageId: null };
    } else {
      if (waitOver && !finishApplied && (wait.finishRule === 'notify_owner' || wait.finishRule === 'close_lost')) {
        finishDue = wait.finishRule;
      }
      nextAction = { type: 'await_reply', at: finishApplied ? null : wait.dueAt, messageId: null };
    }

    // Keep a postponement the scheduler set while the same send is still pending.
    const postponed = thread.postponement;
    if (
      postponed &&
      nextAction.messageId === null &&
      (nextAction.type === 'send_initial' || nextAction.type === 'send_follow_up') &&
      postponed.actionType === nextAction.type &&
      nextAction.at &&
      ms(postponed.until) > ms(nextAction.at)
    ) {
      nextAction = { ...nextAction, at: postponed.until };
      throttleReason = postponed.reason;
    }
  }

  const followUpsSentCount = sent.filter(({ message }) => message.purpose === 'follow_up').length;
  const lastInboundAt = inbound.at(-1)?.at ?? null;
  const lastOutboundAt = sent.at(-1)?.at ?? null;
  const completedAt = finalGoalAchieved ? achievedAtByPosition.get(highestGoal)! : null;

  return {
    stage,
    stageRank,
    achievedGoalId,
    state,
    stateReason,
    nextAction,
    throttleReason,
    followUp: {
      sequenceId: wait.kind === 'waiting' ? (wait.sequence?.id ?? null) : null,
      stepPosition: wait.kind === 'waiting' ? (wait.step?.position ?? null) : null,
      waitingSince: wait.kind === 'waiting' ? wait.since : null,
      checkIn: wait.kind === 'waiting' && wait.checkIn === true,
    },
    finishDue,
    openStatus,
    counters: {
      openCount: humanOpens.length,
      firstOpenedAt: earliest(humanOpens.map((event) => event.occurredAt)),
      lastOpenedAt: latest(humanOpens.map((event) => event.occurredAt)),
      clicked: humanClick,
      followUpsSent: followUpsSentCount,
      aiRepliesSent: sent.filter(({ message }) => message.purpose === 'reply' && message.author === 'ai').length,
    },
    timestamps: {
      firstSentAt,
      receivedAt,
      respondedAt,
      completedAt,
      lastMessageAt: latest([lastInboundAt, lastOutboundAt]),
      lastInboundAt,
      lastOutboundAt,
    },
  };
}
