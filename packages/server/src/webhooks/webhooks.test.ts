import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';

import { activities, newId, webhook_deliveries, webhook_endpoints, type Db } from '@catalyst/db';
import { createTestDatabase } from '@catalyst/db/testing';
import { MemoryQueue } from '@catalyst/jobs';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

import { call, seedApiKey, seedWorkspace } from '../api/testing.ts';
import { setDb, setDeps } from '../runtime.ts';
import { createSecretBox, parseEncryptionKeys } from '../secrets.ts';
import { deliverWebhook, dispatchWebhooks, RETRY_SECONDS } from './delivery.ts';
import { isPublicAddress, unsafeUrlReason, type WebhookNet } from './net.ts';

describe('webhook addresses and signatures (§13.6, §16)', () => {
  it('refuses private, local and link-local addresses, IPv4 and IPv6', () => {
    for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.9', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fd00::5', '::ffff:10.0.0.1', 'not-an-ip']) {
      assert.equal(isPublicAddress(address), false, address);
    }
    for (const address of ['93.184.216.34', '8.8.8.8', '2606:4700:4700::1111', '::ffff:93.184.216.34']) assert.equal(isPublicAddress(address), true, address);
  });

  it('accepts only https URLs on hosts that resolve to public addresses', async () => {
    const net = { resolve: async (host: string) => ({ 'hooks.getacme.com': ['93.184.216.34'], 'rebind.example': ['93.184.216.34', '10.0.0.7'], 'gone.example': [] })[host] ?? [] };
    assert.equal(await unsafeUrlReason('https://hooks.getacme.com/catalyst', net), null);
    assert.match((await unsafeUrlReason('http://hooks.getacme.com/catalyst', net))!, /https/);
    assert.match((await unsafeUrlReason('https://localhost:8443/x', net))!, /not a public host/);
    assert.match((await unsafeUrlReason('https://169.254.169.254/latest/meta-data', net))!, /not a public address/);
    assert.match((await unsafeUrlReason('https://rebind.example/x', net))!, /10\.0\.0\.7/);
    assert.match((await unsafeUrlReason('https://gone.example/x', net))!, /does not resolve/);
    assert.match((await unsafeUrlReason('https://user:pw@hooks.getacme.com/x', net))!, /credentials/);
  });
});

// Needs a PostgreSQL server: set TEST_DATABASE_URL to any database on it.
const adminUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!adminUrl)('outbound webhooks (§13.4, §13.6, IT-14)', () => {
  let db: Db;
  let drop: () => Promise<void>;
  let workspaceId: string;
  let key: string;
  let otherKey: string;
  const jobs = new MemoryQueue();
  const secrets = createSecretBox(parseEncryptionKeys(`1:${randomBytes(32).toString('base64')}`));
  const posted: { url: string; headers: Record<string, string>; body: string }[] = [];
  let answer: { status: number; body: string } | Error = { status: 200, body: 'ok' };
  let addresses: Record<string, string[]> = {};
  const net: WebhookNet = {
    resolve: async (host) => addresses[host] ?? ['93.184.216.34'],
    post: async (url, init) => {
      posted.push({ url, headers: init.headers, body: String(init.body) });
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
  const deps = (now: Date) => ({ net, secrets, jobs, now: () => now });

  async function endpoint(events: string[]): Promise<{ id: string; secret: string }> {
    const response = await call('POST', '/webhooks', { key, body: { url: `https://hooks.getacme.com/${newId('event').slice(-6)}`, events } });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    return { id: response.body.id, secret: response.body.secret };
  }
  const activity = (type: string, data: Record<string, unknown>, createdAt: Date) =>
    db.insert(activities).values({ id: newId('activity'), workspace_id: workspaceId, type, actor_type: 'system', data, occurred_at: createdAt, created_at: createdAt }).returning().then((rows) => rows[0]!);
  const deliveriesOf = (endpointId: string) => db.select().from(webhook_deliveries).where(eq(webhook_deliveries.endpoint_id, endpointId));

  beforeAll(async () => {
    ({ db, drop } = await createTestDatabase(adminUrl!));
    setDb(db);
    setDeps({ jobs, secrets, webhookNet: net, config: { trackingTarget: null, appHost: null } });
    workspaceId = await seedWorkspace(db, 'Acme');
    ({ secret: key } = await seedApiKey(db, workspaceId, ['webhooks:manage']));
    ({ secret: otherKey } = await seedApiKey(db, await seedWorkspace(db, 'Other'), ['webhooks:manage']));
  });
  beforeEach(() => {
    jobs.clear();
    posted.length = 0;
    answer = { status: 200, body: 'ok' };
    addresses = {};
  });
  afterAll(async () => {
    setDb(undefined);
    setDeps(undefined);
    await drop?.();
  });

  it('registers an endpoint once, showing its secret only then; refuses unsafe URLs; is workspace-scoped', async () => {
    const created = await endpoint(['message.sent']);
    assert.match(created.secret, /^whsec_/);
    const listed = await call('GET', '/webhooks', { key });
    assert.equal(listed.body.data.length >= 1, true);
    assert.equal(listed.body.data.some((entry: { secret?: string }) => 'secret' in entry), false, 'never shown again');
    addresses = { 'internal.getacme.com': ['10.0.0.5'] };
    const unsafe = await call('POST', '/webhooks', { key, body: { url: 'https://internal.getacme.com/hook', events: ['message.sent'] } });
    assert.equal(unsafe.status, 400);
    assert.match(unsafe.body.errors[0].message, /10\.0\.0\.5/);
    assert.equal((await call('POST', '/webhooks', { key, body: { url: 'http://hooks.getacme.com/x', events: ['message.sent'] } })).status, 400);
    assert.equal((await call('PATCH', `/webhooks/${created.id}`, { key: otherKey, body: { active: false } })).status, 404);
    assert.equal((await call('GET', `/webhooks/${created.id}/deliveries`, { key: otherKey })).status, 404);
  });

  it('turns subscribed activities into one signed delivery each, once, after they settle', async () => {
    const { id, secret } = await endpoint(['message.sent', 'thread.goal_achieved', 'domain.ramp_changed']);
    const now = new Date(Date.now() + 60_000);
    const sent = await activity('message.sent', { message_id: 'msg_1', kind: 'initial' }, new Date(now.getTime() - 30_000));
    const goal = await activity('goal.achieved', { goal_id: 'goal_1', method: 'external_event' }, new Date(now.getTime() - 30_000));
    await activity('domain.ramp_advanced', { domain_id: 'dom_1', from_step: 3, to_step: 4 }, new Date(now.getTime() - 20_000));
    await activity('contact.created', {}, new Date(now.getTime() - 30_000));
    await activity('message.sent', { message_id: 'msg_2' }, new Date(now.getTime() - 5_000));

    await dispatchWebhooks(db, deps(now));
    const rows = await deliveriesOf(id);
    assert.equal(rows.length, 3, 'not contact.created (unsubscribed), not the one still settling');
    assert.equal((await dispatchWebhooks(db, deps(now))).queued, 0, 'idempotent');
    assert.deepEqual(rows.map((row) => row.event_type).sort(), ['domain.ramp_changed', 'message.sent', 'thread.goal_achieved']);
    const goalDelivery = rows.find((row) => row.event_type === 'thread.goal_achieved')!;
    assert.equal(goalDelivery.event_id, `evt_${goal.id.slice(4)}`);
    assert.deepEqual((rows.find((row) => row.event_type === 'domain.ramp_changed')!.payload as { data: { action: string } }).data.action, 'advanced');

    const delivered = await deliverWebhook(db, rows.find((row) => row.event_id === `evt_${sent.id.slice(4)}`)!.id, deps(now));
    assert.deepEqual([delivered!.status, delivered!.attempt, delivered!.response_status], ['delivered', 1, 200]);
    const [request] = posted;
    const envelope = JSON.parse(request!.body);
    assert.deepEqual([envelope.type, envelope.workspace_id, envelope.data.message_id], ['message.sent', workspaceId, 'msg_1']);
    const [, t, v1] = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(request!.headers['catalyst-signature']!)!;
    assert.equal(v1, createHmac('sha256', secret).update(`${t}.${request!.body}`).digest('hex'), 'verifiable with the secret');
    assert.equal(request!.headers['catalyst-event'], 'message.sent');
  });

  it('retries on the §13.6 schedule, gives up after 8 attempts, and turns off an endpoint failing for 3 days', async () => {
    const { id } = await endpoint(['message.received']);
    const start = new Date(Date.now() + 60_000);
    await activity('message.received', { message_id: 'msg_r' }, new Date(start.getTime() - 30_000));
    await dispatchWebhooks(db, deps(start));
    const [row] = await deliveriesOf(id);
    answer = { status: 500, body: 'oops' };
    let now = start;
    for (const [index, seconds] of RETRY_SECONDS.entries()) {
      jobs.clear();
      const attempt = await deliverWebhook(db, row!.id, deps(now));
      assert.deepEqual([attempt!.status, attempt!.attempt], ['pending', index + 1]);
      assert.equal(attempt!.next_attempt_at!.getTime(), now.getTime() + seconds * 1000);
      assert.equal(jobs.jobs[0]!.startAfter!.getTime(), now.getTime() + seconds * 1000);
      now = attempt!.next_attempt_at!;
    }
    const last = await deliverWebhook(db, row!.id, deps(now));
    assert.deepEqual([last!.status, last!.attempt, last!.next_attempt_at], ['failed', 8, null]);
    assert.equal((await db.select().from(webhook_endpoints).where(eq(webhook_endpoints.id, id)))[0]!.active, true, 'about 45 hours of failures: not yet 3 days');

    // Still failing on day 4: off.
    const later = new Date(start.getTime() + 4 * 86_400_000);
    await activity('message.received', { message_id: 'msg_r2' }, new Date(later.getTime() - 30_000));
    await dispatchWebhooks(db, deps(later));
    const next = (await deliveriesOf(id)).find((entry) => entry.id !== row!.id)!;
    await deliverWebhook(db, next.id, deps(later));
    const [disabled] = await db.select().from(webhook_endpoints).where(eq(webhook_endpoints.id, id));
    assert.equal(disabled!.active, false, 'failing since the first delivery, more than 3 days before');
    assert.equal((await db.select().from(activities).where(and(eq(activities.workspace_id, workspaceId), eq(activities.type, 'webhook.disabled')))).length, 1);

    // Back on, and the delivery sent again by hand.
    assert.equal((await call('PATCH', `/webhooks/${id}`, { key, body: { active: true } })).body.consecutive_failures, 0);
    answer = { status: 204, body: '' };
    jobs.clear();
    const again = await call('POST', `/webhook-deliveries/${row!.id}/redeliver`, { key });
    assert.equal(again.status, 202, JSON.stringify(again.body));
    assert.deepEqual(jobs.of('webhook.deliver'), [{ delivery_id: row!.id }]);
    assert.equal((await deliverWebhook(db, row!.id, deps(new Date())))!.status, 'delivered');
  });

  it('checks the address again at delivery, against DNS rebinding', async () => {
    const { id } = await endpoint(['message.bounced']);
    const now = new Date(Date.now() + 60_000);
    await activity('message.bounced', {}, new Date(now.getTime() - 30_000));
    await dispatchWebhooks(db, deps(now));
    const [row] = await deliveriesOf(id);
    const [endpointRow] = await db.select().from(webhook_endpoints).where(eq(webhook_endpoints.id, id));
    addresses = { [new URL(endpointRow!.url).hostname]: ['127.0.0.1'] };
    const attempt = await deliverWebhook(db, row!.id, deps(now));
    assert.equal(attempt!.status, 'pending');
    assert.match(attempt!.response_snippet!, /127\.0\.0\.1/);
    assert.equal(posted.length, 0, 'nothing was sent');
  });

  it('sends a test event now and logs it', async () => {
    const { id } = await endpoint(['message.sent']);
    const tested = await call('POST', `/webhooks/${id}/test`, { key });
    assert.equal(tested.status, 200, JSON.stringify(tested.body));
    assert.deepEqual([tested.body.event_type, tested.body.status, tested.body.response_status], ['webhook.test', 'delivered', 200]);
    assert.equal(JSON.parse(posted[0]!.body).type, 'webhook.test');
    const log = await call('GET', `/webhooks/${id}/deliveries`, { key });
    assert.deepEqual(log.body.data.map((entry: { id: string }) => entry.id), [tested.body.id]);
    assert.equal((await call('DELETE', `/webhooks/${id}`, { key })).status, 204);
    assert.equal((await call('GET', `/webhooks/${id}/deliveries`, { key })).status, 404);
  });
});
