// Today's sending capacity (spec §8.3): the core plan, fed from the current domains, mailboxes and
// campaigns, and what has already been composed or sent today. The scheduler asks it for room
// before composing each email.

import { intlZoneCalendar, planCapacity, rampCap, type Band, type CapacityPlan, type RampPlan, type RampScheduleEntry, type SendingPriority } from '@catalyst/core';
import { campaign_mailboxes, campaign_steps, campaigns, mailboxes, messages, sending_domains, threads, workspaces, type Executor } from '@catalyst/db';
import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm';

export type SendKind = 'initial' | 'follow_up' | 'reply';

export interface CapacityState {
  /** `YYYY-MM-DD` in the workspace timezone. */
  day: string;
  dayStart: Date;
  dayEnd: Date;
  plan: CapacityPlan;
  used: {
    initial: Map<string, number>; // `${campaignId}:${mailboxId}`
    initialByCampaign: Map<string, number>;
    followUps: Map<string, number>; // mailboxId
    replies: Map<string, number>; // mailboxId
  };
}

const bump = (map: Map<string, number>, key: string, by = 1) => map.set(key, (map.get(key) ?? 0) + by);

/** Start and end of the workspace's local day containing `now`. */
export function workspaceDay(now: Date, zone: string): { day: string; dayStart: Date; dayEnd: Date } {
  const local = intlZoneCalendar.toLocal(now, zone);
  const dayStart = intlZoneCalendar.fromLocal({ year: local.year, month: local.month, day: local.day, hour: 0, minute: 0, second: 0 }, zone);
  const next = new Date(Date.UTC(local.year, local.month - 1, local.day + 1));
  const dayEnd = intlZoneCalendar.fromLocal({ year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate(), hour: 0, minute: 0, second: 0 }, zone);
  const day = `${local.year}-${String(local.month).padStart(2, '0')}-${String(local.day).padStart(2, '0')}`;
  return { day, dayStart, dayEnd };
}

/** What kind of email a message is, from the step it was sent for. */
const KIND = sql<SendKind>`case when ${messages.step_id} is null then 'reply' when ${campaign_steps.sequence_id} is null then 'initial' else 'follow_up' end`;
/** Outbound email that takes up today's capacity: composed for today, or already on its way. */
const COUNTED_STATUSES = ['pending_approval', 'scheduled', 'sending', 'sent', 'send_unknown', 'bounced'] as const;

/** Everything today's plan is computed from, kept so it can also be projected forward (§8.3.5). */
export async function loadCapacityInputs(db: Executor, workspaceId: string, now: Date) {
  const [workspace] = await db.select({ zone: workspaces.default_timezone }).from(workspaces).where(eq(workspaces.id, workspaceId));
  const { day, dayStart, dayEnd } = workspaceDay(now, workspace?.zone ?? 'UTC');

  const usage = await db
    .select({ kind: KIND, mailbox_id: messages.mailbox_id, campaign_id: threads.campaign_id, count: sql<number>`count(*)::int` })
    .from(messages)
    .innerJoin(threads, eq(threads.id, messages.thread_id))
    .leftJoin(campaign_steps, eq(campaign_steps.id, messages.step_id))
    .where(
      and(
        eq(messages.workspace_id, workspaceId),
        eq(messages.direction, 'outbound'),
        inArray(messages.status, [...COUNTED_STATUSES]),
        sql`coalesce(${messages.sent_at}, ${messages.scheduled_for}, ${messages.created_at}) >= ${dayStart}`,
        sql`coalesce(${messages.sent_at}, ${messages.scheduled_for}, ${messages.created_at}) < ${dayEnd}`,
      ),
    )
    .groupBy(KIND, messages.mailbox_id, threads.campaign_id);
  const used: CapacityState['used'] = { initial: new Map(), initialByCampaign: new Map(), followUps: new Map(), replies: new Map() };
  for (const row of usage) {
    if (row.kind === 'initial') {
      bump(used.initial, `${row.campaign_id}:${row.mailbox_id}`, row.count);
      bump(used.initialByCampaign, row.campaign_id, row.count);
    } else bump(row.kind === 'follow_up' ? used.followUps : used.replies, row.mailbox_id, row.count);
  }

  const domainRows = await db.select().from(sending_domains).where(eq(sending_domains.workspace_id, workspaceId));
  const mailboxRows = await db.select().from(mailboxes).where(and(eq(mailboxes.workspace_id, workspaceId), eq(mailboxes.status, 'active')));
  const followUpsWaiting = await db
    .select({ mailbox_id: threads.mailbox_id, count: sql<number>`count(*)::int` })
    .from(threads)
    .where(and(eq(threads.workspace_id, workspaceId), eq(threads.state, 'active'), eq(threads.next_action_type, 'send_follow_up'), isNull(threads.next_action_message_id), lt(threads.next_action_at, dayEnd)))
    .groupBy(threads.mailbox_id);
  const waitingByMailbox = new Map(followUpsWaiting.map((row) => [row.mailbox_id, row.count]));

  const capTotals = new Map<string, number>();
  for (const mailbox of mailboxRows) bump(capTotals, mailbox.sending_domain_id, mailbox.daily_limit);

  const campaignRows = await db
    .select({ id: campaigns.id, priority: campaigns.sending_priority, limit: campaigns.daily_new_threads_limit })
    .from(campaigns)
    .where(
      and(
        eq(campaigns.workspace_id, workspaceId),
        eq(campaigns.status, 'active'),
        sql`exists (select 1 from threads t where t.campaign_id = campaigns.id and t.state = 'active' and t.next_action_type = 'send_initial')`,
      ),
    );
  const links = campaignRows.length
    ? await db.select().from(campaign_mailboxes).where(inArray(campaign_mailboxes.campaign_id, campaignRows.map((campaign) => campaign.id)))
    : [];
  const activeMailboxes = new Set(mailboxRows.map((mailbox) => mailbox.id));

  const inputs = {
    domains: domainRows.map((domain) => {
      const override = domain.cap_override !== null && domain.cap_override_until !== null && domain.cap_override_until >= day ? domain.cap_override : null;
      return {
        id: domain.id,
        rampCap: rampCap({
          plan: domain.ramp_plan as RampPlan,
          step: domain.ramp_step,
          mailboxCapTotal: capTotals.get(domain.id) ?? 0,
          ...(domain.ramp_plan === 'custom' && { customSchedule: domain.ramp_custom_schedule as RampScheduleEntry[] }),
        }),
        capOverride: override,
        band: domain.reputation_band as Band,
        firstTouchesPaused: domain.first_touches_paused_at !== null,
      };
    }),
    mailboxes: mailboxRows.map((mailbox) => ({
      id: mailbox.id,
      domainId: mailbox.sending_domain_id,
      dailyLimit: mailbox.daily_limit,
      warmupEnabled: mailbox.warmup_enabled,
      warmupStartVolume: mailbox.warmup_start_volume,
      warmupDailyIncrement: mailbox.warmup_daily_increment,
      warmupStep: mailbox.warmup_step,
      band: mailbox.health_band as Band,
      followUpsDueToday: (used.followUps.get(mailbox.id) ?? 0) + (waitingByMailbox.get(mailbox.id) ?? 0),
    })),
    campaigns: campaignRows.map((campaign) => ({
      id: campaign.id,
      priority: campaign.priority as SendingPriority,
      dailyNewThreadsLimit: campaign.limit,
      mailboxes: links.filter((link) => link.campaign_id === campaign.id && activeMailboxes.has(link.mailbox_id)).map((link) => ({ mailboxId: link.mailbox_id, weight: link.weight })),
    })),
  };
  return { day, dayStart, dayEnd, used, inputs, domainRows, mailboxRows, campaignRows, capTotals, zone: workspace?.zone ?? 'UTC' };
}

export async function loadCapacity(db: Executor, workspaceId: string, now: Date): Promise<CapacityState> {
  const { day, dayStart, dayEnd, used, inputs } = await loadCapacityInputs(db, workspaceId, now);
  return { day, dayStart, dayEnd, plan: planCapacity(inputs), used };
}

export type ThrottleReason = 'domain_ramp' | 'domain_reputation' | 'domain_auth' | 'mailbox_cap' | 'mailbox_health' | 'campaign_share' | 'campaign_limit' | 'hourly_cap' | 'recipient_domain' | 'window' | 'mailbox_paused';

/** First touches the campaign may still send from a mailbox today. */
export function initialRoom(state: CapacityState, campaignId: string, mailboxId: string): number {
  const mailbox = state.plan.mailboxes.find((entry) => entry.mailboxId === mailboxId);
  const alloc = mailbox?.campaigns.find((entry) => entry.campaignId === campaignId)?.alloc ?? 0;
  const campaign = state.plan.campaigns.find((entry) => entry.campaignId === campaignId);
  const campaignLeft = (campaign?.alloc ?? 0) - (state.used.initialByCampaign.get(campaignId) ?? 0);
  return Math.max(0, Math.min(alloc - (state.used.initial.get(`${campaignId}:${mailboxId}`) ?? 0), campaignLeft));
}

/** Follow-ups a mailbox may still send today. Replies are reserved for separately (§8.3.3). */
export function followUpRoom(state: CapacityState, mailboxId: string): number {
  const mailbox = state.plan.mailboxes.find((entry) => entry.mailboxId === mailboxId);
  if (!mailbox) return 0;
  return Math.max(0, mailbox.followUps - (state.used.followUps.get(mailboxId) ?? 0));
}

/** Replies a mailbox may still send today: everything up to its reply limit, which includes the reserve and overflow (§8.3.3). */
export function replyRoom(state: CapacityState, mailboxId: string): number {
  const mailbox = state.plan.mailboxes.find((entry) => entry.mailboxId === mailboxId);
  if (!mailbox) return 0;
  let used = (state.used.followUps.get(mailboxId) ?? 0) + (state.used.replies.get(mailboxId) ?? 0);
  for (const [key, count] of state.used.initial) if (key.endsWith(`:${mailboxId}`)) used += count;
  return Math.max(0, mailbox.replyLimit - used);
}

/**
 * The mailbox a new thread starts on: the campaign's mailbox with the most first-touch room left,
 * by weight (§8.3.3). Null, with the limit that stopped it, when none has room.
 */
export function pickMailbox(state: CapacityState, campaignId: string, candidates: { mailboxId: string; weight: number }[]): { mailboxId: string } | { limitedBy: ThrottleReason } {
  let best: { mailboxId: string; score: number } | null = null;
  for (const candidate of candidates) {
    const room = initialRoom(state, campaignId, candidate.mailboxId);
    if (room <= 0) continue;
    const score = room * candidate.weight;
    if (!best || score > best.score || (score === best.score && candidate.mailboxId < best.mailboxId)) best = { mailboxId: candidate.mailboxId, score };
  }
  if (best) return { mailboxId: best.mailboxId };
  const campaign = state.plan.campaigns.find((entry) => entry.campaignId === campaignId);
  return { limitedBy: (campaign?.limitedBy as ThrottleReason | undefined) ?? 'mailbox_paused' };
}

/** Records a composed email against today's capacity, so the rest of the tick sees it. */
export function consume(state: CapacityState, kind: SendKind, campaignId: string, mailboxId: string): void {
  if (kind === 'initial') {
    bump(state.used.initial, `${campaignId}:${mailboxId}`);
    bump(state.used.initialByCampaign, campaignId);
  } else bump(kind === 'follow_up' ? state.used.followUps : state.used.replies, mailboxId);
}
