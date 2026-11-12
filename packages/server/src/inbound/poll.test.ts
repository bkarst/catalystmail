import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { campaign_mailboxes, contacts, mailbox_sync_state, mailboxes, messages, newId, poll_runs, sending_domains, threads, type Db } from '@catalyst/db';
import { createTestDatabase } from '@catalyst/db/testing';
import { imapflowConnector, type SmtpTransport } from '@catalyst/email';
import { MemoryQueue } from '@catalyst/jobs';
import { MemoryStorage } from '@catalyst/storage';
import { eq } from 'drizzle-orm';
import hoodiecrow from 'hoodiecrow-imap';
import { ImapFlow } from 'imapflow';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { call, seedApiKey, seedWorkspace } from '../api/testing.ts';
import { schedulerTick } from '../outbound/scheduler.ts';
import { sendMessage } from '../outbound/send.ts';
import { setDb, setDeps } from '../runtime.ts';
import { createSecretBox, parseEncryptionKeys } from '../secrets.ts';
import { evaluateThread } from '../threads/evaluate.ts';
import { pollMailbox } from './poll.ts';

// Needs a PostgreSQL server: set TEST_DATABASE_URL to any database on it.
const adminUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!adminUrl)('polling a mailbox over IMAP (§7.3, IT-03, IT-09, IT-11, IT-19, IT-20)', () => {
  let db: Db;
  let drop: () => Promise<void>;
  let server: ReturnType<typeof hoodiecrow>;
  let port: number;
  const jobs = new MemoryQueue();
  const storage = new MemoryStorage();
  const secrets = createSecretBox(parseEncryptionKeys(`1:${randomBytes(32).toString('base64')}`));
  const smtp: SmtpTransport = { submit: async () => ({ kind: 'accepted', response: '250 OK' }), verify: async () => {}, close: async () => {} };
  const deps = (now: Date) => ({ imap: imapflowConnector({ allowPlaintext: true }), secrets, jobs, storage, now: () => now });
  let mailboxId: string;
  let threadId: string;
  let sentHeader: string;

  /** Puts a message on the IMAP server, as mail arriving or as the user's own client saving to Sent. */
  async function deliver(folder: string, raw: string): Promise<void> {
    const client = new ImapFlow({ host: '127.0.0.1', port, secure: false, doSTARTTLS: false, auth: { user: 'testuser', pass: 'testpass' }, logger: false });
    await client.connect();
    await client.append(folder, Buffer.from(raw), []);
    await client.logout();
  }

  beforeAll(async () => {
    server = hoodiecrow({
      plugins: ['id', 'sasl-ir', 'auth-plain', 'namespace', 'enable', 'condstore', 'literalplus', 'unselect', 'special-use', 'uidplus'],
      storage: { INBOX: { messages: [] }, '': { separator: '/', folders: { Sent: { 'special-use': '\\Sent', messages: [] }, Junk: { 'special-use': '\\Junk', messages: [] } } } },
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.server.address().port;

    ({ db, drop } = await createTestDatabase(adminUrl!));
    setDb(db);
    setDeps({ jobs, storage, secrets, config: { trackingTarget: null, appHost: null, trackingSecret: 'secret' } });
    const workspaceId = await seedWorkspace(db, 'Acme');
    const { secret: key } = await seedApiKey(db, workspaceId, ['campaigns:read', 'campaigns:write']);
    const domainId = newId('domain');
    await db.insert(sending_domains).values({ id: domainId, workspace_id: workspaceId, domain: 'getacme.com' });
    mailboxId = newId('mailbox');
    await db.insert(mailboxes).values({
      id: mailboxId, workspace_id: workspaceId, sending_domain_id: domainId, email: 'alex@getacme.com', display_name: 'Alex Rivera', auth: 'password', status: 'active', warmup_step: 10,
      smtp_host: 'smtp.gmail.com', smtp_port: 465, smtp_secure: 'tls', smtp_username: 'alex', imap_host: '127.0.0.1', imap_port: port, imap_username: 'testuser',
      credentials_enc: secrets.seal(JSON.stringify({ password: 'testpass' })), credentials_key_version: 1, folders: {},
    });
    const created = await call('POST', '/campaigns', { key, body: { name: 'Q4', objective: 'Calls.', goals: [{ key: 'call', name: 'Call booked', success_criteria: 'Books.', playbook: 'Offer a call.' }], initial_email: { subject_template: 'Quick question', body_template: 'Hi {{ contact.first_name | default: "there" }}\n\n{{ sender.first_name }}' } } });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const campaign = created.body;
    await db.insert(campaign_mailboxes).values({ campaign_id: campaign.id, mailbox_id: mailboxId });
    await db.execute(`update campaigns set status = 'active' where id = '${campaign.id}'`);
    const contactId = newId('contact');
    await db.insert(contacts).values({ id: contactId, workspace_id: workspaceId, email: 'priya@globex.example', first_name: 'Priya', email_verification: 'valid', timezone: 'UTC' });
    threadId = (await call('POST', `/campaigns/${campaign.id}/enrollments`, { key, body: { contact_ids: [contactId] } })).body.created[0].thread_id;
    const monday = new Date();
    monday.setUTCHours(10, 0, 0, 0);
    while (monday.getUTCDay() !== 2 || monday < new Date()) monday.setUTCDate(monday.getUTCDate() + 1);
    await evaluateThread(db, threadId, { now: monday });
    // Without an unsubscribe host the compliance footer can't be written, and nothing would send.
    await schedulerTick(db, { jobs, rng: () => 0.5, trackingSecret: 'secret', appHost: 'catalyst.example.com' }, monday);
    const [initial] = await db.select().from(messages).where(eq(messages.thread_id, threadId));
    await sendMessage(db, initial!.id, { smtp, secrets, jobs, storage, rng: () => 0.5, now: () => initial!.scheduled_for! });
    sentHeader = (await db.select().from(messages).where(eq(messages.id, initial!.id)))[0]!.message_id_header;
  });
  afterAll(async () => {
    setDb(undefined);
    setDeps(undefined);
    await drop?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('stores the reply, ignores unrelated mail, picks up the operator’s own reply from Sent, and never stores anything twice', { timeout: 30_000 }, async () => {
    await deliver('INBOX', `From: Priya <priya@globex.example>\r\nTo: alex@getacme.com\r\nSubject: Re: Quick question\r\nMessage-ID: <reply.1@globex.example>\r\nIn-Reply-To: ${sentHeader}\r\n\r\nDo you support SSO?\r\n`);
    await deliver('INBOX', 'From: news@unrelated.example\r\nTo: alex@getacme.com\r\nSubject: Weekly digest\r\nMessage-ID: <news.1@unrelated.example>\r\n\r\nHello\r\n');
    await deliver('Sent', `From: Alex <alex@getacme.com>\r\nTo: priya@globex.example\r\nSubject: Re: Quick question\r\nMessage-ID: <own.1@getacme.com>\r\nIn-Reply-To: <reply.1@globex.example>\r\nReferences: ${sentHeader} <reply.1@globex.example>\r\n\r\nYes, SAML on Business.\r\n`);

    const now = new Date();
    const first = await pollMailbox(db, mailboxId, 'manual', deps(now));
    assert.deepEqual([first.status, first.fetched, first.matched, first.ignored], ['ok', 2, 2, 1]);
    const stored = await db.select().from(messages).where(eq(messages.thread_id, threadId));
    assert.deepEqual(stored.map((message) => [message.direction, message.author]).sort(), [['inbound', 'contact'], ['outbound', 'human_external'], ['outbound', 'template']]);
    assert.equal((await db.select().from(messages).where(eq(messages.message_id_header, '<news.1@unrelated.example>'))).length, 0, 'unrelated mail is never stored');
    await evaluateThread(db, threadId, { now });
    const [thread] = await db.select().from(threads).where(eq(threads.id, threadId));
    assert.deepEqual([thread!.stage, thread!.ai_paused], ['responded', true]);
    const [mailbox] = await db.select().from(mailboxes).where(eq(mailboxes.id, mailboxId));
    assert.deepEqual([mailbox!.last_poll_status, Boolean(mailbox!.next_poll_at)], ['ok', true]);
    assert.deepEqual((mailbox!.folders as object), {}, 'folders not set by the connection test are discovered each poll');

    const again = await pollMailbox(db, mailboxId, 'schedule', deps(now));
    assert.deepEqual([again.fetched, again.ignored], [0, 0], 'the second poll starts after the last UID');

    // The server renumbers the folder: it is re-read, and Message-ID dedupe keeps it clean (IT-11).
    await db.update(mailbox_sync_state).set({ uid_validity: 999 }).where(eq(mailbox_sync_state.mailbox_id, mailboxId));
    const resynced = await pollMailbox(db, mailboxId, 'schedule', deps(now));
    assert.equal(resynced.fetched, 0);
    assert.equal((await db.select().from(messages).where(eq(messages.thread_id, threadId))).length, 3);
    assert.equal((await db.select().from(poll_runs).where(eq(poll_runs.mailbox_id, mailboxId))).length, 3);
  });

  it('retries a failed poll after 1 and 5 minutes, puts the mailbox in error after two failed scheduled runs, and recovers (§7.3 step 4)', async () => {
    await db.update(mailboxes).set({ credentials_enc: secrets.seal(JSON.stringify({ password: 'wrong' })) }).where(eq(mailboxes.id, mailboxId));
    jobs.clear();
    const t0 = new Date(Date.now() + 3_600_000);
    const at = (minutes: number) => deps(new Date(t0.getTime() + minutes * 60_000));
    const first = await pollMailbox(db, mailboxId, 'schedule', deps(t0));
    assert.equal(first.status, 'error');
    assert.deepEqual(jobs.of('mail.poll'), [{ mailbox_id: mailboxId, trigger: 'schedule', attempt: 1, chain_started_at: t0.toISOString() }]);
    assert.equal(jobs.jobs[0]!.startAfter!.getTime(), t0.getTime() + 60_000);
    // Its two retries fail too: one failed run, so the mailbox stays active.
    assert.equal((await pollMailbox(db, mailboxId, 'schedule', at(1), { attempt: 1, chainStartedAt: t0 })).retryAt!.getTime(), t0.getTime() + 6 * 60_000);
    assert.equal((await pollMailbox(db, mailboxId, 'schedule', at(6), { attempt: 2, chainStartedAt: t0 })).retryAt, null);
    assert.equal((await db.select().from(mailboxes).where(eq(mailboxes.id, mailboxId)))[0]!.status, 'active', 'one failed run is not enough');

    // The next scheduled run fails all three tries: two in a row.
    const t1 = new Date(t0.getTime() + 30 * 60_000);
    await pollMailbox(db, mailboxId, 'schedule', at(30));
    await pollMailbox(db, mailboxId, 'schedule', at(31), { attempt: 1, chainStartedAt: t1 });
    assert.equal((await db.select().from(mailboxes).where(eq(mailboxes.id, mailboxId)))[0]!.status, 'active', 'not before its last try');
    await pollMailbox(db, mailboxId, 'schedule', at(36), { attempt: 2, chainStartedAt: t1 });
    const [mailbox] = await db.select().from(mailboxes).where(eq(mailboxes.id, mailboxId));
    assert.equal(mailbox!.status, 'error');
    assert.match(mailbox!.status_reason!, /Polling failed twice/);

    // Fixed credentials and a good poll put it back.
    await db.update(mailboxes).set({ credentials_enc: secrets.seal(JSON.stringify({ password: 'testpass' })) }).where(eq(mailboxes.id, mailboxId));
    assert.equal((await pollMailbox(db, mailboxId, 'manual', at(40))).status, 'ok');
    assert.equal((await db.select().from(mailboxes).where(eq(mailboxes.id, mailboxId)))[0]!.status, 'active');
  });
});
