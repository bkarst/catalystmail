// Escalations (spec §11): what needs a person, why, by when, and how it was settled.

import { z } from 'zod';

import { describedEnum, id, timestamp } from '../common.ts';

export const escalationReasonSchema = describedEnum(
  {
    knowledge_gap: 'A question the knowledge base can’t answer.',
    pricing_negotiation: 'A discount or custom pricing request.',
    legal_or_compliance: 'A contract, DPA, security questionnaire or GDPR request.',
    human_requested: 'They asked for a person.',
    identity_question: 'They asked whether this is a bot.',
    complaint: 'Angry, threatening, or calling it spam.',
    high_value: 'Enterprise signals or a key account.',
    meeting_logistics: 'Specific times that need a calendar decision.',
    attachment_received: 'A reply came with attachments.',
    new_participant: 'Someone other than the contact wrote on the thread.',
    referral: 'They pointed to someone else.',
    goal_confirmation: 'A goal was detected but not confidently enough to confirm.',
    low_confidence: 'The agent wasn’t sure enough to act.',
    guardrail_failed: 'An email failed its checks.',
    suspicious_content: 'Prompt injection or phishing.',
    reply_limit: 'The thread reached its automatic-reply limit.',
    reopened: 'A closed thread got a reply.',
    ai_unavailable: 'The AI agent couldn’t run, so a person has to answer.',
    send_failure: 'An email could not be sent, or may not have been.',
    unmatched_reply: 'A reply from a known contact matched no thread.',
    went_quiet: 'The contact engaged, then stopped answering.',
    custom_rule: 'A campaign rule matched.',
  },
  { id: 'EscalationReason', description: 'Why a person is needed (§11.1).' },
);

export const escalationPrioritySchema = describedEnum(
  { urgent: 'Within 2 business hours.', high: 'Within 4 business hours.', normal: 'Within 1 business day.' },
  { id: 'EscalationPriority', description: 'How soon (§11.1). A missed SLA raises it one level.' },
);

export const escalationStatusSchema = describedEnum(
  { open: 'Waiting for a person.', snoozed: 'Hidden until `snoozed_until`; its SLA is paused.', resolved: 'Settled.', dismissed: 'Closed without action; the thread resumes automation.' },
  { id: 'EscalationStatus', description: 'Where it stands.' },
);

export const resolutionSchema = describedEnum(
  {
    replied: 'A person replied.',
    answered_for_ai: 'A person gave the agent the missing answer.',
    goal_confirmed: 'The goal was confirmed.',
    goal_rejected: 'The goal was declined.',
    took_over: 'A person took the thread over; the agent stands back.',
    closed_thread: 'The thread was closed.',
    dismissed: 'Dismissed.',
  },
  { id: 'EscalationResolution', description: 'How it was settled (§11.3).' },
);

export const escalationSchema = z
  .object({
    id: id('escalation'),
    thread_id: id('thread', 'The thread it is about; null for one about no thread.').nullable(),
    contact_id: id('contact', 'The thread’s contact.').nullable(),
    campaign_id: id('campaign', 'The thread’s campaign.').nullable(),
    trigger_message_id: id('message', 'The email that raised it.').nullable(),
    reason: escalationReasonSchema,
    reasons: z.array(escalationReasonSchema).meta({ description: 'Every reason that applied; the first is `reason`.' }),
    priority: escalationPrioritySchema,
    title: z.string().meta({ description: 'In a few words, e.g. "Asked about SAML SSO".' }),
    explanation: z.string().meta({ description: 'Why a person is needed, in plain language.' }),
    questions: z.array(z.object({ text: z.string(), why_unanswerable: z.string() })).meta({ description: 'For knowledge gaps: the questions the agent couldn’t answer.' }),
    suggested_draft_id: id('message', 'A draft the agent suggests sending.').nullable(),
    goal_id: id('goal', 'For a goal confirmation: the goal to confirm. Resolving with `goal_confirmed` records it.').nullable(),
    goal_p: z.number().min(0).max(1).nullable().meta({ description: 'For a goal confirmation: how likely the classifier thinks the goal is reached.' }),
    status: escalationStatusSchema,
    assigned_user_id: id('user', 'Who should handle it; null means the workspace owners.').nullable(),
    due_at: timestamp('When its SLA runs out.'),
    overdue: z.boolean().meta({ description: 'Open, and past `due_at`.' }),
    snoozed_until: timestamp('When a snoozed escalation comes back.').nullable(),
    resolution: resolutionSchema.nullable(),
    resolution_note: z.string().nullable().meta({ description: 'What the person said when settling it.' }),
    resolved_by: id('user', 'Who settled it; null when an API key or Catalyst did.').nullable(),
    resolved_at: timestamp('When it was settled.').nullable(),
    created_at: timestamp('When it was raised.'),
    updated_at: timestamp('When it last changed.'),
  })
  .meta({ id: 'Escalation', description: 'Something that needs a person (§11).' });
export type Escalation = z.infer<typeof escalationSchema>;

export const escalationExample: Escalation = {
  id: 'esc_01jd3x5k8qf7tb9w2m4n6p8r0s',
  thread_id: 'thr_01jd3x5k8qf7tb9w2m4n6p8r0s',
  contact_id: 'ctc_01jd3x5k8qf7tb9w2m4n6p8r0s',
  campaign_id: 'cmp_01jd3x5k8qf7tb9w2m4n6p8r0s',
  trigger_message_id: 'msg_01jd3x5k8qf7tb9w2m4n6p8r0s',
  reason: 'ai_unavailable',
  reasons: ['ai_unavailable'],
  priority: 'high',
  title: 'Priya Shah replied',
  explanation: 'The reply needs an answer, and the AI agent isn’t connected yet, so nothing was drafted. Reply yourself, or close the thread.',
  questions: [],
  suggested_draft_id: null,
  goal_id: null,
  goal_p: null,
  status: 'open',
  assigned_user_id: null,
  due_at: '2026-11-10T21:53:00Z',
  overdue: false,
  snoozed_until: null,
  resolution: null,
  resolution_note: null,
  resolved_by: null,
  resolved_at: null,
  created_at: '2026-11-10T17:53:00Z',
  updated_at: '2026-11-10T17:53:00Z',
};
