// The contact filter AST (spec §12.2): conditions on contact fields, custom fields, tags and lists,
// combined with AND / OR / NOT groups. The same AST defines dynamic lists. It compiles to a
// parameterised SQL condition; field names come from a fixed list and never reach the SQL as text.

import { consentBasis, contacts, emailVerification, lifecycleStage, lists, subscriptionStatus, type Executor } from '@catalyst/db';
import { idPattern } from '@catalyst/core';
import { and, eq, inArray, sql, type AnyColumn, type SQL } from 'drizzle-orm';

import { invalidField } from '../api/errors.ts';

const MAX_DEPTH = 6;
const MAX_CONDITIONS = 50;
const MAX_LIST = 100;

type FieldKind = 'text' | 'enum' | 'boolean' | 'timestamp' | 'id';
interface Field {
  kind: FieldKind;
  column: AnyColumn;
  values?: readonly string[];
  pattern?: RegExp;
}

const text = (column: AnyColumn): Field => ({ kind: 'text', column });
const time = (column: AnyColumn): Field => ({ kind: 'timestamp', column });
const oneOf = (column: AnyColumn, values: readonly string[]): Field => ({ kind: 'enum', column, values });

const FIELDS: Record<string, Field> = {
  email: text(contacts.email),
  first_name: text(contacts.first_name),
  last_name: text(contacts.last_name),
  title: text(contacts.title),
  phone: text(contacts.phone),
  city: text(contacts.city),
  country: text(contacts.country),
  source: text(contacts.source),
  lifecycle_stage: oneOf(contacts.lifecycle_stage, lifecycleStage.enumValues),
  email_verification: oneOf(contacts.email_verification, emailVerification.enumValues),
  subscription_status: oneOf(contacts.subscription_status, subscriptionStatus.enumValues),
  consent_basis: oneOf(contacts.consent_basis, consentBasis.enumValues),
  do_not_contact: { kind: 'boolean', column: contacts.do_not_contact },
  company_id: { kind: 'id', column: contacts.company_id, pattern: idPattern('company') },
  owner_user_id: { kind: 'id', column: contacts.owner_user_id, pattern: idPattern('user') },
  created_at: time(contacts.created_at),
  updated_at: time(contacts.updated_at),
  last_contacted_at: time(contacts.last_contacted_at),
  last_replied_at: time(contacts.last_replied_at),
  last_opened_at: time(contacts.last_opened_at),
};

const OPS_BY_KIND: Record<FieldKind, readonly string[]> = {
  text: ['eq', 'neq', 'in', 'not_in', 'contains', 'starts_with', 'ends_with', 'is_null', 'is_not_null'],
  enum: ['eq', 'neq', 'in', 'not_in'],
  boolean: ['eq'],
  timestamp: ['gt', 'gte', 'lt', 'lte', 'is_null', 'is_not_null'],
  id: ['eq', 'neq', 'in', 'not_in', 'is_null', 'is_not_null'],
};
const CUSTOM_OPS = ['eq', 'neq', 'in', 'not_in', 'contains', 'starts_with', 'ends_with', 'gt', 'gte', 'lt', 'lte', 'is_null', 'is_not_null'];
const TAG_OPS = ['eq', 'neq', 'in', 'not_in'];
const LIST_OPS = TAG_OPS;
/** How deep dynamic lists may refer to other dynamic lists. */
const MAX_LIST_NESTING = 3;
const RELATIVE_AGE = /^-(\d{1,4})([hdw])$/;
const AGE_MS = { h: 3_600_000, d: 86_400_000, w: 604_800_000 } as const;
const COMPARISON = { gt: '>', gte: '>=', lt: '<', lte: '<=' } as const;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const escapeLike = (value: string) => value.replace(/[\\%_]/g, (character) => `\\${character}`);
const likePattern = (op: string, value: string) =>
  op === 'starts_with' ? `${escapeLike(value)}%` : op === 'ends_with' ? `%${escapeLike(value)}` : `%${escapeLike(value)}%`;

interface Budget {
  conditions: number;
}

export interface FilterContext {
  db: Executor;
  workspaceId: string;
  /** Relative ages such as `-30d` count back from here. */
  now: Date;
  /** Where errors are reported, e.g. `query.filter` or `body.filter`. */
  path?: string;
  /** The dynamic list this filter belongs to, so it cannot refer to itself. */
  selfListId?: string;
}

interface Scope extends Required<Omit<FilterContext, 'selfListId'>> {
  budget: Budget;
  /** Dynamic lists being expanded, to refuse a list that refers to itself. */
  expanding: string[];
}

/** Parses the URL-decoded `filter` parameter and compiles it into a SQL condition on `contacts`. */
export function compileContactFilterParam(raw: string, context: FilterContext): Promise<SQL> {
  let tree: unknown;
  try {
    tree = JSON.parse(raw);
  } catch {
    throw invalidField(context.path ?? 'query.filter', 'The filter is not valid JSON.');
  }
  return compileContactFilter(tree, context);
}

/** Compiles a parsed filter AST into a SQL condition on `contacts`. */
export function compileContactFilter(tree: unknown, context: FilterContext): Promise<SQL> {
  const { selfListId, ...rest } = context;
  const scope: Scope = { path: 'query.filter', ...rest, budget: { conditions: 0 }, expanding: selfListId ? [selfListId] : [] };
  return compileNode(tree, scope.path, 1, scope);
}

async function compileNode(node: unknown, path: string, depth: number, scope: Scope): Promise<SQL> {
  const budget = scope.budget;
  if (depth > MAX_DEPTH) throw invalidField(path, `Filters can be nested at most ${MAX_DEPTH} levels deep.`);
  if (!isObject(node)) throw invalidField(path, 'Expected a condition ({field, op, value}) or a group ({and}, {or}, {not}).');

  const keys = Object.keys(node);
  const only = keys.length === 1 ? keys[0] : undefined;
  if (only === 'and' || only === 'or') {
    const children = node[only];
    if (!Array.isArray(children) || children.length === 0) throw invalidField(`${path}.${only}`, 'A group needs at least one condition.');
    const parts: SQL[] = [];
    for (const [index, child] of children.entries()) parts.push(await compileNode(child, `${path}.${only}[${index}]`, depth + 1, scope));
    return sql`(${sql.join(parts, sql.raw(only === 'and' ? ' and ' : ' or '))})`;
  }
  // A condition on a missing value is neither true nor false in SQL; NOT treats it as not matching.
  if (only === 'not') return sql`(not coalesce(${await compileNode(node.not, `${path}.not`, depth + 1, scope)}, false))`;

  budget.conditions += 1;
  if (budget.conditions > MAX_CONDITIONS) throw invalidField(path, `A filter can hold at most ${MAX_CONDITIONS} conditions.`);
  const unknownKey = keys.find((key) => key !== 'field' && key !== 'op' && key !== 'value');
  if (unknownKey) throw invalidField(`${path}.${unknownKey}`, 'Unknown key. A condition has field, op and value.');
  const { field, op, value } = node;
  if (typeof field !== 'string') throw invalidField(`${path}.field`, 'Required.');
  if (typeof op !== 'string') throw invalidField(`${path}.op`, 'Required.');

  if (field === 'tag_id') return compileTag(op, value, path);
  if (field === 'list_id') return compileList(op, value, path, scope);
  if (field.startsWith('custom.')) return compileCustom(field.slice('custom.'.length), op, value, path);
  const known = FIELDS[field];
  if (!known) throw invalidField(`${path}.field`, `Unknown field "${field}". Use a contact field, tag_id, list_id, or custom.<key>.`);
  return compileField(known, op, value, path, scope.now);
}

/** An ISO timestamp, or a relative age such as `-30d`, `-12h` or `-2w` counted back from now. */
function timestampValue(value: unknown, now: Date): Date | null {
  if (typeof value !== 'string') return null;
  const relative = RELATIVE_AGE.exec(value);
  if (relative) return new Date(now.getTime() - Number(relative[1]) * AGE_MS[relative[2] as keyof typeof AGE_MS]);
  const at = new Date(value);
  return Number.isNaN(at.getTime()) || !/^\d{4}-\d{2}-\d{2}/.test(value) ? null : at;
}

function requireOp(op: string, allowed: readonly string[], path: string): void {
  if (!allowed.includes(op)) throw invalidField(`${path}.op`, `"${op}" is not supported here. Use one of: ${allowed.join(', ')}.`);
}

function stringList(value: unknown, path: string, check: (entry: string, at: string) => void = () => {}): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_LIST || value.some((entry) => typeof entry !== 'string')) {
    throw invalidField(`${path}.value`, `Expected a list of 1 to ${MAX_LIST} strings.`);
  }
  value.forEach((entry: string, index) => check(entry, `${path}.value[${index}]`));
  return value as string[];
}

function compileField(field: Field, op: string, value: unknown, path: string, now: Date): SQL {
  requireOp(op, OPS_BY_KIND[field.kind], path);
  const column = field.column;
  if (op === 'is_null') return sql`${column} is null`;
  if (op === 'is_not_null') return sql`${column} is not null`;

  const checkValue = (entry: string, at: string) => {
    if (field.values && !field.values.includes(entry)) throw invalidField(at, `Expected one of: ${field.values.join(', ')}.`);
    if (field.pattern && !field.pattern.test(entry)) throw invalidField(at, 'Not a valid ID for this field.');
  };

  if (op === 'in' || op === 'not_in') {
    const list = stringList(value, path, checkValue);
    return op === 'in' ? inArray(column, list) : sql`(${column} is null or not ${inArray(column, list)})`;
  }

  if (field.kind === 'boolean') {
    if (typeof value !== 'boolean') throw invalidField(`${path}.value`, 'Expected true or false.');
    return sql`${column} = ${value}`;
  }
  if (field.kind === 'timestamp') {
    const at = timestampValue(value, now);
    if (!at) throw invalidField(`${path}.value`, 'Expected an ISO-8601 timestamp or a relative age such as -30d.');
    return sql`${column} ${sql.raw(COMPARISON[op as keyof typeof COMPARISON])} ${at}`;
  }

  if (typeof value !== 'string') throw invalidField(`${path}.value`, 'Expected a string.');
  if (op === 'eq' || op === 'neq') {
    checkValue(value, `${path}.value`);
    // "Not equal" includes rows where the field is empty.
    return op === 'eq' ? sql`${column} = ${value}` : sql`${column} is distinct from ${value}`;
  }
  return sql`${column} ilike ${likePattern(op, value)}`;
}

function compileCustom(key: string, op: string, value: unknown, path: string): SQL {
  if (!/^[A-Za-z0-9_]{1,60}$/.test(key)) throw invalidField(`${path}.field`, 'A custom field key is letters, digits and underscores.');
  requireOp(op, CUSTOM_OPS, path);
  const json = sql`(${contacts.custom_fields} -> ${key})`;
  const asText = sql`(${contacts.custom_fields} ->> ${key})`;

  if (op === 'is_null') return sql`${asText} is null`;
  if (op === 'is_not_null') return sql`${asText} is not null`;
  if (op === 'in' || op === 'not_in') {
    const list = stringList(value, path);
    return op === 'in' ? sql`${asText} in ${list}` : sql`(${asText} is null or ${asText} not in ${list})`;
  }
  if (op === 'eq' || op === 'neq') {
    if (!['string', 'number', 'boolean'].includes(typeof value)) throw invalidField(`${path}.value`, 'Expected a string, number or boolean.');
    const literal = sql`${JSON.stringify(value)}::jsonb`;
    return op === 'eq' ? sql`${json} = ${literal}` : sql`${json} is distinct from ${literal}`;
  }
  if (op in COMPARISON) {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw invalidField(`${path}.value`, 'Expected a number.');
    // Only stored numbers compare; text never errors and never matches.
    return sql`(case when jsonb_typeof(${json}) = 'number' then ${asText}::numeric end) ${sql.raw(COMPARISON[op as keyof typeof COMPARISON])} ${value}`;
  }
  if (typeof value !== 'string') throw invalidField(`${path}.value`, 'Expected a string.');
  return sql`${asText} ilike ${likePattern(op, value)}`;
}

function compileTag(op: string, value: unknown, path: string): SQL {
  requireOp(op, TAG_OPS, path);
  const pattern = idPattern('tag');
  const check = (entry: string, at: string) => {
    if (!pattern.test(entry)) throw invalidField(at, 'Not a tag ID.');
  };
  let tagIds: string[];
  if (op === 'eq' || op === 'neq') {
    if (typeof value !== 'string') throw invalidField(`${path}.value`, 'Expected a tag ID.');
    check(value, `${path}.value`);
    tagIds = [value];
  } else {
    tagIds = stringList(value, path, check);
  }
  const has = sql`exists (select 1 from contact_tags where contact_tags.contact_id = contacts.id and contact_tags.tag_id in ${tagIds})`;
  return op === 'eq' || op === 'in' ? has : sql`(not ${has})`;
}

async function compileList(op: string, value: unknown, path: string, scope: Scope): Promise<SQL> {
  requireOp(op, LIST_OPS, path);
  const pattern = idPattern('list');
  const check = (entry: string, at: string) => {
    if (!pattern.test(entry)) throw invalidField(at, 'Not a list ID.');
  };
  let listIds: string[];
  if (op === 'eq' || op === 'neq') {
    if (typeof value !== 'string') throw invalidField(`${path}.value`, 'Expected a list ID.');
    check(value, `${path}.value`);
    listIds = [value];
  } else {
    listIds = stringList(value, path, check);
  }

  const rows = await scope.db
    .select({ id: lists.id, kind: lists.kind, filter: lists.filter })
    .from(lists)
    .where(and(inArray(lists.id, listIds), eq(lists.workspace_id, scope.workspaceId)));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const parts: SQL[] = [];
  for (const [index, listId] of listIds.entries()) {
    const list = byId.get(listId);
    const at = listIds.length === 1 && (op === 'eq' || op === 'neq') ? `${path}.value` : `${path}.value[${index}]`;
    if (!list) throw invalidField(at, 'No such list in this workspace.');
    if (list.kind === 'static') {
      parts.push(sql`exists (select 1 from list_members lm where lm.list_id = ${list.id} and lm.contact_id = contacts.id)`);
      continue;
    }
    if (scope.expanding.includes(list.id)) throw invalidField(at, 'A segment cannot include itself.');
    if (scope.expanding.length >= MAX_LIST_NESTING) throw invalidField(at, `Segments can refer to other segments at most ${MAX_LIST_NESTING} deep.`);
    scope.expanding.push(list.id);
    // The nested filter shares this filter's condition budget.
    parts.push(sql`coalesce(${await compileNode(list.filter, at, 1, scope)}, false)`);
    scope.expanding.pop();
  }
  const any = sql`(${sql.join(parts, sql.raw(' or '))})`;
  return op === 'eq' || op === 'in' ? any : sql`(not ${any})`;
}
