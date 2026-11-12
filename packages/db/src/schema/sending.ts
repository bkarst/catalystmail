// Sending infrastructure (spec §6.5): domains, mailboxes, polling state, daily stats, capacity.

import { sql } from 'drizzle-orm';
import { bigint, boolean, check, date, integer, jsonb, pgTable, primaryKey, smallint, text, unique } from 'drizzle-orm/pg-core';

import { bytea, citext, created_at, timestamptz, updated_at } from './columns.ts';
import { mailboxAuth, mailboxStatus } from './enums.ts';
import { users, workspaces } from './identity.ts';

export const sending_domains = pgTable(
  'sending_domains',
  {
    id: text().primaryKey(), // dom_
    workspace_id: text().notNull().references(() => workspaces.id),
    domain: citext().notNull(),
    tracking_host: citext(), // e.g. 'go.getacme.com' (CNAME → Catalyst)
    spf_status: text(),
    dkim_status: text(),
    dkim_selectors: text().array().notNull().default(sql`'{}'`),
    dmarc_status: text(),
    dmarc_policy: text(),
    mx_status: text(),
    tracking_status: text(),
    alignment_status: text(), // aligned | not_aligned | unknown, from Authentication-Results of the self-test
    blocklisted: boolean().notNull().default(false),
    blocklist_details: jsonb().notNull().default([]),
    first_touches_paused_at: timestamptz(), // SPF, DKIM or DMARC started failing: no first touches until a person resumes them (§8.9)
    first_touches_paused_reason: text(), // which records failed, e.g. 'dkim, dmarc'
    reputation_score: smallint().notNull().default(100),
    reputation_band: text().notNull().default('healthy'), // healthy | at_risk | critical | paused (§8.10)
    reputation_inputs: jsonb().notNull().default({}), // latest score components and the points each cost
    band_changed_at: timestamptz(),
    postmaster_connected: boolean().notNull().default(false),
    postmaster_data: jsonb(), // latest Gmail spam rate, auth rates, compliance status
    postmaster_credentials_enc: bytea(), // the Google refresh token for Postmaster Tools, sealed (§16)
    postmaster_credentials_key_version: integer(),
    ramp_plan: text().notNull().default('new_domain'),
    ramp_custom_schedule: jsonb(), // [{"step":0,"cap":20},…] when ramp_plan = 'custom'
    ramp_step: smallint().notNull().default(0),
    ramp_status: text().notNull().default('ramping'), // ramping | holding | stepped_back | complete | stopped
    ramp_status_reason: text(),
    ramp_manual_hold: boolean().notNull().default(false),
    last_sending_day: date(), // last day that counted toward the ramp (§8.3.1)
    cap_override: integer(),
    cap_override_until: date(),
    cap_override_reason: text(),
    cap_override_by: text().references(() => users.id),
    check_details: jsonb().notNull().default({}),
    last_checked_at: timestamptz(),
    created_at: created_at(),
  },
  (t) => [
    unique().on(t.workspace_id, t.domain),
    check('sending_domains_ramp_plan_check', sql`ramp_plan in ('new_domain','aged_domain','established','custom')`),
  ],
);

export const mailboxes = pgTable(
  'mailboxes',
  {
    id: text().primaryKey(), // mbx_
    workspace_id: text().notNull().references(() => workspaces.id),
    sending_domain_id: text().notNull().references(() => sending_domains.id),
    email: citext().notNull(),
    display_name: text().notNull(),
    signature_text: text(),
    signature_html: text(),
    owner_user_id: text().references(() => users.id), // gets this mailbox's escalations by default
    auth: mailboxAuth().notNull(),
    smtp_host: text().notNull(),
    smtp_port: integer().notNull(),
    smtp_secure: text().notNull(),
    smtp_username: text().notNull(),
    imap_host: text().notNull(),
    imap_port: integer().notNull().default(993),
    imap_username: text().notNull(),
    credentials_enc: bytea().notNull(), // password or OAuth refresh token
    credentials_key_version: integer().notNull(),
    folders: jsonb().notNull(), // {"inbox":"INBOX","sent":"[Gmail]/Sent Mail","junk":"[Gmail]/Spam"}
    append_to_sent: boolean().notNull().default(false), // true when the provider doesn't save SMTP submissions
    catalyst_dkim: jsonb(), // optional {selector, private_key_enc, public_key} for generic SMTP hosts
    status: mailboxStatus().notNull().default('pending'),
    status_reason: text(),
    daily_limit: integer().notNull().default(40),
    hourly_limit: integer().notNull().default(12),
    min_interval_sec: integer().notNull().default(120),
    max_interval_sec: integer().notNull().default(420),
    warmup_enabled: boolean().notNull().default(true),
    warmup_started_at: date(),
    warmup_step: smallint().notNull().default(0), // moves with the health band (§8.3.2)
    warmup_start_volume: integer().notNull().default(10),
    warmup_daily_increment: integer().notNull().default(5),
    health_score: smallint().notNull().default(100),
    health_band: text().notNull().default('healthy'),
    health_inputs: jsonb().notNull().default({}),
    last_sent_at: timestamptz(),
    last_poll_at: timestamptz(),
    last_poll_status: text(),
    next_poll_at: timestamptz(),
    created_at: created_at(),
    updated_at: updated_at(),
  },
  (t) => [
    unique().on(t.workspace_id, t.email),
    check('mailboxes_smtp_secure_check', sql`smtp_secure in ('tls','starttls')`),
    check('mailboxes_daily_limit_check', sql`daily_limit between 1 and 500`),
  ],
);

export const mailbox_sync_state = pgTable(
  'mailbox_sync_state',
  {
    mailbox_id: text().notNull().references(() => mailboxes.id, { onDelete: 'cascade' }),
    folder: text().notNull(),
    uid_validity: bigint({ mode: 'number' }).notNull(),
    last_seen_uid: bigint({ mode: 'number' }).notNull().default(0),
    highest_modseq: bigint({ mode: 'number' }),
    updated_at: updated_at(),
  },
  (t) => [primaryKey({ columns: [t.mailbox_id, t.folder] })],
);

export const poll_runs = pgTable(
  'poll_runs',
  {
    id: text().primaryKey(), // prn_
    mailbox_id: text().notNull().references(() => mailboxes.id),
    trigger: text().notNull(),
    status: text().notNull().default('running'), // running | ok | partial | error
    started_at: timestamptz().notNull().defaultNow(),
    finished_at: timestamptz(),
    duration_ms: integer(),
    fetched_count: integer().default(0),
    matched_count: integer().default(0),
    ignored_count: integer().default(0),
    error: text(),
  },
  () => [check('poll_runs_trigger_check', sql`trigger in ('schedule','manual','api','catch_up')`)],
);

export const mailbox_daily_stats = pgTable(
  'mailbox_daily_stats',
  {
    mailbox_id: text().notNull().references(() => mailboxes.id, { onDelete: 'cascade' }),
    day: date().notNull(),
    sent: integer().default(0),
    new_threads: integer().default(0),
    replies_sent: integer().default(0),
    bounced_hard: integer().default(0),
    bounced_soft: integer().default(0),
    complaints: integer().default(0),
    inbound_replies: integer().default(0),
    opens_human: integer().default(0),
    unsubscribes: integer().default(0),
  },
  (t) => [primaryKey({ columns: [t.mailbox_id, t.day] })],
);

/** One row per domain per day; drives the ramp chart. */
export const domain_daily_stats = pgTable(
  'domain_daily_stats',
  {
    domain_id: text().notNull().references(() => sending_domains.id, { onDelete: 'cascade' }),
    day: date().notNull(),
    planned_cap: integer().notNull(),
    sent: integer().default(0),
    replies_sent: integer().default(0),
    bounced_hard: integer().default(0),
    complaints: integer().default(0),
    opens_human: integer().default(0),
    junk_replies: integer().default(0),
    reputation_score: smallint(),
    reputation_band: text(),
    ramp_step: smallint(),
    ramp_action: text(), // advanced | held | stepped_back | stopped | none
    counted_as_sending_day: boolean().notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.domain_id, t.day] })],
);

/** Today's allocation plus the 7-day forecast (§8.3.3). */
export const capacity_plans = pgTable(
  'capacity_plans',
  {
    day: date().notNull(),
    mailbox_id: text().notNull().references(() => mailboxes.id, { onDelete: 'cascade' }),
    bucket: text().notNull(), // a campaign id, or 'reply_reserve' / 'follow_ups'
    kind: text().notNull(),
    allocated: integer().notNull(),
    used: integer().notNull().default(0),
    limited_by: text(), // domain_ramp | domain_reputation | domain_auth | mailbox_cap | mailbox_health | campaign_share | campaign_limit
    computed_at: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.day, t.mailbox_id, t.bucket, t.kind] }),
    check('capacity_plans_kind_check', sql`kind in ('allocation','forecast')`),
  ],
);
