// Workspace settings (spec §15.18). Business hours live in `workspaces.settings` and set the clock
// escalation SLAs count in (§11.1); without them, Monday to Friday 09:00–17:00.

import { CLAUDE_TASKS, PRICED_MODELS, type Effort } from '@catalyst/ai';
import { DEFAULT_BUSINESS_HOURS, DEFAULT_THRESHOLDS, thresholdProblems, type ClassificationThresholds, type SendingWindow } from '@catalyst/core';
import { workspaces, type Db, type Executor } from '@catalyst/db';
import { eq } from 'drizzle-orm';

import type { Principal } from '../api/auth.ts';
import { invalidField, notFound, validationFailed } from '../api/errors.ts';
import { assertFresh } from '../api/etag.ts';
import type { SecretBox } from '../secrets.ts';
import { audit } from '../shared.ts';
import { requiresOwnerTwoFactor } from '../auth/session.ts';
import { aiBudget, aiSettingsOf, resolveTaskSettings, taskOverridesOf, thresholdsOf, type TaskOverrides } from '../agent/budget.ts';
import { unsafeUrlReason, type WebhookNet } from '../webhooks/net.ts';

type WorkspaceRow = typeof workspaces.$inferSelect;

/** The workspace's business hours, or the default. */
export function businessHoursOf(settings: unknown): SendingWindow {
  const stored = (settings as { business_hours?: SendingWindow } | null)?.business_hours;
  return stored && Array.isArray(stored.days) && stored.start && stored.end ? stored : DEFAULT_BUSINESS_HOURS;
}

/** What an escalation's SLA needs: the zone and the business hours. */
export async function slaClockFor(db: Executor, workspaceId: string): Promise<{ zone: string; businessHours: SendingWindow }> {
  const [workspace] = await db.select({ zone: workspaces.default_timezone, settings: workspaces.settings }).from(workspaces).where(eq(workspaces.id, workspaceId));
  return { zone: workspace?.zone ?? 'UTC', businessHours: businessHoursOf(workspace?.settings) };
}

export interface NotificationSettings {
  /** The Slack incoming-webhook URL, sealed, as base64. */
  slack_webhook_enc?: string | null;
  quiet_hours?: { start: string; end: string } | null;
}

export const notificationSettingsOf = (settings: unknown): NotificationSettings => ((settings as { notifications?: NotificationSettings } | null)?.notifications ?? {});

async function serialize(db: Db, row: WorkspaceRow, now: Date, deploymentJevModel: string | null = null) {
  const ai = aiSettingsOf(row.settings);
  const jevModel = deploymentJevModel ? (ai.jev_model ?? deploymentJevModel) : null;
  const budget = await aiBudget(db, row.id, now);
  const overrides = taskOverridesOf(row.settings);
  const tasks = resolveTaskSettings(overrides);
  const hours = businessHoursOf(row.settings);
  const notifications = notificationSettingsOf(row.settings);
  return {
    id: row.id,
    name: row.name,
    physical_address: row.physical_address,
    default_timezone: row.default_timezone,
    business_hours: { days: [...hours.days], start: hours.start, end: hours.end },
    notifications: { slack_configured: Boolean(notifications.slack_webhook_enc), quiet_hours: notifications.quiet_hours ?? null },
    ai: {
      monthly_budget_usd: budget.budget_usd,
      month: budget.month,
      spent_usd: budget.spent_usd,
      used: budget.used,
      level: budget.level,
      tasks: CLAUDE_TASKS.map((task) => ({ task, model: tasks[task].model, effort: tasks[task].effort, overridden: Boolean(overrides[task]) })),
      disclosure: ai.disclosure ?? 'none',
      jev: { model: jevModel, pinned_by: jevModel === null ? null : ai.jev_model ? ('workspace' as const) : ('deployment' as const), thresholds: { ...thresholdsOf(row.settings) }, thresholds_updated_at: ai.thresholds_updated_at ?? null },
    },
    security: { require_owner_two_factor: requiresOwnerTwoFactor(row.settings) },
    updated_at: row.updated_at.toISOString(),
  };
}

async function find(db: Db, workspaceId: string): Promise<WorkspaceRow> {
  const [row] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
  if (!row) throw notFound('The workspace');
  return row;
}

export async function getWorkspaceSettings(db: Db, workspaceId: string, now: Date, deploymentJevModel: string | null = null) {
  return serialize(db, await find(db, workspaceId), now, deploymentJevModel);
}

const validZone = (zone: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
};

export async function updateWorkspaceSettings(
  db: Db,
  principal: Principal,
  input: {
    name?: string | undefined;
    physical_address?: string | undefined;
    default_timezone?: string | undefined;
    business_hours?: SendingWindow | undefined;
    notifications?: { slack_webhook_url?: string | null | undefined; quiet_hours?: { start: string; end: string } | null | undefined } | undefined;
    security?: { require_owner_two_factor?: boolean | undefined } | undefined;
    ai?: { jev_model?: string | null | undefined; thresholds?: Partial<Record<keyof ClassificationThresholds, number>> | null | undefined; monthly_budget_usd?: number | null | undefined; disclosure?: 'none' | 'signature_line' | undefined; tasks?: Partial<Record<string, { model?: string | undefined; effort?: Effort | undefined } | null>> | undefined } | undefined;
  },
  ifMatch: string | null,
  deps: { secrets: SecretBox; net: Pick<WebhookNet, 'resolve'>; jevModel?: string | null },
  now: Date,
) {
  const current = await find(db, principal.workspace.id);
  assertFresh({ id: current.id, updated_at: current.updated_at.toISOString() }, ifMatch);
  if (input.default_timezone !== undefined && !validZone(input.default_timezone)) throw invalidField('body.default_timezone', `${input.default_timezone} is not an IANA timezone.`);
  if (input.business_hours) {
    if (new Set(input.business_hours.days).size !== input.business_hours.days.length) throw invalidField('body.business_hours.days', 'Each day once.');
    if (input.business_hours.start >= input.business_hours.end) throw invalidField('body.business_hours.end', 'The day must end after it starts.');
  }
  const patch: Partial<typeof workspaces.$inferInsert> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.physical_address !== undefined) patch.physical_address = input.physical_address;
  if (input.default_timezone !== undefined) patch.default_timezone = input.default_timezone;
  let settings = current.settings as Record<string, unknown>;
  if (input.business_hours) settings = { ...settings, business_hours: { days: [...input.business_hours.days].sort(), start: input.business_hours.start, end: input.business_hours.end } };
  if (input.notifications) {
    const notifications: NotificationSettings = { ...notificationSettingsOf(settings) };
    const url = input.notifications.slack_webhook_url;
    if (url !== undefined) {
      // Alerts go to it from the worker: it must be public, like any webhook (§13.6).
      const unsafe = url === null ? null : await unsafeUrlReason(url, deps.net);
      if (unsafe) throw invalidField('body.notifications.slack_webhook_url', unsafe);
      notifications.slack_webhook_enc = url === null ? null : deps.secrets.seal(url).toString('base64');
    }
    if (input.notifications.quiet_hours !== undefined) notifications.quiet_hours = input.notifications.quiet_hours;
    settings = { ...settings, notifications };
  }
  if (input.ai?.monthly_budget_usd !== undefined) {
    // A new budget starts its alerts afresh: 80% of it is worth telling, even if the old one was spent.
    const { ai_budget_alerted: _alerted, ...rest } = settings as Record<string, unknown> & { ai_budget_alerted?: string };
    settings = { ...rest, ai: { ...aiSettingsOf(settings), monthly_budget_usd: input.ai.monthly_budget_usd } };
  }
  if (input.ai?.tasks) {
    const tasks: TaskOverrides = { ...taskOverridesOf(settings) };
    for (const [task, change] of Object.entries(input.ai.tasks) as [keyof TaskOverrides, { model?: string | undefined; effort?: Effort | undefined } | null][]) {
      if (change?.model !== undefined && !PRICED_MODELS.includes(change.model)) throw invalidField(`body.ai.tasks.${task}.model`, `Catalyst doesn’t know the prices of ${change.model}, so its runs couldn’t count against the budget. Use one of ${PRICED_MODELS.join(', ')}.`);
      if (change === null) delete tasks[task];
      else tasks[task] = { ...tasks[task], ...(change.model !== undefined && { model: change.model }), ...(change.effort !== undefined && { effort: change.effort }) };
    }
    settings = { ...settings, ai: { ...aiSettingsOf(settings), tasks } };
  }
  if (input.ai?.disclosure !== undefined) settings = { ...settings, ai: { ...aiSettingsOf(settings), disclosure: input.ai.disclosure } };
  if (input.ai?.jev_model !== undefined) settings = { ...settings, ai: { ...aiSettingsOf(settings), jev_model: input.ai.jev_model } };
  if (input.ai?.thresholds !== undefined) {
    const overrides = input.ai.thresholds === null ? {} : { ...(aiSettingsOf(settings).thresholds ?? {}), ...input.ai.thresholds };
    const problems = thresholdProblems({ ...DEFAULT_THRESHOLDS, ...overrides });
    if (problems.length) throw validationFailed(problems.map((message) => ({ path: 'body.ai.thresholds', message })));
    settings = { ...settings, ai: { ...aiSettingsOf(settings), thresholds: overrides, thresholds_updated_at: input.ai.thresholds === null ? null : now.toISOString() } };
  }
  const requireTwoFactor = input.security?.require_owner_two_factor;
  if (requireTwoFactor !== undefined) settings = { ...settings, security: { ...((settings as { security?: object }).security ?? {}), require_owner_two_factor: requireTwoFactor } };
  if (input.business_hours || input.notifications || input.ai?.monthly_budget_usd !== undefined || input.ai?.tasks || input.ai?.disclosure !== undefined || input.ai?.jev_model !== undefined || input.ai?.thresholds !== undefined || requireTwoFactor !== undefined) patch.settings = settings;
  const row = await db.transaction(async (tx) => {
    const [updated] = await tx.update(workspaces).set({ ...patch, updated_at: now }).where(eq(workspaces.id, current.id)).returning();
    await audit(tx, principal, 'settings.updated', { type: 'workspace', id: current.id }, { fields: Object.keys(input) }, now);
    return updated!;
  });
  return serialize(db, row, now, deps.jevModel ?? null);
}
