import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { campaign_mailboxes, contacts, escalations, mailboxes, messages, newId, sending_domains, suppressions, thread_participants, threads, type Db } from '@catalyst/db';
import { createTestDatabase } from '@catalyst/db/testing';
import type { SmtpTransport } from '@catalyst/email';
import { MemoryQueue } from '@catalyst/jobs';
import { MemoryStorage } from '@catalyst/storage';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { call, seedApiKey, seedWorkspace } from '../api/testing.ts';
import { schedulerTick } from '../outbound/scheduler.ts';
import { sendMessage } from '../outbound/send.ts';
import { setDb, setDeps } from '../runtime.ts';
import { createSecretBox, parseEncryptionKeys } from '../secrets.ts';
import { evaluateThread } from '../threads/evaluate.ts';
import { ingestMessage } from './ingest.ts';

// Needs a PostgreSQL server: set TEST_DATABASE_URL to any database on it.
const adminUrl = process.env.TEST_DATABASE_URL;

const BASE = (() => {
  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);
  do day.setUTCDate(day.getUTCDate() + 1);
  while (day.getUTCDay() !== 2);
  return day;
})();
const at = (days: number, hour = 10, minute = 0) => new Date(BASE.getTime() + days * 86_400_000 + hour * 3_600_000 + minute * 60_000);

const mime = (headers: Record<string, string>, body: string) => Buffer.from(`${Object.entries(headers).map(([name, value]) => `${name}: ${value}`).join('\r\n')}\r\n\r\n${body}`);

describe.skipIf(!adminUrl)('inbound mail: matching, classification and what it does (§7.4–§7.6, IT-03, IT-06–IT-09, IT-11, IT-19)', () => {
  let db: Db;
  let drop: () => Promise<void>;
  let workspaceId: string;
  let key: string;
  const jobs = new MemoryQueue();
  const storage = new MemoryStorage();
  const secrets = createSecretBox(parseEncryptionKeys(`1:${randomBytes(32).toString('base64')}`));
  const smtp: SmtpTransport = { submit: async () => ({ kind: 'accepted', response: '250 OK' }), verify: async () => {}, close: async () => {} };
  const ingest = (mailboxId: string, raw: Buffer, folder: 'inbox' | 'junk' | 'sent' = 'inbox', now = at(1)) => ingestMessage(db, { mailboxId, folder, raw }, { jobs, storage, now });
  const thread = async (threadId: string) => (await db.select().from(threads).where(eq(threads.id, threadId)))[0]!;

  /** A mailbox on its own domain, a launched campaign, and one contact whose initial email went out at at(0). */
  async function sentThread(contactEmail: string, options: { pauseOnManualReply?: boolean } = {}) {
    const domain = `${newId('domain').slice(-8)}.example`;
    const domainId = newId('domain');
    await db.insert(sending_domains).values({ id: domainId, workspace_id: workspaceId, domain, tracking_host: `go.${domain}` });
    const mailboxId = newId('mailbox');
    await db.insert(mailboxes).values({
      id: mailboxId, workspace_id: workspaceId, sending_domain_id: domainId, email: `alex@${domain}`, display_name: 'Alex Rivera', auth: 'password', status: 'active', warmup_step: 10,
      smtp_host: 'smtp.gmail.com', smtp_port: 465, smtp_secure: 'tls', smtp_username: 'a', imap_host: 'imap.gmail.com', imap_username: 'a', credentials_enc: secrets.seal('{"password":"x"}'), credentials_key_version: 1, folders: {},
    });
    const campaign = (
      await call('POST', '/campaigns', {
        key,
        body: { name: `C ${domain}`, objective: 'Calls.', goals: [{ key: 'call', name: 'Call booked', success_criteria: 'Books.', playbook: 'Offer a call.' }], initial_email: { subject_template: 'Quick question', body_template: 'Hi {{ contact.first_name | default: "there" }}, how is onboarding?\n\n{{ sender.first_name }}' } },
      })
    ).body;
    await db.insert(campaign_mailboxes).values({ campaign_id: campaign.id, mailbox_id: mailboxId });
    await db.execute(`update campaigns set status = 'active', pause_on_manual_reply = ${options.pauseOnManualReply ?? true} where id = '${campaign.id}'`);
    const contactId = newId('contact');
    await db.insert(contacts).values({ id: contactId, workspace_id: workspaceId, email: contactEmail, first_name: 'Priya', email_verification: 'valid', timezone: 'UTC', lifecycle_stage: 'prospect' });
    const threadId = (await call('POST', `/campaigns/${campaign.id}/enrollments`, { key, body: { contact_ids: [contactId] } })).body.created[0].thread_id as string;
    await evaluateThread(db, threadId, { now: at(0, 9) });
    await schedulerTick(db, { jobs, rng: () => 0.5, trackingSecret: 'secret', appHost: null }, at(0));
    const [initial] = await db.select().from(messages).where(eq(messages.thread_id, threadId));
    await sendMessage(db, initial!.id, { smtp, secrets, jobs, storage, rng: () => 0.5, now: () => initial!.scheduled_for! });
    await evaluateThread(db, threadId, { now: at(0, 12) });
    const [sent] = await db.select().from(messages).where(eq(messages.id, initial!.id));
    return { mailboxId, mailboxEmail: `alex@${domain}`, threadId, contactId, sentHeader: sent!.message_id_header, campaignId: campaign.id as string };
  }

  beforeAll(async () => {
    ({ db, drop } = await createTestDatabase(adminUrl!));
    setDb(db);
    setDeps({ jobs, storage, secrets, config: { trackingTarget: null, appHost: null, trackingSecret: 'secret' } });
    workspaceId = await seedWorkspace(db, 'Acme');
    ({ secret: key } = await seedApiKey(db, workspaceId, ['campaigns:read', 'campaigns:write', 'contacts:read', 'contacts:write']));
  });
  afterAll(async () => {
    setDb(undefined);
    setDeps(undefined);
    await drop?.();
  });

  it('matches a reply by its headers, moves the thread to Responded, and the due follow-up is superseded (IT-03, IT-11)', async () => {
    const sent = await sentThread('priya@reply.example');
    // The no-reply follow-up is composed before the reply arrives.
    await schedulerTick(db, { jobs, rng: () => 0.5, trackingSecret: 'secret', appHost: null }, at(3));
    const followUp = (await db.select().from(messages).where(and(eq(messages.thread_id, sent.threadId), eq(messages.status, 'scheduled'))))[0]!;

    const reply = mime(
      { From: 'Priya Natarajan <priya@reply.example>', To: sent.mailboxEmail, Subject: 'Re: Quick question', 'Message-ID': '<r1@reply.example>', 'In-Reply-To': sent.sentHeader, References: sent.sentHeader, Date: at(3, 9).toUTCString() },
      'Do you support SAML SSO?\r\n\r\nOn Tue, Alex wrote:\r\n> Hi Priya',
    );
    const stored = await ingest(sent.mailboxId, reply, 'inbox', at(3, 11));
    assert.equal(stored.outcome, 'stored');
    assert.equal((await ingest(sent.mailboxId, reply)).outcome, 'duplicate', 'polling twice stores it once');

    const [message] = await db.select().from(messages).where(eq(messages.message_id_header, '<r1@reply.example>'));
    assert.deepEqual([message!.thread_id, message!.match_method, message!.inbound_kind, message!.author, message!.stripped_text], [sent.threadId, 'headers', 'human_reply', 'contact', 'Do you support SAML SSO?']);
    await evaluateThread(db, sent.threadId, { now: at(3, 11, 1) });
    const row = await thread(sent.threadId);
    assert.deepEqual([row.stage, row.state], ['responded', 'needs_human'], 'a person answers until the AI agent exists');
    const [contact] = await db.select().from(contacts).where(eq(contacts.id, sent.contactId));
    assert.deepEqual([contact!.lifecycle_stage, Boolean(contact!.last_replied_at)], ['engaged', true]);
    const outcome = await sendMessage(db, followUp.id, { smtp, secrets, jobs, storage, rng: () => 0.5, now: () => at(3, 12) });
    assert.deepEqual(outcome, { outcome: 'blocked', reason: 'reply' }, 'the follow-up composed before the reply is never sent');
    assert.equal((await db.select().from(messages).where(eq(messages.id, followUp.id)))[0]!.status, 'cancelled');
  });

  it('bounces the thread on a Gmail DSN for the original email (IT-06)', async () => {
    const sent = await sentThread('nobody@bounce.example');
    const dsn = Buffer.from(
      [
        'From: Mail Delivery Subsystem <mailer-daemon@googlemail.com>',
        `To: ${sent.mailboxEmail}`,
        'Subject: Delivery Status Notification (Failure)',
        'Message-ID: <dsn.1@mx.google.com>',
        'MIME-Version: 1.0',
        'Content-Type: multipart/report; report-type=delivery-status; boundary="b1"',
        '',
        '--b1',
        'Content-Type: text/plain',
        '',
        'Address not found.',
        '--b1',
        'Content-Type: message/delivery-status',
        '',
        'Final-Recipient: rfc822; nobody@bounce.example',
        'Action: failed',
        'Status: 5.1.1',
        '--b1',
        'Content-Type: text/rfc822-headers',
        '',
        `Message-ID: ${sent.sentHeader}`,
        '--b1--',
      ].join('\r\n'),
    );
    const stored = await ingest(sent.mailboxId, dsn);
    assert.deepEqual([stored.outcome, (stored as { kind: string }).kind], ['stored', 'bounce_hard']);
    await evaluateThread(db, sent.threadId, { now: at(1, 10) });
    assert.equal((await thread(sent.threadId)).state, 'bounced');
    const [contact] = await db.select().from(contacts).where(eq(contacts.id, sent.contactId));
    assert.equal(contact!.email_verification, 'bounced');
    assert.equal((await db.select().from(suppressions).where(and(eq(suppressions.email, 'nobody@bounce.example'), eq(suppressions.reason, 'hard_bounce')))).length, 1);
    const [original] = await db.select().from(messages).where(eq(messages.message_id_header, sent.sentHeader));
    assert.deepEqual([original!.status, original!.dsn_status], ['bounced', '5.1.1']);
  });

  it('keeps the stage on an out-of-office reply (IT-07)', async () => {
    const sent = await sentThread('away@ooo.example');
    await ingest(sent.mailboxId, mime({ From: 'away@ooo.example', To: sent.mailboxEmail, Subject: 'Out of Office: Quick question', 'Auto-Submitted': 'auto-replied', 'Message-ID': '<ooo.1@ooo.example>', 'In-Reply-To': sent.sentHeader }, 'I am away until next week.'));
    await evaluateThread(db, sent.threadId, { now: at(1, 10) });
    const row = await thread(sent.threadId);
    assert.deepEqual([row.stage, row.state], ['received', 'active']);
    assert.equal((await db.select().from(escalations).where(eq(escalations.thread_id, sent.threadId))).length, 0);
  });

  it('unsubscribes everywhere on "please remove me" (IT-08)', async () => {
    const sent = await sentThread('stop@unsub.example');
    await ingest(sent.mailboxId, mime({ From: 'stop@unsub.example', To: sent.mailboxEmail, Subject: 'Re: Quick question', 'Message-ID': '<u1@unsub.example>', 'In-Reply-To': sent.sentHeader }, 'Please remove me from your list.'));
    const [contact] = await db.select().from(contacts).where(eq(contacts.id, sent.contactId));
    assert.equal(contact!.subscription_status, 'unsubscribed');
    const [suppression] = await db.select().from(suppressions).where(eq(suppressions.email, 'stop@unsub.example'));
    assert.deepEqual([suppression!.reason, suppression!.source], ['unsubscribed', 'reply']);
    await evaluateThread(db, sent.threadId, { now: at(1, 10) });
    assert.equal((await thread(sent.threadId)).state, 'unsubscribed');
  });

  it('records the operator’s own reply from Sent and pauses the agent (IT-09)', async () => {
    const sent = await sentThread('direct@sent.example');
    const own = mime({ From: `Alex Rivera <${sent.mailboxEmail}>`, To: 'direct@sent.example', Subject: 'Re: Quick question', 'Message-ID': '<own.1@gmail.example>', 'In-Reply-To': sent.sentHeader, Date: at(1, 9).toUTCString() }, 'Great, see you Thursday at 2.');
    const stored = await ingest(sent.mailboxId, own, 'sent');
    assert.deepEqual([stored.outcome, (stored as { kind: string }).kind], ['stored', 'human_external']);
    await evaluateThread(db, sent.threadId, { now: at(1, 10) });
    const row = await thread(sent.threadId);
    assert.deepEqual([row.ai_paused, row.state, row.state_reason], [true, 'paused', 'human_took_over']);
    // Our own email in Sent is recognised, not stored twice.
    const ours = mime({ From: sent.mailboxEmail, To: 'direct@sent.example', Subject: 'Quick question', 'Message-ID': sent.sentHeader }, 'Hi Priya');
    assert.equal((await ingest(sent.mailboxId, ours, 'sent')).outcome, 'duplicate');
  });

  it('ignores unknown senders entirely, and links a colleague who replies on the thread (IT-19, §7.4)', async () => {
    const sent = await sentThread('lead@team.example');
    const newsletter = mime({ From: 'news@unrelated.example', To: sent.mailboxEmail, Subject: 'Our weekly digest', 'Message-ID': '<n1@unrelated.example>' }, 'Hello');
    assert.equal((await ingest(sent.mailboxId, newsletter)).outcome, 'ignored');
    assert.equal((await db.select().from(messages).where(eq(messages.message_id_header, '<n1@unrelated.example>'))).length, 0);

    const colleague = mime({ From: 'Dana Wu <dana@team.example>', To: sent.mailboxEmail, Subject: 'Re: Quick question', 'Message-ID': '<c1@team.example>', 'In-Reply-To': sent.sentHeader }, 'I handle this for the team, can we talk?');
    const stored = await ingest(sent.mailboxId, colleague);
    assert.equal(stored.outcome, 'stored');
    const [participant] = await db.select().from(thread_participants).where(eq(thread_participants.thread_id, sent.threadId));
    assert.ok(participant);
    const reasons = (await db.select({ reason: escalations.reason }).from(escalations).where(eq(escalations.thread_id, sent.threadId))).map((entry) => entry.reason).sort();
    assert.deepEqual(reasons, ['ai_unavailable', 'new_participant']);
  });

  it('keeps a known contact’s unmatched mail for a person: listed, attached with full effect, or ignored (§7.4 step 6)', async () => {
    const { secret: threadsKey } = await seedApiKey(db, workspaceId, ['threads:read', 'threads:write']);
    const { secret: otherKey } = await seedApiKey(db, await seedWorkspace(db, 'Other'), ['threads:read', 'threads:write']);
    const home = await sentThread('wanderer@attach.example');
    const elsewhere = await sentThread('someone@else.example');
    // The contact writes to a mailbox where they have no thread: nothing fits.
    const stray = mime({ From: 'Priya <wanderer@attach.example>', To: elsewhere.mailboxEmail, Subject: 'Re: Pricing', 'Message-ID': '<stray.1@attach.example>' }, 'What does the team plan cost?');
    const stored = await ingest(elsewhere.mailboxId, stray, 'inbox', at(2, 9));
    assert.deepEqual([stored.outcome, stored.outcome === 'stored' && stored.threadId], ['stored', null]);
    const messageId = (stored as { messageId: string }).messageId;
    const [raised] = await db.select().from(escalations).where(eq(escalations.trigger_message_id, messageId));
    assert.equal(raised!.reason, 'unmatched_reply');

    const listed = await call('GET', '/messages/unmatched', { key: threadsKey });
    assert.equal(listed.status, 200, JSON.stringify(listed.body));
    assert.ok(listed.body.data.some((entry: { id: string }) => entry.id === messageId));
    assert.equal((await call('GET', '/messages/unmatched', { key: otherKey })).body.data.length, 0);
    assert.equal((await call('POST', `/messages/${messageId}/attach`, { key: otherKey, body: { thread_id: home.threadId } })).status, 404);

    const attached = await call('POST', `/messages/${messageId}/attach`, { key: threadsKey, body: { thread_id: home.threadId } });
    assert.equal(attached.status, 200, JSON.stringify(attached.body));
    assert.deepEqual([attached.body.thread_id, attached.body.match_method, attached.body.author], [home.threadId, 'manual', 'contact']);
    assert.equal((await thread(home.threadId)).stage, 'responded', 'it acts as a reply');
    assert.equal((await db.select().from(escalations).where(eq(escalations.id, raised!.id)))[0]!.status, 'resolved');
    assert.ok((await db.select().from(escalations).where(and(eq(escalations.thread_id, home.threadId), eq(escalations.reason, 'ai_unavailable')))).length === 1, 'a person is asked to answer it');
    assert.equal((await call('POST', `/messages/${messageId}/attach`, { key: threadsKey, body: { thread_id: home.threadId } })).status, 409);

    const another = await ingest(elsewhere.mailboxId, mime({ From: 'wanderer@attach.example', To: elsewhere.mailboxEmail, Subject: 'Re: Lunch', 'Message-ID': '<stray.2@attach.example>' }, 'Wrong person, sorry.'), 'inbox', at(2, 10));
    const ignoredId = (another as { messageId: string }).messageId;
    const ignored = await call('POST', `/messages/${ignoredId}/ignore`, { key: threadsKey });
    assert.equal(ignored.status, 200, JSON.stringify(ignored.body));
    assert.ok(!(await call('GET', '/messages/unmatched', { key: threadsKey })).body.data.some((entry: { id: string }) => entry.id === ignoredId));
    assert.equal((await db.select().from(escalations).where(eq(escalations.trigger_message_id, ignoredId)))[0]!.status, 'dismissed');
    assert.equal((await call('POST', `/messages/${ignoredId}/attach`, { key: threadsKey, body: { thread_id: home.threadId } })).status, 409);
  });

  it('hands a human reply to the agent when AI is on, instead of to a person (§10.4)', async () => {
    const sent = await sentThread('ai@agent.example');
    jobs.clear();
    const reply = mime({ From: 'ai@agent.example', To: sent.mailboxEmail, Subject: 'Re: Quick question', 'Message-ID': '<ai.1@agent.example>', 'In-Reply-To': sent.sentHeader }, 'What does it cost?');
    const stored = await ingestMessage(db, { mailboxId: sent.mailboxId, folder: 'inbox', raw: reply }, { jobs, storage, now: at(1), ai: true });
    assert.equal(stored.outcome, 'stored');
    assert.deepEqual(jobs.of('ai.process_inbound'), [{ message_id: (stored as { messageId: string }).messageId }]);
    assert.equal((await db.select().from(escalations).where(and(eq(escalations.thread_id, sent.threadId), eq(escalations.reason, 'ai_unavailable')))).length, 0);
  });
});
