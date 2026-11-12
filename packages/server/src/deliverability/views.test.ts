import assert from 'node:assert/strict';

import { activities, campaign_mailboxes, campaigns, contacts, mailboxes, newId, sending_domains, threads, type Db } from '@catalyst/db';
import { createTestDatabase } from '@catalyst/db/testing';
import { MemoryQueue } from '@catalyst/jobs';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { call, seedApiKey, seedWorkspace } from '../api/testing.ts';
import { workspaceDay } from '../outbound/capacity.ts';
import { setDb, setDeps } from '../runtime.ts';
import { daysBefore } from './rollup.ts';

// Needs a PostgreSQL server: set TEST_DATABASE_URL to any database on it.
const adminUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!adminUrl)('sending capacity and the Deliverability overview (§8.3.5, §15.15)', () => {
  let db: Db;
  let drop: () => Promise<void>;
  let key: string;
  let otherKey: string;
  let domainId: string;
  let campaignId: string;
  const mailboxIds: string[] = [];
  const today = workspaceDay(new Date(), 'UTC').day;
  const inDays = (days: number) => daysBefore(today, -days);

  beforeAll(async () => {
    ({ db, drop } = await createTestDatabase(adminUrl!));
    setDb(db);
    setDeps({ jobs: new MemoryQueue(), config: { trackingTarget: null, appHost: null } });
    const workspaceId = await seedWorkspace(db, 'Acme');
    ({ secret: key } = await seedApiKey(db, workspaceId, ['mailboxes:read']));
    ({ secret: otherKey } = await seedApiKey(db, await seedWorkspace(db, 'Other'), ['mailboxes:read']));
    domainId = newId('domain');
    await db.insert(sending_domains).values({ id: domainId, workspace_id: workspaceId, domain: 'getacme.com', spf_status: 'pass', dkim_status: 'pass', dmarc_status: 'warn', dmarc_policy: 'none' });
    for (const name of ['alex', 'sam']) {
      const id = newId('mailbox');
      mailboxIds.push(id);
      // A new mailbox: 40 a day after warm-up, 10 today.
      await db.insert(mailboxes).values({ id, workspace_id: workspaceId, sending_domain_id: domainId, email: `${name}@getacme.com`, display_name: name, auth: 'password', status: 'active', smtp_host: 's', smtp_port: 465, smtp_secure: 'tls', smtp_username: 'a', imap_host: 'i', imap_username: 'a', credentials_enc: Buffer.from('x'), credentials_key_version: 1, folders: {} });
    }
    campaignId = newId('campaign');
    await db.insert(campaigns).values({ id: campaignId, workspace_id: workspaceId, name: 'Agency outreach Q4', objective: 'Calls', status: 'active', persona: {}, sending_window: { days: [1, 2, 3, 4, 5], start: '08:30', end: '17:30' } });
    await db.insert(campaign_mailboxes).values(mailboxIds.map((mailbox_id) => ({ campaign_id: campaignId, mailbox_id })));
    for (let index = 0; index < 30; index += 1) {
      const contactId = newId('contact');
      await db.insert(contacts).values({ id: contactId, workspace_id: workspaceId, email: `p${index}@prospect${index}.example` });
      await db.insert(threads).values({ id: newId('thread'), workspace_id: workspaceId, campaign_id: campaignId, contact_id: contactId, next_action_type: 'send_initial' });
    }
    await db.insert(activities).values({ id: newId('activity'), workspace_id: workspaceId, type: 'domain.ramp_advanced', actor_type: 'system', data: { domain_id: domainId }, occurred_at: new Date() });
    await db.insert(activities).values({ id: newId('activity'), workspace_id: workspaceId, type: 'contact.created', actor_type: 'system', data: {}, occurred_at: new Date() });
  });
  afterAll(async () => {
    setDb(undefined);
    setDeps(undefined);
    await drop?.();
  });

  it('plans today by domain, mailbox and campaign, and projects the ramp 7 days ahead', async () => {
    const response = await call('GET', '/capacity', { key });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const capacity = response.body;
    assert.equal(capacity.day, today);
    assert.deepEqual(capacity.domains.map((entry: { cap: number }) => entry.cap), [20], 'step 0 of new_domain');
    for (const mailbox of capacity.mailboxes) {
      // 10 each; 15% held for replies, rounded up; the rest for first emails.
      assert.deepEqual([mailbox.alloc, mailbox.reply_reserve, mailbox.first_touch_pool, mailbox.limited_by], [10, 2, 8, 'mailbox_cap']);
    }
    const [campaign] = capacity.campaigns;
    assert.deepEqual([campaign.name, campaign.wants, campaign.alloc, campaign.used, campaign.waiting], ['Agency outreach Q4', 30, 16, 0, 30]);
    // 16 today, then tomorrow's ramp step 1 (23 across mailboxes warmed to 15 each) covers the other 14.
    assert.equal(campaign.finishes_on, inDays(1));
    assert.deepEqual(capacity.forecast.map((entry: { domains: { cap: number }[] }) => entry.domains[0]!.cap), [23, 26, 30, 35, 40, 46, 53], 'the §8.3.3 steps');
    assert.deepEqual(capacity.forecast.map((entry: { day: string }) => entry.day), [1, 2, 3, 4, 5, 6, 7].map(inDays));

    const one = await call('GET', `/capacity?mailbox_id=${mailboxIds[0]}`, { key });
    assert.deepEqual(one.body.mailboxes.map((entry: { mailbox_id: string }) => entry.mailbox_id), [mailboxIds[0]]);
    const other = await call('GET', '/capacity', { key: otherKey });
    assert.deepEqual([other.body.domains, other.body.mailboxes, other.body.campaigns], [[], [], []]);
  });

  it('gives the overview: domain reputation, DNS and ramp, mailbox state, today’s totals and recent events', async () => {
    const response = await call('GET', '/deliverability', { key });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const [domain] = response.body.domains;
    assert.deepEqual([domain.domain, domain.reputation_band, domain.dns.spf, domain.dns.dmarc, domain.dns.mx], ['getacme.com', 'healthy', 'pass', 'warn', null]);
    assert.deepEqual([domain.ramp.today_cap, domain.ramp.tomorrow_cap, domain.ramp.status], [20, 23, 'ramping']);
    assert.deepEqual(response.body.mailboxes.map((entry: { email: string; today_cap: number }) => [entry.email, entry.today_cap]), [['alex@getacme.com', 10], ['sam@getacme.com', 10]]);
    assert.equal(response.body.mailboxes[0].warmup.complete, false);
    assert.deepEqual([response.body.today.planned, response.body.today.sent], [20, 0]);
    assert.deepEqual(response.body.events.map((event: { type: string }) => event.type), ['domain.ramp_advanced'], 'only deliverability events');
    assert.deepEqual((await call('GET', '/deliverability', { key: otherKey })).body.domains, []);
  });
});
