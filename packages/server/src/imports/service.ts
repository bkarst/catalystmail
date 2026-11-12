// Contact imports (spec §12.3): upload → mapping → options → dry run → commit, then a background job
// writes the contacts in chunks and records progress, counts and row errors.

import { MAX_IMPORT_ROWS, type Import } from '@catalyst/contract';
import { companies, contacts, emailDomain, emailHash, imports, lists, newId, suppressions, tags, users, type Db, type Executor } from '@catalyst/db';
import type { JobQueue } from '@catalyst/jobs';
import type { ObjectStorage } from '@catalyst/storage';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';

import type { Principal } from '../api/auth.ts';
import { ApiError, conflict, invalidField, notFound, validationFailed, type FieldError } from '../api/errors.ts';
import { upsertContactRows, type DedupeStrategy, type UpsertRow } from '../contacts/bulk.ts';
import { loadCustomFieldDefs, type CustomFieldDefs } from '../custom-fields/service.ts';
import { iso } from '../shared.ts';
import { parseCsv, type ParsedCsv } from './csv.ts';
import { mapRow, mappingProblems, suggestMapping, type ColumnMapping, type MappedRow, type RowError } from './mapping.ts';

type ImportRow = typeof imports.$inferSelect;
type ConsentBasis = 'legitimate_interest' | 'consent' | 'existing_relationship' | 'unknown';

interface StoredOptions {
  sample_rows?: string[][];
  consent_basis?: ConsentBasis;
  owner_user_id?: string;
}

export interface ImportOptions {
  mapping: ColumnMapping;
  dedupe_strategy?: DedupeStrategy | undefined;
  tag_ids?: string[] | undefined;
  list_id?: string | undefined;
  consent_basis?: ConsentBasis | undefined;
  owner_user_id?: string | undefined;
}

const MAX_STORED_ERRORS = 1000;
const CHUNK = 500;

function serializeImport(row: ImportRow, defs: CustomFieldDefs): Import {
  const options = row.options as StoredOptions;
  const samples = options.sample_rows ?? [];
  return {
    id: row.id,
    filename: row.filename,
    status: row.status as Import['status'],
    headers: row.headers,
    sample_rows: samples,
    suggested_mapping: suggestMapping(row.headers, samples, defs),
    mapping: (row.mapping as ColumnMapping | null) ?? null,
    dedupe_strategy: row.dedupe_strategy as DedupeStrategy,
    tag_ids: row.tag_ids,
    list_id: row.target_list_id,
    total_rows: row.total_rows ?? 0,
    processed_rows: row.processed_rows,
    created_count: row.created_count ?? 0,
    updated_count: row.updated_count ?? 0,
    skipped_count: row.skipped_count ?? 0,
    error_count: row.error_count ?? 0,
    errors: row.errors as RowError[],
    created_at: row.created_at.toISOString(),
    finished_at: iso(row.finished_at),
  };
}

async function findImport(db: Executor, workspaceId: string, importId: string): Promise<ImportRow> {
  const [row] = await db.select().from(imports).where(and(eq(imports.id, importId), eq(imports.workspace_id, workspaceId)));
  if (!row) throw notFound('The import');
  return row;
}

export async function createImport(db: Db, principal: Principal, input: { filename: string; content: string }, storage: ObjectStorage, now: Date): Promise<Import> {
  const workspaceId = principal.workspace.id;
  const parsed = parseCsv(input.content);
  if (parsed.headers.length === 0) throw invalidField('body.content', 'The file is empty.');
  if (parsed.rows.length === 0) throw invalidField('body.content', 'The file has a header row but no contacts.');
  if (parsed.rows.length > MAX_IMPORT_ROWS) throw invalidField('body.content', `The file has ${parsed.rows.length} rows; split it into files of at most ${MAX_IMPORT_ROWS}.`);

  const id = newId('import');
  const storageKey = `imports/${workspaceId}/${id}.csv`;
  await storage.put(storageKey, Buffer.from(input.content, 'utf8'), 'text/csv');
  const [row] = await db
    .insert(imports)
    .values({
      id,
      workspace_id: workspaceId,
      filename: input.filename,
      storage_key: storageKey,
      headers: parsed.headers,
      options: { sample_rows: parsed.rows.slice(0, 5) },
      total_rows: parsed.rows.length,
      created_by: principal.kind === 'user' ? principal.id : null,
      created_at: now,
    })
    .returning();
  return serializeImport(row!, await loadCustomFieldDefs(db, workspaceId, 'contact'));
}

export async function getImport(db: Db, workspaceId: string, importId: string): Promise<Import> {
  return serializeImport(await findImport(db, workspaceId, importId), await loadCustomFieldDefs(db, workspaceId, 'contact'));
}

/** Checks the options against the file and the workspace. */
async function checkOptions(db: Executor, workspaceId: string, row: ImportRow, options: ImportOptions, defs: CustomFieldDefs): Promise<void> {
  const errors: FieldError[] = mappingProblems(options.mapping, row.headers, defs);
  if (options.tag_ids?.length) {
    const found = await db.select({ id: tags.id }).from(tags).where(and(inArray(tags.id, options.tag_ids), eq(tags.workspace_id, workspaceId)));
    if (found.length !== new Set(options.tag_ids).size) errors.push({ path: 'body.tag_ids', message: 'Every tag must exist in this workspace.' });
  }
  if (options.list_id) {
    const [list] = await db.select({ kind: lists.kind }).from(lists).where(and(eq(lists.id, options.list_id), eq(lists.workspace_id, workspaceId)));
    if (!list) errors.push({ path: 'body.list_id', message: 'No such list in this workspace.' });
    else if (list.kind !== 'static') errors.push({ path: 'body.list_id', message: 'Contacts can only be added to a static list.' });
  }
  if (options.owner_user_id) {
    const [owner] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, options.owner_user_id), eq(users.workspace_id, workspaceId)));
    if (!owner) errors.push({ path: 'body.owner_user_id', message: 'No such user in this workspace.' });
  }
  if (errors.length > 0) throw validationFailed(errors);
}

interface Analysis {
  rows: MappedRow[];
  errors: RowError[];
  invalid: number;
  suppressed: number;
  duplicates: number;
  existing: Set<string>;
}

/** Maps every row and sorts it into importable, invalid, suppressed or repeated. Writes nothing. */
async function analyze(db: Executor, workspaceId: string, parsed: ParsedCsv, mapping: ColumnMapping, defs: CustomFieldDefs): Promise<Analysis> {
  const rows: MappedRow[] = [];
  const errors: RowError[] = [];
  let invalid = 0;
  let duplicates = 0;
  const seen = new Set<string>();
  parsed.rows.forEach((cells, index) => {
    const result = mapRow(cells, parsed.headers, mapping, defs, index + 2);
    if (Array.isArray(result)) {
      invalid += 1;
      errors.push(...result);
    } else if (seen.has(result.email)) duplicates += 1;
    else {
      seen.add(result.email);
      rows.push(result);
    }
  });

  // Suppressed addresses and domains are reported, not imported.
  const blocked = new Set<string>();
  const emails = rows.map((row) => row.email);
  for (let start = 0; start < emails.length; start += 1000) {
    const chunk = emails.slice(start, start + 1000);
    const hashes = chunk.map(emailHash);
    const domains = [...new Set(chunk.map(emailDomain))];
    const matches = await db
      .select({ email_hash: suppressions.email_hash, domain: suppressions.domain })
      .from(suppressions)
      .where(and(eq(suppressions.workspace_id, workspaceId), or(inArray(suppressions.email_hash, hashes), inArray(suppressions.domain, domains))));
    const blockedHashes = new Set(matches.flatMap((match) => (match.email_hash ? [match.email_hash.toString('hex')] : [])));
    const blockedDomains = new Set(matches.flatMap((match) => (match.domain ? [match.domain.toLowerCase()] : [])));
    for (const email of chunk) if (blockedHashes.has(emailHash(email).toString('hex')) || blockedDomains.has(emailDomain(email))) blocked.add(email);
  }
  const importable = rows.filter((row) => !blocked.has(row.email));

  const existing = new Set<string>();
  for (let start = 0; start < importable.length; start += 1000) {
    const chunk = importable.slice(start, start + 1000).map((row) => row.email);
    const found = await db
      .select({ email: contacts.email })
      .from(contacts)
      .where(and(eq(contacts.workspace_id, workspaceId), isNull(contacts.deleted_at), inArray(contacts.email, chunk)));
    for (const row of found) existing.add(row.email.toLowerCase());
  }
  return { rows: importable, errors, invalid, suppressed: blocked.size, duplicates, existing };
}

async function readFile(storage: ObjectStorage, row: ImportRow): Promise<ParsedCsv> {
  return parseCsv((await storage.get(row.storage_key)).toString('utf8'));
}

const optionColumns = (options: ImportOptions, previous: StoredOptions) => ({
  mapping: options.mapping,
  dedupe_strategy: options.dedupe_strategy ?? 'skip',
  tag_ids: [...new Set(options.tag_ids ?? [])],
  target_list_id: options.list_id ?? null,
  options: {
    ...(previous.sample_rows && { sample_rows: previous.sample_rows }),
    ...(options.consent_basis && { consent_basis: options.consent_basis }),
    ...(options.owner_user_id && { owner_user_id: options.owner_user_id }),
  },
});

export async function previewImport(db: Db, principal: Principal, importId: string, options: ImportOptions, storage: ObjectStorage) {
  const workspaceId = principal.workspace.id;
  const row = await findImport(db, workspaceId, importId);
  if (row.status !== 'uploaded' && row.status !== 'mapped') throw conflict(`This import was already committed (status ${row.status}).`);
  const defs = await loadCustomFieldDefs(db, workspaceId, 'contact');
  await checkOptions(db, workspaceId, row, options, defs);
  const analysis = await analyze(db, workspaceId, await readFile(storage, row), options.mapping, defs);
  await db.update(imports).set({ ...optionColumns(options, row.options as StoredOptions), status: 'mapped' }).where(eq(imports.id, importId));

  const existing = analysis.rows.filter((entry) => analysis.existing.has(entry.email)).length;
  const strategy = options.dedupe_strategy ?? 'skip';
  return {
    new: analysis.rows.length - existing,
    update: strategy === 'skip' ? 0 : existing,
    skip: strategy === 'skip' ? existing : 0,
    invalid: analysis.invalid,
    suppressed: analysis.suppressed,
    duplicates_in_file: analysis.duplicates,
    errors: analysis.errors.slice(0, 100),
  };
}

export async function commitImport(db: Db, principal: Principal, importId: string, options: ImportOptions, jobs: JobQueue): Promise<Import> {
  const workspaceId = principal.workspace.id;
  const defs = await loadCustomFieldDefs(db, workspaceId, 'contact');
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(imports).where(and(eq(imports.id, importId), eq(imports.workspace_id, workspaceId))).for('update');
    if (!row) throw notFound('The import');
    if (row.status !== 'uploaded' && row.status !== 'mapped') throw conflict(`This import was already committed (status ${row.status}).`);
    await checkOptions(tx, workspaceId, row, options, defs);
    const [updated] = await tx
      .update(imports)
      .set({ ...optionColumns(options, row.options as StoredOptions), status: 'processing', processed_rows: 0, created_count: 0, updated_count: 0, skipped_count: 0, error_count: 0, errors: [] })
      .where(eq(imports.id, importId))
      .returning();
    await jobs.enqueue('import.process', { import_id: importId }, { db: tx });
    return serializeImport(updated!, defs);
  });
}

// ── The import.process job ─────────────────────────────────────────────────────────────────────

/** Company IDs for the company names in the file: existing ones by name, the rest created. */
async function companiesByName(db: Executor, workspaceId: string, names: string[], now: Date): Promise<Map<string, string>> {
  const byName = new Map<string, string>();
  const unique = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
  for (let start = 0; start < unique.length; start += 1000) {
    const chunk = unique.slice(start, start + 1000);
    const found = await db
      .select({ id: companies.id, name: companies.name })
      .from(companies)
      .where(and(eq(companies.workspace_id, workspaceId), isNull(companies.deleted_at), inArray(sql`lower(${companies.name})`, chunk.map((name) => name.toLowerCase()))))
      .orderBy(companies.created_at);
    // The oldest company of a name wins.
    for (const company of found) if (!byName.has(company.name.toLowerCase())) byName.set(company.name.toLowerCase(), company.id);
    const missing = chunk.filter((name) => !byName.has(name.toLowerCase()));
    const created = new Map<string, string>();
    for (const name of missing) if (!created.has(name.toLowerCase())) created.set(name.toLowerCase(), name);
    if (created.size > 0) {
      const values = [...created.entries()].map(([key, name]) => ({ id: newId('company'), workspace_id: workspaceId, name, created_at: now, updated_at: now, key }));
      await db.insert(companies).values(values.map(({ key: _key, ...value }) => value));
      for (const value of values) byName.set(value.key, value.id);
    }
  }
  return byName;
}

/** Tag IDs for tag names in the file, creating the ones that don't exist. */
async function tagsByName(db: Executor, workspaceId: string, names: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(names)];
  const byName = new Map<string, string>();
  if (unique.length === 0) return byName;
  await db
    .insert(tags)
    .values(unique.map((name) => ({ id: newId('tag'), workspace_id: workspaceId, name: name.slice(0, 60) })))
    .onConflictDoNothing();
  const found = await db.select({ id: tags.id, name: tags.name }).from(tags).where(and(eq(tags.workspace_id, workspaceId), inArray(tags.name, unique.map((name) => name.slice(0, 60)))));
  for (const tag of found) byName.set(tag.name, tag.id);
  return byName;
}

export interface ImportJobDeps {
  storage: ObjectStorage;
  jobs: JobQueue;
}

/**
 * Writes the contacts of a committed import. Each chunk of rows is one transaction, so progress is
 * kept if the job stops; running it again is safe, because contacts are matched by email.
 */
export async function processImport(db: Db, importId: string, deps: ImportJobDeps, now: Date): Promise<'done' | 'failed' | 'skipped'> {
  const [row] = await db.select().from(imports).where(eq(imports.id, importId));
  if (!row || row.status !== 'processing') return 'skipped';
  const workspaceId = row.workspace_id;
  const options = row.options as StoredOptions;
  const strategy = row.dedupe_strategy as DedupeStrategy;
  const counts = { created: 0, updated: 0, skipped: 0 };
  let errors: RowError[] = [];

  const save = (patch: Partial<typeof imports.$inferInsert>) => db.update(imports).set(patch).where(eq(imports.id, importId));
  try {
    const defs = await loadCustomFieldDefs(db, workspaceId, 'contact');
    const analysis = await analyze(db, workspaceId, await readFile(deps.storage, row), row.mapping as ColumnMapping, defs);
    errors = analysis.errors;
    counts.skipped = analysis.suppressed + analysis.duplicates;
    const companyIds = await companiesByName(db, workspaceId, analysis.rows.flatMap((entry) => (entry.companyName ? [entry.companyName] : [])), now);
    const tagIds = await tagsByName(db, workspaceId, analysis.rows.flatMap((entry) => entry.tagNames));
    let processed = analysis.invalid + analysis.suppressed + analysis.duplicates;

    const toUpsert = (entry: MappedRow): UpsertRow => ({
      email: entry.email,
      ...(entry.fields as Partial<UpsertRow>),
      ...(Object.keys(entry.customFields).length > 0 && { custom_fields: entry.customFields }),
      ...(entry.companyName && { company_id: companyIds.get(entry.companyName.toLowerCase())! }),
      ...(entry.tagNames.length > 0 && { tag_ids: entry.tagNames.map((name) => tagIds.get(name.slice(0, 60))!).filter(Boolean) }),
      ...(options.consent_basis && { consent_basis: options.consent_basis }),
      ...(options.owner_user_id && { owner_user_id: options.owner_user_id }),
    });
    const upsertOptions = (chunk: MappedRow[]) => ({
      strategy,
      source: 'import',
      sourceDetail: row.filename,
      actor: { actor_type: 'system' as const, actor_id: row.created_by },
      now,
      rowPath: (index: number) => `row ${chunk[index]!.row}`,
      extraTagIds: row.tag_ids,
      listId: row.target_list_id,
      jobs: deps.jobs,
    });
    const tally = (outcome: { created: number; updated: number; skipped: number }) => {
      counts.created += outcome.created;
      counts.updated += outcome.updated;
      counts.skipped += outcome.skipped;
    };

    for (let start = 0; start < analysis.rows.length; start += CHUNK) {
      const chunk = analysis.rows.slice(start, start + CHUNK);
      try {
        tally(await db.transaction((tx) => upsertContactRows(tx, workspaceId, chunk.map(toUpsert), upsertOptions(chunk))));
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        // A row the definitions reject (say, a required custom field) fails its whole chunk; redo it row by row.
        for (const entry of chunk) {
          try {
            tally(await db.transaction((tx) => upsertContactRows(tx, workspaceId, [toUpsert(entry)], upsertOptions([entry]))));
          } catch (rowError) {
            if (!(rowError instanceof ApiError)) throw rowError;
            for (const detail of rowError.errors ?? [{ path: '', message: rowError.message }]) {
              errors.push({ row: entry.row, column: null, message: `${detail.path.replace(/^row \d+\.?/, '') || 'row'}: ${detail.message}` });
            }
          }
        }
      }
      processed += chunk.length;
      await save({ processed_rows: processed, created_count: counts.created, updated_count: counts.updated, skipped_count: counts.skipped });
    }

    const failedRows = new Set(errors.map((error) => error.row)).size;
    await save({ status: 'done', processed_rows: row.total_rows ?? processed, error_count: failedRows, errors: errors.slice(0, MAX_STORED_ERRORS), finished_at: new Date() });
    return 'done';
  } catch (error) {
    errors.push({ row: 0, column: null, message: `The import stopped: ${error instanceof Error ? error.message : String(error)}` });
    await save({ status: 'failed', created_count: counts.created, updated_count: counts.updated, skipped_count: counts.skipped, error_count: errors.length, errors: errors.slice(0, MAX_STORED_ERRORS), finished_at: new Date() });
    return 'failed';
  }
}

