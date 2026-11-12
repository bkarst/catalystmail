import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { activities, mailboxes, newId, poll_runs, sending_domains, type Db } from '@catalyst/db';
import { createTestDatabase } from '@catalyst/db/testing';
import { imapflowConnector, type SmtpTransport } from '@catalyst/email';
import { MemoryQueue } from '@catalyst/jobs';
import { MemoryStorage } from '@catalyst/storage';
import { and, eq } from 'drizzle-orm';
import hoodiecrow from 'hoodiecrow-imap';
import { ImapFlow } from 'imapflow';
import { afterAll, beforeAll, describe, it } from 'vitest';

import type { Principal } from '../api/auth.ts';
import { call, seedApiKey, seedWorkspace } from '../api/testing.ts';
import { setDb, setDeps } from '../runtime.ts';
import { createSecretBox, parseEncryptionKeys } from '../secrets.ts';
import { testMailboxConnection } from './connection-test.ts';

// Needs a PostgreSQL server: set TEST_DATABASE_URL to any database on it.
const adminUrl = process.env.TEST_DATABASE_URL;

const GMAIL_RESULTS = 'mx.google.com; dkim=pass header.i=@getacme.com header.s=google; spf=pass smtp.mailfrom=alex@getacme.com; dmarc=pass (p=QUARANTINE) header.from=getacme.com';

describe.skipIf(!adminUrl)('the mailbox connection test (§7.1, IT-01)', () => {
  let db: Db;
  let drop: () => Promise<void>;
  let server: ReturnType<typeof hoodiecrow>;
  let port: number;
  let workspaceId: string;
  let domainId: string;
  let key: string;
  let otherKey: string;
  const jobs = new MemoryQueue();
  const storage = new MemoryStorage();
  const secrets = createSecretBox(parseEncryptionKeys(`1:${randomBytes(32).toString('base64')}`));
  const imap = imapflowConnector({ allowPlaintext: true });

  /** How the fake provider behaves: whether SMTP sign-in works, where a sent message shows up, and what its receiver says about authentication. */
  let provider: { verify: boolean; deliverTo: string[]; authResults: string | null };
  const smtp: SmtpTransport = {
    verify: async () => {
      if (!provider.verify) throw new Error('535-5.7.8 Username and Password not accepted');
    },
    submit: async (_account, _envelope, raw) => {
      for (const folder of provider.deliverTo) {
        const stamped = folder !== 'Sent' && provider.authResults ? Buffer.concat([Buffer.from(`Authentication-Results: ${provider.authResults}\r\n`), raw]) : raw;
        await withClient((client) => client.append(folder, stamped, []));
      }
      return { kind: 'accepted', response: '250 2.0.0 OK' };
    },
    close: async () => {},
  };

  async function withClient<T>(run: (client: ImapFlow) => Promise<T>): Promise<T> {
    const client = new ImapFlow({ host: '127.0.0.1', port, secure: false, doSTARTTLS: false, auth: { user: 'testuser', pass: 'testpass' }, logger: false });
    await client.connect();
    try {
      return await run(client);
    } finally {
      await client.logout();
    }
  }
  const countIn = (folder: string) => withClient(async (client) => {
    const status = await client.status(folder, { messages: true });
    return status ? (status.messages ?? 0) : 0;
  });

  async function newMailbox(status: 'pending' | 'active' = 'pending', password = 'testpass'): Promise<string> {
    const id = newId('mailbox');
    await db.insert(mailboxes).values({
      id, workspace_id: workspaceId, sending_domain_id: domainId, email: `alex+${id.slice(-6)}@getacme.com`, display_name: 'Alex Rivera', auth: 'password', status,
      smtp_host: 'smtp.getacme.test', smtp_port: 465, smtp_secure: 'tls', smtp_username: 'alex', imap_host: '127.0.0.1', imap_port: port, imap_username: 'testuser',
      credentials_enc: secrets.seal(JSON.stringify({ password })), credentials_key_version: 1, folders: {},
    });
    return id;
  }
  const principal = (): Principal => ({ kind: 'api_key', id: 'key_test', name: 'Test', role: null, scopes: ['mailboxes:write'], workspace: { id: workspaceId, name: 'Acme' } });
  const fast = { smtp, imap, secrets, sleep: async () => {}, receiveTimeoutMs: 0 };

  beforeAll(async () => {
    server = hoodiecrow({
      plugins: ['id', 'sasl-ir', 'auth-plain', 'namespace', 'enable', 'condstore', 'literalplus', 'unselect', 'special-use', 'uidplus'],
      storage: { INBOX: { messages: [] }, '': { separator: '/', folders: { Sent: { 'special-use': '\\Sent', messages: [] }, Junk: { 'special-use': '\\Junk', messages: [] } } } },
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.server.address().port;
    ({ db, drop } = await createTestDatabase(adminUrl!));
    setDb(db);
    setDeps({ jobs, storage, secrets, smtp, imap, config: { trackingTarget: null, appHost: null, trackingSecret: 'secret' } });
    workspaceId = await seedWorkspace(db, 'Acme');
    ({ secret: key } = await seedApiKey(db, workspaceId, ['mailboxes:read', 'mailboxes:write']));
    ({ secret: otherKey } = await seedApiKey(db, await seedWorkspace(db, 'Other'), ['mailboxes:read', 'mailboxes:write']));
    domainId = newId('domain');
    await db.insert(sending_domains).values({ id: domainId, workspace_id: workspaceId, domain: 'getacme.com' });
  });

  afterAll(async () => {
    setDb(undefined);
    setDeps(undefined);
    await drop?.();
    server?.close();
  });

  it('passes, activates the mailbox, stores its folders and alignment, and deletes the test email', { timeout: 30_000 }, async () => {
    provider = { verify: true, deliverTo: ['INBOX', 'Sent'], authResults: GMAIL_RESULTS };
    const mailboxId = await newMailbox();
    const result = await testMailboxConnection(db, principal(), mailboxId, fast);
    assert.deepEqual(
      result.steps.map((step) => [step.step, step.status]),
      [['smtp_auth', 'pass'], ['imap_auth', 'pass'], ['folders', 'pass'], ['send', 'pass'], ['receive', 'pass'], ['sent_copy', 'pass'], ['cleanup', 'pass']],
    );
    assert.equal(result.passed, true);
    assert.equal(result.mailbox.status, 'active');
    assert.match(result.steps[4]!.detail!, /SPF pass, DKIM pass, DMARC pass \(aligned\)/);
    const [row] = await db.select().from(mailboxes).where(eq(mailboxes.id, mailboxId));
    assert.deepEqual(row!.folders, { inbox: 'INBOX', sent: 'Sent', junk: 'Junk' });
    assert.equal(row!.append_to_sent, false);
    assert.equal((await db.select().from(sending_domains).where(eq(sending_domains.id, domainId)))[0]!.alignment_status, 'aligned');
    assert.equal(await countIn('INBOX'), 0, 'the test email is deleted from INBOX');
    assert.equal(await countIn('Sent'), 0, 'and from Sent');
    const [activity] = await db.select().from(activities).where(and(eq(activities.workspace_id, workspaceId), eq(activities.type, 'mailbox.connection_tested')));
    assert.deepEqual(activity!.data, { mailbox_id: mailboxId, passed: true, failed_steps: [], activated: true });
  });

  it('turns on append_to_sent when the provider keeps no copy, and warns when no results came back', async () => {
    provider = { verify: true, deliverTo: ['INBOX'], authResults: null };
    const mailboxId = await newMailbox();
    const result = await testMailboxConnection(db, principal(), mailboxId, fast);
    assert.equal(result.passed, true);
    assert.equal(result.steps.find((step) => step.step === 'receive')!.status, 'warn');
    assert.match(result.steps.find((step) => step.step === 'sent_copy')!.detail!, /Catalyst will save one/);
    assert.equal((await db.select().from(mailboxes).where(eq(mailboxes.id, mailboxId)))[0]!.append_to_sent, true);
    assert.equal(await countIn('INBOX'), 0);
  });

  it('fails on a DMARC failure, and warns when the email lands in Junk', async () => {
    provider = { verify: true, deliverTo: ['INBOX', 'Sent'], authResults: 'mx.example; spf=fail smtp.mailfrom=getacme.com; dkim=none; dmarc=fail header.from=getacme.com' };
    const failing = await testMailboxConnection(db, principal(), await newMailbox(), fast);
    assert.equal(failing.passed, false);
    assert.equal(failing.mailbox.status, 'pending');
    assert.match(failing.mailbox.status_reason!, /Connection test failed at receive: .*DMARC failed/);
    assert.equal((await db.select().from(sending_domains).where(eq(sending_domains.id, domainId)))[0]!.alignment_status, 'not_aligned');

    provider = { verify: true, deliverTo: ['Junk', 'Sent'], authResults: GMAIL_RESULTS };
    const junked = await testMailboxConnection(db, principal(), await newMailbox(), fast);
    assert.equal(junked.passed, true);
    assert.equal(junked.steps.find((step) => step.step === 'receive')!.status, 'warn');
    assert.match(junked.steps.find((step) => step.step === 'receive')!.detail!, /arrived in Junk, not INBOX/);
    assert.equal(await countIn('Junk'), 0, 'deleted from Junk too');
  });

  it('reports SMTP and IMAP sign-in failures together and skips what depends on them', async () => {
    provider = { verify: false, deliverTo: ['INBOX'], authResults: null };
    const smtpDown = await testMailboxConnection(db, principal(), await newMailbox(), fast);
    assert.deepEqual(
      smtpDown.steps.map((step) => [step.step, step.status]),
      [['smtp_auth', 'fail'], ['imap_auth', 'pass'], ['folders', 'pass'], ['send', 'skipped'], ['receive', 'skipped'], ['sent_copy', 'skipped'], ['cleanup', 'skipped']],
    );
    assert.match(smtpDown.steps[0]!.detail!, /Username and Password not accepted/);
    assert.equal(smtpDown.mailbox.status, 'pending');

    provider = { verify: true, deliverTo: ['INBOX'], authResults: null };
    const imapDown = await testMailboxConnection(db, principal(), await newMailbox('pending', 'wrong'), fast);
    assert.deepEqual(imapDown.steps.slice(0, 4).map((step) => [step.step, step.status]), [['smtp_auth', 'pass'], ['imap_auth', 'fail'], ['folders', 'skipped'], ['send', 'skipped']]);
  });

  it('fails when the email never arrives, and leaves an active mailbox active', async () => {
    provider = { verify: true, deliverTo: [], authResults: null };
    let waited = 0;
    const result = await testMailboxConnection(db, principal(), await newMailbox('active'), { ...fast, receiveTimeoutMs: 120_000, sleep: async (ms) => void (waited += ms), now: () => new Date(Date.now() + waited) });
    assert.equal(result.passed, false);
    assert.match(result.steps.find((step) => step.step === 'receive')!.detail!, /did not arrive in INBOX within 120 s/);
    assert.ok(waited >= 120_000);
    assert.equal(result.mailbox.status, 'active');
  });

  it('runs over the API, and another workspace gets 404', async () => {
    provider = { verify: true, deliverTo: ['INBOX', 'Sent'], authResults: GMAIL_RESULTS };
    const mailboxId = await newMailbox();
    const response = await call('POST', `/mailboxes/${mailboxId}/test`, { key });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.passed, true);
    assert.equal(response.body.mailbox.status, 'active');
    assert.equal((await call('POST', `/mailboxes/${mailboxId}/test`, { key: otherKey })).status, 404);
    const domain = await call('GET', `/domains/${domainId}`, { key });
    assert.equal(domain.body.alignment_status, 'aligned');
  });

  it('queues a poll now; 409 while one runs or before the mailbox is connected; 404 for another workspace (§7.3)', async () => {
    const pending = await newMailbox();
    assert.equal((await call('POST', `/mailboxes/${pending}/poll`, { key })).status, 409);

    const mailboxId = await newMailbox('active');
    jobs.clear();
    const queued = await call('POST', `/mailboxes/${mailboxId}/poll`, { key });
    assert.equal(queued.status, 202, JSON.stringify(queued.body));
    assert.equal(queued.body.mailbox_id, mailboxId);
    assert.equal(queued.body.last_poll_at, null);
    assert.deepEqual(jobs.of('mail.poll'), [{ mailbox_id: mailboxId, trigger: 'api' }]);

    await db.insert(poll_runs).values({ id: newId('poll_run'), mailbox_id: mailboxId, trigger: 'schedule', status: 'running', started_at: new Date() });
    const busy = await call('POST', `/mailboxes/${mailboxId}/poll`, { key });
    assert.equal(busy.status, 409);
    assert.equal(busy.body.code, 'poll_in_progress');
    assert.equal((await call('POST', `/mailboxes/${mailboxId}/poll`, { key: otherKey })).status, 404);
  });
});
