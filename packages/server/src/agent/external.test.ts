import assert from 'node:assert/strict';

import type { JevClient } from '@catalyst/ai';
import { campaign_goals, campaign_step_variants, campaign_steps, campaigns, contacts, follow_up_sequences, mailboxes, messages, newId, sending_domains, threads, type Db } from '@catalyst/db';
import { createTestDatabase } from '@catalyst/db/testing';
import { MemoryQueue } from '@catalyst/jobs';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { call, seedApiKey, seedWorkspace } from '../api/testing.ts';
import { composeNext } from '../outbound/compose.ts';
import { setDb, setDeps } from '../runtime.ts';
import { evaluateThread } from '../threads/evaluate.ts';
import { classifyForHarness } from './after-outbound.ts';

// Needs a PostgreSQL server: set TEST_DATABASE_URL to any database on it.
const adminUrl = process.env.TEST_DATABASE_URL;
const DAY = 86_400_000;

describe.skipIf(!adminUrl)('external agent mode: work for the campaign’s own agent (§10.7, §14.5)', () => {
  let db: Db;
  let drop: () => Promise<void>;
  let workspaceId: string;
  let campaignId: string;
  let mailboxId: string;
  let adaptStep: string;
  let key: string;
  let otherKey: string;
  const jobs = new MemoryQueue();
  const now = new Date();

  /** A thread where the contact replied; `answered` adds our answer after it, so a follow-up is due. */
  async function conversation(answered: boolean): Promise<{ threadId: string; contactId: string }> {
    const contactId = newId('contact');
    await db.insert(contacts).values({ id: contactId, workspace_id: workspaceId, email: `p.${contactId.slice(-6)}@globex.example`, first_name: 'Priya', last_name: 'Natarajan', email_verification: 'valid', timezone: 'UTC' });
    const threadId = newId('thread');
    await db.insert(threads).values({ id: threadId, workspace_id: workspaceId, campaign_id: campaignId, contact_id: contactId, mailbox_id: mailboxId, stage: 'responded', stage_rank: 3, subject: 'Quick question', first_sent_at: new Date(now.getTime() - 10 * DAY), created_at: new Date(now.getTime() - 11 * DAY) });
    const email = (values: Partial<typeof messages.$inferInsert>) =>
      db.insert(messages).values({ id: newId('message'), workspace_id: workspaceId, thread_id: threadId, mailbox_id: mailboxId, direction: 'outbound', status: 'sent', author: 'template', message_id_header: `<${newId('message')}@getacme.com>`, from_email: 'alex@getacme.com', to_emails: [], subject: 'Quick question', ...values });
    await email({ body_text: 'How do you onboard today?', sent_at: new Date(now.getTime() - 10 * DAY), created_at: new Date(now.getTime() - 10 * DAY) });
    await email({ direction: 'inbound', status: 'received', author: 'contact', inbound_kind: 'human_reply', from_email: 'p@globex.example', subject: 'Re: Quick question', body_text: 'Maybe. What does it cost?', stripped_text: 'Maybe. What does it cost?', received_at: new Date(now.getTime() - 8 * DAY), created_at: new Date(now.getTime() - 8 * DAY) });
    if (answered) await email({ author: 'human_app', subject: 'Re: Quick question', body_text: 'From $30 a seat. Worth a call?', sent_at: new Date(now.getTime() - 7 * DAY), created_at: new Date(now.getTime() - 7 * DAY) });
    await evaluateThread(db, threadId, { now });
    return { threadId, contactId };
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
    await db.insert(campaigns).values({ id: campaignId, workspace_id: workspaceId, name: 'Q4', objective: 'Book calls.', status: 'active', agent_mode: 'external', persona: {}, sending_window: { days: [1, 2, 3, 4, 5, 6, 7], start: '00:00', end: '23:59' } });
    await db.insert(campaign_goals).values({ id: newId('goal'), campaign_id: campaignId, position: 1, key: 'call', name: 'Call booked', success_criteria: 'Books', playbook: 'Offer a call.' });
    const sequenceId = newId('sequence');
    await db.insert(follow_up_sequences).values({ id: sequenceId, campaign_id: campaignId, name: 'Went quiet', stages: ['responded'] });
    const initialStep = newId('step');
    adaptStep = newId('step');
    await db.insert(campaign_steps).values([
      { id: initialStep, campaign_id: campaignId, position: 1 },
      { id: adaptStep, campaign_id: campaignId, sequence_id: sequenceId, position: 1, mode: 'ai_adapt' },
    ]);
    await db.insert(campaign_step_variants).values([
      { id: newId('variant'), step_id: initialStep, label: 'A', subject_template: 'Quick question', body_template: 'How do you onboard today?' },
      { id: newId('variant'), step_id: adaptStep, label: 'A', body_template: 'Any thoughts on a call?' },
    ]);
  });
  afterAll(async () => {
    setDb(undefined);
    setDeps(undefined);
    await drop?.();
  });

  it('never runs the built-in agent: a due AI step waits for the campaign’s agent, in the work queue', async () => {
    const quiet = await conversation(true);
    const waiting = await conversation(false);
    const composed = await db.transaction((tx) => composeNext(tx, { threadId: quiet.threadId, mailboxId, scheduledFor: now }, { jobs, rng: () => 0.5, trackingSecret: null, appHost: null, now, ai: true }));
    assert.deepEqual(composed, { status: 'awaiting_agent' });
    assert.equal(jobs.of('ai.compose').length, 0, 'Claude isn’t asked');
    const [held] = await db.select().from(threads).where(eq(threads.id, quiet.threadId));
    assert.equal(held!.throttle_reason, 'awaiting_agent');
    assert.ok(held!.next_action_at!.getTime() >= now.getTime() + 59 * 60_000, 'looked at again in an hour');

    const queue = await call('GET', '/work-queue', { key });
    assert.equal(queue.status, 200, JSON.stringify(queue.body));
    type Item = { kind: string; id: string; title: string; suggested_tools: string[] };
    const items = queue.body.items as Item[];
    const reply = items.find((item) => item.kind === 'reply_needed');
    const followUp = items.find((item) => item.kind === 'follow_up_needed');
    assert.deepEqual([reply?.id, reply?.title, reply?.suggested_tools[1]], [waiting.threadId, 'Priya Natarajan replied', 'create_reply']);
    assert.deepEqual([followUp?.id, followUp?.title], [quiet.threadId, 'Follow up with Priya Natarajan']);
    assert.deepEqual([queue.body.counts.reply_needed, queue.body.counts.follow_up_needed], [1, 1]);
    const other = (await call('GET', '/work-queue', { key: otherKey })).body;
    assert.deepEqual([other.items, other.counts.reply_needed, other.counts.follow_up_needed], [[], 0, 0]);

    // The reply the agent writes is the awaited follow-up, so the sequence moves on once it is sent.
    const drafted = await call('POST', `/threads/${quiet.threadId}/replies`, { key, body: { body_text: 'Hi Priya, still keen on a quick call?', mode: 'draft' } });
    assert.equal(drafted.status, 201, JSON.stringify(drafted.body));
    const [draft] = await db.select().from(messages).where(eq(messages.id, drafted.body.id));
    assert.equal(draft!.step_id, adaptStep);
    const after = (await call('GET', '/work-queue', { key })).body;
    assert.deepEqual(
      (after.items as Item[]).filter((item) => item.kind !== 'reply_needed').map((item) => [item.kind, item.id]),
      [['draft', drafted.body.id]],
      'the draft is the item now',
    );

    // A reply on a thread nobody awaits stays a plain reply.
    const answered = await call('POST', `/threads/${waiting.threadId}/replies`, { key, body: { body_text: 'From $30 a seat. Worth a call?', mode: 'draft' } });
    const [plain] = await db.select().from(messages).where(eq(messages.id, answered.body.id));
    assert.equal(plain!.step_id, null);
  });

  it('still has Jev read each reply, for the harness (§10.7)', async () => {
    const { threadId } = await conversation(false);
    const [reply] = await db.select().from(messages).where(and(eq(messages.thread_id, threadId), eq(messages.direction, 'inbound')));
    const jev: JevClient = {
      classify: async ({ questions, model }) => ({
        status: 'ok',
        model,
        latencyMs: 1,
        usage: { inputTokens: 10, outputTokens: 1, costUsdMicros: 0 },
        answers: Object.fromEntries(Object.entries(questions).map(([name, question]) => [name, question.type === 'noul' ? { type: 'noul', noul: name === 'needs_reply' ? 0.9 : 0.05 } : question.type === 'choice' ? { type: 'choice', choice: name === 'kind' ? 'human_reply' : 'question', confidence: 0.9, probabilities: { [name === 'kind' ? 'human_reply' : 'question']: 0.9 } } : { type: 'score', score: 2, confidence: 0.8, probabilities: {} }])),
      }),
    };
    assert.deepEqual(await classifyForHarness(db, reply!.id, { jev, jevModel: 'jev-1.13.0', jobs, now, canarySecret: 'k' }), { status: 'classified' });
    const [thread] = await db.select().from(threads).where(eq(threads.id, threadId));
    assert.deepEqual([thread!.latest_intent, thread!.classification_fallback], ['question', false]);
    assert.equal((await db.select().from(messages).where(eq(messages.id, reply!.id)))[0]!.needs_reply_p, '0.900');
    assert.equal((await db.select().from(messages).where(and(eq(messages.thread_id, threadId), eq(messages.author, 'ai')))).length, 0, 'nothing is drafted');
  });
});
