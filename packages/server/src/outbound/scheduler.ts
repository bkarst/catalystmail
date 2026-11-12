// The scheduler tick (spec §7.2 steps 1–4, §8.3, §8.4): every minute, find threads whose initial
// email or follow-up is due, and either compose it within today's capacity and the contact's
// sending window, or postpone it with the limit that held it back (§8.3.5).

import { fitIntoWindow, intlZoneCalendar, randomBetween, type Rng, type SendingWindow, type ZoneContext } from '@catalyst/core';
import { campaign_mailboxes, campaigns, contacts, emailDomain, mailboxes, messages, threads, workspaces, type Db } from '@catalyst/db';
import { isFreemailDomain } from '@catalyst/email';
import type { JobQueue } from '@catalyst/jobs';
import { and, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';

import { consume, followUpRoom, initialRoom, loadCapacity, pickMailbox, type CapacityState, type ThrottleReason } from './capacity.ts';
import { composeNext } from './compose.ts';

export interface SchedulerDeps {
  jobs: JobQueue;
  rng: Rng;
  trackingSecret: string | null;
  appHost: string | null;
  /** AI-mode steps go to the agent (`ai.compose`). */
  ai?: boolean;
}

export interface TickResult {
  composed: number;
  postponed: Partial<Record<ThrottleReason, number>>;
  escalated: number;
}

/** Due within this much of now counts as due (§7.2 step 1). */
const LOOKAHEAD_MS = 5 * 60_000;
const BATCH = 500;
/** First touches per recipient corporate domain, whole workspace (§8.3.4). */
const DOMAIN_PER_HOUR = 5;
const DOMAIN_PER_DAY = 20;

const minutes = (rng: Rng, min: number, max: number) => randomBetween(rng, min * 60_000, max * 60_000);

export async function schedulerTick(db: Db, deps: SchedulerDeps, now: Date): Promise<TickResult> {
  const result: TickResult = { composed: 0, postponed: {}, escalated: 0 };
  const workspaceRows = await db.select({ id: workspaces.id, zone: workspaces.default_timezone }).from(workspaces);
  for (const workspace of workspaceRows) await tickWorkspace(db, workspace, deps, now, result);
  return result;
}

async function tickWorkspace(db: Db, workspace: { id: string; zone: string }, deps: SchedulerDeps, now: Date, result: TickResult): Promise<void> {
  // Replies first, then follow-ups in later stages, then no-reply follow-ups, then initial emails (§8.3.3).
  const priority = sql<number>`case when ${threads.next_action_type} = 'send_follow_up' and ${threads.stage_rank} >= 3 then 0 when ${threads.next_action_type} = 'send_follow_up' then 1 else 2 end`;
  const due = await db
    .select({ thread: threads, window: campaigns.sending_window, blackout: campaigns.blackout_dates, contactZone: contacts.timezone, email: contacts.email })
    .from(threads)
    .innerJoin(campaigns, eq(campaigns.id, threads.campaign_id))
    .innerJoin(contacts, eq(contacts.id, threads.contact_id))
    .where(
      and(
        eq(threads.workspace_id, workspace.id),
        eq(threads.state, 'active'),
        inArray(threads.next_action_type, ['send_initial', 'send_follow_up']),
        isNull(threads.next_action_message_id),
        eq(campaigns.status, 'active'),
        or(isNull(threads.next_action_at), lte(threads.next_action_at, new Date(now.getTime() + LOOKAHEAD_MS))),
      ),
    )
    .orderBy(priority, sql`coalesce(${threads.next_action_at}, ${threads.created_at})`, threads.id)
    .limit(BATCH);
  if (due.length === 0) return;

  const capacity = await loadCapacity(db, workspace.id, now);
  const lastSlot = await nextSlots(db, workspace.id);
  const mailboxRows = await db.select().from(mailboxes).where(and(eq(mailboxes.workspace_id, workspace.id), eq(mailboxes.status, 'active')));
  const links = await db.select().from(campaign_mailboxes).where(inArray(campaign_mailboxes.mailbox_id, mailboxRows.map((mailbox) => mailbox.id).concat('')));
  const domainCounts = await recipientDomainCounts(db, workspace.id, capacity, now);

  for (const { thread, window: storedWindow, blackout, contactZone, email } of due) {
    const window = storedWindow as SendingWindow & { fallback_tz?: string };
    const ctx: ZoneContext = { zone: contactZone ?? window.fallback_tz ?? workspace.zone, blackoutDates: blackout, calendar: intlZoneCalendar };
    const postpone = async (until: Date, reason: ThrottleReason) => {
      await db.update(threads).set({ next_action_at: until, throttle_reason: reason, updated_at: now }).where(and(eq(threads.id, thread.id), isNull(threads.next_action_message_id)));
      result.postponed[reason] = (result.postponed[reason] ?? 0) + 1;
    };
    /** The next window opening after today, with some spread so a backlog doesn't all wake at once. */
    const tomorrow = () => new Date(fitIntoWindow(capacity.dayEnd, window, ctx).getTime() + minutes(deps.rng, 0, 90));

    // The contact's sending window (§7.2 step 3, §8.4).
    const start = new Date(Math.max(now.getTime(), thread.next_action_at?.getTime() ?? 0));
    const open = fitIntoWindow(start, window, ctx);
    if (open.getTime() > now.getTime() + LOOKAHEAD_MS) {
      await postpone(new Date(open.getTime() + minutes(deps.rng, 0, 90)), 'window');
      continue;
    }

    // Capacity (§8.3): follow-ups stay on their mailbox; a first touch picks one now.
    const initial = thread.next_action_type === 'send_initial';
    let mailboxId = thread.mailbox_id;
    if (initial) {
      if (!mailboxId) {
        const candidates = links.filter((link) => link.campaign_id === thread.campaign_id).map((link) => ({ mailboxId: link.mailbox_id, weight: link.weight }));
        const picked = pickMailbox(capacity, thread.campaign_id, candidates);
        if ('limitedBy' in picked) {
          await postpone(tomorrow(), picked.limitedBy);
          continue;
        }
        mailboxId = picked.mailboxId;
      } else if (initialRoom(capacity, thread.campaign_id, mailboxId) <= 0) {
        await postpone(tomorrow(), 'campaign_share');
        continue;
      }
      // At most 5 an hour and 20 a day to any one corporate domain (§8.3.4).
      const domain = emailDomain(email);
      if (!isFreemailDomain(domain)) {
        const counts = domainCounts.get(domain) ?? { hour: 0, day: 0 };
        if (counts.day >= DOMAIN_PER_DAY) {
          await postpone(tomorrow(), 'recipient_domain');
          continue;
        }
        if (counts.hour >= DOMAIN_PER_HOUR) {
          await postpone(new Date(now.getTime() + minutes(deps.rng, 60, 90)), 'recipient_domain');
          continue;
        }
        domainCounts.set(domain, { hour: counts.hour + 1, day: counts.day + 1 });
      }
    } else {
      if (!mailboxId || !mailboxRows.some((mailbox) => mailbox.id === mailboxId)) {
        await postpone(new Date(now.getTime() + 60 * 60_000), 'mailbox_paused');
        continue;
      }
      if (followUpRoom(capacity, mailboxId) <= 0) {
        await postpone(tomorrow(), 'mailbox_cap');
        continue;
      }
    }

    // Spaced apart on the mailbox, never on an exact minute, and still inside the window (§7.2 step 4).
    const mailbox = mailboxRows.find((entry) => entry.id === mailboxId)!;
    const previous = lastSlot.get(mailbox.id);
    const spaced = previous ? previous.getTime() + randomBetween(deps.rng, mailbox.min_interval_sec * 1000, mailbox.max_interval_sec * 1000) : open.getTime();
    const scheduledFor = fitIntoWindow(new Date(Math.max(open.getTime(), spaced) + randomBetween(deps.rng, 0, 59_000)), window, ctx);

    const composed = await db.transaction((tx) =>
      composeNext(tx, { threadId: thread.id, mailboxId: mailbox.id, scheduledFor }, { jobs: deps.jobs, rng: deps.rng, trackingSecret: deps.trackingSecret, appHost: deps.appHost, now, ai: deps.ai ?? false }),
    );
    // Handed to the agent counts like composed: its slot and capacity are taken now.
    if (composed.status === 'scheduled' || composed.status === 'ai_queued') {
      result.composed += 1;
      consume(capacity, initial ? 'initial' : 'follow_up', thread.campaign_id, mailbox.id);
      lastSlot.set(mailbox.id, scheduledFor);
    } else if (composed.status === 'escalated') result.escalated += 1;
  }
}

/** The latest scheduled or sent time on each mailbox: the next send is spaced after it. */
async function nextSlots(db: Db, workspaceId: string): Promise<Map<string, Date>> {
  const rows = await db
    .select({ mailbox_id: messages.mailbox_id, last: sql<Date>`max(coalesce(${messages.scheduled_for}, ${messages.sent_at}))` })
    .from(messages)
    .where(and(eq(messages.workspace_id, workspaceId), eq(messages.direction, 'outbound'), inArray(messages.status, ['scheduled', 'sending', 'sent'])))
    .groupBy(messages.mailbox_id);
  return new Map(rows.map((row) => [row.mailbox_id, new Date(row.last)]));
}

/** First touches already composed or sent to each recipient domain, in the last hour and today. */
async function recipientDomainCounts(db: Db, workspaceId: string, capacity: CapacityState, now: Date): Promise<Map<string, { hour: number; day: number }>> {
  const rows = await db.execute<{ domain: string; hour: number; day: number }>(sql`
    select split_part(c.email::text, '@', 2) as domain,
      count(*) filter (where coalesce(m.sent_at, m.scheduled_for, m.created_at) > ${new Date(now.getTime() - 3_600_000)})::int as hour,
      count(*)::int as day
    from messages m join threads t on t.id = m.thread_id join contacts c on c.id = t.contact_id join campaign_steps s on s.id = m.step_id
    where m.workspace_id = ${workspaceId} and m.direction = 'outbound' and s.sequence_id is null
      and m.status in ('scheduled', 'sending', 'sent', 'bounced')
      and coalesce(m.sent_at, m.scheduled_for, m.created_at) >= ${capacity.dayStart}
    group by 1`);
  return new Map(rows.rows.map((row) => [row.domain, { hour: row.hour, day: row.day }]));
}

