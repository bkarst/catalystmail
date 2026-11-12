// AI-mode steps (spec §5.10, §10.1, §10.7, §10.8): the agent writes the opening line
// (`ai_opening_line`), the whole first email (initial `ai_write`), or the follow-up (`ai_adapt`,
// follow-up `ai_write`); the guardrails check it, with one revision; the autonomy rules decide
// whether it sends; then the composer builds and stores it like any step.

import { decideSend, type AutoSendBlocker, type SendDecision } from '@catalyst/core';
import {
  assemble,
  checkDraft,
  clamp01,
  DEFAULT_TASK_SETTINGS,
  fill,
  personalizationSchema,
  prompt,
  replyDraftSchema,
  revisionNote,
  type GuardrailFailure,
  type Personalization,
  type ReplyDraft,
} from '@catalyst/ai';
import { campaign_step_variants, campaign_steps, campaigns, follow_up_sequences, messages, threads, type Db } from '@catalyst/db';
import { and, asc, count, eq, isNotNull } from 'drizzle-orm';

import { raiseEscalation } from '../escalations/raise.ts';
import { composeNext, pickVariant, type AiComposition, type ComposeResult } from '../outbound/compose.ts';
import { evaluateThread } from '../threads/evaluate.ts';
import { budgetExhausted, forWorkspace } from './budget.ts';
import { guardrailInputFor, loadSetup, recordRun, type AgentDeps, type AgentSetup } from './inbound.ts';

const OPENING_LINE_WORDS = 40;
const FOLLOW_UP_WORDS = 120;

const MODE_INSTRUCTIONS = {
  ai_adapt: 'The brief below is the message to send. Rewrite it to fit this conversation, keeping its call to action and its links.',
  ai_write: 'Write the message from the guidance below and the current goal’s playbook.',
  ai_opening_line: 'Write one opening sentence for this first email about the contact, in `opening_line`. The template it opens is below. Leave `subject` and `body_text` null.',
  initial_write: 'Write the whole first email to this contact, `subject` and `body_text`, from the guidance below. Leave `opening_line` null.',
} as const;

export interface AiComposeInput {
  threadId: string;
  stepId: string;
  mailboxId: string;
  scheduledFor: Date;
}

export async function composeWithAgent(db: Db, input: AiComposeInput, deps: AgentDeps): Promise<ComposeResult | { status: 'failed'; why: string }> {
  const { now } = deps;
  const [thread] = await db.select().from(threads).where(eq(threads.id, input.threadId));
  const [step] = await db.select().from(campaign_steps).where(eq(campaign_steps.id, input.stepId));
  if (!thread || !step || thread.state !== 'active' || thread.next_action_message_id) return { status: 'skipped', why: 'not due any more' };
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, thread.campaign_id));
  const [sequence] = step.sequence_id ? await db.select().from(follow_up_sequences).where(eq(follow_up_sequences.id, step.sequence_id)) : [];
  const variants = await db.select().from(campaign_step_variants).where(eq(campaign_step_variants.step_id, step.id)).orderBy(asc(campaign_step_variants.label));
  if (campaign!.agent_mode !== 'built_in') return { status: 'skipped', why: 'the campaign uses an external agent' };
  const variant = pickVariant(variants, deps.rng);
  if (!variant) return { status: 'skipped', why: 'no active variant' };
  deps = await forWorkspace(db, thread.workspace_id, deps);
  const setup = await loadSetup(db, thread, campaign!, deps, input.mailboxId);
  const brief = [variant.body_template, step.ai_guidance ? `Guidance: ${step.ai_guidance}` : ''].filter(Boolean).join('\n\n');
  const initial = step.sequence_id === null;
  const personalizing = step.mode === 'ai_opening_line' || (initial && step.mode === 'ai_write');

  const fail = async (why: string): Promise<{ status: 'failed'; why: string }> => {
    await raiseEscalation(db, { workspaceId: thread.workspace_id, threadId: thread.id, reason: 'ai_unavailable', title: 'An AI-written email is due', explanation: `The AI agent couldn’t write ${initial ? 'the first email' : `follow-up ${step.position}`} (${why}). Write it yourself, or change the step to a template.` }, now);
    await evaluateThread(db, thread.id, { now }).catch(() => deps.jobs.enqueue('thread.evaluate', { thread_id: thread.id }));
    return { status: 'failed', why };
  };

  if (await budgetExhausted(db, thread.workspace_id, now)) return fail('the workspace’s AI budget for this month is spent');

  let failures: GuardrailFailure[] = [];
  let runId: string | null = null;
  let composition: Pick<AiComposition, 'openingLine' | 'written'> = {};
  let confidence = 0;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (personalizing) {
      const settings = deps.settings?.personalize ?? DEFAULT_TASK_SETTINGS.personalize;
      const instruction = fill(prompt('personalize'), { mode_instruction: MODE_INSTRUCTIONS[step.mode === 'ai_opening_line' ? 'ai_opening_line' : 'initial_write'], brief, today: setup.context.today, revision: revisionNote(failures) });
      const result = await deps.claude.run({ task: 'personalize', settings, ...assemble(setup.context, { instruction }, setup.canary), schema: personalizationSchema });
      if (result.status !== 'ok') {
        await recordRun(db, { workspaceId: thread.workspace_id, threadId: thread.id, messageId: null, task: 'personalize', now, settings, result });
        return fail(result.status);
      }
      const output: Personalization = result.output;
      const text = step.mode === 'ai_opening_line' ? { subject: null, body_text: output.opening_line ?? '' } : { subject: output.subject, body_text: output.body_text ?? '' };
      // The step's own template and guidance are campaign configuration: facts from them are fine.
      failures = checkDraft(guardrailInputFor(setup, text, brief, step.mode === 'ai_opening_line' ? OPENING_LINE_WORDS : FOLLOW_UP_WORDS));
      runId = await recordRun(db, { workspaceId: thread.workspace_id, threadId: thread.id, messageId: null, task: 'personalize', now, settings, result, guardrails: failures.length ? failures : null });
      composition = step.mode === 'ai_opening_line' ? { openingLine: text.body_text } : { written: { subject: text.subject, body: text.body_text } };
      confidence = clamp01(output.confidence);
    } else {
      const settings = deps.settings?.draft_follow_up ?? DEFAULT_TASK_SETTINGS.draft_follow_up;
      const instruction = fill(prompt('draft_follow_up'), { position: String(step.position), sequence: sequence?.name ?? '', mode_instruction: MODE_INSTRUCTIONS[step.mode === 'ai_adapt' ? 'ai_adapt' : 'ai_write'], brief, max_words: String(FOLLOW_UP_WORDS), today: setup.context.today, revision: revisionNote(failures) });
      const result = await deps.claude.run({ task: 'draft_follow_up', settings, ...assemble(setup.context, { instruction }, setup.canary), schema: replyDraftSchema });
      if (result.status !== 'ok') {
        await recordRun(db, { workspaceId: thread.workspace_id, threadId: thread.id, messageId: null, task: 'draft_follow_up', now, settings, result });
        return fail(result.status);
      }
      const draft: ReplyDraft = result.output;
      failures = checkDraft(guardrailInputFor(setup, draft, brief, FOLLOW_UP_WORDS));
      runId = await recordRun(db, { workspaceId: thread.workspace_id, threadId: thread.id, messageId: null, task: 'draft_follow_up', now, settings, result, guardrails: failures.length ? failures : null });
      composition = { written: { subject: draft.subject, body: draft.body_text } };
      confidence = draft.needs_human ? 0 : clamp01(draft.confidence);
    }
    if (failures.length === 0) break;
  }

  const send = await decide(db, setup, { personalizing, confidence, guardrailsPassed: failures.length === 0 });
  const result = await db.transaction((tx) =>
    composeNext(
      tx,
      { threadId: thread.id, mailboxId: input.mailboxId, scheduledFor: new Date(Math.max(input.scheduledFor.getTime(), now.getTime())), stepId: step.id },
      { jobs: deps.jobs, rng: deps.rng, trackingSecret: deps.trackingSecret, appHost: deps.appHost, now },
      { ...composition, status: send.decision === 'auto_send' ? 'scheduled' : 'pending_approval', runId, approvalReasons: send.reasons, variantId: variant.id },
    ),
  );
  if (failures.length > 0 && 'messageId' in result) {
    // A second guardrail failure escalates, with the email attached (§10.9).
    await raiseEscalation(db, { workspaceId: thread.workspace_id, threadId: thread.id, reason: 'guardrail_failed', title: 'An AI-written email failed its checks', explanation: failures.map((failure) => failure.message).join(' '), suggestedDraftId: result.messageId }, now);
  }
  return result;
}

/** §10.7 for an AI-written step. */
async function decide(db: Db, setup: AgentSetup, input: { personalizing: boolean; confidence: number; guardrailsPassed: boolean }): Promise<SendDecision> {
  const { thread, campaign } = setup;
  if (input.personalizing) {
    // The first few personalized first emails of a campaign are reviewed by a person (assisted).
    const [reviewed] = await db
      .select({ n: count() })
      .from(messages)
      .innerJoin(threads, eq(threads.id, messages.thread_id))
      .where(and(eq(threads.campaign_id, campaign.id), eq(messages.author, 'ai'), isNotNull(messages.approved_at), isNotNull(messages.step_id)));
    return decideSend({ autonomy: campaign.autonomy, messageClass: 'ai_personalized', personalizedReviewed: reviewed?.n ?? 0, reviewFirstNPersonalized: campaign.review_first_n_personalized, guardrailsPassed: input.guardrailsPassed });
  }
  // A follow-up has no new message; it goes by the classification of the contact's last one, and
  // every classification is Claude's alone while Jev isn't connected (§10.4 fallback).
  const [replied] = await db.select({ n: count() }).from(messages).where(and(eq(messages.thread_id, thread.id), eq(messages.direction, 'inbound')));
  const blockers: AutoSendBlocker[] | null = (replied?.n ?? 0) > 0 ? ['classification_fallback'] : null;
  return decideSend({
    autonomy: campaign.autonomy,
    messageClass: 'ai_follow_up',
    classificationBlockers: blockers,
    draftConfidence: input.confidence,
    autoSendMinConfidence: Number(campaign.auto_send_min_confidence),
    guardrailsPassed: input.guardrailsPassed,
    escalationReasons: [],
    aiRepliesSent: thread.ai_replies_sent,
    maxAiRepliesPerThread: campaign.max_ai_replies_per_thread,
    aiPaused: thread.ai_paused,
  });
}
