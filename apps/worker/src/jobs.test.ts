import assert from 'node:assert/strict';

import { campaign_goals, campaign_steps, campaigns, contacts, mailboxes, newId, poll_runs, sending_domains, threads, workspaces, type Db } from '@catalyst/db';
import { createTestDatabase } from '@catalyst/db/testing';
import type { MailDns } from '@catalyst/email';
import { MemoryQueue, PgBossQueue } from '@catalyst/jobs';
import { MemoryStorage } from '@catalyst/storage';
import { createSecretBox, parseEncryptionKeys, type SecretBox } from '@catalyst/server';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { queuePolls, registerHandlers, SCHEDULES, type WorkerDeps } from './jobs.ts';

// Needs a PostgreSQL server: set TEST_DATABASE_URL to any database on it.
const adminUrl = process.env.TEST_DATABASE_URL;

const dns: MailDns = { resolveMx: async (domain) => [`mx.${domain}`], hasAddress: async () => false };

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() > deadline) return value;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

describe.skipIf(!adminUrl)('worker jobs through pg-boss (§4.4)', () => {
  let db: Db;
  let drop: () => Promise<void>;
  let queue: PgBossQueue;
  const workspaceId = newId('workspace');
  const logged: string[] = [];
  const secrets: SecretBox = createSecretBox(parseEncryptionKeys(`1:${randomBytes(32).toString('base64')}`));
  let deps: WorkerDeps;
  let domainId: string;

  async function newMailbox(status: 'pending' | 'active' | 'paused', lastPollAt: Date | null): Promise<string> {
    const id = newId('mailbox');
    await db.insert(mailboxes).values({
      id, workspace_id: workspaceId, sending_domain_id: domainId, email: `alex+${id.slice(-6)}@getacme.com`, display_name: 'Alex', auth: 'password', status, last_poll_at: lastPollAt,
      smtp_host: 'smtp.getacme.test', smtp_port: 465, smtp_secure: 'tls', smtp_username: 'alex', imap_host: 'imap.getacme.test', imap_port: 993, imap_username: 'alex',
      credentials_enc: secrets.seal(JSON.stringify({ password: 'secret' })), credentials_key_version: 1, folders: {},
    });
    return id;
  }

  beforeAll(async () => {
    const database = await createTestDatabase(adminUrl!);
    ({ db, drop } = database);
    queue = new PgBossQueue({ connectionString: database.url, role: 'worker' });
    await queue.start();
    deps = {
      db,
      dns,
      domainDns: { resolveTxt: async () => [], resolveMx: async () => [], resolveCname: async () => [] },
      blocklistDns: { resolve4: async () => [] },
      webhookNet: { resolve: async () => ['93.184.216.34'], post: async () => ({ status: 200, body: 'ok' }) },
      mailer: null,
      claude: null,
      oauth: null,
      jev: null,
      storage: new MemoryStorage(),
      jobs: queue,
      smtp: { submit: async () => ({ kind: 'accepted', response: '250' }), verify: async () => {}, close: async () => {} },
      imap: { connect: async () => Promise.reject(new Error('connect ECONNREFUSED imap.getacme.test:993')) },
      secrets,
      config: { trackingTarget: null, appHost: null },
      rng: Math.random,
      now: () => new Date(),
      log: (message, fields) => void logged.push(`${message} ${fields?.job}`),
    };
    await registerHandlers(queue.boss, deps);
    await db.insert(workspaces).values({ id: workspaceId, name: 'Acme', physical_address: '500 Howard St' });
    domainId = newId('domain');
    await db.insert(sending_domains).values({ id: domainId, workspace_id: workspaceId, domain: 'getacme.com' });
  });
  afterAll(async () => {
    await queue?.stop({ graceful: false });
    await drop?.();
  });

  it('verifies a new contact in the background', async () => {
    const contactId = newId('contact');
    await db.insert(contacts).values({ id: contactId, workspace_id: workspaceId, email: 'priya@globex.com' });
    await queue.enqueue('contact.verify', { contact_id: contactId });
    const row = await until(
      async () => (await db.select().from(contacts).where(eq(contacts.id, contactId)))[0]!,
      (contact) => contact.email_verification !== 'unverified',
    );
    assert.equal(row.email_verification, 'valid');
    assert.ok(logged.includes('job done contact.verify'));
  });

  it('stops a deleted contact’s thread when its evaluation job runs', async () => {
    const campaignId = newId('campaign');
    await db.insert(campaigns).values({
      id: campaignId,
      workspace_id: workspaceId,
      name: 'Q4',
      objective: 'Calls',
      status: 'active',
      persona: {},
      sending_window: { days: [1, 2, 3, 4, 5], start: '08:30', end: '17:30', tz: 'contact', fallback_tz: 'UTC' },
    });
    await db.insert(campaign_goals).values({ id: newId('goal'), campaign_id: campaignId, position: 1, key: 'call', name: 'Call', success_criteria: 'Booked', playbook: 'Ask' });
    await db.insert(campaign_steps).values({ id: newId('step'), campaign_id: campaignId, position: 1 });
    const contactId = newId('contact');
    await db.insert(contacts).values({ id: contactId, workspace_id: workspaceId, email: 'gone@globex.com', deleted_at: new Date() });
    const threadId = newId('thread');
    await db.insert(threads).values({ id: threadId, workspace_id: workspaceId, campaign_id: campaignId, contact_id: contactId });

    await queue.enqueue('thread.evaluate', { thread_id: threadId }, { startAfter: new Date() });
    const thread = await until(
      async () => (await db.select().from(threads).where(eq(threads.id, threadId)))[0]!,
      (row) => row.state !== 'active',
    );
    assert.deepEqual([thread.state, thread.state_reason, thread.next_action_type], ['stopped', 'contact_deleted', 'none']);
  });

  it('polls a mailbox from the queue, recording a failed poll and queuing its retry (§7.3)', async () => {
    const mailboxId = await newMailbox('active', null);
    await queue.enqueue('mail.poll', { mailbox_id: mailboxId, trigger: 'manual' });
    const [run] = await until(
      () => db.select().from(poll_runs).where(eq(poll_runs.mailbox_id, mailboxId)),
      (rows) => rows.some((row) => row.status !== 'running'),
    );
    assert.equal(run!.status, 'error');
    assert.match(run!.error!, /ECONNREFUSED/);
    assert.equal((await db.select().from(mailboxes).where(eq(mailboxes.id, mailboxId)))[0]!.last_poll_status, 'error');
  });

  it('queues polls every 30 minutes with jitter, and catch-up polls on start for mailboxes not polled for 30 minutes (§4.4, IT-13)', async () => {
    assert.ok(SCHEDULES.some((schedule) => schedule.name === 'mail.poll.all' && schedule.cron === '*/30 * * * *'));
    await db.delete(poll_runs);
    await db.delete(mailboxes);
    const now = new Date('2026-11-11T10:00:00Z');
    const stale = await newMailbox('active', new Date(now.getTime() - 2 * 3_600_000));
    const fresh = await newMailbox('active', new Date(now.getTime() - 5 * 60_000));
    const never = await newMailbox('paused', null);
    await newMailbox('pending', null);
    const jobs = new MemoryQueue();
    const local = { ...deps, jobs, now: () => now, rng: () => 0.5 };

    assert.equal(await queuePolls(local, 'catch_up'), 2);
    assert.deepEqual(new Set(jobs.of('mail.poll').map((job) => job.mailbox_id)), new Set([stale, never]));
    assert.ok(jobs.jobs.every((job) => job.startAfter?.getTime() === now.getTime() && (job.data as { trigger: string }).trigger === 'catch_up'));

    jobs.clear();
    assert.equal(await queuePolls(local, 'schedule'), 3);
    assert.deepEqual(new Set(jobs.of('mail.poll').map((job) => job.mailbox_id)), new Set([stale, fresh, never]));
    assert.ok(jobs.jobs.every((job) => job.startAfter?.getTime() === now.getTime() + 60_000), 'half of the 2-minute jitter');
  });
});
