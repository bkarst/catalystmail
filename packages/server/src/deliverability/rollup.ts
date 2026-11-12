// `mailbox.stats_rollup` (spec §4.4, §8.9, §8.10), hourly: today's domain stats from the mailbox
// stats, then every mailbox's health and every domain's reputation, with the no-flapping band
// rule, and the circuit breakers that pause a mailbox, a domain's mailboxes or a campaign.

import {
  campaignBreaker,
  domainBreakers,
  domainReputation,
  mailboxBreakers,
  mailboxHealth,
  nextBand,
  type Band,
  type BreakerTrip,
  type RateWindows,
} from '@catalyst/core';
import { activities, campaigns, domain_daily_stats, mailbox_daily_stats, mailboxes, messages, newId, poll_runs, sending_domains, workspaces, type Db, type Executor } from '@catalyst/db';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';

import { loadCapacity, workspaceDay } from '../outbound/capacity.ts';
import { gmailNonCompliant } from './postmaster.ts';
import { storeCapacityPlans } from './views.ts';
import { BREAKER_PREFIX } from '../sending/mailboxes.ts';

const DAY_MS = 86_400_000;
type MailboxRow = typeof mailboxes.$inferSelect;

export interface RollupResult {
  domains: number;
  mailboxes: number;
  bandChanges: number;
  trips: number;
  warnings: number;
}

/** `YYYY-MM-DD` this many days before `day`. */
export const daysBefore = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10);

interface Totals {
  sends: number;
  hardBounces: number;
  complaints: number;
  opens: number;
}
const zero = (): Totals => ({ sends: 0, hardBounces: 0, complaints: 0, opens: 0 });

/** Sends, hard bounces, complaints and human opens per mailbox, over the last 7 and 30 days. */
async function windows(db: Executor, mailboxIds: string[], today: string): Promise<Map<string, { last7: Totals; last30: Totals }>> {
  const result = new Map<string, { last7: Totals; last30: Totals }>(mailboxIds.map((id) => [id, { last7: zero(), last30: zero() }]));
  if (mailboxIds.length === 0) return result;
  const rows = await db
    .select()
    .from(mailbox_daily_stats)
    .where(and(inArray(mailbox_daily_stats.mailbox_id, mailboxIds), gte(mailbox_daily_stats.day, daysBefore(today, 29))));
  const weekStart = daysBefore(today, 6);
  for (const row of rows) {
    const entry = result.get(row.mailbox_id)!;
    for (const [window, include] of [[entry.last30, true], [entry.last7, row.day >= weekStart]] as const) {
      if (!include) continue;
      window.sends += row.sent ?? 0;
      window.hardBounces += row.bounced_hard ?? 0;
      window.complaints += row.complaints ?? 0;
      window.opens += row.opens_human ?? 0;
    }
  }
  return result;
}

const sum = (parts: Totals[]): Totals => parts.reduce((total, part) => ({ sends: total.sends + part.sends, hardBounces: total.hardBounces + part.hardBounces, complaints: total.complaints + part.complaints, opens: total.opens + part.opens }), zero());
const rateWindows = (last7: Totals, last30: Totals): RateWindows => ({ last7Days: last7, last30Days: last30 });

/** The stored band and when the score started sitting in a better range (kept with the inputs). */
const bandState = (band: string, inputs: unknown) => ({ band: band as Band, improvingSince: (inputs as { improving_since?: string | null }).improving_since ? new Date((inputs as { improving_since: string }).improving_since) : null });

const WHY: Record<string, string> = {
  hard_bounce_rate: 'hard-bounce rate',
  complaint_rate: 'complaint rate',
  blocklist: 'domain on a blocklist',
  campaign_early_bounces: 'hard bounces in the first 50 sends',
};

export async function logTrip(tx: Executor, workspaceId: string, trip: BreakerTrip, data: Record<string, unknown>, now: Date, campaignId: string | null = null): Promise<void> {
  await tx.insert(activities).values({
    id: newId('activity'),
    workspace_id: workspaceId,
    campaign_id: campaignId,
    type: trip.scope === 'campaign' ? 'campaign.breaker_tripped' : 'deliverability.breaker_tripped',
    actor_type: 'system',
    data: { signal: trip.signal, level: trip.level, scope: trip.scope, ...data },
    occurred_at: now,
  });
}

/**
 * A warn-level trip (§8.9's Warn column) is logged once per signal and target in a rolling 7 days,
 * the breakers' own window, so an hourly rollup doesn't repeat it. It goes into the daily digest.
 */
async function warnOnce(tx: Executor, workspaceId: string, trip: BreakerTrip, target: { key: 'mailbox_id' | 'domain_id' | 'campaign_id'; id: string }, data: Record<string, unknown>, now: Date, result: RollupResult): Promise<void> {
  const type = trip.scope === 'campaign' ? 'campaign.breaker_tripped' : 'deliverability.breaker_tripped';
  const [recent] = await tx
    .select({ id: activities.id })
    .from(activities)
    .where(
      and(
        eq(activities.workspace_id, workspaceId),
        eq(activities.type, type),
        gte(activities.occurred_at, new Date(now.getTime() - 7 * DAY_MS)),
        sql`${activities.data}->>'signal' = ${trip.signal}`,
        sql`${activities.data}->>'level' = 'warn'`,
        sql`${activities.data}->>${target.key} = ${target.id}`,
      ),
    )
    .limit(1);
  if (recent) return;
  result.warnings += 1;
  await logTrip(tx, workspaceId, trip, { [target.key]: target.id, ...data }, now, trip.scope === 'campaign' ? target.id : null);
}

/** Pauses an active mailbox for a breaker; the reason starts `breaker:` so resuming needs an acknowledgement (§8.9). */
export async function pauseForBreaker(tx: Executor, mailbox: MailboxRow, why: string, now: Date): Promise<boolean> {
  const [paused] = await tx
    .update(mailboxes)
    .set({ status: 'paused', status_reason: `${BREAKER_PREFIX} ${why}`, updated_at: now })
    .where(and(eq(mailboxes.id, mailbox.id), eq(mailboxes.status, 'active')))
    .returning({ id: mailboxes.id });
  return Boolean(paused);
}

async function rollupWorkspace(db: Db, workspace: { id: string; zone: string }, now: Date, result: RollupResult): Promise<void> {
  const { day: today } = workspaceDay(now, workspace.zone);
  const domainRows = await db.select().from(sending_domains).where(eq(sending_domains.workspace_id, workspace.id));
  const mailboxRows = await db.select().from(mailboxes).where(eq(mailboxes.workspace_id, workspace.id));
  const stats = await windows(db, mailboxRows.map((mailbox) => mailbox.id), today);
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
  const dayAgo = new Date(now.getTime() - DAY_MS);

  // Mailbox health (§8.10) and the per-mailbox breakers (§8.9).
  for (const mailbox of mailboxRows) {
    const { last7, last30 } = stats.get(mailbox.id)!;
    const [quota] = await db
      .select({ id: activities.id })
      .from(activities)
      .where(and(eq(activities.workspace_id, workspace.id), eq(activities.type, 'deliverability.breaker_tripped'), gte(activities.occurred_at, weekAgo), sql`${activities.data}->>'signal' = 'provider_quota'`, sql`${activities.data}->>'mailbox_id' = ${mailbox.id}`))
      .limit(1);
    const [pollError] = await db.select({ id: poll_runs.id }).from(poll_runs).where(and(eq(poll_runs.mailbox_id, mailbox.id), eq(poll_runs.status, 'error'), gte(poll_runs.started_at, dayAgo))).limit(1);
    const [sendError] = await db.select({ id: messages.id }).from(messages).where(and(eq(messages.mailbox_id, mailbox.id), inArray(messages.status, ['failed', 'send_unknown']), gte(messages.updated_at, dayAgo))).limit(1);
    const health = mailboxHealth({ ...rateWindows(last7, last30), providerQuotaError: Boolean(quota), recentErrors: Boolean(pollError || sendError) });
    const band = nextBand(bandState(mailbox.health_band, mailbox.health_inputs), health.score, now);
    await db.transaction(async (tx) => {
      await tx
        .update(mailboxes)
        .set({
          health_score: health.score,
          health_band: band.band,
          health_inputs: { points: health.points, hard_bounce_rate: health.hardBounceRate, complaint_rate: health.complaintRate, sends_7d: last7.sends, improving_since: band.improvingSince?.toISOString() ?? null, computed_at: now.toISOString() },
        })
        .where(eq(mailboxes.id, mailbox.id));
      if (band.changed) {
        result.bandChanges += 1;
        await tx.insert(activities).values({ id: newId('activity'), workspace_id: workspace.id, type: 'mailbox.health_changed', actor_type: 'system', data: { mailbox_id: mailbox.id, email: mailbox.email, from: mailbox.health_band, to: band.band, score: health.score }, occurred_at: now });
      }
      for (const trip of mailboxBreakers({ sends: last7.sends, hardBounces: last7.hardBounces, complaints: last7.complaints, providerQuotaError: false })) {
        const rate = trip.signal === 'hard_bounce_rate' ? last7.hardBounces / last7.sends : last7.complaints / last7.sends;
        if (trip.level === 'warn') {
          await warnOnce(tx, workspace.id, trip, { key: 'mailbox_id', id: mailbox.id }, { email: mailbox.email, rate }, now, result);
          continue;
        }
        if (await pauseForBreaker(tx, mailbox, `${WHY[trip.signal]} ${(rate * 100).toFixed(1)}% over 7 days`, now)) {
          result.trips += 1;
          await logTrip(tx, workspace.id, trip, { mailbox_id: mailbox.id, rate }, now);
        }
      }
    });
    result.mailboxes += 1;
  }

  // Domain reputation over all its mailboxes (§8.10), the domain breakers, and today's stats row.
  const plan = (await loadCapacity(db, workspace.id, now)).plan;
  for (const domain of domainRows) {
    const own = mailboxRows.filter((mailbox) => mailbox.sending_domain_id === domain.id);
    const last7 = sum(own.map((mailbox) => stats.get(mailbox.id)!.last7));
    const last30 = sum(own.map((mailbox) => stats.get(mailbox.id)!.last30));
    const [junk] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(activities)
      .where(and(eq(activities.workspace_id, workspace.id), eq(activities.type, 'deliverability.junk_reply'), gte(activities.occurred_at, weekAgo), sql`${activities.data}->>'domain' = ${domain.domain.toLowerCase()}`));
    const authenticationFailing = [domain.spf_status, domain.dkim_status, domain.dmarc_status].includes('fail') || gmailNonCompliant(domain.postmaster_data);
    const gmailSpamRate = (domain.postmaster_data as { spam_rate?: number } | null)?.spam_rate ?? null;
    const humanOpenRate = last7.sends > 0 && last30.sends > 0 ? { recent: last7.opens / last7.sends, baseline: last30.opens / last30.sends, sends: last7.sends } : null;
    const reputation = domainReputation({ ...rateWindows(last7, last30), gmailSpamRate, blocklisted: domain.blocklisted, authenticationFailing, junkReplies: junk?.n ?? 0, humanOpenRate });
    const band = nextBand(bandState(domain.reputation_band, domain.reputation_inputs), reputation.score, now);
    await db.transaction(async (tx) => {
      await tx
        .update(sending_domains)
        .set({
          reputation_score: reputation.score,
          reputation_band: band.band,
          reputation_inputs: { points: reputation.points, hard_bounce_rate: reputation.hardBounceRate, complaint_rate: reputation.complaintRate, sends_7d: last7.sends, junk_replies_7d: junk?.n ?? 0, improving_since: band.improvingSince?.toISOString() ?? null, computed_at: now.toISOString() },
          ...(band.changed && { band_changed_at: now }),
        })
        .where(eq(sending_domains.id, domain.id));
      if (band.changed) {
        result.bandChanges += 1;
        await tx.insert(activities).values({ id: newId('activity'), workspace_id: workspace.id, type: 'domain.reputation_changed', actor_type: 'system', data: { domain_id: domain.id, domain: domain.domain, from: domain.reputation_band, to: band.band, score: reputation.score }, occurred_at: now });
      }
      // A blocklisting pauses every mailbox on the domain at once (§8.9).
      // Opens over the last 7 days against the 23 days before them.
      const before = { sends: last30.sends - last7.sends, opens: last30.opens - last7.opens };
      const openTrend = last7.sends > 0 && before.sends > 0 ? { recent: last7.opens / last7.sends, previous: before.opens / before.sends, sends: last7.sends } : null;
      for (const trip of domainBreakers({ blocklisted: domain.blocklisted, authenticationFailing, junkReplies: junk?.n ?? 0, humanOpenRate: openTrend })) {
        if (trip.level === 'warn') {
          await warnOnce(tx, workspace.id, trip, { key: 'domain_id', id: domain.id }, { domain: domain.domain, ...(trip.signal === 'junk_replies' ? { junk_replies: junk?.n ?? 0 } : { recent: openTrend?.recent, previous: openTrend?.previous }) }, now, result);
          continue;
        }
        if (trip.signal !== 'blocklist') continue;
        let paused = 0;
        for (const mailbox of own) if (await pauseForBreaker(tx, mailbox, `${domain.domain} is on a blocklist`, now)) paused += 1;
        if (paused > 0) {
          result.trips += 1;
          await logTrip(tx, workspace.id, trip, { domain_id: domain.id, mailboxes_paused: paused }, now);
        }
      }
      const today_ = await todayTotals(tx, own.map((mailbox) => mailbox.id), today);
      const cap = plan.domains.find((entry) => entry.domainId === domain.id)?.cap ?? 0;
      await tx
        .insert(domain_daily_stats)
        .values({ domain_id: domain.id, day: today, planned_cap: cap, ...today_, junk_replies: junk?.n ?? 0, reputation_score: reputation.score, reputation_band: band.band, ramp_step: domain.ramp_step })
        .onConflictDoUpdate({ target: [domain_daily_stats.domain_id, domain_daily_stats.day], set: { ...today_, reputation_score: reputation.score, reputation_band: band.band } });
    });
    result.domains += 1;
  }

  // A campaign's first 50 sends with 5 hard bounces: "check your list" (§8.9).
  const active = await db.select({ id: campaigns.id, name: campaigns.name }).from(campaigns).where(and(eq(campaigns.workspace_id, workspace.id), eq(campaigns.status, 'active')));
  for (const campaign of active) {
    const [early] = await db.execute<{ bounced: number }>(sql`
      select count(*) filter (where status = 'bounced')::int as bounced from (
        select m.status from messages m join threads t on t.id = m.thread_id
        where t.campaign_id = ${campaign.id} and m.direction = 'outbound' and m.sent_at is not null
        order by m.sent_at limit 50) first_sends`).then((rows) => rows.rows);
    const trip = campaignBreaker(early?.bounced ?? 0);
    if (trip?.level === 'warn') {
      await db.transaction((tx) => warnOnce(tx, workspace.id, trip, { key: 'campaign_id', id: campaign.id }, { name: campaign.name, hard_bounces: early!.bounced }, now, result));
      continue;
    }
    if (trip?.level !== 'pause') continue;
    await db.transaction(async (tx) => {
      const [paused] = await tx.update(campaigns).set({ status: 'paused', updated_at: now }).where(and(eq(campaigns.id, campaign.id), eq(campaigns.status, 'active'))).returning({ id: campaigns.id });
      if (!paused) return;
      result.trips += 1;
      await logTrip(tx, workspace.id, trip, { campaign_id: campaign.id, hard_bounces: early!.bounced, reason: 'Check your list: 5 or more of the first 50 emails bounced.' }, now, campaign.id);
    });
  }
  // The plan as it stands after this hour's scores and trips, kept as a record.
  await storeCapacityPlans(db, workspace.id, now);
}

async function todayTotals(tx: Executor, mailboxIds: string[], day: string) {
  if (mailboxIds.length === 0) return { sent: 0, replies_sent: 0, bounced_hard: 0, complaints: 0, opens_human: 0 };
  const [row] = await tx
    .select({
      sent: sql<number>`coalesce(sum(${mailbox_daily_stats.sent}), 0)::int`,
      replies_sent: sql<number>`coalesce(sum(${mailbox_daily_stats.replies_sent}), 0)::int`,
      bounced_hard: sql<number>`coalesce(sum(${mailbox_daily_stats.bounced_hard}), 0)::int`,
      complaints: sql<number>`coalesce(sum(${mailbox_daily_stats.complaints}), 0)::int`,
      opens_human: sql<number>`coalesce(sum(${mailbox_daily_stats.opens_human}), 0)::int`,
    })
    .from(mailbox_daily_stats)
    .where(and(inArray(mailbox_daily_stats.mailbox_id, mailboxIds), eq(mailbox_daily_stats.day, day)));
  return row!;
}

export async function statsRollup(db: Db, now: Date): Promise<RollupResult> {
  const result: RollupResult = { domains: 0, mailboxes: 0, bandChanges: 0, trips: 0, warnings: 0 };
  for (const workspace of await db.select({ id: workspaces.id, zone: workspaces.default_timezone }).from(workspaces)) await rollupWorkspace(db, workspace, now, result);
  return result;
}


/** A breaker trip recomputes the workspace's scores and plan right away, not at the next hour (§8.9). */
export async function rollupWorkspaceNow(db: Db, workspaceId: string, now: Date): Promise<RollupResult> {
  const result: RollupResult = { domains: 0, mailboxes: 0, bandChanges: 0, trips: 0, warnings: 0 };
  const [workspace] = await db.select({ id: workspaces.id, zone: workspaces.default_timezone }).from(workspaces).where(eq(workspaces.id, workspaceId));
  if (workspace) await rollupWorkspace(db, workspace, now, result);
  return result;
}
