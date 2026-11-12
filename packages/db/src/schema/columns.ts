// Column types Drizzle has no built-in for, and the timestamp columns every table shares.
// Property names are the column names (snake_case), so rows read the same as the SQL in spec §6.

import { customType, timestamp } from 'drizzle-orm/pg-core';

/** Case-insensitive text (the `citext` extension). Email addresses and domains use it. */
export const citext = customType<{ data: string }>({ dataType: () => 'citext' });

export const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

export const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

/** `timestamptz`: stored in UTC, rendered in the viewer's timezone. */
export const timestamptz = () => timestamp({ withTimezone: true });

export const created_at = () => timestamptz().notNull().defaultNow();
export const updated_at = () => timestamptz().notNull().defaultNow();
