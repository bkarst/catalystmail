// Follow-up sequences (§5.10): which sequence applies to a stage, the rules a sequence must meet
// to be saved, and the sequences a new campaign starts with.

import { isWaitAtLeast24Hours } from '../time/schedule.ts';
import type { SequenceFinish, StepMode, Wait } from '../types.ts';

/** A stage a sequence can cover. Goal stages are keyed by the goal's `key`. */
export type StageKey = 'sent' | 'received' | 'responded' | `goal:${string}`;

export interface GoalRef {
  id: string;
  key: string;
  name: string;
  /** 1..N; the highest position is the final goal. */
  position: number;
}

export interface FollowUpStep {
  /** 1..6 within its sequence. */
  position: number;
  wait: Wait;
  /** `goal_event` counts from the goal's event time, such as the start of a booked call. */
  waitFrom: 'last_message' | 'goal_event';
  mode: StepMode;
}

export interface FollowUpSequence {
  id: string;
  name: string;
  stages: readonly StageKey[];
  steps: readonly FollowUpStep[];
  finish: SequenceFinish;
  finalWait: Wait;
  active: boolean;
}

export const MAX_STEPS_PER_SEQUENCE = 6;
export const MAX_FOLLOW_UPS_PER_30_DAYS = 8;
export const DEFAULT_FINAL_WAIT: Wait = { amount: 5, unit: 'business_days' };

/** The stage key for a stage rank: 1 sent, 2 received, 3 responded, 3 + k goal k. Null when queued. */
export function stageKeyForRank(rank: number, goals: readonly GoalRef[]): StageKey | null {
  if (rank <= 0) return null;
  if (rank === 1) return 'sent';
  if (rank === 2) return 'received';
  if (rank === 3) return 'responded';
  const goal = goals.find((entry) => entry.position === rank - 3);
  return goal ? `goal:${goal.key}` : null;
}

/** The active sequence covering a stage. At most one can, which `validateSequences` enforces. */
export function sequenceForStage(sequences: readonly FollowUpSequence[], stage: StageKey | null): FollowUpSequence | null {
  if (stage === null) return null;
  return sequences.find((sequence) => sequence.active && sequence.stages.includes(stage)) ?? null;
}

/** What happens after the final wait at a stage that has no sequence. */
export function defaultFinishRule(stage: StageKey): SequenceFinish {
  return stage === 'sent' || stage === 'received' ? 'exhaust' : 'notify_owner';
}

export interface SequenceIssue {
  /** Matches the API problem codes (§22.D). */
  code: 'stage_already_covered' | 'validation_failed';
  sequenceId: string;
  message: string;
  stage?: StageKey;
  otherSequenceId?: string;
}

/** Every rule a campaign's follow-up sequences must meet to be saved or launched (§5.10, §8.11). */
export function validateSequences(sequences: readonly FollowUpSequence[], goals: readonly GoalRef[]): SequenceIssue[] {
  const issues: SequenceIssue[] = [];
  const finalGoal = [...goals].sort((a, b) => b.position - a.position)[0];
  const coveredBy = new Map<StageKey, FollowUpSequence>();

  for (const sequence of sequences) {
    const fail = (message: string) => issues.push({ code: 'validation_failed', sequenceId: sequence.id, message });

    if (sequence.stages.length === 0) fail('A sequence must apply to at least one stage.');
    for (const stage of sequence.stages) {
      if (stage.startsWith('goal:')) {
        const goal = goals.find((entry) => `goal:${entry.key}` === stage);
        if (!goal) fail(`Unknown goal stage "${stage}".`);
        else if (goal.id === finalGoal?.id) {
          fail(`"${goal.name}" is the final goal. Achieving it completes the conversation, so no follow-ups run after it.`);
        }
      } else if (stage !== 'sent' && stage !== 'received' && stage !== 'responded') {
        fail(`Unknown stage "${stage}".`);
      }
      if (!sequence.active) continue;
      const other = coveredBy.get(stage);
      if (other) {
        issues.push({
          code: 'stage_already_covered',
          sequenceId: sequence.id,
          stage,
          otherSequenceId: other.id,
          message: `Stage "${stage}" is already covered by the sequence "${other.name}".`,
        });
      } else {
        coveredBy.set(stage, sequence);
      }
    }

    if (sequence.steps.length < 1 || sequence.steps.length > MAX_STEPS_PER_SEQUENCE) {
      fail(`A sequence has 1 to ${MAX_STEPS_PER_SEQUENCE} steps; this one has ${sequence.steps.length}.`);
    }
    const positions = sequence.steps.map((step) => step.position).sort((a, b) => a - b);
    if (positions.some((position, index) => position !== index + 1)) fail('Step positions must run 1, 2, 3 … without gaps.');

    const singleGoalStage = sequence.stages.length === 1 && sequence.stages[0]!.startsWith('goal:');
    for (const step of sequence.steps) {
      if (!Number.isInteger(step.wait.amount) || !isWaitAtLeast24Hours(step.wait)) {
        fail(`Step ${step.position}: the wait must be a whole number and at least 24 hours.`);
      }
      if (step.waitFrom === 'goal_event' && !singleGoalStage) {
        fail(`Step ${step.position}: counting from the goal's event time needs a sequence that covers exactly one goal stage.`);
      }
    }
    if (!Number.isInteger(sequence.finalWait.amount) || sequence.finalWait.amount < 0) fail('The final wait must be a whole number.');
  }
  return issues;
}

/** The initial email is sent with no wait, and `ai_adapt` has no conversation to adapt to yet. */
export function validateInitialEmail(step: { mode: StepMode; wait: Wait }): string[] {
  const errors: string[] = [];
  if (step.wait.amount !== 0) errors.push('The initial email has no wait.');
  if (step.mode === 'ai_adapt') errors.push('"AI adapts" is not available for the initial email.');
  return errors;
}

/** The sequences a new campaign starts with (§5.10). All are editable afterwards. */
export function defaultSequences(goals: readonly GoalRef[], newId: () => string): FollowUpSequence[] {
  const businessDays = (amount: number): Wait => ({ amount, unit: 'business_days' });
  const steps = (mode: StepMode, ...waits: Wait[]): FollowUpStep[] =>
    waits.map((wait, index) => ({ position: index + 1, wait, waitFrom: 'last_message', mode }));

  const sequences: FollowUpSequence[] = [
    {
      id: newId(),
      name: 'No reply to the first email',
      stages: ['sent', 'received'],
      steps: steps('template', businessDays(3), businessDays(4), businessDays(7)),
      finish: 'exhaust',
      finalWait: DEFAULT_FINAL_WAIT,
      active: true,
    },
    {
      id: newId(),
      name: 'Went quiet after replying',
      stages: ['responded'],
      steps: steps('ai_adapt', businessDays(2), businessDays(5)),
      finish: 'notify_owner',
      finalWait: DEFAULT_FINAL_WAIT,
      active: true,
    },
  ];

  // Goal 1 gets a sequence only when another goal follows it.
  const ordered = [...goals].sort((a, b) => a.position - b.position);
  const [first, next] = ordered;
  if (first && next) {
    sequences.push({
      id: newId(),
      name: `${first.name}, not yet ${next.name.toLowerCase()}`,
      stages: [`goal:${first.key}`],
      steps: [
        { position: 1, wait: { amount: 1, unit: 'days' }, waitFrom: 'goal_event', mode: 'ai_adapt' },
        { position: 2, wait: businessDays(4), waitFrom: 'last_message', mode: 'ai_adapt' },
      ],
      finish: 'notify_owner',
      finalWait: DEFAULT_FINAL_WAIT,
      active: true,
    });
  }
  return sequences;
}
