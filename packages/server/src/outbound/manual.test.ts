import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { activities, campaign_mailboxes, contacts, escalations, mailboxes, messages, newId, sending_domains, suppressions, threads, tracked_links, type Db } from '@catalyst/db';
import { emailHash } from '@catalyst/db';
import { createTestDatabase } from '@catalyst/db/testing';
import type { SmtpTransport } from '@catalyst/email';
import { MemoryQueue } from '@catalyst/jobs';
import { MemoryStorage } from '@catalyst/storage';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

import type { Principal } from '../api/auth.ts';
import { ApiError } from '../api/errors.ts';
import { call, seedApiKey, seedWorkspace } from '../api/testing.ts';
import { raiseEscalation } from '../escalations/raise.ts';
import { trackedClick } from '../public/tracking.ts';
import { setDb, setDeps } from '../runtime.ts';
import { createSecretBox, parseEncryptionKeys } from '../secrets.ts';
import { evaluateThread } from '../threads/evaluate.ts';
import { approveDraft, cancelScheduledMessage, createReply, rejectDraft, sendNextActionNow, updateDraft } from './manual.ts';
import { schedulerTick } from './scheduler.ts';
import { sendMessage } from './send.ts';

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
const at = (days: number, hour = 10, minute = 0) => new Date(BASE.getTime() + days * 86_400_000 + hour * 3_600_000 + minute * 60_000);

/** What a send blocked with 422 says, reason by reason. */
async function blockedReasons(run: Promise<unknown>): Promise<string[]> {
  try {
    await run;
  } catch (error) {
    assert.ok(error instanceof ApiError, String(error));
    assert.equal(error.code, 'send_blocked', error.message);
    return (error.errors ?? []).map((entry) => entry.reason!);
  }
  assert.fail('expected 422 send_blocked');
}

describe.skipIf(!adminUrl)('writing and sending by hand: replies, drafts, approval (§13.4, §11.4)', () => {
  let db: Db;
  let drop: () => Promise<void>;
  let workspaceId: string;
  let key: string;
  let sendKey: string;
  let otherKey: string;
  const jobs = new MemoryQueue();
  const storage = new MemoryStorage();
  const secrets = createSecretBox(parseEncryptionKeys(`1:${randomBytes(32).toString('base64')}`));
  const submitted: string[] = [];
  const smtp: SmtpTransport = { submit: async (_account, _envelope, raw) => (submitted.push(raw.toString()), { kind: 'accepted', response: '250 OK' }), verify: async () => {}, close: async () => {} };
  const rng = () => 0.5;
  const manual = (now: Date) => ({ jobs, rng, trackingSecret: 'tracking-secret', appHost: 'catalyst.example.com', now });
  const principal = (): Principal => ({ kind: 'api_key', id: 'key_test', name: 'Test', role: null, scopes: ['threads:read', 'threads:write', 'messages:send'], workspace: { id: workspaceId, name: 'Acme' } });

  /** A thread whose first email went out and that the contact answered. */
  async function repliedThread(): Promise<{ threadId: string; contactId: string; mailboxId: string; inboundHeader: string }> {
    const suffix = newId('contact').slice(-6);
    const domain = `d${suffix}.example`;
    const domainId = newId('domain');
    await db.insert(sending_domains).values({ id: domainId, workspace_id: workspaceId, domain, tracking_host: `go.${domain}` });
    const mailboxId = newId('mailbox');
    await db.insert(mailboxes).values({
      id: mailboxId, workspace_id: workspaceId, sending_domain_id: domainId, email: `alex@${domain}`, display_name: 'Alex Rivera', signature_text: 'Alex Rivera\nAcme', auth: 'password', status: 'active', warmup_step: 10,
      smtp_host: 'smtp.example', smtp_port: 465, smtp_secure: 'tls', smtp_username: 'alex', imap_host: 'imap.example', imap_username: 'alex',
      credentials_enc: secrets.seal(JSON.stringify({ password: 'pw' })), credentials_key_version: 1, folders: {}, min_interval_sec: 60, max_interval_sec: 120,
    });
    const campaign = (
      await call('POST', '/campaigns', {
        key,
        body: { name: `C ${suffix}`, objective: 'Calls.', goals: [{ key: 'call', name: 'Call booked', success_criteria: 'Books.', playbook: 'Offer a call.' }], initial_email: { subject_template: 'Quick question', body_template: 'Hi {{ contact.first_name }},\n\nHow do you onboard today?\n\n{{ sender.first_name }}' } },
      })
    ).body;
    await db.insert(campaign_mailboxes).values({ campaign_id: campaign.id, mailbox_id: mailboxId });
    await db.execute(`update campaigns set status = 'active', launched_at = now() where id = '${campaign.id}'`);
    const contactId = newId('contact');
    await db.insert(contacts).values({ id: contactId, workspace_id: workspaceId, email: `priya@p${suffix}.example`, first_name: 'Priya', email_verification: 'valid', timezone: 'UTC' });
    const enrolled = (await call('POST', `/campaigns/${campaign.id}/enrollments`, { key, body: { contact_ids: [contactId] } })).body;
    const threadId = enrolled.created[0].thread_id as string;
    await evaluateThread(db, threadId, { now: at(0, 9) });
    await schedulerTick(db, { jobs, rng, trackingSecret: 'tracking-secret', appHost: 'catalyst.example.com' }, at(0));
    const [initial] = await db.select().from(messages).where(eq(messages.thread_id, threadId));
    assert.deepEqual(await sendMessage(db, initial!.id, { smtp, secrets, jobs, storage, rng, now: () => initial!.scheduled_for! }), { outcome: 'sent' });
    const inboundHeader = `<reply.${suffix}@p${suffix}.example>`;
    await db.insert(messages).values({
      id: newId('message'), workspace_id: workspaceId, thread_id: threadId, mailbox_id: mailboxId, direction: 'inbound', status: 'received', author: 'contact', message_id_header: inboundHeader,
      in_reply_to_header: initial!.message_id_header, references_headers: [initial!.message_id_header], from_email: `priya@p${suffix}.example`, to_emails: [`alex@${domain}`], subject: 'Re: Quick question',
      body_text: 'Do you support SSO?', stripped_text: 'Do you support SSO?', received_at: at(0, 10, 50), inbound_kind: 'human_reply',
    });
    await evaluateThread(db, threadId, { now: at(0, 10, 55) });
    jobs.clear();
    return { threadId, contactId, mailboxId, inboundHeader };
  }

  beforeAll(async () => {
    ({ db, drop } = await createTestDatabase(adminUrl!));
    setDb(db);
    setDeps({ jobs, storage, secrets, config: { trackingTarget: 'catalyst.example.com', appHost: 'catalyst.example.com', trackingSecret: 'tracking-secret' } });
    workspaceId = await seedWorkspace(db, 'Acme');
    ({ secret: key } = await seedApiKey(db, workspaceId, ['campaigns:read', 'campaigns:write', 'contacts:read', 'contacts:write', 'threads:read', 'threads:write']));
    ({ secret: sendKey } = await seedApiKey(db, workspaceId, ['threads:read', 'threads:write', 'messages:send']));
    ({ secret: otherKey } = await seedApiKey(db, await seedWorkspace(db, 'Other'), ['threads:read', 'threads:write', 'messages:send']));
  });
  beforeEach(() => {
    jobs.clear();
    submitted.length = 0;
  });
  afterAll(async () => {
    setDb(undefined);
    setDeps(undefined);
    await drop?.();
  });

  it('saves a reply as a draft, threaded under the conversation with signature and footer, and lists it', async () => {
    const { threadId, inboundHeader } = await repliedThread();
    const response = await call('POST', `/threads/${threadId}/replies`, { key, body: { body_text: 'Hi Priya,\n\nYes, SAML SSO is on every plan.', mode: 'draft' } });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    const draft = response.body;
    assert.equal(draft.status, 'draft');
    assert.equal(draft.author, 'human_app');
    assert.equal(draft.subject, 'Re: Quick question');
    assert.match(draft.body_text, /Yes, SAML SSO is on every plan\.\n\nAlex Rivera\nAcme\n\nIf you'd rather not hear from me.*\/u\//s);
    assert.deepEqual(draft.lint.filter((finding: { severity: string }) => finding.severity === 'blocker'), []);
    const [row] = await db.select().from(messages).where(eq(messages.id, draft.id));
    assert.equal(row!.in_reply_to_header, inboundHeader);
    assert.equal(row!.references_headers.at(-1), inboundHeader);
    assert.equal(jobs.of('outbound.send').length, 0, 'a draft is not sent');

    const listed = await call('GET', `/drafts?thread_id=${threadId}`, { key });
    assert.deepEqual(listed.body.data.map((entry: { id: string }) => entry.id), [draft.id]);
    assert.equal((await call('POST', `/threads/${threadId}/replies`, { key: otherKey, body: { body_text: 'Hi', mode: 'draft' } })).status, 404);
    assert.equal((await call('GET', `/drafts?thread_id=${threadId}`, { key: otherKey })).body.data.length, 0);
  });

  it('needs messages:send and an Idempotency-Key to send, and `send_at` to schedule', async () => {
    const { threadId } = await repliedThread();
    const body = { body_text: 'Hi Priya, yes.', mode: 'send_now' };
    assert.equal((await call('POST', `/threads/${threadId}/replies`, { key, body })).status, 403);
    const noKey = await call('POST', `/threads/${threadId}/replies`, { key: sendKey, body });
    assert.equal(noKey.status, 400);
    assert.equal(noKey.body.errors[0].path, 'header.Idempotency-Key');
    assert.equal((await call('POST', `/threads/${threadId}/replies`, { key: sendKey, body: { body_text: 'Hi', mode: 'schedule' }, headers: { 'idempotency-key': 'k1' } })).status, 400);
  });

  it('sends a reply now: approved, queued, the waiting AI draft superseded, the "reply yourself" escalation resolved; it goes out threaded', async () => {
    const { threadId, inboundHeader } = await repliedThread();
    const [thread] = await db.select().from(threads).where(eq(threads.id, threadId));
    const aiDraft = newId('message');
    await db.insert(messages).values({ id: aiDraft, workspace_id: workspaceId, thread_id: threadId, mailbox_id: thread!.mailbox_id!, direction: 'outbound', status: 'pending_approval', author: 'ai', message_id_header: '<ai@x>', from_email: 'alex@x', to_emails: [], subject: 'Re: Quick question', body_text: 'AI text' });
    await raiseEscalation(db, { workspaceId, threadId, reason: 'ai_unavailable', title: 'Priya replied', explanation: 'Reply yourself.' }, at(0, 10, 55));

    const reply = await createReply(db, principal(), threadId, { body_text: 'Hi Priya,\n\nYes, SAML SSO is on every plan.', mode: 'send_now' }, 'idem-1', manual(at(0, 11)));
    assert.equal(reply.status, 'scheduled');
    assert.equal(reply.scheduled_for, at(0, 11).toISOString());
    assert.equal(reply.approved_at, at(0, 11).toISOString());
    assert.deepEqual(jobs.of('outbound.send'), [{ message_id: reply.id }]);
    assert.equal((await db.select().from(messages).where(eq(messages.id, aiDraft)))[0]!.status, 'superseded');
    const [escalation] = await db.select().from(escalations).where(eq(escalations.thread_id, threadId));
    assert.deepEqual([escalation!.status, escalation!.resolution], ['resolved', 'replied']);

    assert.deepEqual(await sendMessage(db, reply.id, { smtp, secrets, jobs, storage, rng, now: () => at(0, 11, 1) }), { outcome: 'sent' });
    assert.match(submitted.at(-1)!, new RegExp(`In-Reply-To: ${inboundHeader.replace(/[.]/g, '\\.')}`));
    assert.match(submitted.at(-1)!, /Subject: Re: Quick question/);
  });

  it('blocks a send with every failing check: outside the window, suppressed; a scheduled reply moves into the window', async () => {
    const { threadId, contactId } = await repliedThread();
    assert.deepEqual(await blockedReasons(createReply(db, principal(), threadId, { body_text: 'Hi', mode: 'send_now' }, 'k', manual(at(0, 20)))), ['outside_window']);

    const scheduled = await createReply(db, principal(), threadId, { body_text: 'Hi Priya, tomorrow then.', mode: 'schedule', send_at: at(0, 21).toISOString() }, 'k2', manual(at(0, 20)));
    assert.equal(scheduled.scheduled_for, at(1, 8, 30).toISOString(), 'the next window opening, Wednesday 08:30 in the contact’s zone');

    const [contact] = await db.select().from(contacts).where(eq(contacts.id, contactId));
    await db.insert(suppressions).values({ id: newId('suppression'), workspace_id: workspaceId, email_hash: emailHash(contact!.email), reason: 'manual', source: 'manual' });
    assert.deepEqual((await blockedReasons(createReply(db, principal(), threadId, { body_text: 'Hi', mode: 'send_now' }, 'k3', manual(at(0, 21))))).sort(), ['outside_window', 'suppressed']);
  });

  it('edits a draft (If-Match, re-linted), refuses to approve it with a lint blocker, then approves it into the window', async () => {
    const { threadId } = await repliedThread();
    const draft = await createReply(db, principal(), threadId, { body_text: 'Hi Priya,\n\nYes.', mode: 'draft' }, null, manual(at(0, 11)));
    const fetched = await call('GET', `/messages/${draft.id}`, { key });
    assert.ok(fetched.headers.get('etag'));
    const stale = await call('PATCH', `/messages/${draft.id}`, { key, body: { body_text: 'x' }, headers: { 'if-match': '"stale"' } });
    assert.equal(stale.status, 412);

    // Cutting the footer leaves no unsubscribe link: a blocker.
    const edited = await call('PATCH', `/messages/${draft.id}`, { key, body: { body_text: 'Hi Priya,\n\nYes, every plan.\n\nAlex' }, headers: { 'if-match': fetched.headers.get('etag')! } });
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    assert.ok(edited.body.lint.some((finding: { severity: string }) => finding.severity === 'blocker'));
    assert.ok((await blockedReasons(approveDraft(db, principal(), draft.id, {}, manual(at(0, 11))))).includes('lint_blocker'));
    assert.equal((await call('PATCH', `/messages/${draft.id}`, { key, body: { subject: 'New subject' } })).status, 400, 'a reply keeps its subject');

    const fixed = await updateDraft(db, principal(), draft.id, { body_text: draft.body_text!.replace('Yes.', 'Yes, every plan.') }, null, at(0, 11));
    assert.deepEqual(fixed.lint!.filter((finding) => finding.severity === 'blocker'), []);
    const approved = await approveDraft(db, principal(), draft.id, {}, manual(at(0, 19)));
    assert.equal(approved.status, 'scheduled');
    assert.equal(approved.scheduled_for, at(1, 8, 30).toISOString(), 'approved at night, it waits for the window');
    await assert.rejects(approveDraft(db, principal(), draft.id, {}, manual(at(0, 19))), (error: ApiError) => error.status === 409);
    assert.equal((await call('POST', `/messages/${draft.id}/approve`, { key: otherKey, body: {}, headers: { 'idempotency-key': 'x' } })).status, 404);
  });

  it('rejects a draft with feedback, and cancels a scheduled follow-up as a skipped step', async () => {
    const { threadId } = await repliedThread();
    const draft = await createReply(db, principal(), threadId, { body_text: 'Hi Priya, maybe.', mode: 'draft' }, null, manual(at(0, 11)));
    const rejected = await rejectDraft(db, principal(), draft.id, { reason: 'Too vague', feedback: 'Answer the SSO question.' }, { jobs, now: at(0, 11) });
    assert.equal(rejected.status, 'cancelled');
    const [logged] = await db.select().from(activities).where(and(eq(activities.thread_id, threadId), eq(activities.type, 'message.rejected')));
    assert.deepEqual(logged!.data, { message_id: draft.id, reason: 'Too vague', feedback: 'Answer the SSO question.' });

    const sent = (await db.select().from(messages).where(and(eq(messages.thread_id, threadId), eq(messages.status, 'sent'))))[0]!;
    await assert.rejects(cancelScheduledMessage(db, principal(), sent.id, { jobs, now: at(0, 11) }), (error: ApiError) => error.status === 409);
    const scheduled = await createReply(db, principal(), threadId, { body_text: 'Hi Priya, later.', mode: 'schedule', send_at: at(1, 10).toISOString() }, 'k', manual(at(0, 11)));
    const cancelled = await call('POST', `/messages/${scheduled.id}/cancel`, { key });
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
    assert.equal(cancelled.body.status, 'cancelled');
    assert.deepEqual(await sendMessage(db, scheduled.id, { smtp, secrets, jobs, storage, rng, now: () => at(1, 10) }), { outcome: 'skipped' }, 'the queued send finds nothing to do');
  });

  it('lints free text over the API', async () => {
    const response = await call('POST', '/messages/lint', { key, body: { subject: 'Quick question', body_text: 'Hi Priya,\n\nHow do you onboard today?\n\nAlex', compliance_required: true } });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.sendable, false, 'no unsubscribe link or address');
    assert.ok(response.body.findings.length > 0);
  });

  it('sends the next email now: composes a due first email on the spot, or moves a scheduled one up', async () => {
    const { threadId } = await repliedThread();
    await assert.rejects(sendNextActionNow(db, principal(), threadId, manual(at(0, 11))), (error: ApiError) => error.status === 409, 'a replied thread’s next action is not an email');

    // A new thread whose first email is due but not yet written.
    const [other] = await db.select().from(threads).where(eq(threads.id, threadId));
    const contactId = newId('contact');
    await db.insert(contacts).values({ id: contactId, workspace_id: workspaceId, email: `new@n${contactId.slice(-6)}.example`, first_name: 'Nia', email_verification: 'valid', timezone: 'UTC' });
    const enrolled = (await call('POST', `/campaigns/${other!.campaign_id}/enrollments`, { key, body: { contact_ids: [contactId] } })).body;
    const fresh = enrolled.created[0].thread_id as string;
    await evaluateThread(db, fresh, { now: at(0, 11) });
    jobs.clear();
    const thread = await sendNextActionNow(db, principal(), fresh, manual(at(0, 11, 30)));
    assert.equal(thread.id, fresh);
    const [composed] = await db.select().from(messages).where(eq(messages.thread_id, fresh));
    assert.deepEqual([composed!.status, composed!.scheduled_for?.toISOString()], ['scheduled', at(0, 11, 30).toISOString()]);
    assert.deepEqual(jobs.of('outbound.send'), [{ message_id: composed!.id }]);
    assert.equal((await call('POST', `/threads/${fresh}/next-action/send-now`, { key: otherKey, headers: { 'idempotency-key': 'z' } })).status, 404);
  });

  it('tracks the links of a reply when the campaign tracks clicks, and the click redirects (§9.3)', async () => {
    const { threadId } = await repliedThread();
    const [thread] = await db.select().from(threads).where(eq(threads.id, threadId));
    await db.execute(`update campaigns set click_tracking = true, links = '{"booking":"https://cal.getacme.com/alex"}' where id = '${thread!.campaign_id}'`);
    const reply = await createReply(db, principal(), threadId, { body_text: 'Hi Priya, pick a time: https://cal.getacme.com/alex', mode: 'draft' }, null, manual(at(0, 11)));
    const [row] = await db.select().from(messages).where(eq(messages.id, reply.id));
    const href = /<a href="(https:\/\/go\.[^"]+\/t\/c\/[^"]+)">https:\/\/cal\.getacme\.com\/alex<\/a>/.exec(row!.body_html!)?.[1];
    assert.ok(href, row!.body_html!);
    const links = await db.select().from(tracked_links).where(eq(tracked_links.message_id, reply.id));
    assert.deepEqual(links.map((link) => [link.original_url, link.link_key]), [['https://cal.getacme.com/alex', 'booking']]);
    const token = href!.slice(href!.lastIndexOf('/') + 1);
    const response = await trackedClick(new Request(href!, { headers: { 'user-agent': 'Mozilla/5.0' } }), token, { db, jobs, secret: 'tracking-secret', now: at(0, 12), defer: () => {}, fallbackUrl: 'https://catalyst.example.com' });
    assert.deepEqual([response.status, response.headers.get('location')], [302, 'https://cal.getacme.com/alex']);
  });
});
