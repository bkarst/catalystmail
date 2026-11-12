// Cursor pagination (spec §13.3). A cursor names the last row of the previous page and the sort it
// belongs to; the query then continues strictly after that row.

import { z } from 'zod';

import { invalidField } from './errors.ts';

const cursorSchema = z.strictObject({ s: z.string(), id: z.string() });

export function encodeCursor(sort: string, id: string): string {
  return Buffer.from(JSON.stringify({ s: sort, id }), 'utf8').toString('base64url');
}

/** The ID a cursor points at. Rejects a malformed cursor and one made for a different sort order. */
export function decodeCursor(cursor: string, sort: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw invalidField('query.cursor', 'Not a valid cursor.');
  }
  const result = cursorSchema.safeParse(parsed);
  if (!result.success) throw invalidField('query.cursor', 'Not a valid cursor.');
  if (result.data.s !== sort) throw invalidField('query.cursor', 'This cursor belongs to a different sort order.');
  return result.data.id;
}

/** Splits `limit + 1` fetched rows into the page and the cursor for the next one. */
export function page<Row extends { id: string }>(rows: Row[], limit: number, sort: string): { rows: Row[]; next_cursor: string | null } {
  if (rows.length <= limit) return { rows, next_cursor: null };
  const kept = rows.slice(0, limit);
  return { rows: kept, next_cursor: encodeCursor(sort, kept.at(-1)!.id) };
}
