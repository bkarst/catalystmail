// Identity & access (spec §6.3). Auth sessions, accounts and 2FA tables belong to the auth library.

import { jsonb, pgTable, text } from 'drizzle-orm/pg-core';

import { bytea, citext, created_at, timestamptz, updated_at } from './columns.ts';
import { userRole } from './enums.ts';

export const workspaces = pgTable('workspaces', {
  id: text().primaryKey(), // wsp_
  name: text().notNull(),
  physical_address: text().notNull(), // CAN-SPAM footer
  default_timezone: text().notNull().default('UTC'), // IANA
  settings: jsonb().notNull().default({}), // AI budget, notification routing, feature flags
  created_at: created_at(),
  updated_at: updated_at(),
});

export const users = pgTable('users', {
  id: text().primaryKey(), // usr_
  workspace_id: text().notNull().references(() => workspaces.id),
  email: citext().notNull().unique(),
  name: text().notNull(),
  role: userRole().notNull().default('member'),
  timezone: text(),
  notification_prefs: jsonb().notNull().default({}),
  last_login_at: timestamptz(),
  created_at: created_at(),
  updated_at: updated_at(),
  deactivated_at: timestamptz(), // removed from the team; kept because history points at them
});

export const api_keys = pgTable('api_keys', {
  id: text().primaryKey(), // key_
  workspace_id: text().notNull().references(() => workspaces.id),
  name: text().notNull(),
  prefix: text().notNull(), // e.g. 'ck_live_9F2a' (shown in UI)
  key_hash: bytea().notNull().unique(), // SHA-256 of the full secret; the secret is shown once
  scopes: text().array().notNull(), // §13.2
  created_by: text().references(() => users.id),
  last_used_at: timestamptz(),
  expires_at: timestamptz(),
  revoked_at: timestamptz(),
  created_at: created_at(),
});
