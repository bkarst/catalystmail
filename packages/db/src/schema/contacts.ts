// Contacts & companies (spec §6.4).

import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgTable, primaryKey, text, unique, uniqueIndex } from 'drizzle-orm/pg-core';

import { bytea, citext, created_at, timestamptz, tsvector, updated_at } from './columns.ts';
import { consentBasis, emailVerification, lifecycleStage, subscriptionStatus, suppressionReason } from './enums.ts';
import { users, workspaces } from './identity.ts';

export const companies = pgTable(
  'companies',
  {
    id: text().primaryKey(), // co_
    workspace_id: text().notNull().references(() => workspaces.id),
    name: text().notNull(),
    domain: citext(),
    website: text(),
    industry: text(),
    employee_range: text(),
    country: text(),
    notes: text(),
    custom_fields: jsonb().notNull().default({}),
    created_at: created_at(),
    updated_at: updated_at(),
    deleted_at: timestamptz(),
  },
  (t) => [uniqueIndex('companies_domain_uq').on(t.workspace_id, t.domain).where(sql`deleted_at is null and domain is not null`)],
);

export const contacts = pgTable(
  'contacts',
  {
    id: text().primaryKey(), // ctc_
    workspace_id: text().notNull().references(() => workspaces.id),
    email: citext().notNull(),
    first_name: text(),
    last_name: text(),
    title: text(),
    phone: text(),
    linkedin_url: text(),
    company_id: text().references(() => companies.id),
    city: text(),
    country: text(),
    timezone: text(), // IANA; inferred if null (§12.5)
    lifecycle_stage: lifecycleStage().notNull().default('lead'),
    owner_user_id: text().references(() => users.id),
    source: text().notNull().default('manual'), // manual | import | api | referral | thread_participant
    source_detail: text(),
    email_verification: emailVerification().notNull().default('unverified'),
    email_verified_at: timestamptz(),
    email_flags: text().array().notNull().default(sql`'{}'`), // role, freemail, disposable, typo_suspect
    subscription_status: subscriptionStatus().notNull().default('subscribed'),
    unsubscribed_at: timestamptz(),
    consent_basis: consentBasis().notNull().default('unknown'),
    do_not_contact: boolean().notNull().default(false),
    custom_fields: jsonb().notNull().default({}),
    notes: text(),
    last_contacted_at: timestamptz(),
    last_replied_at: timestamptz(),
    last_opened_at: timestamptz(),
    search: tsvector().generatedAlwaysAs(
      sql`to_tsvector('simple', coalesce(first_name,'')||' '||coalesce(last_name,'')||' '||email||' '||coalesce(title,''))`,
    ),
    created_at: created_at(),
    updated_at: updated_at(),
    deleted_at: timestamptz(),
  },
  (t) => [
    uniqueIndex('contacts_email_uq').on(t.workspace_id, t.email).where(sql`deleted_at is null`),
    index('contacts_search_idx').using('gin', t.search),
    index('contacts_company_idx').on(t.company_id),
  ],
);

export const tags = pgTable(
  'tags',
  {
    id: text().primaryKey(), // tag_
    workspace_id: text().notNull().references(() => workspaces.id),
    name: text().notNull(),
    color: text().notNull().default('gray'),
  },
  (t) => [unique().on(t.workspace_id, t.name)],
);

export const contact_tags = pgTable(
  'contact_tags',
  {
    contact_id: text().notNull().references(() => contacts.id, { onDelete: 'cascade' }),
    tag_id: text().notNull().references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.contact_id, t.tag_id] })],
);

export const custom_field_defs = pgTable(
  'custom_field_defs',
  {
    id: text().primaryKey(), // cfd_
    workspace_id: text().notNull().references(() => workspaces.id),
    entity: text().notNull(),
    key: text().notNull(),
    label: text().notNull(),
    type: text().notNull(),
    options: jsonb(),
    required: boolean().notNull().default(false),
  },
  (t) => [
    unique().on(t.workspace_id, t.entity, t.key),
    check('custom_field_defs_entity_check', sql`entity in ('contact','company')`),
    check('custom_field_defs_type_check', sql`type in ('text','number','date','boolean','select','url')`),
  ],
);

export const lists = pgTable(
  'lists',
  {
    id: text().primaryKey(), // lst_
    workspace_id: text().notNull().references(() => workspaces.id),
    name: text().notNull(),
    kind: text().notNull(),
    filter: jsonb(), // dynamic: filter AST (§12.2)
    created_by: text().references(() => users.id),
    created_at: created_at(),
    updated_at: updated_at(),
  },
  () => [check('lists_kind_check', sql`kind in ('static','dynamic')`)],
);

export const list_members = pgTable(
  'list_members',
  {
    list_id: text().notNull().references(() => lists.id, { onDelete: 'cascade' }),
    contact_id: text().notNull().references(() => contacts.id, { onDelete: 'cascade' }),
    added_at: timestamptz().notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.list_id, t.contact_id] })],
);

export const suppressions = pgTable(
  'suppressions',
  {
    id: text().primaryKey(), // sup_
    workspace_id: text().notNull().references(() => workspaces.id),
    email: citext(),
    email_hash: bytea(), // kept after erasure so the block survives
    domain: citext(),
    reason: suppressionReason().notNull(),
    source: text().notNull(), // link | one_click | reply | bounce | complaint | manual | import | api
    note: text(),
    created_by: text().references(() => users.id),
    created_at: created_at(),
  },
  (t) => [
    check('suppressions_target_check', sql`email is not null or email_hash is not null or domain is not null`),
    uniqueIndex('suppressions_email_uq').on(t.workspace_id, t.email_hash).where(sql`email_hash is not null`),
    uniqueIndex('suppressions_domain_uq').on(t.workspace_id, t.domain).where(sql`domain is not null`),
  ],
);

export const imports = pgTable('imports', {
  id: text().primaryKey(), // imp_
  workspace_id: text().notNull().references(() => workspaces.id),
  filename: text().notNull(),
  storage_key: text().notNull(),
  headers: text().array().notNull().default(sql`'{}'`), // the file's column headers, in order
  mapping: jsonb(), // {"Email": "email", "Company": "company", "Industry": "custom.industry", "Notes": null}
  options: jsonb().notNull().default({}), // consent basis and owner given to new contacts (§12.3)
  dedupe_strategy: text().notNull().default('skip'),
  target_list_id: text().references(() => lists.id),
  tag_ids: text().array().notNull().default(sql`'{}'`),
  status: text().notNull().default('uploaded'), // uploaded | mapped | processing | done | failed
  total_rows: integer(),
  processed_rows: integer().notNull().default(0), // progress while processing
  created_count: integer().default(0),
  updated_count: integer().default(0),
  skipped_count: integer().default(0),
  error_count: integer().default(0),
  errors: jsonb().notNull().default([]),
  created_by: text().references(() => users.id),
  created_at: created_at(),
  finished_at: timestamptz(),
});
