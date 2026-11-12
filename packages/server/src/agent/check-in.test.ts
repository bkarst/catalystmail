import assert from 'node:assert/strict';

import type { ClaudeClient, ClaudeRequest, ClaudeResult } from '@catalyst/ai';
import { ai_runs, campaign_goals, campaign_step_variants, campaign_steps, campaigns, contacts, escalations, follow_up_sequences, mailboxes, messages, newId, sending_domains, threads, type Db } from '@catalyst/db';
import { createTestDatabase } from '@catalyst/db/testing';
import { MemoryQueue } from '@catalyst/jobs';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

import { call, seedApiKey, seedWorkspace } from '../api/testing.ts';
import { composeNext } from '../outbound/compose.ts';
import { setDb, setDeps } from '../runtime.ts';
import { evaluateThread } from '../threads/evaluate.ts';
import { composeCheckIn } from './check-in.ts';

// Needs a PostgreSQL server: set TEST_DATABASE_URL to any database on it.
const adminUrl = process.env.TEST_DATABASE_URL;
const DAY = 86_400_000;
const day = (date: Date) => date.toISOString().slice(0, 10);

/** Writes every draft as `body`; nothing reaches the API. */
function writer(body: string) {
  const requests: ClaudeRequest<unknown>[] = [];
  const claude: ClaudeClient = {
    async run<T>(request: ClaudeRequest<T>): Promise<ClaudeResult<T>> {
      requests.push(request as ClaudeRequest<unknown>);
      const output = { subject: null, body_text: body, pursues_goal_id: '', addresses_questions: [], kb_item_ids_used: [], claims: [], links_used: [], confidence: 0.9, needs_human: false, needs_human_reason: null };
      return { status: 'ok', output: output as T, model: 'claude-opus-5-5', stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costUsdMicros: 24 }, latencyMs: 1, attempts: 1 };
    },
  };
  return { claude, requests };
}

describe.skipIf(!adminUrl)('check-ins the contact asked for (§5.10 rule 5)', () => {
  let db: Db;
  let drop: () => Promise<void>;
  let workspaceId: string;
  let campaignId: string;
  let mailboxId: string;
  let respondedSequence: string;
  let key: string;
  let otherKey: string;
  const jobs = new MemoryQueue();
  const now = new Date();
  const deps = (claude: ClaudeClient) => ({ claude, jobs, rng: () => 0.5, now, canarySecret: 'k', trackingSecret: 'tracking', appHost: 'app.getacme.com' });

  /** "Not now, try later" two days ago, and our answer since: waiting on the contact. */
  async function quietAfterNotNow(): Promise<string> {
    const contactId = newId('contact');
    await db.insert(contacts).values({ id: contactId, workspace_id: workspaceId, email: `p.${contactId.slice(-6)}@globex.example`, first_name: 'Priya', email_verification: 'valid', timezone: 'UTC' });
    const threadId = newId('thread');
    await db.insert(threads).values({ id: threadId, workspace_id: workspaceId, campaign_id: campaignId, contact_id: contactId, mailbox_id: mailboxId, stage: 'responded', stage_rank: 3, subject: 'Quick question', first_sent_at: new Date(now.getTime() - 5 * DAY), created_at: new Date(now.getTime() - 6 * DAY) });
    const email = (values: Partial<typeof messages.$inferInsert>) =>
      db.insert(messages).values({ id: newId('message'), workspace_id: workspaceId, thread_id: threadId, mailbox_id: mailboxId, direction: 'outbound', status: 'sent', author: 'template', message_id_header: `<${newId('message')}@getacme.com>`, from_email: 'alex@getacme.com', to_emails: [], subject: 'Quick question', ...values });
    await email({ body_text: 'How do you onboard today?', sent_at: new Date(now.getTime() - 5 * DAY), created_at: new Date(now.getTime() - 5 * DAY) });
    await email({ direction: 'inbound', status: 'received', author: 'contact', inbound_kind: 'human_reply', from_email: 'p@globex.example', subject: 'Re: Quick question', body_text: 'Not now, busy with the launch. Try me in a month.', stripped_text: 'Not now, busy with the launch. Try me in a month.', received_at: new Date(now.getTime() - 2 * DAY), created_at: new Date(now.getTime() - 2 * DAY) });
    await email({ author: 'ai', subject: 'Re: Quick question', body_text: 'Of course, good luck with the launch. I’ll check back then.', sent_at: new Date(now.getTime() - 2 * DAY + 3_600_000), created_at: new Date(now.getTime() - 2 * DAY + 3_600_000) });
    await evaluateThread(db, threadId, { now });
    return threadId;
  }

  beforeAll(async () => {
    ({ db, drop } = await createTestDatabase(adminUrl!));
    setDb(db);
    setDeps({ jobs, config: { trackingTarget: null, appHost: null } });
    workspaceId = await seedWorkspace(db, 'Acme');
    ({ secret: key } = await seedApiKey(db, workspaceId, ['threads:read', 'threads:write']));
    ({ secret: otherKey } = await seedApiKey(db, await seedWorkspace(db, 'Other'), ['threads:read', 'threads:write']));
    const domainId = newId('domain');
    await db.insert(sending_domains).values({ id: domainId, workspace_id: workspaceId, domain: 'getacme.com' });
    mailboxId = newId('mailbox');
    await db.insert(mailboxes).values({ id: mailboxId, workspace_id: workspaceId, sending_domain_id: domainId, email: 'alex@getacme.com', display_name: 'Alex Rivera', signature_text: 'Alex', auth: 'password', status: 'active', smtp_host: 's', smtp_port: 465, smtp_secure: 'tls', smtp_username: 'a', imap_host: 'i', imap_username: 'a', credentials_enc: Buffer.from('x'), credentials_key_version: 1, folders: {} });
    campaignId = newId('campaign');
    await db.insert(campaigns).values({ id: campaignId, workspace_id: workspaceId, name: 'Q4', objective: 'Book calls.', status: 'active', persona: {}, links: { booking: 'https://cal.getacme.com/alex' }, sending_window: { days: [1, 2, 3, 4, 5, 6, 7], start: '00:00', end: '23:59' } });
    await db.insert(campaign_goals).values({ id: newId('goal'), campaign_id: campaignId, position: 1, key: 'call', name: 'Call booked', success_criteria: 'Books', playbook: 'Offer the booking link.' });
    respondedSequence = newId('sequence');
    await db.insert(follow_up_sequences).values({ id: respondedSequence, campaign_id: campaignId, name: 'Went quiet', stages: ['responded'] });
    const initialStep = newId('step');
    const followUpStep = newId('step');
    await db.insert(campaign_steps).values([
      { id: initialStep, campaign_id: campaignId, position: 1 },
      { id: followUpStep, campaign_id: campaignId, sequence_id: respondedSequence, position: 1 },
    ]);
    await db.insert(campaign_step_variants).values([
      { id: newId('variant'), step_id: initialStep, label: 'A', subject_template: 'Quick question', body_template: 'How do you onboard today?' },
      { id: newId('variant'), step_id: followUpStep, label: 'A', body_template: 'Any thoughts?' },
    ]);
  });
  beforeEach(() => jobs.clear());
  afterAll(async () => {
    setDb(undefined);
    setDeps(undefined);
    await drop?.();
  });

  it('schedules a check-in that replaces the sequence, and cancels it', async () => {
    const threadId = await quietAfterNotNow();
    const before = (await call('GET', `/threads/${threadId}`, { key })).body;
    assert.deepEqual([before.next_action.type, before.follow_up.sequence_id], ['send_follow_up', respondedSequence], 'the sequence runs at first');

    const date = day(new Date(now.getTime() + 30 * DAY));
    const set = await call('POST', `/threads/${threadId}/check-in`, { key, body: { date } });
    assert.equal(set.status, 200, JSON.stringify(set.body));
    assert.equal(set.body.follow_up.check_in_at, `${date}T00:00:00.000Z`);
    assert.deepEqual([set.body.next_action.type, set.body.next_action.at, set.body.follow_up.sequence_id], ['send_follow_up', `${date}T00:00:00.000Z`, null]);

    assert.equal((await call('POST', `/threads/${threadId}/check-in`, { key, body: { date: day(now) } })).status, 400, 'today is too soon');
    assert.equal((await call('POST', `/threads/${threadId}/check-in`, { key, body: { date: day(new Date(now.getTime() + 400 * DAY)) } })).status, 400, 'more than a year ahead');
    assert.equal((await call('POST', `/threads/${threadId}/check-in`, { key: otherKey, body: { date } })).status, 404);
    assert.equal((await call('DELETE', `/threads/${threadId}/check-in`, { key: otherKey })).status, 404);

    const cancelled = await call('DELETE', `/threads/${threadId}/check-in`, { key });
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
    assert.deepEqual([cancelled.body.follow_up.check_in_at, cancelled.body.follow_up.sequence_id], [null, respondedSequence]);
    assert.ok(new Date(cancelled.body.next_action.at).getTime() >= now.getTime(), 'the sequence takes over from now');
    assert.equal((await call('DELETE', `/threads/${threadId}/check-in`, { key })).status, 409);
  });

  /** A thread whose check-in is due now. */
  async function due(): Promise<string> {
    const threadId = await quietAfterNotNow();
    await db.update(threads).set({ check_in_at: new Date(now.getTime() - 60_000), check_in_set_at: new Date(now.getTime() - DAY) }).where(eq(threads.id, threadId));
    await evaluateThread(db, threadId, { now });
    return threadId;
  }

  it('hands a due check-in to the agent, or to a person while AI is off', async () => {
    const threadId = await due();
    const queued = await db.transaction((tx) => composeNext(tx, { threadId, mailboxId, scheduledFor: now }, { jobs, rng: () => 0.5, trackingSecret: null, appHost: null, now, ai: true }));
    assert.deepEqual(queued, { status: 'ai_queued' });
    assert.deepEqual(jobs.of('ai.check_in'), [{ thread_id: threadId, mailbox_id: mailboxId, scheduled_for: now.toISOString() }]);

    const manual = await due();
    const escalated = await db.transaction((tx) => composeNext(tx, { threadId: manual, mailboxId, scheduledFor: now }, { jobs, rng: () => 0.5, trackingSecret: null, appHost: null, now }));
    assert.equal(escalated.status, 'escalated');
    const [escalation] = await db.select().from(escalations).where(eq(escalations.thread_id, manual));
    assert.deepEqual([escalation!.reason, escalation!.title], ['ai_unavailable', 'A check-in is due']);
  });

  it('writes the check-in as a reply in the thread; once sent, the sequence restarts from it', async () => {
    const threadId = await due();
    const { claude, requests } = writer('Hi Priya, hope the launch went well. Is now a better time for a quick call? https://cal.getacme.com/alex');
    const result = await composeCheckIn(db, { threadId, mailboxId, scheduledFor: now }, deps(claude));
    assert.equal(result.status, 'pending_approval', 'the contact replied before, so the fallback asks a person');
    const messageId = (result as { messageId: string }).messageId;
    const [email] = await db.select().from(messages).where(eq(messages.id, messageId));
    assert.deepEqual([email!.author, email!.step_id, email!.subject, email!.status], ['ai', null, 'Re: Quick question', 'pending_approval']);
    assert.match(email!.body_text!, /launch went well[\s\S]*Alex/);
    assert.match(requests[0]!.user.at(-1)!.text, /Check-in the contact asked for[\s\S]*asked to hear from us again around/);
    const [run] = await db.select().from(ai_runs).where(and(eq(ai_runs.thread_id, threadId), eq(ai_runs.task, 'draft_follow_up')));
    assert.ok(run, 'written as a follow-up');
    const [thread] = await db.select().from(threads).where(eq(threads.id, threadId));
    assert.deepEqual([thread!.check_in_at, thread!.state], [null, 'pending_approval']);

    // Sent: the conversation restarts from it, at step 1 of the stage's sequence.
    const sentAt = new Date(now.getTime() + 60_000);
    await db.update(messages).set({ status: 'sent', sent_at: sentAt, approved_at: now }).where(eq(messages.id, messageId));
    await evaluateThread(db, threadId, { now: sentAt });
    const [after] = await db.select().from(threads).where(eq(threads.id, threadId));
    assert.deepEqual([after!.follow_up_sequence_id, after!.follow_up_step_position, after!.waiting_since?.toISOString()], [respondedSequence, 1, sentAt.toISOString()]);

    // Not due (written already, or never set): nothing happens.
    assert.equal((await composeCheckIn(db, { threadId, mailboxId, scheduledFor: now }, deps(claude))).status, 'skipped');
  });
});
