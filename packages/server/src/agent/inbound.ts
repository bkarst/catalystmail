// The agent's answer to a human reply (spec §10.4 pipeline, §10.5–§10.7, §10.9): Claude reads the
// reply, the policy decides what happens, Catalyst acts (unsubscribe, escalate, goal confirmation),
// and Claude drafts the answer, which passes the guardrails and the autonomy rules before it is
// scheduled or waits for approval. Every Claude call is logged in `ai_runs`.
//
// Jev (TypeSafe) is not connected, so every run is the §10.4 fallback: Claude classifies alone,
// every reply goes to approval, and no goal is confirmed on its word.

import {
  addWait,
  decideInbound,
  decideSend,
  DEFAULT_THRESHOLDS,
  needsClaude,
  fitIntoWindow,
  intlZoneCalendar,
  randomBetween,
  type AutoSendBlocker,
  type ClassificationThresholds,
  type ClaudeOpinion,
  type EscalationReason,
  type Rng,
  type SendingWindow,
} from '@catalyst/core';
import {
  assemble,
  canaryFor,
  checkDraft,
  clamp01,
  DEFAULT_TASK_SETTINGS,
  fill,
  inboundAnalysisSchema,
  prompt,
  replyDraftSchema,
  revisionNote,
  type AgentContext,
  type ClaudeClient,
  type ClaudeResult,
  type ClaudeTask,
  type GuardrailFailure,
  type InboundAnalysis,
  type JevClient,
  type ReplyDraft,
  type TaskSettings,
} from '@catalyst/ai';
import {
  activities,
  ai_runs,
  campaign_goals,
  campaigns,
  companies,
  contacts,
  escalations,
  knowledge_items,
  mailboxes,
  messages,
  newId,
  thread_goal_achievements,
  threads,
  workspaces,
  type Db,
  type Executor,
} from '@catalyst/db';
import type { JobQueue } from '@catalyst/jobs';
import { and, asc, count, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm';

import { unsubscribeContact } from '../contacts/unsubscribe.ts';
import { raiseEscalation } from '../escalations/raise.ts';
import { insertReply, prepareReply, supersedeWaiting } from '../outbound/manual.ts';
import { closeAsNotInterested, writeAchievement } from '../threads/service.ts';
import { evaluateThread } from '../threads/evaluate.ts';
import { budgetExhausted, forWorkspace, noteSpend } from './budget.ts';
import { classifyWithJev, storeJevClassification } from './jev.ts';

export interface AgentDeps {
  claude: ClaudeClient;
  jobs: JobQueue;
  rng: Rng;
  now: Date;
  /** The key the per-campaign canary token is derived from (§10.3). */
  canarySecret: string;
  trackingSecret: string | null;
  appHost: string | null;
  /** Per-task model and effort overrides (Settings → AI). */
  settings?: Partial<Record<ClaudeTask, TaskSettings>>;
  /** Jev (§10.4), with its pinned model; without both, Claude classifies alone (the fallback). */
  jev?: JevClient | null;
  jevModel?: string | null;
  /** The workspace's classification thresholds (§22.B); set by `forWorkspace`. */
  thresholds?: ClassificationThresholds;
}

export type AgentOutcome =
  | { outcome: 'skipped'; why: string }
  | { outcome: 'unsubscribed' }
  | { outcome: 'out_of_office'; until: string | null }
  | { outcome: 'escalated'; reasons: EscalationReason[]; draftId: string | null }
  | { outcome: 'drafted'; draftId: string; status: 'pending_approval' | 'scheduled'; approvalReasons: string[] }
  | { outcome: 'no_reply'; reasons: EscalationReason[] }
  | { outcome: 'closed' };

/** §10.2: at most 20 AI runs per thread per day. */
export const RUNS_PER_THREAD_PER_DAY = 20;
/** §10.8: replies stay short. */
const MAX_WORDS = 120;
const PROMPT_VERSION = 'v1';

type ThreadRow = typeof threads.$inferSelect;
type GoalRow = typeof campaign_goals.$inferSelect;

/** Everything the model may see about this thread, and nothing more (§10.3). */
async function agentContext(db: Executor, thread: ThreadRow, campaign: typeof campaigns.$inferSelect, goals: GoalRow[], now: Date, mailboxId: string) {
  const [contact] = await db.select().from(contacts).where(eq(contacts.id, thread.contact_id));
  const [company] = contact!.company_id ? await db.select().from(companies).where(eq(companies.id, contact!.company_id)) : [];
  const [mailbox] = await db.select().from(mailboxes).where(eq(mailboxes.id, mailboxId));
  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, thread.workspace_id));
  const achieved = await db.select({ goalId: thread_goal_achievements.goal_id }).from(thread_goal_achievements).where(and(eq(thread_goal_achievements.thread_id, thread.id), isNull(thread_goal_achievements.revoked_at)));
  const current = goals.find((goal) => !achieved.some((entry) => entry.goalId === goal.id)) ?? null;
  const knowledge = await db
    .select({ id: knowledge_items.id, kind: knowledge_items.kind, title: knowledge_items.title, content: knowledge_items.content, visibility: knowledge_items.visibility })
    .from(knowledge_items)
    .where(and(eq(knowledge_items.workspace_id, thread.workspace_id), eq(knowledge_items.active, true), isNull(knowledge_items.deleted_at), or(isNull(knowledge_items.campaign_id), eq(knowledge_items.campaign_id, campaign.id))))
    .orderBy(asc(knowledge_items.kind), asc(knowledge_items.title));
  const history = await db
    .select()
    .from(messages)
    .where(and(eq(messages.thread_id, thread.id), inArray(messages.status, ['sent', 'received', 'bounced'])))
    .orderBy(asc(messages.created_at));
  const zone = contact!.timezone ?? (campaign.sending_window as { fallback_tz?: string }).fallback_tz ?? workspace!.default_timezone;
  const local = intlZoneCalendar.toLocal(now, zone);
  const persona = campaign.persona as { tone?: string | null; sender_role?: string | null };
  const context: AgentContext = {
    sender: { name: mailbox!.display_name, email: mailbox!.email, company: workspace!.name, title: persona.sender_role ?? null },
    campaign: {
      id: campaign.id,
      name: campaign.name,
      objective: campaign.objective,
      persona,
      goals: goals.map((goal) => ({ id: goal.id, key: goal.key, name: goal.name, position: goal.position, success_criteria: goal.success_criteria, playbook: goal.playbook })),
      currentGoalId: current?.id ?? null,
      links: campaign.links as Record<string, string>,
      // Internal items never reach the model (§10.3).
      knowledge: knowledge.filter((item) => item.visibility === 'shareable').map(({ id, kind, title, content }) => ({ id, kind, title, content })),
    },
    contact: { first_name: contact!.first_name, last_name: contact!.last_name, title: contact!.title, company: company?.name ?? null, timezone: zone, custom_fields: (contact!.custom_fields ?? {}) as Record<string, unknown> },
    thread: {
      stage: thread.stage,
      summary: thread.ai_summary,
      messages: history.slice(-20).map((message) => ({
        direction: message.direction,
        author: message.author,
        date: (message.sent_at ?? message.received_at ?? message.created_at).toISOString(),
        text: (message.direction === 'inbound' ? (message.stripped_text ?? message.body_text) : message.body_text) ?? '',
      })),
    },
    today: `${local.year}-${String(local.month).padStart(2, '0')}-${String(local.day).padStart(2, '0')}`,
  };
  return { context, contact: contact!, internal: knowledge.filter((item) => item.visibility === 'internal').map((item) => `${item.title}\n${item.content}`), zone, current };
}

export async function recordRun<T>(
  db: Executor,
  input: { workspaceId: string; threadId: string | null; messageId: string | null; task: ClaudeTask; now: Date; settings: TaskSettings; result: ClaudeResult<T>; decision?: string | null; guardrails?: GuardrailFailure[] | null },
): Promise<string> {
  const { result } = input;
  const id = newId('ai_run');
  await db.insert(ai_runs).values({
    id,
    workspace_id: input.workspaceId,
    thread_id: input.threadId,
    trigger_message_id: input.messageId,
    task: input.task,
    provider: 'anthropic',
    model: result.model,
    effort: input.settings.effort,
    prompt_version: `${input.task}.${PROMPT_VERSION}`,
    input_tokens: result.usage?.inputTokens ?? null,
    output_tokens: result.usage?.outputTokens ?? null,
    cache_read_tokens: result.usage?.cacheReadTokens ?? null,
    cache_write_tokens: result.usage?.cacheWriteTokens ?? null,
    cost_usd_micros: result.usage?.costUsdMicros ?? null,
    latency_ms: result.latencyMs,
    stop_reason: result.stopReason,
    status: input.guardrails?.length ? 'guardrail_blocked' : result.status,
    output: result.status === 'ok' ? (result.output as object) : null,
    guardrail_report: input.guardrails ?? null,
    decision: input.decision ?? null,
    error: result.status === 'ok' ? null : result.error,
    created_at: input.now,
  });
  if (result.usage?.costUsdMicros) await noteSpend(db, input.workspaceId, input.now);
  return id;
}

/** Claude's answer as the policy's second opinion (§10.5). */
function opinionOf(analysis: InboundAnalysis, goals: GoalRow[]): ClaudeOpinion {
  return {
    kind: analysis.kind,
    intent: analysis.intent,
    goalSignals: analysis.goal_signals.flatMap((signal) => {
      const goal = goals.find((entry) => entry.id === signal.goal_id);
      return goal ? [{ goalKey: goal.key, achieved: signal.achieved, confidence: clamp01(signal.confidence) }] : [];
    }),
    escalation: { required: analysis.escalation.required, reasons: analysis.escalation.reasons.filter((reason) => reason !== 'suspicious_content') as EscalationReason[] },
    suspiciousInstructions: analysis.suspicious_instructions || analysis.escalation.reasons.includes('suspicious_content'),
    followUpAfter: analysis.follow_up_after,
    confidence: clamp01(analysis.confidence),
  };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface AgentSetup {
  thread: ThreadRow;
  campaign: typeof campaigns.$inferSelect;
  goals: GoalRow[];
  context: AgentContext;
  internal: string[];
  zone: string;
  current: GoalRow | null;
  canary: string;
}

/** What every task on a thread starts from (§10.3). */
export async function loadSetup(db: Executor, thread: ThreadRow, campaign: typeof campaigns.$inferSelect, deps: Pick<AgentDeps, 'canarySecret' | 'now'>, mailboxId = thread.mailbox_id!): Promise<AgentSetup> {
  const goals = await db.select().from(campaign_goals).where(eq(campaign_goals.campaign_id, campaign.id)).orderBy(asc(campaign_goals.position));
  const { context, internal, zone, current } = await agentContext(db, thread, campaign, goals, deps.now, mailboxId);
  return { thread, campaign, goals, context, internal, zone, current, canary: canaryFor(campaign.id, deps.canarySecret) };
}

export interface DraftInput {
  /** What the draft should take into account: the analysis, an operator's answer, guidance. */
  notes: string | null;
  triggerMessageId: string | null;
  /** From the classification of the contact's last message; null when they never replied. */
  classificationBlockers: AutoSendBlocker[] | null;
  escalationReasons: EscalationReason[];
  isNewParticipant: boolean;
  /** A person asked for this draft and reviews it: it never sends on its own. */
  forceApproval: boolean;
  /**
   * A check-in the contact asked for (§5.10 rule 5): written as a follow-up and sent on its date,
   * not after the reply delay. Storing it clears the thread's check-in.
   */
  checkIn?: { date: string; scheduledFor: Date };
}

const CHECK_IN_INSTRUCTION =
  'The contact asked us to get back in touch around now. Write a short, friendly check-in that picks up where the conversation left off, says in a few words why you are writing, and asks whether now is a better time. Don’t apologise for writing.';

export type DraftResult =
  | { status: 'failed'; error: string }
  | { status: 'ok'; stored: { row: typeof messages.$inferSelect; scheduledFor: Date | null }; failures: GuardrailFailure[]; send: { decision: 'auto_send' | 'pending_approval'; reasons: string[] }; runId: string | null; needsHuman: boolean };

/**
 * Claude drafts; the guardrails check it, with one revision; the autonomy rules decide whether it
 * sends on its own; the draft is stored as the composer would build it (§10.6, §10.7, §10.9).
 */
export function guardrailInputFor(setup: AgentSetup, draft: { subject: string | null; body_text: string }, notes: string | null, maxWords = MAX_WORDS) {
  const { context, internal, canary } = setup;
  return {
    subject: draft.subject,
    body: draft.body_text,
    senderEmail: context.sender.email,
    allowedLinks: [...Object.values(context.campaign.links), ...context.campaign.knowledge.flatMap((item) => item.content.match(/https?:\/\/\S+/g) ?? [])],
    sources: {
      knowledge: context.campaign.knowledge.map((item) => `${item.title}\n${item.content}`),
      campaign: [context.campaign.objective, ...context.campaign.goals.flatMap((goal) => [goal.name, goal.success_criteria, goal.playbook]), ...Object.values(context.campaign.links)],
      thread: [...context.thread.messages.map((entry) => entry.text), ...(notes ? [notes] : [])],
    },
    secrets: { canary, internalKnowledge: internal, systemFragments: [prompt('system')] },
    maxWords,
  };
}

export async function writeDraft(db: Db, setup: AgentSetup, input: DraftInput, deps: AgentDeps): Promise<DraftResult> {
  const { thread, campaign, goals, context, internal, zone, current, canary } = setup;
  const { now } = deps;
  const task = input.checkIn ? 'draft_follow_up' : 'draft_reply';
  const draftSettings = deps.settings?.[task] ?? DEFAULT_TASK_SETTINGS[task];
  const guardrailInput = (draft: ReplyDraft) => ({
    subject: draft.subject,
    body: draft.body_text,
    senderEmail: context.sender.email,
    allowedLinks: [...Object.values(context.campaign.links), ...context.campaign.knowledge.flatMap((item) => item.content.match(/https?:\/\/\S+/g) ?? [])],
    sources: {
      knowledge: context.campaign.knowledge.map((item) => `${item.title}\n${item.content}`),
      campaign: [context.campaign.objective, ...context.campaign.goals.flatMap((goal) => [goal.name, goal.success_criteria, goal.playbook]), ...Object.values(context.campaign.links)],
      thread: [...context.thread.messages.map((entry) => entry.text), ...(input.notes ? [input.notes] : [])],
    },
    secrets: { canary, internalKnowledge: internal, systemFragments: [prompt('system')] },
    maxWords: MAX_WORDS,
  });
  let draft: ReplyDraft | null = null;
  let failures: GuardrailFailure[] = [];
  let runId: string | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const instruction = input.checkIn
      ? fill(prompt('draft_follow_up'), { position: '1', sequence: 'Check-in the contact asked for', mode_instruction: CHECK_IN_INSTRUCTION, brief: `They asked to hear from us again around ${input.checkIn.date}.`, max_words: String(MAX_WORDS), today: context.today, revision: revisionNote(failures) })
      : fill(prompt('draft_reply'), { today: context.today, max_words: String(MAX_WORDS), revision: revisionNote(failures) });
    const written = await deps.claude.run({ task, settings: draftSettings, ...assemble(context, { instruction, extra: input.notes ?? undefined }, canary), schema: replyDraftSchema });
    if (written.status !== 'ok') {
      await recordRun(db, { workspaceId: thread.workspace_id, threadId: thread.id, messageId: input.triggerMessageId, task, now: deps.now, settings: draftSettings, result: written });
      return { status: 'failed', error: written.status };
    }
    draft = written.output;
    failures = checkDraft(guardrailInput(draft));
    runId = await recordRun(db, { workspaceId: thread.workspace_id, threadId: thread.id, messageId: input.triggerMessageId, task, now: deps.now, settings: draftSettings, result: written, guardrails: failures.length ? failures : null });
    if (failures.length === 0) break;
  }

  const open = await db.select({ reason: escalations.reason }).from(escalations).where(and(eq(escalations.thread_id, thread.id), inArray(escalations.status, ['open', 'snoozed'])));
  const reasons = [...input.escalationReasons, ...(draft!.needs_human ? (['low_confidence'] as EscalationReason[]) : [])];
  const send: { decision: 'auto_send' | 'pending_approval'; reasons: string[] } = input.forceApproval
    ? { decision: 'pending_approval', reasons: ['requested_by_a_person'] }
    : decideSend({
        autonomy: campaign.autonomy,
        messageClass: input.checkIn ? 'ai_follow_up' : 'ai_reply',
        classificationBlockers: input.classificationBlockers,
        draftConfidence: clamp01(draft!.confidence),
        autoSendMinConfidence: Number(campaign.auto_send_min_confidence),
        guardrailsPassed: failures.length === 0,
        escalationReasons: [...new Set([...reasons, ...open.map((entry) => entry.reason)])],
        aiRepliesSent: thread.ai_replies_sent,
        maxAiRepliesPerThread: campaign.max_ai_replies_per_thread,
        isNewParticipant: input.isNewParticipant,
        aiPaused: thread.ai_paused,
      });

  const stored = await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(threads).where(eq(threads.id, thread.id)).for('update');
    const prepared = await prepareReply(tx, locked!, draft!.body_text, deps, { aiWritten: true });
    // A reply waits 8–45 minutes and keeps to the window, so it reads as human (§8.4); a check-in goes on its date.
    const delay = randomBetween(deps.rng, campaign.reply_delay_min_minutes * 60_000, campaign.reply_delay_max_minutes * 60_000);
    const sendFrom = input.checkIn ? new Date(Math.max(now.getTime(), input.checkIn.scheduledFor.getTime())) : new Date(now.getTime() + delay);
    const scheduledFor = send.decision === 'auto_send' ? fitIntoWindow(sendFrom, campaign.sending_window as SendingWindow, { zone, calendar: intlZoneCalendar, blackoutDates: campaign.blackout_dates }) : null;
    const goalId = goals.some((goal) => goal.id === draft!.pursues_goal_id) ? draft!.pursues_goal_id : (current?.id ?? null);
    const row = await insertReply(tx, prepared, { status: send.decision === 'auto_send' ? 'scheduled' : 'pending_approval', author: 'ai', scheduledFor, aiRunId: runId, goalId }, now);
    await supersedeWaiting(tx, locked!.id, row.id, now);
    // The check-in is written. If a person rejects it, the stage's sequence takes over from then.
    if (input.checkIn) await tx.update(threads).set({ check_in_at: null, check_in_set_at: null, follow_ups_not_before: scheduledFor ?? now, updated_at: now }).where(eq(threads.id, locked!.id));
    await tx.insert(activities).values({
      id: newId('activity'),
      workspace_id: locked!.workspace_id,
      contact_id: locked!.contact_id,
      thread_id: locked!.id,
      campaign_id: locked!.campaign_id,
      type: send.decision === 'auto_send' ? 'message.scheduled' : 'message.pending_approval',
      actor_type: 'ai',
      data: { message_id: row.id, ai_run_id: runId, approval_reasons: send.reasons, guardrail_failures: failures.map((failure) => failure.check) },
      occurred_at: now,
    });
    if (scheduledFor) await deps.jobs.enqueue('outbound.send', { message_id: row.id }, { db: tx, startAfter: scheduledFor });
    if (runId) await tx.update(ai_runs).set({ decision: send.decision === 'auto_send' ? 'auto_send' : 'queue_approval' }).where(eq(ai_runs.id, runId));
    return { row, scheduledFor };
  });
  return { status: 'ok', stored, failures, send, runId, needsHuman: draft!.needs_human };
}

/** Claude reads the reply (§10.5); while Jev isn't connected, this is the classification too. */
export async function analyzeReply(db: Db, setup: AgentSetup, messageId: string, deps: AgentDeps) {
  const settings = deps.settings?.analyze_inbound ?? DEFAULT_TASK_SETTINGS.analyze_inbound;
  const result = await deps.claude.run({ task: 'analyze_inbound', settings, ...assemble(setup.context, { instruction: fill(prompt('analyze_inbound'), { today: setup.context.today }) }, setup.canary), schema: inboundAnalysisSchema });
  const runId = await recordRun(db, { workspaceId: setup.thread.workspace_id, threadId: setup.thread.id, messageId, task: 'analyze_inbound', now: deps.now, settings, result });
  return { result, runId };
}

/**
 * The thread's classification fields (§10.4 "Stored fields"), written from Claude's analysis. The
 * analysis' summary of the reply is only a first summary: `summarize` keeps the thread's own.
 */
export async function storeClassification(db: Executor, thread: ThreadRow, analysis: InboundAnalysis, run: { messageId: string; runId: string }, now: Date): Promise<void> {
  await db
    .update(threads)
    .set({
      latest_intent: analysis.intent === 'other' ? 'neutral' : analysis.intent,
      latest_intent_p: clamp01(analysis.confidence).toFixed(3),
      latest_sentiment: analysis.sentiment,
      // Claude alone classified it: nothing sends on its own until Jev does again (§10.4 fallback).
      classification_fallback: true,
      ai_summary: sql`coalesce(${threads.ai_summary}, ${analysis.summary.slice(0, 1000)})`,
      ai_summary_at: sql`coalesce(${threads.ai_summary_at}, ${now})`,
      classification_run_id: run.runId,
      updated_at: now,
    })
    .where(eq(threads.id, thread.id));
  await db.insert(activities).values({ id: newId('activity'), workspace_id: thread.workspace_id, contact_id: thread.contact_id, thread_id: thread.id, campaign_id: thread.campaign_id, type: 'thread.classification_fallback', actor_type: 'ai', data: { message_id: run.messageId, ai_run_id: run.runId, intent: analysis.intent, confidence: clamp01(analysis.confidence) }, occurred_at: now });
}

/** Runs the pipeline for one inbound human reply. */
export async function processInboundReply(db: Db, messageId: string, deps: AgentDeps): Promise<AgentOutcome> {
  const { now } = deps;
  const settingsFor = (task: ClaudeTask) => deps.settings?.[task] ?? DEFAULT_TASK_SETTINGS[task];
  const [message] = await db.select().from(messages).where(eq(messages.id, messageId));
  if (!message || message.direction !== 'inbound' || !message.thread_id) return { outcome: 'skipped', why: 'not an inbound email on a thread' };
  const [thread] = await db.select().from(threads).where(eq(threads.id, message.thread_id));
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, thread!.campaign_id));
  if (campaign!.agent_mode !== 'built_in') return { outcome: 'skipped', why: 'the campaign uses an external agent' };
  if (thread!.ai_paused) return { outcome: 'skipped', why: 'a person took this thread over' };
  if (!thread!.mailbox_id) return { outcome: 'skipped', why: 'nothing was sent on the thread' };
  deps = await forWorkspace(db, thread!.workspace_id, deps);
  const contactName = message.from_name ?? message.from_email;
  const escalate = (reason: EscalationReason, title: string, explanation: string, extra: { questions?: { text: string; why_unanswerable: string }[]; suggestedDraftId?: string | null; goal?: { id: string; p: number } } = {}) =>
    raiseEscalation(db, { workspaceId: thread!.workspace_id, threadId: thread!.id, reason, title, explanation, triggerMessageId: message.id, ...(extra.questions && { questions: extra.questions }), ...(extra.suggestedDraftId && { suggestedDraftId: extra.suggestedDraftId }), ...(extra.goal && { goal: extra.goal }) }, now);

  const [runs] = await db.select({ n: count() }).from(ai_runs).where(and(eq(ai_runs.thread_id, thread!.id), gte(ai_runs.created_at, new Date(now.getTime() - 86_400_000))));
  if ((runs?.n ?? 0) >= RUNS_PER_THREAD_PER_DAY) {
    await escalate('ai_unavailable', `${contactName} replied`, `This thread used its ${RUNS_PER_THREAD_PER_DAY} AI runs for today, so nothing was drafted. Reply yourself.`);
    return { outcome: 'escalated', reasons: ['ai_unavailable'], draftId: null };
  }
  if (await budgetExhausted(db, thread!.workspace_id, now)) {
    // §10.2: at 100% of the month's budget the agent stops and the reply goes to a person.
    await escalate('ai_unavailable', `${contactName} replied`, 'The workspace’s AI budget for this month is spent, so the AI agent didn’t read or answer this reply. Reply yourself, or raise the budget in Settings → AI.');
    return { outcome: 'escalated', reasons: ['ai_unavailable'], draftId: null };
  }

  const setup = await loadSetup(db, thread!, campaign!, deps);
  const { context, goals, zone, canary } = setup;

  // 1. Jev classifies the conversation (§10.4), when it is set up. Without it, or when it fails,
  // Claude classifies alone (the fallback): nothing then sends on its own.
  const jevRead = deps.jev && deps.jevModel ? await classifyWithJev(db, setup, { messageId, trigger: 'inbound' }, { jev: deps.jev, jevModel: deps.jevModel, now }) : null;
  const jev = jevRead?.classification ?? null;

  // 2. Claude reads it, unless Jev settled it alone; an out-of-office still needs Claude for the date.
  let analysis: InboundAnalysis | null = null;
  let analysisRunId: string | null = null;
  const thresholds = deps.thresholds ?? DEFAULT_THRESHOLDS;
  const settledOutOfOffice = jev?.kind?.value === 'out_of_office' && jev.kind.p >= thresholds.autoReply;
  if (jev === null || needsClaude(jev, thresholds) || settledOutOfOffice) {
    const { result: read, runId } = await analyzeReply(db, setup, messageId, deps);
    if (read.status !== 'ok') {
      await escalate('ai_unavailable', `${contactName} replied`, `The AI agent couldn’t read this reply (${read.status}: ${read.error.slice(0, 200)}), so nothing was drafted. Reply yourself.`);
      return { outcome: 'escalated', reasons: ['ai_unavailable'], draftId: null };
    }
    analysis = read.output;
    analysisRunId = runId;
  }

  // 3. The policy (§10.4): both opinions when there are two.
  const decision = decideInbound({ jev, claude: analysis ? opinionOf(analysis, goals) : null, goals: goals.map((goal) => ({ key: goal.key, autoConfirm: goal.auto_confirm })), goalAutoConfirmThreshold: Number(campaign!.goal_auto_confirm_threshold), thresholds });
  if (jevRead) await storeJevClassification(db, setup, jevRead, { messageId, summary: analysis?.summary ?? null, disagreements: decision.disagreements }, now);
  else await storeClassification(db, thread!, analysis!, { messageId, runId: analysisRunId! }, now);

  // 3. What settles the reply without an answer.
  if (decision.unsubscribe === 'act') {
    await db.transaction((tx) => unsubscribeContact(tx, { workspaceId: thread!.workspace_id, contactId: thread!.contact_id, source: 'reply', threadId: thread!.id, actor: { actor_type: 'system', actor_id: null } }, deps.jobs, now));
    await settle(db, deps, thread!.id);
    return { outcome: 'unsubscribed' };
  }
  if (decision.autoReply) {
    const until = decision.autoReply === 'out_of_office' && analysis?.ooo_return_date && ISO_DATE.test(analysis.ooo_return_date) ? analysis.ooo_return_date : null;
    // Back on the return date plus one business day (§10.4).
    const resume = until ? addWait(intlZoneCalendar.fromLocal({ year: Number(until.slice(0, 4)), month: Number(until.slice(5, 7)), day: Number(until.slice(8, 10)), hour: 9, minute: 0, second: 0 }, zone), { amount: 1, unit: 'business_days' }, { zone, calendar: intlZoneCalendar }) : null;
    await db.update(messages).set({ inbound_kind: decision.autoReply, auto_reply_until: until, updated_at: now }).where(eq(messages.id, messageId));
    if (resume) await db.update(threads).set({ follow_ups_not_before: resume, updated_at: now }).where(eq(threads.id, thread!.id));
    await settle(db, deps, thread!.id);
    return { outcome: 'out_of_office', until };
  }

  // The thread's rolling summary catches up with this reply meanwhile (§10.1).
  await deps.jobs.enqueue('ai.summarize', { thread_id: thread!.id });

  const raised: string[] = [];
  const reasons: EscalationReason[] = [];

  // Goals: Jev confident and the goal set to auto-confirm, recorded now; otherwise a person confirms.
  for (const goal of decision.goals) {
    const row = goals.find((entry) => entry.key === goal.key)!;
    if (goal.action === 'achieve') {
      await db.transaction(async (tx) => {
        await writeAchievement(tx, thread!, row.id, { method: 'ai', confidence: goal.p.toFixed(3), evidence: analysis?.goal_signals.find((signal) => signal.goal_id === row.id)?.evidence_quote ?? null, eventAt: null, confirmedBy: null }, now);
        await tx.insert(activities).values({ id: newId('activity'), workspace_id: thread!.workspace_id, contact_id: thread!.contact_id, thread_id: thread!.id, campaign_id: thread!.campaign_id, type: 'goal.achieved', actor_type: 'ai', data: { goal_id: row.id, method: 'ai', p: goal.p, message_id: messageId }, occurred_at: now });
      });
      continue;
    }
    raised.push((await escalate('goal_confirmation', `Did ${contactName} reach “${row.name}”?`, `The agent thinks so (${Math.round(goal.p * 100)}%)${analysis ? `: ${analysis.goal_signals.find((signal) => signal.goal_id === row.id)?.evidence_quote ?? analysis.summary}` : '.'}`, { goal: { id: row.id, p: goal.p } })).id);
    reasons.push('goal_confirmation');
  }

  // Jev settled it alone: no reply is needed and nothing was raised ("Thanks, talk Thursday").
  if (analysis === null) {
    await settle(db, deps, thread!.id);
    return reasons.length ? { outcome: 'escalated', reasons, draftId: null } : { outcome: 'no_reply', reasons };
  }

  const explanation = analysis.escalation.explanation || analysis.summary;
  for (const reason of decision.escalations) {
    const questions = reason === 'knowledge_gap' ? analysis.questions.filter((question) => !question.answerable_from_context).map((question) => ({ text: question.text, why_unanswerable: 'The knowledge base doesn’t answer it.' })) : undefined;
    const title = reason === 'knowledge_gap' && questions?.[0] ? `Asked: ${questions[0].text.slice(0, 80)}` : `${contactName}: ${reason.replace(/_/g, ' ')}`;
    raised.push((await escalate(reason, title, explanation, { ...(questions && { questions }) })).id);
    reasons.push(reason);
  }
  if (decision.close === 'close') {
    // Both models agree it's a no (§10.4): closed as lost, the contact tagged, nothing sent.
    await closeAsNotInterested(db, thread!, now);
    await settle(db, deps, thread!.id);
    return { outcome: 'closed' };
  }
  if (decision.close === 'approval') {
    raised.push((await escalate('low_confidence', `Close the thread with ${contactName}?`, `They seem not to be interested: ${analysis.summary}`)).id);
    reasons.push('low_confidence');
  }
  // "Not now, try in March" (§10.4): one check-in on that date replaces the sequence (§5.10 rule 5).
  const today = context.today;
  const checkInDate = analysis.follow_up_after && ISO_DATE.test(analysis.follow_up_after) && analysis.follow_up_after > today ? analysis.follow_up_after : null;
  if (decision.checkIn === 'schedule' && checkInDate) {
    const at = intlZoneCalendar.fromLocal({ year: Number(checkInDate.slice(0, 4)), month: Number(checkInDate.slice(5, 7)), day: Number(checkInDate.slice(8, 10)), hour: 0, minute: 0, second: 0 }, zone);
    await db.update(threads).set({ check_in_at: at, check_in_set_at: now, updated_at: now }).where(eq(threads.id, thread!.id));
    await db.insert(activities).values({ id: newId('activity'), workspace_id: thread!.workspace_id, contact_id: thread!.contact_id, thread_id: thread!.id, campaign_id: thread!.campaign_id, type: 'follow_up.check_in_scheduled', actor_type: 'ai', data: { date: checkInDate, at: at.toISOString(), zone, replaced: null }, occurred_at: now });
  } else if (decision.checkIn !== 'none') {
    const proposal = checkInDate ? ` Schedule it with scheduleCheckIn for ${checkInDate}, or dismiss this.` : ' They named no date: pick one with scheduleCheckIn, or dismiss this.';
    raised.push((await escalate('low_confidence', `Check in with ${contactName} later?`, `They asked to be contacted later${checkInDate ? `, from ${checkInDate}` : ''}: ${analysis.summary}${proposal}`)).id);
    reasons.push('low_confidence');
  }
  if (decision.reply === 'none' || decision.unsubscribe === 'ask') {
    await settle(db, deps, thread!.id);
    return reasons.length ? { outcome: 'escalated', reasons, draftId: null } : { outcome: 'no_reply', reasons };
  }

  // 4–5. Claude drafts the answer; guardrails, then autonomy (§10.6, §10.7, §10.9).
  const extra = `<analysis>\n${JSON.stringify({ summary: analysis.summary, intent: analysis.intent, questions: analysis.questions, language: analysis.language })}\n</analysis>`;
  const written = await writeDraft(db, setup, { notes: extra, triggerMessageId: messageId, classificationBlockers: decision.autoSendBlockers, escalationReasons: reasons, isNewParticipant: message.author === 'third_party', forceApproval: false }, deps);
  if (written.status === 'failed') {
    raised.push((await escalate('ai_unavailable', `${contactName} replied`, `The AI agent couldn’t write the reply (${written.error}). Reply yourself.`)).id);
    await settle(db, deps, thread!.id);
    return { outcome: 'escalated', reasons: [...reasons, 'ai_unavailable'], draftId: null };
  }
  const { failures, stored, send } = written;
  if (written.needsHuman) reasons.push('low_confidence');

  // A second guardrail failure escalates, with the draft attached (§10.9).
  if (failures.length > 0) {
    raised.push((await escalate('guardrail_failed', 'A drafted reply failed its checks', failures.map((failure) => failure.message).join(' '), { suggestedDraftId: stored.row.id })).id);
    reasons.push('guardrail_failed');
  }
  // Escalations raised for this reply show the draft as a suggestion.
  if (raised.length) await db.update(escalations).set({ suggested_draft_id: stored.row.id, updated_at: now }).where(and(inArray(escalations.id, raised), isNull(escalations.suggested_draft_id)));
  await settle(db, deps, thread!.id);
  if (reasons.length) return { outcome: 'escalated', reasons, draftId: stored.row.id };
  return { outcome: 'drafted', draftId: stored.row.id, status: stored.scheduledFor ? 'scheduled' : 'pending_approval', approvalReasons: send.reasons };
}

async function settle(db: Db, deps: Pick<AgentDeps, 'jobs' | 'now'>, threadId: string): Promise<void> {
  try {
    await evaluateThread(db, threadId, { now: deps.now });
  } catch {
    await deps.jobs.enqueue('thread.evaluate', { thread_id: threadId });
  }
}
