// The agent on request (spec §11.3, §13.4): "Answer for the agent", which drafts the reply again
// with a person's answer and can keep it as knowledge, and "Draft with AI" on any thread. Both
// drafts wait for approval: a person asked for them and reviews them.

import { assemble, canaryFor, DEFAULT_TASK_SETTINGS, fill, knowledgeTestSchema, prompt, type AgentContext } from '@catalyst/ai';
import { ai_runs, campaigns, escalations, knowledge_items, mailboxes, messages, newId, threads, workspaces, type Db } from '@catalyst/db';
import { and, asc, desc, eq, inArray, isNull, or } from 'drizzle-orm';

import type { Principal } from '../api/auth.ts';
import { ApiError, conflict, notFound } from '../api/errors.ts';
import { getEscalation } from '../escalations/service.ts';
import { serializeMessage } from '../threads/service.ts';
import { evaluateThread } from '../threads/evaluate.ts';
import { audit } from '../shared.ts';
import { assertBudget, forWorkspace } from './budget.ts';
import { classifyWithJev, storeJevClassification } from './jev.ts';
import { analyzeReply, loadSetup, recordRun, storeClassification, writeDraft, type AgentDeps } from './inbound.ts';

const CLOSED_FOR_GOOD = ['bounced', 'unsubscribed'];
const off = () => new ApiError(503, 'ai_unavailable', 'The AI agent is off: set AI_ENABLED=true with Claude API credentials, or write the reply yourself (createReply).');

/** What a draft request needs, or why it can't run. */
async function threadFor(db: Db, workspaceId: string, threadId: string) {
  const [thread] = await db.select().from(threads).where(and(eq(threads.id, threadId), eq(threads.workspace_id, workspaceId)));
  if (!thread) throw notFound('The thread');
  if (CLOSED_FOR_GOOD.includes(thread.state)) throw new ApiError(409, 'thread_terminal', `The thread is ${thread.state}; nothing more can be sent on it.`);
  if (!thread.mailbox_id || !thread.subject) throw conflict('Nothing has been sent on this thread yet, so there is nothing to reply to.');
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, thread.campaign_id));
  return { thread, campaign: campaign! };
}

/** The last analysis of the contact's reply, as notes for the draft. */
async function lastAnalysis(db: Db, threadId: string): Promise<string | null> {
  const [run] = await db.select({ output: ai_runs.output }).from(ai_runs).where(and(eq(ai_runs.thread_id, threadId), eq(ai_runs.task, 'analyze_inbound'), eq(ai_runs.status, 'ok'))).orderBy(desc(ai_runs.created_at)).limit(1);
  if (!run?.output) return null;
  const { summary, intent, questions, language } = run.output as { summary?: string; intent?: string; questions?: unknown; language?: string };
  return `<analysis>\n${JSON.stringify({ summary, intent, questions, language })}\n</analysis>`;
}

export async function answerEscalation(
  db: Db,
  principal: Principal,
  escalationId: string,
  input: { answer: string; save_to_knowledge: boolean; knowledge_scope: 'campaign' | 'workspace' },
  deps: Omit<AgentDeps, 'claude'> & { claude: AgentDeps['claude'] | null },
) {
  const [escalation] = await db.select().from(escalations).where(and(eq(escalations.id, escalationId), eq(escalations.workspace_id, principal.workspace.id)));
  if (!escalation) throw notFound('The escalation');
  if (!['open', 'snoozed'].includes(escalation.status)) throw conflict(`This escalation is already ${escalation.status}.`);
  if (!escalation.thread_id) throw conflict('This escalation is about no thread, so there is no reply to draft.');
  if (!deps.claude) throw off();
  await assertBudget(db, principal.workspace.id, deps.now);
  const { thread, campaign } = await threadFor(db, principal.workspace.id, escalation.thread_id);
  const agent = await forWorkspace(db, principal.workspace.id, { ...deps, claude: deps.claude });

  // The answer goes in as the operator's words; it is saved as knowledge only once the draft works.
  const questions = (escalation.questions as { text: string }[]).map((question) => question.text);
  const notes = [await lastAnalysis(db, thread.id), `<operator_answer questions="${questions.join(' | ').replace(/"/g, "'")}">\n${input.answer}\n</operator_answer>\nUse this answer from the team; it is accurate and may be shared.`].filter(Boolean).join('\n');
  const setup = await loadSetup(db, thread, campaign, agent);
  const written = await writeDraft(db, setup, { notes, triggerMessageId: escalation.trigger_message_id, classificationBlockers: null, escalationReasons: [], isNewParticipant: false, forceApproval: true }, agent);
  if (written.status === 'failed') throw new ApiError(503, 'ai_unavailable', `The AI agent couldn’t draft the reply (${written.error}). Nothing was changed; try again or reply yourself.`);

  const now = deps.now;
  const knowledgeItemId = await db.transaction(async (tx) => {
    let itemId: string | null = null;
    if (input.save_to_knowledge) {
      // §11.3: so the agent won't ask again.
      itemId = newId('knowledge_item');
      await tx.insert(knowledge_items).values({
        id: itemId,
        workspace_id: principal.workspace.id,
        campaign_id: input.knowledge_scope === 'campaign' ? campaign.id : null,
        kind: 'faq',
        title: (questions[0] ?? escalation.title).slice(0, 200),
        content: input.answer,
        source: 'escalation',
        source_escalation_id: escalation.id,
        created_by: principal.kind === 'user' ? principal.id : null,
        created_at: now,
        updated_at: now,
      });
    }
    await tx
      .update(escalations)
      .set({ status: 'resolved', resolution: 'answered_for_ai', resolution_note: input.answer.slice(0, 1000), knowledge_item_id: itemId, suggested_draft_id: written.stored.row.id, resolved_by: principal.kind === 'user' ? principal.id : null, resolved_at: now, snoozed_until: null, updated_at: now })
      .where(eq(escalations.id, escalation.id));
    await audit(tx, principal, 'escalation.answered', { type: 'escalation', id: escalation.id }, { knowledge_item_id: itemId, draft_id: written.stored.row.id }, now);
    return itemId;
  });
  await evaluateThread(db, thread.id, { now }).catch(() => deps.jobs.enqueue('thread.evaluate', { thread_id: thread.id }));
  return { escalation: await getEscalation(db, principal.workspace.id, escalation.id, now), draft: serializeMessage(written.stored.row), knowledge_item_id: knowledgeItemId };
}

export async function generateAiDraft(db: Db, principal: Principal, threadId: string, input: { guidance?: string | undefined }, deps: Omit<AgentDeps, 'claude'> & { claude: AgentDeps['claude'] | null }) {
  const { thread, campaign } = await threadFor(db, principal.workspace.id, threadId);
  if (!deps.claude) throw off();
  await assertBudget(db, principal.workspace.id, deps.now);
  const agent = await forWorkspace(db, principal.workspace.id, { ...deps, claude: deps.claude });
  const notes = [await lastAnalysis(db, thread.id), input.guidance ? `<guidance>\n${input.guidance}\n</guidance>\nFollow this guidance from the team.` : null].filter(Boolean).join('\n') || null;
  const setup = await loadSetup(db, thread, campaign, agent);
  const open = await db.select({ reason: escalations.reason }).from(escalations).where(and(eq(escalations.thread_id, thread.id), inArray(escalations.status, ['open', 'snoozed'])));
  const written = await writeDraft(db, setup, { notes, triggerMessageId: null, classificationBlockers: null, escalationReasons: open.map((entry) => entry.reason), isNewParticipant: false, forceApproval: true }, agent);
  if (written.status === 'failed') throw new ApiError(503, 'ai_unavailable', `The AI agent couldn’t draft the reply (${written.error}). Try again or write it yourself.`);
  await evaluateThread(db, thread.id, { now: deps.now }).catch(() => deps.jobs.enqueue('thread.evaluate', { thread_id: thread.id }));
  return serializeMessage(written.stored.row);
}

/** "Reclassify" (§10.4): reads the conversation again and stores the classification; no action runs again. */
export async function reclassifyThread(db: Db, principal: Principal, threadId: string, deps: Omit<AgentDeps, 'claude'> & { claude: AgentDeps['claude'] | null }) {
  const [thread] = await db.select().from(threads).where(and(eq(threads.id, threadId), eq(threads.workspace_id, principal.workspace.id)));
  if (!thread) throw notFound('The thread');
  const [latest] = await db.select().from(messages).where(and(eq(messages.thread_id, thread.id), eq(messages.direction, 'inbound'))).orderBy(desc(messages.created_at)).limit(1);
  if (!latest || !thread.mailbox_id) throw conflict('The contact hasn’t replied on this thread, so there is nothing to classify.');
  if (!deps.claude) throw off();
  await assertBudget(db, principal.workspace.id, deps.now);
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, thread.campaign_id));
  const agent = await forWorkspace(db, principal.workspace.id, { ...deps, claude: deps.claude });
  const setup = await loadSetup(db, thread, campaign!, agent);
  // Jev is the classifier of record (§10.4); Claude classifies alone only without it.
  const jevRead = deps.jev && agent.jevModel ? await classifyWithJev(db, setup, { messageId: latest.id, trigger: 'inbound' }, { jev: deps.jev, jevModel: agent.jevModel, now: deps.now }) : null;
  let runId: string;
  if (jevRead) {
    await storeJevClassification(db, setup, jevRead, { messageId: latest.id, summary: null, disagreements: [] }, deps.now);
    runId = jevRead.runId;
  } else {
    const read = await analyzeReply(db, setup, latest.id, agent);
    if (read.result.status !== 'ok') throw new ApiError(503, 'ai_unavailable', `The AI agent couldn’t classify the conversation (${read.result.status}).`);
    await storeClassification(db, thread, read.result.output, { messageId: latest.id, runId: read.runId }, deps.now);
    runId = read.runId;
  }
  const [run] = await db.select().from(ai_runs).where(eq(ai_runs.id, runId));
  return { id: run!.id, trigger_message_id: run!.trigger_message_id, provider: run!.provider, model: run!.model, classifier_version: run!.prompt_version, status: run!.status, output: (run!.output as Record<string, unknown> | null) ?? null, created_at: run!.created_at.toISOString() };
}

/** "Test the agent" (§15.17): would it answer this from the knowledge base? Nothing is stored. */
export async function testKnowledge(db: Db, principal: Principal, input: { question: string; campaign_id?: string | undefined }, deps: Omit<AgentDeps, 'claude'> & { claude: AgentDeps['claude'] | null }) {
  if (!deps.claude) throw off();
  await assertBudget(db, principal.workspace.id, deps.now);
  const [campaign] = input.campaign_id ? await db.select().from(campaigns).where(and(eq(campaigns.id, input.campaign_id), eq(campaigns.workspace_id, principal.workspace.id))) : [];
  if (input.campaign_id && !campaign) throw notFound('The campaign');
  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, principal.workspace.id));
  const [mailbox] = await db.select().from(mailboxes).where(eq(mailboxes.workspace_id, principal.workspace.id)).limit(1);
  // Only shareable items reach the model, as in a real reply (§10.3).
  const items = await db
    .select({ id: knowledge_items.id, kind: knowledge_items.kind, title: knowledge_items.title, content: knowledge_items.content })
    .from(knowledge_items)
    .where(and(eq(knowledge_items.workspace_id, principal.workspace.id), eq(knowledge_items.active, true), eq(knowledge_items.visibility, 'shareable'), isNull(knowledge_items.deleted_at), campaign ? or(isNull(knowledge_items.campaign_id), eq(knowledge_items.campaign_id, campaign.id)) : isNull(knowledge_items.campaign_id)))
    .orderBy(asc(knowledge_items.kind), asc(knowledge_items.title));
  const today = deps.now.toISOString().slice(0, 10);
  const context: AgentContext = {
    sender: { name: mailbox?.display_name ?? workspace!.name, email: mailbox?.email ?? 'team@example.invalid', company: workspace!.name, title: null },
    campaign: { id: campaign?.id ?? workspace!.id, name: campaign?.name ?? workspace!.name, objective: campaign?.objective ?? '', persona: (campaign?.persona ?? {}) as AgentContext['campaign']['persona'], goals: [], currentGoalId: null, links: (campaign?.links ?? {}) as Record<string, string>, knowledge: items },
    contact: { first_name: null, last_name: null, title: null, company: null, timezone: null, custom_fields: {} },
    thread: { stage: 'responded', summary: null, messages: [] },
    today,
  };
  const settings = (await forWorkspace(db, principal.workspace.id, deps)).settings?.kb_test ?? DEFAULT_TASK_SETTINGS.kb_test;
  const result = await deps.claude.run({ task: 'kb_test', settings, ...assemble(context, { instruction: fill(prompt('kb_test'), { question: input.question }) }, canaryFor(context.campaign.id, deps.canarySecret)), schema: knowledgeTestSchema });
  // The run is kept for its cost (§10.2), though nothing else is stored.
  await recordRun(db, { workspaceId: principal.workspace.id, threadId: null, messageId: null, task: 'kb_test', now: deps.now, settings, result });
  if (result.status !== 'ok') throw new ApiError(503, 'ai_unavailable', `The AI agent couldn’t answer (${result.status}).`);
  const cited = items.filter((item) => result.output.kb_item_ids.includes(item.id)).map((item) => ({ id: item.id, title: item.title }));
  // An answer that cites nothing isn't from the knowledge base.
  const answerable = result.output.answerable && cited.length > 0;
  return { answerable, answer: answerable ? result.output.answer : null, citations: answerable ? cited : [] };
}
