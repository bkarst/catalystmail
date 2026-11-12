// Companies (spec §12.1). Contacts link to a company by email domain, never through a free-mail
// domain.

import type { Company } from '@catalyst/contract';
import { activities, companies, contacts, newId, type Db, type Executor } from '@catalyst/db';
import { isFreemailDomain } from '@catalyst/email';
import { and, asc, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';

import type { Principal } from '../api/auth.ts';
import { conflict, notFound, PG_UNIQUE_VIOLATION, pgErrorCode } from '../api/errors.ts';
import { assertFresh } from '../api/etag.ts';
import { decodeCursor, page } from '../api/pagination.ts';
import { applyCustomFields } from '../custom-fields/service.ts';
import { actorOf, escapeLike } from '../shared.ts';

type CompanyRow = typeof companies.$inferSelect;

export interface CompanyInput {
  name?: string | undefined;
  domain?: string | null | undefined;
  website?: string | null | undefined;
  industry?: string | null | undefined;
  employee_range?: string | null | undefined;
  country?: string | null | undefined;
  notes?: string | null | undefined;
  custom_fields?: Record<string, unknown> | undefined;
}

const COLUMNS = ['name', 'website', 'industry', 'employee_range', 'notes'] as const;

// Written out in full: drizzle leaves columns unqualified in a single-table select, and a bare
// "id" inside the subquery would mean the contact's own id.
const contactCount = sql<number>`(select count(*)::int from contacts c where c.company_id = companies.id and c.deleted_at is null)`;

export function serializeCompany(row: CompanyRow, count: number): Company {
  return {
    id: row.id,
    name: row.name,
    domain: row.domain,
    website: row.website,
    industry: row.industry,
    employee_range: row.employee_range,
    country: row.country,
    notes: row.notes,
    custom_fields: row.custom_fields as Record<string, unknown>,
    contact_count: count,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

const SORTS = {
  name: { order: [asc(companies.name), asc(companies.id)], cursor: (alias: string) => sql.raw(`(${alias}.name, ${alias}.id)`), comparison: '>' },
  '-created_at': { order: [desc(companies.created_at), desc(companies.id)], cursor: (alias: string) => sql.raw(`(${alias}.created_at, ${alias}.id)`), comparison: '<' },
} as const;

export async function listCompanies(db: Db, workspaceId: string, query: { limit: number; cursor?: string | undefined; q?: string | undefined; sort?: keyof typeof SORTS | undefined }) {
  const sortName = query.sort ?? 'name';
  const sort = SORTS[sortName];
  const where: SQL[] = [eq(companies.workspace_id, workspaceId), isNull(companies.deleted_at)];
  if (query.q?.trim()) {
    const like = `%${escapeLike(query.q.trim())}%`;
    where.push(sql`(${companies.name} ilike ${like} or ${companies.domain} ilike ${like})`);
  }
  if (query.cursor) {
    const cursorId = decodeCursor(query.cursor, sortName);
    where.push(sql`${sort.cursor('companies')} ${sql.raw(sort.comparison)} (select ${sort.cursor('c')} from companies c where c.id = ${cursorId} and c.workspace_id = ${workspaceId})`);
  }
  const rows = await db
    .select({ row: companies, count: contactCount })
    .from(companies)
    .where(and(...where))
    .orderBy(...sort.order)
    .limit(query.limit + 1);
  const { rows: kept, next_cursor } = page(rows.map((entry) => ({ ...entry, id: entry.row.id })), query.limit, sortName);
  return { data: kept.map((entry) => serializeCompany(entry.row, entry.count)), next_cursor };
}

async function findCompany(db: Executor, workspaceId: string, companyId: string): Promise<{ row: CompanyRow; count: number }> {
  const [found] = await db
    .select({ row: companies, count: contactCount })
    .from(companies)
    .where(and(eq(companies.id, companyId), eq(companies.workspace_id, workspaceId), isNull(companies.deleted_at)));
  if (!found) throw notFound('The company');
  return found;
}

export async function getCompany(db: Db, workspaceId: string, companyId: string): Promise<Company> {
  const { row, count } = await findCompany(db, workspaceId, companyId);
  return serializeCompany(row, count);
}

/** Links contacts at `domain` that have no company yet. Free-mail domains never link. */
async function linkContactsByDomain(db: Executor, workspaceId: string, companyId: string, domain: string | null, now: Date): Promise<void> {
  if (!domain || isFreemailDomain(domain)) return;
  await db
    .update(contacts)
    .set({ company_id: companyId, updated_at: now })
    .where(
      and(
        eq(contacts.workspace_id, workspaceId),
        isNull(contacts.company_id),
        isNull(contacts.deleted_at),
        sql`split_part(${contacts.email}::text, '@', 2) = lower(${domain})`,
      ),
    );
}

const domainConflict = (domain: string) => conflict(`Another company already has the domain ${domain}.`, [{ path: 'body.domain', message: 'Already used by another company.' }]);

export async function createCompany(db: Db, principal: Principal, input: CompanyInput & { name: string }, now: Date): Promise<Company> {
  const workspaceId = principal.workspace.id;
  const domain = input.domain?.toLowerCase() ?? null;
  try {
    return await db.transaction(async (tx) => {
      const values: typeof companies.$inferInsert = { id: newId('company'), workspace_id: workspaceId, name: input.name, domain, created_at: now, updated_at: now };
      for (const column of COLUMNS) {
        if (input[column] !== undefined) Object.assign(values, { [column]: input[column] });
      }
      if (input.country !== undefined) values.country = input.country?.toUpperCase() ?? null;
      values.custom_fields = await applyCustomFields(tx, workspaceId, 'company', null, input.custom_fields);
      const [row] = await tx.insert(companies).values(values).returning();
      await linkContactsByDomain(tx, workspaceId, row!.id, domain, now);
      return serializeCompany(row!, (await findCompany(tx, workspaceId, row!.id)).count);
    });
  } catch (error) {
    if (pgErrorCode(error) === PG_UNIQUE_VIOLATION && domain) throw domainConflict(domain);
    throw error;
  }
}

export async function updateCompany(db: Db, principal: Principal, companyId: string, input: CompanyInput, ifMatch: string | null, now: Date): Promise<Company> {
  const workspaceId = principal.workspace.id;
  const domain = input.domain === undefined ? undefined : (input.domain?.toLowerCase() ?? null);
  try {
    return await db.transaction(async (tx) => {
      const { row: current, count } = await findCompany(tx, workspaceId, companyId);
      assertFresh(serializeCompany(current, count), ifMatch);
      const patch: Partial<typeof companies.$inferInsert> = {};
      for (const column of COLUMNS) {
        if (input[column] !== undefined) Object.assign(patch, { [column]: input[column] });
      }
      if (domain !== undefined) patch.domain = domain;
      if (input.country !== undefined) patch.country = input.country?.toUpperCase() ?? null;
      if (input.custom_fields !== undefined) {
        patch.custom_fields = await applyCustomFields(tx, workspaceId, 'company', current.custom_fields as Record<string, unknown>, input.custom_fields);
      }
      const changed = Object.keys(patch).filter((key) => JSON.stringify(patch[key as keyof typeof patch]) !== JSON.stringify(current[key as keyof CompanyRow]));
      if (changed.length === 0) return serializeCompany(current, count);
      await tx.update(companies).set({ ...patch, updated_at: now }).where(eq(companies.id, companyId));
      if (domain !== undefined && domain !== current.domain) await linkContactsByDomain(tx, workspaceId, companyId, domain, now);
      const { row, count: newCount } = await findCompany(tx, workspaceId, companyId);
      return serializeCompany(row, newCount);
    });
  } catch (error) {
    if (pgErrorCode(error) === PG_UNIQUE_VIOLATION && domain) throw domainConflict(domain);
    throw error;
  }
}

/** Soft delete. Contacts are unlinked, not deleted. */
export async function deleteCompany(db: Db, principal: Principal, companyId: string, now: Date): Promise<void> {
  const workspaceId = principal.workspace.id;
  await db.transaction(async (tx) => {
    const { row } = await findCompany(tx, workspaceId, companyId);
    const unlinked = await tx
      .update(contacts)
      .set({ company_id: null, updated_at: now })
      .where(and(eq(contacts.company_id, companyId), eq(contacts.workspace_id, workspaceId)))
      .returning({ id: contacts.id });
    await tx.update(companies).set({ deleted_at: now, updated_at: now }).where(eq(companies.id, companyId));
    if (unlinked.length > 0) {
      await tx.insert(activities).values(
        unlinked.map((contact) => ({
          id: newId('activity'),
          workspace_id: workspaceId,
          contact_id: contact.id,
          type: 'contact.updated',
          ...actorOf(principal),
          data: { fields: ['company_id'], reason: `Company ${row.name} was deleted` },
          occurred_at: now,
        })),
      );
    }
  });
}
