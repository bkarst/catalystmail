// Autonomy levels: whether an outbound message sends on its own or waits for approval (§10.7).

import type { AutonomyLevel, EscalationReason } from '../types.ts';
import type { AutoSendBlocker } from './classification.ts';

/**
 * - `template`: the initial email and `template` follow-ups, approved at launch.
 * - `ai_personalized`: `ai_opening_line` messages and an `ai_write` initial email.
 * - `ai_reply`: a reply the agent drafted to an inbound message.
 * - `ai_follow_up`: a follow-up in `ai_adapt` or `ai_write` mode, or a requested check-in.
 */
export type OutboundClass = 'template' | 'ai_personalized' | 'ai_reply' | 'ai_follow_up';

export const AUTONOMOUS_MIN_CONFIDENCE = 0.6;

export interface SendDecisionInput {
  autonomy: AutonomyLevel;
  messageClass: OutboundClass;
  /** `ai_personalized`: first touches already reviewed in this campaign, and how many must be. */
  personalizedReviewed?: number;
  reviewFirstNPersonalized?: number;
  /**
   * Blockers from the classification of the contact's last message (`InboundDecision`).
   * Null when the contact has never replied, which is only valid for a follow-up.
   */
  classificationBlockers?: readonly AutoSendBlocker[] | null;
  /** The draft's self-assessed confidence, and `campaign.auto_send_min_confidence`. */
  draftConfidence?: number;
  autoSendMinConfidence?: number;
  guardrailsPassed?: boolean;
  /** Escalation reasons raised for this message or still open on the thread. */
  escalationReasons?: readonly EscalationReason[];
  aiRepliesSent?: number;
  maxAiRepliesPerThread?: number;
  isNewParticipant?: boolean;
  aiPaused?: boolean;
}

export type ApprovalReason =
  | AutoSendBlocker
  | 'manual_autonomy'
  | 'sample_review'
  | 'not_classified'
  | 'low_draft_confidence'
  | 'guardrails_failed'
  | 'escalation'
  | 'reply_limit'
  | 'new_participant'
  | 'ai_paused';

export interface SendDecision {
  decision: 'auto_send' | 'pending_approval';
  /** Why approval is needed; empty when the message auto-sends. */
  reasons: ApprovalReason[];
}

export function decideSend(input: SendDecisionInput): SendDecision {
  const reasons: ApprovalReason[] = [];
  const { autonomy, messageClass } = input;
  const done = (): SendDecision => ({ decision: reasons.length === 0 ? 'auto_send' : 'pending_approval', reasons });

  if (messageClass === 'template') return done();
  if (autonomy === 'manual') {
    reasons.push('manual_autonomy');
    return done();
  }

  if (input.guardrailsPassed === false) reasons.push('guardrails_failed');

  if (messageClass === 'ai_personalized') {
    if (autonomy === 'assisted' && (input.personalizedReviewed ?? 0) < (input.reviewFirstNPersonalized ?? 10)) {
      reasons.push('sample_review');
    }
    return done();
  }

  // AI replies and AI follow-ups.
  const isReply = messageClass === 'ai_reply';
  const blockers = input.classificationBlockers ?? null;
  if (blockers === null) {
    if (isReply) reasons.push('not_classified');
  } else if (autonomy === 'assisted') {
    // A follow-up can be due precisely because no reply was needed, so that condition is skipped.
    reasons.push(...blockers.filter((blocker) => isReply || blocker !== 'needs_reply_uncertain'));
  } else if (blockers.includes('classification_fallback')) {
    reasons.push('classification_fallback');
  }

  const minConfidence = autonomy === 'assisted' ? (input.autoSendMinConfidence ?? 0.8) : AUTONOMOUS_MIN_CONFIDENCE;
  if ((input.draftConfidence ?? 0) < minConfidence) reasons.push('low_draft_confidence');
  if ((input.escalationReasons ?? []).length > 0) reasons.push('escalation');
  if (isReply && (input.aiRepliesSent ?? 0) >= (input.maxAiRepliesPerThread ?? 6)) reasons.push('reply_limit');
  if (autonomy === 'assisted' && input.isNewParticipant) reasons.push('new_participant');
  if (input.aiPaused) reasons.push('ai_paused');
  return done();
}
