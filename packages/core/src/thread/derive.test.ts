import assert from 'node:assert/strict';
import fc from 'fast-check';
import { describe, it } from 'vitest';

import { defaultSequences, type FollowUpSequence, type GoalRef } from '../follow-ups/sequences.ts';
import { intlZoneCalendar as calendar } from '../time/zone.ts';
import type { InboundKind, TrackingSource } from '../types.ts';
import {
  deriveThread,
  type ContactFacts,
  type DeriveThreadInput,
  type MessageFacts,
  type ThreadFacts,
  type TrackingFacts,
} from './derive.ts';

const LA = 'America/Los_Angeles';
/** A wall-clock time in the contact's zone (Los Angeles), 2026. */
const la = (month: number, day: number, hour = 0, minute = 0) =>
  calendar.fromLocal({ year: 2026, month, day, hour, minute, second: 0 }, LA);
const local = (date: Date | null) => {
  assert.ok(date, 'expected a date');
  const l = calendar.toLocal(date, LA);
  return `${l.month}/${l.day} ${String(l.hour).padStart(2, '0')}:${String(l.minute).padStart(2, '0')}`;
};

const goals: GoalRef[] = [
  { id: 'gol_call', key: 'call_booked', name: 'Call booked', position: 1 },
  { id: 'gol_paid', key: 'paid', name: 'Paid', position: 2 },
];
let sequenceCount = 0;
// seq_1 "No reply to the first email" (Sent, Received) · seq_2 Responded · seq_3 Call booked
const sequences = defaultSequences(goals, () => `seq_${(sequenceCount += 1)}`);

const thread = (overrides: Partial<ThreadFacts> = {}): ThreadFacts => ({
  enrolledAt: la(10, 27, 15, 2),
  manualFloorRank: 0,
  receivedAt: null,
  stopped: false,
  paused: false,
  aiPaused: false,
  closedAt: null,
  closedReason: null,
  followUpsStopped: false,
  followUpsNotBefore: null,
  finishAppliedAt: null,
  postponement: null,
  ...overrides,
});
const contact = (overrides: Partial<ContactFacts> = {}): ContactFacts => ({
  unsubscribed: false,
  hardBounced: false,
  deleted: false,
  timezone: LA,
  ...overrides,
});
const campaign = { archived: false, deliveryGraceMinutes: 240, finalWaitBusinessDays: 5, blackoutDates: [] as string[] };

let messageCount = 0;
const outbound = (sentAt: Date, overrides: Partial<MessageFacts> = {}): MessageFacts => ({
  id: `msg_${(messageCount += 1)}`,
  direction: 'outbound',
  status: 'sent',
  author: 'template',
  purpose: 'initial',
  tracked: true,
  sentAt,
  createdAt: sentAt,
  ...overrides,
});
const followUp = (sentAt: Date, sequenceId: string, stepPosition: number, overrides: Partial<MessageFacts> = {}) =>
  outbound(sentAt, { purpose: 'follow_up', sequenceId, stepPosition, ...overrides });
const ourReply = (sentAt: Date, overrides: Partial<MessageFacts> = {}) => outbound(sentAt, { purpose: 'reply', author: 'ai', ...overrides });
const inbound = (receivedAt: Date, kind: InboundKind = 'human_reply', overrides: Partial<MessageFacts> = {}): MessageFacts => ({
  id: `msg_${(messageCount += 1)}`,
  direction: 'inbound',
  status: 'received',
  author: 'contact',
  inboundKind: kind,
  needsReply: kind === 'human_reply' ? 0.95 : null,
  receivedAt,
  createdAt: receivedAt,
  ...overrides,
});
const open = (message: MessageFacts, occurredAt: Date, source: TrackingSource = 'human'): TrackingFacts => ({
  messageId: message.id,
  type: 'open',
  source,
  occurredAt,
});

const derive = (overrides: Partial<DeriveThreadInput> = {}) =>
  deriveThread({
    thread: thread(),
    campaign,
    goals,
    sequences,
    messages: [],
    tracking: [],
    achievements: [],
    openEscalations: 0,
    contact: contact(),
    now: la(10, 28, 10, 0),
    calendar,
    ...overrides,
  });

// The spec's example thread (§22.E): initial email Wed 28 Oct 09:14.
const initial = outbound(la(10, 28, 9, 14));
const followUp1 = followUp(la(11, 2, 9, 31), 'seq_1', 1);
const followUp2 = followUp(la(11, 6, 10, 12), 'seq_1', 2);
const followUp3 = followUp(la(11, 17, 10, 12), 'seq_1', 3);

describe('deriveThread: stage, state and next action (§19.2)', () => {
  it('enrolled: queued, active, initial email next', () => {
    const result = derive();
    assert.deepEqual([result.stage, result.stageRank, result.state], ['queued', 0, 'active']);
    assert.deepEqual(result.nextAction, { type: 'send_initial', at: la(10, 27, 15, 2), messageId: null });
    assert.equal(result.openStatus, 'unopened');
  });

  it('accepted by the SMTP server: sent, with follow-up 1 due after 3 business days', () => {
    const result = derive({ messages: [initial] });
    assert.deepEqual([result.stage, result.state, result.openStatus], ['sent', 'active', 'unopened']);
    assert.equal(result.nextAction.type, 'send_follow_up');
    assert.equal(local(result.nextAction.at), '11/2 09:14');
    assert.deepEqual(result.followUp, { sequenceId: 'seq_1', stepPosition: 1, waitingSince: initial.sentAt, checkIn: false });
    assert.deepEqual(result.timestamps.firstSentAt, initial.sentAt);
  });

  it('grace period over with no bounce: received, and the follow-up timer carries on', () => {
    const result = derive({ messages: [initial], now: la(10, 28, 13, 14) });
    assert.deepEqual([result.stage, result.stageRank], ['received', 2]);
    assert.equal(local(result.timestamps.receivedAt), '10/28 13:14');
    assert.equal(local(result.nextAction.at), '11/2 09:14');
    assert.equal(derive({ messages: [initial], now: la(10, 28, 13, 13) }).stage, 'sent');
  });

  it('privacy-proxy open: received and "opened (auto)"', () => {
    const result = derive({ messages: [initial], tracking: [open(initial, la(10, 28, 9, 16), 'privacy_proxy')] });
    assert.deepEqual([result.stage, result.openStatus], ['received', 'machine_only']);
    assert.equal(result.counters.openCount, 0);
  });

  it("ignores the sender's own opens", () => {
    const result = derive({ messages: [initial], tracking: [open(initial, la(10, 28, 9, 15), 'sender_self')] });
    assert.deepEqual([result.stage, result.openStatus], ['sent', 'unopened']);
  });

  it('human opens: opened, counted, with first and last open times', () => {
    const tracking = [
      open(initial, la(10, 28, 9, 16), 'security_scanner'),
      open(initial, la(10, 28, 9, 40)),
      open(initial, la(10, 29, 8, 0)),
      { ...open(initial, la(10, 29, 8, 1)), type: 'click' as const },
    ];
    const result = derive({ messages: [initial], tracking });
    assert.equal(result.openStatus, 'opened');
    assert.deepEqual([result.counters.openCount, result.counters.clicked], [2, true]);
    assert.equal(local(result.counters.firstOpenedAt), '10/28 09:40');
    assert.equal(local(result.counters.lastOpenedAt), '10/29 08:00');
  });

  it('reports not tracked when tracking was off and nothing proves a read', () => {
    assert.equal(derive({ messages: [outbound(la(10, 28, 9, 14), { tracked: false })] }).openStatus, 'not_tracked');
  });

  it('reply while still Sent: jumps to responded, received and opened are implied', () => {
    const reply = inbound(la(10, 28, 10, 30));
    const result = derive({ messages: [initial, reply], now: la(10, 28, 10, 31) });
    assert.deepEqual([result.stage, result.stageRank, result.openStatus], ['responded', 3, 'opened']);
    assert.deepEqual(result.timestamps.receivedAt, reply.receivedAt);
    assert.deepEqual(result.nextAction, { type: 'send_reply', at: null, messageId: null });
    assert.equal(result.followUp.sequenceId, null);
  });

  it('out-of-office: stays received and postpones to the return date plus one business day', () => {
    const autoReply = inbound(la(10, 28, 9, 20), 'out_of_office', { autoReplyUntil: '2026-11-06' });
    const result = derive({ messages: [initial, autoReply] });
    assert.deepEqual([result.stage, result.state], ['received', 'active']);
    assert.equal(result.nextAction.type, 'send_follow_up');
    assert.equal(local(result.nextAction.at), '11/9 00:00');
  });

  it('other auto-replies never count as a response', () => {
    const result = derive({ messages: [initial, inbound(la(10, 28, 9, 20), 'auto_reply')] });
    assert.equal(result.stage, 'received');
    assert.equal(local(result.nextAction.at), '11/2 09:14');
  });

  it('unsubscribed contact: unsubscribed, nothing next', () => {
    const result = derive({ messages: [initial, inbound(la(10, 28, 11, 0), 'unsubscribe_request')], contact: contact({ unsubscribed: true }) });
    assert.equal(result.state, 'unsubscribed');
    assert.equal(result.nextAction.type, 'none');
  });

  it('payment before the call: final goal achieved, completed', () => {
    const paidAt = la(11, 23, 9, 12);
    const result = derive({ messages: [initial], achievements: [{ goalId: 'gol_paid', achievedAt: paidAt, eventAt: null }], now: la(11, 23, 9, 13) });
    assert.deepEqual([result.stage, result.stageRank, result.achievedGoalId, result.state], ['goal_achieved', 5, 'gol_paid', 'completed']);
    assert.deepEqual(result.timestamps.completedAt, paidAt);
    assert.equal(result.nextAction.type, 'none');
  });

  it('first goal achieved: goal stage, still active', () => {
    const result = derive({
      messages: [initial, inbound(la(11, 3, 9, 0)), ourReply(la(11, 3, 9, 30))],
      achievements: [{ goalId: 'gol_call', achievedAt: la(11, 4, 9, 0), eventAt: null }],
      now: la(11, 4, 9, 1),
    });
    assert.deepEqual([result.stage, result.stageRank, result.achievedGoalId, result.state], ['goal_achieved', 4, 'gol_call', 'active']);
  });

  it('late bounce after a reply: stage kept, state bounced', () => {
    const result = derive({
      messages: [initial, inbound(la(10, 28, 10, 30)), inbound(la(11, 1, 8, 0), 'bounce_hard')],
      now: la(11, 1, 8, 1),
    });
    assert.deepEqual([result.stage, result.state, result.nextAction.type], ['responded', 'bounced', 'none']);
  });

  it('late bounce after delivery was established: stays received', () => {
    const result = derive({
      thread: thread({ receivedAt: la(10, 28, 13, 14) }),
      messages: [initial, inbound(la(10, 30, 8, 0), 'bounce_hard')],
      now: la(10, 30, 8, 1),
    });
    assert.deepEqual([result.stage, result.state], ['received', 'bounced']);
  });

  it('bounce inside the grace period: never received', () => {
    const result = derive({ messages: [initial, inbound(la(10, 28, 9, 20), 'bounce_hard')], now: la(10, 29, 9, 0) });
    assert.deepEqual([result.stage, result.state], ['sent', 'bounced']);
  });

  it('manual floor moves the stage forward without evidence', () => {
    const result = derive({ thread: thread({ manualFloorRank: 3 }), messages: [initial] });
    assert.deepEqual([result.stage, result.stageRank], ['responded', 3]);
    assert.equal(derive({ thread: thread({ manualFloorRank: 9 }), messages: [initial] }).stageRank, 5);
  });

  it('revoked goal: the stage drops to the next highest fact', () => {
    const messages = [initial, inbound(la(11, 3, 9, 0)), ourReply(la(11, 3, 9, 30))];
    assert.equal(derive({ messages, achievements: [{ goalId: 'gol_call', achievedAt: la(11, 4, 9, 0), eventAt: null }] }).stageRank, 4);
    assert.deepEqual([derive({ messages }).stage, derive({ messages }).achievedGoalId], ['responded', null]);
  });

  it('open escalation: needs human, next action held', () => {
    const result = derive({ messages: [initial, inbound(la(10, 28, 10, 30))], openEscalations: 1 });
    assert.deepEqual([result.state, result.nextAction.type], ['needs_human', 'none']);
  });

  it('operator replied outside Catalyst: paused', () => {
    const result = derive({
      thread: thread({ aiPaused: true }),
      messages: [initial, inbound(la(10, 28, 10, 30)), ourReply(la(10, 28, 11, 0), { author: 'human_external' })],
    });
    assert.deepEqual([result.state, result.stateReason, result.nextAction.type], ['paused', 'human_took_over', 'none']);
    assert.equal(result.counters.aiRepliesSent, 0);
  });

  it('draft waiting for approval: pending approval, held', () => {
    const draft = ourReply(la(10, 28, 11, 0), { status: 'pending_approval', sentAt: null });
    const result = derive({ messages: [initial, inbound(la(10, 28, 10, 30)), draft] });
    assert.deepEqual([result.state, result.nextAction.type], ['pending_approval', 'none']);
  });

  it('scheduled message: the next action is that message at its time', () => {
    const scheduled = ourReply(la(10, 28, 11, 5), { status: 'scheduled', sentAt: null, scheduledFor: la(10, 28, 11, 5) });
    const result = derive({ messages: [initial, inbound(la(10, 28, 10, 42)), scheduled] });
    assert.deepEqual(result.nextAction, { type: 'send_reply', at: la(10, 28, 11, 5), messageId: scheduled.id });
  });

  it('applies the state priority order', () => {
    const everything = {
      thread: thread({ stopped: true, paused: true, closedAt: la(10, 28, 12, 0), closedReason: 'manual' }),
      messages: [initial, inbound(la(10, 28, 9, 20), 'bounce_hard')],
      achievements: [{ goalId: 'gol_paid', achievedAt: la(10, 28, 9, 30), eventAt: null }],
      openEscalations: 2,
      contact: contact({ unsubscribed: true }),
    };
    assert.equal(derive(everything).state, 'stopped');
    assert.equal(derive({ ...everything, thread: thread({ paused: true, closedAt: la(10, 28, 12, 0) }) }).state, 'unsubscribed');
    assert.equal(derive({ ...everything, thread: thread({ paused: true }), contact: contact() }).state, 'bounced');
    assert.equal(derive({ ...everything, thread: thread({ paused: true }), contact: contact(), messages: [initial] }).state, 'completed');
    assert.equal(derive({ campaign: { ...campaign, archived: true }, messages: [initial] }).stateReason, 'campaign_archived');
    assert.equal(derive({ contact: contact({ deleted: true }) }).state, 'stopped');
  });

  it('stops a thread whose contact is suppressed or marked do-not-contact, below unsubscribed and bounced', () => {
    const suppressed = derive({ messages: [initial], contact: contact({ suppressed: true }) });
    assert.deepEqual([suppressed.state, suppressed.stateReason, suppressed.nextAction.type], ['stopped', 'suppressed', 'none']);
    assert.equal(derive({ contact: contact({ doNotContact: true, suppressed: true }) }).stateReason, 'do_not_contact');
    assert.equal(derive({ contact: contact({ suppressed: true, unsubscribed: true }) }).state, 'unsubscribed');
    assert.equal(derive({ messages: [initial, inbound(la(10, 28, 9, 20), 'bounce_hard')], contact: contact({ suppressed: true }) }).state, 'bounced');
    // Lifting the block lets automation carry on, because state is derived.
    assert.equal(derive({ messages: [initial], contact: contact() }).state, 'active');
  });

  it('is deterministic, and stable once its own results are stored', () => {
    const input = { messages: [initial, followUp1], tracking: [open(initial, la(10, 28, 9, 40))], now: la(11, 3, 9, 0) };
    const first = derive(input);
    assert.deepEqual(derive(input), first);
    assert.deepEqual(derive({ ...input, thread: thread({ receivedAt: first.timestamps.receivedAt }) }), first);
  });
});

describe('deriveThread: reopening a closed thread (§5.4)', () => {
  const closedAt = la(11, 3, 12, 0);
  const closed = thread({ closedAt, closedReason: 'not_interested' });
  const messages = [initial, inbound(la(11, 3, 11, 0), 'human_reply', { needsReply: 0.1 })];

  it('stays closed with no new reply', () => {
    const result = derive({ thread: closed, messages, now: la(11, 4, 9, 0) });
    assert.deepEqual([result.state, result.stateReason, result.nextAction.type], ['closed_lost', 'not_interested', 'none']);
  });

  it('a human reply after the close reopens it as needs human, once the escalation is raised', () => {
    const reply = inbound(la(11, 10, 9, 0));
    assert.equal(derive({ thread: closed, messages: [...messages, reply], openEscalations: 1, now: la(11, 10, 9, 1) }).state, 'needs_human');
    // After the person dismisses the escalation, the agent carries on.
    const dismissed = derive({ thread: closed, messages: [...messages, reply], now: la(11, 10, 9, 1) });
    assert.deepEqual([dismissed.state, dismissed.nextAction.type], ['active', 'send_reply']);
  });

  it('an auto-reply or out-of-office does not reopen it', () => {
    const autos = [inbound(la(11, 10, 9, 0), 'auto_reply'), inbound(la(11, 10, 9, 5), 'out_of_office', { autoReplyUntil: '2026-11-20' })];
    assert.equal(derive({ thread: closed, messages: [...messages, ...autos], now: la(11, 10, 10, 0) }).state, 'closed_lost');
  });

  it('a reply stored after the close but dated before it still reopens', () => {
    const lateIngest = inbound(la(11, 3, 11, 50), 'human_reply', { createdAt: la(11, 3, 12, 15) });
    assert.equal(derive({ thread: closed, messages: [...messages, lateIngest], now: la(11, 3, 12, 16) }).state, 'active');
  });

  it('closing again after the reply closes it again', () => {
    const reclosed = thread({ closedAt: la(11, 10, 10, 0), closedReason: 'manual' });
    const result = derive({ thread: reclosed, messages: [...messages, inbound(la(11, 10, 9, 0))], now: la(11, 10, 10, 1) });
    assert.deepEqual([result.state, result.stateReason], ['closed_lost', 'manual']);
  });
});

describe('deriveThread: follow-up sequences (§5.10)', () => {
  it('runs the no-reply sequence at +3, +4 and +7 business days, then exhausts (IT-30)', () => {
    const afterOne = derive({ messages: [initial, followUp1], now: la(11, 2, 9, 32) });
    assert.deepEqual([afterOne.followUp.stepPosition, local(afterOne.nextAction.at)], [2, '11/6 09:31']);

    const afterTwo = derive({ messages: [initial, followUp1, followUp2], now: la(11, 6, 10, 13) });
    assert.deepEqual([afterTwo.followUp.stepPosition, local(afterTwo.nextAction.at)], [3, '11/17 10:12']);

    const all = [initial, followUp1, followUp2, followUp3];
    const waiting = derive({ messages: all, now: la(11, 17, 10, 13) });
    assert.deepEqual([waiting.state, waiting.nextAction.type, local(waiting.nextAction.at)], ['active', 'await_reply', '11/24 10:12']);
    assert.deepEqual(waiting.followUp, { sequenceId: 'seq_1', stepPosition: null, waitingSince: initial.sentAt, checkIn: false });
    assert.equal(waiting.counters.followUpsSent, 3);

    const exhausted = derive({ messages: all, now: la(11, 24, 10, 12) });
    assert.deepEqual([exhausted.state, exhausted.stateReason, exhausted.nextAction.type, exhausted.finishDue], ['exhausted', 'no_reply', 'none', null]);
    assert.equal(exhausted.stage, 'received');
  });

  it('reopens an exhausted thread when the contact replies', () => {
    const result = derive({ messages: [initial, followUp1, followUp2, followUp3, inbound(la(12, 1, 9, 0))], now: la(12, 1, 9, 1) });
    assert.deepEqual([result.stage, result.state, result.nextAction.type], ['responded', 'active', 'send_reply']);
  });

  it('a reply cancels the no-reply sequence; after our answer the Responded sequence starts at step 1 (IT-31)', () => {
    const reply = inbound(la(11, 3, 9, 52));
    const answer = ourReply(la(11, 3, 11, 20));
    const quiet = derive({ messages: [initial, followUp1, reply, answer], now: la(11, 3, 11, 21) });
    assert.deepEqual(quiet.followUp, { sequenceId: 'seq_2', stepPosition: 1, waitingSince: answer.sentAt, checkIn: false });
    assert.equal(local(quiet.nextAction.at), '11/5 11:20');
    assert.equal(quiet.counters.aiRepliesSent, 1);

    const step1 = followUp(la(11, 5, 11, 25), 'seq_2', 1, { author: 'ai' });
    const afterStep1 = derive({ messages: [initial, followUp1, reply, answer, step1], now: la(11, 5, 11, 26) });
    assert.deepEqual([afterStep1.followUp.stepPosition, local(afterStep1.nextAction.at)], [2, '11/12 11:25']);

    const step2 = followUp(la(11, 12, 11, 25), 'seq_2', 2, { author: 'ai' });
    const done = [initial, followUp1, reply, answer, step1, step2];
    const finalWait = derive({ messages: done, now: la(11, 12, 11, 26) });
    assert.deepEqual([finalWait.nextAction.type, local(finalWait.nextAction.at), finalWait.finishDue], ['await_reply', '11/19 11:25', null]);

    const wentQuiet = derive({ messages: done, now: la(11, 19, 11, 25) });
    assert.deepEqual([wentQuiet.state, wentQuiet.finishDue], ['active', 'notify_owner']);

    // Once the escalation has been raised and later dismissed, it isn't raised again.
    const applied = derive({ thread: thread({ finishAppliedAt: la(11, 19, 11, 26) }), messages: done, now: la(11, 25, 9, 0) });
    assert.deepEqual([applied.state, applied.finishDue, applied.nextAction], ['active', null, { type: 'await_reply', at: null, messageId: null }]);
  });

  it('a reply that needs no answer counts as waiting on the contact (IT-25)', () => {
    const thanks = inbound(la(11, 3, 10, 0), 'human_reply', { needsReply: 0.1 });
    const result = derive({ messages: [initial, followUp1, thanks], now: la(11, 3, 10, 1) });
    assert.deepEqual([result.stage, result.state, result.nextAction.type], ['responded', 'active', 'send_follow_up']);
    assert.deepEqual(result.followUp, { sequenceId: 'seq_2', stepPosition: 1, waitingSince: thanks.receivedAt, checkIn: false });
    assert.equal(local(result.nextAction.at), '11/5 10:00');
  });

  it('a check-in the contact asked for replaces the sequence; a new reply cancels it (§5.10 rule 5)', () => {
    // "Not now, try in December": we answered, and a check-in was set for 1 December.
    const notNow = inbound(la(11, 2, 11, 0));
    const answer = ourReply(la(11, 2, 14, 0));
    const checkIn = { at: la(12, 1), setAt: la(11, 2, 12, 0) };
    const waiting = derive({ thread: thread({ checkIn }), messages: [initial, notNow, answer], now: la(11, 3, 10, 0) });
    assert.equal(waiting.state, 'active');
    assert.deepEqual(waiting.nextAction, { type: 'send_follow_up', at: la(12, 1), messageId: null });
    assert.deepEqual(waiting.followUp, { sequenceId: null, stepPosition: null, waitingSince: answer.sentAt, checkIn: true });

    // Overdue but not yet written: it stays due; nothing exhausts or notifies meanwhile.
    const overdue = derive({ thread: thread({ checkIn }), messages: [initial, notNow, answer], now: la(12, 20) });
    assert.deepEqual([overdue.state, overdue.nextAction.type, overdue.finishDue], ['active', 'send_follow_up', null]);
    // An out-of-office after it pushes it back.
    const away = inbound(la(11, 25, 8, 0), 'out_of_office', { autoReplyUntil: '2026-12-04' });
    assert.equal(local(derive({ thread: thread({ checkIn }), messages: [initial, notNow, answer, away], now: la(11, 26) }).nextAction.at), '12/7 00:00');

    // A reply after it was set cancels it.
    const again = inbound(la(11, 20, 9, 0));
    assert.equal(derive({ thread: thread({ checkIn }), messages: [initial, notNow, answer, again], now: la(11, 20, 10, 0) }).nextAction.type, 'send_reply');
    // Stopped follow-ups stop it too.
    assert.deepEqual(derive({ thread: thread({ checkIn, followUpsStopped: true }), messages: [initial, notNow, answer], now: la(11, 3) }).nextAction, { type: 'await_reply', at: null, messageId: null });

    // Once written (the composer clears it) and sent, the stage's sequence restarts at step 1 from it.
    const sentCheckIn = ourReply(la(12, 1, 9, 0));
    const after = derive({ messages: [initial, notNow, answer, sentCheckIn], now: la(12, 1, 10, 0) });
    assert.deepEqual(after.followUp, { sequenceId: 'seq_2', stepPosition: 1, waitingSince: sentCheckIn.sentAt, checkIn: false });
  });

  it('treats an unclassified reply as needing one, and honours the threshold edge', () => {
    const at = la(11, 3, 10, 0);
    assert.equal(derive({ messages: [initial, inbound(at, 'human_reply', { needsReply: null })] }).nextAction.type, 'send_reply');
    assert.equal(derive({ messages: [initial, inbound(at, 'human_reply', { needsReply: 0.3 })] }).nextAction.type, 'send_reply');
    assert.equal(derive({ messages: [initial, inbound(at, 'human_reply', { needsReply: 0.29 })] }).nextAction.type, 'send_follow_up');
  });

  it('a booking switches to the goal sequence, timed from the call itself (IT-32)', () => {
    const reply = inbound(la(11, 10, 9, 52));
    const answer = ourReply(la(11, 10, 11, 20));
    const booking = { goalId: 'gol_call', achievedAt: la(11, 12, 9, 5), eventAt: la(11, 19, 14, 0) };
    const booked = derive({ messages: [initial, reply, answer], achievements: [booking], now: la(11, 12, 9, 6) });
    assert.deepEqual([booked.stage, booked.achievedGoalId], ['goal_achieved', 'gol_call']);
    assert.deepEqual([booked.followUp.sequenceId, booked.followUp.stepPosition], ['seq_3', 1]);
    assert.equal(local(booked.nextAction.at), '11/20 14:00');

    // With no event time, step 1 counts from the stage change instead.
    const noEventTime = derive({ messages: [initial, reply, answer], achievements: [{ ...booking, eventAt: null }], now: la(11, 12, 9, 6) });
    assert.equal(local(noEventTime.nextAction.at), '11/13 09:05');

    // Step 2 counts from the first follow-up, as in the spec example (§22.E).
    const recap = followUp(la(11, 20, 14, 6), 'seq_3', 1, { author: 'ai' });
    const afterRecap = derive({ messages: [initial, reply, answer, recap], achievements: [booking], now: la(11, 20, 14, 7) });
    assert.deepEqual([afterRecap.followUp.stepPosition, local(afterRecap.nextAction.at)], [2, '11/26 14:06']);
  });

  it('starts a different sequence from the stage change, not from the last message', () => {
    const split: FollowUpSequence[] = [
      { ...sequences[0]!, id: 'seq_sent', stages: ['sent'] },
      { ...sequences[0]!, id: 'seq_received', stages: ['received'] },
    ];
    const before = derive({ sequences: split, messages: [initial], now: la(10, 28, 9, 59) });
    assert.deepEqual([before.followUp.sequenceId, local(before.nextAction.at)], ['seq_sent', '11/2 09:14']);

    // An open inside the grace period moves the thread to Received at 10:00.
    const firstOpen = open(initial, la(10, 28, 10, 0));
    const result = derive({ sequences: split, messages: [initial], tracking: [firstOpen], now: la(10, 28, 10, 1) });
    assert.deepEqual([result.followUp.sequenceId, result.followUp.stepPosition], ['seq_received', 1]);
    assert.equal(local(result.nextAction.at), '11/2 10:00');
  });

  it('holds while paused, then schedules exactly one follow-up from the resume (IT-34)', () => {
    const paused = derive({ thread: thread({ paused: true }), messages: [initial], now: la(11, 12, 9, 0) });
    assert.deepEqual([paused.state, paused.nextAction.type], ['paused', 'none']);

    const resumedAt = la(11, 12, 10, 0);
    const resumed = derive({ thread: thread({ followUpsNotBefore: resumedAt }), messages: [initial], now: la(11, 12, 10, 1) });
    assert.deepEqual([resumed.state, resumed.followUp.stepPosition], ['active', 1]);
    assert.deepEqual(resumed.nextAction, { type: 'send_follow_up', at: resumedAt, messageId: null });
  });

  it('waits the campaign final wait at a stage with no sequence, then applies the stage default', () => {
    const noSequences = derive({ sequences: [], messages: [initial], now: la(10, 28, 9, 15) });
    assert.deepEqual([noSequences.nextAction.type, local(noSequences.nextAction.at)], ['await_reply', '11/4 09:14']);
    assert.equal(derive({ sequences: [], messages: [initial], now: la(11, 4, 9, 14) }).state, 'exhausted');

    const quietAfterReply = [initial, inbound(la(10, 29, 9, 0)), ourReply(la(10, 29, 9, 30))];
    const result = derive({ sequences: [], messages: quietAfterReply, now: la(11, 5, 9, 30) });
    assert.deepEqual([result.state, result.finishDue], ['active', 'notify_owner']);
  });

  it('supports the close_lost and keep_waiting finish rules', () => {
    const withFinish = (finish: FollowUpSequence['finish']): FollowUpSequence[] => [{ ...sequences[0]!, finish }];
    const all = [initial, followUp1, followUp2, followUp3];
    assert.equal(derive({ sequences: withFinish('close_lost'), messages: all, now: la(11, 24, 10, 12) }).finishDue, 'close_lost');
    const keepWaiting = derive({ sequences: withFinish('keep_waiting'), messages: all, now: la(12, 24, 10, 12) });
    assert.deepEqual([keepWaiting.state, keepWaiting.finishDue, keepWaiting.nextAction], ['active', null, { type: 'await_reply', at: null, messageId: null }]);
  });

  it('moves to the next step when a person skips one', () => {
    const skippedSteps = [{ sequenceId: 'seq_1', stepPosition: 1, at: la(10, 30, 9, 0) }];
    const result = derive({ messages: [initial], skippedSteps, now: la(10, 30, 9, 1) });
    assert.deepEqual([result.followUp.stepPosition, local(result.nextAction.at)], [2, '11/5 09:00']);
    assert.equal(result.counters.followUpsSent, 0);
  });

  it('sends nothing more once a person stops follow-ups', () => {
    const result = derive({ thread: thread({ followUpsStopped: true }), messages: [initial], now: la(12, 28, 9, 0) });
    assert.deepEqual([result.state, result.nextAction], ['active', { type: 'await_reply', at: null, messageId: null }]);
  });

  it('never allows more than 8 automated follow-ups in 30 days', () => {
    const earlier = Array.from({ length: 8 }, (_, i) => followUp(la(11, 2 + i, 9, 0), 'seq_other', i + 1));
    const result = derive({ messages: [initial, ...earlier], now: la(11, 10, 9, 0) });
    assert.equal(result.nextAction.type, 'send_follow_up');
    assert.deepEqual(result.nextAction.at, new Date(la(11, 2, 9, 0).getTime() + 30 * 86_400_000));
    assert.equal(derive({ messages: [initial, ...earlier.slice(1)], now: la(11, 10, 9, 0) }).nextAction.at!.getTime(), la(11, 2, 9, 14).getTime());
  });

  it('skips blackout dates when counting business days', () => {
    const result = derive({ campaign: { ...campaign, blackoutDates: ['2026-10-30'] }, messages: [initial] });
    assert.equal(local(result.nextAction.at), '11/3 09:14');
  });

  it('keeps a postponement set by the scheduler while the same send is pending', () => {
    const until = la(11, 3, 8, 47);
    const postponed = derive({ thread: thread({ postponement: { actionType: 'send_follow_up', until, reason: 'domain_ramp' } }), messages: [initial] });
    assert.deepEqual([postponed.nextAction.at, postponed.throttleReason], [until, 'domain_ramp']);

    const stale = derive({ thread: thread({ postponement: { actionType: 'send_initial', until, reason: 'window' } }), messages: [initial] });
    assert.deepEqual([local(stale.nextAction.at), stale.throttleReason], ['11/2 09:14', null]);

    const early = derive({ thread: thread({ postponement: { actionType: 'send_follow_up', until: la(10, 29, 9, 0), reason: 'window' } }), messages: [initial] });
    assert.deepEqual([local(early.nextAction.at), early.throttleReason], ['11/2 09:14', null]);
  });
});

describe('deriveThread: properties over random histories (§19.3)', () => {
  const HELD_OR_TERMINAL = ['stopped', 'unsubscribed', 'bounced', 'completed', 'closed_lost', 'exhausted', 'paused', 'needs_human', 'pending_approval'];
  const kinds: InboundKind[] = ['human_reply', 'auto_reply', 'out_of_office', 'bounce_hard', 'bounce_soft', 'unsubscribe_request', 'unknown'];
  const sources: TrackingSource[] = ['human', 'privacy_proxy', 'security_scanner', 'sender_self', 'unknown'];
  const event = fc.record({
    kind: fc.nat({ max: 9 }),
    minutes: fc.integer({ min: 1, max: 600 }),
    pick: fc.nat({ max: 1000 }),
    flag: fc.boolean(),
  });

  it('never lowers the stage, never plans a send it must not, and is idempotent (properties 1, 4, 5, 9)', () => {
    fc.assert(
      fc.property(fc.array(event, { minLength: 1, maxLength: 40 }), (events) => {
        let clock = la(10, 28, 9, 14).getTime();
        const messages: MessageFacts[] = [];
        const tracking: TrackingFacts[] = [];
        const achievements: DeriveThreadInput['achievements'][number][] = [];
        let facts = thread();
        let person = contact();
        let openEscalations = 0;
        let previousRank = 0;

        for (const { kind, minutes, pick, flag } of events) {
          clock += minutes * 60_000;
          const at = new Date(clock);
          const lastSent = messages.findLast((message) => message.direction === 'outbound' && message.sentAt);
          switch (kind) {
            case 0:
              if (!lastSent) messages.push(outbound(at));
              else messages.push(flag ? followUp(at, 'seq_1', 1 + (pick % 3)) : ourReply(at));
              break;
            case 1:
              if (lastSent) tracking.push(open(lastSent, at, sources[pick % sources.length]!));
              break;
            case 2:
            case 3:
              if (lastSent) messages.push(inbound(at, kinds[pick % kinds.length]!, { needsReply: (pick % 101) / 100 }));
              break;
            case 4:
              if (lastSent && achievements.length < goals.length) {
                achievements.push({ goalId: goals[achievements.length]!.id, achievedAt: at, eventAt: flag ? new Date(clock + 86_400_000) : null });
              }
              break;
            case 5:
              openEscalations = flag ? 1 : 0;
              break;
            case 6:
              facts = { ...facts, paused: flag, closedAt: pick % 4 === 0 ? at : facts.closedAt };
              break;
            case 7:
              person = { ...person, unsubscribed: person.unsubscribed || pick % 16 === 0 };
              break;
            default:
              clock += (pick % 21) * 86_400_000; // a long quiet spell
          }

          const input = { thread: facts, messages, tracking, achievements, openEscalations, contact: person, now: new Date(clock) };
          const result = derive(input);
          assert.deepEqual(derive(input), result, 'deterministic');

          // 1. The stage never goes backwards on its own.
          assert.ok(result.stageRank >= previousRank, `stage rank fell from ${previousRank} to ${result.stageRank}`);
          previousRank = result.stageRank;
          assert.equal(result.stage === 'goal_achieved', result.achievedGoalId !== null);

          // 4. Held and terminal states never produce a send.
          if (HELD_OR_TERMINAL.includes(result.state)) assert.equal(result.nextAction.type, 'none');
          if (person.unsubscribed) assert.equal(result.nextAction.type, 'none');

          // 9. No follow-up while the contact is owed a reply, and never a ninth in 30 days.
          const conversation = messages
            .filter((m) => (m.direction === 'outbound' ? m.sentAt && m.purpose !== 'follow_up' : m.inboundKind === 'human_reply'))
            .sort((a, b) => (a.sentAt ?? a.receivedAt!).getTime() - (b.sentAt ?? b.receivedAt!).getTime());
          const last = conversation.at(-1);
          if (last?.direction === 'inbound' && (last.needsReply ?? 1) >= 0.3) {
            assert.notEqual(result.nextAction.type, 'send_follow_up');
          }
          if (result.nextAction.type === 'send_follow_up') {
            assert.ok(result.followUp.stepPosition !== null);
            const due = result.nextAction.at!.getTime();
            const recent = messages.filter((m) => m.purpose === 'follow_up' && m.sentAt && m.sentAt.getTime() > due - 30 * 86_400_000);
            assert.ok(recent.length < 8, `${recent.length} follow-ups already inside the 30 days before the next one`);
          }

          // 5. The worker stores what it derived; a second evaluation must change nothing.
          facts = { ...facts, receivedAt: result.timestamps.receivedAt };
          assert.deepEqual(derive({ ...input, thread: facts }), result, 'idempotent');
        }
      }),
      { numRuns: 300 },
    );
  });
});
