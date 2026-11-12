// From classification to action (§10.4). Jev's calibrated probabilities are compared with
// thresholds; Claude's second opinion is applied under the "safer reading wins" rule. Nothing
// here performs a side effect: the result says what deterministic code should do next.

import type { EscalationReason, Intent } from '../types.ts';
import { MANDATORY_ESCALATIONS } from './escalation.ts';

export interface ClassificationThresholds {
  unsubscribeAct: number;
  unsubscribeAsk: number;
  autoReply: number;
  needsReplyDraft: number;
  needsReplyNone: number;
  mandatoryEscalate: number;
  otherEscalate: number;
  /** Lower edge of every "ask a person" band for escalation questions. */
  escalationFlag: number;
  goalAsk: number;
  notInterestedClose: number;
  notInterestedAsk: number;
  notNow: number;
  autoSendIntent: number;
}

/** Defaults from §22.B. They are workspace settings, re-calibrated from the eval set. */
export const DEFAULT_THRESHOLDS: ClassificationThresholds = {
  unsubscribeAct: 0.7,
  unsubscribeAsk: 0.3,
  autoReply: 0.85,
  needsReplyDraft: 0.7,
  needsReplyNone: 0.3,
  mandatoryEscalate: 0.5,
  otherEscalate: 0.7,
  escalationFlag: 0.3,
  goalAsk: 0.5,
  notInterestedClose: 0.85,
  notInterestedAsk: 0.5,
  notNow: 0.7,
  autoSendIntent: 0.7,
};

/**
 * §22.B "all configurable, with guardrails": each a probability; every ask band below its act band;
 * and the mandatory escalations (§10.7: never switched off) no harder to raise than the default.
 */
export function thresholdProblems(thresholds: ClassificationThresholds): string[] {
  const problems: string[] = [];
  for (const [name, value] of Object.entries(thresholds)) if (!(value >= 0 && value <= 1)) problems.push(`${name} must be between 0 and 1.`);
  const below = (low: keyof ClassificationThresholds, high: keyof ClassificationThresholds) => {
    if (!(thresholds[low] < thresholds[high])) problems.push(`${low} must be below ${high}.`);
  };
  below('unsubscribeAsk', 'unsubscribeAct');
  below('needsReplyNone', 'needsReplyDraft');
  below('notInterestedAsk', 'notInterestedClose');
  below('escalationFlag', 'otherEscalate');
  if (thresholds.escalationFlag > thresholds.mandatoryEscalate) problems.push('escalationFlag must not be above mandatoryEscalate.');
  if (thresholds.mandatoryEscalate > DEFAULT_THRESHOLDS.mandatoryEscalate) problems.push(`mandatoryEscalate can't be raised above ${DEFAULT_THRESHOLDS.mandatoryEscalate}: those escalations can't be switched off.`);
  return problems;
}

/** Escalation reasons Jev can detect from text, one Noul each. */
export type JevEscalationReason =
  | 'pricing_negotiation'
  | 'legal_or_compliance'
  | 'human_requested'
  | 'identity_question'
  | 'complaint'
  | 'high_value'
  | 'meeting_logistics';

export type JevKind = 'human_reply' | 'out_of_office' | 'auto_reply';

/** Jev's answers. The latest-inbound questions are null on runs triggered by an outbound message. */
export interface JevClassification {
  kind: { value: JevKind; p: number } | null;
  needsReply: number | null;
  intent: { value: Intent; p: number };
  unsubscribe: number | null;
  /** Probability that each goal is met, by goal key. */
  goals: Readonly<Record<string, number>>;
  escalations: Readonly<Partial<Record<JevEscalationReason, number>>>;
  suspicious: number | null;
}

/** The second-opinion fields of Claude's `InboundAnalysis` (§10.5). */
export interface ClaudeOpinion {
  kind: JevKind | 'unsubscribe_request' | 'other';
  intent: Intent | 'other';
  goalSignals: readonly { goalKey: string; achieved: boolean; confidence: number }[];
  escalation: { required: boolean; reasons: readonly EscalationReason[] };
  suspiciousInstructions: boolean;
  followUpAfter: string | null;
  confidence: number;
}

export interface GoalPolicy {
  key: string;
  autoConfirm: boolean;
}

/** Why a drafted reply may not auto-send, as far as classification is concerned. */
export type AutoSendBlocker =
  | 'classification_fallback'
  | 'unsubscribe_uncertain'
  | 'kind_uncertain'
  | 'needs_reply_uncertain'
  | 'intent_uncertain'
  | 'intent_disagreement'
  | 'intent_not_auto_sendable'
  | `escalation_flag:${EscalationReason}`;

export interface GoalDecision {
  key: string;
  /** `achieve` records the goal now; `confirm` raises a `goal_confirmation` escalation. */
  action: 'achieve' | 'confirm';
  p: number;
}

export interface InboundDecision {
  /** `act` unsubscribes and ends the pipeline; `ask` holds all sending and escalates. */
  unsubscribe: 'act' | 'ask' | 'none';
  /** Set when the message is settled as automatic; the pipeline stops and the next action is postponed. */
  autoReply: 'out_of_office' | 'auto_reply' | null;
  reply: 'draft' | 'draft_for_approval' | 'none';
  escalations: EscalationReason[];
  goals: GoalDecision[];
  close: 'close' | 'approval' | 'none';
  checkIn: 'schedule' | 'approval' | 'none';
  autoSendBlockers: AutoSendBlocker[];
  /** Fields on which Jev and Claude disagreed; logged on the run and counted in eval reports. */
  disagreements: string[];
  /** Jev was unavailable and Claude classified alone. */
  fallback: boolean;
}

/** Replies with these intents may auto-send in assisted mode (§10.7). */
export const AUTO_SEND_INTENTS: readonly Intent[] = ['interested', 'question', 'meeting_request', 'objection', 'neutral'];

/** Intents that lead to an action even when the message itself needs no reply. */
const ACTION_INTENTS: readonly Intent[] = ['not_interested', 'not_now', 'referral', 'wrong_person'];

const JEV_ESCALATION_REASONS: readonly JevEscalationReason[] = [
  'pricing_negotiation',
  'legal_or_compliance',
  'human_requested',
  'identity_question',
  'complaint',
  'high_value',
  'meeting_logistics',
];

const isMandatory = (reason: EscalationReason) => MANDATORY_ESCALATIONS.includes(reason);
const escalateAt = (reason: EscalationReason, t: ClassificationThresholds) =>
  isMandatory(reason) ? t.mandatoryEscalate : t.otherEscalate;

function emptyDecision(fallback: boolean): InboundDecision {
  return {
    unsubscribe: 'none',
    autoReply: null,
    reply: 'none',
    escalations: [],
    goals: [],
    close: 'none',
    checkIn: 'none',
    autoSendBlockers: fallback ? ['classification_fallback'] : [],
    disagreements: [],
    fallback,
  };
}

/**
 * Whether Claude's `analyze_inbound` has to run after Jev (§10.4 pipeline, steps 3–4). It doesn't
 * when Jev settles the message alone: a clear unsubscribe, a clear automatic reply, or a message
 * that needs no reply and raises nothing ("Thanks, talk Thursday").
 *
 * A message that needs no reply still goes to Claude when its intent leads to an action that
 * needs both models (closing a thread) or details only Claude extracts (a check-in date, a
 * referral).
 */
export function needsClaude(jev: JevClassification, thresholds: ClassificationThresholds = DEFAULT_THRESHOLDS): boolean {
  const unsubscribe = jev.unsubscribe ?? 0;
  if (unsubscribe >= thresholds.unsubscribeAct) return false;
  if (jev.kind && jev.kind.value !== 'human_reply') return jev.kind.p < thresholds.autoReply;
  if (unsubscribe >= thresholds.unsubscribeAsk) return true;
  if ((jev.needsReply ?? 1) >= thresholds.needsReplyNone) return true;
  if ((jev.suspicious ?? 0) >= thresholds.escalationFlag) return true;
  if (JEV_ESCALATION_REASONS.some((reason) => (jev.escalations[reason] ?? 0) >= thresholds.escalationFlag)) return true;
  return ACTION_INTENTS.includes(jev.intent.value) && jev.intent.p >= thresholds.notInterestedAsk;
}

function decideGoals(
  jev: JevClassification | null,
  claude: ClaudeOpinion | null,
  goals: readonly GoalPolicy[],
  autoConfirmThreshold: number,
  thresholds: ClassificationThresholds,
  disagreements: string[],
): GoalDecision[] {
  const decisions: GoalDecision[] = [];
  for (const goal of goals) {
    const signal = claude?.goalSignals.find((entry) => entry.goalKey === goal.key) ?? null;
    const claudeAchieved = signal !== null && signal.achieved && signal.confidence >= thresholds.goalAsk;
    if (jev === null) {
      // Fallback: goals are never auto-confirmed.
      if (claudeAchieved) decisions.push({ key: goal.key, action: 'confirm', p: signal!.confidence });
      continue;
    }
    const p = jev.goals[goal.key] ?? 0;
    const jevAchieved = p >= autoConfirmThreshold;
    const claudeDenies = signal !== null && !signal.achieved;
    if ((jevAchieved && claudeDenies) || (claudeAchieved && p < thresholds.goalAsk)) disagreements.push(`goal:${goal.key}`);
    if (jevAchieved && goal.autoConfirm && !claudeDenies) decisions.push({ key: goal.key, action: 'achieve', p });
    else if (p >= thresholds.goalAsk || claudeAchieved) decisions.push({ key: goal.key, action: 'confirm', p });
  }
  return decisions;
}

export interface DecideInboundInput {
  /** Null when Jev was unavailable: Claude then classifies alone. */
  jev: JevClassification | null;
  /** Null when Jev settled the message and Claude wasn't called. */
  claude: ClaudeOpinion | null;
  goals: readonly GoalPolicy[];
  /** `campaign.goal_auto_confirm_threshold`. */
  goalAutoConfirmThreshold: number;
  thresholds?: ClassificationThresholds;
}

/** The combined policy for one inbound message. */
export function decideInbound(input: DecideInboundInput): InboundDecision {
  const t = input.thresholds ?? DEFAULT_THRESHOLDS;
  const { jev, claude } = input;
  if (jev === null) {
    if (claude === null) throw new Error('decideInbound needs a classification from Jev, Claude or both');
    return decideFallback(claude, input.goals, input.goalAutoConfirmThreshold, t);
  }

  const decision = emptyDecision(false);
  const claudeUnsubscribes = claude !== null && (claude.kind === 'unsubscribe_request' || claude.intent === 'unsubscribe');

  // Unsubscribe: either model in the act band is enough.
  const unsubscribe = jev.unsubscribe ?? 0;
  if (unsubscribe >= t.unsubscribeAct || claudeUnsubscribes) {
    if (claude !== null && claudeUnsubscribes !== unsubscribe >= t.unsubscribeAct) decision.disagreements.push('unsubscribe');
    return { ...decision, unsubscribe: 'act' };
  }
  if (unsubscribe >= t.unsubscribeAsk) {
    decision.unsubscribe = 'ask';
    decision.escalations.push('low_confidence');
    decision.autoSendBlockers.push('unsubscribe_uncertain');
  }

  // Automatic replies: settled only at high probability; otherwise read as human, nothing auto-sends.
  if (jev.kind && jev.kind.value !== 'human_reply') {
    if (jev.kind.p >= t.autoReply) return { ...decision, autoReply: jev.kind.value };
    decision.autoSendBlockers.push('kind_uncertain');
  } else if (claude !== null && (claude.kind === 'out_of_office' || claude.kind === 'auto_reply')) {
    decision.disagreements.push('kind');
    decision.autoSendBlockers.push('kind_uncertain');
  }

  // Escalations: either model in the act band raises one. A middle band only blocks auto-send.
  const raise = (reason: EscalationReason) => {
    if (!decision.escalations.includes(reason)) decision.escalations.push(reason);
  };
  const jevQuestions: [EscalationReason, number][] = JEV_ESCALATION_REASONS.map((reason) => [reason, jev.escalations[reason] ?? 0]);
  jevQuestions.push(['suspicious_content', jev.suspicious ?? 0]);
  for (const [reason, p] of jevQuestions) {
    if (p >= escalateAt(reason, t)) raise(reason);
    else if (p >= t.escalationFlag) decision.autoSendBlockers.push(`escalation_flag:${reason}`);
  }
  if (claude !== null) {
    const claudeReasons = [...claude.escalation.reasons];
    if (claude.suspiciousInstructions) claudeReasons.push('suspicious_content');
    for (const reason of claudeReasons) {
      const jevP = jevQuestions.find(([jevReason]) => jevReason === reason)?.[1];
      if (jevP !== undefined && jevP < escalateAt(reason, t)) decision.disagreements.push(`escalation:${reason}`);
      raise(reason);
    }
  }

  // Reply needed.
  const needsReply = jev.needsReply ?? t.needsReplyNone;
  if (needsReply >= t.needsReplyDraft) decision.reply = 'draft';
  else if (needsReply >= t.needsReplyNone) {
    decision.reply = 'draft_for_approval';
    decision.autoSendBlockers.push('needs_reply_uncertain');
  }

  decision.goals = decideGoals(jev, claude, input.goals, input.goalAutoConfirmThreshold, t, decision.disagreements);

  // Closing a thread and sending email need both models to agree.
  const { value: intent, p: intentP } = jev.intent;
  const claudeAgrees = claude === null ? null : claude.intent === intent;
  if (claudeAgrees === false) decision.disagreements.push('intent');

  if (intent === 'not_interested') {
    if (intentP >= t.notInterestedClose && claudeAgrees === true) decision.close = 'close';
    else if (intentP >= t.notInterestedAsk) decision.close = 'approval';
  }
  if (intent === 'not_now') {
    decision.checkIn = intentP >= t.notNow && claudeAgrees === true && claude!.followUpAfter !== null ? 'schedule' : 'approval';
  }

  if (!AUTO_SEND_INTENTS.includes(intent)) decision.autoSendBlockers.push('intent_not_auto_sendable');
  else if (intentP < t.autoSendIntent) decision.autoSendBlockers.push('intent_uncertain');
  // Without Claude's agreement there is no second opinion, so the reply can't auto-send.
  if (claudeAgrees !== true) decision.autoSendBlockers.push('intent_disagreement');

  return decision;
}

/** Jev unavailable: Claude's fields decide, with the same thresholds applied to its confidence. */
function decideFallback(
  claude: ClaudeOpinion,
  goals: readonly GoalPolicy[],
  goalAutoConfirmThreshold: number,
  t: ClassificationThresholds,
): InboundDecision {
  const decision = emptyDecision(true);
  const p = claude.confidence;

  if (claude.kind === 'unsubscribe_request' || claude.intent === 'unsubscribe') {
    if (p >= t.unsubscribeAct) return { ...decision, unsubscribe: 'act' };
    if (p >= t.unsubscribeAsk) {
      decision.unsubscribe = 'ask';
      decision.escalations.push('low_confidence');
      decision.autoSendBlockers.push('unsubscribe_uncertain');
    }
  }
  if (claude.kind === 'out_of_office' || claude.kind === 'auto_reply') {
    if (p >= t.autoReply) return { ...decision, autoReply: claude.kind };
    decision.autoSendBlockers.push('kind_uncertain');
  }

  const reasons = [...claude.escalation.reasons];
  if (claude.suspiciousInstructions) reasons.push('suspicious_content');
  for (const reason of reasons) {
    if (p >= escalateAt(reason, t)) {
      if (!decision.escalations.includes(reason)) decision.escalations.push(reason);
    } else if (p >= t.escalationFlag) decision.autoSendBlockers.push(`escalation_flag:${reason}`);
  }

  // Every reply goes to approval; nothing auto-sends and no thread closes on one model's word.
  decision.reply = 'draft_for_approval';
  decision.goals = decideGoals(null, claude, goals, goalAutoConfirmThreshold, t, decision.disagreements);
  if (claude.intent === 'not_interested') decision.close = 'approval';
  if (claude.intent === 'not_now') decision.checkIn = 'approval';
  return decision;
}

/**
 * A run triggered by an outbound message a person wrote (§10.4): only the goal questions lead to
 * an action, for example the operator confirming a call.
 */
export function decideAfterOutbound(
  jev: JevClassification,
  goals: readonly GoalPolicy[],
  goalAutoConfirmThreshold: number,
  thresholds: ClassificationThresholds = DEFAULT_THRESHOLDS,
): GoalDecision[] {
  return decideGoals(jev, null, goals, goalAutoConfirmThreshold, thresholds, []);
}
