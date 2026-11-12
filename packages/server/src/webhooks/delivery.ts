// Getting events to webhook endpoints (spec §13.6): `webhook.dispatch` turns new activities into
// one delivery per subscribed endpoint, and `webhook.deliver` POSTs each with a fresh signature,
// retrying at 1 m, 5 m, 30 m, 2 h, 6 h, 12 h and 24 h. An endpoint failing for 3 days is turned off.

import { activities, newId, webhook_deliveries, webhook_endpoints, type Db } from '@catalyst/db';
import type { JobQueue } from '@catalyst/jobs';
import { and, eq, gt, inArray, isNotNull, lte, max, min, notExists, sql } from 'drizzle-orm';

import type { SecretBox } from '../secrets.ts';
import { activityTypesFor, envelopeFor, eventIdFor } from './events.ts';
import { signWebhook, unsafeUrlReason, type WebhookNet } from './net.ts';

export interface WebhookDeps {
  net: WebhookNet;
  secrets: SecretBox;
  jobs: JobQueue;
  now: () => Date;
}

/** Seconds before each retry; the first attempt plus these is 8 attempts over about 45 hours. */
export const RETRY_SECONDS = [60, 300, 1800, 7200, 21_600, 43_200, 86_400];
const DISABLE_AFTER_MS = 3 * 86_400_000;
/** Activities are dispatched once their transaction has surely committed. */
const SETTLE_MS = 15_000;
/** Older activities are not looked at again. */
const LOOKBACK_MS = 86_400_000;
const TIMEOUT_MS = 10_000;

export async function dispatchWebhooks(db: Db, deps: Pick<WebhookDeps, 'jobs' | 'now'>): Promise<{ queued: number }> {
  const now = deps.now();
  let queued = 0;
  for (const endpoint of await db.select().from(webhook_endpoints).where(eq(webhook_endpoints.active, true))) {
    const types = activityTypesFor(endpoint.events);
    if (types.length === 0) continue;
    const since = new Date(Math.max(endpoint.created_at.getTime(), now.getTime() - LOOKBACK_MS));
    const pending = await db
      .select()
      .from(activities)
      .where(
        and(
          eq(activities.workspace_id, endpoint.workspace_id),
          inArray(activities.type, types),
          gt(activities.created_at, since),
          lte(activities.created_at, new Date(now.getTime() - SETTLE_MS)),
          // `activities.id` is written out: Drizzle leaves columns unqualified in a one-table select.
          notExists(sql`(select 1 from webhook_deliveries d where d.endpoint_id = ${endpoint.id} and d.event_id = 'evt_' || substr(activities.id, 5))`),
        ),
      )
      .orderBy(activities.created_at)
      .limit(500);
    for (const activity of pending) {
      const id = newId('webhook_delivery');
      const [inserted] = await db
        .insert(webhook_deliveries)
        .values({ id, endpoint_id: endpoint.id, event_id: eventIdFor(activity.id), event_type: envelopeFor(activity).type, payload: envelopeFor(activity), status: 'pending', next_attempt_at: now })
        .onConflictDoNothing({ target: [webhook_deliveries.endpoint_id, webhook_deliveries.event_id] })
        .returning({ id: webhook_deliveries.id });
      if (!inserted) continue;
      await deps.jobs.enqueue('webhook.deliver', { delivery_id: id });
      queued += 1;
    }
  }
  return { queued };
}

/** One attempt. A failure schedules the next, or ends the delivery after the last. */
export async function deliverWebhook(db: Db, deliveryId: string, deps: WebhookDeps, options: { retry?: boolean } = {}) {
  const now = deps.now();
  const [delivery] = await db.select().from(webhook_deliveries).where(eq(webhook_deliveries.id, deliveryId));
  if (!delivery || delivery.status === 'delivered' || delivery.status === 'failed') return delivery ?? null;
  const [endpoint] = await db.select().from(webhook_endpoints).where(eq(webhook_endpoints.id, delivery.endpoint_id));
  if (!endpoint?.active) {
    const [skipped] = await db.update(webhook_deliveries).set({ status: 'skipped', next_attempt_at: null }).where(eq(webhook_deliveries.id, deliveryId)).returning();
    return skipped!;
  }

  const body = JSON.stringify(delivery.payload);
  const headers = {
    'content-type': 'application/json',
    'user-agent': 'Catalyst-Webhooks/1',
    'catalyst-event': delivery.event_type,
    'catalyst-delivery': delivery.id,
    'catalyst-signature': signWebhook(deps.secrets.open(endpoint.secret_enc), body, now),
  };
  let outcome: { status: number | null; snippet: string };
  // The address is checked again at each delivery, against DNS rebinding (§13.6).
  const unsafe = await unsafeUrlReason(endpoint.url, deps.net);
  if (unsafe) outcome = { status: null, snippet: unsafe };
  else {
    try {
      const response = await deps.net.post(endpoint.url, { headers, body, timeoutMs: TIMEOUT_MS });
      outcome = { status: response.status, snippet: response.body.slice(0, 500) };
    } catch (error) {
      outcome = { status: null, snippet: (error instanceof Error ? error.message : String(error)).slice(0, 500) };
    }
  }
  const attempt = delivery.attempt + 1;
  const delivered = outcome.status !== null && outcome.status >= 200 && outcome.status < 300;
  const retryIn = options.retry === false ? undefined : RETRY_SECONDS[attempt - 1];
  const next = delivered || retryIn === undefined ? null : new Date(now.getTime() + retryIn * 1000);
  const [updated] = await db
    .update(webhook_deliveries)
    .set({ attempt, response_status: outcome.status, response_snippet: outcome.snippet, status: delivered ? 'delivered' : next ? 'pending' : 'failed', delivered_at: delivered ? now : null, next_attempt_at: next })
    .where(eq(webhook_deliveries.id, deliveryId))
    .returning();

  if (delivered) {
    await db.update(webhook_endpoints).set({ consecutive_failures: 0 }).where(eq(webhook_endpoints.id, endpoint.id));
    return updated!;
  }
  await db.update(webhook_endpoints).set({ consecutive_failures: sql`${webhook_endpoints.consecutive_failures} + 1` }).where(eq(webhook_endpoints.id, endpoint.id));
  if (next) await deps.jobs.enqueue('webhook.deliver', { delivery_id: deliveryId }, { startAfter: next });
  await disableIfFailingFor3Days(db, endpoint, now);
  return updated!;
}

/** Turned off once every delivery since its last success, for 3 days, has failed (§13.6). */
async function disableIfFailingFor3Days(db: Db, endpoint: typeof webhook_endpoints.$inferSelect, now: Date): Promise<void> {
  const [success] = await db.select({ at: max(webhook_deliveries.delivered_at) }).from(webhook_deliveries).where(and(eq(webhook_deliveries.endpoint_id, endpoint.id), isNotNull(webhook_deliveries.delivered_at)));
  const [failing] = await db
    .select({ since: min(webhook_deliveries.created_at) })
    .from(webhook_deliveries)
    .where(and(eq(webhook_deliveries.endpoint_id, endpoint.id), sql`${webhook_deliveries.attempt} > 0`, sql`${webhook_deliveries.status} <> 'delivered'`, success?.at ? gt(webhook_deliveries.created_at, success.at) : sql`true`));
  if (!failing?.since || now.getTime() - failing.since.getTime() < DISABLE_AFTER_MS) return;
  const [disabled] = await db.update(webhook_endpoints).set({ active: false, disabled_at: now }).where(and(eq(webhook_endpoints.id, endpoint.id), eq(webhook_endpoints.active, true))).returning({ id: webhook_endpoints.id });
  if (disabled) {
    await db.insert(activities).values({ id: newId('activity'), workspace_id: endpoint.workspace_id, type: 'webhook.disabled', actor_type: 'system', data: { endpoint_id: endpoint.id, url: endpoint.url, failing_since: failing.since.toISOString() }, occurred_at: now });
  }
}
