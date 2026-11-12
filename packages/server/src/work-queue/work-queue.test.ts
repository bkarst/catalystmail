import assert from 'node:assert/strict';

import { campaigns, contacts, mailboxes, messages, newId, sending_domains, threads, type Db } from '@catalyst/db';
import { createTestDatabase } from '@catalyst/db/testing';
import { MemoryQueue } from '@catalyst/jobs';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { call, seedApiKey, seedWorkspace } from '../api/testing.ts';
import { raiseEscalation } from '../escalations/raise.ts';
import { setDb, setDeps } from '../runtime.ts';

// Needs a PostgreSQL server: set TEST_DATABASE_URL to any database on it.
const adminUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!adminUrl)('the work queue (§14.5)', () => {
  let db: Db;
  let drop: () => Promise<void>;

  beforeAll(async () => {
    ({ db, drop } = await createTestDatabase(adminUrl!));
    setDb(db);
    setDeps({ jobs: new MemoryQueue(), config: { trackingTarget: null, appHost: null } });
  });
  afterAll(async () => {
    setDb(undefined);
    setDeps(undefined);
    await drop?.();
  });

  it('lists escalations, drafts, unmatched replies and troubled mailboxes, most urgent first, each with tools to settle it', async () => {
    const workspaceId = await seedWorkspace(db, 'Acme');
    const { secret: key } = await seedApiKey(db, workspaceId, ['threads:read']);
    const { secret: otherKey } = await seedApiKey(db, await seedWorkspace(db, 'Other'), ['threads:read']);
    const domainId = newId('domain');
    await db.insert(sending_domains).values({ id: domainId, workspace_id: workspaceId, domain: 'getacme.com' });
    const mailbox = (email: string, status: 'active' | 'paused' | 'error', reason: string | null) => {
      const id = newId('mailbox');
      return db
        .insert(mailboxes)
        .values({ id, workspace_id: workspaceId, sending_domain_id: domainId, email, display_name: 'Alex', auth: 'password', status, status_reason: reason, smtp_host: 's', smtp_port: 465, smtp_secure: 'tls', smtp_username: 'a', imap_host: 'i', imap_username: 'a', credentials_enc: Buffer.from('x'), credentials_key_version: 1, folders: {} })
        .then(() => id);
    };
    const healthy = await mailbox('alex@getacme.com', 'active', null);
    const broken = await mailbox('sam@getacme.com', 'error', 'Polling failed twice in a row: auth');
    const tripped = await mailbox('jo@getacme.com', 'paused', 'breaker: hard bounces at 4%');
    await mailbox('kim@getacme.com', 'paused', 'On holiday');

    const campaignId = newId('campaign');
    await db.insert(campaigns).values({ id: campaignId, workspace_id: workspaceId, name: 'Q4', objective: 'Calls', status: 'active', persona: {}, sending_window: { days: [1, 2, 3, 4, 5], start: '08:30', end: '17:30' } });
    const contactId = newId('contact');
    await db.insert(contacts).values({ id: contactId, workspace_id: workspaceId, email: 'priya@globex.example' });
    const threadId = newId('thread');
    await db.insert(threads).values({ id: threadId, workspace_id: workspaceId, campaign_id: campaignId, contact_id: contactId, mailbox_id: healthy, stage: 'sent', stage_rank: 1 });

    const message = (values: Partial<typeof messages.$inferInsert>) => {
      const id = newId('message');
      return db
        .insert(messages)
        .values({ id, workspace_id: workspaceId, mailbox_id: healthy, direction: 'outbound', status: 'draft', author: 'human_app', message_id_header: `<${id}@x>`, from_email: 'alex@getacme.com', to_emails: [], subject: 'Re: Quick question', ...values })
        .then(() => id);
    };
    const approval = await message({ thread_id: threadId, status: 'pending_approval', author: 'ai' });
    const draft = await message({ thread_id: threadId });
    const stray = await message({ direction: 'inbound', status: 'received', author: 'contact', from_email: 'priya@globex.example', subject: 'Pricing?' });
    const escalated = await message({ direction: 'inbound', status: 'received', author: 'contact', from_email: 'priya@globex.example', subject: 'Re: Hello' });
    await message({ direction: 'inbound', status: 'received', author: 'contact', from_email: 'priya@globex.example', subject: 'Ignored', ignored_at: new Date() });
    const complaint = (await raiseEscalation(db, { workspaceId, threadId, reason: 'complaint', title: 'Angry reply', explanation: 'They called it spam.' }, new Date())).id;
    const unmatched = (await raiseEscalation(db, { workspaceId, threadId: null, reason: 'unmatched_reply', title: 'Unmatched', explanation: 'No thread fits.', triggerMessageId: escalated }, new Date())).id;

    const response = await call('GET', '/work-queue', { key });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const order = response.body.items.map((item: { kind: string; id: string }) => `${item.kind}:${item.id}`);
    assert.deepEqual(order.slice(0, 2).sort(), [`escalation:${complaint}`, `mailbox:${broken}`].sort(), 'urgent first');
    assert.deepEqual(new Set(order.slice(2, 4)), new Set([`draft:${approval}`, `mailbox:${tripped}`]), 'then high');
    assert.deepEqual(new Set(order.slice(4)), new Set([`escalation:${unmatched}`, `draft:${draft}`, `unmatched_reply:${stray}`]), 'then normal; the escalated stray mail appears once, as its escalation');
    assert.deepEqual(response.body.counts, { escalation: 2, draft: 2, unmatched_reply: 1, mailbox: 2, reply_needed: 0, follow_up_needed: 0 });
    const complaintItem = response.body.items.find((item: { id: string }) => item.id === complaint);
    assert.deepEqual([complaintItem.thread_id, complaintItem.contact_id], [threadId, contactId]);
    assert.ok(complaintItem.suggested_tools.includes('close_thread'));
    assert.deepEqual((await call('GET', '/work-queue?limit=2', { key })).body.items.length, 2);
    assert.deepEqual((await call('GET', '/work-queue', { key: otherKey })).body, { items: [], counts: { escalation: 0, draft: 0, unmatched_reply: 0, mailbox: 0, reply_needed: 0, follow_up_needed: 0 } });
  });
});
