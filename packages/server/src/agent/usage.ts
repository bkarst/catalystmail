// Settings → AI's spend chart and run health (spec §10.2, §15.18): what the agent cost and how its
// runs went, by day (in the workspace's timezone), by task and by model, with the month's budget.

import { ai_runs, workspaces, type Db } from '@catalyst/db';
import { and, asc, eq, gte, sql } from 'drizzle-orm';

import { aiBudget } from './budget.ts';

const DAY_MS = 86_400_000;
const usd = (micros: number | string | null) => Math.round(Number(micros ?? 0)) / 1_000_000;

export async function getAiUsage(db: Db, workspaceId: string, query: { days: number }, now: Date) {
  const [workspace] = await db.select({ zone: workspaces.default_timezone }).from(workspaces).where(eq(workspaces.id, workspaceId));
  const zone = workspace?.zone ?? 'UTC';
  const since = new Date(now.getTime() - query.days * DAY_MS);
  const where = and(eq(ai_runs.workspace_id, workspaceId), gte(ai_runs.created_at, since));
  const day = sql<string>`to_char(${ai_runs.created_at} at time zone ${zone}, 'YYYY-MM-DD')`;
  const totals = {
    runs: sql<number>`count(*)::int`,
    cost: sql<string>`coalesce(sum(${ai_runs.cost_usd_micros}), 0)`,
  };

  const [byDay, byTask, byModel, [sums]] = await Promise.all([
    db.select({ day, ...totals }).from(ai_runs).where(where).groupBy(sql`1`).orderBy(asc(sql`1`)),
    db
      .select({
        task: ai_runs.task,
        ...totals,
        failed: sql<number>`(count(*) filter (where ${ai_runs.status} in ('error', 'refusal', 'invalid_output')))::int`,
        guardrail_blocked: sql<number>`(count(*) filter (where ${ai_runs.status} = 'guardrail_blocked'))::int`,
        latency: sql<number | null>`(percentile_cont(0.5) within group (order by ${ai_runs.latency_ms}))::int`,
      })
      .from(ai_runs)
      .where(where)
      .groupBy(ai_runs.task)
      .orderBy(asc(ai_runs.task)),
    db.select({ model: ai_runs.model, ...totals }).from(ai_runs).where(where).groupBy(ai_runs.model).orderBy(asc(ai_runs.model)),
    db
      .select({
        ...totals,
        input: sql<string>`coalesce(sum(${ai_runs.input_tokens}), 0)`,
        output: sql<string>`coalesce(sum(${ai_runs.output_tokens}), 0)`,
        cacheRead: sql<string>`coalesce(sum(${ai_runs.cache_read_tokens}), 0)`,
        cacheWrite: sql<string>`coalesce(sum(${ai_runs.cache_write_tokens}), 0)`,
      })
      .from(ai_runs)
      .where(where),
  ]);
  // Each reply read in the period: classified by Jev, or by Claude alone (the fallback, §10.4).
  const [reads] = await db.execute<{ total: number; fallback: number; both: number; disagreed: number }>(sql`
    with replies as (
      select distinct trigger_message_id as id from ${ai_runs}
      where workspace_id = ${workspaceId} and created_at >= ${since} and trigger_message_id is not null and task in ('analyze_inbound', 'classify_conversation')
    ), jev as (
      select trigger_message_id as id, bool_or(decision like 'disagree:%') as disagreed from ${ai_runs}
      where workspace_id = ${workspaceId} and created_at >= ${since} and task = 'classify_conversation' and status = 'ok' and trigger_message_id is not null
      group by trigger_message_id
    ), claude as (
      select distinct trigger_message_id as id from ${ai_runs}
      where workspace_id = ${workspaceId} and created_at >= ${since} and task = 'analyze_inbound' and trigger_message_id is not null
    )
    select (select count(*) from replies)::int as total,
      (select count(*) from replies r where not exists (select 1 from jev j where j.id = r.id))::int as fallback,
      (select count(*) from jev j join claude c on c.id = j.id)::int as both,
      (select count(*) from jev j join claude c on c.id = j.id where j.disagreed)::int as disagreed`).then((result) => result.rows);
  const share = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 10_000) / 10_000 : 0);
  const budget = await aiBudget(db, workspaceId, now);
  return {
    since: since.toISOString(),
    total: {
      runs: sums?.runs ?? 0,
      cost_usd: usd(sums?.cost ?? 0),
      input_tokens: Number(sums?.input ?? 0),
      output_tokens: Number(sums?.output ?? 0),
      cache_read_tokens: Number(sums?.cacheRead ?? 0),
      cache_write_tokens: Number(sums?.cacheWrite ?? 0),
    },
    by_day: byDay.map((row) => ({ day: row.day, runs: row.runs, cost_usd: usd(row.cost) })),
    by_task: byTask.map((row) => ({ task: row.task, runs: row.runs, cost_usd: usd(row.cost), failed: row.failed, guardrail_blocked: row.guardrail_blocked, median_latency_ms: row.latency })),
    by_model: byModel.map((row) => ({ model: row.model, runs: row.runs, cost_usd: usd(row.cost) })),
    classification_fallback_rate: share(reads?.fallback ?? 0, reads?.total ?? 0),
    // Of the replies both models read, the share where they disagreed: the best source of new labelled examples.
    disagreement_rate: share(reads?.disagreed ?? 0, reads?.both ?? 0),
    budget: { monthly_budget_usd: budget.budget_usd, month: budget.month, spent_usd: budget.spent_usd, used: budget.used, level: budget.level },
  };
}
