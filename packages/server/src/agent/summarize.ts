// The rolling thread summary (spec §10.1 `summarize`): after each inbound the agent read, Claude
// brings the thread's 2–4 sentence summary up to date from the one before and the newest emails.
// It is shown in the UI and goes back into later prompts as "Summary so far" (§10.3). Nothing is
// sent from it, so a failure only leaves the previous summary in place.

import { assemble, DEFAULT_TASK_SETTINGS, fill, prompt, threadSummarySchema } from '@catalyst/ai';
import { ai_runs, campaigns, threads, type Db } from '@catalyst/db';
import { and, count, eq, gte, isNull, lte, or } from 'drizzle-orm';

import { budgetExhausted, forWorkspace } from './budget.ts';
import { loadSetup, recordRun, RUNS_PER_THREAD_PER_DAY, type AgentDeps } from './inbound.ts';

const MAX_SUMMARY_CHARS = 1000;

export type SummaryOutcome = { status: 'summarized'; summary: string } | { status: 'skipped'; why: string } | { status: 'failed'; why: string };

export async function summarizeThread(db: Db, threadId: string, deps: AgentDeps): Promise<SummaryOutcome> {
  const { now } = deps;
  const [thread] = await db.select().from(threads).where(eq(threads.id, threadId));
  if (!thread?.mailbox_id) return { status: 'skipped', why: 'nothing was sent on the thread' };
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, thread.campaign_id));
  if (campaign!.agent_mode !== 'built_in') return { status: 'skipped', why: 'the campaign uses an external agent' };
  // A summary is a convenience: past the budget or the per-thread cap, it simply waits.
  if (await budgetExhausted(db, thread.workspace_id, now)) return { status: 'skipped', why: 'the AI budget for this month is spent' };
  const [runs] = await db.select({ n: count() }).from(ai_runs).where(and(eq(ai_runs.thread_id, thread.id), gte(ai_runs.created_at, new Date(now.getTime() - 86_400_000))));
  if ((runs?.n ?? 0) >= RUNS_PER_THREAD_PER_DAY) return { status: 'skipped', why: 'the thread used its AI runs for today' };

  deps = await forWorkspace(db, thread.workspace_id, deps);
  const setup = await loadSetup(db, thread, campaign!, deps);
  const settings = deps.settings?.summarize ?? DEFAULT_TASK_SETTINGS.summarize;
  const result = await deps.claude.run({ task: 'summarize', settings, ...assemble(setup.context, { instruction: fill(prompt('summarize'), { today: setup.context.today }) }, setup.canary), schema: threadSummarySchema });
  const summary = result.status === 'ok' ? result.output.summary.trim() : '';
  // The canary in the output means the instructions leaked (§10.9); such a summary isn't kept.
  const leaked = summary.includes(setup.canary);
  await recordRun(db, {
    workspaceId: thread.workspace_id,
    threadId: thread.id,
    messageId: null,
    task: 'summarize',
    now,
    settings,
    result,
    guardrails: leaked ? [{ check: 'leak', message: 'The summary contained the canary token.' }] : null,
  });
  if (result.status !== 'ok') return { status: 'failed', why: result.status };
  if (leaked || !summary) return { status: 'failed', why: leaked ? 'leak' : 'empty' };

  const kept = summary.slice(0, MAX_SUMMARY_CHARS);
  // A slower run never replaces a summary written after it started.
  await db
    .update(threads)
    .set({ ai_summary: kept, ai_summary_at: now, updated_at: now })
    .where(and(eq(threads.id, thread.id), or(isNull(threads.ai_summary_at), lte(threads.ai_summary_at, now))));
  return { status: 'summarized', summary: kept };
}
