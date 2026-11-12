// Activity log, integrations, webhooks, idempotency and audit (spec §6.9).

import { sql } from 'drizzle-orm';
import { bigint, bigserial, boolean, check, index, inet, integer, jsonb, pgTable, primaryKey, smallint, text, unique } from 'drizzle-orm/pg-core';

import { campaigns } from './campaigns.ts';
import { bytea, citext, created_at, timestamptz } from './columns.ts';
import { contacts } from './contacts.ts';
import { actorType } from './enums.ts';
import { users } from './identity.ts';
import { threads } from './threads.ts';

/** Contact and thread timeline, and the event log. Types are listed in §22.C. */
export const activities = pgTable(
  'activities',
  {
    id: text().primaryKey(), // act_
    workspace_id: text().notNull(),
    contact_id: text().references(() => contacts.id),
    thread_id: text().references(() => threads.id),
    campaign_id: text().references(() => campaigns.id),
    type: text().notNull(),
    actor_type: actorType().notNull(),
    actor_id: text(),
    data: jsonb().notNull().default({}), // {"from":"sent","to":"responded","reason":"…"}
    occurred_at: timestamptz().notNull().defaultNow(), // when it happened (a booking's start time, say)
    created_at: timestamptz().notNull().defaultNow(), // when it was recorded: the webhook dispatcher's clock (§13.6)
  },
  (t) => [
    index('activities_contact_idx').on(t.contact_id, t.occurred_at.desc()),
    index('activities_thread_idx').on(t.thread_id, t.occurred_at.desc()),
    index('activities_created_idx').on(t.workspace_id, t.created_at),
  ],
);

export const integrations = pgTable('integrations', {
  id: text().primaryKey(), // int_
  workspace_id: text().notNull(),
  kind: text().notNull(), // stripe | calcom | calendly | generic
  signing_secret_enc: bytea().notNull(),
  config: jsonb().notNull().default({}),
  active: boolean().notNull().default(true),
});

export const integration_events = pgTable(
  'integration_events',
  {
    id: text().primaryKey(), // ine_
    workspace_id: text().notNull(),
    integration_id: text().references(() => integrations.id),
    source: text().notNull(),
    external_id: text().notNull(),
    type: text().notNull(),
    contact_email: citext(),
    goal_key: text(),
    value_cents: bigint({ mode: 'number' }),
    payload: jsonb().notNull(),
    matched_contact_id: text().references(() => contacts.id),
    matched_thread_id: text().references(() => threads.id),
    outcome: text(),
    received_at: timestamptz().notNull().defaultNow(),
    processed_at: timestamptz(),
  },
  (t) => [unique().on(t.workspace_id, t.source, t.external_id)], // dedupe
);

/** What was sent to whom, and why (§11.2). */
export const notifications = pgTable(
  'notifications',
  {
    id: text().primaryKey(), // ntf_
    workspace_id: text().notNull(),
    user_id: text().references(() => users.id), // null for the Slack channel
    activity_id: text(), // the event it is about, or `digest:YYYY-MM-DD` for a day's digest
    channel: text().notNull(),
    kind: text().notNull(), // escalation | breaker | sla_breached | poll_failed | webhook_disabled | ai_budget | digest | invite
    priority: text().notNull().default('normal'), // urgent | high | normal
    title: text().notNull(),
    body: text().notNull(),
    link: text(),
    status: text().notNull().default('pending'), // pending | sent | failed | skipped
    error: text(),
    send_after: timestamptz(), // quiet hours hold high-priority mail until morning
    sent_at: timestamptz(),
    created_at: created_at(),
  },
  (t) => [
    unique('notifications_activity_user_channel_key').on(t.activity_id, t.user_id, t.channel).nullsNotDistinct(),
    index('notifications_pending_idx').on(t.status, t.send_after).where(sql`status = 'pending'`),
    check('notifications_channel_check', sql`channel in ('email','slack','push')`),
  ],
);

export const webhook_endpoints = pgTable('webhook_endpoints', {
  id: text().primaryKey(), // whk_
  workspace_id: text().notNull(),
  url: text().notNull(),
  description: text(),
  events: text().array().notNull(),
  secret_enc: bytea().notNull(),
  active: boolean().notNull().default(true),
  consecutive_failures: integer().notNull().default(0),
  disabled_at: timestamptz(),
  created_at: created_at(),
});

export const webhook_deliveries = pgTable('webhook_deliveries', {
  id: text().primaryKey(), // whd_
  endpoint_id: text().notNull().references(() => webhook_endpoints.id, { onDelete: 'cascade' }),
  event_id: text().notNull(),
  event_type: text().notNull(),
  payload: jsonb().notNull(),
  attempt: smallint().notNull().default(0),
  status: text().notNull().default('pending'),
  response_status: integer(),
  response_snippet: text(),
  next_attempt_at: timestamptz(),
  delivered_at: timestamptz(),
  created_at: created_at(),
}, (t) => [unique('webhook_deliveries_event_unique').on(t.endpoint_id, t.event_id)]);

/** Stored responses for `Idempotency-Key` replays; purged after 24 h. */
export const idempotency_keys = pgTable(
  'idempotency_keys',
  {
    workspace_id: text().notNull(),
    principal_id: text().notNull(),
    key: text().notNull(),
    request_hash: bytea().notNull(),
    response_status: integer(),
    response_body: jsonb(),
    created_at: created_at(),
  },
  (t) => [primaryKey({ columns: [t.workspace_id, t.principal_id, t.key] })],
);

/** Browsers a person allowed to show alerts (§11.2), as the browser's push service gave them. */
export const push_subscriptions = pgTable(
  'push_subscriptions',
  {
    id: text().primaryKey(), // psb_
    workspace_id: text().notNull(),
    user_id: text().notNull().references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text().notNull().unique(), // the push service URL for this browser
    p256dh: text().notNull(), // the browser's public key (RFC 8291)
    auth: text().notNull(), // its authentication secret
    user_agent: text(),
    created_at: created_at(),
    last_sent_at: timestamptz(),
  },
  (t) => [index('push_subscriptions_user_idx').on(t.user_id)],
);

/** Requests per key per minute (§13.3), counted in fixed one-minute windows; old windows are purged. */
export const rate_limit_windows = pgTable(
  'rate_limit_windows',
  {
    key: text().notNull(), // `<principal id>:general` or `<principal id>:send`
    window_start: timestamptz().notNull(),
    count: integer().notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.window_start] })],
);

/** Security-relevant admin actions. */
export const audit_log = pgTable('audit_log', {
  id: bigserial({ mode: 'number' }).primaryKey(),
  workspace_id: text().notNull(),
  actor_type: actorType().notNull(),
  actor_id: text(),
  action: text().notNull(),
  target_type: text(),
  target_id: text(),
  diff: jsonb(),
  ip: inet(),
  user_agent: text(),
  created_at: created_at(),
});
