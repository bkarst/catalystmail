// `capacity.plan` (spec §4.4, §8.3.1, §8.3.2): once per workspace day, after local midnight, each
// domain's ramp moves (up, held or back) from yesterday's sending and today's band, each mailbox's
// warm-up moves with its health band, and a mailbox paused for a provider quota error opens again.
// Runs hourly; a domain already moved today is skipped, so a run can repeat safely.

import { isSendingDay, moveRamp, rampFinalStep, warmupFinalStep, type Band, type RampPlan, type RampScheduleEntry, type RampStatus } from '@catalyst/core';
import { activities, domain_daily_stats, mailboxes, newId, sending_domains, workspaces, type Db, type Executor } from '@catalyst/db';
import { and, desc, eq, like, lt } from 'drizzle-orm';

import { loadCapacity, workspaceDay } from '../outbound/capacity.ts';
import { QUOTA_REASON_PREFIX } from '../sending/mailboxes.ts';
import { daysBefore } from './rollup.ts';

const DAY_MS = 86_400_000;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

export interface DailyResult {
  domains: number;
  advanced: number;
  warmups: number;
  resumed: number;
}

async function log(tx: Executor, workspaceId: string, type: string, data: Record<string, unknown>, now: Date): Promise<void> {
  await tx.insert(activities).values({ id: newId('activity'), workspace_id: workspaceId, type, actor_type: 'system', data, occurred_at: now });
}

async function planWorkspace(db: Db, workspace: { id: string; zone: string }, now: Date, result: DailyResult): Promise<void> {
  const { day: today, dayStart } = workspaceDay(now, workspace.zone);
  const yesterday = daysBefore(today, 1);
  const domainRows = await db.select().from(sending_domains).where(eq(sending_domains.workspace_id, workspace.id));
  const moved: string[] = [];

  for (const domain of domainRows) {
    const [done] = await db.select({ action: domain_daily_stats.ramp_action }).from(domain_daily_stats).where(and(eq(domain_daily_stats.domain_id, domain.id), eq(domain_daily_stats.day, today)));
    if (done?.action) continue;
    await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(sending_domains).where(eq(sending_domains.id, domain.id)).for('update');
      const history = await tx.select().from(domain_daily_stats).where(and(eq(domain_daily_stats.domain_id, domain.id), lt(domain_daily_stats.day, today))).orderBy(desc(domain_daily_stats.day)).limit(3);
      const last = history[0]?.day === yesterday ? history[0] : undefined;
      // A day counts toward the ramp only if it used at least half its cap (§8.3.1).
      const sendingDay = last ? isSendingDay(last.sent ?? 0, last.planned_cap) : false;
      if (sendingDay) await tx.update(domain_daily_stats).set({ counted_as_sending_day: true }).where(and(eq(domain_daily_stats.domain_id, domain.id), eq(domain_daily_stats.day, yesterday)));
      const lastSendingDay = sendingDay ? yesterday : locked!.last_sending_day;
      const idleDays = lastSendingDay ? daysBetween(lastSendingDay, today) - 1 : 0;
      const band = locked!.reputation_band as Band;
      let healthyDays = band === 'healthy' ? 1 : 0;
      for (const row of history) {
        if (healthyDays === 0 || row.reputation_band !== 'healthy') break;
        healthyDays += 1;
      }
      const own = await tx.select({ limit: mailboxes.daily_limit }).from(mailboxes).where(and(eq(mailboxes.sending_domain_id, domain.id), eq(mailboxes.status, 'active')));
      const ramp = { plan: locked!.ramp_plan as RampPlan, mailboxCapTotal: own.reduce((total, mailbox) => total + mailbox.limit, 0), ...(locked!.ramp_plan === 'custom' && { customSchedule: locked!.ramp_custom_schedule as RampScheduleEntry[] }) };
      const move = moveRamp({
        step: locked!.ramp_step,
        finalStep: rampFinalStep(ramp),
        status: locked!.ramp_status as RampStatus,
        band,
        previousBand: (last?.reputation_band as Band | undefined) ?? null,
        consecutiveHealthyDays: healthyDays,
        yesterdayWasSendingDay: sendingDay,
        idleDays,
        manualHold: locked!.ramp_manual_hold,
      });
      await tx.update(sending_domains).set({ ramp_step: move.step, ramp_status: move.status, ramp_status_reason: move.reason, last_sending_day: lastSendingDay }).where(eq(sending_domains.id, domain.id));
      // Every move is logged; a hold only when it starts or its reason changes.
      const newHold = move.action === 'held' && (locked!.ramp_status !== move.status || locked!.ramp_status_reason !== move.reason);
      if (move.action === 'advanced' || move.action === 'stepped_back' || newHold) {
        const type = move.action === 'advanced' ? 'domain.ramp_advanced' : move.action === 'stepped_back' ? 'domain.ramp_stepped_back' : 'domain.ramp_held';
        await log(tx, workspace.id, type, { domain_id: domain.id, domain: domain.domain, from_step: locked!.ramp_step, to_step: move.step, reason: move.reason }, now);
      }
      if (move.action === 'advanced') result.advanced += 1;
      // Today's row, marked with the move so the next run skips this domain; its cap is set below.
      await tx
        .insert(domain_daily_stats)
        .values({ domain_id: domain.id, day: today, planned_cap: 0, ramp_step: move.step, ramp_action: move.action, reputation_score: locked!.reputation_score, reputation_band: band })
        .onConflictDoUpdate({ target: [domain_daily_stats.domain_id, domain_daily_stats.day], set: { ramp_step: move.step, ramp_action: move.action } });

      // Warm-up moves with the mailbox's health band, one step per Healthy day (§8.3.2).
      const warming = await tx.select().from(mailboxes).where(and(eq(mailboxes.sending_domain_id, domain.id), eq(mailboxes.status, 'active'), eq(mailboxes.warmup_enabled, true))).for('update');
      for (const mailbox of warming) {
        if (mailbox.warmup_step >= warmupFinalStep(mailbox.daily_limit, mailbox.warmup_start_volume, mailbox.warmup_daily_increment)) continue;
        if (mailbox.health_band === 'healthy') {
          await tx.update(mailboxes).set({ warmup_step: mailbox.warmup_step + 1 }).where(eq(mailboxes.id, mailbox.id));
          result.warmups += 1;
        } else {
          await log(tx, workspace.id, 'mailbox.warmup_held', { mailbox_id: mailbox.id, email: mailbox.email, band: mailbox.health_band, step: mailbox.warmup_step }, now);
        }
      }
    });
    moved.push(domain.id);
    result.domains += 1;
  }

  // A provider quota pause lasts until the next local day (§7.2 step 6): one from before today's start opens.
  const reopened = await db
    .update(mailboxes)
    .set({ status: 'active', status_reason: null, updated_at: now })
    .where(and(eq(mailboxes.workspace_id, workspace.id), eq(mailboxes.status, 'paused'), like(mailboxes.status_reason, `${QUOTA_REASON_PREFIX}%`), lt(mailboxes.updated_at, dayStart)))
    .returning({ id: mailboxes.id, email: mailboxes.email });
  for (const mailbox of reopened) await log(db, workspace.id, 'mailbox.resumed', { mailbox_id: mailbox.id, email: mailbox.email, previous_reason: 'provider quota, paused until the next day' }, now);
  result.resumed += reopened.length;

  // Today's planned caps, now that the ramps have moved: what tomorrow's "sending day" check compares against.
  if (moved.length > 0) {
    const plan = (await loadCapacity(db, workspace.id, now)).plan;
    for (const domainId of moved) {
      const cap = plan.domains.find((entry) => entry.domainId === domainId)?.cap ?? 0;
      await db.update(domain_daily_stats).set({ planned_cap: cap }).where(and(eq(domain_daily_stats.domain_id, domainId), eq(domain_daily_stats.day, today)));
    }
  }
}

export async function dailyCapacityPlan(db: Db, now: Date): Promise<DailyResult> {
  const result: DailyResult = { domains: 0, advanced: 0, warmups: 0, resumed: 0 };
  for (const workspace of await db.select({ id: workspaces.id, zone: workspaces.default_timezone }).from(workspaces)) await planWorkspace(db, workspace, now, result);
  return result;
}
