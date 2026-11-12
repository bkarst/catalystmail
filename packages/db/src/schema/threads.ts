// Threads, messages and tracking (spec §6.7).

import { sql } from 'drizzle-orm';
import { bigint, boolean, check, date, index, integer, jsonb, numeric, pgTable, primaryKey, smallint, text, unique } from 'drizzle-orm/pg-core';

import { campaign_goals, campaign_step_variants, campaign_steps, campaigns, follow_up_sequences } from './campaigns.ts';
import { bytea, citext, created_at, timestamptz, updated_at } from './columns.ts';
import { contacts } from './contacts.ts';
import {
  goalMethod, inboundKind, matchMethod, messageAuthor, messageDirection, messageStatus,
  nextActionType, openStatus, threadStage, threadState, trackingSource, trackingType,
} from './enums.ts';
import { users, workspaces } from './identity.ts';
import { mailboxes } from './sending.ts';

export const threads = pgTable(
  'threads',
  {
    id: text().primaryKey(), // thr_
    workspace_id: text().notNull().references(() => workspaces.id),
    campaign_id: text().notNull().references(() => campaigns.id),
    contact_id: text().notNull().references(() => contacts.id),
    mailbox_id: text().references(() => mailboxes.id), // picked by the capacity plan at first send, then fixed (§8.3.3)
    stage: threadStage().notNull().default('queued'),
    stage_rank: smallint().notNull().default(0), // 0..3 + goal position (for sorting and funnels)
    achieved_goal_id: text().references(() => campaign_goals.id), // highest achieved goal
    manual_floor_rank: smallint().notNull().default(0),
    state: threadState().notNull().default('active'),
    state_reason: text(),
    next_action_type: nextActionType().notNull().default('send_initial'),
    next_action_at: timestamptz(),
    next_action_message_id: text(),
    throttle_reason: text(), // which limit postponed the due send (§8.3.5); null when on time
    waiting_since: timestamptz(), // start of the current wait for the contact (§5.10); null when not waiting
    follow_up_sequence_id: text().references(() => follow_up_sequences.id), // sequence for the current stage, if any
    follow_up_step_position: smallint(), // next step to send in that sequence
    follow_ups_stopped: boolean().notNull().default(false), // a person stopped follow-ups for this thread
    follow_ups_not_before: timestamptz(), // earliest time for the next follow-up: set when a hold ends or follow-ups resume (§5.10)
    check_in_at: timestamptz(), // a check-in the contact asked for, replacing the sequence until it is written (§5.10 rule 5)
    check_in_set_at: timestamptz(), // when it was set: a human reply after this cancels it
    finish_applied_at: timestamptz(), // when the current wait's finish rule was carried out, so it isn't repeated (§5.10)
    follow_ups_sent: smallint().notNull().default(0), // lifetime count (the 30-day cap is computed from messages)
    ai_replies_sent: smallint().notNull().default(0),
    ai_paused: boolean().notNull().default(false), // human took over
    manually_paused: boolean().notNull().default(false), // paused by a person (§5.4)
    stopped_at: timestamptz(), // stopped by hand (§5.4)
    closed_reason: text(), // not_interested | wrong_person | manual | …
    closed_at: timestamptz(), // last close; a human reply stored after it reopens the thread (§5.4)
    subject: text(), // normalized root subject
    root_message_id_header: text(),
    open_status: openStatus().notNull().default('unopened'),
    open_count: integer().notNull().default(0),
    first_opened_at: timestamptz(),
    last_opened_at: timestamptz(),
    clicked: boolean().notNull().default(false),
    first_sent_at: timestamptz(),
    received_at: timestamptz(),
    responded_at: timestamptz(),
    completed_at: timestamptz(),
    last_message_at: timestamptz(),
    last_inbound_at: timestamptz(),
    last_outbound_at: timestamptz(),
    latest_intent: text(), // Jev's top intent and its probability (§10.4)
    latest_intent_p: numeric({ precision: 4, scale: 3 }),
    latest_sentiment: text(),
    temperature: numeric({ precision: 3, scale: 2 }), // 0–3 (cold → ready to buy)
    classification_run_id: text(), // latest classify_conversation run in ai_runs
    classification_fallback: boolean().notNull().default(false), // last classification came from Claude alone
    ai_summary: text(),
    ai_summary_at: timestamptz(),
    assigned_user_id: text().references(() => users.id),
    open_escalations: integer().notNull().default(0),
    version: integer().notNull().default(0), // optimistic lock for thread.evaluate
    created_at: created_at(),
    updated_at: updated_at(),
  },
  (t) => [
    unique().on(t.campaign_id, t.contact_id),
    check('threads_goal_stage_check', sql`(stage = 'goal_achieved') = (achieved_goal_id is not null)`),
    check('threads_mailbox_check', sql`stage = 'queued' or mailbox_id is not null`),
    index('threads_due_idx').on(t.next_action_at).where(sql`state = 'active' and next_action_type <> 'none'`),
    index('threads_campaign_idx').on(t.campaign_id, t.stage_rank, t.state),
    index('threads_contact_idx').on(t.contact_id),
  ],
);

export const thread_goal_achievements = pgTable(
  'thread_goal_achievements',
  {
    thread_id: text().notNull().references(() => threads.id, { onDelete: 'cascade' }),
    goal_id: text().notNull().references(() => campaign_goals.id),
    achieved_at: timestamptz().notNull(),
    method: goalMethod().notNull(),
    confidence: numeric({ precision: 4, scale: 3 }),
    evidence: text(), // quote or event summary
    event_at: timestamptz(), // when the goal's event happens, e.g. the booked call's start time (§5.10)
    message_id: text(),
    integration_event_id: text(),
    confirmed_by: text().references(() => users.id),
    revoked_at: timestamptz(),
    revoked_by: text().references(() => users.id),
    revoke_reason: text(),
  },
  (t) => [primaryKey({ columns: [t.thread_id, t.goal_id] })],
);

/** Extra people who joined a thread (cc, forwards). */
export const thread_participants = pgTable(
  'thread_participants',
  {
    thread_id: text().notNull().references(() => threads.id, { onDelete: 'cascade' }),
    contact_id: text().notNull().references(() => contacts.id),
    role: text().notNull().default('cc'),
    added_at: timestamptz().notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.thread_id, t.contact_id] })],
);

export const messages = pgTable(
  'messages',
  {
    id: text().primaryKey(), // msg_
    workspace_id: text().notNull().references(() => workspaces.id),
    thread_id: text().references(() => threads.id), // null = unmatched inbound
    ignored_at: timestamptz(), // unmatched inbound a person chose to ignore (ignoreUnmatchedMessage)
    mailbox_id: text().notNull().references(() => mailboxes.id),
    direction: messageDirection().notNull(),
    status: messageStatus().notNull(),
    author: messageAuthor().notNull(),
    step_id: text().references(() => campaign_steps.id),
    variant_id: text().references(() => campaign_step_variants.id),
    goal_id: text().references(() => campaign_goals.id), // the goal whose playbook produced the message
    message_id_header: text().notNull(), // '<…@domain>'
    in_reply_to_header: text(),
    references_headers: text().array().notNull().default(sql`'{}'`),
    match_method: matchMethod(),
    from_email: citext().notNull(),
    from_name: text(),
    to_emails: jsonb().notNull(),
    cc_emails: jsonb().notNull().default([]),
    reply_to: text(),
    subject: text().notNull(),
    body_text: text(),
    body_html: text(), // inbound HTML stored raw; sanitized at render time
    stripped_text: text(), // inbound: reply without quoted history or signature
    snippet: text(),
    has_attachments: boolean().notNull().default(false),
    raw_storage_key: text(),
    size_bytes: integer(),
    scheduled_for: timestamptz(),
    sent_at: timestamptz(),
    received_at: timestamptz(),
    smtp_response: text(),
    smtp_attempts: smallint().notNull().default(0),
    error: text(),
    imap_folder: text(),
    imap_uid: bigint({ mode: 'number' }),
    inbound_kind: inboundKind(),
    auto_reply_until: date(),
    dsn_status: text(), // e.g. '5.1.1'
    needs_reply_p: numeric({ precision: 4, scale: 3 }), // Jev's needs_reply for this inbound message; null until classified (§10.4)
    tracking_token: text().unique(),
    open_count: integer().notNull().default(0),
    first_opened_at: timestamptz(),
    last_opened_at: timestamptz(),
    human_open: boolean().notNull().default(false),
    ai_run_id: text(),
    approved_by: text().references(() => users.id),
    approved_at: timestamptz(),
    lint_report: jsonb(), // §8.7 results at compose time
    created_at: created_at(),
    updated_at: updated_at(),
  },
  (t) => [
    unique().on(t.mailbox_id, t.message_id_header),
    index('messages_thread_idx').on(t.thread_id, sql`coalesce(sent_at, received_at, created_at)`),
    index('messages_refs_idx').using('gin', t.references_headers),
    index('messages_pending_idx').on(t.status).where(sql`status in ('pending_approval','scheduled','sending','send_unknown')`),
  ],
);

export const attachments = pgTable('attachments', {
  id: text().primaryKey(), // att_
  message_id: text().notNull().references(() => messages.id, { onDelete: 'cascade' }),
  filename: text(),
  content_type: text(),
  size_bytes: integer(),
  storage_key: text().notNull(),
  content_id: text(),
  is_inline: boolean().default(false),
});

export const tracked_links = pgTable('tracked_links', {
  id: text().primaryKey(), // lnk_
  message_id: text().notNull().references(() => messages.id, { onDelete: 'cascade' }),
  position: smallint().notNull(),
  original_url: text().notNull(),
  link_key: text(), // e.g. 'booking'
});

export const tracking_events = pgTable(
  'tracking_events',
  {
    id: text().primaryKey(), // trk_
    workspace_id: text().notNull(),
    message_id: text().notNull().references(() => messages.id),
    thread_id: text().references(() => threads.id),
    type: trackingType().notNull(),
    link_id: text().references(() => tracked_links.id),
    source: trackingSource().notNull(),
    occurred_at: timestamptz().notNull().defaultNow(),
    ip_hash: bytea(), // the IP is stored only as a salted hash
    user_agent: text(),
  },
  (t) => [index('tracking_events_msg_idx').on(t.message_id, t.occurred_at)],
);
