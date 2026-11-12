import assert from 'node:assert/strict';

import { ai_runs, attachments, campaigns, contacts, idempotency_keys, mailboxes, messages, newId, sending_domains, threads, tracking_events, type Db } from '@catalyst/db';
import { createTestDatabase } from '@catalyst/db/testing';
import { MemoryStorage, ObjectNotFound } from '@catalyst/storage';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { seedWorkspace } from '../api/testing.ts';
import { runRetention } from './retention.ts';

// Needs a PostgreSQL server: set TEST_DATABASE_URL to any database on it.
const adminUrl = process.env.TEST_DATABASE_URL;
const monthsAgo = (months: number) => {
  const date = new Date();
  date.setUTCMonth(date.getUTCMonth() - months);
  return date;
};

describe.skipIf(!adminUrl)('retention (§6.11)', () => {
  let db: Db;
  let drop: () => Promise<void>;

  beforeAll(async () => {
    ({ db, drop } = await createTestDatabase(adminUrl!));
  });
  afterAll(async () => {
    await drop?.();
  });

  it('removes what has outlived its time and keeps the rest', async () => {
    const workspaceId = await seedWorkspace(db, 'Acme');
    const campaignId = newId('campaign');
    await db.insert(campaigns).values({ id: campaignId, workspace_id: workspaceId, name: 'Q4', objective: 'Calls', persona: {}, sending_window: { days: [1], start: '09:00', end: '17:00' } });
    const contactId = newId('contact');
    await db.insert(contacts).values({ id: contactId, workspace_id: workspaceId, email: 'p@globex.example' });
    const domainId = newId('domain');
    await db.insert(sending_domains).values({ id: domainId, workspace_id: workspaceId, domain: 'getacme.com' });
    const mailboxId = newId('mailbox');
    await db.insert(mailboxes).values({ id: mailboxId, workspace_id: workspaceId, sending_domain_id: domainId, email: 'alex@getacme.com', display_name: 'Alex', auth: 'password', status: 'active', smtp_host: 's', smtp_port: 465, smtp_secure: 'tls', smtp_username: 'a', imap_host: 'i', imap_username: 'a', credentials_enc: Buffer.from('x'), credentials_key_version: 1, folders: {} });
    const threadId = newId('thread');
    await db.insert(threads).values({ id: threadId, workspace_id: workspaceId, campaign_id: campaignId, contact_id: contactId });
    const storage = new MemoryStorage();
    const email = async (createdAt: Date) => {
      const id = newId('message');
      const key = `raw/${workspaceId}/${id}.eml`;
      await storage.put(key, Buffer.from('raw'), 'message/rfc822');
      await storage.put(`${key}.pdf`, Buffer.from('pdf'), 'application/pdf');
      await db.insert(messages).values({ id, workspace_id: workspaceId, thread_id: threadId, mailbox_id: mailboxId, direction: 'inbound', status: 'received', author: 'contact', message_id_header: `<${id}@x>`, from_email: 'p@globex.example', to_emails: [], subject: 'Hi', body_text: 'Parsed text', raw_storage_key: key, has_attachments: true, created_at: createdAt });
      await db.insert(attachments).values({ id: newId('attachment'), message_id: id, filename: 'deck.pdf', storage_key: `${key}.pdf` });
      return { id, key };
    };
    const old = await email(monthsAgo(19));
    const recent = await email(monthsAgo(17));
    await db.insert(tracking_events).values([
      { id: newId('tracking_event'), workspace_id: workspaceId, message_id: old.id, thread_id: threadId, type: 'open', source: 'human', occurred_at: monthsAgo(14) },
      { id: newId('tracking_event'), workspace_id: workspaceId, message_id: recent.id, thread_id: threadId, type: 'open', source: 'human', occurred_at: monthsAgo(12) },
    ]);
    const run = (createdAt: Date) => ({ id: newId('ai_run'), workspace_id: workspaceId, thread_id: threadId, task: 'analyze_inbound', model: 'claude-opus-5-5', prompt_version: 'analyze_inbound.v1', status: 'ok', output: { summary: 'Asked about SSO.' }, input_tokens: 100, cost_usd_micros: 400, created_at: createdAt });
    const [oldRun, newRun] = [run(monthsAgo(7)), run(monthsAgo(5))];
    await db.insert(ai_runs).values([oldRun, newRun]);
    await db.insert(idempotency_keys).values([
      { workspace_id: workspaceId, principal_id: 'key_x', key: 'old', request_hash: Buffer.from('h'), created_at: new Date(Date.now() - 2 * 86_400_000) },
      { workspace_id: workspaceId, principal_id: 'key_x', key: 'new', request_hash: Buffer.from('h') },
    ]);

    const result = await runRetention(db, { storage }, new Date());
    assert.deepEqual([result.rawMessages, result.attachments, result.trackingEvents, result.aiOutputs, result.idempotencyKeys], [1, 1, 1, 1, 1]);

    const [oldEmail] = await db.select().from(messages).where(eq(messages.id, old.id));
    assert.deepEqual([oldEmail!.raw_storage_key, oldEmail!.body_text, oldEmail!.has_attachments], [null, 'Parsed text', true], 'the parsed text stays');
    await assert.rejects(storage.get(old.key), ObjectNotFound);
    await assert.rejects(storage.get(`${old.key}.pdf`), ObjectNotFound);
    assert.ok(await storage.get(recent.key));
    assert.equal((await db.select().from(attachments).where(eq(attachments.message_id, recent.id))).length, 1);
    assert.equal((await db.select().from(tracking_events)).length, 1);
    const runs = await db.select().from(ai_runs);
    assert.deepEqual(runs.map((row) => [row.id === oldRun.id ? 'old' : 'new', row.output === null, row.cost_usd_micros]).sort(), [['new', false, 400], ['old', true, 400]], 'metrics stay');
    assert.deepEqual((await db.select().from(idempotency_keys)).map((row) => row.key), ['new']);

    assert.deepEqual(Object.values(await runRetention(db, { storage }, new Date())).slice(0, 5), [0, 0, 0, 0, 0], 'nothing twice');
  });
});
