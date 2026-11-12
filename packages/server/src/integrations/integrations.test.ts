import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';

import { activities, campaign_goals, campaign_steps, campaigns, contacts, mailboxes, messages, newId, sending_domains, thread_goal_achievements, threads, webhook_deliveries, type Db } from '@catalyst/db';
import { createTestDatabase } from '@catalyst/db/testing';
import { MemoryQueue } from '@catalyst/jobs';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { call, seedApiKey, seedWorkspace } from '../api/testing.ts';
import { setDb, setDeps } from '../runtime.ts';
import { createSecretBox, parseEncryptionKeys } from '../secrets.ts';
import { dispatchWebhooks } from '../webhooks/delivery.ts';
import { verifySignature } from './service.ts';

// Needs a PostgreSQL server: set TEST_DATABASE_URL to any database on it.
const adminUrl = process.env.TEST_DATABASE_URL;

const sign = (secret: string, body: string, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;

describe('integration signatures (§13.7)', () => {
  it('checks each provider’s scheme on the exact body, and refuses stale timestamps', () => {
    const now = new Date();
    const body = '{"id":"evt_1"}';
    assert.equal(verifySignature('stripe', new Headers({ 'stripe-signature': `${sign('s3cret', body)},v0=abc` }), 's3cret', body, now), true);
    assert.equal(verifySignature('stripe', new Headers({ 'stripe-signature': sign('s3cret', body) }), 's3cret', `${body} `, now), false, 'one byte off');
    assert.equal(verifySignature('stripe', new Headers({ 'stripe-signature': sign('s3cret', body, Math.floor(now.getTime() / 1000) - 600) }), 's3cret', body, now), false, '10 minutes old');
    assert.equal(verifySignature('calcom', new Headers({ 'x-cal-signature-256': createHmac('sha256', 's3cret').update(body).digest('hex') }), 's3cret', body, now), true);
    assert.equal(verifySignature('calendly', new Headers({ 'calendly-webhook-signature': sign('s3cret', body) }), 's3cret', body, now), true);
    assert.equal(verifySignature('generic', new Headers({}), 's3cret', body, now), false);
  });
});

describe.skipIf(!adminUrl)('integration events become goal achievements (§13.7, IT-14)', () => {
  let db: Db;
  let drop: () => Promise<void>;
  let workspaceId: string;
  let key: string;
  let otherKey: string;
  let threadId: string;
  let contactId: string;
  let callGoal: string;
  let paidGoal: string;
  const jobs = new MemoryQueue();
  const secrets = createSecretBox(parseEncryptionKeys(`1:${randomBytes(32).toString('base64')}`));
  const post = (path: string, body: string, headers: Record<string, string>) => call('POST', path, { rawBody: body, headers: { 'content-type': 'application/json', ...headers } });

  beforeAll(async () => {
    ({ db, drop } = await createTestDatabase(adminUrl!));
    setDb(db);
    setDeps({ jobs, secrets, webhookNet: { resolve: async () => ['93.184.216.34'], post: async () => ({ status: 200, body: 'ok' }) }, config: { trackingTarget: null, appHost: null } });
    workspaceId = await seedWorkspace(db, 'Acme');
    ({ secret: key } = await seedApiKey(db, workspaceId, ['settings:manage', 'threads:read', 'threads:write', 'webhooks:manage']));
    ({ secret: otherKey } = await seedApiKey(db, await seedWorkspace(db, 'Other'), ['settings:manage', 'threads:write']));

    const domainId = newId('domain');
    await db.insert(sending_domains).values({ id: domainId, workspace_id: workspaceId, domain: 'getacme.com' });
    const mailboxId = newId('mailbox');
    await db.insert(mailboxes).values({ id: mailboxId, workspace_id: workspaceId, sending_domain_id: domainId, email: 'alex@getacme.com', display_name: 'Alex', auth: 'password', status: 'active', smtp_host: 's', smtp_port: 465, smtp_secure: 'tls', smtp_username: 'a', imap_host: 'i', imap_username: 'a', credentials_enc: Buffer.from('x'), credentials_key_version: 1, folders: {} });
    const campaignId = newId('campaign');
    await db.insert(campaigns).values({ id: campaignId, workspace_id: workspaceId, name: 'Q4', objective: 'Paid customers', status: 'active', persona: {}, sending_window: { days: [1, 2, 3, 4, 5], start: '08:30', end: '17:30' } });
    callGoal = newId('goal');
    paidGoal = newId('goal');
    await db.insert(campaign_goals).values([
      { id: callGoal, campaign_id: campaignId, position: 1, key: 'call', name: 'Call booked', success_criteria: 'Books', playbook: 'Offer a call', external_event_match: { source: 'calcom', type: 'BOOKING_CREATED' } },
      { id: paidGoal, campaign_id: campaignId, position: 2, key: 'paid', name: 'Paid', success_criteria: 'Pays', playbook: 'Send checkout', marks_customer: true, external_event_match: [{ source: 'stripe', type: 'checkout.session.completed' }, { source: 'stripe', type: 'invoice.paid' }] },
    ]);
    await db.insert(campaign_steps).values({ id: newId('step'), campaign_id: campaignId, position: 1 });
    contactId = newId('contact');
    await db.insert(contacts).values({ id: contactId, workspace_id: workspaceId, email: 'priya@globex.example', lifecycle_stage: 'engaged' });
    threadId = newId('thread');
    await db.insert(threads).values({ id: threadId, workspace_id: workspaceId, campaign_id: campaignId, contact_id: contactId, mailbox_id: mailboxId, stage: 'sent', stage_rank: 1 });
    await db.insert(messages).values({ id: newId('message'), workspace_id: workspaceId, thread_id: threadId, mailbox_id: mailboxId, direction: 'outbound', status: 'sent', author: 'template', message_id_header: '<first@getacme.com>', from_email: 'alex@getacme.com', to_emails: ['priya@globex.example'], subject: 'Quick question', sent_at: new Date(Date.now() - 86_400_000) });
  });
  afterAll(async () => {
    setDb(undefined);
    setDeps(undefined);
    await drop?.();
  });

  async function integration(kind: string, signingSecret?: string) {
    const created = await call('POST', '/integrations', { key, body: { kind, ...(signingSecret && { signing_secret: signingSecret }) } });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    return created.body as { id: string; webhook_path: string; secret: string | null };
  }

  it('achieves the final goal from a signed Stripe checkout, implying the first, completing the thread, and once only (IT-14)', async () => {
    const stripe = await integration('stripe', 'whsec_stripe_test');
    assert.equal(stripe.secret, null, 'the provider’s secret is never echoed');
    assert.match(stripe.webhook_path, new RegExp(`^/api/v1/integrations/stripe/webhook\\?integration_id=${stripe.id}$`));
    // An endpoint listening for goals, to see the webhook go out.
    const hook = await call('POST', '/webhooks', { key, body: { url: 'https://hooks.getacme.com/x', events: ['thread.goal_achieved'] } });
    assert.equal(hook.status, 201, JSON.stringify(hook.body));

    const event = JSON.stringify({ id: 'evt_stripe_1', type: 'checkout.session.completed', created: Math.floor(Date.now() / 1000), data: { object: { customer_details: { email: 'Priya@Globex.example' }, amount_total: 49_900 } } });
    const path = `/integrations/stripe/webhook?integration_id=${stripe.id}`;
    assert.equal((await post(path, event, { 'stripe-signature': sign('wrong', event) })).status, 401);
    const received = await post(path, event, { 'stripe-signature': sign('whsec_stripe_test', event) });
    assert.equal(received.status, 202, JSON.stringify(received.body));
    assert.deepEqual([received.body.outcome, received.body.duplicate], ['matched', false]);

    const achieved = await db.select().from(thread_goal_achievements).where(eq(thread_goal_achievements.thread_id, threadId));
    assert.deepEqual(achieved.map((row) => [row.goal_id === paidGoal ? 'paid' : 'call', row.method]).sort(), [['call', 'implied'], ['paid', 'external_event']]);
    const [thread] = await db.select().from(threads).where(eq(threads.id, threadId));
    assert.deepEqual([thread!.stage, thread!.state], ['goal_achieved', 'completed']);
    assert.equal((await db.select().from(contacts).where(eq(contacts.id, contactId)))[0]!.lifecycle_stage, 'customer');
    const [logged] = await db.select().from(activities).where(and(eq(activities.thread_id, threadId), eq(activities.type, 'goal.achieved')));
    assert.deepEqual([logged!.actor_type, (logged!.data as { value_cents: number }).value_cents], ['integration', 49_900]);

    const again = await post(path, event, { 'stripe-signature': sign('whsec_stripe_test', event) });
    assert.deepEqual([again.status, again.body.duplicate, again.body.id], [202, true, received.body.id], 'Stripe retries change nothing');

    // Once settled, the dispatcher sends `thread.goal_achieved`.
    await dispatchWebhooks(db, { jobs, now: () => new Date(Date.now() + 60_000) });
    const [delivery] = await db.select().from(webhook_deliveries).where(eq(webhook_deliveries.endpoint_id, hook.body.id));
    assert.equal(delivery!.event_type, 'thread.goal_achieved');
    assert.deepEqual((delivery!.payload as { data: { goal_id: string; method: string } }).data.goal_id, paidGoal);
    assert.equal((await post(`/integrations/calcom/webhook?integration_id=${stripe.id}`, event, {})).status, 404, 'a Stripe integration is not a Cal.com one');
  });

  it('takes Cal.com bookings, and stores types it doesn’t act on as ignored', async () => {
    const calcom = await integration('calcom', 'calsecret123');
    const booking = JSON.stringify({ triggerEvent: 'BOOKING_CREATED', payload: { uid: 'bk_1', startTime: '2026-11-20T15:00:00Z', attendees: [{ email: 'nobody@else.example' }] } });
    const signature = (body: string) => createHmac('sha256', 'calsecret123').update(body).digest('hex');
    const result = await post(`/integrations/calcom/webhook?integration_id=${calcom.id}`, booking, { 'x-cal-signature-256': signature(booking) });
    assert.equal(result.body.outcome, 'no_contact');
    const cancelled = JSON.stringify({ triggerEvent: 'BOOKING_CANCELLED', payload: { uid: 'bk_2', attendees: [{ email: 'priya@globex.example' }] } });
    assert.equal((await post(`/integrations/calcom/webhook?integration_id=${calcom.id}`, cancelled, { 'x-cal-signature-256': signature(cancelled) })).body.outcome, 'ignored');
  });

  it('takes signed generic events, lists the unmatched ones, and attaches one by hand', async () => {
    const generic = await integration('generic');
    assert.match(generic.secret!, /^ingsec_/);
    const body = JSON.stringify({ source: 'billing', type: 'subscription.started', external_id: 'sub_1', contact_email: 'someone@new.example', goal_key: 'paid', value_cents: 1000, occurred_at: new Date().toISOString() });
    const headers = { 'catalyst-integration': generic.id, 'catalyst-signature': sign(generic.secret!, body) };
    assert.equal((await post('/integrations/events', body, { 'catalyst-integration': generic.id })).status, 401);
    const received = await post('/integrations/events', body, headers);
    assert.equal(received.status, 202, JSON.stringify(received.body));
    assert.equal(received.body.outcome, 'no_contact');

    const unmatched = await call('GET', '/integration-events?outcome=no_contact', { key });
    assert.ok(unmatched.body.data.some((entry: { id: string }) => entry.id === received.body.id));
    assert.equal((await call('GET', '/integration-events', { key: otherKey })).body.data.length, 0);
    assert.equal((await call('POST', `/integration-events/${received.body.id}/attach`, { key: otherKey, body: { thread_id: threadId, goal_id: paidGoal } })).status, 404);
    const attached = await call('POST', `/integration-events/${received.body.id}/attach`, { key, body: { thread_id: threadId, goal_id: paidGoal } });
    assert.equal(attached.status, 200, JSON.stringify(attached.body));
    assert.deepEqual([attached.body.outcome, attached.body.matched_thread_id], ['matched', threadId]);

    assert.equal((await call('DELETE', `/integrations/${generic.id}`, { key })).status, 204);
    assert.equal((await post('/integrations/events', body, headers)).status, 404, 'disconnected');
  });
});
