// The workspace's monthly AI budget (spec §10.2). Spend is the cost of every `ai_runs` row since
// the 1st of the month in the workspace's timezone. At 80% the owners and admins are told; at
// 100% the agent stops: replies and AI-written steps go to a person instead (ai_unavailable), and
// the API's AI operations answer 503 budget_exceeded until the month turns or the budget is raised.

import { CLAUDE_TASKS, DEFAULT_TASK_SETTINGS, type ClaudeTask, type Effort, type TaskSettings } from '@catalyst/ai';
import { DEFAULT_THRESHOLDS, intlZoneCalendar, type ClassificationThresholds } from '@catalyst/core';
import { activities, ai_runs, newId, workspaces, type Executor } from '@catalyst/db';
import { and, eq, gte, sql } from 'drizzle-orm';

import { ApiError } from '../api/errors.ts';

export const BUDGET_WARN_AT = 0.8;

export interface AiSettings {
  /** USD a calendar month; null or missing means no cap. */
  monthly_budget_usd?: number | null;
  tasks?: Partial<Record<string, { model?: string; effort?: string }>>;
  /** §10.9: whether AI-written email says so under the signature. */
  disclosure?: 'none' | 'signature_line';
  /** §10.4: this workspace's pinned Jev version, over the deployment's TYPESAFE_MODEL. */
  jev_model?: string | null;
  /** §10.4, §22.B: overrides of the classification thresholds, and when they last changed. */
  thresholds?: Partial<ClassificationThresholds>;
  thresholds_updated_at?: string | null;
}

/** The workspace's classification thresholds: §22.B's defaults with its overrides. */
export const thresholdsOf = (settings: unknown): ClassificationThresholds => ({ ...DEFAULT_THRESHOLDS, ...(aiSettingsOf(settings).thresholds ?? {}) });

export const disclosesAi = (settings: unknown): boolean => aiSettingsOf(settings).disclosure === 'signature_line';

export const aiSettingsOf = (settings: unknown): AiSettings => ((settings as { ai?: AiSettings } | null)?.ai ?? {});

export type BudgetLevel = 'unlimited' | 'ok' | 'warning' | 'exhausted';

export interface AiBudget {
  /** The month spend counts in, YYYY-MM in the workspace's timezone. */
  month: string;
  month_started_at: Date;
  budget_usd: number | null;
  spent_usd: number;
  /** Spend over the budget, rounded to 4 places; null without a budget. */
  used: number | null;
  level: BudgetLevel;
}

/** The start of the calendar month containing `now`, in `zone`. */
export function monthOf(now: Date, zone: string): { month: string; start: Date } {
  const local = intlZoneCalendar.toLocal(now, zone);
  return {
    month: `${local.year}-${String(local.month).padStart(2, '0')}`,
    start: intlZoneCalendar.fromLocal({ year: local.year, month: local.month, day: 1, hour: 0, minute: 0, second: 0 }, zone),
  };
}

export function levelOf(budgetUsd: number | null, spentUsd: number): BudgetLevel {
  if (budgetUsd === null) return 'unlimited';
  if (spentUsd >= budgetUsd) return 'exhausted';
  return spentUsd >= budgetUsd * BUDGET_WARN_AT ? 'warning' : 'ok';
}

export async function aiBudget(db: Executor, workspaceId: string, now: Date): Promise<AiBudget> {
  const [workspace] = await db.select({ zone: workspaces.default_timezone, settings: workspaces.settings }).from(workspaces).where(eq(workspaces.id, workspaceId));
  const { month, start } = monthOf(now, workspace?.zone ?? 'UTC');
  const configured = aiSettingsOf(workspace?.settings).monthly_budget_usd;
  const budget = typeof configured === 'number' && Number.isFinite(configured) ? configured : null;
  const [spend] = await db
    .select({ micros: sql<string>`coalesce(sum(${ai_runs.cost_usd_micros}), 0)` })
    .from(ai_runs)
    .where(and(eq(ai_runs.workspace_id, workspaceId), gte(ai_runs.created_at, start)));
  const spent = Number(spend?.micros ?? 0) / 1_000_000;
  return {
    month,
    month_started_at: start,
    budget_usd: budget,
    spent_usd: Math.round(spent * 1_000_000) / 1_000_000,
    used: budget === null ? null : budget > 0 ? Math.round((spent / budget) * 10_000) / 10_000 : 1,
    level: levelOf(budget, spent),
  };
}

export async function budgetExhausted(db: Executor, workspaceId: string, now: Date): Promise<boolean> {
  return (await aiBudget(db, workspaceId, now)).level === 'exhausted';
}

/** For the API's AI operations: 503 budget_exceeded once the month's budget is spent. */
export async function assertBudget(db: Executor, workspaceId: string, now: Date): Promise<void> {
  const budget = await aiBudget(db, workspaceId, now);
  if (budget.level !== 'exhausted') return;
  throw new ApiError(503, 'budget_exceeded', `This workspace spent its AI budget for ${budget.month} ($${budget.spent_usd.toFixed(2)} of $${budget.budget_usd!.toFixed(2)}). Raise it in Settings → AI, or wait for next month.`);
}

/**
 * After a run: the first time in a month that spend passes 80%, then 100%, an activity says so,
 * which the notification dispatcher sends to the owners and admins. A marker in the workspace's
 * settings, set with a compare-and-set, keeps two runs finishing together from both announcing it.
 */
export async function noteSpend(db: Executor, workspaceId: string, now: Date): Promise<void> {
  const budget = await aiBudget(db, workspaceId, now);
  if (budget.level !== 'warning' && budget.level !== 'exhausted') return;
  // Sorts in the order alerts happen: 2026-11:1 (warning) < 2026-11:2 (exhausted) < 2026-12:1.
  const marker = `${budget.month}:${budget.level === 'warning' ? 1 : 2}`;
  await db.transaction(async (tx) => {
    const marked = await tx.execute(sql`
      update ${workspaces} set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{ai_budget_alerted}', to_jsonb(${marker}::text), true)
      where id = ${workspaceId} and coalesce(settings->>'ai_budget_alerted', '') < ${marker}
      returning id`);
    if (marked.rows.length === 0) return;
    await tx.insert(activities).values({
      id: newId('activity'),
      workspace_id: workspaceId,
      type: budget.level === 'warning' ? 'ai.budget_warning' : 'ai.budget_exhausted',
      actor_type: 'system',
      data: { month: budget.month, budget_usd: budget.budget_usd, spent_usd: budget.spent_usd, used: budget.used },
      occurred_at: now,
    });
  });
}

/** Settings → AI: a workspace's per-task model and effort, over the deployment's and the defaults (§10.2). */
export type TaskOverrides = Partial<Record<ClaudeTask, { model?: string; effort?: Effort }>>;

export const taskOverridesOf = (settings: unknown): TaskOverrides => (aiSettingsOf(settings).tasks ?? {}) as TaskOverrides;

export function resolveTaskSettings(overrides: TaskOverrides, base: Partial<Record<ClaudeTask, TaskSettings>> = {}): Record<ClaudeTask, TaskSettings> {
  return Object.fromEntries(
    CLAUDE_TASKS.map((task) => {
      const start = base[task] ?? DEFAULT_TASK_SETTINGS[task];
      const own = overrides[task] ?? {};
      return [task, { ...start, ...(own.model && { model: own.model }), ...(own.effort && { effort: own.effort }) }];
    }),
  ) as Record<ClaudeTask, TaskSettings>;
}

/** The agent's dependencies with the workspace's settings applied: task models, Jev's pin, thresholds. */
export async function forWorkspace<D extends { settings?: Partial<Record<ClaudeTask, TaskSettings>>; jevModel?: string | null; thresholds?: ClassificationThresholds }>(db: Executor, workspaceId: string, deps: D): Promise<D> {
  const [workspace] = await db.select({ settings: workspaces.settings }).from(workspaces).where(eq(workspaces.id, workspaceId));
  const ai = aiSettingsOf(workspace?.settings);
  return {
    ...deps,
    settings: resolveTaskSettings(taskOverridesOf(workspace?.settings), deps.settings),
    // A workspace pin only applies where the deployment has Jev at all.
    ...(deps.jevModel && ai.jev_model && { jevModel: ai.jev_model }),
    thresholds: thresholdsOf(workspace?.settings),
  };
}
