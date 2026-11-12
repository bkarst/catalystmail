// Sign-in (spec §6 "owned by the auth library", §16): Better Auth's own tables, in its core schema
// (user, session, account, verification, and the rate-limit table for login throttling), named
// `auth_*` and mapped to snake_case columns in the server's Better Auth configuration. An auth user
// is linked to a Catalyst `users` row by email; nothing else in Catalyst reads these tables.

import { bigint, boolean, index, integer, pgTable, text } from 'drizzle-orm/pg-core';

import { timestamptz } from './columns.ts';

export const auth_users = pgTable('auth_users', {
  id: text().primaryKey(),
  name: text().notNull(),
  email: text().notNull().unique(),
  email_verified: boolean().notNull().default(false),
  image: text(),
  two_factor_enabled: boolean().notNull().default(false), // the two-factor plugin: TOTP set up and confirmed
  created_at: timestamptz().notNull().defaultNow(),
  updated_at: timestamptz().notNull().defaultNow(),
});

export const auth_sessions = pgTable(
  'auth_sessions',
  {
    id: text().primaryKey(),
    user_id: text().notNull().references(() => auth_users.id, { onDelete: 'cascade' }),
    token: text().notNull().unique(),
    expires_at: timestamptz().notNull(),
    ip_address: text(),
    user_agent: text(),
    created_at: timestamptz().notNull().defaultNow(),
    updated_at: timestamptz().notNull().defaultNow(),
  },
  (t) => [index('auth_sessions_user_idx').on(t.user_id)],
);

export const auth_accounts = pgTable(
  'auth_accounts',
  {
    id: text().primaryKey(),
    user_id: text().notNull().references(() => auth_users.id, { onDelete: 'cascade' }),
    account_id: text().notNull(),
    provider_id: text().notNull(),
    access_token: text(),
    refresh_token: text(),
    id_token: text(),
    access_token_expires_at: timestamptz(),
    refresh_token_expires_at: timestamptz(),
    scope: text(),
    password: text(), // the library's own salted hash, for email and password sign-in
    created_at: timestamptz().notNull().defaultNow(),
    updated_at: timestamptz().notNull().defaultNow(),
  },
  (t) => [index('auth_accounts_user_idx').on(t.user_id)],
);

export const auth_verifications = pgTable(
  'auth_verifications',
  {
    id: text().primaryKey(),
    identifier: text().notNull(),
    value: text().notNull(),
    expires_at: timestamptz().notNull(),
    created_at: timestamptz().notNull().defaultNow(),
    updated_at: timestamptz().notNull().defaultNow(),
  },
  (t) => [index('auth_verifications_identifier_idx').on(t.identifier)],
);

/** TOTP two-factor sign-in (§16): the library keeps the secret encrypted and the backup codes. */
export const auth_two_factors = pgTable(
  'auth_two_factors',
  {
    id: text().primaryKey(),
    user_id: text().notNull().references(() => auth_users.id, { onDelete: 'cascade' }),
    secret: text().notNull(),
    backup_codes: text().notNull(),
    verified: boolean().default(true),
    failed_verification_count: integer().default(0),
    locked_until: timestamptz(),
  },
  (t) => [index('auth_two_factors_user_idx').on(t.user_id), index('auth_two_factors_secret_idx').on(t.secret)],
);

/** Login rate limiting (§16), kept in Postgres so every app process shares it. */
export const auth_rate_limits = pgTable('auth_rate_limits', {
  id: text().primaryKey(),
  key: text().notNull().unique(),
  count: integer().notNull(),
  last_request: bigint({ mode: 'number' }).notNull(),
});
