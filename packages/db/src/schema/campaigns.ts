// Campaigns, goals, the initial email and follow-up sequences (spec §6.6).

import { sql } from 'drizzle-orm';
import { bigint, boolean, check, date, integer, jsonb, numeric, pgTable, primaryKey, smallint, text, unique } from 'drizzle-orm/pg-core';

import { created_at, timestamptz, updated_at } from './columns.ts';
import { agentMode, autonomyLevel, campaignStatus, goalMethod, lifecycleStage, sequenceFinish, stepMode, waitUnit } from './enums.ts';
import { users, workspaces } from './identity.ts';
import { mailboxes } from './sending.ts';

export const campaigns = pgTable(
  'campaigns',
  {
    id: text().primaryKey(), // cmp_
    workspace_id: text().notNull().references(() => workspaces.id),
    name: text().notNull(),
    description: text(),
    objective: text().notNull(), // plain-language business objective for the agent
    status: campaignStatus().notNull().default('draft'),
    owner_user_id: text().references(() => users.id),
    autonomy: autonomyLevel().notNull().default('assisted'),
    agent_mode: agentMode().notNull().default('built_in'),
    persona: jsonb().notNull(), // {sender_role, tone, language, style_notes, sign_off}
    agent_instructions: text(), // campaign-wide rules for the agent
    sending_window: jsonb().notNull(), // {"days":[1,2,3,4,5],"start":"08:30","end":"17:30","tz":"contact","fallback_tz":"America/New_York"}
    blackout_dates: date().array().notNull().default(sql`'{}'`),
    daily_new_threads_limit: integer().notNull().default(30), // new first-touch sends per day, all mailboxes combined
    sending_priority: text().notNull().default('normal'), // share of shared mailboxes (§8.3.3)
    final_wait_business_days: integer().notNull().default(5), // wait before the finish rule for stages with no sequence (§5.10)
    open_tracking: boolean().notNull().default(true),
    track_first_touch: boolean().notNull().default(true), // can turn off the pixel on the initial email only
    click_tracking: boolean().notNull().default(false),
    list_unsubscribe_header: boolean().notNull().default(true),
    unsubscribe_footer: boolean().notNull().default(true),
    delivery_grace_minutes: integer().notNull().default(240),
    reply_delay_min_minutes: integer().notNull().default(8),
    reply_delay_max_minutes: integer().notNull().default(45),
    auto_send_min_confidence: numeric({ precision: 4, scale: 3 }).notNull().default('0.800'),
    goal_auto_confirm_threshold: numeric({ precision: 4, scale: 3 }).notNull().default('0.850'),
    max_ai_replies_per_thread: integer().notNull().default(6),
    pause_on_manual_reply: boolean().notNull().default(true),
    on_not_interested: text().notNull().default('close_silently'),
    review_first_n_personalized: integer().notNull().default(10), // sample-review AI-personalized first touches
    enrollment_rules: jsonb()
      .notNull()
      .default({ skip_active_elsewhere: true, cooldown_days: 30, allow_role_accounts: false, allow_risky: false }),
    escalation_rules: jsonb().notNull().default([]), // custom keyword/regex → reason/priority
    links: jsonb().notNull().default({}), // {"booking":"https://cal.com/…","pricing":"https://…"} allowlist for the agent
    launched_at: timestamptz(),
    completed_at: timestamptz(),
    archived_at: timestamptz(),
    created_at: created_at(),
    updated_at: updated_at(),
    deleted_at: timestamptz(),
  },
  () => [
    check('campaigns_sending_priority_check', sql`sending_priority in ('high','normal','low')`),
    check('campaigns_on_not_interested_check', sql`on_not_interested in ('close_silently','send_polite_close')`),
  ],
);

export const campaign_mailboxes = pgTable(
  'campaign_mailboxes',
  {
    campaign_id: text().notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
    mailbox_id: text().notNull().references(() => mailboxes.id),
    weight: integer().notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.campaign_id, t.mailbox_id] })],
);

export const campaign_goals = pgTable(
  'campaign_goals',
  {
    id: text().primaryKey(), // gol_
    campaign_id: text().notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
    position: smallint().notNull(),
    key: text().notNull(), // 'call_booked' (used by integration events)
    name: text().notNull(), // 'Discovery call booked'
    success_criteria: text().notNull(), // for AI detection
    detection_methods: goalMethod().array().notNull().default(sql`'{ai,manual}'`),
    external_event_match: jsonb(), // {"source":"calcom","type":"BOOKING_CREATED"}
    tracked_link_key: text(), // key in campaigns.links
    click_counts_as_achieved: boolean().notNull().default(false),
    auto_confirm: boolean().notNull().default(true),
    playbook: text().notNull(), // how the agent pursues this goal
    lifecycle_stage_on_achieve: lifecycleStage(),
    marks_customer: boolean().notNull().default(false),
    value_cents: bigint({ mode: 'number' }),
  },
  (t) => [
    unique().on(t.campaign_id, t.position),
    unique().on(t.campaign_id, t.key),
    check('campaign_goals_position_check', sql`position >= 1`),
  ],
);

/**
 * §5.10. No stage may appear in two active sequences of the same campaign. That is enforced in
 * the service layer (inside the save transaction, with the campaign row locked) and re-checked
 * by preflight (§8.11).
 */
export const follow_up_sequences = pgTable(
  'follow_up_sequences',
  {
    id: text().primaryKey(), // seq_
    campaign_id: text().notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
    name: text().notNull(), // 'No reply to the first email'
    stages: text().array().notNull(), // each 'sent' | 'received' | 'responded' | 'goal:<goal key>'; never the final goal
    finish: sequenceFinish().notNull().default('exhaust'),
    final_wait_amount: smallint().notNull().default(5),
    final_wait_unit: waitUnit().notNull().default('business_days'),
    active: boolean().notNull().default(true),
    created_at: created_at(),
    updated_at: updated_at(),
  },
  () => [check('follow_up_sequences_stages_check', sql`cardinality(stages) >= 1`)],
);

/** The initial email (`sequence_id` null) and the follow-up steps. */
export const campaign_steps = pgTable(
  'campaign_steps',
  {
    id: text().primaryKey(), // stp_
    campaign_id: text().notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
    sequence_id: text().references(() => follow_up_sequences.id, { onDelete: 'cascade' }), // null = the campaign's initial email
    position: smallint().notNull(), // 1 for the initial email; 1..6 within a sequence
    wait_amount: smallint().notNull().default(0), // follow-ups: wait before sending (≥ 24 h); initial email: 0
    wait_unit: waitUnit().notNull().default('business_days'),
    wait_from: text().notNull().default('last_message'), // goal_event only in sequences covering exactly one goal stage
    send_as_reply: boolean().notNull().default(true), // follow-ups thread under the conversation ("Re: …")
    mode: stepMode().notNull().default('template'), // ai_adapt not allowed on the initial email
    ai_guidance: text(), // brief for ai_adapt / ai_write
    include_tracking: boolean(), // null = inherit from campaign
  },
  (t) => [
    unique().on(t.campaign_id, t.sequence_id, t.position).nullsNotDistinct(),
    check('campaign_steps_wait_from_check', sql`wait_from in ('last_message','goal_event')`),
    // 1..6 within a sequence is enforced when saving (§5.10); higher values appear only for a moment while steps are reordered.
    check('campaign_steps_position_check', sql`position >= 1`),
    check('campaign_steps_initial_email_check', sql`sequence_id is not null or (position = 1 and wait_amount = 0 and mode <> 'ai_adapt')`),
  ],
);

/** A/B variants; weights split traffic. */
export const campaign_step_variants = pgTable('campaign_step_variants', {
  id: text().primaryKey(), // var_
  step_id: text().notNull().references(() => campaign_steps.id, { onDelete: 'cascade' }),
  label: text().notNull().default('A'),
  weight: integer().notNull().default(1),
  subject_template: text(), // required on the initial email; ignored when send_as_reply
  body_template: text().notNull(), // Liquid (strict); §22.A
  active: boolean().notNull().default(true),
});
