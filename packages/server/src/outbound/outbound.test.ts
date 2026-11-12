import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { intlZoneCalendar } from '@catalyst/core';
import { campaign_mailboxes, contacts, escalations, mailboxes, messages, newId, sending_domains, suppressions, threads, type Db } from '@catalyst/db';
import { createTestDatabase } from '@catalyst/db/testing';
import type { ImapConnector, SmtpTransport, SubmitResult } from '@catalyst/email';
import { MemoryQueue } from '@catalyst/jobs';
import { MemoryStorage } from '@catalyst/storage';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

import { call, seedApiKey, seedWorkspace } from '../api/testing.ts';
import { setDb, setDeps } from '../runtime.ts';
import { createSecretBox, parseEncryptionKeys } from '../secrets.ts';
import { evaluateThread } from '../threads/evaluate.ts';
import { schedulerTick } from './scheduler.ts';
import { sendMessage, sweepStuckSends } from './send.ts';
import { appendToSent, reconcileUnknownSend } from './sent-folder.ts';

// Needs a PostgreSQL server: set TEST_DATABASE_URL to any database on it.
const adminUrl = process.env.TEST_DATABASE_URL;

/** The first Tuesday after today (rows are stamped with the real clock, so the fake one must be later). */
const BASE = (() => {
  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);
  do day.setUTCDate(day.getUTCDate() + 1);
  while (day.getUTCDay() !== 2);
  return day;
})();
/** That Tuesday plus `days`, at `hour`:`minute` UTC. */
const at = (days: number, hour = 10, minute = 0) => new Date(BASE.getTime() + days * 86_400_000 + hour * 3_600_000 + minute * 60_000);

/** A seeded RNG, so jitter is the same every run. */
function seeded(seed = 7): () => number {
  let state = seed;
  return () => ((state = (state * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648);
}

describe.skipIf(!adminUrl)('the send path: scheduler, compose, pre-send guard and SMTP (§7.2, IT-01, IT-16, IT-30)', () => {
  let db: Db;
  let drop: () => Promise<void>;
  let workspaceId: string;
  let key: string;
  const jobs = new MemoryQueue();
  const storage = new MemoryStorage();
  const secrets = createSecretBox(parseEncryptionKeys(`1:${randomBytes(32).toString('base64')}`));
  const submitted: { to: string; raw: string }[] = [];
  let answer: SubmitResult | null = null;
  const smtp: SmtpTransport = {
    async submit(_account, envelope, raw) {
      submitted.push({ to: envelope.to, raw: raw.toString() });
      return answer ?? { kind: 'accepted', response: '250 2.0.0 OK' };
    },
    async verify() {},
    async close() {},
  };
  const tickDeps = () => ({ jobs, rng: seeded(), trackingSecret: 'tracking-secret', appHost: 'catalyst.example.com' });
  const sendDeps = (now: Date) => ({ smtp, secrets, jobs, storage, rng: seeded(), now: () => now });
  const post = (path: string, body: unknown) => call('POST', path, { key, body });

  /** A mailbox on its own new sending domain, so tests don't share a domain's ramp. */
  async function mailbox(email: string, extra: Partial<typeof mailboxes.$inferInsert> = {}) {
    const domain = email.slice(email.indexOf('@') + 1);
    const domainId = newId('domain');
    await db.insert(sending_domains).values({ id: domainId, workspace_id: workspaceId, domain, tracking_host: `go.${domain}` });
    const id = newId('mailbox');
    await db.insert(mailboxes).values({
      id, workspace_id: workspaceId, sending_domain_id: domainId, email, display_name: 'Alex Rivera', signature_text: 'Alex Rivera\nAcme', auth: 'password', status: 'active',
      smtp_host: 'smtp.gmail.com', smtp_port: 465, smtp_secure: 'tls', smtp_username: email, imap_host: 'imap.gmail.com', imap_username: email,
      credentials_enc: secrets.seal(JSON.stringify({ password: 'app-password' })), credentials_key_version: 1, folders: {}, min_interval_sec: 120, max_interval_sec: 420, ...extra,
    });
    return id;
  }

  /** A launched campaign on the given mailboxes, with `count` contacts enrolled and evaluated. */
  async function campaignWith(mailboxIds: string[], count: number, emails = (index: number) => `p${index}.${newId('contact').slice(-6)}@prospect${index}.example`) {
    const campaign = (
      await post('/campaigns', {
        name: `Campaign ${newId('campaign').slice(-4)}`,
        objective: 'Book calls.',
        goals: [{ key: 'call', name: 'Call booked', success_criteria: 'Books.', playbook: 'Offer a call.' }],
        initial_email: { subject_template: 'Quick question about {{ company.name | default: "your team" }}', body_template: 'Hi {{ contact.first_name | default: "there" }},\n\nHow does onboarding work for you today?\n\n{{ sender.first_name }}' },
      })
    ).body;
    await db.insert(campaign_mailboxes).values(mailboxIds.map((mailbox_id) => ({ campaign_id: campaign.id, mailbox_id })));
    await db.execute(`update campaigns set status = 'active', launched_at = now() where id = '${campaign.id}'`);
    const ids: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const id = newId('contact');
      await db.insert(contacts).values({ id, workspace_id: workspaceId, email: emails(index), first_name: `P${index}`, email_verification: 'valid', timezone: 'UTC' });
      ids.push(id);
    }
    const enrolled = (await post(`/campaigns/${campaign.id}/enrollments`, { contact_ids: ids })).body;
    for (const entry of enrolled.created) await evaluateThread(db, entry.thread_id, { now: at(0, 9) });
    return { campaignId: campaign.id as string, threadIds: enrolled.created.map((entry: { thread_id: string }) => entry.thread_id) as string[] };
  }

  const threadRow = async (threadId: string) => (await db.select().from(threads).where(eq(threads.id, threadId)))[0]!;
  const messageRows = async (threadId: string) => db.select().from(messages).where(eq(messages.thread_id, threadId)).orderBy(messages.created_at);
  const header = (raw: string, name: string) => new RegExp(`^${name}: (.*)$`, 'im').exec(raw.slice(0, raw.indexOf('\r\n\r\n')).replace(/\r\n[ \t]+/g, ' '))?.[1];

  beforeAll(async () => {
    ({ db, drop } = await createTestDatabase(adminUrl!));
    setDb(db);
    setDeps({ jobs, storage, secrets, config: { trackingTarget: 'catalyst.example.com', appHost: 'catalyst.example.com', trackingSecret: 'tracking-secret' } });
    workspaceId = await seedWorkspace(db, 'Acme');
    ({ secret: key } = await seedApiKey(db, workspaceId, ['campaigns:read', 'campaigns:write', 'contacts:read', 'contacts:write']));
  });
  beforeEach(() => {
    submitted.length = 0;
    answer = null;
    jobs.clear();
  });
  afterAll(async () => {
    setDb(undefined);
    setDeps(undefined);
    await drop?.();
  });

  it('enrolls, schedules inside the window, sends a conformant email, and moves the thread to Sent then Received (IT-01, IT-02, §19.5)', async () => {
    const mailboxId = await mailbox('alex@getacme.com', { warmup_step: 10 });
    const { threadIds } = await campaignWith([mailboxId], 1, () => 'priya@globex.example');
    const [threadId] = threadIds as [string];

    const tick = await schedulerTick(db, tickDeps(), at(0));
    assert.equal(tick.composed, 1);
    const [scheduled] = await messageRows(threadId);
    assert.equal(scheduled!.status, 'scheduled');
    assert.ok(scheduled!.scheduled_for! >= at(0) && scheduled!.scheduled_for! < at(0, 17, 30));
    assert.notEqual(scheduled!.scheduled_for!.getUTCSeconds() + scheduled!.scheduled_for!.getUTCMilliseconds(), 0, 'never on an exact minute');
    assert.deepEqual(jobs.of('outbound.send'), [{ message_id: scheduled!.id }]);
    assert.equal((await schedulerTick(db, tickDeps(), at(0))).composed, 0, 'a composed email is not composed twice');

    assert.deepEqual(await sendMessage(db, scheduled!.id, sendDeps(scheduled!.scheduled_for!)), { outcome: 'sent' });
    assert.equal(submitted.length, 1);
    const raw = submitted[0]!.raw;
    assert.equal(header(raw, 'To'), 'priya@globex.example');
    assert.equal(header(raw, 'From'), 'Alex Rivera <alex@getacme.com>');
    assert.match(header(raw, 'Message-ID')!, /^<[0-9a-z]{26}\.[0-9a-f]{12}@getacme\.com>$/);
    assert.equal(header(raw, 'Subject'), 'Quick question about your team');
    assert.match(header(raw, 'List-Unsubscribe')!, /^<https:\/\/go\.getacme\.com\/u\/[\w-]+>, <mailto:alex@getacme\.com\?subject=unsubscribe%20[\w-]+>$/);
    assert.equal(header(raw, 'List-Unsubscribe-Post'), 'List-Unsubscribe=One-Click');
    assert.equal(header(raw, 'X-Mailer'), undefined);
    assert.ok(raw.includes('https://go.getacme.com/t/o/'), 'the open pixel is on the tracking host');
    assert.ok(raw.includes("If you'd rather not hear from me"), 'the compliance footer is there');
    assert.ok(storage.objects.has(`raw/${workspaceId}/${scheduled!.id}.eml`));
    assert.deepEqual(jobs.of('delivery.confirm'), [{ thread_id: threadId, message_id: scheduled!.id }]);

    await evaluateThread(db, threadId, { now: at(0, 11) });
    let thread = await threadRow(threadId);
    assert.deepEqual([thread.stage, thread.next_action_type, thread.follow_up_step_position, thread.mailbox_id], ['sent', 'send_follow_up', 1, mailboxId]);
    assert.equal(thread.subject, 'Quick question about your team');
    await evaluateThread(db, threadId, { now: at(0, 16) });
    thread = await threadRow(threadId);
    assert.equal(thread.stage, 'received', 'no bounce within the 4-hour grace period');

    // Follow-up 1 is due three business days later, as a reply in the same thread (IT-30).
    assert.equal((await schedulerTick(db, tickDeps(), at(1))).composed, 0);
    assert.equal((await schedulerTick(db, tickDeps(), at(3))).composed, 1);
    const followUp = (await messageRows(threadId)).at(-1)!;
    assert.deepEqual([followUp.subject, followUp.in_reply_to_header], ['Re: Quick question about your team', scheduled!.message_id_header]);
    assert.deepEqual(await sendMessage(db, followUp.id, sendDeps(followUp.scheduled_for!)), { outcome: 'sent' });
    assert.equal(header(submitted[1]!.raw, 'In-Reply-To'), scheduled!.message_id_header);
    assert.equal((await threadRow(threadId)).follow_ups_sent, 1);
  });

  it('sends exactly 8 first touches from a day-1 mailbox and holds the rest with the limit that applied (IT-16)', async () => {
    const mailboxId = await mailbox('newbox@newdomain.example');
    const { threadIds } = await campaignWith([mailboxId], 12);
    const tick = await schedulerTick(db, tickDeps(), at(0));
    assert.equal(tick.composed, 8, 'warm-up cap 10, less a reply reserve of 2');
    const held = (await Promise.all(threadIds.map(threadRow))).filter((thread) => thread.next_action_message_id === null && thread.throttle_reason !== null);
    assert.equal(held.length, 4);
    assert.ok(held.every((thread) => thread.throttle_reason === 'mailbox_cap' && thread.next_action_at! > at(1, 0)), 'held until tomorrow, by the mailbox cap');
  });

  it('waits for the contact’s sending window', async () => {
    const mailboxId = await mailbox('weekend@weekend.example', { warmup_step: 10 });
    const { threadIds } = await campaignWith([mailboxId], 1);
    const saturday = at(4, 12);
    const tick = await schedulerTick(db, tickDeps(), saturday);
    assert.equal(tick.composed, 0, 'nothing goes out on a Saturday');
    const thread = await threadRow(threadIds[0]!);
    const local = intlZoneCalendar.toLocal(thread.next_action_at!, 'UTC');
    assert.deepEqual([local.day, thread.throttle_reason], [at(6).getUTCDate(), 'window']);
    assert.ok(local.hour * 60 + local.minute >= 8 * 60 + 30 && local.hour < 10, 'at Monday’s opening plus up to 90 minutes');
  });

  it('refuses to send to a contact suppressed after the email was composed, or to one who has replied since (§7.2 step 5)', async () => {
    const mailboxId = await mailbox('guard@guard.example', { warmup_step: 10 });
    const { threadIds } = await campaignWith([mailboxId], 2);
    await schedulerTick(db, tickDeps(), at(0));
    const [first, second] = await Promise.all(threadIds.map(async (threadId) => (await messageRows(threadId))[0]!));

    const [contact] = await db.select().from(contacts).where(eq(contacts.id, (await threadRow(threadIds[0]!)).contact_id));
    await post('/suppressions', { email: contact!.email });
    assert.deepEqual(await sendMessage(db, first!.id, sendDeps(at(0, 11))), { outcome: 'blocked', reason: 'suppressed' });
    assert.equal((await messageRows(threadIds[0]!))[0]!.status, 'cancelled');

    await db.insert(messages).values({
      id: newId('message'), workspace_id: workspaceId, thread_id: threadIds[1]!, mailbox_id: mailboxId, direction: 'inbound', status: 'received', author: 'contact',
      message_id_header: '<reply@prospect.example>', from_email: 'x@prospect.example', to_emails: [], subject: 'Re: hi', created_at: new Date(second!.created_at.getTime() + 1000),
    });
    assert.deepEqual(await sendMessage(db, second!.id, sendDeps(at(0, 11))), { outcome: 'blocked', reason: 'reply' }, 'a reply stops the first email too');
    assert.equal(submitted.length, 0, 'nothing reached SMTP');
  });

  it('spaces sends, retries temporary failures, treats a 5.1.1 as a hard bounce, and pauses on a provider quota (§7.2 step 6)', async () => {
    const mailboxId = await mailbox('outcomes@outcomes.example', { warmup_step: 10, hourly_limit: 50 });
    const { threadIds } = await campaignWith([mailboxId], 4);
    await schedulerTick(db, tickDeps(), at(0));
    const ids = await Promise.all(threadIds.map(async (threadId) => (await messageRows(threadId))[0]!.id));

    assert.deepEqual(await sendMessage(db, ids[0]!, sendDeps(at(0, 11))), { outcome: 'sent' });
    const spaced = await sendMessage(db, ids[1]!, sendDeps(at(0, 11, 1)));
    assert.equal(spaced.outcome, 'deferred');
    assert.equal((spaced as { reason: string }).reason, 'spacing');

    answer = { kind: 'temporary', response: '451 4.3.0 Try again later' };
    const retry = await sendMessage(db, ids[1]!, sendDeps(at(0, 12)));
    assert.equal(retry.outcome, 'retrying');
    assert.equal((retry as { until: Date }).until.getTime(), at(0, 12, 1).getTime(), 'the first retry is a minute later');

    answer = { kind: 'recipient_rejected', response: '550 5.1.1 User unknown', status: '5.1.1' };
    assert.deepEqual(await sendMessage(db, ids[2]!, sendDeps(at(0, 13))), { outcome: 'bounced' });
    const bouncedThread = await threadRow(threadIds[2]!);
    const [bouncedContact] = await db.select().from(contacts).where(eq(contacts.id, bouncedThread.contact_id));
    assert.equal(bouncedContact!.email_verification, 'bounced');
    assert.equal((await db.select().from(suppressions).where(and(eq(suppressions.email, bouncedContact!.email), eq(suppressions.reason, 'hard_bounce')))).length, 1);
    await evaluateThread(db, threadIds[2]!, { now: at(0, 13, 1) });
    assert.equal((await threadRow(threadIds[2]!)).state, 'bounced');

    answer = { kind: 'quota', response: '550 5.4.5 Daily user sending quota exceeded' };
    const quota = await sendMessage(db, ids[3]!, sendDeps(at(0, 14)));
    assert.equal((quota as { reason: string }).reason, 'provider_quota');
    const [paused] = await db.select().from(mailboxes).where(eq(mailboxes.id, mailboxId));
    assert.deepEqual([paused!.status, paused!.daily_limit], ['paused', 32]);
    assert.match(paused!.status_reason!, /^breaker:/);
  });

  /** An IMAP server holding one Sent folder in memory. */
  function fakeImap() {
    const sent: { messageId: string; raw: Buffer; flags: string[] }[] = [];
    let down = false;
    const imap: ImapConnector = {
      async connect() {
        if (down) throw new Error('connect ETIMEDOUT');
        return {
          folders: async () => ({ inbox: 'INBOX', sent: 'Sent', junk: null }),
          open: async () => ({ uidValidity: 1n, uidNext: sent.length + 1 }),
          headersAfter: async function* () {},
          headersSince: async function* () {},
          fetchRaw: async () => null,
          append: async (_path, raw, flags) => void sent.push({ messageId: header(raw.toString(), 'Message-ID')!, raw, flags }),
          findByMessageId: async (_path, messageId) => (sent.findIndex((entry) => entry.messageId === messageId) + 1) || null,
          remove: async () => {},
          close: async () => {},
        };
      },
    };
    return { imap, sent, setDown: (value: boolean) => void (down = value) };
  }

  it('settles an interrupted send from the Sent folder: found means sent, missing means one retry, then a person (§7.2 step 7)', async () => {
    const server = fakeImap();
    const mailboxId = await mailbox('stuck@stuck.example', { warmup_step: 10, folders: { inbox: 'INBOX', sent: 'Sent' } });
    const { threadIds } = await campaignWith([mailboxId], 2);
    await schedulerTick(db, tickDeps(), at(0));
    const [first] = await messageRows(threadIds[0]!);
    const [second] = await messageRows(threadIds[1]!);
    const deps = (now: Date) => ({ ...sendDeps(now), imap: server.imap });
    await db.update(messages).set({ status: 'sending', updated_at: at(0, 10) }).where(inArray(messages.id, [first!.id, second!.id]));
    jobs.clear();
    assert.equal(await sweepStuckSends(db, { jobs }, at(0, 10, 5)), 0);
    assert.equal(await sweepStuckSends(db, { jobs }, at(0, 10, 11)), 2);
    assert.equal((await messageRows(threadIds[0]!))[0]!.status, 'send_unknown');
    assert.deepEqual(new Set(jobs.of('outbound.reconcile').map((job) => job.message_id)), new Set([first!.id, second!.id]));

    // The first did go out before the crash: the provider saved it in Sent.
    server.sent.push({ messageId: first!.message_id_header, raw: Buffer.from(''), flags: [] });
    jobs.clear();
    assert.equal(await reconcileUnknownSend(db, first!.id, deps(at(0, 10, 12))), 'sent');
    const settled = (await messageRows(threadIds[0]!))[0]!;
    assert.equal(settled.status, 'sent');
    assert.match(settled.smtp_response!, /Found in Sent/);
    assert.equal(jobs.of('delivery.confirm').length, 1);

    // The second didn't: retried once through the guard, and a second interruption goes to a person.
    assert.equal(await reconcileUnknownSend(db, second!.id, deps(at(0, 10, 12))), 'retrying');
    assert.equal((await messageRows(threadIds[1]!))[0]!.status, 'scheduled');
    assert.deepEqual(jobs.of('outbound.send'), [{ message_id: second!.id }]);
    await db.update(messages).set({ status: 'send_unknown' }).where(eq(messages.id, second!.id));
    assert.equal(await reconcileUnknownSend(db, second!.id, deps(at(0, 10, 30))), 'escalated');
    const [escalation] = await db.select().from(escalations).where(eq(escalations.thread_id, threadIds[1]!));
    assert.equal(escalation!.reason, 'send_failure');
    assert.match(escalation!.explanation!, /retried once already/);
  });

  it('asks a person when Sent can’t settle it: no copies kept, or IMAP down (§7.2 step 7)', async () => {
    const server = fakeImap();
    const noCopies = await mailbox('nocopy@nocopy.example', { warmup_step: 10, folders: { inbox: 'INBOX', sent: 'Sent' }, append_to_sent: true });
    const down = await mailbox('down@down.example', { warmup_step: 10, folders: { inbox: 'INBOX', sent: 'Sent' } });
    const a = (await campaignWith([noCopies], 1)).threadIds[0]!;
    const b = (await campaignWith([down], 1)).threadIds[0]!;
    await schedulerTick(db, tickDeps(), at(0));
    for (const threadId of [a, b]) await db.update(messages).set({ status: 'send_unknown' }).where(eq(messages.thread_id, threadId));
    server.setDown(true);
    const deps = { ...sendDeps(at(0, 11)), imap: server.imap };
    assert.equal(await reconcileUnknownSend(db, (await messageRows(a))[0]!.id, deps), 'escalated');
    assert.equal(await reconcileUnknownSend(db, (await messageRows(b))[0]!.id, deps), 'escalated');
    const [explained] = await db.select().from(escalations).where(eq(escalations.thread_id, b));
    assert.match(explained!.explanation!, /could not be checked \(connect ETIMEDOUT\)/);
    assert.equal((await messageRows(b))[0]!.status, 'send_unknown', 'never resent blindly');
  });

  it('saves the exact bytes sent to Sent, \\Seen, when the provider keeps no copy, once (§7.2 step 8)', async () => {
    const server = fakeImap();
    const mailboxId = await mailbox('copy@copy.example', { warmup_step: 10, folders: { inbox: 'INBOX', sent: 'Sent' }, append_to_sent: true });
    const [threadId] = (await campaignWith([mailboxId], 1)).threadIds as [string];
    await schedulerTick(db, tickDeps(), at(0));
    const [scheduled] = await messageRows(threadId);
    assert.deepEqual(await sendMessage(db, scheduled!.id, sendDeps(scheduled!.scheduled_for!)), { outcome: 'sent' });
    assert.deepEqual(jobs.of('outbound.append_sent'), [{ message_id: scheduled!.id }]);
    const deps = { ...sendDeps(at(0, 12)), imap: server.imap };
    assert.equal(await appendToSent(db, scheduled!.id, deps), 'appended');
    assert.equal(await appendToSent(db, scheduled!.id, deps), 'present', 'a retried job saves no second copy');
    assert.equal(server.sent.length, 1);
    assert.deepEqual(server.sent[0]!.flags, ['\\Seen']);
    assert.equal(server.sent[0]!.raw.toString(), submitted[0]!.raw);
  });
});
