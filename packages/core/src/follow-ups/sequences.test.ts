import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
  defaultFinishRule,
  defaultSequences,
  sequenceForStage,
  stageKeyForRank,
  validateInitialEmail,
  validateSequences,
  type FollowUpSequence,
  type GoalRef,
} from './sequences.ts';

const goals: GoalRef[] = [
  { id: 'gol_call', key: 'call_booked', name: 'Call booked', position: 1 },
  { id: 'gol_paid', key: 'paid', name: 'Paid', position: 2 },
];
const ids = () => {
  let n = 0;
  return () => `seq_${(n += 1)}`;
};
const defaults = () => defaultSequences(goals, ids());
const sequence = (overrides: Partial<FollowUpSequence> = {}): FollowUpSequence => ({
  id: 'seq_new',
  name: 'Second look',
  stages: ['responded'],
  steps: [{ position: 1, wait: { amount: 2, unit: 'business_days' }, waitFrom: 'last_message', mode: 'template' }],
  finish: 'notify_owner',
  finalWait: { amount: 5, unit: 'business_days' },
  active: true,
  ...overrides,
});
const messages = (issues: ReturnType<typeof validateSequences>) => issues.map((issue) => issue.code);

describe('stage keys', () => {
  it('maps ranks to stages, with goal stages keyed by goal', () => {
    assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map((rank) => stageKeyForRank(rank, goals)), [
      null, 'sent', 'received', 'responded', 'goal:call_booked', 'goal:paid', null,
    ]);
  });

  it('defaults to exhaust before a reply and notify the owner after', () => {
    assert.equal(defaultFinishRule('sent'), 'exhaust');
    assert.equal(defaultFinishRule('received'), 'exhaust');
    assert.equal(defaultFinishRule('responded'), 'notify_owner');
    assert.equal(defaultFinishRule('goal:call_booked'), 'notify_owner');
  });
});

describe('default sequences (§5.10)', () => {
  it('covers Sent and Received, Responded, and Goal 1', () => {
    const sequences = defaults();
    assert.deepEqual(sequences.map((s) => [s.stages, s.steps.length, s.finish]), [
      [['sent', 'received'], 3, 'exhaust'],
      [['responded'], 2, 'notify_owner'],
      [['goal:call_booked'], 2, 'notify_owner'],
    ]);
    assert.deepEqual(sequences[0]!.steps.map((step) => [step.wait.amount, step.wait.unit, step.mode]), [
      [3, 'business_days', 'template'], [4, 'business_days', 'template'], [7, 'business_days', 'template'],
    ]);
    assert.deepEqual(sequences[2]!.steps[0], { position: 1, wait: { amount: 1, unit: 'days' }, waitFrom: 'goal_event', mode: 'ai_adapt' });
  });

  it('is valid as it stands', () => {
    assert.deepEqual(validateSequences(defaults(), goals), []);
  });

  it('has no goal sequence when there is only one goal', () => {
    const single = [goals[0]!];
    const sequences = defaultSequences(single, ids());
    assert.equal(sequences.length, 2);
    assert.deepEqual(validateSequences(sequences, single), []);
  });

  it('finds the sequence for a stage, ignoring inactive ones', () => {
    const sequences = defaults();
    assert.equal(sequenceForStage(sequences, 'received')!.name, 'No reply to the first email');
    assert.equal(sequenceForStage(sequences, 'goal:paid'), null);
    assert.equal(sequenceForStage(sequences, null), null);
    assert.equal(sequenceForStage([{ ...sequences[1]!, active: false }], 'responded'), null);
  });
});

describe('sequence validation (IT-33)', () => {
  it('rejects a second active sequence on a covered stage, naming the stage and the other sequence', () => {
    const issues = validateSequences([...defaults(), sequence()], goals);
    assert.equal(issues.length, 1);
    assert.deepEqual(
      { code: issues[0]!.code, sequenceId: issues[0]!.sequenceId, stage: issues[0]!.stage, otherSequenceId: issues[0]!.otherSequenceId },
      { code: 'stage_already_covered', sequenceId: 'seq_new', stage: 'responded', otherSequenceId: 'seq_2' },
    );
  });

  it('allows the overlap when one of the two is inactive', () => {
    assert.deepEqual(validateSequences([...defaults(), sequence({ active: false })], goals), []);
  });

  it('rejects a 12-hour wait and accepts 24 hours', () => {
    const withWait = (amount: number) =>
      sequence({ steps: [{ position: 1, wait: { amount, unit: 'hours' }, waitFrom: 'last_message', mode: 'template' }] });
    assert.deepEqual(messages(validateSequences([withWait(12)], goals)), ['validation_failed']);
    assert.deepEqual(validateSequences([withWait(24)], goals), []);
  });

  it('rejects the final goal, unknown stages and no stages', () => {
    assert.equal(validateSequences([sequence({ stages: ['goal:paid'] })], goals).length, 1);
    assert.equal(validateSequences([sequence({ stages: ['goal:unknown'] })], goals).length, 1);
    assert.equal(validateSequences([sequence({ stages: [] })], goals).length, 1);
    assert.deepEqual(validateSequences([sequence({ stages: ['goal:call_booked'] })], goals), []);
  });

  it('rejects more than 6 steps, no steps, and gaps in the positions', () => {
    const step = (position: number) => ({ position, wait: { amount: 1, unit: 'days' as const }, waitFrom: 'last_message' as const, mode: 'template' as const });
    assert.equal(validateSequences([sequence({ steps: [1, 2, 3, 4, 5, 6, 7].map(step) })], goals).length, 1);
    assert.equal(validateSequences([sequence({ steps: [] })], goals).length, 1);
    assert.equal(validateSequences([sequence({ steps: [step(1), step(3)] })], goals).length, 1);
    assert.deepEqual(validateSequences([sequence({ steps: [1, 2, 3, 4, 5, 6].map(step) })], goals), []);
  });

  it('allows goal-event timing only in a sequence for exactly one goal stage', () => {
    const fromEvent = { position: 1, wait: { amount: 1, unit: 'days' as const }, waitFrom: 'goal_event' as const, mode: 'ai_adapt' as const };
    assert.deepEqual(validateSequences([sequence({ stages: ['goal:call_booked'], steps: [fromEvent] })], goals), []);
    assert.equal(validateSequences([sequence({ stages: ['responded'], steps: [fromEvent] })], goals).length, 1);
    assert.equal(validateSequences([sequence({ stages: ['responded', 'goal:call_booked'], steps: [fromEvent] })], goals).length, 1);
  });

  it('keeps ai_adapt and waits off the initial email', () => {
    assert.deepEqual(validateInitialEmail({ mode: 'template', wait: { amount: 0, unit: 'business_days' } }), []);
    assert.equal(validateInitialEmail({ mode: 'ai_adapt', wait: { amount: 0, unit: 'business_days' } }).length, 1);
    assert.equal(validateInitialEmail({ mode: 'ai_write', wait: { amount: 1, unit: 'days' } }).length, 1);
  });
});
