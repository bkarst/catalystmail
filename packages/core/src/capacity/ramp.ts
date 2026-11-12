// Domain ramp plans and how the ramp follows reputation (§8.3.1, §8.3.2, §8.3.6).
// The same movement rules drive mailbox warm-up, using the mailbox's health band.

import type { Band } from '../types.ts';

export type RampPlan = 'new_domain' | 'aged_domain' | 'established' | 'custom';
export type RampStatus = 'ramping' | 'holding' | 'stepped_back' | 'complete' | 'stopped';
export type RampAction = 'advanced' | 'held' | 'stepped_back' | 'stopped' | 'none';

export interface RampScheduleEntry {
  step: number;
  cap: number;
}

const GEOMETRIC_PLANS = {
  new_domain: { start: 20, ratePercent: 15 },
  aged_domain: { start: 40, ratePercent: 20 },
} as const;

/** round(start × (1 + rate)^step), in exact integer arithmetic. */
function geometricCap(start: number, ratePercent: number, step: number): number {
  const numerator = BigInt(start) * BigInt(100 + ratePercent) ** BigInt(step);
  const denominator = 100n ** BigInt(step);
  return Number((2n * numerator + denominator) / (2n * denominator));
}

function sortedSchedule(schedule: readonly RampScheduleEntry[] | undefined): RampScheduleEntry[] {
  if (!schedule || schedule.length === 0) throw new RangeError('A custom ramp plan needs a schedule');
  return [...schedule].sort((a, b) => a.step - b.step);
}

export interface RampCapInput {
  plan: RampPlan;
  step: number;
  /** Total of the daily limits of the domain's active mailboxes: where the ramp ends. */
  mailboxCapTotal: number;
  customSchedule?: readonly RampScheduleEntry[];
}

/** The domain-wide daily cap at a ramp step, before the reputation multiplier. */
export function rampCap(input: RampCapInput): number {
  const step = Math.max(0, input.step);
  switch (input.plan) {
    case 'established':
      return input.mailboxCapTotal;
    case 'custom': {
      const schedule = sortedSchedule(input.customSchedule);
      let cap = schedule[0]!.cap;
      for (const entry of schedule) if (entry.step <= step) cap = entry.cap;
      return cap;
    }
    default: {
      const { start, ratePercent } = GEOMETRIC_PLANS[input.plan];
      return Math.min(geometricCap(start, ratePercent, step), input.mailboxCapTotal);
    }
  }
}

/** The step at which the plan reaches its ceiling ("step 9 of 13"). */
export function rampFinalStep(input: Omit<RampCapInput, 'step'>): number {
  switch (input.plan) {
    case 'established':
      return 0;
    case 'custom':
      return sortedSchedule(input.customSchedule).at(-1)!.step;
    default: {
      const { start, ratePercent } = GEOMETRIC_PLANS[input.plan];
      let step = 0;
      while (geometricCap(start, ratePercent, step) < input.mailboxCapTotal) step += 1;
      return step;
    }
  }
}

/** The last warm-up step of a mailbox: where start + increment × step reaches its daily limit. */
export function warmupFinalStep(dailyLimit: number, startVolume: number, dailyIncrement: number): number {
  if (dailyLimit <= startVolume) return 0;
  if (dailyIncrement <= 0) throw new RangeError('Warm-up increment must be positive');
  return Math.ceil((dailyLimit - startVolume) / dailyIncrement);
}

/** A day counts toward the ramp only if the domain used at least half of its cap (§8.3.1). */
export function isSendingDay(sent: number, plannedCap: number): boolean {
  return plannedCap > 0 && sent * 2 >= plannedCap;
}

export interface RampMoveInput {
  step: number;
  finalStep: number;
  status: RampStatus;
  band: Band;
  /** The band at the previous ramp decision; null on the first run. */
  previousBand: Band | null;
  /** Healthy days in a row, up to and including today. */
  consecutiveHealthyDays: number;
  /** Domains: yesterday used at least half the cap. Mailbox warm-up: always true. */
  yesterdayWasSendingDay: boolean;
  /** Whole days since the last sending day. Mailbox warm-up: 0. */
  idleDays?: number;
  manualHold?: boolean;
}

export interface RampMove {
  step: number;
  status: RampStatus;
  action: RampAction;
  reason: 'healthy' | 'at_risk' | 'critical' | 'paused' | 'manual_hold' | 'idle' | 'recovering' | 'not_a_sending_day' | 'complete';
}

const IDLE_DAYS_BEFORE_STEP_BACK = 14;
const HEALTHY_DAYS_TO_RECOVER = 2;

/**
 * The daily ramp decision (§8.3.2).
 * - Paused stops the ramp; Critical drops back 2 steps once, on entering the band, then holds;
 *   At risk holds.
 * - Healthy moves up one step if yesterday was a sending day. After a hold or step-back it first
 *   needs 2 Healthy days in a row.
 * - An idle domain doesn't move up, and drops back 3 steps for every 14 days without sending.
 */
export function moveRamp(input: RampMoveInput): RampMove {
  const { step, finalStep, band } = input;

  if (band === 'paused') return { step, status: 'stopped', action: 'stopped', reason: 'paused' };

  if (band === 'critical') {
    if (input.previousBand === 'critical') return { step, status: 'stepped_back', action: 'held', reason: 'critical' };
    return { step: Math.max(0, step - 2), status: 'stepped_back', action: 'stepped_back', reason: 'critical' };
  }

  if (band === 'at_risk') return { step, status: 'holding', action: 'held', reason: 'at_risk' };

  if (input.manualHold) return { step, status: 'holding', action: 'held', reason: 'manual_hold' };

  const idleDays = input.idleDays ?? 0;
  if (idleDays >= IDLE_DAYS_BEFORE_STEP_BACK && idleDays % IDLE_DAYS_BEFORE_STEP_BACK === 0) {
    return { step: Math.max(0, step - 3), status: 'stepped_back', action: 'stepped_back', reason: 'idle' };
  }

  if (step >= finalStep) return { step, status: 'complete', action: 'none', reason: 'complete' };

  const recovering = input.status === 'holding' || input.status === 'stepped_back' || input.status === 'stopped';
  if (recovering && input.consecutiveHealthyDays < HEALTHY_DAYS_TO_RECOVER) {
    return { step, status: input.status, action: 'held', reason: 'recovering' };
  }

  if (!input.yesterdayWasSendingDay) return { step, status: 'ramping', action: 'none', reason: 'not_a_sending_day' };

  const next = step + 1;
  return { step: next, status: next >= finalStep ? 'complete' : 'ramping', action: 'advanced', reason: 'healthy' };
}

const MAX_STEP_INCREASE = { numerator: 3, denominator: 2 }; // +50%
const MAX_OVERRIDE_DAYS = 14;

/** A custom schedule: steps 0, 1, 2 … with whole-number caps, none more than 50% above the one before. */
export function validateCustomSchedule(schedule: readonly RampScheduleEntry[]): string[] {
  const errors: string[] = [];
  if (schedule.length === 0) return ['The schedule needs at least one step.'];
  const sorted = [...schedule].sort((a, b) => a.step - b.step);
  sorted.forEach((entry, index) => {
    if (entry.step !== index) errors.push(`Steps must run 0, 1, 2 … without gaps; found step ${entry.step} at position ${index}.`);
    if (!Number.isInteger(entry.cap) || entry.cap < 1) errors.push(`Step ${entry.step}: the cap must be a whole number of at least 1.`);
    const previous = sorted[index - 1];
    if (previous && entry.cap * MAX_STEP_INCREASE.denominator > previous.cap * MAX_STEP_INCREASE.numerator) {
      errors.push(`Step ${entry.step}: ${entry.cap} is more than 50% above the previous step (${previous.cap}).`);
    }
  });
  return errors;
}

export interface CapOverrideInput {
  cap: number;
  /** The ramp's cap at the current step, before any override. */
  currentStepCap: number;
  /** `YYYY-MM-DD` in the workspace timezone. */
  today: string;
  /** Last day the override applies, `YYYY-MM-DD`. */
  until: string;
}

/** A temporary cap override: at most 14 days; lowering is unlimited, raising is limited to +50% (§8.3.6). */
export function validateCapOverride(input: CapOverrideInput): string[] {
  const errors: string[] = [];
  if (!Number.isInteger(input.cap) || input.cap < 0) errors.push('The cap must be a whole number of 0 or more.');
  if (input.cap * MAX_STEP_INCREASE.denominator > input.currentStepCap * MAX_STEP_INCREASE.numerator) {
    errors.push(`The cap can be raised by at most 50% above the current step (${input.currentStepCap}).`);
  }
  const days = Math.round((Date.parse(`${input.until}T00:00:00Z`) - Date.parse(`${input.today}T00:00:00Z`)) / 86_400_000);
  if (Number.isNaN(days)) errors.push('The dates must be YYYY-MM-DD.');
  else if (days < 0) errors.push('The end date is in the past.');
  else if (days > MAX_OVERRIDE_DAYS) errors.push(`An override can last at most ${MAX_OVERRIDE_DAYS} days.`);
  return errors;
}
