// Contacts and tags (spec §12). Every function takes the workspace it acts in; nothing here reads
// a row from another workspace.

import type { Contact } from '@catalyst/contract';
import { isFreemailDomain } from '@catalyst/email';
import { activities, companies, contact_tags, contacts, lists, newId, tags, users, type Db } from '@catalyst/db';
import { and, asc, desc, eq, gt, inArray, isNull, sql, type SQL } from 'drizzle-orm';

import type { Principal } from '../api/auth.ts';
import { conflict, invalidField, notFound, PG_UNIQUE_VIOLATION, pgErrorCode, validationFailed, type FieldError } from '../api/errors.ts';
import { assertFresh } from '../api/etag.ts';
import { decodeCursor, page } from '../api/pagination.ts';
import type { JobQueue } from '@catalyst/jobs';

import { applyCustomFields } from '../custom-fields/service.ts';
import { evaluateContactThreads } from '../threads/evaluation.ts';
import { compileContactFilter, compileContactFilterParam } from './filter.ts';

export type ContactRow = typeof contacts.$inferSelect;
type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0];

const iso = (date: Date | null) => (date ? date.toISOString() : null);
const normalizeEmail = (email: string) => email.trim().toLowerCase();
const escapeLike = (value: string) => value.replace(/[\\%_]/g, (character) => `\\${character}`);

export function serializeContact(row: ContactRow, tagIds: string[]): Contact {
  return {
    id: row.id,
    email: row.email,
    first_name: row.first_name,
    last_name: row.last_name,
    title: row.title,
    phone: row.phone,
    linkedin_url: row.linkedin_url,
    company_id: row.company_id,
    city: row.city,
    country: row.country,
    timezone: row.timezone,
    lifecycle_stage: row.lifecycle_stage,
    owner_user_id: row.owner_user_id,
    consent_basis: row.consent_basis,
    do_not_contact: row.do_not_contact,
    custom_fields: row.custom_fields as Record<string, unknown>,
    notes: row.notes,
    tag_ids: tagIds,
    source: row.source,
    source_detail: row.source_detail,
    email_verification: row.email_verification,
    email_verified_at: iso(row.email_verified_at),
    email_flags: row.email_flags,
    subscription_status: row.subscription_status,
    unsubscribed_at: iso(row.unsubscribed_at),
    last_contacted_at: iso(row.last_contacted_at),
    last_replied_at: iso(row.last_replied_at),
    last_opened_at: iso(row.last_opened_at),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

export async function tagIdsByContact(db: Db | Transaction, contactIds: string[]): Promise<Map<string, string[]>> {
  const byContact = new Map<string, string[]>(contactIds.map((id) => [id, []]));
  if (contactIds.length === 0) return byContact;
  const rows = await db.select().from(contact_tags).where(inArray(contact_tags.contact_id, contactIds)).orderBy(asc(contact_tags.tag_id));
  for (const row of rows) byContact.get(row.contact_id)!.push(row.tag_id);
  return byContact;
}

// ── Listing ────────────────────────────────────────────────────────────────────────────────────

// Sort columns are fixed identifiers, never caller input. A nullable column sorts its empty
// values last when descending.
const SORTS = {
  '-created_at': { column: 'created_at', descending: true, nullable: false },
  created_at: { column: 'created_at', descending: false, nullable: false },
  '-updated_at': { column: 'updated_at', descending: true, nullable: false },
  '-last_contacted_at': { column: 'last_contacted_at', descending: true, nullable: true },
  '-last_replied_at': { column: 'last_replied_at', descending: true, nullable: true },
  email: { column: 'email', descending: false, nullable: false },
} as const;
export type ContactSort = keyof typeof SORTS;

const sortKey = (alias: string, sort: (typeof SORTS)[ContactSort]): SQL =>
  sql.raw(sort.nullable ? `coalesce(${alias}.${sort.column}, '-infinity'::timestamptz)` : `${alias}.${sort.column}`);

export interface ListContactsQuery {
  limit: number;
  cursor?: string | undefined;
  q?: string | undefined;
  lifecycle_stage?: ContactRow['lifecycle_stage'] | undefined;
  email_verification?: ContactRow['email_verification'] | undefined;
  subscription_status?: ContactRow['subscription_status'] | undefined;
  tag_id?: string | undefined;
  company_id?: string | undefined;
  owner_user_id?: string | undefined;
  updated_after?: string | undefined;
  filter?: string | undefined;
  list_id?: string | undefined;
  sort?: ContactSort | undefined;
}

/** One page of contacts. `extra` is a further condition, such as a segment's filter. */
export async function listContacts(db: Db, workspaceId: string, query: ListContactsQuery, now: Date, extra?: SQL) {
  const sortName = query.sort ?? '-created_at';
  const sort = SORTS[sortName];
  const where: SQL[] = [eq(contacts.workspace_id, workspaceId), isNull(contacts.deleted_at)];

  if (query.lifecycle_stage) where.push(eq(contacts.lifecycle_stage, query.lifecycle_stage));
  if (query.email_verification) where.push(eq(contacts.email_verification, query.email_verification));
  if (query.subscription_status) where.push(eq(contacts.subscription_status, query.subscription_status));
  if (query.company_id) where.push(eq(contacts.company_id, query.company_id));
  if (query.owner_user_id) where.push(eq(contacts.owner_user_id, query.owner_user_id));
  if (query.updated_after) where.push(gt(contacts.updated_at, new Date(query.updated_after)));
  if (query.tag_id) {
    where.push(sql`exists (select 1 from contact_tags where contact_tags.contact_id = contacts.id and contact_tags.tag_id = ${query.tag_id})`);
  }
  if (query.q?.trim()) {
    const term = query.q.trim();
    const like = `%${escapeLike(term)}%`;
    where.push(
      sql`(${contacts.search} @@ plainto_tsquery('simple', ${term}) or ${contacts.email} ilike ${like} or (coalesce(${contacts.first_name}, '') || ' ' || coalesce(${contacts.last_name}, '')) ilike ${like})`,
    );
  }
  if (query.filter) where.push(await compileContactFilterParam(query.filter, { db, workspaceId, now }));
  if (query.list_id) {
    const [list] = await db.select({ id: lists.id }).from(lists).where(and(eq(lists.id, query.list_id), eq(lists.workspace_id, workspaceId)));
    if (!list) throw invalidField('query.list_id', 'No such list in this workspace.');
    where.push(await compileContactFilter({ field: 'list_id', op: 'eq', value: query.list_id }, { db, workspaceId, now, path: 'query.list_id' }));
  }
  if (extra) where.push(extra);
  if (query.cursor) {
    // Continue strictly after the cursor row, comparing against its current sort value in the database.
    const cursorId = decodeCursor(query.cursor, sortName);
    const comparison = sql.raw(sort.descending ? '<' : '>');
    where.push(
      sql`(${sortKey('contacts', sort)}, ${contacts.id}) ${comparison} (select ${sortKey('c', sort)}, c.id from contacts c where c.id = ${cursorId} and c.workspace_id = ${workspaceId})`,
    );
  }

  const key = sortKey('contacts', sort);
  const rows = await db
    .select()
    .from(contacts)
    .where(and(...where))
    .orderBy(sort.descending ? sql`${key} desc` : sql`${key} asc`, sort.descending ? desc(contacts.id) : asc(contacts.id))
    .limit(query.limit + 1);

  const { rows: kept, next_cursor } = page(rows, query.limit, sortName);
  const tagIds = await tagIdsByContact(db, kept.map((row) => row.id));
  return { data: kept.map((row) => serializeContact(row, tagIds.get(row.id)!)), next_cursor };
}

// ── Reading and writing one contact ────────────────────────────────────────────────────────────

export async function findContact(db: Db | Transaction, workspaceId: string, contactId: string): Promise<ContactRow> {
  const [row] = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.id, contactId), eq(contacts.workspace_id, workspaceId), isNull(contacts.deleted_at)));
  if (!row) throw notFound('The contact');
  return row;
}

export async function getContact(db: Db, workspaceId: string, contactId: string): Promise<Contact> {
  const row = await findContact(db, workspaceId, contactId);
  return serializeContact(row, (await tagIdsByContact(db, [row.id])).get(row.id)!);
}

export interface ContactInput {
  email?: string | undefined;
  first_name?: string | null | undefined;
  last_name?: string | null | undefined;
  title?: string | null | undefined;
  phone?: string | null | undefined;
  linkedin_url?: string | null | undefined;
  company_id?: string | null | undefined;
  city?: string | null | undefined;
  country?: string | null | undefined;
  timezone?: string | null | undefined;
  lifecycle_stage?: ContactRow['lifecycle_stage'] | undefined;
  owner_user_id?: string | null | undefined;
  consent_basis?: ContactRow['consent_basis'] | undefined;
  do_not_contact?: boolean | undefined;
  custom_fields?: Record<string, unknown> | undefined;
  notes?: string | null | undefined;
  tag_ids?: string[] | undefined;
}

const COLUMNS = [
  'first_name', 'last_name', 'title', 'phone', 'linkedin_url', 'company_id', 'city', 'country', 'timezone',
  'lifecycle_stage', 'owner_user_id', 'consent_basis', 'do_not_contact', 'notes',
] as const satisfies readonly (keyof ContactInput)[];

/** IDs in a request must point at rows of the same workspace. */
async function assertReferences(tx: Transaction, workspaceId: string, input: ContactInput): Promise<void> {
  const errors: FieldError[] = [];
  if (input.company_id) {
    const [company] = await tx
      .select({ id: companies.id })
      .from(companies)
      .where(and(eq(companies.id, input.company_id), eq(companies.workspace_id, workspaceId), isNull(companies.deleted_at)));
    if (!company) errors.push({ path: 'body.company_id', message: 'No such company in this workspace.' });
  }
  if (input.owner_user_id) {
    const [owner] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, input.owner_user_id), eq(users.workspace_id, workspaceId)));
    if (!owner) errors.push({ path: 'body.owner_user_id', message: 'No such user in this workspace.' });
  }
  if (input.tag_ids?.length) {
    const found = await tx.select({ id: tags.id }).from(tags).where(and(inArray(tags.id, input.tag_ids), eq(tags.workspace_id, workspaceId)));
    const known = new Set(found.map((tag) => tag.id));
    input.tag_ids.forEach((tagId, index) => {
      if (!known.has(tagId)) errors.push({ path: `body.tag_ids.${index}`, message: 'No such tag in this workspace.' });
    });
  }
  if (input.timezone && !isTimeZone(input.timezone)) errors.push({ path: 'body.timezone', message: 'Not an IANA timezone.' });
  if (errors.length > 0) throw validationFailed(errors);
}

function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

async function setTags(tx: Transaction, contactId: string, tagIds: string[]): Promise<void> {
  await tx.delete(contact_tags).where(eq(contact_tags.contact_id, contactId));
  const unique = [...new Set(tagIds)];
  if (unique.length > 0) await tx.insert(contact_tags).values(unique.map((tag_id) => ({ contact_id: contactId, tag_id })));
}

const actor = (principal: Principal) => ({ actor_type: principal.kind, actor_id: principal.id }) as const;

async function emailConflict(db: Db, workspaceId: string, email: string) {
  const [existing] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.workspace_id, workspaceId), eq(contacts.email, email), isNull(contacts.deleted_at)));
  return conflict(`A contact with the email ${email} already exists${existing ? `: ${existing.id}` : ''}.`, [
    { path: 'body.email', message: 'Already used by another contact.' },
  ]);
}

export async function createContact(db: Db, principal: Principal, input: ContactInput & { email: string }, now: Date, jobs: JobQueue): Promise<Contact> {
  const workspaceId = principal.workspace.id;
  const email = normalizeEmail(input.email);
  const id = newId('contact');
  try {
    return await db.transaction(async (tx) => {
      await assertReferences(tx, workspaceId, input);

      // Link the company by email domain when the caller didn't say and the domain is known.
      let companyId = input.company_id ?? null;
      if (input.company_id === undefined && !isFreemailDomain(email.slice(email.lastIndexOf('@') + 1))) {
        const [company] = await tx
          .select({ id: companies.id })
          .from(companies)
          .where(and(eq(companies.workspace_id, workspaceId), eq(companies.domain, email.slice(email.lastIndexOf('@') + 1)), isNull(companies.deleted_at)));
        companyId = company?.id ?? null;
      }

      const values: typeof contacts.$inferInsert = { id, workspace_id: workspaceId, email, source: 'api', created_at: now, updated_at: now };
      for (const column of COLUMNS) {
        if (input[column] !== undefined) Object.assign(values, { [column]: input[column] });
      }
      values.company_id = companyId;
      values.custom_fields = await applyCustomFields(tx, workspaceId, 'contact', null, input.custom_fields);

      const [row] = await tx.insert(contacts).values(values).returning();
      await setTags(tx, id, input.tag_ids ?? []);
      await tx.insert(activities).values({ id: newId('activity'), workspace_id: workspaceId, contact_id: id, type: 'contact.created', ...actor(principal), data: { source: 'api' }, occurred_at: now });
      // Every new address is verified in the background (§8.5).
      await jobs.enqueue('contact.verify', { contact_id: id }, { db: tx });
      return serializeContact(row!, [...new Set(input.tag_ids ?? [])].sort());
    });
  } catch (error) {
    if (pgErrorCode(error) === PG_UNIQUE_VIOLATION) throw await emailConflict(db, workspaceId, email);
    throw error;
  }
}

export async function updateContact(db: Db, principal: Principal, contactId: string, input: ContactInput, ifMatch: string | null, now: Date, jobs: JobQueue): Promise<Contact> {
  const workspaceId = principal.workspace.id;
  const email = input.email === undefined ? undefined : normalizeEmail(input.email);
  try {
    return await db.transaction(async (tx) => {
      const current = await findContact(tx, workspaceId, contactId);
      const currentTags = (await tagIdsByContact(tx, [contactId])).get(contactId)!;
      assertFresh(serializeContact(current, currentTags), ifMatch);
      await assertReferences(tx, workspaceId, input);

      const patch: Partial<typeof contacts.$inferInsert> = {};
      for (const column of COLUMNS) {
        if (input[column] !== undefined) Object.assign(patch, { [column]: input[column] });
      }
      if (input.custom_fields !== undefined) {
        patch.custom_fields = await applyCustomFields(tx, workspaceId, 'contact', current.custom_fields as Record<string, unknown>, input.custom_fields);
      }
      if (email !== undefined && email !== current.email) {
        // A new address has not been verified.
        Object.assign(patch, { email, email_verification: 'unverified', email_verified_at: null, email_flags: [] });
      }
      const changed = Object.keys(patch).filter((column) => JSON.stringify(patch[column as keyof typeof patch]) !== JSON.stringify(current[column as keyof ContactRow]));
      const tagsChanged = input.tag_ids !== undefined && JSON.stringify([...new Set(input.tag_ids)].sort()) !== JSON.stringify(currentTags);
      if (changed.length === 0 && !tagsChanged) return serializeContact(current, currentTags);

      const [row] = await tx.update(contacts).set({ ...patch, updated_at: now }).where(eq(contacts.id, contactId)).returning();
      if (tagsChanged) await setTags(tx, contactId, input.tag_ids!);
      if (changed.includes('email')) await jobs.enqueue('contact.verify', { contact_id: contactId }, { db: tx });
      // A new address may be suppressed, and do-not-contact stops or resumes automation.
      if (changed.includes('email') || changed.includes('do_not_contact')) await evaluateContactThreads(tx, jobs, [contactId]);
      await tx.insert(activities).values({
        id: newId('activity'),
        workspace_id: workspaceId,
        contact_id: contactId,
        type: 'contact.updated',
        ...actor(principal),
        data: { fields: [...changed, ...(tagsChanged ? ['tag_ids'] : [])] },
        occurred_at: now,
      });
      return serializeContact(row!, tagsChanged ? [...new Set(input.tag_ids!)].sort() : currentTags);
    });
  } catch (error) {
    if (pgErrorCode(error) === PG_UNIQUE_VIOLATION && email !== undefined) throw await emailConflict(db, workspaceId, email);
    throw error;
  }
}

/** Soft delete. The contact's threads are re-evaluated, which stops them. */
export async function deleteContact(db: Db, principal: Principal, contactId: string, now: Date, jobs: JobQueue): Promise<void> {
  const workspaceId = principal.workspace.id;
  await db.transaction(async (tx) => {
    await findContact(tx, workspaceId, contactId);
    await tx.update(contacts).set({ deleted_at: now, updated_at: now }).where(eq(contacts.id, contactId));
    await tx.insert(activities).values({ id: newId('activity'), workspace_id: workspaceId, contact_id: contactId, type: 'contact.deleted', ...actor(principal), occurred_at: now });
    await evaluateContactThreads(tx, jobs, [contactId]);
  });
}

// ── Tags ───────────────────────────────────────────────────────────────────────────────────────

const TAG_SORT = 'name';

export async function listTags(db: Db, workspaceId: string, query: { limit: number; cursor?: string | undefined }) {
  const where: SQL[] = [eq(tags.workspace_id, workspaceId)];
  if (query.cursor) {
    const cursorId = decodeCursor(query.cursor, TAG_SORT);
    where.push(sql`(${tags.name}, ${tags.id}) > (select t.name, t.id from tags t where t.id = ${cursorId} and t.workspace_id = ${workspaceId})`);
  }
  const rows = await db.select().from(tags).where(and(...where)).orderBy(asc(tags.name), asc(tags.id)).limit(query.limit + 1);
  const { rows: kept, next_cursor } = page(rows, query.limit, TAG_SORT);
  return { data: kept.map(({ id, name, color }) => ({ id, name, color })), next_cursor };
}

export async function createTag(db: Db, workspaceId: string, input: { name: string; color?: string | undefined }) {
  const name = input.name.trim();
  if (name.length === 0) throw invalidField('body.name', 'A tag needs a name.');
  try {
    const [row] = await db.insert(tags).values({ id: newId('tag'), workspace_id: workspaceId, name, ...(input.color && { color: input.color }) }).returning();
    return { id: row!.id, name: row!.name, color: row!.color };
  } catch (error) {
    if (pgErrorCode(error) === PG_UNIQUE_VIOLATION) throw conflict(`A tag named "${name}" already exists.`, [{ path: 'body.name', message: 'Already used by another tag.' }]);
    throw error;
  }
}

export async function deleteTag(db: Db, workspaceId: string, tagId: string): Promise<void> {
  const deleted = await db.delete(tags).where(and(eq(tags.id, tagId), eq(tags.workspace_id, workspaceId))).returning({ id: tags.id });
  if (deleted.length === 0) throw notFound('The tag');
}
