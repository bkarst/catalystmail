// A signed-in person's browsers for push (spec §11.2). Only sessions reach these: a subscription is
// one person's browser.

import { newId, push_subscriptions, type Db } from '@catalyst/db';
import { and, asc, eq } from 'drizzle-orm';

import type { Principal } from '../api/auth.ts';
import { ApiError, conflict, notFound } from '../api/errors.ts';
import type { VapidKeys } from './web-push.ts';

type Row = typeof push_subscriptions.$inferSelect;

const serialize = (row: Row) => ({
  id: row.id,
  endpoint_host: new URL(row.endpoint).host,
  user_agent: row.user_agent,
  created_at: row.created_at.toISOString(),
  last_sent_at: row.last_sent_at?.toISOString() ?? null,
});

function person(principal: Principal): string {
  if (principal.kind !== 'user') throw new ApiError(403, 'forbidden_scope', 'Push is for a signed-in person’s browser.');
  return principal.id;
}

export async function getPushSettings(db: Db, principal: Principal, vapid: VapidKeys | null | undefined) {
  const rows = await db.select().from(push_subscriptions).where(eq(push_subscriptions.user_id, person(principal))).orderBy(asc(push_subscriptions.created_at));
  return { vapid_public_key: vapid?.publicKey ?? null, subscriptions: rows.map(serialize) };
}

export async function createPushSubscription(db: Db, principal: Principal, input: { endpoint: string; keys: { p256dh: string; auth: string } }, userAgent: string | null, vapid: VapidKeys | null | undefined, now: Date) {
  const userId = person(principal);
  if (!vapid) throw conflict('Browser push isn’t set up on this server (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT).');
  const p256dh = Buffer.from(input.keys.p256dh, 'base64url');
  if (p256dh.length !== 65 || p256dh[0] !== 4) throw new ApiError(400, 'validation_failed', undefined, [{ path: 'body.keys.p256dh', message: 'Not an uncompressed P-256 public key.' }]);
  if (Buffer.from(input.keys.auth, 'base64url').length !== 16) throw new ApiError(400, 'validation_failed', undefined, [{ path: 'body.keys.auth', message: 'Not a 16-byte secret.' }]);
  // The same browser subscribing again (or for someone else) replaces what was there.
  const [row] = await db
    .insert(push_subscriptions)
    .values({ id: newId('push_subscription'), workspace_id: principal.workspace.id, user_id: userId, endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth, user_agent: userAgent?.slice(0, 300) ?? null, created_at: now })
    .onConflictDoUpdate({ target: push_subscriptions.endpoint, set: { workspace_id: principal.workspace.id, user_id: userId, p256dh: input.keys.p256dh, auth: input.keys.auth, user_agent: userAgent?.slice(0, 300) ?? null, created_at: now, last_sent_at: null } })
    .returning();
  return serialize(row!);
}

export async function deletePushSubscription(db: Db, principal: Principal, subscriptionId: string): Promise<void> {
  const removed = await db.delete(push_subscriptions).where(and(eq(push_subscriptions.id, subscriptionId), eq(push_subscriptions.user_id, person(principal)))).returning({ id: push_subscriptions.id });
  if (removed.length === 0) throw notFound('The push subscription');
}
