// A contact's timeline and notes (spec §12.1), and verifying its address on demand (§8.5).

import type { Activity } from '@catalyst/contract';
import { activities, contacts, newId, type Db, type Executor } from '@catalyst/db';
import { verifyEmailAddress, type MailDns } from '@catalyst/email';
import { and, desc, eq, isNull, like, not, or, sql, type SQL } from 'drizzle-orm';

import type { Principal } from '../api/auth.ts';
import { notFound } from '../api/errors.ts';
import { decodeCursor, page } from '../api/pagination.ts';
import { actorOf } from '../shared.ts';
import { serializeContact } from './service.ts';

type ActivityRow = typeof activities.$inferSelect;

export function serializeActivity(row: ActivityRow): Activity {
  return {
    id: row.id,
    type: row.type,
    actor_type: row.actor_type,
    actor_id: row.actor_id,
    contact_id: row.contact_id,
    thread_id: row.thread_id,
    campaign_id: row.campaign_id,
    data: row.data as Record<string, unknown>,
    occurred_at: row.occurred_at.toISOString(),
  };
}

export type TimelineCategory = 'all' | 'emails' | 'status' | 'notes' | 'changes';

const NOTE = 'contact.note_added';

function categoryCondition(category: TimelineCategory): SQL | undefined {
  switch (category) {
    case 'emails':
      return like(activities.type, 'message.%');
    case 'status':
      return or(like(activities.type, 'thread.%'), like(activities.type, 'goal.%'), like(activities.type, 'escalation.%'), like(activities.type, 'follow_up.%'));
    case 'notes':
      return eq(activities.type, NOTE);
    case 'changes':
      return and(like(activities.type, 'contact.%'), not(eq(activities.type, NOTE)));
    default:
      return undefined;
  }
}

async function assertContact(db: Executor, workspaceId: string, contactId: string) {
  const [row] = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.id, contactId), eq(contacts.workspace_id, workspaceId), isNull(contacts.deleted_at)));
  if (!row) throw notFound('The contact');
  return row;
}

const SORT = '-occurred_at';

export async function listContactTimeline(
  db: Db,
  workspaceId: string,
  contactId: string,
  query: { limit: number; cursor?: string | undefined; category?: TimelineCategory | undefined },
) {
  await assertContact(db, workspaceId, contactId);
  const where: (SQL | undefined)[] = [eq(activities.contact_id, contactId), eq(activities.workspace_id, workspaceId), categoryCondition(query.category ?? 'all')];
  if (query.cursor) {
    const cursorId = decodeCursor(query.cursor, SORT);
    where.push(sql`(${activities.occurred_at}, ${activities.id}) < (select a.occurred_at, a.id from activities a where a.id = ${cursorId} and a.workspace_id = ${workspaceId})`);
  }
  const rows = await db
    .select()
    .from(activities)
    .where(and(...where))
    .orderBy(desc(activities.occurred_at), desc(activities.id))
    .limit(query.limit + 1);
  const { rows: kept, next_cursor } = page(rows, query.limit, SORT);
  return { data: kept.map(serializeActivity), next_cursor };
}

export async function addContactNote(db: Db, principal: Principal, contactId: string, text: string, now: Date): Promise<Activity> {
  await assertContact(db, principal.workspace.id, contactId);
  const [row] = await db
    .insert(activities)
    .values({ id: newId('activity'), workspace_id: principal.workspace.id, contact_id: contactId, type: NOTE, ...actorOf(principal), data: { text }, occurred_at: now })
    .returning();
  return serializeActivity(row!);
}

/**
 * Verifies one contact's address and stores the outcome. A hard bounce is proof from a real send,
 * so a `bounced` contact stays bounced; a failed lookup leaves the status as it was.
 */
export async function verifyContact(db: Executor, workspaceId: string, contactId: string, dns: MailDns, now: Date, actor: { actor_type: 'user' | 'api_key' | 'system'; actor_id: string | null }) {
  const current = await assertContact(db, workspaceId, contactId);
  const result = await verifyEmailAddress(current.email, dns);
  const patch: Partial<typeof contacts.$inferInsert> = { email_flags: result.flags };
  if (result.outcome !== 'unverified' && current.email_verification !== 'bounced') {
    patch.email_verification = result.outcome;
    patch.email_verified_at = now;
  }
  const changed = patch.email_verification !== undefined && patch.email_verification !== current.email_verification;
  const [row] = await db.update(contacts).set({ ...patch, updated_at: now }).where(eq(contacts.id, contactId)).returning();
  if (changed) {
    await db.insert(activities).values({
      id: newId('activity'),
      workspace_id: workspaceId,
      contact_id: contactId,
      type: 'contact.updated',
      ...actor,
      data: { fields: ['email_verification'], from: current.email_verification, to: patch.email_verification },
      occurred_at: now,
    });
  }
  return { row: row!, result };
}

export async function verifyContactEmail(db: Db, principal: Principal, contactId: string, dns: MailDns, now: Date) {
  // No transaction: it would stay open across the DNS lookups.
  const { row, result } = await verifyContact(db, principal.workspace.id, contactId, dns, now, actorOf(principal));
  const tagRows = await db.execute<{ tag_id: string }>(sql`select tag_id from contact_tags where contact_id = ${contactId} order by tag_id`);
  return { contact: serializeContact(row, tagRows.rows.map((tag) => tag.tag_id)), suggestion: result.suggestion, details: result.details };
}

/** The `contact.verify` job (§8.5): verifies a contact by ID, in whatever workspace it belongs to. */
export async function verifyContactById(db: Db, contactId: string, dns: MailDns, now: Date): Promise<'verified' | 'gone'> {
  const [row] = await db.select({ workspace_id: contacts.workspace_id }).from(contacts).where(and(eq(contacts.id, contactId), isNull(contacts.deleted_at)));
  if (!row) return 'gone';
  await verifyContact(db, row.workspace_id, contactId, dns, now, { actor_type: 'system', actor_id: null });
  return 'verified';
}
