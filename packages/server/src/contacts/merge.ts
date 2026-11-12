// Duplicates and merging (spec §12.1). Exact duplicate emails can't exist, so "likely" duplicates
// are the same person under two addresses: the same name at the same company, or an address that
// differs only by dots or a `+tag`.

import { activities, contact_tags, contacts, integration_events, list_members, newId, thread_participants, threads, type Db } from '@catalyst/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import type { Principal } from '../api/auth.ts';
import { conflict, invalidField } from '../api/errors.ts';
import { decodeCursor, encodeCursor } from '../api/pagination.ts';
import type { JobQueue } from '@catalyst/jobs';

import { actorOf } from '../shared.ts';
import { evaluateContactThreads } from '../threads/evaluation.ts';
import { findContact, serializeContact, tagIdsByContact, type ContactRow } from './service.ts';

type Reason = 'same_name_and_company' | 'similar_email';

const GROUPS_SQL = (workspaceId: string) => sql`
  with live as (
    select id, created_at, email::text as email, lower(trim(first_name)) as first, lower(trim(last_name)) as last, company_id,
           split_part(email::text, '@', 2) as domain,
           replace(split_part(split_part(email::text, '@', 1), '+', 1), '.', '') as base
    from contacts where workspace_id = ${workspaceId} and deleted_at is null
  ),
  by_name as (
    select 'same_name_and_company' as reason, array_agg(id order by created_at, id) as ids, min(created_at) as first_seen
    from live where coalesce(first, '') <> '' and coalesce(last, '') <> ''
    group by first, last, coalesce(company_id, domain) having count(*) > 1
  ),
  by_email as (
    select 'similar_email' as reason, array_agg(id order by created_at, id) as ids, min(created_at) as first_seen
    from live group by base, domain having count(*) > 1
  )
  select reason, ids from (select * from by_name union all select * from by_email) groups
  order by first_seen, reason, ids[1]`;

export async function listDuplicateContacts(db: Db, workspaceId: string, query: { limit: number; cursor?: string | undefined }) {
  const offset = query.cursor ? Number(decodeCursor(query.cursor, 'duplicates')) : 0;
  if (!Number.isInteger(offset) || offset < 0) throw invalidField('query.cursor', 'Not a valid cursor.');
  const result = await db.execute<{ reason: Reason; ids: string[] }>(sql`${GROUPS_SQL(workspaceId)} offset ${offset} limit ${query.limit + 1}`);
  // The same set can turn up under both reasons; show it once.
  const seen = new Set<string>();
  const groups = result.rows.filter((group) => {
    const key = [...group.ids].sort().join(',');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const kept = groups.slice(0, query.limit);
  const ids = [...new Set(kept.flatMap((group) => group.ids))];
  const rows = ids.length ? await db.select().from(contacts).where(inArray(contacts.id, ids)) : [];
  const byId = new Map(rows.map((row) => [row.id, row]));
  const tags = await tagIdsByContact(db, ids);
  return {
    data: kept.map((group) => ({ reason: group.reason, contacts: group.ids.map((id) => serializeContact(byId.get(id)!, tags.get(id)!)) })),
    next_cursor: result.rows.length > query.limit ? encodeCursor('duplicates', String(offset + query.limit)) : null,
  };
}

const MERGEABLE = ['first_name', 'last_name', 'title', 'phone', 'linkedin_url', 'company_id', 'city', 'country', 'timezone', 'owner_user_id', 'notes'] as const;
type Mergeable = (typeof MERGEABLE)[number];

const LADDER = ['lead', 'prospect', 'engaged', 'opportunity', 'customer'];
const STRICTER_SUBSCRIPTION = { subscribed: 0, unsubscribed: 1, complained: 2 } as const;
const later = (a: Date | null, b: Date | null) => (a && b ? (a > b ? a : b) : (a ?? b));

/** The field values the kept contact ends up with. */
function mergedValues(keep: ContactRow, other: ContactRow, takeFromOther: readonly Mergeable[]): Partial<typeof contacts.$inferInsert> {
  const patch: Partial<typeof contacts.$inferInsert> = {};
  for (const field of MERGEABLE) {
    const mine = keep[field];
    const theirs = other[field];
    if (theirs === null || theirs === '') continue;
    if (takeFromOther.includes(field) || mine === null || mine === '') patch[field] = theirs;
    else if (field === 'notes' && mine !== theirs) patch.notes = `${mine}\n\n${theirs}`;
  }
  // Automatic moves never go backwards (§5.9): keep the further lifecycle stage on the main ladder.
  if (LADDER.includes(keep.lifecycle_stage) && LADDER.indexOf(other.lifecycle_stage) > LADDER.indexOf(keep.lifecycle_stage)) patch.lifecycle_stage = other.lifecycle_stage;
  // Any opt-out or block on either record wins.
  if (STRICTER_SUBSCRIPTION[other.subscription_status] > STRICTER_SUBSCRIPTION[keep.subscription_status]) {
    patch.subscription_status = other.subscription_status;
    patch.unsubscribed_at = other.unsubscribed_at;
  }
  if (other.do_not_contact && !keep.do_not_contact) patch.do_not_contact = true;
  if (keep.consent_basis === 'unknown' && other.consent_basis !== 'unknown') patch.consent_basis = other.consent_basis;
  const custom = { ...(other.custom_fields as object), ...(keep.custom_fields as object) };
  if (JSON.stringify(custom) !== JSON.stringify(keep.custom_fields)) patch.custom_fields = custom;
  for (const field of ['last_contacted_at', 'last_replied_at', 'last_opened_at'] as const) {
    const value = later(keep[field], other[field]);
    if (value?.getTime() !== keep[field]?.getTime()) patch[field] = value;
  }
  return patch;
}

export async function mergeContacts(
  db: Db,
  principal: Principal,
  contactId: string,
  input: { merge_contact_id: string; take_from_merged?: Mergeable[] | undefined },
  now: Date,
  jobs: JobQueue,
) {
  const workspaceId = principal.workspace.id;
  if (input.merge_contact_id === contactId) throw invalidField('body.merge_contact_id', 'A contact cannot be merged into itself.');
  return db.transaction(async (tx) => {
    const keep = await findContact(tx, workspaceId, contactId);
    const other = await findContact(tx, workspaceId, input.merge_contact_id).catch(() => {
      throw invalidField('body.merge_contact_id', 'No such contact in this workspace.');
    });
    // A thread is unique per (campaign, contact): two conversations in one campaign can't become one.
    const shared = await tx.execute<{ campaign_id: string }>(sql`
      select a.campaign_id from threads a join threads b on a.campaign_id = b.campaign_id
      where a.contact_id = ${keep.id} and b.contact_id = ${other.id}`);
    if (shared.rows.length > 0) {
      throw conflict(
        `Both contacts have a thread in campaign ${shared.rows.map((row) => row.campaign_id).join(', ')}. Close or archive one of those threads' campaigns before merging.`,
      );
    }

    const patch = mergedValues(keep, other, input.take_from_merged ?? []);
    const [row] = await tx.update(contacts).set({ ...patch, updated_at: now }).where(eq(contacts.id, keep.id)).returning();

    // Everything attached to the duplicate moves over; rows that would collide are dropped.
    await tx.execute(sql`insert into contact_tags (contact_id, tag_id) select ${keep.id}, tag_id from contact_tags where contact_id = ${other.id} on conflict do nothing`);
    await tx.delete(contact_tags).where(eq(contact_tags.contact_id, other.id));
    await tx.execute(sql`insert into list_members (list_id, contact_id, added_at) select list_id, ${keep.id}, added_at from list_members where contact_id = ${other.id} on conflict do nothing`);
    await tx.delete(list_members).where(eq(list_members.contact_id, other.id));
    await tx.update(threads).set({ contact_id: keep.id, updated_at: now }).where(eq(threads.contact_id, other.id));
    await tx.execute(sql`
      update thread_participants set contact_id = ${keep.id} where contact_id = ${other.id}
      and not exists (select 1 from thread_participants p where p.thread_id = thread_participants.thread_id and p.contact_id = ${keep.id})`);
    await tx.delete(thread_participants).where(eq(thread_participants.contact_id, other.id));
    await tx.update(activities).set({ contact_id: keep.id }).where(eq(activities.contact_id, other.id));
    await tx.update(integration_events).set({ matched_contact_id: keep.id }).where(eq(integration_events.matched_contact_id, other.id));
    await tx.update(contacts).set({ deleted_at: now, updated_at: now }).where(and(eq(contacts.id, other.id), isNull(contacts.deleted_at)));

    await tx.insert(activities).values({
      id: newId('activity'),
      workspace_id: workspaceId,
      contact_id: keep.id,
      type: 'contact.merged',
      ...actorOf(principal),
      data: { merged_contact_id: other.id, merged_email: other.email, fields: Object.keys(patch) },
      occurred_at: now,
    });
    // The moved threads now belong to a contact whose flags (opt-outs, do-not-contact) may differ.
    await evaluateContactThreads(tx, jobs, [keep.id]);
    return serializeContact(row!, (await tagIdsByContact(tx, [keep.id])).get(keep.id)!);
  });
}

