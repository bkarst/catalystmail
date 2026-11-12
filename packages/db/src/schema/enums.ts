// Postgres enums (spec §6.2). `enum-parity.ts` checks at compile time that the ones mirrored in
// @catalyst/core carry exactly the same values.

import { pgEnum } from 'drizzle-orm/pg-core';

export const userRole = pgEnum('user_role', ['owner', 'admin', 'member', 'viewer']);
export const threadStage = pgEnum('thread_stage', ['queued', 'sent', 'received', 'responded', 'goal_achieved']);
export const threadState = pgEnum('thread_state', [
  'active', 'pending_approval', 'needs_human', 'paused', 'completed',
  'exhausted', 'closed_lost', 'bounced', 'unsubscribed', 'stopped',
]);
export const nextActionType = pgEnum('next_action_type', ['none', 'send_initial', 'send_reply', 'send_follow_up', 'await_reply']);
export const stepMode = pgEnum('step_mode', ['template', 'ai_opening_line', 'ai_adapt', 'ai_write']);
export const sequenceFinish = pgEnum('sequence_finish', ['exhaust', 'notify_owner', 'close_lost', 'keep_waiting']);
export const waitUnit = pgEnum('wait_unit', ['hours', 'days', 'business_days']);
export const messageDirection = pgEnum('message_direction', ['outbound', 'inbound']);
export const messageStatus = pgEnum('message_status', [
  'draft', 'pending_approval', 'scheduled', 'sending', 'sent', 'bounced',
  'failed', 'cancelled', 'superseded', 'send_unknown', 'received',
]);
export const messageAuthor = pgEnum('message_author', ['template', 'ai', 'human_app', 'human_external', 'contact', 'third_party', 'system']);
export const inboundKind = pgEnum('inbound_kind', [
  'human_reply', 'auto_reply', 'out_of_office', 'bounce_hard', 'bounce_soft',
  'unsubscribe_request', 'complaint', 'unknown',
]);
export const matchMethod = pgEnum('match_method', ['headers', 'subject_sender', 'sender_fallback', 'dsn_original', 'manual']);
export const openStatus = pgEnum('open_status', ['not_tracked', 'unopened', 'machine_only', 'opened']);
export const campaignStatus = pgEnum('campaign_status', ['draft', 'active', 'paused', 'completed', 'archived']);
export const autonomyLevel = pgEnum('autonomy_level', ['manual', 'assisted', 'autonomous']);
export const agentMode = pgEnum('agent_mode', ['built_in', 'external']);
export const goalMethod = pgEnum('goal_method', ['ai', 'external_event', 'link_click', 'manual', 'implied']);
export const escalationReason = pgEnum('escalation_reason', [
  'knowledge_gap', 'pricing_negotiation', 'legal_or_compliance', 'human_requested',
  'identity_question', 'complaint', 'high_value', 'meeting_logistics',
  'attachment_received', 'new_participant', 'referral', 'goal_confirmation',
  'low_confidence', 'guardrail_failed', 'suspicious_content', 'reply_limit',
  'reopened', 'ai_unavailable', 'send_failure', 'unmatched_reply', 'went_quiet', 'custom_rule',
]);
export const escalationStatus = pgEnum('escalation_status', ['open', 'snoozed', 'resolved', 'dismissed']);
export const escalationPriority = pgEnum('escalation_priority', ['urgent', 'high', 'normal']);
export const emailVerification = pgEnum('email_verification', ['unverified', 'valid', 'risky', 'catch_all', 'invalid', 'bounced']);
export const subscriptionStatus = pgEnum('subscription_status', ['subscribed', 'unsubscribed', 'complained']);
export const lifecycleStage = pgEnum('lifecycle_stage', ['lead', 'prospect', 'engaged', 'opportunity', 'customer', 'churned', 'disqualified']);
export const consentBasis = pgEnum('consent_basis', ['legitimate_interest', 'consent', 'existing_relationship', 'unknown']);
export const mailboxStatus = pgEnum('mailbox_status', ['pending', 'active', 'paused', 'error']);
export const mailboxAuth = pgEnum('mailbox_auth', ['password', 'oauth2_google', 'oauth2_microsoft']);
export const suppressionReason = pgEnum('suppression_reason', ['unsubscribed', 'hard_bounce', 'complaint', 'manual', 'do_not_contact', 'erased']);
export const trackingType = pgEnum('tracking_type', ['open', 'click']);
export const trackingSource = pgEnum('tracking_source', ['human', 'privacy_proxy', 'security_scanner', 'sender_self', 'unknown']);
export const actorType = pgEnum('actor_type', ['system', 'ai', 'user', 'api_key', 'contact', 'integration']);
