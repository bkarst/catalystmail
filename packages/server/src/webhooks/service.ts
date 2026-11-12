// Webhook endpoints (spec §13.4, §13.6): register, change, remove, test, and the delivery log.

import { randomBytes } from 'node:crypto';

import type { WebhookDelivery, WebhookEndpoint, WebhookEventType } from '@catalyst/contract';
import { newId, webhook_deliveries, webhook_endpoints, type Db } from '@catalyst/db';
import { and, asc, desc, eq, sql } from 'drizzle-orm';

import type { Principal } from '../api/auth.ts';
import { conflict, invalidField, notFound } from '../api/errors.ts';
import { decodeCursor, page } from '../api/pagination.ts';
import { audit, iso } from '../shared.ts';
import { deliverWebhook, type WebhookDeps } from './delivery.ts';
import { unsafeUrlReason } from './net.ts';

type EndpointRow = typeof webhook_endpoints.$inferSelect;
type DeliveryRow = typeof webhook_deliveries.$inferSelect;

export function serializeEndpoint(row: EndpointRow): WebhookEndpoint {
  return {
    id: row.id,
    url: row.url,
    description: row.description,
    events: row.events as WebhookEventType[],
    active: row.active,
    consecutive_failures: row.consecutive_failures,
    disabled_at: iso(row.disabled_at),
    created_at: row.created_at.toISOString(),
  };
}

export function serializeDelivery(row: DeliveryRow): WebhookDelivery {
  return {
    id: row.id,
    endpoint_id: row.endpoint_id,
    event_id: row.event_id,
    event_type: row.event_type,
    attempt: row.attempt,
    status: row.status as WebhookDelivery['status'],
    response_status: row.response_status,
    response_snippet: row.response_snippet,
    next_attempt_at: iso(row.next_attempt_at),
    delivered_at: iso(row.delivered_at),
    created_at: row.created_at.toISOString(),
  };
}

async function findEndpoint(db: Db, workspaceId: string, endpointId: string): Promise<EndpointRow> {
  const [row] = await db.select().from(webhook_endpoints).where(and(eq(webhook_endpoints.id, endpointId), eq(webhook_endpoints.workspace_id, workspaceId)));
  if (!row) throw notFound('The webhook endpoint');
  return row;
}

async function assertSafe(url: string, deps: Pick<WebhookDeps, 'net'>): Promise<void> {
  const reason = await unsafeUrlReason(url, deps.net);
  if (reason) throw invalidField('body.url', reason);
}

export async function listWebhookEndpoints(db: Db, workspaceId: string, query: { limit: number; cursor?: string | undefined }) {
  const where = [eq(webhook_endpoints.workspace_id, workspaceId)];
  if (query.cursor) where.push(sql`(${webhook_endpoints.created_at}, ${webhook_endpoints.id}) > (select created_at, id from webhook_endpoints where id = ${decodeCursor(query.cursor, 'created_at')})`);
  const rows = await db.select().from(webhook_endpoints).where(and(...where)).orderBy(asc(webhook_endpoints.created_at), asc(webhook_endpoints.id)).limit(query.limit + 1);
  const { rows: kept, next_cursor } = page(rows, query.limit, 'created_at');
  return { data: kept.map(serializeEndpoint), next_cursor };
}

export async function createWebhookEndpoint(db: Db, principal: Principal, input: { url: string; description?: string | undefined; events: WebhookEventType[] }, deps: Pick<WebhookDeps, 'net' | 'secrets'>, now: Date) {
  await assertSafe(input.url, deps);
  const secret = `whsec_${randomBytes(24).toString('base64url')}`;
  const id = newId('webhook_endpoint');
  const row = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(webhook_endpoints)
      .values({ id, workspace_id: principal.workspace.id, url: input.url, description: input.description ?? null, events: [...new Set(input.events)], secret_enc: deps.secrets.seal(secret), created_at: now })
      .returning();
    await audit(tx, principal, 'webhook.created', { type: 'webhook_endpoint', id }, { url: input.url, events: input.events }, now);
    return created!;
  });
  return { ...serializeEndpoint(row), secret };
}

export async function updateWebhookEndpoint(
  db: Db,
  principal: Principal,
  endpointId: string,
  input: { url?: string | undefined; description?: string | null | undefined; events?: WebhookEventType[] | undefined; active?: boolean | undefined },
  deps: Pick<WebhookDeps, 'net'>,
  now: Date,
) {
  const current = await findEndpoint(db, principal.workspace.id, endpointId);
  if (input.url !== undefined && input.url !== current.url) await assertSafe(input.url, deps);
  const patch: Partial<typeof webhook_endpoints.$inferInsert> = {};
  if (input.url !== undefined) patch.url = input.url;
  if (input.description !== undefined) patch.description = input.description;
  if (input.events !== undefined) patch.events = [...new Set(input.events)];
  if (input.active !== undefined) {
    patch.active = input.active;
    // Back on: a clean slate.
    if (input.active && !current.active) Object.assign(patch, { consecutive_failures: 0, disabled_at: null });
  }
  const row = await db.transaction(async (tx) => {
    const [updated] = await tx.update(webhook_endpoints).set(patch).where(eq(webhook_endpoints.id, endpointId)).returning();
    await audit(tx, principal, 'webhook.updated', { type: 'webhook_endpoint', id: endpointId }, { fields: Object.keys(patch) }, now);
    return updated!;
  });
  return serializeEndpoint(row);
}

export async function deleteWebhookEndpoint(db: Db, principal: Principal, endpointId: string, now: Date): Promise<void> {
  const current = await findEndpoint(db, principal.workspace.id, endpointId);
  await db.transaction(async (tx) => {
    await tx.delete(webhook_endpoints).where(eq(webhook_endpoints.id, endpointId));
    await audit(tx, principal, 'webhook.deleted', { type: 'webhook_endpoint', id: endpointId }, { url: current.url }, now);
  });
}

/** A signed `webhook.test` event, sent now and not retried. */
export async function testWebhookEndpoint(db: Db, principal: Principal, endpointId: string, deps: WebhookDeps) {
  const endpoint = await findEndpoint(db, principal.workspace.id, endpointId);
  if (!endpoint.active) throw conflict('The endpoint is off; turn it on to test it.');
  const now = deps.now();
  const id = newId('webhook_delivery');
  const eventId = newId('event');
  await db.insert(webhook_deliveries).values({
    id,
    endpoint_id: endpoint.id,
    event_id: eventId,
    event_type: 'webhook.test',
    payload: { id: eventId, type: 'webhook.test', created_at: now.toISOString(), workspace_id: principal.workspace.id, data: { endpoint_id: endpoint.id, message: 'A test event from Catalyst.' } },
    status: 'pending',
    next_attempt_at: now,
  });
  return serializeDelivery((await deliverWebhook(db, id, deps, { retry: false }))!);
}

export async function listWebhookDeliveries(db: Db, workspaceId: string, endpointId: string, query: { limit: number; cursor?: string | undefined; status?: WebhookDelivery['status'] | undefined }) {
  await findEndpoint(db, workspaceId, endpointId);
  const where = [eq(webhook_deliveries.endpoint_id, endpointId)];
  if (query.status) where.push(eq(webhook_deliveries.status, query.status));
  if (query.cursor) where.push(sql`(${webhook_deliveries.created_at}, ${webhook_deliveries.id}) < (select created_at, id from webhook_deliveries where id = ${decodeCursor(query.cursor, '-created_at')})`);
  const rows = await db.select().from(webhook_deliveries).where(and(...where)).orderBy(desc(webhook_deliveries.created_at), desc(webhook_deliveries.id)).limit(query.limit + 1);
  const { rows: kept, next_cursor } = page(rows, query.limit, '-created_at');
  return { data: kept.map(serializeDelivery), next_cursor };
}

export async function redeliverWebhook(db: Db, principal: Principal, deliveryId: string, deps: Pick<WebhookDeps, 'jobs' | 'now'>) {
  const [row] = await db
    .select({ delivery: webhook_deliveries, endpoint: webhook_endpoints })
    .from(webhook_deliveries)
    .innerJoin(webhook_endpoints, eq(webhook_endpoints.id, webhook_deliveries.endpoint_id))
    .where(and(eq(webhook_deliveries.id, deliveryId), eq(webhook_endpoints.workspace_id, principal.workspace.id)));
  if (!row) throw notFound('The delivery');
  if (!row.endpoint.active) throw conflict('The endpoint is off; turn it on before redelivering.');
  const now = deps.now();
  // A fresh run of attempts, signed anew when it goes.
  const [updated] = await db.update(webhook_deliveries).set({ status: 'pending', attempt: 0, next_attempt_at: now }).where(eq(webhook_deliveries.id, deliveryId)).returning();
  await deps.jobs.enqueue('webhook.deliver', { delivery_id: deliveryId });
  return serializeDelivery(updated!);
}
