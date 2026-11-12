// The knowledge base (spec §10, §15.17): workspace-wide or campaign facts, shareable with prospects
// or internal. Deleting is soft, so escalations that taught an item keep their link.

import { campaigns, knowledge_items, newId, type Db } from '@catalyst/db';
import { and, asc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';

import type { Principal } from '../api/auth.ts';
import { invalidField, notFound } from '../api/errors.ts';
import { assertFresh } from '../api/etag.ts';
import { decodeCursor, page } from '../api/pagination.ts';
import { audit, escapeLike } from '../shared.ts';

type ItemRow = typeof knowledge_items.$inferSelect;
type Kind = 'product' | 'pricing' | 'faq' | 'objection' | 'policy' | 'case_study' | 'link' | 'other';

export function serializeKnowledgeItem(row: ItemRow) {
  return {
    id: row.id,
    campaign_id: row.campaign_id,
    kind: row.kind as Kind,
    title: row.title,
    content: row.content,
    visibility: row.visibility as 'shareable' | 'internal',
    tags: row.tags,
    source: row.source as 'manual' | 'escalation' | 'import' | 'api',
    source_escalation_id: row.source_escalation_id,
    active: row.active,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

async function findItem(db: Db, workspaceId: string, itemId: string): Promise<ItemRow> {
  const [row] = await db.select().from(knowledge_items).where(and(eq(knowledge_items.id, itemId), eq(knowledge_items.workspace_id, workspaceId), isNull(knowledge_items.deleted_at)));
  if (!row) throw notFound('The knowledge item');
  return row;
}

async function checkCampaign(db: Db, workspaceId: string, campaignId: string | null | undefined): Promise<void> {
  if (!campaignId) return;
  const [campaign] = await db.select({ id: campaigns.id }).from(campaigns).where(and(eq(campaigns.id, campaignId), eq(campaigns.workspace_id, workspaceId)));
  if (!campaign) throw invalidField('body.campaign_id', 'No such campaign in this workspace.');
}

const SORT = 'kind_title';

export async function listKnowledgeItems(
  db: Db,
  workspaceId: string,
  query: { limit: number; cursor?: string | undefined; scope?: string | undefined; kind?: Kind | undefined; source?: string | undefined; active?: 'true' | 'false' | undefined; q?: string | undefined },
) {
  const where: SQL[] = [eq(knowledge_items.workspace_id, workspaceId), isNull(knowledge_items.deleted_at)];
  if (query.scope === 'workspace') where.push(isNull(knowledge_items.campaign_id));
  else if (query.scope) where.push(eq(knowledge_items.campaign_id, query.scope));
  if (query.kind) where.push(eq(knowledge_items.kind, query.kind));
  if (query.source) where.push(eq(knowledge_items.source, query.source));
  if (query.active) where.push(eq(knowledge_items.active, query.active === 'true'));
  if (query.q) {
    const pattern = `%${escapeLike(query.q)}%`;
    where.push(or(ilike(knowledge_items.title, pattern), ilike(knowledge_items.content, pattern))!);
  }
  if (query.cursor) where.push(sql`(${knowledge_items.kind}, ${knowledge_items.title}, ${knowledge_items.id}) > (select kind, title, id from knowledge_items where id = ${decodeCursor(query.cursor, SORT)})`);
  const rows = await db.select().from(knowledge_items).where(and(...where)).orderBy(asc(knowledge_items.kind), asc(knowledge_items.title), asc(knowledge_items.id)).limit(query.limit + 1);
  const { rows: kept, next_cursor } = page(rows, query.limit, SORT);
  return { data: kept.map(serializeKnowledgeItem), next_cursor };
}

export async function getKnowledgeItem(db: Db, workspaceId: string, itemId: string) {
  return serializeKnowledgeItem(await findItem(db, workspaceId, itemId));
}

export interface KnowledgeInput {
  kind: Kind;
  title: string;
  content: string;
  campaign_id?: string | null | undefined;
  visibility: 'shareable' | 'internal';
  tags: string[];
  active: boolean;
}

export async function createKnowledgeItem(db: Db, principal: Principal, input: KnowledgeInput, now: Date) {
  await checkCampaign(db, principal.workspace.id, input.campaign_id);
  const id = newId('knowledge_item');
  const row = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(knowledge_items)
      .values({
        id,
        workspace_id: principal.workspace.id,
        campaign_id: input.campaign_id ?? null,
        kind: input.kind,
        title: input.title,
        content: input.content,
        visibility: input.visibility,
        tags: [...new Set(input.tags)],
        active: input.active,
        source: principal.kind === 'user' ? 'manual' : 'api',
        created_by: principal.kind === 'user' ? principal.id : null,
        created_at: now,
        updated_at: now,
      })
      .returning();
    await audit(tx, principal, 'knowledge.created', { type: 'knowledge_item', id }, { kind: input.kind, title: input.title }, now);
    return created!;
  });
  return serializeKnowledgeItem(row);
}

export async function updateKnowledgeItem(db: Db, principal: Principal, itemId: string, input: Partial<KnowledgeInput>, ifMatch: string | null, now: Date) {
  const current = await findItem(db, principal.workspace.id, itemId);
  assertFresh({ id: current.id, updated_at: current.updated_at.toISOString() }, ifMatch);
  if (input.campaign_id !== undefined) await checkCampaign(db, principal.workspace.id, input.campaign_id);
  const patch: Partial<typeof knowledge_items.$inferInsert> = {};
  for (const key of ['kind', 'title', 'content', 'campaign_id', 'visibility', 'active'] as const) if (input[key] !== undefined) Object.assign(patch, { [key]: input[key] });
  if (input.tags !== undefined) patch.tags = [...new Set(input.tags)];
  const row = await db.transaction(async (tx) => {
    const [updated] = await tx.update(knowledge_items).set({ ...patch, updated_at: now }).where(eq(knowledge_items.id, itemId)).returning();
    await audit(tx, principal, 'knowledge.updated', { type: 'knowledge_item', id: itemId }, { fields: Object.keys(patch) }, now);
    return updated!;
  });
  return serializeKnowledgeItem(row);
}

export async function deleteKnowledgeItem(db: Db, principal: Principal, itemId: string, now: Date): Promise<void> {
  const current = await findItem(db, principal.workspace.id, itemId);
  await db.transaction(async (tx) => {
    await tx.update(knowledge_items).set({ deleted_at: now, active: false, updated_at: now }).where(eq(knowledge_items.id, itemId));
    await audit(tx, principal, 'knowledge.deleted', { type: 'knowledge_item', id: itemId }, { title: current.title }, now);
  });
}
