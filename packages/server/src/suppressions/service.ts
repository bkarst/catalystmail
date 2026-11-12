// The suppression list (spec §8.6): addresses and domains that are never emailed. Addresses are
// matched by hash, so a block survives the contact being erased.

import type { Suppression } from '@catalyst/contract';
import { contacts, emailHash, newId, normalizeEmail, suppressions, suppressionsFor, type Db, type Executor, type SuppressionRow } from '@catalyst/db';
import { and, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';

import type { Principal } from '../api/auth.ts';
import { conflict, notFound, PG_UNIQUE_VIOLATION, pgErrorCode } from '../api/errors.ts';
import { decodeCursor, page } from '../api/pagination.ts';
import type { JobQueue } from '@catalyst/jobs';

import { audit, escapeLike } from '../shared.ts';
import { evaluateSuppressedThreads } from '../threads/evaluation.ts';

export function serializeSuppression(row: SuppressionRow): Suppression {
  return {
    id: row.id,
    email: row.email,
    domain: row.domain,
    hashed_only: row.email === null && row.email_hash !== null,
    reason: row.reason,
    source: row.source,
    note: row.note,
    created_by: row.created_by,
    created_at: row.created_at.toISOString(),
  };
}

const SORT = '-created_at';
type Reason = SuppressionRow['reason'];

export async function listSuppressions(db: Db, workspaceId: string, query: { limit: number; cursor?: string | undefined; reason?: Reason | undefined; q?: string | undefined }) {
  const where: SQL[] = [eq(suppressions.workspace_id, workspaceId)];
  if (query.reason) where.push(eq(suppressions.reason, query.reason));
  if (query.q?.trim()) {
    const like = `%${escapeLike(query.q.trim())}%`;
    where.push(sql`(${suppressions.email} ilike ${like} or ${suppressions.domain} ilike ${like})`);
  }
  if (query.cursor) {
    const cursorId = decodeCursor(query.cursor, SORT);
    where.push(sql`(${suppressions.created_at}, ${suppressions.id}) < (select s.created_at, s.id from suppressions s where s.id = ${cursorId} and s.workspace_id = ${workspaceId})`);
  }
  const rows = await db.select().from(suppressions).where(and(...where)).orderBy(desc(suppressions.created_at), desc(suppressions.id)).limit(query.limit + 1);
  const { rows: kept, next_cursor } = page(rows, query.limit, SORT);
  return { data: kept.map(serializeSuppression), next_cursor };
}

export interface SuppressInput {
  email?: string | undefined;
  domain?: string | undefined;
  reason: Reason;
  source: string;
  note?: string | null | undefined;
  createdBy?: string | null;
  /** When given, the threads of matching contacts are re-evaluated, which stops them. */
  jobs?: JobQueue;
}

/**
 * Adds a suppression, or returns the one already covering the same address or domain. Used by the
 * API, bulk actions, unsubscribes and bounces alike.
 */
export async function suppress(db: Executor, workspaceId: string, input: SuppressInput, now: Date): Promise<{ row: SuppressionRow; created: boolean }> {
  const email = input.email ? normalizeEmail(input.email) : null;
  const domain = input.domain ? input.domain.toLowerCase() : null;
  const hash = email ? emailHash(email) : null;
  const inserted = await db
    .insert(suppressions)
    .values({
      id: newId('suppression'),
      workspace_id: workspaceId,
      email,
      email_hash: hash,
      domain,
      reason: input.reason,
      source: input.source,
      note: input.note ?? null,
      created_by: input.createdBy ?? null,
      created_at: now,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) {
    if (input.jobs) await evaluateSuppressedThreads(db, input.jobs, workspaceId, { email, domain });
    return { row: inserted[0], created: true };
  }
  const [existing] = await db
    .select()
    .from(suppressions)
    .where(and(eq(suppressions.workspace_id, workspaceId), hash ? eq(suppressions.email_hash, hash) : eq(suppressions.domain, domain!)));
  if (!existing) throw new Error('A suppression conflicted but could not be found');
  return { row: existing, created: false };
}

export async function createSuppression(
  db: Db,
  principal: Principal,
  input: { email?: string | undefined; domain?: string | undefined; reason?: 'manual' | 'do_not_contact' | undefined; note?: string | undefined },
  now: Date,
  jobs: JobQueue,
): Promise<Suppression> {
  try {
    const { row, created } = await db.transaction((tx) =>
      suppress(tx, principal.workspace.id, { ...input, reason: input.reason ?? 'manual', source: 'api', createdBy: principal.kind === 'user' ? principal.id : null, jobs }, now),
    );
    if (!created) {
      throw conflict(`${input.email ?? input.domain} is already suppressed: ${row.id}.`, [{ path: input.email ? 'body.email' : 'body.domain', message: 'Already suppressed.' }]);
    }
    return serializeSuppression(row);
  } catch (error) {
    if (pgErrorCode(error) === PG_UNIQUE_VIOLATION) throw conflict(`${input.email ?? input.domain} is already suppressed.`);
    throw error;
  }
}

export async function deleteSuppression(db: Db, principal: Principal, suppressionId: string, now: Date, jobs: JobQueue): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(suppressions).where(and(eq(suppressions.id, suppressionId), eq(suppressions.workspace_id, principal.workspace.id)));
    if (!row) throw notFound('The suppression');
    await tx.delete(suppressions).where(eq(suppressions.id, suppressionId));
    // Lifting the block lets the matching threads carry on.
    if (row.email || row.domain) await evaluateSuppressedThreads(tx, jobs, principal.workspace.id, { email: row.email, domain: row.domain });
    await audit(tx, principal, 'suppression.deleted', { type: 'suppression', id: row.id }, { email: row.email, domain: row.domain, reason: row.reason, hashed_only: row.email === null }, now);
  });
}

export async function checkSuppression(db: Db, workspaceId: string, address: string) {
  const email = normalizeEmail(address);
  const matches = await suppressionsFor(db, workspaceId, email);
  const [contact] = await db
    .select({ id: contacts.id, subscription_status: contacts.subscription_status, email_verification: contacts.email_verification, do_not_contact: contacts.do_not_contact })
    .from(contacts)
    .where(and(eq(contacts.workspace_id, workspaceId), eq(contacts.email, email), isNull(contacts.deleted_at)));
  const reasons: ('suppressed' | 'unsubscribed' | 'bounced' | 'invalid' | 'do_not_contact')[] = [];
  if (matches.length > 0) reasons.push('suppressed');
  if (contact && contact.subscription_status !== 'subscribed') reasons.push('unsubscribed');
  if (contact?.email_verification === 'bounced') reasons.push('bounced');
  if (contact?.email_verification === 'invalid') reasons.push('invalid');
  if (contact?.do_not_contact) reasons.push('do_not_contact');
  return { email, blocked: reasons.length > 0, reasons, suppressions: matches.map(serializeSuppression), contact_id: contact?.id ?? null };
}
