import assert from 'node:assert/strict';

import type { ClaudeClient, ClaudeRequest, ClaudeResult } from '@catalyst/ai';
import { ai_runs, campaign_goals, campaign_step_variants, campaign_steps, campaigns, contacts, escalations, follow_up_sequences, mailboxes, messages, newId, sending_domains, threads, workspaces, type Db } from '@catalyst/db';
import { createTestDatabase } from '@catalyst/db/testing';
import { MemoryQueue } from '@catalyst/jobs';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

import { seedWorkspace } from '../api/testing.ts';
import { composeNext } from '../outbound/compose.ts';
import { composeWithAgent } from './compose.ts';

// Needs a PostgreSQL server: set TEST_DATABASE_URL to any database on it.
const adminUrl = process.env.TEST_DATABASE_URL;

/** Answers every task with `output`, or fails; nothing reaches the API. */
function stub(output: Record<string, unknown> | 'fail') {
  const requests: ClaudeRequest<unknown>[] = [];
  const claude: ClaudeClient = {
    async run<T>(request: ClaudeRequest<T>): Promise<ClaudeResult<T>> {
      requests.push(request as ClaudeRequest<unknown>);
      if (output === 'fail') return { status: 'error', error: '529 overloaded', model: 'claude-opus-5-5', stopReason: null, usage: null, latencyMs: 1, attempts: 1 };
      return { status: 'ok', output: output as T, model: 'claude-opus-5-5', stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costUsdMicros: 24 }, latencyMs: 1, attempts: 1 };
    },
  };
  return { claude, requests };
}
const followUp = (body: string, confidence = 0.9) => ({ subject: null, body_text: body, pursues_goal_id: '', addresses_questions: [], kb_item_ids_used: [], claims: [], links_used: [], confidence, needs_human: false, needs_human_reason: null });

describe.skipIf(!adminUrl)('AI-written steps: adapted follow-ups and opening lines (§5.10, §10.7, §10.8)', () => {
  let db: Db;
  let drop: () => Promise<void>;
  let workspaceId: string;
  let campaignId: string;
  let mailboxId: string;
  let sequenceId: string;
  let followUpStep: string;
  let initialStep: string;
  let variantId: string;
  const jobs = new MemoryQueue();
  const now = new Date();
  const deps = (claude: ClaudeClient) => ({ claude, jobs, rng: () => 0.5, now, canarySecret: 'k', trackingSecret: 'tracking', appHost: 'app.getacme.com' });

  /** A thread due for follow-up 1 of the Responded sequence; `replied` adds a reply from the contact. */
  async function dueThread(replied: boolean): Promise<string> {
    const contactId = newId('contact');
    await db.insert(contacts).values({ id: contactId, workspace_id: workspaceId, email: `p.${contactId.slice(-6)}@globex.example`, first_name: 'Priya', title: 'VP Ops', email_verification: 'valid', timezone: 'UTC' });
    const threadId = newId('thread');
    await db.insert(threads).values({ id: threadId, workspace_id: workspaceId, campaign_id: campaignId, contact_id: contactId, mailbox_id: mailboxId, stage: 'sent', stage_rank: 1, subject: 'Quick question', next_action_type: 'send_follow_up', next_action_at: now, follow_up_sequence_id: sequenceId, follow_up_step_position: 1, first_sent_at: new Date(now.getTime() - 3 * 86_400_000) });
    await db.insert(messages).values({ id: newId('message'), workspace_id: workspaceId, thread_id: threadId, mailbox_id: mailboxId, direction: 'outbound', status: 'sent', author: 'template', message_id_header: `<a.${threadId}@getacme.com>`, from_email: 'alex@getacme.com', to_emails: [], subject: 'Quick question', body_text: 'How do you onboard today?', sent_at: new Date(now.getTime() - 3 * 86_400_000), created_at: new Date(now.getTime() - 3 * 86_400_000) });
    if (replied) {
      await db.insert(messages).values({ id: newId('message'), workspace_id: workspaceId, thread_id: threadId, mailbox_id: mailboxId, direction: 'inbound', status: 'received', author: 'contact', inbound_kind: 'human_reply', message_id_header: `<r.${threadId}@globex.example>`, from_email: 'p@globex.example', to_emails: [], subject: 'Re: Quick question', body_text: 'Maybe, tell me more.', stripped_text: 'Maybe, tell me more.', received_at: new Date(now.getTime() - 2 * 86_400_000), created_at: new Date(now.getTime() - 2 * 86_400_000) });
    }
    return threadId;
  }

  beforeAll(async () => {
    ({ db, drop } = await createTestDatabase(adminUrl!));
    workspaceId = await seedWorkspace(db, 'Acme');
    const domainId = newId('domain');
    await db.insert(sending_domains).values({ id: domainId, workspace_id: workspaceId, domain: 'getacme.com' });
    mailboxId = newId('mailbox');
    await db.insert(mailboxes).values({ id: mailboxId, workspace_id: workspaceId, sending_domain_id: domainId, email: 'alex@getacme.com', display_name: 'Alex Rivera', signature_text: 'Alex', auth: 'password', status: 'active', smtp_host: 's', smtp_port: 465, smtp_secure: 'tls', smtp_username: 'a', imap_host: 'i', imap_username: 'a', credentials_enc: Buffer.from('x'), credentials_key_version: 1, folders: {} });
    campaignId = newId('campaign');
    await db.insert(campaigns).values({ id: campaignId, workspace_id: workspaceId, name: 'Q4', objective: 'Book calls.', status: 'active', persona: {}, links: { booking: 'https://cal.getacme.com/alex' }, sending_window: { days: [1, 2, 3, 4, 5, 6, 7], start: '00:00', end: '23:59' } });
    await db.insert(campaign_goals).values({ id: newId('goal'), campaign_id: campaignId, position: 1, key: 'call', name: 'Call booked', success_criteria: 'Books', playbook: 'Offer the booking link.' });
    sequenceId = newId('sequence');
    await db.insert(follow_up_sequences).values({ id: sequenceId, campaign_id: campaignId, name: 'No reply', stages: ['sent', 'received'] });
    initialStep = newId('step');
    followUpStep = newId('step');
    await db.insert(campaign_steps).values([
      { id: initialStep, campaign_id: campaignId, position: 1, mode: 'ai_opening_line' },
      { id: followUpStep, campaign_id: campaignId, sequence_id: sequenceId, position: 1, mode: 'ai_adapt', ai_guidance: 'Short and friendly.' },
    ]);
    variantId = newId('variant');
    await db.insert(campaign_step_variants).values([
      { id: newId('variant'), step_id: initialStep, label: 'A', subject_template: 'Quick question', body_template: 'Hi {{ contact.first_name }},\n\n{{ ai.opening_line }}\n\nHow do you onboard today?' },
      { id: variantId, step_id: followUpStep, label: 'A', body_template: 'Bump: worth a 15-minute call? https://cal.getacme.com/alex' },
    ]);
  });
  beforeEach(() => jobs.clear());
  afterAll(async () => {
    await drop?.();
  });

  it('hands a due AI step to the agent and holds the thread meanwhile', async () => {
    const threadId = await dueThread(false);
    const result = await db.transaction((tx) => composeNext(tx, { threadId, mailboxId, scheduledFor: now }, { jobs, rng: () => 0.5, trackingSecret: null, appHost: null, now, ai: true }));
    assert.deepEqual(result, { status: 'ai_queued' });
    assert.deepEqual(jobs.of('ai.compose'), [{ thread_id: threadId, step_id: followUpStep, mailbox_id: mailboxId, scheduled_for: now.toISOString() }]);
    const [thread] = await db.select().from(threads).where(eq(threads.id, threadId));
    assert.equal(thread!.throttle_reason, 'composing');
    assert.ok(thread!.next_action_at!.getTime() > now.getTime());
  });

  it('adapts the follow-up to the conversation; after a reply it waits for approval (fallback)', async () => {
    const threadId = await dueThread(true);
    const { claude, requests } = stub(followUp('Hi Priya, happy to tell you more: a 15-minute call? https://cal.getacme.com/alex'));
    const result = await composeWithAgent(db, { threadId, stepId: followUpStep, mailboxId, scheduledFor: now }, deps(claude));
    assert.equal(result.status, 'pending_approval');
    const [email] = await db.select().from(messages).where(eq(messages.id, (result as { messageId: string }).messageId));
    assert.deepEqual([email!.author, email!.step_id, email!.variant_id, email!.subject], ['ai', followUpStep, variantId, 'Re: Quick question']);
    assert.match(email!.body_text!, /happy to tell you more[\s\S]*Alex/);
    assert.match(requests[0]!.user.at(-1)!.text, /Rewrite it to fit this conversation[\s\S]*Bump: worth a 15-minute call/);
    assert.equal(jobs.of('outbound.send').length, 0, 'not sent before approval');
    assert.equal((await db.select().from(ai_runs).where(and(eq(ai_runs.thread_id, threadId), eq(ai_runs.task, 'draft_follow_up')))).length, 1);
    assert.equal((await db.select().from(threads).where(eq(threads.id, threadId)))[0]!.next_action_message_id, email!.id, 'the thread’s next action is claimed');
  });

  it('sends an adapted follow-up on its own to a contact who never replied, when confident (assisted)', async () => {
    const threadId = await dueThread(false);
    const result = await composeWithAgent(db, { threadId, stepId: followUpStep, mailboxId, scheduledFor: now }, deps(stub(followUp('Hi Priya, worth a quick call? https://cal.getacme.com/alex', 0.95)).claude));
    assert.equal(result.status, 'scheduled');
    assert.deepEqual(jobs.of('outbound.send'), [{ message_id: (result as { messageId: string }).messageId }]);
  });

  it('writes the opening line into the first email, which a person reviews for the first ten', async () => {
    const contactId = newId('contact');
    await db.insert(contacts).values({ id: contactId, workspace_id: workspaceId, email: 'n@initech.example', first_name: 'Nia', title: 'COO', email_verification: 'valid', timezone: 'UTC' });
    const threadId = newId('thread');
    await db.insert(threads).values({ id: threadId, workspace_id: workspaceId, campaign_id: campaignId, contact_id: contactId, next_action_type: 'send_initial', next_action_at: now });
    const result = await composeWithAgent(db, { threadId, stepId: initialStep, mailboxId, scheduledFor: now }, deps(stub({ opening_line: 'As COO, you probably own onboarding.', subject: null, body_text: null, confidence: 0.9 }).claude));
    assert.equal(result.status, 'pending_approval', 'sample review');
    const [email] = await db.select().from(messages).where(eq(messages.id, (result as { messageId: string }).messageId));
    assert.match(email!.body_text!, /^Hi Nia,\n\nAs COO, you probably own onboarding\.\n\nHow do you onboard today\?/);
    assert.equal(email!.subject, 'Quick question');
    assert.equal((await db.select().from(threads).where(eq(threads.id, threadId)))[0]!.mailbox_id, mailboxId);
  });

  it('asks a person when the agent fails', async () => {
    const threadId = await dueThread(true);
    const result = await composeWithAgent(db, { threadId, stepId: followUpStep, mailboxId, scheduledFor: now }, deps(stub('fail').claude));
    assert.equal(result.status, 'failed');
    const [escalation] = await db.select().from(escalations).where(eq(escalations.thread_id, threadId));
    assert.equal(escalation!.reason, 'ai_unavailable');
    assert.equal((await db.select().from(messages).where(and(eq(messages.thread_id, threadId), eq(messages.author, 'ai')))).length, 0);
  });

  it('asks a person, without calling the model, once the month’s AI budget is spent (§10.2)', async () => {
    await db.update(workspaces).set({ settings: { ai: { monthly_budget_usd: 0.00001 } } }).where(eq(workspaces.id, workspaceId));
    const threadId = await dueThread(false);
    const { claude, requests } = stub(followUp('Hi Priya, worth a quick call? https://cal.getacme.com/alex'));
    const result = await composeWithAgent(db, { threadId, stepId: followUpStep, mailboxId, scheduledFor: now }, deps(claude));
    assert.deepEqual([result.status, requests.length], ['failed', 0]);
    const [escalation] = await db.select().from(escalations).where(eq(escalations.thread_id, threadId));
    assert.deepEqual([escalation!.reason, /AI budget for this month is spent/.test(escalation!.explanation)], ['ai_unavailable', true]);
  });
});
