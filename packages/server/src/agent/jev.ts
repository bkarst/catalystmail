// Jev in the pipeline (spec §10.4): the classifier of record, run before any other AI task on a
// reply. Its state is this thread only, with no addresses, tracking data or internal knowledge;
// its run is an `ai_runs` row (provider `typesafe`, task `classify_conversation`); its answers
// set the thread's classification fields, and the message's `needs_reply_p`, which tells
// evaluation whether the conversation is waiting on the contact.

import { conversationQuestions, CONVERSATION_CLASSIFIER, readJevAnswers, type JevClient, type JevRunResult, type JevState } from '@catalyst/ai';
import type { JevClassification } from '@catalyst/core';
import { activities, ai_runs, messages, newId, threads, type Db } from '@catalyst/db';
import { eq, sql } from 'drizzle-orm';

import { noteSpend } from './budget.ts';
import type { AgentSetup } from './inbound.ts';

const LATEST_MESSAGES = 20;

/** §10.4: pinned to an exact version, never `jev-latest`; a moving target would make the thresholds meaningless. */
export function pinnedJevModel(model: string | null | undefined): string | null {
  if (!model || model === 'jev-latest' || !/^jev-\d+\.\d+\.\d+$/.test(model)) return null;
  return model;
}

export function jevStateFor(setup: AgentSetup): JevState {
  const { context, goals, thread } = setup;
  const recent = context.thread.messages.slice(-LATEST_MESSAGES);
  const lastInbound = recent.map((message) => message.direction).lastIndexOf('inbound');
  return {
    campaign: { objective: context.campaign.objective, goals: goals.map((goal) => ({ position: goal.position, name: goal.name })) },
    contact: { title: context.contact.title, company: context.contact.company, industry: null },
    stage: thread.stage,
    messages: recent.map((message) => ({ direction: message.direction, author: message.author, sent_at: message.date, text: message.text })),
    latest: lastInbound === -1 ? 'there is no inbound message' : `the last inbound message is messages[${lastInbound}]`,
  };
}

export interface JevRead {
  classification: JevClassification;
  sentiment: 'negative' | 'neutral' | 'positive' | null;
  temperature: number | null;
  runId: string;
  model: string;
}

/** One classification; null when Jev failed or answered off-schema, so Claude classifies alone. */
export async function classifyWithJev(db: Db, setup: AgentSetup, input: { messageId: string | null; trigger: 'inbound' | 'outbound' }, deps: { jev: JevClient; jevModel: string; now: Date }): Promise<JevRead | null> {
  const goals = setup.goals.map((goal) => ({ key: goal.key, success_criteria: goal.success_criteria }));
  const result: JevRunResult = await deps.jev.classify({ state: jevStateFor(setup), questions: conversationQuestions(goals, input.trigger), model: deps.jevModel });
  const runId = newId('ai_run');
  await db.insert(ai_runs).values({
    id: runId,
    workspace_id: setup.thread.workspace_id,
    thread_id: setup.thread.id,
    trigger_message_id: input.messageId,
    task: 'classify_conversation',
    provider: 'typesafe',
    model: result.model,
    prompt_version: CONVERSATION_CLASSIFIER,
    input_tokens: result.status === 'ok' ? result.usage.inputTokens : null,
    output_tokens: result.status === 'ok' ? result.usage.outputTokens : null,
    cost_usd_micros: result.status === 'ok' ? result.usage.costUsdMicros : null,
    latency_ms: result.latencyMs,
    status: result.status,
    output: result.status === 'ok' ? result.answers : null,
    error: result.status === 'ok' ? null : result.error,
    created_at: deps.now,
  });
  if (result.status !== 'ok') return null;
  if (result.usage.costUsdMicros) await noteSpend(db, setup.thread.workspace_id, deps.now);
  return { ...readJevAnswers(result.answers, goals), runId, model: result.model };
}

/** §10.4 "Stored fields", from Jev: the thread's classification, and the reply's need for an answer. */
export async function storeJevClassification(db: Db, setup: AgentSetup, read: JevRead, input: { messageId: string | null; summary: string | null; disagreements: string[] }, now: Date): Promise<void> {
  const { classification } = read;
  await db
    .update(threads)
    .set({
      latest_intent: classification.intent.value,
      latest_intent_p: classification.intent.p.toFixed(3),
      ...(read.sentiment && { latest_sentiment: read.sentiment }),
      ...(read.temperature !== null && { temperature: read.temperature.toFixed(2) }),
      classification_fallback: false,
      classification_run_id: read.runId,
      ...(input.summary && { ai_summary: sql`coalesce(${threads.ai_summary}, ${input.summary.slice(0, 1000)})`, ai_summary_at: sql`coalesce(${threads.ai_summary_at}, ${now})` }),
      updated_at: now,
    })
    .where(eq(threads.id, setup.thread.id));
  if (input.messageId && classification.needsReply !== null) {
    await db.update(messages).set({ needs_reply_p: classification.needsReply.toFixed(3), updated_at: now }).where(eq(messages.id, input.messageId));
  }
  // Disagreements between the two models are the best source of new labelled examples (§10.4).
  if (input.disagreements.length) await db.update(ai_runs).set({ decision: `disagree:${input.disagreements.join(',')}`.slice(0, 200) }).where(eq(ai_runs.id, read.runId));
  await db.insert(activities).values({
    id: newId('activity'),
    workspace_id: setup.thread.workspace_id,
    contact_id: setup.thread.contact_id,
    thread_id: setup.thread.id,
    campaign_id: setup.thread.campaign_id,
    type: 'thread.classified',
    actor_type: 'ai',
    data: { message_id: input.messageId, ai_run_id: read.runId, model: read.model, intent: classification.intent.value, p: classification.intent.p, disagreements: input.disagreements },
    occurred_at: now,
  });
}
