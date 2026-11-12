// Campaigns, goals, the initial email and follow-up sequences (spec §5.1, §5.2, §5.10, §6.6).

import { z } from 'zod';

import { describedEnum, id, timestamp } from '../common.ts';
import { lifecycleStageSchema } from './contacts.ts';

export const campaignStatusSchema = describedEnum(
  {
    draft: 'Being set up. Nothing is sent.',
    active: 'Running: sending within caps and windows, and handling replies.',
    paused: 'No scheduled sending. Replies are still polled and analysed; drafts wait for approval.',
    completed: 'Finished, by hand or because every thread is done.',
    archived: 'Read-only. Remaining threads are stopped.',
  },
  { id: 'CampaignStatus', description: 'Where the campaign stands (§5.1).' },
);

export const autonomySchema = describedEnum(
  {
    manual: 'Every AI-written email needs approval.',
    assisted: 'Confident, safe replies send on their own; everything else waits for approval or escalates (default).',
    autonomous: 'AI replies send when guardrails pass and confidence is at least 0.6.',
  },
  { id: 'Autonomy', description: 'How much the agent may send without a person (§10.7).' },
);

export const sendingPrioritySchema = describedEnum(
  { high: 'Weight 3 when sharing mailboxes.', normal: 'Weight 2 (default).', low: 'Weight 1.' },
  { id: 'SendingPriority', description: 'This campaign’s share of mailboxes it shares with other campaigns (§8.3.3).' },
);

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');

export const sendingWindowSchema = z
  .strictObject({
    days: z.array(z.int().min(1).max(7)).min(1).max(7).meta({ description: 'Open weekdays, 1 = Monday … 7 = Sunday.', examples: [[1, 2, 3, 4, 5]] }),
    start: hhmm.meta({ description: 'Opening time, HH:MM, in the contact’s timezone.', examples: ['08:30'] }),
    end: hhmm.meta({ description: 'Closing time, HH:MM.', examples: ['17:30'] }),
    fallback_tz: z.string().meta({ description: 'IANA timezone used when a contact’s timezone is unknown.', examples: ['America/New_York'] }),
  })
  .meta({ id: 'SendingWindow', description: 'When emails may go out, in each contact’s own timezone (§8.4).' });

export const personaSchema = z
  .strictObject({
    sender_role: z.string().max(200).nullable().meta({ description: 'Who the sender is, e.g. "Founder". Fills {{ sender.title }}.' }),
    tone: z.string().max(200).nullable().meta({ description: 'How the agent should sound, e.g. "warm, direct, no jargon".' }),
    language: z.string().max(20).nullable().meta({ description: 'Default language (BCP-47); replies match the contact’s.' }),
    style_notes: z.string().max(2000).nullable().meta({ description: 'More guidance on style.' }),
    sign_off: z.string().max(200).nullable().meta({ description: 'How emails end, e.g. "Best, Alex".' }),
  })
  .partial()
  .meta({ id: 'Persona', description: 'The voice the agent writes in.' });

export const enrollmentRulesSchema = z
  .strictObject({
    skip_active_elsewhere: z.boolean().meta({ description: 'Skip contacts with an active thread in another campaign.' }),
    cooldown_days: z.int().min(0).max(365).meta({ description: 'Skip contacts emailed by any campaign within this many days.' }),
    allow_role_accounts: z.boolean().meta({ description: 'Enroll role accounts such as info@.' }),
    allow_risky: z.boolean().meta({ description: 'Enroll addresses verification marked risky or catch-all.' }),
  })
  .partial()
  .meta({ id: 'EnrollmentRules', description: 'Who is skipped when contacts are enrolled (§8.5).' });

const campaignSettings = {
  name: z.string().min(1).max(200).meta({ description: 'Campaign name.', examples: ['Agency outreach Q4'] }),
  description: z.string().max(2000).nullable().meta({ description: 'Notes for people.' }),
  objective: z.string().min(1).max(4000).meta({ description: 'The plain-language business objective the agent works toward.', examples: ['Book discovery calls with heads of operations at 50–500 person SaaS companies.'] }),
  owner_user_id: id('user', 'Who owns the campaign and gets its escalations by default.').nullable(),
  autonomy: autonomySchema,
  persona: personaSchema,
  agent_instructions: z.string().max(10_000).nullable().meta({ description: 'Campaign-wide rules for the agent.' }),
  sending_window: sendingWindowSchema,
  blackout_dates: z.array(z.iso.date()).max(366).meta({ description: 'Dates on which nothing is sent.' }),
  daily_new_threads_limit: z.int().min(1).max(500).meta({ description: 'New first-touch emails per day, all mailboxes together.', examples: [30] }),
  sending_priority: sendingPrioritySchema,
  final_wait_business_days: z.int().min(1).max(30).meta({ description: 'For a stage with no sequence: business days to wait after the last message before its finish rule.' }),
  open_tracking: z.boolean().meta({ description: 'Add the open-tracking pixel.' }),
  track_first_touch: z.boolean().meta({ description: 'Track opens on the initial email too.' }),
  click_tracking: z.boolean().meta({ description: 'Rewrite links to track clicks. Off by default: rewritten links hurt deliverability.' }),
  list_unsubscribe_header: z.boolean().meta({ description: 'Send List-Unsubscribe headers (one-click unsubscribe).' }),
  unsubscribe_footer: z.boolean().meta({ description: 'Add the one-line compliance footer.' }),
  delivery_grace_minutes: z.int().min(30).max(1440).meta({ description: 'Minutes without a bounce after which an email counts as received.' }),
  reply_delay_min_minutes: z.int().min(1).max(240).meta({ description: 'Shortest wait before an AI reply goes out.' }),
  reply_delay_max_minutes: z.int().min(1).max(480).meta({ description: 'Longest wait before an AI reply goes out.' }),
  auto_send_min_confidence: z.number().min(0.5).max(1).meta({ description: 'Draft confidence needed to auto-send in assisted mode.' }),
  goal_auto_confirm_threshold: z.number().min(0.5).max(1).meta({ description: 'Probability needed to confirm a goal without a person.' }),
  max_ai_replies_per_thread: z.int().min(0).max(50).meta({ description: 'AI replies per thread before a person takes over.' }),
  pause_on_manual_reply: z.boolean().meta({ description: 'Pause the agent on a thread when you reply from your own mail client.' }),
  on_not_interested: describedEnum(
    { close_silently: 'Close the thread without replying (default).', send_polite_close: 'Send a short polite reply, then close.' },
    { description: 'What happens when a contact clearly declines.' },
  ),
  review_first_n_personalized: z.int().min(0).max(100).meta({ description: 'How many AI-personalized first emails need approval before the rest send on their own.' }),
  enrollment_rules: enrollmentRulesSchema,
  links: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), z.url()).meta({ description: 'Links the agent may use, by key; templates use {{ campaign.links.<key> }}.', examples: [{ booking: 'https://cal.com/acme/intro' }] }),
};

export const campaignSchema = z
  .object({
    id: id('campaign'),
    status: campaignStatusSchema,
    ...campaignSettings,
    agent_mode: describedEnum(
      { built_in: 'Catalyst’s own agent analyses and drafts.', external: 'An outside harness does, through the work queue.' },
      { description: 'Who writes the AI replies (§10.7).' },
    ),
    mailboxes: z.array(z.object({ mailbox_id: id('mailbox'), weight: z.int().min(1) })).meta({ description: 'The mailboxes it sends from, with their weights.' }),
    goal_count: z.int().min(0).meta({ description: 'How many goals it has.' }),
    thread_count: z.int().min(0).meta({ description: 'How many contacts are enrolled.' }),
    launched_at: timestamp('When it was launched.').nullable(),
    completed_at: timestamp('When it completed.').nullable(),
    archived_at: timestamp('When it was archived.').nullable(),
    created_at: timestamp('When it was created.'),
    updated_at: timestamp('When it last changed.'),
  })
  .meta({ id: 'Campaign', description: 'Goals, emails, follow-ups, agent settings and the threads for its contacts (§5.1).' });
export type Campaign = z.infer<typeof campaignSchema>;

export const campaignExample: Campaign = {
  id: 'cmp_01jd3x5k8qf7tb9w2m4n6p8r0s',
  status: 'active',
  name: 'Agency outreach Q4',
  description: null,
  objective: 'Book discovery calls with heads of operations at 50–500 person SaaS companies.',
  owner_user_id: null,
  autonomy: 'assisted',
  persona: { sender_role: 'Founder', tone: 'warm, direct', language: 'en', style_notes: null, sign_off: 'Best, Alex' },
  agent_instructions: null,
  sending_window: { days: [1, 2, 3, 4, 5], start: '08:30', end: '17:30', fallback_tz: 'America/New_York' },
  blackout_dates: [],
  daily_new_threads_limit: 30,
  sending_priority: 'normal',
  final_wait_business_days: 5,
  open_tracking: true,
  track_first_touch: true,
  click_tracking: false,
  list_unsubscribe_header: true,
  unsubscribe_footer: true,
  delivery_grace_minutes: 240,
  reply_delay_min_minutes: 8,
  reply_delay_max_minutes: 45,
  auto_send_min_confidence: 0.8,
  goal_auto_confirm_threshold: 0.85,
  max_ai_replies_per_thread: 6,
  pause_on_manual_reply: true,
  on_not_interested: 'close_silently',
  review_first_n_personalized: 10,
  enrollment_rules: { skip_active_elsewhere: true, cooldown_days: 30, allow_role_accounts: false, allow_risky: false },
  links: { booking: 'https://cal.com/acme/intro' },
  agent_mode: 'built_in',
  mailboxes: [{ mailbox_id: 'mbx_01jd3x5k8qf7tb9w2m4n6p8r0s', weight: 1 }],
  goal_count: 2,
  thread_count: 412,
  launched_at: '2026-10-27T15:00:00Z',
  completed_at: null,
  archived_at: null,
  created_at: '2026-10-20T10:00:00Z',
  updated_at: '2026-10-27T15:00:00Z',
};

// ── Goals ──────────────────────────────────────────────────────────────────────────────────────

export const goalMethodSchema = describedEnum(
  {
    ai: 'The agent reads replies and confirms the goal when confident.',
    external_event: 'An integration event: a Cal.com or Calendly booking, a Stripe payment, or a signed generic event.',
    link_click: 'A click on the goal’s tracked link (a signal only, unless click_counts_as_achieved).',
    manual: 'A person or the API marks it.',
    implied: 'Recorded because a later goal was achieved.',
  },
  { id: 'GoalMethod', description: 'How a goal can be detected (§5.2).' },
);

export const detectionMethodSchema = describedEnum(
  {
    ai: 'The agent reads replies and confirms the goal when confident.',
    external_event: 'An integration event: a booking or a payment.',
    link_click: 'A click on the goal’s tracked link.',
    manual: 'A person or the API marks it.',
  },
  { id: 'DetectionMethod', description: 'A way a goal may be detected.' },
);

const goalFields = {
  key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/).meta({ description: 'A slug used by integration events, e.g. call_booked.', examples: ['call_booked'] }),
  name: z.string().min(1).max(100).meta({ description: 'Shown as "⟨name⟩ achieved".', examples: ['Discovery call booked'] }),
  success_criteria: z.string().min(1).max(2000).meta({ description: 'When the goal counts as met, in words; the AI checks replies against it.', examples: ['The contact books a call through the booking link or agrees a specific time.'] }),
  detection_methods: z.array(detectionMethodSchema).min(1).meta({ description: 'How the goal can be detected.' }),
  external_event_match: z.record(z.string(), z.string()).nullable().meta({ description: 'Which integration event achieves it, e.g. {"source":"calcom","type":"BOOKING_CREATED"}.' }),
  tracked_link_key: z.string().nullable().meta({ description: 'The key in campaign links whose clicks signal this goal.' }),
  click_counts_as_achieved: z.boolean().meta({ description: 'A click on the tracked link achieves the goal by itself.' }),
  auto_confirm: z.boolean().meta({ description: 'The agent may confirm it alone above the campaign’s threshold.' }),
  playbook: z.string().min(1).max(10_000).meta({ description: 'How the agent moves a contact toward this goal.', examples: ['Answer briefly, then offer the booking link; propose two time windows if they prefer email.'] }),
  lifecycle_stage_on_achieve: lifecycleStageSchema.nullable().meta({ description: 'Lifecycle stage the contact moves to when achieved.' }),
  marks_customer: z.boolean().meta({ description: 'Achieving it makes the contact a customer (final goals only).' }),
  value_cents: z.int().min(0).nullable().meta({ description: 'Estimated value in cents, for attribution.' }),
};

export const goalSchema = z
  .object({ id: id('goal'), position: z.int().min(1).meta({ description: '1 for the first goal; the highest is the final goal.' }), ...goalFields })
  .meta({ id: 'Goal', description: 'An ordered milestone in a campaign (§5.2). Achieving goal k implies goals 1…k−1.' });
export type Goal = z.infer<typeof goalSchema>;

export const goalExample: Goal = {
  id: 'gol_01jd3x5k8qf7tb9w2m4n6p8r0s',
  position: 1,
  key: 'call_booked',
  name: 'Discovery call booked',
  success_criteria: 'The contact books a call through the booking link or agrees a specific time.',
  detection_methods: ['ai', 'external_event', 'manual'],
  external_event_match: { source: 'calcom', type: 'BOOKING_CREATED' },
  tracked_link_key: 'booking',
  click_counts_as_achieved: false,
  auto_confirm: true,
  playbook: 'Answer briefly, then offer the booking link.',
  lifecycle_stage_on_achieve: 'opportunity',
  marks_customer: false,
  value_cents: null,
};

export const createGoalSchema = z
  .strictObject({ key: goalFields.key, name: goalFields.name, success_criteria: goalFields.success_criteria, playbook: goalFields.playbook, ...z.object(goalFields).omit({ key: true, name: true, success_criteria: true, playbook: true }).partial().shape })
  .meta({ id: 'CreateGoal', description: 'A new goal, added after the existing ones.' });

export const updateGoalSchema = z.strictObject(goalFields).partial().meta({ id: 'UpdateGoal' });

// ── Steps, variants, sequences ─────────────────────────────────────────────────────────────────

export const stepModeSchema = describedEnum(
  {
    template: 'The message as written, with variables filled in.',
    ai_opening_line: 'The template plus an AI-written first line about the contact.',
    ai_adapt: 'The template is a brief; the AI rewrites it to fit the conversation. Not for the initial email.',
    ai_write: 'The AI writes the message from the guidance and the goal’s playbook.',
  },
  { id: 'StepMode', description: 'How a step’s message is written (§5.10).' },
);

export const waitSchema = z
  .strictObject({
    amount: z.int().min(0).max(365).meta({ description: 'How long.', examples: [3] }),
    unit: describedEnum({ hours: 'Hours.', days: 'Calendar days.', business_days: 'Business days, skipping weekends and blackout dates.' }, { description: 'The unit.' }),
  })
  .meta({ id: 'Wait', description: 'A wait before a follow-up. At least 24 hours.' });

export const templateIssueSchema = z
  .object({
    code: describedEnum(
      {
        syntax: 'The Liquid is malformed.',
        unknown_variable: 'A variable that doesn’t exist.',
        unknown_filter: 'A filter other than default, capitalize, downcase or truncate.',
        unsupported_tag: 'A tag other than if, elsif, else or unless.',
        empty_variable: 'A variable that is empty for this recipient and has no fallback.',
      },
      { description: 'What is wrong.' },
    ),
    message: z.string(),
    variable: z.string().optional(),
  })
  .meta({ id: 'TemplateIssue', description: 'A template problem; each one blocks sending (§8.7).' });

export const variantSchema = z
  .object({
    id: id('variant'),
    label: z.string().meta({ description: 'A, B, …', examples: ['A'] }),
    weight: z.int().min(0).meta({ description: 'Share of traffic, relative to the other variants.' }),
    subject_template: z.string().nullable().meta({ description: 'Subject; required on the initial email, ignored on follow-ups sent as replies.' }),
    body_template: z.string().meta({ description: 'Plain-text body with template variables. For AI modes, the brief.' }),
    active: z.boolean().meta({ description: 'Inactive variants get no traffic.' }),
    issues: z.array(templateIssueSchema).meta({ description: 'Template problems found when the variant was read.' }),
  })
  .meta({ id: 'Variant', description: 'One version of a step’s message, for A/B testing.' });

export const variantInputSchema = z
  .strictObject({
    label: z.string().min(1).max(20).optional().meta({ description: 'Defaults to the next letter.' }),
    weight: z.int().min(0).max(100).optional().meta({ description: 'Share of traffic; defaults to 1.' }),
    subject_template: z.string().max(300).nullable().optional().meta({ description: 'Subject template.' }),
    body_template: z.string().min(1).max(20_000).meta({ description: 'Body template.', examples: ['Hi {{ contact.first_name | default: "there" }},\n\n…'] }),
    active: z.boolean().optional().meta({ description: 'Defaults to true.' }),
  })
  .meta({ id: 'VariantInput' });

export const stepSchema = z
  .object({
    id: id('step'),
    position: z.int().min(1).max(6),
    wait: waitSchema,
    wait_from: describedEnum(
      { last_message: 'Count from the last message (from the previous follow-up for later steps).', goal_event: 'Count from the goal’s event time, e.g. the booked call’s start.' },
      { description: 'What the wait counts from.' },
    ),
    send_as_reply: z.boolean().meta({ description: 'Sent as "Re: …" in the same email thread.' }),
    mode: stepModeSchema,
    ai_guidance: z.string().nullable().meta({ description: 'Guidance for the AI modes.' }),
    include_tracking: z.boolean().nullable().meta({ description: 'Open tracking for this step; null inherits the campaign setting.' }),
    variants: z.array(variantSchema),
  })
  .meta({ id: 'Step', description: 'The initial email, or one follow-up step.' });

export const stepInputSchema = z
  .strictObject({
    wait: waitSchema.meta({ description: 'How long to wait before sending, at least 24 hours.' }),
    wait_from: describedEnum({ last_message: 'From the last message.', goal_event: 'From the goal’s event time.' }, { description: 'What the wait counts from; defaults to last_message.' }).optional(),
    send_as_reply: z.boolean().optional().meta({ description: 'Defaults to true.' }),
    mode: stepModeSchema.optional(),
    ai_guidance: z.string().max(4000).nullable().optional().meta({ description: 'Guidance for AI modes.' }),
    include_tracking: z.boolean().nullable().optional().meta({ description: 'Null inherits the campaign setting.' }),
    variant: variantInputSchema.meta({ description: 'The step’s first variant.' }),
  })
  .meta({ id: 'StepInput' });

export const sequenceSchema = z
  .object({
    id: id('sequence'),
    name: z.string(),
    stages: z.array(z.string()).meta({ description: 'Stages covered: sent, received, responded or goal:<key>.', examples: [['sent', 'received']] }),
    finish: describedEnum(
      {
        exhaust: 'Mark the thread Exhausted ("No reply"). A later reply reopens it.',
        notify_owner: 'Raise a went_quiet escalation so a person decides.',
        close_lost: 'Close the thread as lost (went quiet).',
        keep_waiting: 'Send nothing more and wait for a reply indefinitely.',
      },
      { id: 'FinishRule', description: 'What happens after the last step and the final wait.' },
    ),
    final_wait: waitSchema,
    active: z.boolean().meta({ description: 'Inactive sequences don’t run and don’t cover their stages.' }),
    steps: z.array(stepSchema),
    created_at: timestamp('When it was created.'),
    updated_at: timestamp('When it last changed.'),
  })
  .meta({ id: 'FollowUpSequence', description: 'Timed follow-ups sent while waiting on the contact, for the stages it covers (§5.10).' });
export type FollowUpSequenceResource = z.infer<typeof sequenceSchema>;

export const preflightItemSchema = z
  .object({
    id: z.string().meta({ description: 'A stable identifier for the check.', examples: ['initial_email'] }),
    status: describedEnum({ pass: 'Fine.', warn: 'Launch is allowed; worth a look.', fail: 'Blocks launch.' }, { description: 'The result.' }),
    title: z.string().meta({ description: 'What was checked.' }),
    detail: z.string().nullable().meta({ description: 'What was found, and how to fix it.' }),
  })
  .meta({ id: 'PreflightItem' });

export const preflightSchema = z
  .object({
    passed: z.boolean().meta({ description: 'No item failed, so the campaign can launch.' }),
    items: z.array(preflightItemSchema),
    audience: z
      .object({ enrollable: z.int(), enrolled: z.int(), skipped: z.record(z.string(), z.int()).meta({ description: 'Enrolled threads that would be skipped now, by reason.' }) })
      .meta({ description: 'Who the campaign would reach.' }),
  })
  .meta({ id: 'Preflight', description: 'The launch gate (§8.11).' });

export const enrollmentResultSchema = z
  .object({
    created: z.array(z.object({ contact_id: id('contact'), thread_id: id('thread') })).meta({ description: 'Contacts enrolled, with their new threads.' }),
    skipped: z
      .array(
        z.object({
          contact_id: z.string(),
          reason: describedEnum(
            {
              not_found: 'No such contact.',
              already_enrolled: 'Already in this campaign.',
              suppressed: 'The address or domain is suppressed.',
              unsubscribed: 'The contact unsubscribed or complained.',
              do_not_contact: 'Marked do-not-contact.',
              invalid: 'The address is invalid or bounced.',
              risky: 'Verification marked it risky or catch-all, and the campaign doesn’t allow those.',
              role_account: 'A role account such as info@, which the campaign doesn’t allow.',
              active_elsewhere: 'In an active conversation in another campaign.',
              cooldown: 'Emailed recently, within the cooldown.',
              consent_required: 'In a country that needs consent (Canada), with no consent recorded.',
            },
            { description: 'Why the contact was skipped.' },
          ),
        }),
      )
      .meta({ description: 'Contacts not enrolled, and why (§8.5).' }),
  })
  .meta({ id: 'EnrollmentResult' });
