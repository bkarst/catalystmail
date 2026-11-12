// Writing many contacts at once (spec §12.1): the bulk upsert behind upsertContacts and imports,
// and the bulk actions (tag, list, assign, verify, suppress, delete, export).

import { activities, companies, contact_tags, contacts, emailDomain, list_members, newId, normalizeEmail, tags, users, type Db, type Executor } from '@catalyst/db';
import { isFreemailDomain, type MailDns } from '@catalyst/email';
import type { JobQueue } from '@catalyst/jobs';
import { and, eq, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';

import type { Principal } from '../api/auth.ts';
import { invalidField, validationFailed, type FieldError } from '../api/errors.ts';
import { loadCustomFieldDefs, mergeCustomFields } from '../custom-fields/service.ts';
import { findList } from '../lists/service.ts';
import { actorOf } from '../shared.ts';
import { suppress } from '../suppressions/service.ts';
import { evaluateContactThreads } from '../threads/evaluation.ts';
import { compileContactFilter } from './filter.ts';
import { tagIdsByContact, type ContactInput, type ContactRow } from './service.ts';
import { verifyContact } from './timeline.ts';

export type DedupeStrategy = 'skip' | 'fill_empty' | 'overwrite';
export type UpsertAction = 'created' | 'updated' | 'unchanged' | 'skipped' | 'duplicate_in_request';

export interface UpsertRow extends ContactInput {
  email: string;
}

export interface UpsertOptions {
  strategy: DedupeStrategy;
  /** `contacts.source` for new contacts: api, import, … */
  source: string;
  sourceDetail?: string | null;
  actor: { actor_type: 'user' | 'api_key' | 'system'; actor_id: string | null };
  now: Date;
  /** Where a row's errors are reported, e.g. `body.contacts.3` or `row 12`. */
  rowPath: (index: number) => string;
  /** Tags and a static list every row gets (imports). */
  extraTagIds?: string[];
  listId?: string | null;
  /** New addresses are verified in the background, and do-not-contact changes re-evaluate threads. */
  jobs: JobQueue;
}

export interface UpsertOutcome {
  created: number;
  updated: number;
  skipped: number;
  results: { index: number; contact_id: string; action: UpsertAction }[];
}

const NULLABLE = ['first_name', 'last_name', 'title', 'phone', 'linkedin_url', 'company_id', 'city', 'country', 'timezone', 'owner_user_id', 'notes'] as const;
const EMPTY = (value: unknown) => value === null || value === undefined || value === '';

function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The IDs a batch refers to that don't exist in the workspace, as row errors. */
async function referenceErrors(db: Executor, workspaceId: string, rows: UpsertRow[], options: UpsertOptions): Promise<FieldError[]> {
  const collect = (pick: (row: UpsertRow) => (string | null | undefined)[]) => [...new Set(rows.flatMap(pick).filter((id): id is string => typeof id === 'string'))];
  const companyIds = collect((row) => [row.company_id]);
  const ownerIds = collect((row) => [row.owner_user_id]);
  const tagIds = collect((row) => row.tag_ids ?? []);
  const known = new Set<string>();
  if (companyIds.length) {
    for (const row of await db.select({ id: companies.id }).from(companies).where(and(inArray(companies.id, companyIds), eq(companies.workspace_id, workspaceId), isNull(companies.deleted_at)))) known.add(row.id);
  }
  if (ownerIds.length) {
    for (const row of await db.select({ id: users.id }).from(users).where(and(inArray(users.id, ownerIds), eq(users.workspace_id, workspaceId)))) known.add(row.id);
  }
  if (tagIds.length) {
    for (const row of await db.select({ id: tags.id }).from(tags).where(and(inArray(tags.id, tagIds), eq(tags.workspace_id, workspaceId)))) known.add(row.id);
  }
  const errors: FieldError[] = [];
  rows.forEach((row, index) => {
    const at = options.rowPath(index);
    if (row.company_id && !known.has(row.company_id)) errors.push({ path: `${at}.company_id`, message: 'No such company in this workspace.' });
    if (row.owner_user_id && !known.has(row.owner_user_id)) errors.push({ path: `${at}.owner_user_id`, message: 'No such user in this workspace.' });
    row.tag_ids?.forEach((tagId, tagIndex) => {
      if (!known.has(tagId)) errors.push({ path: `${at}.tag_ids.${tagIndex}`, message: 'No such tag in this workspace.' });
    });
    if (row.timezone && !isTimeZone(row.timezone)) errors.push({ path: `${at}.timezone`, message: 'Not an IANA timezone.' });
  });
  return errors;
}

const STAGE_ORDER = ['lead', 'prospect', 'engaged', 'opportunity', 'customer'];

/** The change `strategy` makes to an existing contact, as column values. */
function patchFor(current: ContactRow, row: UpsertRow, strategy: DedupeStrategy): Partial<typeof contacts.$inferInsert> {
  const patch: Partial<typeof contacts.$inferInsert> = {};
  for (const column of NULLABLE) {
    const value = row[column];
    if (value === undefined) continue;
    if (strategy === 'overwrite' || (EMPTY(current[column]) && !EMPTY(value))) patch[column] = value;
  }
  if (row.do_not_contact !== undefined && (strategy === 'overwrite' || row.do_not_contact)) patch.do_not_contact = row.do_not_contact;
  if (row.consent_basis !== undefined && (strategy === 'overwrite' || current.consent_basis === 'unknown')) patch.consent_basis = row.consent_basis;
  if (row.lifecycle_stage !== undefined && (strategy === 'overwrite' || (current.lifecycle_stage === 'lead' && STAGE_ORDER.includes(row.lifecycle_stage)))) {
    patch.lifecycle_stage = row.lifecycle_stage;
  }
  for (const key of Object.keys(patch) as (keyof typeof patch)[]) {
    if (JSON.stringify(patch[key]) === JSON.stringify(current[key as keyof ContactRow])) delete patch[key];
  }
  return patch;
}

/**
 * Creates or updates contacts by email. Everything is checked before anything is written: if any
 * row is invalid the whole batch fails with every problem listed. Tags are only ever added.
 */
export async function upsertContactRows(db: Executor, workspaceId: string, rows: UpsertRow[], options: UpsertOptions): Promise<UpsertOutcome> {
  const { now, strategy } = options;
  const errors = await referenceErrors(db, workspaceId, rows, options);
  const emails = rows.map((row) => normalizeEmail(row.email));

  const existing = new Map<string, ContactRow>();
  for (let start = 0; start < emails.length; start += 1000) {
    const chunk = [...new Set(emails.slice(start, start + 1000))];
    const found = await db.select().from(contacts).where(and(eq(contacts.workspace_id, workspaceId), inArray(contacts.email, chunk), isNull(contacts.deleted_at)));
    for (const row of found) existing.set(row.email.toLowerCase(), row);
  }
  const domains = [...new Set(emails.map(emailDomain).filter((domain) => !isFreemailDomain(domain)))];
  const companyByDomain = new Map<string, string>();
  if (domains.length) {
    const found = await db
      .select({ id: companies.id, domain: companies.domain })
      .from(companies)
      .where(and(eq(companies.workspace_id, workspaceId), inArray(companies.domain, domains), isNull(companies.deleted_at)));
    for (const company of found) companyByDomain.set(company.domain!.toLowerCase(), company.id);
  }
  const defs = await loadCustomFieldDefs(db, workspaceId, 'contact');

  const firstIndex = new Map<string, number>();
  const results: UpsertOutcome['results'] = [];
  const inserts: (typeof contacts.$inferInsert)[] = [];
  const updates: { id: string; patch: Partial<typeof contacts.$inferInsert>; fields: string[] }[] = [];
  const tagLinks: { contact_id: string; tag_id: string }[] = [];
  const idByEmail = new Map<string, string>();

  rows.forEach((row, index) => {
    const email = emails[index]!;
    const at = options.rowPath(index);
    if (firstIndex.has(email)) {
      results.push({ index, contact_id: '', action: 'duplicate_in_request' });
      return;
    }
    firstIndex.set(email, index);
    const rowTags = [...new Set([...(row.tag_ids ?? []), ...(options.extraTagIds ?? [])])];
    const current = existing.get(email);

    if (!current) {
      const merged = mergeCustomFields(defs, null, row.custom_fields, `${at}.custom_fields`);
      errors.push(...merged.errors);
      const id = newId('contact');
      const values: typeof contacts.$inferInsert = { id, workspace_id: workspaceId, email, source: options.source, source_detail: options.sourceDetail ?? null, created_at: now, updated_at: now };
      for (const column of NULLABLE) if (row[column] !== undefined) Object.assign(values, { [column]: row[column] });
      if (row.lifecycle_stage) values.lifecycle_stage = row.lifecycle_stage;
      if (row.consent_basis) values.consent_basis = row.consent_basis;
      if (row.do_not_contact !== undefined) values.do_not_contact = row.do_not_contact;
      if (row.company_id === undefined) values.company_id = companyByDomain.get(emailDomain(email)) ?? null;
      values.custom_fields = merged.value;
      inserts.push(values);
      idByEmail.set(email, id);
      for (const tagId of rowTags) tagLinks.push({ contact_id: id, tag_id: tagId });
      results.push({ index, contact_id: id, action: 'created' });
      return;
    }

    idByEmail.set(email, current.id);
    if (strategy === 'skip') {
      results.push({ index, contact_id: current.id, action: 'skipped' });
      return;
    }
    const patch = patchFor(current, row, strategy);
    if (row.custom_fields) {
      const currentFields = current.custom_fields as Record<string, unknown>;
      const change = strategy === 'overwrite' ? row.custom_fields : Object.fromEntries(Object.entries(row.custom_fields).filter(([key, value]) => currentFields[key] === undefined && value !== null));
      const merged = mergeCustomFields(defs, currentFields, change, `${at}.custom_fields`);
      errors.push(...merged.errors);
      if (JSON.stringify(merged.value) !== JSON.stringify(currentFields)) patch.custom_fields = merged.value;
    }
    for (const tagId of rowTags) tagLinks.push({ contact_id: current.id, tag_id: tagId });
    const fields = Object.keys(patch);
    if (fields.length > 0) updates.push({ id: current.id, patch, fields });
    results.push({ index, contact_id: current.id, action: fields.length > 0 ? 'updated' : 'unchanged' });
  });

  if (errors.length > 0) throw validationFailed(errors, 'Nothing was written: fix the rows listed in errors and send the batch again.');

  for (let start = 0; start < inserts.length; start += 500) await db.insert(contacts).values(inserts.slice(start, start + 500));
  for (const update of updates) await db.update(contacts).set({ ...update.patch, updated_at: now }).where(eq(contacts.id, update.id));

  // Tags only ever get added; a contact whose only change is a new tag counts as updated.
  const newTags = new Set<string>();
  for (let start = 0; start < tagLinks.length; start += 1000) {
    const added = await db.insert(contact_tags).values(tagLinks.slice(start, start + 1000)).onConflictDoNothing().returning({ contact_id: contact_tags.contact_id });
    for (const link of added) newTags.add(link.contact_id);
  }
  for (const result of results) {
    if (result.action === 'unchanged' && newTags.has(result.contact_id)) result.action = 'updated';
    if (result.action === 'duplicate_in_request') result.contact_id = idByEmail.get(emails[result.index]!)!;
  }
  if (options.listId) {
    const memberIds = [...new Set(idByEmail.values())];
    for (let start = 0; start < memberIds.length; start += 1000) {
      await db
        .insert(list_members)
        .values(memberIds.slice(start, start + 1000).map((contact_id) => ({ list_id: options.listId!, contact_id, added_at: now })))
        .onConflictDoNothing();
    }
  }

  const log: (typeof activities.$inferInsert)[] = [];
  for (const insert of inserts) log.push({ id: newId('activity'), workspace_id: workspaceId, contact_id: insert.id, type: 'contact.created', ...options.actor, data: { source: options.source, ...(options.sourceDetail && { source_detail: options.sourceDetail }) }, occurred_at: now });
  const changedFields = new Map(updates.map((update) => [update.id, update.fields]));
  for (const result of results) {
    if (result.action !== 'updated') continue;
    const fields = [...(changedFields.get(result.contact_id) ?? []), ...(newTags.has(result.contact_id) ? ['tag_ids'] : [])];
    log.push({ id: newId('activity'), workspace_id: workspaceId, contact_id: result.contact_id, type: 'contact.updated', ...options.actor, data: { fields, via: options.source }, occurred_at: now });
  }
  for (let start = 0; start < log.length; start += 1000) await db.insert(activities).values(log.slice(start, start + 1000));

  for (const insert of inserts) await options.jobs.enqueue('contact.verify', { contact_id: insert.id! }, { db });
  await evaluateContactThreads(db, options.jobs, updates.filter((update) => 'do_not_contact' in update.patch).map((update) => update.id));

  const count = (action: UpsertAction) => results.filter((result) => result.action === action).length;
  return { created: count('created'), updated: count('updated'), skipped: count('skipped') + count('unchanged') + count('duplicate_in_request'), results };
}

export async function upsertContacts(db: Db, principal: Principal, input: { contacts: UpsertRow[]; dedupe_strategy?: DedupeStrategy | undefined }, now: Date, jobs: JobQueue) {
  return db.transaction((tx) =>
    upsertContactRows(tx, principal.workspace.id, input.contacts, {
      strategy: input.dedupe_strategy ?? 'skip',
      source: 'api',
      actor: actorOf(principal),
      now,
      rowPath: (index) => `body.contacts.${index}`,
      jobs,
    }),
  );
}

// ── Bulk actions ───────────────────────────────────────────────────────────────────────────────

export type BulkAction = 'tag' | 'untag' | 'add_to_list' | 'remove_from_list' | 'set_owner' | 'set_lifecycle_stage' | 'verify' | 'suppress' | 'delete' | 'export';

export interface BulkActionInput {
  action: BulkAction;
  contact_ids?: string[] | undefined;
  filter?: Record<string, unknown> | undefined;
  tag_ids?: string[] | undefined;
  list_id?: string | undefined;
  owner_user_id?: string | null | undefined;
  lifecycle_stage?: ContactRow['lifecycle_stage'] | undefined;
  note?: string | undefined;
}

export const MAX_FILTER_SELECTION = 5000;

interface Skip {
  contact_id: string;
  reason: string;
}

/** The contacts a bulk action applies to, and the requested IDs that don't exist. */
async function selectContacts(db: Executor, workspaceId: string, input: BulkActionInput, now: Date): Promise<{ rows: ContactRow[]; skipped: Skip[] }> {
  if ((input.contact_ids === undefined) === (input.filter === undefined)) throw invalidField('body.contact_ids', 'Give exactly one of contact_ids or filter.');
  const base = and(eq(contacts.workspace_id, workspaceId), isNull(contacts.deleted_at));
  if (input.contact_ids) {
    const ids = [...new Set(input.contact_ids)];
    const rows = await db.select().from(contacts).where(and(base, inArray(contacts.id, ids)));
    const found = new Set(rows.map((row) => row.id));
    return { rows, skipped: ids.filter((id) => !found.has(id)).map((contact_id) => ({ contact_id, reason: 'not_found' })) };
  }
  const condition = await compileContactFilter(input.filter, { db, workspaceId, now, path: 'body.filter' });
  const rows = await db.select().from(contacts).where(and(base, condition)).orderBy(contacts.id).limit(MAX_FILTER_SELECTION + 1);
  if (rows.length > MAX_FILTER_SELECTION) throw invalidField('body.filter', `The filter matches more than ${MAX_FILTER_SELECTION} contacts. Narrow it and run the action in parts.`);
  return { rows, skipped: [] };
}

const csvCell = (value: unknown) => {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'string' ? value : typeof value === 'object' ? JSON.stringify(value) : String(value);
  // Leading = + - @ would run as a formula in a spreadsheet.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

async function exportCsv(db: Executor, rows: ContactRow[]): Promise<string> {
  const tagIds = await tagIdsByContact(db, rows.map((row) => row.id));
  const tagNames = new Map<string, string>();
  const allTags = [...new Set([...tagIds.values()].flat())];
  if (allTags.length) for (const tag of await db.select({ id: tags.id, name: tags.name }).from(tags).where(inArray(tags.id, allTags))) tagNames.set(tag.id, tag.name);
  const companyIds = [...new Set(rows.map((row) => row.company_id).filter((id): id is string => id !== null))];
  const companyNames = new Map<string, string>();
  if (companyIds.length) for (const company of await db.select({ id: companies.id, name: companies.name }).from(companies).where(inArray(companies.id, companyIds))) companyNames.set(company.id, company.name);
  const customKeys = [...new Set(rows.flatMap((row) => Object.keys(row.custom_fields as object)))].sort();

  const header = [
    'id', 'email', 'first_name', 'last_name', 'title', 'phone', 'linkedin_url', 'company', 'city', 'country', 'timezone', 'lifecycle_stage',
    'email_verification', 'subscription_status', 'do_not_contact', 'tags', 'created_at', ...customKeys.map((key) => `custom.${key}`),
  ];
  const lines = [header.join(',')];
  for (const row of rows) {
    const custom = row.custom_fields as Record<string, unknown>;
    lines.push(
      [
        row.id, row.email, row.first_name, row.last_name, row.title, row.phone, row.linkedin_url, row.company_id ? companyNames.get(row.company_id) : null,
        row.city, row.country, row.timezone, row.lifecycle_stage, row.email_verification, row.subscription_status, row.do_not_contact,
        (tagIds.get(row.id) ?? []).map((id) => tagNames.get(id)).join(';'), row.created_at.toISOString(), ...customKeys.map((key) => custom[key]),
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}

export async function applyContactBulkAction(db: Db, principal: Principal, input: BulkActionInput, deps: { dns: MailDns; jobs: JobQueue }, now: Date) {
  const workspaceId = principal.workspace.id;
  const actor = actorOf(principal);
  const need = <K extends keyof BulkActionInput>(field: K): NonNullable<BulkActionInput[K]> => {
    if (input[field] === undefined) throw invalidField(`body.${field}`, `The ${input.action} action needs ${field}.`);
    return input[field] as NonNullable<BulkActionInput[K]>;
  };
  const logChange = (contactIds: string[], data: Record<string, unknown>, type = 'contact.updated'): (typeof activities.$inferInsert)[] =>
    contactIds.map((contact_id) => ({ id: newId('activity'), workspace_id: workspaceId, contact_id, type, ...actor, data: { ...data, via: 'bulk_action' }, occurred_at: now }));
  const insertLog = async (tx: Executor, log: (typeof activities.$inferInsert)[]) => {
    for (let start = 0; start < log.length; start += 1000) await tx.insert(activities).values(log.slice(start, start + 1000));
  };

  // Verification looks up DNS for every domain, so it runs outside a transaction, one contact at a time.
  if (input.action === 'verify') {
    const { rows, skipped } = await selectContacts(db, workspaceId, input, now);
    let changed = 0;
    for (const row of rows) {
      const before = row.email_verification;
      const { row: after } = await verifyContact(db, workspaceId, row.id, deps.dns, now, actor);
      if (after.email_verification !== before) changed += 1;
    }
    return { action: input.action, matched: rows.length, changed, skipped, csv: null };
  }

  return db.transaction(async (tx) => {
    const { rows, skipped } = await selectContacts(tx, workspaceId, input, now);
    const ids = rows.map((row) => row.id);
    let changed = 0;
    let csv: string | null = null;

    switch (input.action) {
      case 'tag':
      case 'untag': {
        const tagIds = [...new Set(need('tag_ids'))];
        const known = await tx.select({ id: tags.id }).from(tags).where(and(inArray(tags.id, tagIds), eq(tags.workspace_id, workspaceId)));
        if (known.length !== tagIds.length) throw invalidField('body.tag_ids', 'Every tag must exist in this workspace.');
        if (ids.length === 0) break;
        let touched: string[];
        if (input.action === 'tag') {
          const added = await tx
            .insert(contact_tags)
            .values(ids.flatMap((contact_id) => tagIds.map((tag_id) => ({ contact_id, tag_id }))))
            .onConflictDoNothing()
            .returning({ contact_id: contact_tags.contact_id });
          touched = [...new Set(added.map((row) => row.contact_id))];
        } else {
          const removed = await tx
            .delete(contact_tags)
            .where(and(inArray(contact_tags.contact_id, ids), inArray(contact_tags.tag_id, tagIds)))
            .returning({ contact_id: contact_tags.contact_id });
          touched = [...new Set(removed.map((row) => row.contact_id))];
        }
        changed = touched.length;
        await insertLog(tx, logChange(touched, { fields: ['tag_ids'], [input.action === 'tag' ? 'added' : 'removed']: tagIds }));
        break;
      }
      case 'add_to_list':
      case 'remove_from_list': {
        const list = await findList(tx, workspaceId, need('list_id')).catch(() => {
          throw invalidField('body.list_id', 'No such list in this workspace.');
        });
        if (list.kind !== 'static') throw invalidField('body.list_id', 'Only a static list has hand-picked members.');
        if (ids.length === 0) break;
        if (input.action === 'add_to_list') {
          const added = await tx.insert(list_members).values(ids.map((contact_id) => ({ list_id: list.id, contact_id, added_at: now }))).onConflictDoNothing().returning();
          changed = added.length;
        } else {
          const removed = await tx.delete(list_members).where(and(eq(list_members.list_id, list.id), inArray(list_members.contact_id, ids))).returning();
          changed = removed.length;
        }
        break;
      }
      case 'set_owner': {
        if (input.owner_user_id === undefined) throw invalidField('body.owner_user_id', 'The set_owner action needs owner_user_id (null clears it).');
        const owner = input.owner_user_id;
        if (owner) {
          const [user] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, owner), eq(users.workspace_id, workspaceId)));
          if (!user) throw invalidField('body.owner_user_id', 'No such user in this workspace.');
        }
        if (ids.length === 0) break;
        const differs: SQL = owner ? or(isNull(contacts.owner_user_id), ne(contacts.owner_user_id, owner))! : sql`${contacts.owner_user_id} is not null`;
        const updated = await tx.update(contacts).set({ owner_user_id: owner, updated_at: now }).where(and(inArray(contacts.id, ids), differs)).returning({ id: contacts.id });
        changed = updated.length;
        await insertLog(tx, logChange(updated.map((row) => row.id), { fields: ['owner_user_id'], to: owner }));
        break;
      }
      case 'set_lifecycle_stage': {
        const stage = need('lifecycle_stage');
        if (ids.length === 0) break;
        const updated = await tx
          .update(contacts)
          .set({ lifecycle_stage: stage, updated_at: now })
          .where(and(inArray(contacts.id, ids), ne(contacts.lifecycle_stage, stage)))
          .returning({ id: contacts.id });
        changed = updated.length;
        await insertLog(tx, logChange(updated.map((row) => row.id), { fields: ['lifecycle_stage'], to: stage }));
        break;
      }
      case 'suppress': {
        for (const row of rows) {
          const { created } = await suppress(
            tx,
            workspaceId,
            { email: row.email, reason: 'manual', source: 'manual', note: input.note ?? null, createdBy: principal.kind === 'user' ? principal.id : null, jobs: deps.jobs },
            now,
          );
          if (created) changed += 1;
          else skipped.push({ contact_id: row.id, reason: 'already_suppressed' });
        }
        break;
      }
      case 'delete': {
        if (ids.length === 0) break;
        const deleted = await tx.update(contacts).set({ deleted_at: now, updated_at: now }).where(and(inArray(contacts.id, ids), isNull(contacts.deleted_at))).returning({ id: contacts.id });
        changed = deleted.length;
        await insertLog(tx, logChange(deleted.map((row) => row.id), {}, 'contact.deleted'));
        await evaluateContactThreads(tx, deps.jobs, deleted.map((row) => row.id));
        break;
      }
      case 'export': {
        csv = await exportCsv(tx, rows);
        changed = rows.length;
        break;
      }
    }
    return { action: input.action, matched: rows.length, changed, skipped, csv };
  });
}
