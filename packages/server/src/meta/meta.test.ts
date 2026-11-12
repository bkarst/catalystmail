import assert from 'node:assert/strict';

import { imports, mailboxes, messages, newId, poll_runs, sending_domains, type Db } from '@catalyst/db';
import { createTestDatabase } from '@catalyst/db/testing';
import { MemoryQueue } from '@catalyst/jobs';
import { MemoryStorage } from '@catalyst/storage';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { route } from '../api/handlers.ts';
import { call, seedApiKey, seedWorkspace } from '../api/testing.ts';
import { setDb, setDeps } from '../runtime.ts';

// Needs a PostgreSQL server: set TEST_DATABASE_URL to any database on it.
const adminUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!adminUrl)('jobs and raw email (§13.3, §13.4)', () => {
  let db: Db;
  let drop: () => Promise<void>;
  let workspaceId: string;
  let key: string;
  let otherKey: string;
  let mailboxId: string;
  const storage = new MemoryStorage();

  beforeAll(async () => {
    ({ db, drop } = await createTestDatabase(adminUrl!));
    setDb(db);
    setDeps({ jobs: new MemoryQueue(), storage, config: { trackingTarget: null, appHost: null } });
    workspaceId = await seedWorkspace(db, 'Acme');
    ({ secret: key } = await seedApiKey(db, workspaceId, ['threads:read']));
    ({ secret: otherKey } = await seedApiKey(db, await seedWorkspace(db, 'Other'), ['threads:read']));
    const domainId = newId('domain');
    await db.insert(sending_domains).values({ id: domainId, workspace_id: workspaceId, domain: 'getacme.com' });
    mailboxId = newId('mailbox');
    await db.insert(mailboxes).values({ id: mailboxId, workspace_id: workspaceId, sending_domain_id: domainId, email: 'alex@getacme.com', display_name: 'Alex', auth: 'password', status: 'active', smtp_host: 's', smtp_port: 465, smtp_secure: 'tls', smtp_username: 'a', imap_host: 'i', imap_username: 'a', credentials_enc: Buffer.from('x'), credentials_key_version: 1, folders: {} });
  });
  afterAll(async () => {
    setDb(undefined);
    setDeps(undefined);
    await drop?.();
  });

  it('reports an import’s and a poll’s progress the same way, to their own workspace only', async () => {
    const importId = newId('import');
    await db.insert(imports).values({ id: importId, workspace_id: workspaceId, filename: 'leads.csv', storage_key: 'imports/x.csv', status: 'processing', total_rows: 4800, processed_rows: 1200 });
    const job = await call('GET', `/jobs/${importId}`, { key });
    assert.equal(job.status, 200, JSON.stringify(job.body));
    assert.deepEqual([job.body.kind, job.body.status, job.body.progress], ['import', 'running', { done: 1200, total: 4800 }]);
    const runId = newId('poll_run');
    await db.insert(poll_runs).values({ id: runId, mailbox_id: mailboxId, trigger: 'manual', status: 'error', started_at: new Date(), finished_at: new Date(), error: 'auth failed' });
    const poll = await call('GET', `/jobs/${runId}`, { key });
    assert.deepEqual([poll.body.kind, poll.body.status, poll.body.error], ['mailbox_poll', 'failed', 'auth failed']);
    assert.equal((await call('GET', `/jobs/${importId}`, { key: otherKey })).status, 404);
    assert.equal((await call('GET', '/jobs/thr_01jd3x5k8qf7tb9w2m4n6p8r0s', { key })).status, 400, 'not a job ID');
  });

  it('downloads the exact MIME source, or 404 when none was kept', async () => {
    const sent = newId('message');
    const raw = 'From: alex@getacme.com\r\nSubject: Hi\r\n\r\nHello';
    await storage.put(`raw/${workspaceId}/${sent}.eml`, Buffer.from(raw), 'message/rfc822');
    await db.insert(messages).values({ id: sent, workspace_id: workspaceId, mailbox_id: mailboxId, direction: 'outbound', status: 'sent', author: 'template', message_id_header: '<s@x>', from_email: 'alex@getacme.com', to_emails: [], subject: 'Hi', raw_storage_key: `raw/${workspaceId}/${sent}.eml` });
    const response = await route('getMessageRaw')(new Request(`http://catalyst.test/api/v1/messages/${sent}/raw`, { headers: { authorization: `Bearer ${key}` } }), { params: Promise.resolve({ messageId: sent }) });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'message/rfc822');
    assert.match(response.headers.get('content-disposition')!, new RegExp(`${sent}\\.eml`));
    assert.equal(await response.text(), raw);

    const draft = newId('message');
    await db.insert(messages).values({ id: draft, workspace_id: workspaceId, mailbox_id: mailboxId, direction: 'outbound', status: 'draft', author: 'human_app', message_id_header: '<d@x>', from_email: 'alex@getacme.com', to_emails: [], subject: 'Hi' });
    const missing = await route('getMessageRaw')(new Request(`http://catalyst.test/api/v1/messages/${draft}/raw`, { headers: { authorization: `Bearer ${key}` } }), { params: Promise.resolve({ messageId: draft }) });
    assert.equal(missing.status, 404);
    const foreign = await route('getMessageRaw')(new Request(`http://catalyst.test/api/v1/messages/${sent}/raw`, { headers: { authorization: `Bearer ${otherKey}` } }), { params: Promise.resolve({ messageId: sent }) });
    assert.equal(foreign.status, 404);
  });
});
