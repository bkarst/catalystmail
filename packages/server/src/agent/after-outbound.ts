// Jev after a person's own email (spec §10.4 "When it runs"): an outbound message written by a
// person, in Catalyst or straight from the mailbox (§7.6), can change where the conversation
// stands, such as the operator confirming a call. Only the whole-conversation questions are asked,
// and only goals act on the answer (`decideAfterOutbound`). Without Jev nothing runs: Claude
// isn't asked to classify our own email.

import { decideAfterOutbound, type ClassificationThresholds } from '@catalyst/core';
import { activities, ai_runs, campaigns, messages, newId, threads, type Db } from '@catalyst/db';
import { and, count, eq, gte, inArray, isNotNull } from 'drizzle-orm';

import { raiseEscalation } from '../escalations/raise.ts';
import { evaluateThread } from '../threads/evaluate.ts';
import { writeAchievement } from '../threads/service.ts';
import { budgetExhausted, forWorkspace } from './budget.ts';
import { loadSetup, RUNS_PER_THREAD_PER_DAY, type AgentDeps } from './inbound.ts';
import { classifyWithJev, storeJevClassification } from './jev.ts';

export type AfterOutboundOutcome = { status: 'skipped'; why: string } | { status: 'classified'; achieved: string[]; confirm: string[] };

export async function classifyAfterOutbound(db: Db, messageId: string, deps: Pick<AgentDeps, 'jev' | 'jevModel' | 'jobs' | 'now' | 'canarySecret'>): Promise<AfterOutboundOutcome> {
  const { now } = deps;
  if (!deps.jev || !deps.jevModel) return { status: 'skipped', why: 'Jev isn’t set up' };
  const [message] = await db.select().from(messages).where(eq(messages.id, messageId));
  if (!message?.thread_id || message.direction !== 'outbound' || (message.author !== 'human_app' && message.author !== 'human_external')) return { status: 'skipped', why: 'not a person’s own email on a thread' };
  const [thread] = await db.select().from(threads).where(eq(threads.id, message.thread_id));
  if (!thread?.mailbox_id) return { status: 'skipped', why: 'nothing was sent on the thread' };
  if (await budgetExhausted(db, thread.workspace_id, now)) return { status: 'skipped', why: 'the AI budget for this month is spent' };
  const [runs] = await db.select({ n: count() }).from(ai_runs).where(and(eq(ai_runs.thread_id, thread.id), gte(ai_runs.created_at, new Date(now.getTime() - 86_400_000))));
  if ((runs?.n ?? 0) >= RUNS_PER_THREAD_PER_DAY) return { status: 'skipped', why: 'the thread used its AI runs for today' };

  return classifyThreadGoals(db, thread, messageId, { ...deps, jev: deps.jev, jevModel: deps.jevModel });
}

type ThreadRow = typeof threads.$inferSelect;
type Deps = Pick<AgentDeps, 'jev' | 'jevModel' | 'jobs' | 'now' | 'canarySecret'> & { jev: NonNullable<AgentDeps['jev']>; jevModel: string };

/** Jev's whole-conversation questions on one thread, and what its goals do with the answer. */
async function classifyThreadGoals(db: Db, thread: ThreadRow, messageId: string | null, deps: Deps): Promise<AfterOutboundOutcome> {
  const { now } = deps;
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, thread.campaign_id));
  const workspace = await forWorkspace(db, thread.workspace_id, { jevModel: deps.jevModel as string | null | undefined, thresholds: undefined as ClassificationThresholds | undefined });
  const setup = await loadSetup(db, thread, campaign!, deps);
  const read = await classifyWithJev(db, setup, { messageId, trigger: 'outbound' }, { jev: deps.jev, jevModel: workspace.jevModel ?? deps.jevModel, now });
  if (!read) return { status: 'skipped', why: 'Jev didn’t answer' };
  await storeJevClassification(db, setup, read, { messageId: null, summary: null, disagreements: [] }, now);

  const decisions = decideAfterOutbound(read.classification, setup.goals.map((goal) => ({ key: goal.key, autoConfirm: goal.auto_confirm })), Number(campaign!.goal_auto_confirm_threshold), workspace.thresholds);
  const achieved: string[] = [];
  const confirm: string[] = [];
  for (const decision of decisions) {
    const goal = setup.goals.find((entry) => entry.key === decision.key)!;
    if (decision.action === 'achieve') {
      await db.transaction(async (tx) => {
        await writeAchievement(tx, thread, goal.id, { method: 'ai', confidence: decision.p.toFixed(3), evidence: null, eventAt: null, confirmedBy: null }, now);
        await tx.insert(activities).values({ id: newId('activity'), workspace_id: thread.workspace_id, contact_id: thread.contact_id, thread_id: thread.id, campaign_id: thread.campaign_id, type: 'goal.achieved', actor_type: 'ai', data: { goal_id: goal.id, method: 'ai', p: decision.p, message_id: messageId }, occurred_at: now });
      });
      achieved.push(goal.key);
    } else {
      await raiseEscalation(db, { workspaceId: thread.workspace_id, threadId: thread.id, reason: 'goal_confirmation', title: `Reached “${goal.name}”?`, explanation: `After your email the conversation reads as if it did (${Math.round(decision.p * 100)}%). Confirm or reject it.`, triggerMessageId: messageId, goal: { id: goal.id, p: decision.p } }, now);
      confirm.push(goal.key);
    }
  }
  await evaluateThread(db, thread.id, { now }).catch(() => deps.jobs.enqueue('thread.evaluate', { thread_id: thread.id }));
  return { status: 'classified', achieved, confirm };
}

const RECLASSIFY_LIMIT = 500;

/**
 * §10.4: when a campaign's goals change, its open conversations are read again, so goals the
 * contact already met under the new criteria show up. Threads where the contact has replied only;
 * at most 500 a run, and the budget and per-thread cap hold.
 */
export async function reclassifyCampaign(db: Db, campaignId: string, deps: Pick<AgentDeps, 'jev' | 'jevModel' | 'jobs' | 'now' | 'canarySecret'>): Promise<{ classified: number; skipped: number }> {
  const result = { classified: 0, skipped: 0 };
  if (!deps.jev || !deps.jevModel) return result;
  const open = await db
    .select()
    .from(threads)
    .where(and(eq(threads.campaign_id, campaignId), inArray(threads.state, ['active', 'needs_human', 'pending_approval', 'paused']), isNotNull(threads.responded_at), isNotNull(threads.mailbox_id)))
    .limit(RECLASSIFY_LIMIT);
  for (const thread of open) {
    if (await budgetExhausted(db, thread.workspace_id, deps.now)) break;
    const [runs] = await db.select({ n: count() }).from(ai_runs).where(and(eq(ai_runs.thread_id, thread.id), gte(ai_runs.created_at, new Date(deps.now.getTime() - 86_400_000))));
    if ((runs?.n ?? 0) >= RUNS_PER_THREAD_PER_DAY) {
      result.skipped += 1;
      continue;
    }
    const outcome = await classifyThreadGoals(db, thread, null, { ...deps, jev: deps.jev, jevModel: deps.jevModel });
    if (outcome.status === 'classified') result.classified += 1;
    else result.skipped += 1;
  }
  return result;
}


/**
 * §10.7: in external agent mode the built-in agent writes nothing, but Jev still reads each reply,
 * so the harness sees the classification (the thread's fields, the work queue, getThreadContext)
 * and the conversation knows whether it waits on the contact. Nothing acts on it here.
 */
export async function classifyForHarness(db: Db, messageId: string, deps: Pick<AgentDeps, 'jev' | 'jevModel' | 'jobs' | 'now' | 'canarySecret'>): Promise<{ status: 'classified' | 'skipped'; why?: string }> {
  if (!deps.jev || !deps.jevModel) return { status: 'skipped', why: 'Jev isn’t set up' };
  const [message] = await db.select().from(messages).where(eq(messages.id, messageId));
  if (!message?.thread_id || message.direction !== 'inbound') return { status: 'skipped', why: 'not an inbound email on a thread' };
  const [thread] = await db.select().from(threads).where(eq(threads.id, message.thread_id));
  if (!thread?.mailbox_id) return { status: 'skipped', why: 'nothing was sent on the thread' };
  if (await budgetExhausted(db, thread.workspace_id, deps.now)) return { status: 'skipped', why: 'the AI budget for this month is spent' };
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, thread.campaign_id));
  const setup = await loadSetup(db, thread, campaign!, deps);
  const read = await classifyWithJev(db, setup, { messageId, trigger: 'inbound' }, { jev: deps.jev, jevModel: deps.jevModel, now: deps.now });
  if (!read) return { status: 'skipped', why: 'Jev didn’t answer' };
  await storeJevClassification(db, setup, read, { messageId, summary: null, disagreements: [] }, deps.now);
  await evaluateThread(db, thread.id, { now: deps.now }).catch(() => deps.jobs.enqueue('thread.evaluate', { thread_id: thread.id }));
  return { status: 'classified' };
}
