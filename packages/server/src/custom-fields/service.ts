// Custom field definitions (spec §6.4, §12.1) and the checks every contact and company write runs
// against them.

import type { CustomField } from '@catalyst/contract';
import { custom_field_defs, newId, type Executor } from '@catalyst/db';
import { and, asc, eq, sql, type SQL } from 'drizzle-orm';

import { conflict, invalidField, notFound, PG_UNIQUE_VIOLATION, pgErrorCode, validationFailed, type FieldError } from '../api/errors.ts';
import { decodeCursor, page } from '../api/pagination.ts';

type DefRow = typeof custom_field_defs.$inferSelect;
export type CustomFieldEntity = 'contact' | 'company';
export type CustomFieldType = 'text' | 'number' | 'date' | 'boolean' | 'select' | 'url';

export function serializeCustomField(row: DefRow): CustomField {
  return {
    id: row.id,
    entity: row.entity as CustomFieldEntity,
    key: row.key,
    label: row.label,
    type: row.type as CustomFieldType,
    options: (row.options as string[] | null) ?? null,
    required: row.required,
  };
}

const SORT = 'entity,key';

export async function listCustomFields(db: Executor, workspaceId: string, query: { limit: number; cursor?: string | undefined; entity?: CustomFieldEntity | undefined }) {
  const where: SQL[] = [eq(custom_field_defs.workspace_id, workspaceId)];
  if (query.entity) where.push(eq(custom_field_defs.entity, query.entity));
  if (query.cursor) {
    const cursorId = decodeCursor(query.cursor, SORT);
    where.push(sql`(${custom_field_defs.entity}, ${custom_field_defs.key}) > (select d.entity, d.key from custom_field_defs d where d.id = ${cursorId} and d.workspace_id = ${workspaceId})`);
  }
  const rows = await db
    .select()
    .from(custom_field_defs)
    .where(and(...where))
    .orderBy(asc(custom_field_defs.entity), asc(custom_field_defs.key))
    .limit(query.limit + 1);
  const { rows: kept, next_cursor } = page(rows, query.limit, SORT);
  return { data: kept.map(serializeCustomField), next_cursor };
}

function checkOptions(type: CustomFieldType, options: string[] | undefined, path: string): void {
  if (type === 'select' && options === undefined) throw invalidField(path, 'A select field needs its options.');
  if (type !== 'select' && options !== undefined) throw invalidField(path, 'Only a select field has options.');
  if (options && new Set(options).size !== options.length) throw invalidField(path, 'Options must be unique.');
}

export async function createCustomField(
  db: Executor,
  workspaceId: string,
  input: { entity: CustomFieldEntity; key: string; label: string; type: CustomFieldType; options?: string[] | undefined; required?: boolean | undefined },
): Promise<CustomField> {
  checkOptions(input.type, input.options, 'body.options');
  try {
    const [row] = await db
      .insert(custom_field_defs)
      .values({
        id: newId('custom_field'),
        workspace_id: workspaceId,
        entity: input.entity,
        key: input.key,
        label: input.label,
        type: input.type,
        options: input.options ?? null,
        required: input.required ?? false,
      })
      .returning();
    return serializeCustomField(row!);
  } catch (error) {
    if (pgErrorCode(error) === PG_UNIQUE_VIOLATION) {
      throw conflict(`A ${input.entity} field with the key "${input.key}" already exists.`, [{ path: 'body.key', message: 'Already used.' }]);
    }
    throw error;
  }
}

async function findField(db: Executor, workspaceId: string, fieldId: string): Promise<DefRow> {
  const [row] = await db.select().from(custom_field_defs).where(and(eq(custom_field_defs.id, fieldId), eq(custom_field_defs.workspace_id, workspaceId)));
  if (!row) throw notFound('The custom field');
  return row;
}

export async function updateCustomField(
  db: Executor,
  workspaceId: string,
  fieldId: string,
  input: { label?: string | undefined; options?: string[] | undefined; required?: boolean | undefined },
): Promise<CustomField> {
  const current = await findField(db, workspaceId, fieldId);
  if (input.options !== undefined) checkOptions(current.type as CustomFieldType, input.options, 'body.options');
  const patch: Partial<typeof custom_field_defs.$inferInsert> = {};
  if (input.label !== undefined) patch.label = input.label;
  if (input.options !== undefined) patch.options = input.options;
  if (input.required !== undefined) patch.required = input.required;
  if (Object.keys(patch).length === 0) return serializeCustomField(current);
  const [row] = await db.update(custom_field_defs).set(patch).where(eq(custom_field_defs.id, fieldId)).returning();
  return serializeCustomField(row!);
}

export async function deleteCustomField(db: Executor, workspaceId: string, fieldId: string): Promise<void> {
  await findField(db, workspaceId, fieldId);
  await db.delete(custom_field_defs).where(eq(custom_field_defs.id, fieldId));
}

// ── Checking values ────────────────────────────────────────────────────────────────────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Why a value doesn't fit a field, or null when it does. */
export function customValueError(def: { type: string; options: unknown }, value: unknown): string | null {
  switch (def.type) {
    case 'text':
      return typeof value === 'string' ? null : 'Expected text.';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? null : 'Expected a number.';
    case 'boolean':
      return typeof value === 'boolean' ? null : 'Expected true or false.';
    case 'date': {
      if (typeof value !== 'string' || !ISO_DATE.test(value)) return 'Expected a date as YYYY-MM-DD.';
      const date = new Date(`${value}T00:00:00Z`);
      return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value) ? null : 'Not a real calendar date.';
    }
    case 'select': {
      const options = (def.options as string[] | null) ?? [];
      return typeof value === 'string' && options.includes(value) ? null : `Expected one of: ${options.join(', ')}.`;
    }
    case 'url':
      if (typeof value !== 'string') return 'Expected a URL.';
      try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:' ? null : 'Expected an http or https URL.';
      } catch {
        return 'Expected a URL.';
      }
    default:
      return null;
  }
}

export type CustomFieldDefs = DefRow[];

export function loadCustomFieldDefs(db: Executor, workspaceId: string, entity: CustomFieldEntity): Promise<CustomFieldDefs> {
  return db.select().from(custom_field_defs).where(and(eq(custom_field_defs.workspace_id, workspaceId), eq(custom_field_defs.entity, entity)));
}

/**
 * Applies a `custom_fields` change and checks it against the definitions. Keys given are set, a
 * null removes the key, and keys left out stay. Values under keys with no definition are kept as
 * they are. `current` is null for a new record. Returns the resulting object, or the problems.
 */
export function mergeCustomFields(
  defs: CustomFieldDefs,
  current: Record<string, unknown> | null,
  change: Record<string, unknown> | undefined,
  path = 'body.custom_fields',
): { value: Record<string, unknown>; errors: FieldError[] } {
  const value: Record<string, unknown> = { ...(current ?? {}) };
  for (const [key, entry] of Object.entries(change ?? {})) {
    if (entry === null) delete value[key];
    else value[key] = entry;
  }

  const errors: FieldError[] = [];
  for (const def of defs) {
    const entry = value[def.key];
    if (entry === undefined) {
      // A required field must be given on a new record and can never be cleared.
      const removed = current !== null && current[def.key] !== undefined;
      if (def.required && (current === null || removed)) errors.push({ path: `${path}.${def.key}`, message: `${def.label} is required.` });
      continue;
    }
    if (change && Object.hasOwn(change, def.key)) {
      const problem = customValueError(def, entry);
      if (problem) errors.push({ path: `${path}.${def.key}`, message: problem });
    }
  }
  return { value, errors };
}

/** `mergeCustomFields` for one record, throwing `validation_failed` on a problem. */
export async function applyCustomFields(
  db: Executor,
  workspaceId: string,
  entity: CustomFieldEntity,
  current: Record<string, unknown> | null,
  change: Record<string, unknown> | undefined,
  path = 'body.custom_fields',
): Promise<Record<string, unknown>> {
  const { value, errors } = mergeCustomFields(await loadCustomFieldDefs(db, workspaceId, entity), current, change, path);
  if (errors.length > 0) throw validationFailed(errors);
  return value;
}
