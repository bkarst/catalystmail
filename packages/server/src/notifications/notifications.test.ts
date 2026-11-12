import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { activities, campaigns, contacts, escalations, newId, notifications, threads, users, type Db } from '@catalyst/db';
import { createTestDatabase } from '@catalyst/db/testing';
import type { SystemMailer } from '@catalyst/email';
import { MemoryQueue } from '@catalyst/jobs';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

import { call, seedApiKey, seedWorkspace } from '../api/testing.ts';
import { raiseEscalation } from '../escalations/raise.ts';
import { setDb, setDeps } from '../runtime.ts';
import { createSecretBox, parseEncryptionKeys } from '../secrets.ts';
import type { WebhookNet } from '../webhooks/net.ts';
import { dailyDigest, dispatchNotifications, quietUntil } from './dispatch.ts';

describe('quiet hours (§11.2)', () => {
  const quiet = { start: '20:00', end: '07:00' };
  it('holds mail until they end, across midnight, in the workspace zone', () => {
    assert.equal(quietUntil(new Date('2026-11-12T20:30:00Z'), 'Europe/Berlin', quiet)?.toISOString(), '2026-11-13T06:00:00.000Z', '21:30 in Berlin waits for 07:00 tomorrow');
    assert.equal(quietUntil(new Date('2026-11-13T04:00:00Z'), 'Europe/Berlin', quiet)?.toISOString(), '2026-11-13T06:00:00.000Z', '05:00 waits for 07:00 today');
    assert.equal(quietUntil(new Date('2026-11-13T11:00:00Z'), 'Europe/Berlin', quiet), null);
    assert.equal(quietUntil(new Date('2026-11-13T11:30:00Z'), 'UTC', { start: '11:00', end: '13:00' })?.toISOString(), '2026-11-13T13:00:00.000Z');
    assert.equal(quietUntil(new Date('2026-11-13T11:30:00Z'), 'UTC', null), null);
  });
});

// Needs a PostgreSQL server: set TEST_DATABASE_URL to any database on it.
const adminUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!adminUrl)('notifications, the digest and the team (§11.2, §15.18, IT-15)', () => {
  let db: Db;
  let drop: () => Promise<void>;
  let workspaceId: string;
  let key: string;
  const people: Record<string, string> = {};
  const secrets = createSecretBox(parseEncryptionKeys(`1:${randomBytes(32).toString('base64')}`));
  const mail: { to: string; subject: string; text: string }[] = [];
  const slack: string[] = [];
  const mailer: SystemMailer = { send: async (message) => void mail.push(message) };
  const net: WebhookNet = { resolve: async () => ['93.184.216.34'], post: async (_url, init) => (slack.push(String(init.body)), { status: 200, body: 'ok' }) };
  const deps = (now: Date, withMailer = true) => ({ mailer: withMailer ? mailer : null, net, secrets, appUrl: 'https://app.getacme.com', now: () => now });
  /** Runs the dispatcher once the activities have settled. */
  const dispatchSoon = (extraMs = 10_000) => dispatchNotifications(db, deps(new Date(Date.now() + extraMs)));

  beforeAll(async () => {
    ({ db, drop } = await createTestDatabase(adminUrl!));
    setDb(db);
    setDeps({ jobs: new MemoryQueue(), secrets, webhookNet: net, config: { trackingTarget: null, appHost: null } });
    workspaceId = await seedWorkspace(db, 'Acme');
    ({ secret: key } = await seedApiKey(db, workspaceId, ['settings:manage', 'escalations:write']));
    for (const [name, role, prefs] of [['olivia', 'owner', {}], ['adam', 'admin', {}], ['mia', 'member', {}], ['vic', 'viewer', {}], ['quiet', 'admin', { email: false }]] as const) {
      const id = newId('user');
      people[name] = id;
      await db.insert(users).values({ id, workspace_id: workspaceId, email: `${name}@getacme.com`, name, role, notification_prefs: prefs });
    }
  });
  beforeEach(() => {
    mail.length = 0;
    slack.length = 0;
  });
  afterAll(async () => {
    setDb(undefined);
    setDeps(undefined);
    await drop?.();
  });

  it('mails an urgent escalation to the owners and admins at once, posts it to Slack, and only once', async () => {
    const settings = await call('PATCH', '/settings', { key, body: { notifications: { slack_webhook_url: 'https://hooks.slack.com/services/T0/B0/x' } } });
    assert.equal(settings.status, 200, JSON.stringify(settings.body));
    assert.equal(settings.body.notifications.slack_configured, true);
    await raiseEscalation(db, { workspaceId, threadId: null, reason: 'complaint', title: 'Angry reply', explanation: 'They called it spam.' }, new Date());
    const result = await dispatchSoon();
    assert.deepEqual(mail.map((message) => message.to).sort(), ['adam@getacme.com', 'olivia@getacme.com'], 'not the member, the viewer, or the admin who turned mail off');
    assert.equal(mail[0]!.subject, 'Needs you: Angry reply');
    assert.match(mail[0]!.text, /They called it spam\.[\s\S]*Open: https:\/\/app\.getacme\.com\/needs-you\/esc_/);
    assert.equal(slack.length, 1);
    assert.match(JSON.parse(slack[0]!).text, /\*Needs you: Angry reply\*/);
    assert.equal(result.sent, 3);
    await dispatchSoon();
    assert.deepEqual([mail.length, slack.length], [2, 1], 'nothing twice');
  });

  it('sends to the assignee when there is one, holds high priority through quiet hours, and leaves normal ones for the digest', async () => {
    await call('PATCH', '/settings', { key, body: { notifications: { slack_webhook_url: null, quiet_hours: { start: '00:00', end: '23:59' } } } });
    const contactId = newId('contact');
    await db.insert(contacts).values({ id: contactId, workspace_id: workspaceId, email: 'p@globex.example' });
    const campaignId = newId('campaign');
    await db.insert(campaigns).values({ id: campaignId, workspace_id: workspaceId, name: 'Q4', objective: 'x', persona: {}, sending_window: { days: [1], start: '09:00', end: '17:00' } });
    const threadId = newId('thread');
    await db.insert(threads).values({ id: threadId, workspace_id: workspaceId, campaign_id: campaignId, contact_id: contactId, assigned_user_id: people.mia });
    await raiseEscalation(db, { workspaceId, threadId, reason: 'pricing_negotiation', title: 'Wants a discount', explanation: 'Asked for 30% off.' }, new Date());
    await raiseEscalation(db, { workspaceId, threadId, reason: 'attachment_received', title: 'Sent a PDF', explanation: 'An attachment.' }, new Date());
    await dispatchSoon();
    assert.equal(mail.length, 0, 'quiet hours hold the high one; the normal one waits for the digest');
    const [held] = await db.select().from(notifications).where(and(eq(notifications.user_id, people.mia!), eq(notifications.kind, 'escalation')));
    assert.equal(held!.status, 'pending');
    assert.ok(held!.send_after);
    await dispatchNotifications(db, deps(new Date(held!.send_after!.getTime() + 1000)));
    assert.deepEqual(mail.map((message) => [message.to, message.subject]), [['mia@getacme.com', 'Needs you: Wants a discount']]);
    await call('PATCH', '/settings', { key, body: { notifications: { quiet_hours: null } } });
  });

  it('alerts on a breaker trip, and records it when there is no system SMTP (IT-15)', async () => {
    await db.insert(activities).values({ id: newId('activity'), workspace_id: workspaceId, type: 'campaign.breaker_tripped', actor_type: 'system', data: { signal: 'campaign_early_bounces', level: 'pause', scope: 'campaign' }, occurred_at: new Date() });
    // A warning waits for the digest.
    await db.insert(activities).values({ id: newId('activity'), workspace_id: workspaceId, type: 'campaign.breaker_tripped', actor_type: 'system', data: { signal: 'campaign_early_bounces', level: 'warn', scope: 'campaign', name: 'Q4', hard_bounces: 3 }, occurred_at: new Date() });
    await dispatchNotifications(db, deps(new Date(Date.now() + 10_000), false));
    const rows = await db.select().from(notifications).where(eq(notifications.kind, 'breaker'));
    assert.equal(rows.length, 2, 'the pause, to the owner and the admin; not the warning');
    assert.deepEqual([...new Set(rows.map((row) => [row.status, row.error].join(': ')))], ['skipped: SYSTEM_SMTP_URL is not set.']);
  });

  it('sends one digest a day after 08:00 to everyone who wants it', async () => {
    const morning = new Date();
    morning.setUTCHours(9, 0, 0, 0);
    if (morning.getTime() < Date.now() - 3_600_000) morning.setUTCDate(morning.getUTCDate() + 1);
    const { queued } = await dailyDigest(db, deps(morning));
    assert.equal(queued, 3, 'owner, admin and member; not the viewer or the admin with mail off');
    assert.equal((await dailyDigest(db, deps(new Date(morning.getTime() + 3_600_000)))).queued, 0);
    await dispatchNotifications(db, deps(morning));
    const digest = mail.find((message) => message.to === 'mia@getacme.com')!;
    assert.match(digest.subject, /^Catalyst daily: \d+ waiting for you$/);
    assert.match(digest.text, /Needs you: \d+ open/);
    assert.match(digest.text, /Deliverability warnings: 1\.\n  • Q4: 3 of its first 50 emails bounced \(it pauses at 5\)/);
    assert.equal((await dailyDigest(db, deps(new Date(morning.getTime() - 2 * 3_600_000)))).queued, 0, 'not before 08:00 the next day');
  });

  it('invites people, keeps an owner, and removes people without losing their history', async () => {
    const invited = await call('POST', '/users', { key, body: { email: 'Nina@GetAcme.com', name: 'Nina', role: 'member' } });
    assert.equal(invited.status, 201, JSON.stringify(invited.body));
    assert.equal(invited.body.email, 'nina@getacme.com');
    await dispatchNotifications(db, deps(new Date()));
    assert.deepEqual(mail.map((message) => [message.to, message.subject]), [['nina@getacme.com', 'You’re invited to Acme on Catalyst']]);
    assert.equal((await call('POST', '/users', { key, body: { email: 'nina@getacme.com', name: 'Nina', role: 'member' } })).status, 409);

    assert.equal((await call('PATCH', `/users/${people.olivia}`, { key, body: { role: 'admin' } })).status, 409, 'the only owner');
    assert.equal((await call('DELETE', `/users/${people.olivia}`, { key })).status, 409);
    const [open] = await db.select().from(escalations).where(eq(escalations.status, 'open')).limit(1);
    await db.update(escalations).set({ assigned_user_id: people.adam }).where(eq(escalations.id, open!.id));
    assert.equal((await call('DELETE', `/users/${people.adam}`, { key })).status, 204);
    assert.equal((await db.select().from(escalations).where(eq(escalations.id, open!.id)))[0]!.assigned_user_id, null);
    const listed = await call('GET', '/users', { key });
    assert.ok(!listed.body.data.some((person: { id: string }) => person.id === people.adam));
    assert.ok((await call('GET', '/users?include_removed=true', { key })).body.data.some((person: { id: string; deactivated_at: string | null }) => person.id === people.adam && person.deactivated_at));
    assert.equal((await call('POST', `/escalations/${open!.id}/assign`, { key, body: { user_id: people.adam } })).status, 400, 'a removed person can’t be assigned');
    const back = await call('POST', '/users', { key, body: { email: 'adam@getacme.com', name: 'Adam', role: 'admin' } });
    assert.deepEqual([back.status, back.body.id, back.body.deactivated_at], [201, people.adam, null], 'invited again, the same person');
  });
});
