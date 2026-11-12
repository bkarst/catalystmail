// AI runs, escalations and the knowledge base (spec §6.8).

import { sql } from 'drizzle-orm';
import { bigint, boolean, check, index, integer, jsonb, numeric, pgTable, text } from 'drizzle-orm/pg-core';

import { campaign_goals, campaigns } from './campaigns.ts';
import { created_at, timestamptz, updated_at } from './columns.ts';
import { escalationPriority, escalationReason, escalationStatus } from './enums.ts';
import { users, workspaces } from './identity.ts';
import { messages, threads } from './threads.ts';

export const knowledge_items = pgTable(
  'knowledge_items',
  {
    id: text().primaryKey(), // kbi_
    workspace_id: text().notNull().references(() => workspaces.id),
    campaign_id: text().references(() => campaigns.id), // null = workspace-wide
    kind: text().notNull(),
    title: text().notNull(),
    content: text().notNull(), // markdown; the agent may quote it to prospects
    visibility: text().notNull().default('shareable'), // internal is never sent to the model
    tags: text().array().notNull().default(sql`'{}'`),
    source: text().notNull().default('manual'), // manual | escalation | import | api
    source_escalation_id: text(),
    active: boolean().notNull().default(true),
    created_by: text().references(() => users.id),
    created_at: created_at(),
    updated_at: updated_at(),
    deleted_at: timestamptz(),
  },
  () => [
    check('knowledge_items_kind_check', sql`kind in ('product','pricing','faq','objection','policy','case_study','link','other')`),
    check('knowledge_items_visibility_check', sql`visibility in ('shareable','internal')`),
  ],
);

export const ai_runs = pgTable(
  'ai_runs',
  {
    id: text().primaryKey(), // air_
    workspace_id: text().notNull(),
    thread_id: text().references(() => threads.id),
    message_id: text().references(() => messages.id),
    task: text().notNull(), // classify_conversation | analyze_inbound | draft_reply | draft_follow_up | personalize | summarize | kb_test
    provider: text().notNull().default('anthropic'),
    model: text().notNull(), // exact version as reported by the provider (e.g. 'jev-1.13.0')
    effort: text(),
    prompt_version: text().notNull(), // for Jev: the classifier version, e.g. 'conversation.v1'
    trigger_message_id: text(), // the message that caused this run
    input_tokens: integer(),
    output_tokens: integer(),
    cache_read_tokens: integer(),
    cache_write_tokens: integer(),
    cost_usd_micros: bigint({ mode: 'number' }),
    latency_ms: integer(),
    stop_reason: text(),
    status: text().notNull(), // ok | refusal | error | invalid_output | guardrail_blocked
    output: jsonb(),
    guardrail_report: jsonb(),
    decision: text(), // auto_send | queue_approval | escalate | no_action
    error: text(),
    created_at: created_at(),
  },
  (t) => [
    check('ai_runs_provider_check', sql`provider in ('anthropic','typesafe')`),
    // The month's spend against the budget (§10.2), and the per-thread daily cap.
    index('ai_runs_workspace_idx').on(t.workspace_id, t.created_at),
    index('ai_runs_thread_idx').on(t.thread_id, t.created_at),
  ],
);

export const escalations = pgTable(
  'escalations',
  {
    id: text().primaryKey(), // esc_
    workspace_id: text().notNull().references(() => workspaces.id),
    thread_id: text().references(() => threads.id),
    trigger_message_id: text().references(() => messages.id),
    reason: escalationReason().notNull(), // primary
    reasons: escalationReason().array().notNull(), // all matched
    priority: escalationPriority().notNull(),
    title: text().notNull(), // "Asked about SAML SSO"
    explanation: text().notNull(), // the agent's plain-language explanation
    questions: jsonb().notNull().default([]), // [{text, why_unanswerable}]
    suggested_draft_id: text().references(() => messages.id),
    goal_id: text().references(() => campaign_goals.id), // goal_confirmation: the goal to confirm
    goal_p: numeric({ precision: 4, scale: 3 }), // and how likely it is reached
    status: escalationStatus().notNull().default('open'),
    assigned_user_id: text().references(() => users.id),
    due_at: timestamptz().notNull(),
    snoozed_until: timestamptz(),
    resolution: text(), // replied | answered_for_ai | goal_confirmed | goal_rejected | took_over | closed_thread | dismissed
    resolution_note: text(),
    knowledge_item_id: text().references(() => knowledge_items.id),
    resolved_by: text().references(() => users.id),
    resolved_at: timestamptz(),
    created_at: created_at(),
    updated_at: updated_at(),
  },
  (t) => [
    index('escalations_open_idx').on(t.workspace_id, t.status, t.priority, t.due_at).where(sql`status in ('open','snoozed')`),
  ],
);
