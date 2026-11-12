// Shared vocabulary for the pure domain logic. The string values mirror the Postgres enums in
// spec §6.2, so rows can be passed in without translation.

export type ThreadStage = 'queued' | 'sent' | 'received' | 'responded' | 'goal_achieved';

export type ThreadState =
  | 'active'
  | 'pending_approval'
  | 'needs_human'
  | 'paused'
  | 'completed'
  | 'exhausted'
  | 'closed_lost'
  | 'bounced'
  | 'unsubscribed'
  | 'stopped';

export type NextActionType = 'none' | 'send_initial' | 'send_reply' | 'send_follow_up' | 'await_reply';

export type StepMode = 'template' | 'ai_opening_line' | 'ai_adapt' | 'ai_write';
export type SequenceFinish = 'exhaust' | 'notify_owner' | 'close_lost' | 'keep_waiting';
export type WaitUnit = 'hours' | 'days' | 'business_days';

export interface Wait {
  amount: number;
  unit: WaitUnit;
}

export type MessageDirection = 'outbound' | 'inbound';

export type MessageStatus =
  | 'draft'
  | 'pending_approval'
  | 'scheduled'
  | 'sending'
  | 'sent'
  | 'bounced'
  | 'failed'
  | 'cancelled'
  | 'superseded'
  | 'send_unknown'
  | 'received';

export type MessageAuthor = 'template' | 'ai' | 'human_app' | 'human_external' | 'contact' | 'third_party' | 'system';

export type InboundKind =
  | 'human_reply'
  | 'auto_reply'
  | 'out_of_office'
  | 'bounce_hard'
  | 'bounce_soft'
  | 'unsubscribe_request'
  | 'complaint'
  | 'unknown';

export type OpenStatus = 'not_tracked' | 'unopened' | 'machine_only' | 'opened';
export type TrackingType = 'open' | 'click';
export type TrackingSource = 'human' | 'privacy_proxy' | 'security_scanner' | 'sender_self' | 'unknown';

export type CampaignStatus = 'draft' | 'active' | 'paused' | 'completed' | 'archived';
export type AutonomyLevel = 'manual' | 'assisted' | 'autonomous';
export type SendingPriority = 'high' | 'normal' | 'low';

/** Reputation band of a sending domain, or health band of a mailbox (§8.10). */
export type Band = 'healthy' | 'at_risk' | 'critical' | 'paused';

export type Intent =
  | 'interested'
  | 'question'
  | 'objection'
  | 'meeting_request'
  | 'not_now'
  | 'not_interested'
  | 'wrong_person'
  | 'referral'
  | 'unsubscribe'
  | 'complaint'
  | 'neutral';

export type EscalationReason =
  | 'knowledge_gap'
  | 'pricing_negotiation'
  | 'legal_or_compliance'
  | 'human_requested'
  | 'identity_question'
  | 'complaint'
  | 'high_value'
  | 'meeting_logistics'
  | 'attachment_received'
  | 'new_participant'
  | 'referral'
  | 'goal_confirmation'
  | 'low_confidence'
  | 'guardrail_failed'
  | 'suspicious_content'
  | 'reply_limit'
  | 'reopened'
  | 'ai_unavailable'
  | 'send_failure'
  | 'unmatched_reply'
  | 'went_quiet'
  | 'custom_rule';

export type EscalationPriority = 'urgent' | 'high' | 'normal';

/** Source of randomness, injected everywhere so tests can seed it (§19.1). Returns [0, 1). */
export type Rng = () => number;

export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;
