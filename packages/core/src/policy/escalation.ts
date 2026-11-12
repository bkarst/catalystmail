// Escalation priorities and SLAs (§11.1).

import { addWait, fitIntoWindow, type SendingWindow, type ZoneContext } from '../time/schedule.ts';
import type { EscalationPriority, EscalationReason } from '../types.ts';

export interface EscalationRule {
  priority: EscalationPriority;
  /** Time to act, counted in workspace business hours or business days. */
  sla: { amount: number; unit: 'business_hours' | 'business_days' };
}

const URGENT: EscalationRule = { priority: 'urgent', sla: { amount: 2, unit: 'business_hours' } };
const HIGH: EscalationRule = { priority: 'high', sla: { amount: 4, unit: 'business_hours' } };
const NORMAL: EscalationRule = { priority: 'normal', sla: { amount: 1, unit: 'business_days' } };

/** `custom_rule` carries its own priority and SLA; Normal is only its default. */
/** The SLA of each priority, for an escalation whose priority rose after a breach (§11.1). */
export const PRIORITY_RULES: Record<EscalationPriority, EscalationRule> = { urgent: URGENT, high: HIGH, normal: NORMAL };

export const ESCALATION_RULES: Record<EscalationReason, EscalationRule> = {
  complaint: URGENT,
  legal_or_compliance: URGENT,
  human_requested: URGENT,
  identity_question: URGENT,
  high_value: URGENT,
  suspicious_content: HIGH,
  pricing_negotiation: HIGH,
  knowledge_gap: HIGH,
  meeting_logistics: HIGH,
  ai_unavailable: HIGH,
  send_failure: HIGH,
  goal_confirmation: NORMAL,
  attachment_received: NORMAL,
  new_participant: NORMAL,
  referral: NORMAL,
  reopened: NORMAL,
  unmatched_reply: NORMAL,
  went_quiet: NORMAL,
  low_confidence: NORMAL,
  guardrail_failed: NORMAL,
  reply_limit: NORMAL,
  custom_rule: NORMAL,
};

/** These can't be switched off at any autonomy level (§10.7). */
export const MANDATORY_ESCALATIONS: readonly EscalationReason[] = [
  'complaint',
  'legal_or_compliance',
  'human_requested',
  'identity_question',
  'suspicious_content',
  'pricing_negotiation',
];

const PRIORITY_ORDER: readonly EscalationPriority[] = ['urgent', 'high', 'normal'];

/** The reason an escalation is filed under when several matched: the most urgent, first listed wins ties. */
export function primaryReason(reasons: readonly EscalationReason[]): EscalationReason | null {
  let best: EscalationReason | null = null;
  for (const reason of reasons) {
    if (best === null || PRIORITY_ORDER.indexOf(ESCALATION_RULES[reason].priority) < PRIORITY_ORDER.indexOf(ESCALATION_RULES[best].priority)) {
      best = reason;
    }
  }
  return best;
}

/** An SLA breach raises priority one level. */
export function priorityAfterBreach(priority: EscalationPriority): EscalationPriority {
  return priority === 'normal' ? 'high' : 'urgent';
}

/** Workspace business hours, when the workspace hasn't set its own (§11.1). */
export const DEFAULT_BUSINESS_HOURS: SendingWindow = { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' };

/**
 * When an escalation is due: its SLA counted in business hours (only time inside the workspace's
 * business hours counts) or business days, in the workspace timezone (§11.1).
 */
export function escalationDueAt(rule: EscalationRule, now: Date, ctx: ZoneContext, businessHours: SendingWindow = DEFAULT_BUSINESS_HOURS): Date {
  if (rule.sla.unit === 'business_days') return addWait(now, { amount: rule.sla.amount, unit: 'business_days' }, ctx);
  let remaining = rule.sla.amount * 3_600_000;
  let at = fitIntoWindow(now, businessHours, ctx);
  for (let guard = 0; guard < 400; guard += 1) {
    const local = ctx.calendar.toLocal(at, ctx.zone);
    const [hour, minute] = businessHours.end.split(':').map(Number) as [number, number];
    const close = ctx.calendar.fromLocal({ year: local.year, month: local.month, day: local.day, hour, minute, second: 0 }, ctx.zone);
    const available = close.getTime() - at.getTime();
    if (remaining <= available) return new Date(at.getTime() + remaining);
    remaining -= available;
    at = fitIntoWindow(new Date(close.getTime() + 60_000), businessHours, ctx);
  }
  throw new RangeError('Could not place the SLA within business hours');
}
