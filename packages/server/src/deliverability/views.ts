// What sending capacity and deliverability look like now (spec §8.3.5, §15.15): today's plan by
// domain, mailbox and campaign with the limit holding each back, a 7-day projection assuming every
// band stays Healthy, campaign finish dates, and the Deliverability overview.

import {
  moveRamp,
  planCapacity,
  rampCap,
  rampFinalStep,
  warmupFinalStep,
  type CapacityPlan,
  type RampPlan,
  type RampScheduleEntry,
  type RampStatus,
} from '@catalyst/core';
import { activities, campaigns, capacity_plans, mailbox_daily_stats, mailboxes, sending_domains, threads, type Db } from '@catalyst/db';
import { and, desc, eq, gte, inArray, like, lt, or, sql } from 'drizzle-orm';

import { serializeActivity } from '../contacts/timeline.ts';
import { loadCapacityInputs, workspaceDay } from '../outbound/capacity.ts';
import { mailboxTodayCap } from '../sending/mailboxes.ts';

const DAY_MS = 86_400_000;
const FORECAST_DAYS = 7;
/** Beyond the projection, a campaign's last projected pace is assumed to hold, for at most a year. */
const FINISH_HORIZON_DAYS = 365;

type Loaded = Awaited<ReturnType<typeof loadCapacityInputs>>;
const addDays = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/**
 * The plan for each of the next 7 days if every band stays Healthy (§8.3.5): each ramp moves as
 * `moveRamp` would after a sending day, warm-ups gain a step a day, and follow-ups already due on
 * a day are counted on it.
 */
async function projectPlans(db: Db, workspaceId: string, loaded: Loaded): Promise<{ day: string; plan: CapacityPlan }[]> {
  const followUps = await db
    .select({ mailboxId: threads.mailbox_id, day: sql<string>`to_char(${threads.next_action_at} at time zone ${loaded.zone}, 'YYYY-MM-DD')`, n: sql<number>`count(*)::int` })
    .from(threads)
    .where(and(eq(threads.workspace_id, workspaceId), eq(threads.state, 'active'), eq(threads.next_action_type, 'send_follow_up'), gte(threads.next_action_at, loaded.dayEnd), lt(threads.next_action_at, new Date(loaded.dayEnd.getTime() + FORECAST_DAYS * DAY_MS))))
    .groupBy(threads.mailbox_id, sql`2`);
  const due = new Map(followUps.map((row) => [`${row.mailboxId}:${row.day}`, row.n]));

  const ramps = new Map(loaded.domainRows.map((domain) => [domain.id, { step: domain.ramp_step, status: domain.ramp_status as RampStatus }]));
  const result: { day: string; plan: CapacityPlan }[] = [];
  for (let offset = 1; offset <= FORECAST_DAYS; offset += 1) {
    const day = addDays(loaded.day, offset);
    const domains = loaded.domainRows.map((domain) => {
      const state = ramps.get(domain.id)!;
      const ramp = { plan: domain.ramp_plan as RampPlan, mailboxCapTotal: loaded.capTotals.get(domain.id) ?? 0, ...(domain.ramp_plan === 'custom' && { customSchedule: domain.ramp_custom_schedule as RampScheduleEntry[] }) };
      const move = moveRamp({
        step: state.step,
        finalStep: rampFinalStep(ramp),
        status: state.status,
        band: 'healthy',
        // Assumed Healthy from tomorrow on, so the band before it never matters (it only does for Critical).
        previousBand: 'healthy',
        consecutiveHealthyDays: offset + (domain.reputation_band === 'healthy' ? 1 : 0),
        yesterdayWasSendingDay: true,
        manualHold: domain.ramp_manual_hold,
      });
      ramps.set(domain.id, { step: move.step, status: move.status });
      const override = domain.cap_override !== null && domain.cap_override_until !== null && domain.cap_override_until >= day ? domain.cap_override : null;
      // A paused domain stays paused until a person resumes it, so the forecast keeps it so.
      return { id: domain.id, rampCap: rampCap({ ...ramp, step: move.step }), capOverride: override, band: 'healthy' as const, firstTouchesPaused: domain.first_touches_paused_at !== null };
    });
    const mailboxRows = loaded.inputs.mailboxes.map((mailbox) => ({
      ...mailbox,
      band: 'healthy' as const,
      warmupStep: mailbox.warmupEnabled ? Math.min(mailbox.warmupStep + offset, warmupFinalStep(mailbox.dailyLimit, mailbox.warmupStartVolume, mailbox.warmupDailyIncrement)) : mailbox.warmupStep,
      followUpsDueToday: due.get(`${mailbox.id}:${day}`) ?? 0,
    }));
    result.push({ day, plan: planCapacity({ domains, mailboxes: mailboxRows, campaigns: loaded.inputs.campaigns }) });
  }
  return result;
}

/** The day a campaign's waiting threads will all have had their first email, at the projected pace. */
function finishDay(waiting: number, todayLeft: number, today: string, forecast: { day: string; alloc: number }[]): string | null {
  if (waiting <= 0) return today;
  let remaining = waiting - todayLeft;
  if (remaining <= 0) return today;
  for (const entry of forecast) {
    remaining -= entry.alloc;
    if (remaining <= 0) return entry.day;
  }
  const pace = forecast.at(-1)?.alloc ?? 0;
  if (pace <= 0) return null;
  const extra = Math.ceil(remaining / pace);
  return extra > FINISH_HORIZON_DAYS ? null : addDays(forecast.at(-1)!.day, extra);
}

const sumMap = (map: Map<string, number>, predicate: (key: string) => boolean) => [...map].reduce((total, [key, value]) => (predicate(key) ? total + value : total), 0);

export async function getSendingCapacity(db: Db, workspaceId: string, query: { domain_id?: string | undefined; mailbox_id?: string | undefined; campaign_id?: string | undefined }, now: Date) {
  const loaded = await loadCapacityInputs(db, workspaceId, now);
  const plan = planCapacity(loaded.inputs);
  const forecast = await projectPlans(db, workspaceId, loaded);
  const { used } = loaded;

  const campaignIds = plan.campaigns.map((entry) => entry.campaignId);
  const campaignRows = campaignIds.length ? await db.select().from(campaigns).where(inArray(campaigns.id, campaignIds)) : [];
  const waitingRows = campaignIds.length
    ? await db
        .select({ campaignId: threads.campaign_id, n: sql<number>`count(*)::int` })
        .from(threads)
        .where(and(inArray(threads.campaign_id, campaignIds), eq(threads.state, 'active'), eq(threads.next_action_type, 'send_initial')))
        .groupBy(threads.campaign_id)
    : [];
  const waiting = new Map(waitingRows.map((row) => [row.campaignId, row.n]));
  const mailboxById = new Map(loaded.mailboxRows.map((mailbox) => [mailbox.id, mailbox]));
  const domainById = new Map(loaded.domainRows.map((domain) => [domain.id, domain]));
  const inScope = (mailboxId: string) => {
    const mailbox = mailboxById.get(mailboxId);
    return (!query.mailbox_id || mailboxId === query.mailbox_id) && (!query.domain_id || mailbox?.sending_domain_id === query.domain_id);
  };

  const mailboxPlans = plan.mailboxes.filter((entry) => inScope(entry.mailboxId));
  const campaignPlans = plan.campaigns.filter((entry) => !query.campaign_id || entry.campaignId === query.campaign_id).filter((entry) => !query.mailbox_id && !query.domain_id ? true : plan.mailboxes.some((mailbox) => inScope(mailbox.mailboxId) && mailbox.campaigns.some((share) => share.campaignId === entry.campaignId)));
  return {
    day: loaded.day,
    domains: plan.domains
      .filter((entry) => !query.domain_id || entry.domainId === query.domain_id)
      .filter((entry) => !query.mailbox_id || mailboxById.get(query.mailbox_id)?.sending_domain_id === entry.domainId)
      .map((entry) => ({
        domain_id: entry.domainId,
        domain: domainById.get(entry.domainId)!.domain,
        cap: entry.cap,
        alloc: entry.alloc,
        used: plan.mailboxes.filter((mailbox) => mailbox.domainId === entry.domainId).reduce((total, mailbox) => total + usedOn(mailbox.mailboxId), 0),
      })),
    mailboxes: mailboxPlans.map((entry) => ({
      mailbox_id: entry.mailboxId,
      email: mailboxById.get(entry.mailboxId)!.email,
      domain_id: entry.domainId,
      cap: entry.cap,
      alloc: entry.alloc,
      reply_reserve: entry.replyReserve,
      reply_limit: entry.replyLimit,
      follow_ups: entry.followUps,
      first_touch_pool: entry.firstTouchPool,
      limited_by: entry.limitedBy,
      used: { initial: sumMap(used.initial, (key) => key.endsWith(`:${entry.mailboxId}`)), follow_ups: used.followUps.get(entry.mailboxId) ?? 0, replies: used.replies.get(entry.mailboxId) ?? 0 },
      campaigns: entry.campaigns.map((share) => ({ campaign_id: share.campaignId, alloc: share.alloc })),
    })),
    campaigns: campaignPlans.map((entry) => {
      const campaign = campaignRows.find((row) => row.id === entry.campaignId)!;
      const usedToday = used.initialByCampaign.get(entry.campaignId) ?? 0;
      const projected = forecast.map(({ day, plan: future }) => ({ day, alloc: future.campaigns.find((share) => share.campaignId === entry.campaignId)?.alloc ?? 0 }));
      return {
        campaign_id: entry.campaignId,
        name: campaign.name,
        priority: campaign.sending_priority as 'high' | 'normal' | 'low',
        wants: campaign.daily_new_threads_limit,
        alloc: entry.alloc,
        used: usedToday,
        waiting: waiting.get(entry.campaignId) ?? 0,
        limited_by: entry.limitedBy,
        finishes_on: finishDay(waiting.get(entry.campaignId) ?? 0, Math.max(0, entry.alloc - usedToday), loaded.day, projected),
      };
    }),
    forecast: forecast.map(({ day, plan: future }) => ({
      day,
      domains: future.domains.filter((entry) => !query.domain_id || entry.domainId === query.domain_id).map((entry) => ({ domain_id: entry.domainId, cap: entry.cap })),
      campaigns: future.campaigns.filter((entry) => !query.campaign_id || entry.campaignId === query.campaign_id).map((entry) => ({ campaign_id: entry.campaignId, alloc: entry.alloc })),
    })),
  };

  function usedOn(mailboxId: string): number {
    return sumMap(used.initial, (key) => key.endsWith(`:${mailboxId}`)) + (used.followUps.get(mailboxId) ?? 0) + (used.replies.get(mailboxId) ?? 0);
  }
}

/** Activity types the Deliverability "Recent events" panel shows (§15.15). */
const EVENT_PREFIXES = ['domain.', 'deliverability.', 'mailbox.'];

export async function getDeliverabilityOverview(db: Db, workspaceId: string, now: Date) {
  const loaded = await loadCapacityInputs(db, workspaceId, now);
  const plan = planCapacity(loaded.inputs);
  const [tomorrow] = await projectPlans(db, workspaceId, loaded);
  const domainRows = await db.select().from(sending_domains).where(eq(sending_domains.workspace_id, workspaceId)).orderBy(sending_domains.domain);
  const mailboxRows = await db.select().from(mailboxes).where(eq(mailboxes.workspace_id, workspaceId)).orderBy(mailboxes.email);
  const { day } = workspaceDay(now, loaded.zone);
  const stats = mailboxRows.length ? await db.select().from(mailbox_daily_stats).where(and(inArray(mailbox_daily_stats.mailbox_id, mailboxRows.map((mailbox) => mailbox.id)), eq(mailbox_daily_stats.day, day))) : [];
  const statsFor = (mailboxId: string) => stats.find((row) => row.mailbox_id === mailboxId);
  const events = await db
    .select()
    .from(activities)
    .where(and(eq(activities.workspace_id, workspaceId), or(...EVENT_PREFIXES.map((prefix) => like(activities.type, `${prefix}%`)))))
    .orderBy(desc(activities.occurred_at))
    .limit(20);

  // What holds sending back most: the limit of the most-allocated campaign, else of the busiest mailbox.
  const mainLimit = [...plan.campaigns].sort((a, b) => b.alloc - a.alloc)[0]?.limitedBy ?? [...plan.mailboxes].sort((a, b) => b.alloc - a.alloc)[0]?.limitedBy ?? null;
  const status = (value: string | null): 'pass' | 'warn' | 'fail' | null => (value === 'pass' || value === 'warn' || value === 'fail' ? value : null);
  return {
    domains: domainRows.map((domain) => {
      const ramp = { plan: domain.ramp_plan as RampPlan, mailboxCapTotal: loaded.capTotals.get(domain.id) ?? 0, ...(domain.ramp_plan === 'custom' && { customSchedule: domain.ramp_custom_schedule as RampScheduleEntry[] }) };
      return {
        domain_id: domain.id,
        domain: domain.domain,
        reputation_score: domain.reputation_score,
        reputation_band: domain.reputation_band as 'healthy' | 'at_risk' | 'critical' | 'paused',
        blocklisted: domain.blocklisted,
        alignment_status: domain.alignment_status as 'aligned' | 'not_aligned' | 'unknown' | null,
        dns: { spf: status(domain.spf_status), dkim: status(domain.dkim_status), dmarc: status(domain.dmarc_status), dmarc_policy: domain.dmarc_policy, mx: status(domain.mx_status), tracking: status(domain.tracking_status), checked_at: domain.last_checked_at?.toISOString() ?? null },
        ramp: {
          plan: domain.ramp_plan as RampPlan,
          step: domain.ramp_step,
          final_step: rampFinalStep(ramp),
          status: domain.ramp_status as RampStatus,
          today_cap: plan.domains.find((entry) => entry.domainId === domain.id)?.cap ?? 0,
          tomorrow_cap: tomorrow?.plan.domains.find((entry) => entry.domainId === domain.id)?.cap ?? 0,
        },
      };
    }),
    mailboxes: mailboxRows.map((mailbox) => {
      const final = mailbox.warmup_enabled ? warmupFinalStep(mailbox.daily_limit, mailbox.warmup_start_volume, mailbox.warmup_daily_increment) : 0;
      return {
        mailbox_id: mailbox.id,
        email: mailbox.email,
        domain_id: mailbox.sending_domain_id,
        status: mailbox.status,
        status_reason: mailbox.status_reason,
        health_score: mailbox.health_score,
        health_band: mailbox.health_band as 'healthy' | 'at_risk' | 'critical' | 'paused',
        sent_today: statsFor(mailbox.id)?.sent ?? 0,
        today_cap: mailbox.status === 'active' ? mailboxTodayCap(mailbox) : 0,
        warmup: { enabled: mailbox.warmup_enabled, step: mailbox.warmup_step, final_step: final, complete: !mailbox.warmup_enabled || mailbox.warmup_step >= final },
        last_poll_at: mailbox.last_poll_at?.toISOString() ?? null,
        last_poll_status: mailbox.last_poll_status as 'ok' | 'partial' | 'error' | null,
      };
    }),
    today: {
      day,
      planned: plan.domains.reduce((total, entry) => total + entry.cap, 0),
      sent: stats.reduce((total, row) => total + (row.sent ?? 0), 0),
      replies: stats.reduce((total, row) => total + (row.inbound_replies ?? 0), 0),
      main_limit: mainLimit,
    },
    events: events.map(serializeActivity),
  };
}

/**
 * `capacity_plans` (§6.5, §8.3.3): today's allocation per mailbox and bucket (each campaign's first
 * touches, follow-ups, the reply reserve) with what has been used, plus the 7-day forecast. The
 * scheduler plans live; these rows are the record of what the plan was, refreshed hourly.
 */
export async function storeCapacityPlans(db: Db, workspaceId: string, now: Date): Promise<number> {
  const loaded = await loadCapacityInputs(db, workspaceId, now);
  const plan = planCapacity(loaded.inputs);
  const forecast = await projectPlans(db, workspaceId, loaded);
  const { used } = loaded;
  const rowsFor = (day: string, current: CapacityPlan, kind: 'allocation' | 'forecast') =>
    current.mailboxes.flatMap((mailbox) => {
      const usedOf = (count: number | undefined) => (kind === 'allocation' ? (count ?? 0) : 0);
      return [
        ...mailbox.campaigns.map((share) => ({
          day,
          mailbox_id: mailbox.mailboxId,
          bucket: share.campaignId,
          kind,
          allocated: share.alloc,
          used: usedOf(used.initial.get(`${share.campaignId}:${mailbox.mailboxId}`)),
          limited_by: current.campaigns.find((entry) => entry.campaignId === share.campaignId)?.limitedBy ?? mailbox.limitedBy,
        })),
        { day, mailbox_id: mailbox.mailboxId, bucket: 'follow_ups', kind, allocated: mailbox.followUps, used: usedOf(used.followUps.get(mailbox.mailboxId)), limited_by: mailbox.limitedBy },
        { day, mailbox_id: mailbox.mailboxId, bucket: 'reply_reserve', kind, allocated: mailbox.replyReserve, used: usedOf(used.replies.get(mailbox.mailboxId)), limited_by: null },
      ];
    });
  const rows = [...rowsFor(loaded.day, plan, 'allocation'), ...forecast.flatMap(({ day, plan: future }) => rowsFor(day, future, 'forecast'))];
  if (rows.length === 0) return 0;
  await db
    .insert(capacity_plans)
    .values(rows.map((row) => ({ ...row, computed_at: now })))
    .onConflictDoUpdate({
      target: [capacity_plans.day, capacity_plans.mailbox_id, capacity_plans.bucket, capacity_plans.kind],
      set: { allocated: sql`excluded.allocated`, used: sql`excluded.used`, limited_by: sql`excluded.limited_by`, computed_at: sql`excluded.computed_at` },
    });
  return rows.length;
}
