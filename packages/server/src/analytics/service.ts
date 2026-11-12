// Analytics (spec §13.4, §15.4, §15.9): campaign stats, the funnel, and the Dashboard overview.
// Stage counts come from the milestone times each thread keeps (first_sent_at, received_at,
// responded_at) and from goal achievements; a reply is credited to the last email sent before it.

import { planCapacity, rampFinalStep, type RampPlan, type RampScheduleEntry } from '@catalyst/core';
import { activities, campaign_goals, campaign_step_variants, campaign_steps, campaigns, escalations, follow_up_sequences, mailbox_daily_stats, mailboxes, messages, sending_domains, thread_goal_achievements, threads, type Db } from '@catalyst/db';
import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, ne, sql, type SQL } from 'drizzle-orm';

import { notFound } from '../api/errors.ts';
import { serializeActivity } from '../contacts/timeline.ts';
import { loadCapacityInputs, workspaceDay } from '../outbound/capacity.ts';

const DAY_MS = 86_400_000;
const rate = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 10_000) / 10_000 : 0);

interface FunnelStage {
  key: string;
  name: string;
  count: number;
  /** Of the stage before it; 1 for the first. */
  conversion: number;
}

/** Threads that reached each stage, then each goal (§15.4 funnel bars). */
async function funnel(db: Db, workspaceId: string, options: { campaignId?: string | undefined; since?: Date | undefined }): Promise<FunnelStage[]> {
  const where: SQL[] = [eq(threads.workspace_id, workspaceId), isNotNull(threads.first_sent_at)];
  if (options.campaignId) where.push(eq(threads.campaign_id, options.campaignId));
  if (options.since) where.push(gte(threads.first_sent_at, options.since));
  const [reached] = await db
    .select({ sent: count(), received: sql<number>`count(${threads.received_at})::int`, responded: sql<number>`count(${threads.responded_at})::int` })
    .from(threads)
    .where(and(...where));
  const goals = await db
    .select({ key: campaign_goals.key, name: sql<string>`min(${campaign_goals.name})`, position: sql<number>`min(${campaign_goals.position})::int`, achieved: sql<number>`count(distinct ${thread_goal_achievements.thread_id})::int` })
    .from(campaign_goals)
    .innerJoin(campaigns, eq(campaigns.id, campaign_goals.campaign_id))
    .leftJoin(thread_goal_achievements, and(eq(thread_goal_achievements.goal_id, campaign_goals.id), isNull(thread_goal_achievements.revoked_at)))
    .leftJoin(threads, eq(threads.id, thread_goal_achievements.thread_id))
    .where(and(eq(campaigns.workspace_id, workspaceId), ...(options.campaignId ? [eq(campaign_goals.campaign_id, options.campaignId)] : []), ...(options.since ? [sql`(${threads.id} is null or ${threads.first_sent_at} >= ${options.since})`] : [])))
    .groupBy(campaign_goals.key)
    .orderBy(sql`min(${campaign_goals.position})`);
  const counts = [
    { key: 'sent', name: 'Sent', count: reached?.sent ?? 0 },
    { key: 'received', name: 'Received', count: reached?.received ?? 0 },
    { key: 'responded', name: 'Responded', count: reached?.responded ?? 0 },
    ...goals.map((goal) => ({ key: `goal:${goal.key}`, name: goal.name, count: goal.achieved })),
  ];
  return counts.map((stage, index) => ({ ...stage, conversion: index === 0 ? 1 : rate(stage.count, counts[index - 1]!.count) }));
}

export async function getFunnel(db: Db, workspaceId: string, query: { campaign_id?: string | undefined; days?: number | undefined }, now: Date) {
  if (query.campaign_id) {
    const [campaign] = await db.select({ id: campaigns.id }).from(campaigns).where(and(eq(campaigns.id, query.campaign_id), eq(campaigns.workspace_id, workspaceId)));
    if (!campaign) throw notFound('The campaign');
  }
  const since = query.days ? new Date(now.getTime() - query.days * DAY_MS) : undefined;
  return { campaign_id: query.campaign_id ?? null, since: since?.toISOString() ?? null, stages: await funnel(db, workspaceId, { campaignId: query.campaign_id, since }) };
}

export async function getCampaignStats(db: Db, workspaceId: string, campaignId: string, query: { days?: number | undefined }, now: Date) {
  const [campaign] = await db.select().from(campaigns).where(and(eq(campaigns.id, campaignId), eq(campaigns.workspace_id, workspaceId)));
  if (!campaign) throw notFound('The campaign');
  const since = query.days ? new Date(now.getTime() - query.days * DAY_MS) : undefined;
  const inCampaign = sql`${messages.thread_id} in (select id from threads where campaign_id = ${campaignId})`;
  const sentWhere = and(inCampaign, eq(messages.direction, 'outbound'), isNotNull(messages.sent_at), ...(since ? [gte(messages.sent_at, since)] : []));

  const byState = await db.select({ state: threads.state, n: count() }).from(threads).where(eq(threads.campaign_id, campaignId)).groupBy(threads.state);
  const [sent] = await db
    .select({ sent: count(), opened: sql<number>`count(*) filter (where ${messages.human_open})::int`, bounced: sql<number>`count(*) filter (where ${messages.status} = 'bounced')::int` })
    .from(messages)
    .where(sentWhere);
  const [replies] = await db
    .select({ n: sql<number>`count(distinct ${messages.thread_id})::int` })
    .from(messages)
    .where(and(inCampaign, eq(messages.direction, 'inbound'), eq(messages.inbound_kind, 'human_reply'), ...(since ? [gte(messages.received_at, since)] : [])));

  // Per step and variant, with each thread's first reply credited to the last email before it.
  const perVariant = await db
    .select({ stepId: messages.step_id, variantId: messages.variant_id, sent: count(), opened: sql<number>`count(*) filter (where ${messages.human_open})::int`, bounced: sql<number>`count(*) filter (where ${messages.status} = 'bounced')::int` })
    .from(messages)
    .where(and(sentWhere, isNotNull(messages.step_id)))
    .groupBy(messages.step_id, messages.variant_id);
  const credited = await db.execute<{ step_id: string | null; variant_id: string | null; n: number }>(sql`
    select o.step_id, o.variant_id, count(*)::int as n from (
      select distinct on (r.thread_id) r.thread_id, r.received_at from messages r
      where r.direction = 'inbound' and r.inbound_kind = 'human_reply' and r.thread_id in (select id from threads where campaign_id = ${campaignId})
      order by r.thread_id, r.received_at
    ) first_reply
    join lateral (
      select m.step_id, m.variant_id from messages m
      where m.thread_id = first_reply.thread_id and m.direction = 'outbound' and m.sent_at is not null and m.sent_at <= first_reply.received_at
      order by m.sent_at desc limit 1
    ) o on true
    group by o.step_id, o.variant_id`);
  const repliesFor = (stepId: string | null, variantId: string | null) => credited.rows.find((row) => row.step_id === stepId && row.variant_id === variantId)?.n ?? 0;

  const stepRows = await db.select().from(campaign_steps).where(eq(campaign_steps.campaign_id, campaignId)).orderBy(asc(campaign_steps.position));
  const sequenceRows = await db.select().from(follow_up_sequences).where(eq(follow_up_sequences.campaign_id, campaignId));
  const variantRows = stepRows.length ? await db.select().from(campaign_step_variants).where(inArray(campaign_step_variants.step_id, stepRows.map((step) => step.id))) : [];
  const steps = stepRows
    .map((step) => {
      const sequence = sequenceRows.find((entry) => entry.id === step.sequence_id);
      const variants = variantRows
        .filter((variant) => variant.step_id === step.id)
        .sort((a, b) => a.label.localeCompare(b.label))
        .map((variant) => {
          const stats = perVariant.find((row) => row.stepId === step.id && row.variantId === variant.id);
          const sentCount = stats?.sent ?? 0;
          const replyCount = repliesFor(step.id, variant.id);
          return { variant_id: variant.id, label: variant.label, sent: sentCount, opened: stats?.opened ?? 0, bounced: stats?.bounced ?? 0, replies: replyCount, reply_rate: rate(replyCount, sentCount) };
        });
      const total = (key: 'sent' | 'opened' | 'bounced' | 'replies') => variants.reduce((sum, variant) => sum + variant[key], 0);
      return {
        step_id: step.id,
        label: sequence ? `${sequence.name} · step ${step.position}` : 'Initial email',
        sent: total('sent'),
        opened: total('opened'),
        bounced: total('bounced'),
        replies: total('replies'),
        reply_rate: rate(total('replies'), total('sent')),
        variants,
      };
    })
    .sort((a, b) => (a.label === 'Initial email' ? -1 : b.label === 'Initial email' ? 1 : 0));

  const goalRows = await db
    .select({ goal: campaign_goals, achieved: sql<number>`count(${thread_goal_achievements.thread_id}) filter (where ${thread_goal_achievements.revoked_at} is null)::int` })
    .from(campaign_goals)
    .leftJoin(thread_goal_achievements, eq(thread_goal_achievements.goal_id, campaign_goals.id))
    .where(eq(campaign_goals.campaign_id, campaignId))
    .groupBy(campaign_goals.id)
    .orderBy(asc(campaign_goals.position));
  const goals = goalRows.map(({ goal, achieved }) => ({ goal_id: goal.id, key: goal.key, name: goal.name, achieved, value_cents: goal.value_cents === null ? null : goal.value_cents * achieved }));

  const sentCount = sent?.sent ?? 0;
  return {
    campaign_id: campaignId,
    since: since?.toISOString() ?? null,
    funnel: await funnel(db, workspaceId, { campaignId, since }),
    threads: { total: byState.reduce((sum, row) => sum + row.n, 0), by_state: Object.fromEntries(byState.map((row) => [row.state, row.n])) },
    emails: { sent: sentCount, opened: sent?.opened ?? 0, bounced: sent?.bounced ?? 0, replies: replies?.n ?? 0, open_rate: rate(sent?.opened ?? 0, sentCount), reply_rate: rate(replies?.n ?? 0, sentCount), bounce_rate: rate(sent?.bounced ?? 0, sentCount) },
    steps,
    goals,
    value_cents: goals.reduce((sum, goal) => sum + (goal.value_cents ?? 0), 0),
  };
}

/** Threads emailed and threads that got a human reply, per day, over [from, to). */
async function replyActivity(db: Db, workspaceId: string, from: Date, to: Date, zone: string) {
  const day = (column: typeof messages.sent_at | typeof messages.received_at) => sql<string>`to_char(${column} at time zone ${zone}, 'YYYY-MM-DD')`;
  const emailed = await db
    .select({ day: day(messages.sent_at), n: sql<number>`count(distinct ${messages.thread_id})::int` })
    .from(messages)
    .where(and(eq(messages.workspace_id, workspaceId), eq(messages.direction, 'outbound'), gte(messages.sent_at, from), sql`${messages.sent_at} < ${to}`))
    .groupBy(sql`1`);
  const replied = await db
    .select({ day: day(messages.received_at), n: sql<number>`count(distinct ${messages.thread_id})::int` })
    .from(messages)
    .where(and(eq(messages.workspace_id, workspaceId), eq(messages.direction, 'inbound'), eq(messages.inbound_kind, 'human_reply'), isNotNull(messages.thread_id), gte(messages.received_at, from), sql`${messages.received_at} < ${to}`))
    .groupBy(sql`1`);
  // Over the whole period, a thread emailed on two days counts once.
  const [totals] = await db
    .select({
      emailed: sql<number>`count(distinct ${messages.thread_id}) filter (where ${messages.direction} = 'outbound' and ${messages.sent_at} >= ${from} and ${messages.sent_at} < ${to})::int`,
      replied: sql<number>`count(distinct ${messages.thread_id}) filter (where ${messages.direction} = 'inbound' and ${messages.inbound_kind} = 'human_reply' and ${messages.received_at} >= ${from} and ${messages.received_at} < ${to})::int`,
    })
    .from(messages)
    .where(and(eq(messages.workspace_id, workspaceId), isNotNull(messages.thread_id)));
  return { emailed, replied, totals: totals ?? { emailed: 0, replied: 0 } };
}

export async function getDashboardOverview(db: Db, workspaceId: string, query: { days: number }, now: Date) {
  const loaded = await loadCapacityInputs(db, workspaceId, now);
  const { day: today } = workspaceDay(now, loaded.zone);
  const from = new Date(now.getTime() - query.days * DAY_MS);
  const before = new Date(from.getTime() - query.days * DAY_MS);

  const [open] = await db
    .select({ open: count(), urgent: sql<number>`count(*) filter (where ${escalations.priority} = 'urgent')::int` })
    .from(escalations)
    .where(and(eq(escalations.workspace_id, workspaceId), eq(escalations.status, 'open')));
  const [approvals] = await db.select({ n: count() }).from(messages).where(and(eq(messages.workspace_id, workspaceId), eq(messages.status, 'pending_approval')));

  const mailboxIds = (await db.select({ id: mailboxes.id }).from(mailboxes).where(eq(mailboxes.workspace_id, workspaceId))).map((row) => row.id);
  const statsSince = (since: string) =>
    mailboxIds.length
      ? db
          .select({ sent: sql<number>`coalesce(sum(${mailbox_daily_stats.sent}), 0)::int`, bounced: sql<number>`coalesce(sum(${mailbox_daily_stats.bounced_hard}), 0)::int`, complaints: sql<number>`coalesce(sum(${mailbox_daily_stats.complaints}), 0)::int` })
          .from(mailbox_daily_stats)
          .where(and(inArray(mailbox_daily_stats.mailbox_id, mailboxIds), gte(mailbox_daily_stats.day, since)))
          .then((rows) => rows[0]!)
      : Promise.resolve({ sent: 0, bounced: 0, complaints: 0 });
  const sentToday = await statsSince(today);
  const week = await statsSince(new Date(Date.parse(`${today}T00:00:00Z`) - 6 * DAY_MS).toISOString().slice(0, 10));
  const plan = planCapacity(loaded.inputs);

  const current = await replyActivity(db, workspaceId, from, now, loaded.zone);
  const previous = await replyActivity(db, workspaceId, before, from, loaded.zone);
  const replyRate = rate(current.totals.replied, current.totals.emailed);
  const previousRate = rate(previous.totals.replied, previous.totals.emailed);
  const daily = [...new Set([...current.emailed, ...current.replied].map((row) => row.day))].sort().map((day) => ({ day, rate: rate(current.replied.find((row) => row.day === day)?.n ?? 0, current.emailed.find((row) => row.day === day)?.n ?? 0) }));

  const reached = await db
    .select({ name: campaign_goals.name, n: count(), value: sql<number>`coalesce(sum(${campaign_goals.value_cents}), 0)::bigint` })
    .from(thread_goal_achievements)
    .innerJoin(campaign_goals, eq(campaign_goals.id, thread_goal_achievements.goal_id))
    .innerJoin(threads, eq(threads.id, thread_goal_achievements.thread_id))
    .where(and(eq(threads.workspace_id, workspaceId), isNull(thread_goal_achievements.revoked_at), ne(thread_goal_achievements.method, 'implied'), gte(thread_goal_achievements.achieved_at, from)))
    .groupBy(campaign_goals.name)
    .orderBy(desc(count()));

  const live = await db.select().from(campaigns).where(and(eq(campaigns.workspace_id, workspaceId), inArray(campaigns.status, ['active', 'paused']))).orderBy(asc(campaigns.created_at));
  const domains = await db.select().from(sending_domains).where(eq(sending_domains.workspace_id, workspaceId)).orderBy(asc(sending_domains.domain));
  const recent = await db
    .select()
    .from(activities)
    .where(and(eq(activities.workspace_id, workspaceId), inArray(activities.type, ['message.received', 'goal.achieved', 'escalation.created', 'thread.stage_changed', 'deliverability.breaker_tripped'])))
    .orderBy(desc(activities.occurred_at))
    .limit(10);

  return {
    days: query.days,
    needs_you: { open: open?.open ?? 0, urgent: open?.urgent ?? 0, pending_approval: approvals?.n ?? 0 },
    sent_today: { sent: sentToday.sent, planned: plan.domains.reduce((total, entry) => total + entry.cap, 0) },
    reply_rate: { rate: replyRate, previous: previousRate, change_points: Math.round((replyRate - previousRate) * 1000) / 10, daily },
    goals: { reached: reached.map((row) => ({ name: row.name, count: row.n })), value_cents: reached.reduce((total, row) => total + Number(row.value), 0) },
    campaigns: await Promise.all(live.map(async (campaign) => ({ campaign_id: campaign.id, name: campaign.name, status: campaign.status as 'active' | 'paused', funnel: await funnel(db, workspaceId, { campaignId: campaign.id }) }))),
    deliverability: {
      bounce_rate_7d: rate(week.bounced, week.sent),
      complaint_rate_7d: rate(week.complaints, week.sent),
      domains_passing_dns: domains.filter((domain) => [domain.spf_status, domain.dkim_status, domain.dmarc_status].every((status) => status === 'pass' || status === 'warn')).length,
      domains_blocklisted: domains.filter((domain) => domain.blocklisted).length,
      domains: domains.map((domain) => ({
        domain_id: domain.id,
        domain: domain.domain,
        reputation_band: domain.reputation_band as 'healthy' | 'at_risk' | 'critical' | 'paused',
        ramp_step: domain.ramp_step,
        ramp_final_step: rampFinalStep({ plan: domain.ramp_plan as RampPlan, mailboxCapTotal: loaded.capTotals.get(domain.id) ?? 0, ...(domain.ramp_plan === 'custom' && { customSchedule: domain.ramp_custom_schedule as RampScheduleEntry[] }) }),
      })),
    },
    recent_activity: recent.map(serializeActivity),
  };
}

/**
 * Analytics → Knowledge gaps (§11.3): the questions in `knowledge_gap` escalations, grouped when
 * they read the same once case, spacing and punctuation are set aside, most asked first.
 */
export async function listKnowledgeGaps(db: Db, workspaceId: string, query: { days?: number | undefined; campaign_id?: string | undefined; limit: number }, now: Date) {
  if (query.campaign_id) {
    const [campaign] = await db.select({ id: campaigns.id }).from(campaigns).where(and(eq(campaigns.id, query.campaign_id), eq(campaigns.workspace_id, workspaceId)));
    if (!campaign) throw notFound('The campaign');
  }
  const since = query.days ? new Date(now.getTime() - query.days * DAY_MS) : null;
  const rows = await db.execute<{ question: string; asked: number; open: number; answered: boolean; last_asked_at: Date | string; escalation_ids: string[] }>(sql`
    with asked as (
      select distinct on (e.id, q.key) e.id, e.created_at, e.status, e.knowledge_item_id, q.key, q.text
      from ${escalations} e
      left join ${threads} t on t.id = e.thread_id
      cross join lateral (
        select elem->>'text' as text, btrim(regexp_replace(lower(elem->>'text'), '[^[:alnum:]]+', ' ', 'g')) as key
        from jsonb_array_elements(e.questions) elem
        where jsonb_typeof(elem) = 'object' and coalesce(elem->>'text', '') <> ''
      ) q
      where e.workspace_id = ${workspaceId} and e.reason = 'knowledge_gap' and q.key <> ''
        ${since ? sql`and e.created_at >= ${since}` : sql``}
        ${query.campaign_id ? sql`and t.campaign_id = ${query.campaign_id}` : sql``}
      order by e.id, q.key, e.created_at
    )
    select (array_agg(text order by created_at desc))[1] as question,
      count(*)::int as asked,
      (count(*) filter (where status in ('open', 'snoozed')))::int as open,
      bool_or(knowledge_item_id is not null) as answered,
      max(created_at) as last_asked_at,
      (array_agg(id order by created_at desc, id desc))[1:5] as escalation_ids
    from asked
    group by key
    order by asked desc, last_asked_at desc, key
    limit ${query.limit}
  `);
  return {
    data: rows.rows.map((row) => ({
      question: row.question,
      asked: row.asked,
      open: row.open,
      answered: row.answered,
      last_asked_at: new Date(row.last_asked_at).toISOString(),
      escalation_ids: row.escalation_ids,
    })),
  };
}
