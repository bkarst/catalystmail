import assert from 'node:assert/strict';
import { createDecipheriv, createECDH, hkdfSync, randomBytes } from 'node:crypto';

import { activities, newId, notifications, push_subscriptions, users, type Db } from '@catalyst/db';
import { createTestDatabase } from '@catalyst/db/testing';
import { MemoryQueue } from '@catalyst/jobs';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { call, seedApiKey, seedWorkspace } from '../api/testing.ts';
import { runCli } from '../cli/bootstrap.ts';
import { authHandler, setDb, setDeps } from '../runtime.ts';
import { createSecretBox, parseEncryptionKeys } from '../secrets.ts';
import type { WebhookNet } from '../webhooks/net.ts';
import { dispatchNotifications } from './dispatch.ts';
import { generateVapidKeys } from './web-push.ts';

// Needs a PostgreSQL server: set TEST_DATABASE_URL to any database on it.
const adminUrl = process.env.TEST_DATABASE_URL;
const APP = 'http://localhost:3000';

/** A browser: its subscription, and how it opens what the push service hands it (RFC 8291). */
function browser(endpoint: string) {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return {
    json: { endpoint, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } },
    open(body: Buffer): unknown {
      const salt = body.subarray(0, 16);
      const senderPublic = body.subarray(21, 21 + body.readUInt8(20));
      const sealed = body.subarray(21 + senderPublic.length);
      const ikm = Buffer.from(hkdfSync('sha256', ecdh.computeSecret(senderPublic), auth, Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), senderPublic]), 32));
      const decipher = createDecipheriv('aes-128-gcm', Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16)), Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12)));
      decipher.setAuthTag(sealed.subarray(sealed.length - 16));
      const plain = Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - 16)), decipher.final()]);
      return JSON.parse(plain.subarray(0, plain.length - 1).toString());
    },
  };
}

describe.skipIf(!adminUrl)('browser push for urgent and high alerts (§11.2)', () => {
  let db: Db;
  let drop: () => Promise<void>;
  let workspaceId: string;
  const vapid = { ...generateVapidKeys(), subject: 'mailto:ops@getacme.com' };
  const posted: { url: string; headers: Record<string, string>; body: Buffer }[] = [];
  let answer = 201;
  const net: WebhookNet = { resolve: async () => ['93.184.216.34'], post: async (url, init) => (posted.push({ url, headers: init.headers, body: Buffer.from(init.body) }), { status: answer, body: '' }) };
  const secrets = createSecretBox(parseEncryptionKeys(`1:${randomBytes(32).toString('base64')}`));

  beforeAll(async () => {
    ({ db, drop } = await createTestDatabase(adminUrl!));
    setDb(db);
    setDeps({ jobs: new MemoryQueue(), config: { trackingTarget: null, appHost: null, vapid, auth: { secret: 'a-test-secret-that-is-long-enough-to-sign-cookies', baseURL: APP, trustedOrigins: [APP], secureCookies: false } } });
    workspaceId = await seedWorkspace(db, 'Acme');
  });
  afterAll(async () => {
    setDb(undefined);
    setDeps(undefined);
    await drop?.();
  });

  it('pushes an urgent alert, encrypted, to each browser its people allowed, and forgets one that unsubscribed', async () => {
    const ownerId = newId('user');
    await db.insert(users).values({ id: ownerId, workspace_id: workspaceId, email: 'mia@getacme.com', name: 'Mia', role: 'owner', notification_prefs: { email: false } });
    const laptop = browser('https://push.example.net/send/laptop');
    const phone = browser('https://push.example.net/send/phone');
    for (const [index, device] of [laptop, phone].entries()) {
      await db.insert(push_subscriptions).values({ id: newId('push_subscription'), workspace_id: workspaceId, user_id: ownerId, endpoint: device.json.endpoint, p256dh: device.json.keys.p256dh, auth: device.json.keys.auth, created_at: new Date(Date.now() - index) });
    }
    await db.insert(activities).values({ id: newId('activity'), workspace_id: workspaceId, type: 'mailbox.poll_failed', actor_type: 'system', data: { mailbox_id: 'mbx_1' }, occurred_at: new Date(), created_at: new Date(Date.now() - 60_000) });

    const result = await dispatchNotifications(db, { mailer: null, net, secrets, appUrl: 'https://app.getacme.com', vapid, now: () => new Date() });
    assert.ok(result.sent >= 1);
    const [row] = await db.select().from(notifications).where(and(eq(notifications.user_id, ownerId), eq(notifications.channel, 'push')));
    assert.equal(row?.status, 'sent', 'push goes even to someone who turned mail off');
    const toLaptop = posted.find((request) => request.url === laptop.json.endpoint)!;
    assert.match(toLaptop.headers.authorization!, /^vapid t=.+, k=/);
    assert.deepEqual(laptop.open(toLaptop.body), { title: 'A mailbox can’t be read', body: 'Two checks for new mail failed in a row, so replies may be missed. Run the connection test.', url: 'https://app.getacme.com/deliverability', priority: 'urgent' });
    assert.ok(posted.some((request) => request.url === phone.json.endpoint));

    // The phone unsubscribed: its push service answers 410, and the subscription goes.
    answer = 410;
    await db.insert(activities).values({ id: newId('activity'), workspace_id: workspaceId, type: 'webhook.disabled', actor_type: 'system', data: { url: 'https://hooks.example/x' }, occurred_at: new Date(), created_at: new Date(Date.now() - 60_000) });
    await dispatchNotifications(db, { mailer: null, net, secrets, appUrl: null, vapid, now: () => new Date() });
    assert.equal((await db.select().from(push_subscriptions).where(eq(push_subscriptions.user_id, ownerId))).length, 0);
    answer = 201;
  });

  it('lets a signed-in person subscribe a browser, list and remove it; an API key can’t', async () => {
    await db.insert(users).values({ id: newId('user'), workspace_id: workspaceId, email: 'sam@getacme.com', name: 'Sam', role: 'member' });
    const signUp = await authHandler(new Request(`${APP}/api/auth/sign-up/email`, { method: 'POST', headers: { 'content-type': 'application/json', origin: APP, 'x-forwarded-for': '203.0.113.50' }, body: JSON.stringify({ email: 'sam@getacme.com', password: 'correct horse battery staple', name: 'Sam' }) }));
    const cookie = signUp.headers.getSetCookie().map((line) => line.split(';')[0]).join('; ');
    const settings = await call('GET', '/me/push', { headers: { cookie } });
    assert.deepEqual([settings.status, settings.body.vapid_public_key, settings.body.subscriptions], [200, vapid.publicKey, []]);

    const device = browser('https://fcm.googleapis.com/fcm/send/sam-laptop');
    const created = await call('POST', '/me/push/subscriptions', { headers: { cookie, origin: APP, 'user-agent': 'Mozilla/5.0 (Macintosh)' }, body: { ...device.json, expirationTime: null } });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.deepEqual([created.body.endpoint_host, created.body.user_agent], ['fcm.googleapis.com', 'Mozilla/5.0 (Macintosh)']);
    assert.ok(!JSON.stringify(created.body).includes(device.json.keys.auth), 'keys are never returned');
    assert.equal((await call('POST', '/me/push/subscriptions', { headers: { cookie, origin: APP }, body: device.json })).status, 201, 'subscribing again replaces it');
    assert.equal((await call('GET', '/me/push', { headers: { cookie } })).body.subscriptions.length, 1);
    assert.equal((await call('POST', '/me/push/subscriptions', { headers: { cookie, origin: APP }, body: { endpoint: 'http://insecure.example/x', keys: device.json.keys } })).status, 400);

    const { secret: key } = await seedApiKey(db, workspaceId, ['settings:manage']);
    assert.equal((await call('GET', '/me/push', { key })).status, 403, 'a key has no browser');
    assert.equal((await call('DELETE', `/me/push/subscriptions/${created.body.id}`, { headers: { cookie, origin: APP } })).status, 204);
    assert.equal((await call('DELETE', `/me/push/subscriptions/${created.body.id}`, { headers: { cookie, origin: APP } })).status, 404);
  });

  it('makes a VAPID key pair from the command line', async () => {
    const lines: string[] = [];
    assert.equal(await runCli(db, ['vapid-keys'], { write: (line) => lines.push(line) }), 0);
    assert.match(lines[0]!, /^VAPID_PUBLIC_KEY=B[A-Za-z0-9_-]{86}\nVAPID_PRIVATE_KEY=[A-Za-z0-9_-]{43}\nVAPID_SUBJECT=/);
  });
});
