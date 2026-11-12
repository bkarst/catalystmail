// Static lists and dynamic segments (spec §12.1, §12.2). A segment is a saved filter: its members
// are worked out each time it is read, so they are always current.

import type { List } from '@catalyst/contract';
import { contacts, imports, list_members, lists, newId, type Db, type Executor } from '@catalyst/db';
import { and, asc, count, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';

import type { Principal } from '../api/auth.ts';
import { conflict, invalidField, notFound, validationFailed } from '../api/errors.ts';
import { assertFresh } from '../api/etag.ts';
import { decodeCursor, page } from '../api/pagination.ts';
import { compileContactFilter } from '../contacts/filter.ts';
import { listContacts } from '../contacts/service.ts';

type ListRow = typeof lists.$inferSelect;
type Filter = Record<string, unknown>;

export function serializeList(row: ListRow, memberCount: number): List {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as 'static' | 'dynamic',
    filter: (row.filter as Filter | null) ?? null,
    member_count: memberCount,
    created_by: row.created_by,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

/** The SQL condition on `contacts` that selects a list's members. */
export async function membershipCondition(db: Executor, workspaceId: string, row: ListRow, now: Date): Promise<SQL> {
  return compileContactFilter({ field: 'list_id', op: 'eq', value: row.id }, { db, workspaceId, now });
}

async function memberCount(db: Executor, workspaceId: string, row: ListRow, now: Date): Promise<number> {
  const [result] = await db
    .select({ count: count() })
    .from(contacts)
    .where(and(eq(contacts.workspace_id, workspaceId), isNull(contacts.deleted_at), await membershipCondition(db, workspaceId, row, now)));
  return result?.count ?? 0;
}

const SORT = 'name';

export async function listLists(db: Db, workspaceId: string, query: { limit: number; cursor?: string | undefined; kind?: 'static' | 'dynamic' | undefined }, now: Date) {
  const where: SQL[] = [eq(lists.workspace_id, workspaceId)];
  if (query.kind) where.push(eq(lists.kind, query.kind));
  if (query.cursor) {
    const cursorId = decodeCursor(query.cursor, SORT);
    where.push(sql`(${lists.name}, ${lists.id}) > (select l.name, l.id from lists l where l.id = ${cursorId} and l.workspace_id = ${workspaceId})`);
  }
  const rows = await db.select().from(lists).where(and(...where)).orderBy(asc(lists.name), asc(lists.id)).limit(query.limit + 1);
  const { rows: kept, next_cursor } = page(rows, query.limit, SORT);
  const data: List[] = [];
  for (const row of kept) data.push(serializeList(row, await memberCount(db, workspaceId, row, now)));
  return { data, next_cursor };
}

export async function findList(db: Executor, workspaceId: string, listId: string): Promise<ListRow> {
  const [row] = await db.select().from(lists).where(and(eq(lists.id, listId), eq(lists.workspace_id, workspaceId)));
  if (!row) throw notFound('The list');
  return row;
}

export async function getList(db: Db, workspaceId: string, listId: string, now: Date): Promise<List> {
  const row = await findList(db, workspaceId, listId);
  return serializeList(row, await memberCount(db, workspaceId, row, now));
}

/** Contact IDs that exist (and aren't deleted) in the workspace; reports the others by position. */
async function assertContacts(db: Executor, workspaceId: string, contactIds: string[], path: string): Promise<string[]> {
  const unique = [...new Set(contactIds)];
  const found = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(inArray(contacts.id, unique), eq(contacts.workspace_id, workspaceId), isNull(contacts.deleted_at)));
  const known = new Set(found.map((row) => row.id));
  const errors = contactIds.flatMap((contactId, index) => (known.has(contactId) ? [] : [{ path: `${path}.${index}`, message: 'No such contact in this workspace.' }]));
  if (errors.length > 0) throw validationFailed(errors);
  return unique;
}

async function addMembers(db: Executor, listId: string, contactIds: string[], now: Date): Promise<number> {
  if (contactIds.length === 0) return 0;
  const added = await db
    .insert(list_members)
    .values(contactIds.map((contact_id) => ({ list_id: listId, contact_id, added_at: now })))
    .onConflictDoNothing()
    .returning({ contact_id: list_members.contact_id });
  return added.length;
}

export async function createList(
  db: Db,
  principal: Principal,
  input: { name: string; kind: 'static' | 'dynamic'; filter?: Filter | undefined; contact_ids?: string[] | undefined },
  now: Date,
): Promise<List> {
  const workspaceId = principal.workspace.id;
  if (input.kind === 'dynamic') {
    if (!input.filter) throw invalidField('body.filter', 'A dynamic list needs a filter.');
    if (input.contact_ids) throw invalidField('body.contact_ids', 'A dynamic list has no hand-picked members; its filter decides.');
  } else if (input.filter) throw invalidField('body.filter', 'A static list has no filter. Use kind dynamic for a segment.');

  return db.transaction(async (tx) => {
    const id = newId('list');
    if (input.filter) await compileContactFilter(input.filter, { db: tx, workspaceId, now, path: 'body.filter', selfListId: id });
    const members = input.contact_ids ? await assertContacts(tx, workspaceId, input.contact_ids, 'body.contact_ids') : [];
    const createdBy = principal.kind === 'user' ? principal.id : null;
    const [row] = await tx
      .insert(lists)
      .values({ id, workspace_id: workspaceId, name: input.name.trim(), kind: input.kind, filter: input.filter ?? null, created_by: createdBy, created_at: now, updated_at: now })
      .returning();
    await addMembers(tx, id, members, now);
    return serializeList(row!, await memberCount(tx, workspaceId, row!, now));
  });
}

export async function updateList(
  db: Db,
  principal: Principal,
  listId: string,
  input: { name?: string | undefined; filter?: Filter | undefined },
  ifMatch: string | null,
  now: Date,
): Promise<List> {
  const workspaceId = principal.workspace.id;
  return db.transaction(async (tx) => {
    const current = await findList(tx, workspaceId, listId);
    assertFresh(serializeList(current, 0), ifMatch);
    if (input.filter !== undefined) {
      if (current.kind !== 'dynamic') throw conflict('This is a static list; it has no filter. Change its members instead.');
      await compileContactFilter(input.filter, { db: tx, workspaceId, now, path: 'body.filter', selfListId: listId });
    }
    const patch: Partial<typeof lists.$inferInsert> = {};
    if (input.name !== undefined && input.name.trim() !== current.name) patch.name = input.name.trim();
    if (input.filter !== undefined && JSON.stringify(input.filter) !== JSON.stringify(current.filter)) patch.filter = input.filter;
    const row = Object.keys(patch).length === 0 ? current : (await tx.update(lists).set({ ...patch, updated_at: now }).where(eq(lists.id, listId)).returning())[0]!;
    return serializeList(row, await memberCount(tx, workspaceId, row, now));
  });
}

export async function deleteList(db: Db, workspaceId: string, listId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await findList(tx, workspaceId, listId);
    // An import keeps its record, just no longer pointing at the list.
    await tx.update(imports).set({ target_list_id: null }).where(eq(imports.target_list_id, listId));
    await tx.delete(lists).where(eq(lists.id, listId));
  });
}

export async function listListMembers(db: Db, workspaceId: string, listId: string, query: { limit: number; cursor?: string | undefined }, now: Date) {
  await findList(db, workspaceId, listId);
  return listContacts(db, workspaceId, { ...query, list_id: listId }, now);
}

const staticOnly = (row: ListRow) => {
  if (row.kind !== 'static') throw conflict('This is a dynamic list: its filter decides who is in it. Change the filter with updateList instead.');
};

export async function addListMembers(db: Db, workspaceId: string, listId: string, contactIds: string[], now: Date) {
  return db.transaction(async (tx) => {
    const row = await findList(tx, workspaceId, listId);
    staticOnly(row);
    const unique = await assertContacts(tx, workspaceId, contactIds, 'body.contact_ids');
    const changed = await addMembers(tx, listId, unique, now);
    if (changed > 0) await tx.update(lists).set({ updated_at: now }).where(eq(lists.id, listId));
    return { changed, unchanged: unique.length - changed };
  });
}

export async function removeListMembers(db: Db, workspaceId: string, listId: string, contactIdsParam: string, now: Date) {
  return db.transaction(async (tx) => {
    const row = await findList(tx, workspaceId, listId);
    staticOnly(row);
    const contactIds = [...new Set(contactIdsParam.split(','))];
    const removed = await tx
      .delete(list_members)
      .where(and(eq(list_members.list_id, listId), inArray(list_members.contact_id, contactIds)))
      .returning({ contact_id: list_members.contact_id });
    if (removed.length > 0) await tx.update(lists).set({ updated_at: now }).where(eq(lists.id, listId));
    return { changed: removed.length, unchanged: contactIds.length - removed.length };
  });
}

export async function previewSegment(db: Db, workspaceId: string, filter: Filter, now: Date) {
  const condition = await compileContactFilter(filter, { db, workspaceId, now, path: 'body.filter' });
  const [total] = await db.select({ count: count() }).from(contacts).where(and(eq(contacts.workspace_id, workspaceId), isNull(contacts.deleted_at), condition));
  const sample = await listContacts(db, workspaceId, { limit: 10 }, now, condition);
  return { count: total?.count ?? 0, sample: sample.data };
}
