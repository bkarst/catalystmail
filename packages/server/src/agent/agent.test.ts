import assert from 'node:assert/strict';

import { canaryFor, type ClaudeClient, type ClaudeRequest, type ClaudeResult, type InboundAnalysis, type JevAnswers, type JevClient, type JevState, type ReplyDraft } from '@catalyst/ai';
import { activities, ai_runs, campaign_goals, campaigns, contacts, escalations, knowledge_items, mailboxes, messages, newId, sending_domains, thread_goal_achievements, threads, type Db } from '@catalyst/db';
import { raiseEscalation } from '../escalations/raise.ts';
import { createTestDatabase } from '@catalyst/db/testing';
import { MemoryQueue } from '@catalyst/jobs';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { call, seedApiKey, seedWorkspace } from '../api/testing.ts';
import { setDb, setDeps } from '../runtime.ts';
import { aiBudget, levelOf, monthOf } from './budget.ts';
import { processInboundReply } from './inbound.ts';
import { classifyAfterOutbound, reclassifyCampaign } from './after-outbound.ts';
import { pinnedJevModel } from './jev.ts';
import { summarizeThread } from './summarize.ts';

// Needs a PostgreSQL server: set TEST_DATABASE_URL to any database on it.
const adminUrl = process.env.TEST_DATABASE_URL;

/** A Claude stand-in: answers by task from a script, and keeps every request. Nothing reaches the API. */
function scripted(script: { analyze?: Partial<InboundAnalysis> | 'refuse'; drafts?: Partial<ReplyDraft>[] }) {
  const requests: ClaudeRequest<unknown>[] = [];
  const drafts = [...(script.drafts ?? [])];
  const usage = { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0, costUsdMicros: 1400 };
  const ok = <T>(output: T): ClaudeResult<T> => ({ status: 'ok', output, model: 'claude-opus-5-5', stopReason: 'end_turn', usage, latencyMs: 5, attempts: 1 });
  const claude: ClaudeClient = {
    async run<T>(request: ClaudeRequest<T>): Promise<ClaudeResult<T>> {
      requests.push(request as ClaudeRequest<unknown>);
      if (request.task === 'analyze_inbound') {
        if (script.analyze === 'refuse') return { status: 'refusal', error: 'Declined.', model: 'claude-opus-5-5', stopReason: 'refusal', usage, latencyMs: 5, attempts: 1 };
        return ok({ ...ANALYSIS, ...script.analyze } as T);
      }
      return ok({ ...DRAFT, ...drafts.shift() } as T);
    },
  };
  return { claude, requests };
}

const ANALYSIS: InboundAnalysis = {
  kind: 'human_reply',
  ooo_return_date: null,
  intent: 'question',
  sentiment: 'positive',
  summary: 'Priya asks whether SSO is supported.',
  questions: [{ text: 'Do you support SAML SSO?', answerable_from_context: true, kb_item_ids: [] }],
  goal_signals: [],
  escalation: { required: false, reasons: [], explanation: '' },
  referral: null,
  follow_up_after: null,
  suspicious_instructions: false,
  language: 'en',
  confidence: 0.9,
};
const DRAFT: ReplyDraft = {
  subject: null,
  body_text: 'Hi Priya,\n\nYes: SAML SSO and SCIM are on every plan. Would a short call help? https://cal.getacme.com/alex',
  pursues_goal_id: '',
  addresses_questions: [0],
  kb_item_ids_used: [],
  claims: [],
  links_used: ['https://cal.getacme.com/alex'],
  confidence: 0.9,
  needs_human: false,
  needs_human_reason: null,
};

describe.skipIf(!adminUrl)('the agent answers a human reply (§10.4–§10.9)', () => {
  let db: Db;
  let drop: () => Promise<void>;
  let workspaceId: string;
  let campaignId: string;
  let mailboxId: string;
  let goalId: string;
  const jobs = new MemoryQueue();
  const now = new Date();
  const deps = (claude: ClaudeClient) => ({ claude, jobs, rng: () => 0.5, now, canarySecret: 'canary-key', trackingSecret: 'tracking', appHost: 'app.getacme.com' });

  /** A thread whose first email went out and that the contact answered with `text`. */
  async function replied(text: string): Promise<{ threadId: string; messageId: string; contactId: string }> {
    const contactId = newId('contact');
    await db.insert(contacts).values({ id: contactId, workspace_id: workspaceId, email: `p.${contactId.slice(-6)}@globex.example`, first_name: 'Priya', email_verification: 'valid', timezone: 'UTC' });
    const threadId = newId('thread');
    await db.insert(threads).values({ id: threadId, workspace_id: workspaceId, campaign_id: campaignId, contact_id: contactId, mailbox_id: mailboxId, stage: 'responded', stage_rank: 3, subject: 'Quick question', first_sent_at: new Date(now.getTime() - 86_400_000), responded_at: now });
    await db.insert(messages).values({ id: newId('message'), workspace_id: workspaceId, thread_id: threadId, mailbox_id: mailboxId, direction: 'outbound', status: 'sent', author: 'template', message_id_header: `<first.${threadId}@getacme.com>`, from_email: 'alex@getacme.com', to_emails: [], subject: 'Quick question', body_text: 'Hi Priya, how do you onboard today?', sent_at: new Date(now.getTime() - 86_400_000), created_at: new Date(now.getTime() - 86_400_000) });
    const messageId = newId('message');
    await db.insert(messages).values({ id: messageId, workspace_id: workspaceId, thread_id: threadId, mailbox_id: mailboxId, direction: 'inbound', status: 'received', author: 'contact', inbound_kind: 'human_reply', message_id_header: `<reply.${threadId}@globex.example>`, from_email: 'priya@globex.example', from_name: 'Priya', to_emails: [], subject: 'Re: Quick question', body_text: text, stripped_text: text, received_at: now });
    return { threadId, messageId, contactId };
  }

  beforeAll(async () => {
    ({ db, drop } = await createTestDatabase(adminUrl!));
    workspaceId = await seedWorkspace(db, 'Acme');
    const domainId = newId('domain');
    await db.insert(sending_domains).values({ id: domainId, workspace_id: workspaceId, domain: 'getacme.com' });
    mailboxId = newId('mailbox');
    await db.insert(mailboxes).values({ id: mailboxId, workspace_id: workspaceId, sending_domain_id: domainId, email: 'alex@getacme.com', display_name: 'Alex Rivera', signature_text: 'Alex Rivera\nAcme', auth: 'password', status: 'active', smtp_host: 's', smtp_port: 465, smtp_secure: 'tls', smtp_username: 'a', imap_host: 'i', imap_username: 'a', credentials_enc: Buffer.from('x'), credentials_key_version: 1, folders: {} });
    campaignId = newId('campaign');
    await db.insert(campaigns).values({ id: campaignId, workspace_id: workspaceId, name: 'Q4', objective: 'Book discovery calls.', status: 'active', persona: {}, links: { booking: 'https://cal.getacme.com/alex' }, sending_window: { days: [1, 2, 3, 4, 5, 6, 7], start: '00:00', end: '23:59' } });
    goalId = newId('goal');
    await db.insert(campaign_goals).values({ id: goalId, campaign_id: campaignId, position: 1, key: 'call', name: 'Call booked', success_criteria: 'Books a call', playbook: 'Offer the booking link.' });
    await db.insert(knowledge_items).values([
      { id: newId('knowledge_item'), workspace_id: workspaceId, kind: 'faq', title: 'SSO', content: 'SAML SSO and SCIM are on every plan.' },
      { id: newId('knowledge_item'), workspace_id: workspaceId, kind: 'pricing', title: 'Floor price', content: 'Never go below thirty dollars per seat for big enterprise deals.', visibility: 'internal' },
    ]);
  });
  afterAll(async () => {
    setDb(undefined);
    setDeps(undefined);
    await drop?.();
  });

  it('reads the reply, drafts an answer that passes its checks, and leaves it for approval while Jev is off', async () => {
    const { threadId, messageId } = await replied('Do you support SAML SSO?');
    const { claude, requests } = scripted({ drafts: [{ pursues_goal_id: goalId }] });
    const result = await processInboundReply(db, messageId, deps(claude));
    assert.equal(result.outcome, 'drafted');
    assert.deepEqual(result.outcome === 'drafted' && [result.status, result.approvalReasons.includes('classification_fallback')], ['pending_approval', true]);
    const [draft] = await db.select().from(messages).where(eq(messages.id, (result as { draftId: string }).draftId));
    assert.deepEqual([draft!.author, draft!.status, draft!.subject, draft!.in_reply_to_header, draft!.goal_id], ['ai', 'pending_approval', 'Re: Quick question', `<reply.${threadId}@globex.example>`, goalId]);
    assert.match(draft!.body_text!, /on every plan[\s\S]*Alex Rivera\nAcme/, 'with the signature');

    const system = requests[0]!.system.map((block) => block.text).join('\n');
    assert.ok(system.includes('SAML SSO and SCIM are on every plan.'), 'shareable knowledge goes to the model');
    assert.ok(!system.includes('thirty dollars'), 'internal knowledge never does');
    assert.match(requests[1]!.user.at(-1)!.text, /<analysis>/);

    const runs = await db.select().from(ai_runs).where(eq(ai_runs.thread_id, threadId));
    assert.deepEqual(runs.map((run) => [run.task, run.status, run.decision]).sort(), [['analyze_inbound', 'ok', null], ['draft_reply', 'ok', 'queue_approval']]);
    assert.equal(runs[0]!.cost_usd_micros, 1400);
    const [thread] = await db.select().from(threads).where(eq(threads.id, threadId));
    assert.deepEqual([thread!.latest_intent, thread!.ai_summary], ['question', 'Priya asks whether SSO is supported.']);
    assert.equal((await db.select().from(escalations).where(eq(escalations.thread_id, threadId))).length, 0);
  });

  it('escalates a knowledge gap with the questions, and attaches the draft as a suggestion', async () => {
    const { threadId, messageId } = await replied('Is it HIPAA ready?');
    const { claude } = scripted({
      analyze: { questions: [{ text: 'Is it HIPAA ready?', answerable_from_context: false, kb_item_ids: [] }], escalation: { required: true, reasons: ['knowledge_gap'], explanation: 'The knowledge base doesn’t cover HIPAA.' } },
      drafts: [{ body_text: 'Hi Priya, good question. Let me check with the team and come back to you.', needs_human: true, needs_human_reason: 'HIPAA isn’t covered.' }],
    });
    const result = await processInboundReply(db, messageId, deps(claude));
    assert.equal(result.outcome, 'escalated');
    const [gap] = await db.select().from(escalations).where(and(eq(escalations.thread_id, threadId), eq(escalations.reason, 'knowledge_gap')));
    assert.deepEqual(gap!.questions, [{ text: 'Is it HIPAA ready?', why_unanswerable: 'The knowledge base doesn’t answer it.' }]);
    assert.equal(gap!.suggested_draft_id, (result as { draftId: string }).draftId);
  });

  it('revises a draft that fails its checks once, then escalates with the draft attached (§10.9)', async () => {
    const { threadId, messageId } = await replied('Can you send me your pricing?');
    const bad = { body_text: 'Sure, see https://evil.example/pricing and you get 40% off.' };
    const { claude, requests } = scripted({ drafts: [bad, bad] });
    const result = await processInboundReply(db, messageId, deps(claude));
    assert.equal(result.outcome, 'escalated');
    assert.match(requests[2]!.user.at(-1)!.text, /Your previous draft failed these checks[\s\S]*evil\.example/, 'the revision sees the failures');
    const [failed] = await db.select().from(escalations).where(and(eq(escalations.thread_id, threadId), eq(escalations.reason, 'guardrail_failed')));
    assert.ok(failed!.suggested_draft_id);
    assert.equal((await db.select().from(messages).where(eq(messages.id, failed!.suggested_draft_id!)))[0]!.status, 'pending_approval');
    const runs = await db.select().from(ai_runs).where(and(eq(ai_runs.thread_id, threadId), eq(ai_runs.task, 'draft_reply')));
    assert.deepEqual(runs.map((run) => run.status), ['guardrail_blocked', 'guardrail_blocked']);
  });

  it('unsubscribes on a clear request, and postpones follow-ups on an out-of-office', async () => {
    const leaving = await replied('Please take me off your list.');
    const unsubscribe = await processInboundReply(db, leaving.messageId, deps(scripted({ analyze: { kind: 'unsubscribe_request', intent: 'unsubscribe', confidence: 0.95 } }).claude));
    assert.equal(unsubscribe.outcome, 'unsubscribed');
    assert.equal((await db.select().from(contacts).where(eq(contacts.id, leaving.contactId)))[0]!.subscription_status, 'unsubscribed');

    const away = await replied('I am out of the office until 2030-01-07.');
    const ooo = await processInboundReply(db, away.messageId, deps(scripted({ analyze: { kind: 'out_of_office', ooo_return_date: '2030-01-07', confidence: 0.95 } }).claude));
    assert.deepEqual(ooo, { outcome: 'out_of_office', until: '2030-01-07' });
    const [thread] = await db.select().from(threads).where(eq(threads.id, away.threadId));
    assert.equal(thread!.follow_ups_not_before?.toISOString(), '2030-01-08T09:00:00.000Z', 'the next business day after the return');
  });

  it('hands the reply to a person when Claude declines, and logs the run', async () => {
    const { threadId, messageId } = await replied('Hello?');
    const result = await processInboundReply(db, messageId, deps(scripted({ analyze: 'refuse' }).claude));
    assert.deepEqual(result, { outcome: 'escalated', reasons: ['ai_unavailable'], draftId: null });
    assert.equal((await db.select().from(ai_runs).where(eq(ai_runs.thread_id, threadId)))[0]!.status, 'refusal');
    assert.ok((await db.select().from(activities).where(and(eq(activities.thread_id, threadId), eq(activities.type, 'escalation.created')))).length === 1);
  });

  it('answers for the agent: redrafts with the answer, keeps it as knowledge, resolves the escalation (§11.3)', async () => {
    setDb(db);
    const { secret: key } = await seedApiKey(db, workspaceId, ['escalations:write', 'threads:write', 'knowledge:read']);
    const { threadId, messageId } = await replied('Do you sign BAAs?');
    const { id: escalationId } = await raiseEscalation(db, { workspaceId, threadId, reason: 'knowledge_gap', title: 'Asked: Do you sign BAAs?', explanation: 'Not in the knowledge base.', triggerMessageId: messageId, questions: [{ text: 'Do you sign BAAs?', why_unanswerable: 'Not covered.' }] }, now);

    setDeps({ jobs, claude: null, config: { trackingTarget: null, appHost: null } });
    const off = await call('POST', `/escalations/${escalationId}/answer`, { key, body: { answer: 'Yes, on the Enterprise plan.' } });
    assert.deepEqual([off.status, off.body.code], [503, 'ai_unavailable']);
    assert.equal((await db.select().from(escalations).where(eq(escalations.id, escalationId)))[0]!.status, 'open', 'nothing changed');

    const { claude, requests } = scripted({ drafts: [{ body_text: 'Hi Priya, yes: we sign BAAs on the Enterprise plan. Shall we talk? https://cal.getacme.com/alex' }] });
    setDeps({ claude });
    const answered = await call('POST', `/escalations/${escalationId}/answer`, { key, body: { answer: 'Yes, we sign BAAs on the Enterprise plan.', knowledge_scope: 'workspace' } });
    assert.equal(answered.status, 200, JSON.stringify(answered.body));
    assert.deepEqual([answered.body.escalation.status, answered.body.escalation.resolution, answered.body.draft.status, answered.body.draft.author], ['resolved', 'answered_for_ai', 'pending_approval', 'ai']);
    assert.match(requests.at(-1)!.user.at(-1)!.text, /<operator_answer[^>]*>\nYes, we sign BAAs on the Enterprise plan\./);
    const [item] = await db.select().from(knowledge_items).where(eq(knowledge_items.id, answered.body.knowledge_item_id));
    assert.deepEqual([item!.title, item!.content, item!.source, item!.source_escalation_id, item!.campaign_id], ['Do you sign BAAs?', 'Yes, we sign BAAs on the Enterprise plan.', 'escalation', escalationId, null]);
    assert.equal((await call('POST', `/escalations/${escalationId}/answer`, { key, body: { answer: 'Again' } })).status, 409);
  });

  it('drafts on request with guidance, never sending on its own', async () => {
    const { secret: key } = await seedApiKey(db, workspaceId, ['threads:write']);
    const { threadId } = await replied('Any time next week?');
    const { claude, requests } = scripted({ drafts: [{ body_text: 'Hi Priya, Thursday or Friday afternoon both work. https://cal.getacme.com/alex', confidence: 0.99 }] });
    setDeps({ claude });
    const drafted = await call('POST', `/threads/${threadId}/ai-draft`, { key, body: { guidance: 'Offer Thursday or Friday afternoon.' } });
    assert.equal(drafted.status, 201, JSON.stringify(drafted.body));
    assert.deepEqual([drafted.body.status, drafted.body.author], ['pending_approval', 'ai']);
    assert.match(requests[0]!.user.at(-1)!.text, /<guidance>\nOffer Thursday or Friday afternoon\./);
    const { secret: otherKey } = await seedApiKey(db, await seedWorkspace(db, 'Other'), ['threads:write']);
    assert.equal((await call('POST', `/threads/${threadId}/ai-draft`, { key: otherKey, body: {} })).status, 404);
  });

  it('reclassifies on request without acting again, and lists Claude’s analyses as classifications', async () => {
    const { secret: key } = await seedApiKey(db, workspaceId, ['threads:read', 'threads:write']);
    const { threadId } = await replied('Interesting. Pricing?');
    const { claude } = scripted({ analyze: { intent: 'interested', summary: 'Wants pricing.', confidence: 0.8 } });
    setDeps({ claude });
    const classified = await call('POST', `/threads/${threadId}/classify`, { key });
    assert.equal(classified.status, 200, JSON.stringify(classified.body));
    assert.deepEqual([classified.body.provider, classified.body.classifier_version, classified.body.output.intent], ['anthropic', 'analyze_inbound.v1', 'interested']);
    const [thread] = await db.select().from(threads).where(eq(threads.id, threadId));
    assert.deepEqual([thread!.latest_intent, thread!.classification_run_id], ['interested', classified.body.id]);
    assert.equal((await db.select().from(messages).where(and(eq(messages.thread_id, threadId), eq(messages.author, 'ai')))).length, 0, 'no draft: nothing acts again');
    const listed = await call('GET', `/threads/${threadId}/classifications`, { key });
    assert.deepEqual(listed.body.data.map((entry: { id: string }) => entry.id), [classified.body.id]);

    const contactId = newId('contact');
    await db.insert(contacts).values({ id: contactId, workspace_id: workspaceId, email: 'quiet@globex.example' });
    const silent = newId('thread');
    await db.insert(threads).values({ id: silent, workspace_id: workspaceId, campaign_id: campaignId, contact_id: contactId });
    assert.equal((await call('POST', `/threads/${silent}/classify`, { key })).status, 409);
  });

  it('tests the knowledge base: answers with citations, or says it would escalate', async () => {
    const { secret: key } = await seedApiKey(db, workspaceId, ['knowledge:read']);
    const [sso] = await db.select().from(knowledge_items).where(eq(knowledge_items.title, 'SSO'));
    const answering = (output: Record<string, unknown>): ClaudeClient => ({
      run: async <T,>(request: ClaudeRequest<T>) => {
        assert.ok(!request.system.map((block) => block.text).join('\n').includes('thirty dollars'), 'internal items stay out');
        return { status: 'ok', output: output as T, model: 'claude-opus-5-5', stopReason: 'end_turn', usage: null as never, latencyMs: 1, attempts: 1 };
      },
    });
    setDeps({ claude: answering({ answerable: true, answer: 'Yes, SAML SSO and SCIM are on every plan.', kb_item_ids: [sso!.id] }) });
    const yes = await call('POST', '/knowledge/test', { key, body: { question: 'Do you do SSO?', campaign_id: campaignId } });
    assert.equal(yes.status, 200, JSON.stringify(yes.body));
    assert.deepEqual(yes.body, { answerable: true, answer: 'Yes, SAML SSO and SCIM are on every plan.', citations: [{ id: sso!.id, title: 'SSO' }] });
    setDeps({ claude: answering({ answerable: true, answer: 'Probably.', kb_item_ids: [] }) });
    assert.deepEqual((await call('POST', '/knowledge/test', { key, body: { question: 'Do you do HIPAA?' } })).body, { answerable: false, answer: null, citations: [] }, 'an answer citing nothing is a gap');
    setDeps({ claude: null });
    assert.equal((await call('POST', '/knowledge/test', { key, body: { question: 'Anything?' } })).status, 503);
  });

  it('runs each task on the workspace’s model and effort from Settings → AI (§10.2)', async () => {
    const { secret: key } = await seedApiKey(db, workspaceId, ['settings:manage']);
    setDb(db);
    setDeps({ jobs, config: { trackingTarget: null, appHost: null } });
    type TaskRow = { task: string; model: string; effort: string; overridden: boolean };
    const rows = async () => (await call('GET', '/settings', { key })).body.ai.tasks as TaskRow[];
    assert.deepEqual((await rows()).find((row) => row.task === 'analyze_inbound'), { task: 'analyze_inbound', model: 'claude-opus-5-5', effort: 'low', overridden: false });

    const set = await call('PATCH', '/settings', { key, body: { ai: { tasks: { analyze_inbound: { model: 'claude-haiku-5-5' }, draft_reply: { effort: 'high' } } } } });
    assert.equal(set.status, 200, JSON.stringify(set.body));
    assert.deepEqual(set.body.ai.tasks.filter((row: TaskRow) => row.overridden).map((row: TaskRow) => [row.task, row.model, row.effort]), [['analyze_inbound', 'claude-haiku-5-5', 'low'], ['draft_reply', 'claude-opus-5-5', 'high']]);
    const unknown = await call('PATCH', '/settings', { key, body: { ai: { tasks: { summarize: { model: 'claude-mystery-1' } } } } });
    assert.equal(unknown.status, 400, 'a model whose prices are unknown would slip past the budget');

    const { messageId } = await replied('Do you support SAML SSO?');
    const { claude, requests } = scripted({ drafts: [{ pursues_goal_id: goalId }] });
    await processInboundReply(db, messageId, deps(claude));
    assert.deepEqual(requests.map((request) => [request.task, request.settings.model, request.settings.effort]), [['analyze_inbound', 'claude-haiku-5-5', 'low'], ['draft_reply', 'claude-opus-5-5', 'high']]);

    await call('PATCH', '/settings', { key, body: { ai: { tasks: { analyze_inbound: null, draft_reply: null } } } });
    assert.ok((await rows()).every((row) => !row.overridden), 'null puts a task back on the default');
  });

  it('says an email was written with AI under the signature when the workspace asks, and only for the agent’s (§10.9)', async () => {
    const { secret: key } = await seedApiKey(db, workspaceId, ['settings:manage', 'threads:write']);
    setDb(db);
    setDeps({ jobs, config: { trackingTarget: null, appHost: null } });
    const set = await call('PATCH', '/settings', { key, body: { ai: { disclosure: 'signature_line' } } });
    assert.equal(set.body.ai.disclosure, 'signature_line');

    const { threadId, messageId } = await replied('Do you support SAML SSO?');
    const drafted = await processInboundReply(db, messageId, deps(scripted({ drafts: [{ pursues_goal_id: goalId }] }).claude));
    const [draft] = await db.select().from(messages).where(eq(messages.id, (drafted as { draftId: string }).draftId));
    assert.match(draft!.body_text!, /Alex Rivera\nAcme\n\nWritten with help from an AI assistant\./);
    const mine = await call('POST', `/threads/${threadId}/replies`, { key, body: { body_text: 'Yes, on every plan.', mode: 'draft' } });
    const [written] = await db.select().from(messages).where(eq(messages.id, mine.body.id));
    assert.ok(!written!.body_text!.includes('AI assistant'), 'a person’s own email says nothing');

    await call('PATCH', '/settings', { key, body: { ai: { disclosure: 'none' } } });
  });

  it('proposes a check-in for "not now, try in March" while Jev is off, naming the date (§10.4)', async () => {
    const { threadId, messageId } = await replied('Not now, we are mid-migration. Try me in March?');
    const result = await processInboundReply(db, messageId, deps(scripted({ analyze: { intent: 'not_now', follow_up_after: '2027-03-01', questions: [] }, drafts: [{ pursues_goal_id: goalId }] }).claude));
    assert.equal(result.outcome, 'escalated');
    const [proposal] = await db.select().from(escalations).where(and(eq(escalations.thread_id, threadId), eq(escalations.reason, 'low_confidence')));
    assert.match(proposal!.explanation, /from 2027-03-01[\s\S]*scheduleCheckIn for 2027-03-01/);
    const [thread] = await db.select().from(threads).where(eq(threads.id, threadId));
    assert.equal(thread!.check_in_at, null, 'nothing is scheduled on Claude’s word alone');
  });

  it('keeps a rolling summary of the thread, from the one before and the newest emails (§10.1)', async () => {
    const { threadId, messageId } = await replied('Do you support SAML SSO?');
    jobs.clear();
    await processInboundReply(db, messageId, deps(scripted({ drafts: [{ pursues_goal_id: goalId }] }).claude));
    assert.deepEqual(jobs.of('ai.summarize'), [{ thread_id: threadId }]);
    const summaryOf = async () => (await db.select({ summary: threads.ai_summary }).from(threads).where(eq(threads.id, threadId)))[0]!.summary;
    assert.equal(await summaryOf(), 'Priya asks whether SSO is supported.', 'the analysis gives the first summary');

    const requests: ClaudeRequest<unknown>[] = [];
    const summarizer = (summary: string): ClaudeClient => ({
      run: async <T,>(request: ClaudeRequest<T>) => {
        requests.push(request as ClaudeRequest<unknown>);
        return { status: 'ok', output: { summary } as T, model: 'claude-opus-5-5', stopReason: 'end_turn', usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, costUsdMicros: 30 }, latencyMs: 1, attempts: 1 };
      },
    });
    const rolling = 'Priya asked whether SAML SSO is supported. We confirmed it is on every plan and offered a short call; she hasn’t answered yet.';
    const later = new Date(now.getTime() + 60_000);
    assert.deepEqual(await summarizeThread(db, threadId, { ...deps(summarizer(rolling)), now: later }), { status: 'summarized', summary: rolling });
    const asked = requests[0]!.user.map((block) => block.text).join('\n');
    assert.match(asked, /Summary so far: Priya asks whether SSO is supported\./, 'it starts from the summary so far');
    assert.match(asked, /<thread>[\s\S]*Do you support SAML SSO\?/);
    assert.match(requests[0]!.user.at(-1)!.text, /Write the summary of this conversation so far/);
    assert.equal(await summaryOf(), rolling);
    const runs = await db.select().from(ai_runs).where(and(eq(ai_runs.thread_id, threadId), eq(ai_runs.task, 'summarize')));
    assert.deepEqual(runs.map((run) => [run.status, run.effort]), [['ok', 'low']]);

    // A summary carrying the canary token (leaked instructions) isn't kept.
    const leaked = await summarizeThread(db, threadId, { ...deps(summarizer(`Summary. ${canaryFor(campaignId, 'canary-key')}`)), now: later });
    assert.deepEqual([leaked, await summaryOf()], [{ status: 'failed', why: 'leak' }, rolling]);

    // The next reply's analysis leaves the rolling summary alone; the job brings it up to date.
    const next = newId('message');
    await db.insert(messages).values({ id: next, workspace_id: workspaceId, thread_id: threadId, mailbox_id: mailboxId, direction: 'inbound', status: 'received', author: 'contact', inbound_kind: 'human_reply', message_id_header: `<next.${threadId}@globex.example>`, from_email: 'priya@globex.example', to_emails: [], subject: 'Re: Quick question', body_text: 'Does it include SCIM?', stripped_text: 'Does it include SCIM?', received_at: later });
    await processInboundReply(db, next, { ...deps(scripted({ drafts: [{ pursues_goal_id: goalId }] }).claude), now: later });
    assert.equal(await summaryOf(), rolling);
  });

  it('reports what the agent cost and how its runs went, for Settings → AI (§10.2)', async () => {
    const { secret: key } = await seedApiKey(db, workspaceId, ['settings:manage']);
    const { secret: otherKey } = await seedApiKey(db, await seedWorkspace(db, 'Elsewhere'), ['settings:manage']);
    setDb(db);
    setDeps({ jobs, config: { trackingTarget: null, appHost: null } });
    const runs = await db.select().from(ai_runs).where(eq(ai_runs.workspace_id, workspaceId));
    const usage = await call('GET', '/settings/ai/usage?days=7', { key });
    assert.equal(usage.status, 200, JSON.stringify(usage.body));
    assert.equal(usage.body.total.runs, runs.length);
    assert.equal(usage.body.total.cost_usd, runs.reduce((sum, run) => sum + (run.cost_usd_micros ?? 0), 0) / 1_000_000);
    const tasks = Object.fromEntries(usage.body.by_task.map((row: { task: string; runs: number; failed: number }) => [row.task, row]));
    assert.equal(tasks.analyze_inbound.runs, runs.filter((run) => run.task === 'analyze_inbound').length);
    assert.equal(tasks.analyze_inbound.failed, runs.filter((run) => run.task === 'analyze_inbound' && run.status === 'refusal').length, 'the declined read counts as failed');
    assert.equal(usage.body.by_day.reduce((sum: number, row: { runs: number }) => sum + row.runs, 0), runs.length);
    assert.deepEqual([usage.body.classification_fallback_rate, usage.body.budget.level], [1, 'unlimited']);
    const none = (await call('GET', '/settings/ai/usage', { key: otherKey })).body;
    assert.deepEqual([none.total.runs, none.by_task, none.classification_fallback_rate], [0, [], 0]);
  });

  describe('with Jev classifying (§10.4)', () => {
    /** A scripted Jev: answers every question it is asked; nothing reaches TypeSafe. */
    function scriptedJev(overrides: { nouls?: Record<string, number>; intent?: [string, number]; kind?: [string, number]; fail?: boolean } = {}) {
      const calls: { state: JevState; questions: Record<string, { type: string }>; model: string }[] = [];
      const jev: JevClient = {
        async classify(input) {
          calls.push(input as never);
          if (overrides.fail) return { status: 'error', error: '503 from TypeSafe', model: input.model, latencyMs: 5 };
          const answers: JevAnswers = {};
          for (const [name, question] of Object.entries(input.questions)) {
            if (question.type === 'noul') answers[name] = { type: 'noul', noul: overrides.nouls?.[name] ?? (name === 'needs_reply' ? 0.95 : 0.02) };
            else if (name === 'intent') answers[name] = { type: 'choice', choice: (overrides.intent ?? ['question', 0.9])[0], confidence: 0.9, probabilities: { [(overrides.intent ?? ['question', 0.9])[0]]: (overrides.intent ?? ['question', 0.9])[1] } };
            else if (name === 'kind') answers[name] = { type: 'choice', choice: (overrides.kind ?? ['human_reply', 0.97])[0], confidence: 0.97, probabilities: { [(overrides.kind ?? ['human_reply', 0.97])[0]]: (overrides.kind ?? ['human_reply', 0.97])[1] } };
            else answers[name] = { type: 'score', score: name === 'sentiment' ? 3 : 2, confidence: 0.8, probabilities: {} };
          }
          return { status: 'ok', answers, model: input.model, usage: { inputTokens: 1200, outputTokens: 40, costUsdMicros: 50 }, latencyMs: 90 };
        },
      };
      return { jev, calls };
    }
    const withJev = (claude: ClaudeClient, jev: JevClient) => ({ ...deps(claude), jev, jevModel: 'jev-1.13.0' });

    it('classifies first; when both models agree and are sure, the reply sends on its own (assisted)', async () => {
      const { threadId, messageId } = await replied('Do you support SAML SSO?');
      const { jev, calls } = scriptedJev();
      const result = await processInboundReply(db, messageId, withJev(scripted({ drafts: [{ pursues_goal_id: goalId }] }).claude, jev));
      assert.deepEqual([result.outcome, result.outcome === 'drafted' && result.status], ['drafted', 'scheduled']);
      const [call] = calls;
      assert.equal(call!.model, 'jev-1.13.0');
      assert.ok(['kind', 'needs_reply', 'intent', 'sentiment', 'temperature', 'unsubscribe', 'goal_call', 'esc_pricing_negotiation', 'esc_meeting_logistics', 'suspicious'].every((name) => name in call!.questions));
      assert.ok(!JSON.stringify(call!.state).includes('@globex.example'), 'no addresses go to Jev');
      const [thread] = await db.select().from(threads).where(eq(threads.id, threadId));
      assert.deepEqual([thread!.classification_fallback, thread!.latest_intent, thread!.temperature, thread!.latest_sentiment], [false, 'question', '2.00', 'positive']);
      const [reply] = await db.select().from(messages).where(eq(messages.id, messageId));
      assert.equal(reply!.needs_reply_p, '0.950');
      const [run] = await db.select().from(ai_runs).where(and(eq(ai_runs.thread_id, threadId), eq(ai_runs.task, 'classify_conversation')));
      assert.deepEqual([run!.provider, run!.model, run!.prompt_version, run!.status, run!.cost_usd_micros], ['typesafe', 'jev-1.13.0', 'conversation.v1', 'ok', 50]);
    });

    it('settles a sign-off alone, without Claude; the conversation then waits on the contact', async () => {
      const { messageId } = await replied('Thanks, talk Thursday!');
      const { claude, requests } = scripted({});
      const result = await processInboundReply(db, messageId, withJev(claude, scriptedJev({ nouls: { needs_reply: 0.1 }, intent: ['neutral', 0.9] }).jev));
      assert.deepEqual(result, { outcome: 'no_reply', reasons: [] });
      assert.equal(requests.length, 0, 'Claude isn’t asked');
      assert.equal((await db.select().from(messages).where(eq(messages.id, messageId)))[0]!.needs_reply_p, '0.100');
    });

    it('unsubscribes on Jev’s word alone, and falls back to Claude when Jev fails', async () => {
      const { messageId } = await replied('Please remove me from your list.');
      assert.deepEqual(await processInboundReply(db, messageId, withJev(scripted({}).claude, scriptedJev({ nouls: { unsubscribe: 0.96, needs_reply: 0.2 }, intent: ['unsubscribe', 0.95] }).jev)), { outcome: 'unsubscribed' });

      const failing = await replied('Do you support SAML SSO?');
      const result = await processInboundReply(db, failing.messageId, withJev(scripted({ drafts: [{ pursues_goal_id: goalId }] }).claude, scriptedJev({ fail: true }).jev));
      assert.equal(result.outcome === 'drafted' && result.status, 'pending_approval');
      const [thread] = await db.select().from(threads).where(eq(threads.id, failing.threadId));
      assert.equal(thread!.classification_fallback, true, 'Claude alone: nothing sends on its own');
      const [run] = await db.select().from(ai_runs).where(and(eq(ai_runs.thread_id, failing.threadId), eq(ai_runs.task, 'classify_conversation')));
      assert.equal(run!.status, 'error');
    });

    it('records a goal Jev is sure of, when the goal allows auto-confirmation', async () => {
      await db.update(campaign_goals).set({ auto_confirm: true }).where(eq(campaign_goals.id, goalId));
      const { threadId, messageId } = await replied('Booked Thursday 2pm via your link.');
      await processInboundReply(db, messageId, withJev(scripted({ drafts: [{ pursues_goal_id: goalId }] }).claude, scriptedJev({ nouls: { goal_call: 0.95 }, intent: ['meeting_request', 0.9] }).jev));
      const [achieved] = await db.select().from(thread_goal_achievements).where(eq(thread_goal_achievements.thread_id, threadId));
      assert.deepEqual([achieved!.goal_id, achieved!.method, achieved!.confidence], [goalId, 'ai', '0.950']);
      await db.update(campaign_goals).set({ auto_confirm: false }).where(eq(campaign_goals.id, goalId));
    });

    it('reclassifies on request through Jev when it is set up', async () => {
      const { threadId } = await replied('Do you support SAML SSO?');
      const { secret: key } = await seedApiKey(db, workspaceId, ['threads:read', 'threads:write']);
      setDb(db);
      setDeps({ jobs, claude: scripted({}).claude, jev: scriptedJev({ intent: ['question', 0.88] }).jev, config: { trackingTarget: null, appHost: null, jevModel: 'jev-1.13.0' } });
      const classified = await call('POST', `/threads/${threadId}/classify`, { key });
      assert.equal(classified.status, 200, JSON.stringify(classified.body));
      assert.deepEqual([classified.body.provider, classified.body.classifier_version, classified.body.model], ['typesafe', 'conversation.v1', 'jev-1.13.0']);
      const [thread] = await db.select().from(threads).where(eq(threads.id, threadId));
      assert.deepEqual([thread!.latest_intent, thread!.latest_intent_p, thread!.classification_fallback], ['question', '0.880', false]);
      setDeps({ jev: null, config: { trackingTarget: null, appHost: null, jevModel: null } });
    });

    it('reads a person’s own email too: only goals act on it, so a person confirms one Jev sees', async () => {
      const { threadId } = await replied('Can we talk this week?');
      const mine = newId('message');
      await db.insert(messages).values({ id: mine, workspace_id: workspaceId, thread_id: threadId, mailbox_id: mailboxId, direction: 'outbound', status: 'sent', author: 'human_app', message_id_header: `<mine.${threadId}@getacme.com>`, from_email: 'alex@getacme.com', to_emails: [], subject: 'Re: Quick question', body_text: 'Great, you’re booked for Thursday at 2pm.', sent_at: now, created_at: now });
      const { jev, calls } = scriptedJev({ nouls: { goal_call: 0.9 }, intent: ['meeting_request', 0.85] });
      const result = await classifyAfterOutbound(db, mine, { jev, jevModel: 'jev-1.13.0', jobs, now, canarySecret: 'canary-key' });
      assert.deepEqual(result, { status: 'classified', achieved: [], confirm: ['call'] }, 'the goal doesn’t auto-confirm here, so a person is asked');
      assert.deepEqual(Object.keys(calls[0]!.questions).sort(), ['goal_call', 'intent', 'sentiment', 'temperature'], 'only the whole-conversation questions');
      const [escalation] = await db.select().from(escalations).where(and(eq(escalations.thread_id, threadId), eq(escalations.reason, 'goal_confirmation')));
      assert.deepEqual([escalation?.goal_id, escalation?.goal_p], [goalId, '0.900'], 'it names the goal to confirm');
      assert.deepEqual(await classifyAfterOutbound(db, mine, { jev: null, jevModel: null, jobs, now, canarySecret: 'k' }), { status: 'skipped', why: 'Jev isn’t set up' });
    });

    it('reads a campaign’s open conversations again when its goals change', async () => {
      await replied('What would onboarding look like for us?');
      const { jev, calls } = scriptedJev({ nouls: { goal_call: 0.6 } });
      const before = calls.length;
      const result = await reclassifyCampaign(db, campaignId, { jev, jevModel: 'jev-1.13.0', jobs, now, canarySecret: 'canary-key' });
      assert.ok(result.classified >= 1);
      assert.equal(calls.length - before, result.classified);
      assert.deepEqual(await reclassifyCampaign(db, campaignId, { jev: null, jevModel: null, jobs, now, canarySecret: 'k' }), { classified: 0, skipped: 0 }, 'nothing without Jev');
    });

    it('keeps Jev on a pinned version only', () => {
      assert.deepEqual([pinnedJevModel('jev-1.13.0'), pinnedJevModel('jev-latest'), pinnedJevModel(undefined), pinnedJevModel('jev-1.13')], ['jev-1.13.0', null, null, null]);
    });

    it('takes the workspace’s pin and thresholds from Settings → AI, within the guardrails (§22.B)', async () => {
      const { secret: key } = await seedApiKey(db, workspaceId, ['settings:manage']);
      setDb(db);
      setDeps({ jobs, config: { trackingTarget: null, appHost: null, jevModel: 'jev-1.13.0' } });
      const patch = (ai: Record<string, unknown>) => call('PATCH', '/settings', { key, body: { ai } });
      const shown = (await call('GET', '/settings', { key })).body.ai.jev;
      assert.deepEqual([shown.model, shown.pinned_by, shown.thresholds.autoSendIntent, shown.thresholds_updated_at], ['jev-1.13.0', 'deployment', 0.7, null]);
      assert.equal((await patch({ thresholds: { mandatoryEscalate: 0.6 } })).status, 400, 'mandatory escalations can’t be made harder to raise');
      assert.equal((await patch({ thresholds: { unsubscribeAsk: 0.8 } })).status, 400, 'the ask band stays below the act band');
      assert.equal((await patch({ jev_model: 'jev-latest' })).status, 400);
      const set = await patch({ thresholds: { autoSendIntent: 0.8 }, jev_model: 'jev-1.14.0' });
      assert.equal(set.status, 200, JSON.stringify(set.body));
      assert.deepEqual([set.body.ai.jev.model, set.body.ai.jev.pinned_by, set.body.ai.jev.thresholds.autoSendIntent], ['jev-1.14.0', 'workspace', 0.8]);
      assert.ok(set.body.ai.jev.thresholds_updated_at);

      // With the bar at 0.8, a reply Jev reads as a question at 0.75 waits for a person, on the workspace's pin.
      const { messageId } = await replied('Do you support SAML SSO?');
      const { jev, calls } = scriptedJev({ intent: ['question', 0.75] });
      const result = await processInboundReply(db, messageId, withJev(scripted({ drafts: [{ pursues_goal_id: goalId }] }).claude, jev));
      assert.equal(result.outcome === 'drafted' && result.status, 'pending_approval');
      assert.equal(calls[0]!.model, 'jev-1.14.0');

      await patch({ thresholds: null, jev_model: null });
      assert.equal((await call('GET', '/settings', { key })).body.ai.jev.thresholds.autoSendIntent, 0.7);
      setDeps({ config: { trackingTarget: null, appHost: null, jevModel: null } });
    });
  });

  // Last: it spends the workspace's budget.
  it('keeps to the monthly AI budget: tells at 80%, stops at 100% and hands replies to a person (§10.2)', async () => {
    const { secret: key } = await seedApiKey(db, workspaceId, ['settings:manage', 'knowledge:read']);
    const { secret: otherKey } = await seedApiKey(db, await seedWorkspace(db, 'Other'), ['settings:manage']);
    setDb(db);
    setDeps({ jobs, config: { trackingTarget: null, appHost: null } });
    const unlimited = (await call('GET', '/settings', { key })).body.ai;
    assert.deepEqual([unlimited.monthly_budget_usd, unlimited.level, unlimited.used], [null, 'unlimited', null]);
    assert.ok(unlimited.spent_usd > 0, 'the runs so far count');

    const set = await call('PATCH', '/settings', { key, body: { ai: { monthly_budget_usd: 1 } } });
    assert.equal(set.status, 200, JSON.stringify(set.body));
    /** Spend made up to `usd` with one run of the difference. */
    const spendTo = async (usd: number) => {
      const spent = (await aiBudget(db, workspaceId, now)).spent_usd;
      await db.insert(ai_runs).values({ id: newId('ai_run'), workspace_id: workspaceId, task: 'draft_reply', model: 'claude-opus-5-5', prompt_version: 'draft_reply.v1', status: 'ok', cost_usd_micros: Math.round((usd - spent) * 1_000_000), created_at: now });
    };
    const alerts = async () => (await db.select({ type: activities.type, data: activities.data }).from(activities).where(and(eq(activities.workspace_id, workspaceId), inArray(activities.type, ['ai.budget_warning', 'ai.budget_exhausted'])))).map((row) => row.type);

    // 1. Past 80%: one warning, however many runs follow.
    await spendTo(0.85);
    for (let index = 0; index < 2; index += 1) {
      const { messageId } = await replied('Do you support SAML SSO?');
      assert.equal((await processInboundReply(db, messageId, deps(scripted({ drafts: [{ pursues_goal_id: goalId }] }).claude))).outcome, 'drafted');
    }
    assert.deepEqual(await alerts(), ['ai.budget_warning']);
    assert.equal((await call('GET', '/settings', { key })).body.ai.level, 'warning');

    // 2. The run that reaches 100% finishes; the next reply goes to a person without a model call.
    await spendTo(0.9995);
    const { messageId: crossing } = await replied('Do you support SAML SSO?');
    await processInboundReply(db, crossing, deps(scripted({ drafts: [{ pursues_goal_id: goalId }] }).claude));
    assert.deepEqual(await alerts(), ['ai.budget_warning', 'ai.budget_exhausted']);
    const { threadId, messageId } = await replied('Do you support SAML SSO?');
    const { claude, requests } = scripted({});
    assert.deepEqual(await processInboundReply(db, messageId, deps(claude)), { outcome: 'escalated', reasons: ['ai_unavailable'], draftId: null });
    assert.equal(requests.length, 0);
    const [escalation] = await db.select().from(escalations).where(eq(escalations.thread_id, threadId));
    assert.match(escalation!.explanation, /AI budget for this month is spent/);
    const stopped = (await call('GET', '/settings', { key })).body.ai;
    assert.deepEqual([stopped.level, stopped.used >= 1], ['exhausted', true]);

    // 3. The API's AI operations say so too.
    setDeps({ claude: scripted({}).claude });
    const refused = await call('POST', '/knowledge/test', { key, body: { question: 'Do you do SSO?' } });
    assert.deepEqual([refused.status, refused.body.code], [503, 'budget_exceeded']);

    // 4. Raising the budget restarts the agent at once, and its alerts start afresh.
    const raised = (await call('PATCH', '/settings', { key, body: { ai: { monthly_budget_usd: 100 } } })).body.ai;
    assert.deepEqual([raised.monthly_budget_usd, raised.level], [100, 'ok']);
    setDeps({ claude: { run: async <T,>() => ({ status: 'ok', output: { answerable: false, answer: null, kb_item_ids: [] } as T, model: 'claude-opus-5-5', stopReason: 'end_turn', usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, costUsdMicros: 200 }, latencyMs: 1, attempts: 1 }) } });
    assert.equal((await call('POST', '/knowledge/test', { key, body: { question: 'Do you do SSO?' } })).status, 200);
    const [kbRun] = await db.select().from(ai_runs).where(and(eq(ai_runs.workspace_id, workspaceId), eq(ai_runs.task, 'kb_test'), eq(ai_runs.cost_usd_micros, 200)));
    assert.deepEqual([kbRun!.thread_id, kbRun!.cost_usd_micros], [null, 200], 'a knowledge test is a run, for its cost');

    // 5. Each workspace keeps its own budget.
    assert.deepEqual((await call('GET', '/settings', { key: otherKey })).body.ai.spent_usd, 0);
    assert.equal((await call('PATCH', '/settings', { key, body: { ai: { monthly_budget_usd: 0 } } })).status, 400, 'a budget of nothing is no budget: use null');
  });
});

describe('the budget month (§10.2)', () => {
  it('starts at midnight on the 1st in the workspace’s timezone', () => {
    assert.deepEqual(monthOf(new Date('2026-11-30T23:30:00Z'), 'Europe/Berlin'), { month: '2026-12', start: new Date('2026-11-30T23:00:00Z') });
    assert.deepEqual(monthOf(new Date('2026-12-01T05:00:00Z'), 'America/Los_Angeles'), { month: '2026-11', start: new Date('2026-11-01T07:00:00Z') });
    assert.deepEqual([levelOf(null, 5), levelOf(10, 7.99), levelOf(10, 8), levelOf(10, 10)], ['unlimited', 'ok', 'warning', 'exhausted']);
  });
});
