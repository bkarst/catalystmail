// Notifications (spec §11.2): urgent and high escalations, breaker trips, failing polls and
// webhook endpoints, and the AI budget at 80% and 100% (§10.2), mailed at once through the system SMTP (never a sending mailbox) and posted to
// Slack when one is set up. High-priority mail waits out quiet hours; urgent never does. Normal
// escalations go into the daily digest. Like webhooks, alerts are read from the activity log.

import { intlZoneCalendar } from '@catalyst/core';
import { activities, escalations, mailbox_daily_stats, mailboxes, messages, newId, notifications, push_subscriptions, thread_goal_achievements, threads, users, workspaces, type Db, type Executor } from '@catalyst/db';
import type { SystemMailer } from '@catalyst/email';
import { and, count, desc, eq, gt, inArray, isNull, lte, ne, notExists, or, sql } from 'drizzle-orm';

import { workspaceDay } from '../outbound/capacity.ts';
import type { SecretBox } from '../secrets.ts';
import { notificationSettingsOf } from '../settings/service.ts';
import { mailPrefsOf } from '../users/service.ts';
import { unsafeUrlReason, type WebhookNet } from '../webhooks/net.ts';
import { sendPush, type VapidKeys } from './web-push.ts';

export interface NotifyDeps {
  /** Null when SYSTEM_SMTP_URL isn't set: mail is skipped, not lost silently (the row says why). */
  mailer: SystemMailer | null;
  net: WebhookNet;
  secrets: SecretBox;
  /** APP_URL, for links. */
  appUrl: string | null;
  /** VAPID keys for browser push (§11.2); without them, nothing is pushed. */
  vapid?: VapidKeys | null;
  now: () => Date;
}

type Priority = 'urgent' | 'high' | 'normal';
type ActivityRow = typeof activities.$inferSelect;
interface Alert {
  kind: string;
  priority: Priority;
  title: string;
  body: string;
  link: string;
  /** Who should get it: an escalation's assignee, else the owners and admins. */
  assignee: string | null;
}

const SETTLE_MS = 5_000;
const LOOKBACK_MS = 86_400_000;
const DIGEST_HOUR = 8;

const SIGNALS: Record<string, string> = {
  hard_bounce_rate: 'the hard-bounce rate',
  complaint_rate: 'the complaint rate',
  blocklist: 'a blocklisting',
  provider_quota: 'the provider’s sending limit',
  campaign_early_bounces: 'bounces in the first 50 emails',
};

/** What an activity is worth telling someone about, if anything (§11.2, §8.9). */
async function alertFor(db: Executor, activity: ActivityRow): Promise<Alert | null> {
  const data = activity.data as Record<string, string | number | null | undefined>;
  switch (activity.type) {
    case 'escalation.created': {
      if (data.priority !== 'urgent' && data.priority !== 'high') return null;
      const [escalation] = await db.select({ assignee: escalations.assigned_user_id, explanation: escalations.explanation, dueAt: escalations.due_at }).from(escalations).where(eq(escalations.id, String(data.escalation_id)));
      if (!escalation) return null;
      return {
        kind: 'escalation',
        priority: data.priority,
        title: `Needs you: ${data.title}`,
        // A summary only, never the contact's own words (§11.2).
        body: `${escalation.explanation}\nDue by ${escalation.dueAt.toISOString().slice(0, 16).replace('T', ' ')} UTC.`,
        link: `/needs-you/${data.escalation_id}`,
        assignee: escalation.assignee,
      };
    }
    case 'escalation.sla_breached': {
      const [escalation] = await db.select({ assignee: escalations.assigned_user_id, title: escalations.title }).from(escalations).where(eq(escalations.id, String(data.escalation_id)));
      if (!escalation) return null;
      return { kind: 'sla_breached', priority: data.to === 'urgent' ? 'urgent' : 'high', title: `Overdue: ${escalation.title}`, body: `It passed its due time and is now ${data.to}.`, link: `/needs-you/${data.escalation_id}`, assignee: escalation.assignee };
    }
    case 'deliverability.breaker_tripped':
      if (data.level === 'warn') return null;
      if (data.scope === 'domain_first_touches') {
        const records = (activity.data as { records?: string[] }).records ?? [];
        return {
          kind: 'breaker',
          priority: 'urgent',
          title: `First emails paused on ${data.domain}`,
          body: `${records.map((record) => record.toUpperCase()).join(', ') || 'Authentication'} started failing on ${data.domain}, so Catalyst stopped first emails from it; follow-ups and replies still go. Fix the record, check DNS again, then resume first emails.`,
          link: `/deliverability/domains/${data.domain_id}`,
          assignee: null,
        };
      }
      return {
        kind: 'breaker',
        priority: 'urgent',
        title: 'Sending paused by a circuit breaker',
        body: `Catalyst paused ${data.scope === 'domain' ? 'every mailbox on a domain' : 'a mailbox'} because of ${SIGNALS[String(data.signal)] ?? data.signal}. Resuming asks you to confirm you’ve dealt with the cause.`,
        link: '/deliverability',
        assignee: null,
      };
    case 'campaign.breaker_tripped':
      // A warning waits for the digest (§11.2: normal).
      if (data.level === 'warn') return null;
      return { kind: 'breaker', priority: 'urgent', title: 'A campaign was paused: check your list', body: 'Five or more of its first 50 emails bounced, so Catalyst paused it.', link: `/campaigns/${activity.campaign_id ?? data.campaign_id}`, assignee: null };
    case 'mailbox.poll_failed':
      return { kind: 'poll_failed', priority: 'urgent', title: 'A mailbox can’t be read', body: 'Two checks for new mail failed in a row, so replies may be missed. Run the connection test.', link: '/deliverability', assignee: null };
    case 'webhook.disabled':
      return { kind: 'webhook_disabled', priority: 'high', title: 'A webhook endpoint was turned off', body: `${data.url} failed for 3 days, so Catalyst stopped sending to it.`, link: '/settings/webhooks', assignee: null };
    case 'ai.budget_warning':
      return { kind: 'ai_budget', priority: 'high', title: 'AI spend is at 80% of this month’s budget', body: `AI has cost ${usd(data.spent_usd)} of the ${usd(data.budget_usd)} budget for ${data.month}. At 100% the agent stops and replies come to you.`, link: '/settings/ai', assignee: null };
    case 'ai.budget_exhausted':
      return { kind: 'ai_budget', priority: 'high', title: 'The AI agent stopped: this month’s budget is spent', body: `AI has cost ${usd(data.spent_usd)} of the ${usd(data.budget_usd)} budget for ${data.month}. Until the month turns or you raise the budget, replies and AI-written emails come to you.`, link: '/settings/ai', assignee: null };
    default:
      return null;
  }
}
const usd = (value: unknown) => `US$${Number(value).toFixed(2)}`;
const ALERTING = ['escalation.created', 'escalation.sla_breached', 'deliverability.breaker_tripped', 'campaign.breaker_tripped', 'mailbox.poll_failed', 'webhook.disabled', 'ai.budget_warning', 'ai.budget_exhausted'];

async function recipients(db: Executor, workspaceId: string, assignee: string | null, purpose: 'email' | 'digest' | 'push'): Promise<(typeof users.$inferSelect)[]> {
  const active = and(eq(users.workspace_id, workspaceId), isNull(users.deactivated_at));
  // Alerts go to the owners and admins; the digest also to members, who handle escalations too.
  const roles: (typeof users.$inferSelect)['role'][] = purpose === 'digest' ? ['owner', 'admin', 'member'] : ['owner', 'admin'];
  const people = assignee ? await db.select().from(users).where(and(active, eq(users.id, assignee))) : await db.select().from(users).where(and(active, inArray(users.role, roles)));
  const fallback = people.length === 0 && assignee ? await db.select().from(users).where(and(active, inArray(users.role, ['owner', 'admin']))) : people;
  // The digest is mail too: someone who turned mail off gets neither.
  return fallback.filter((person) => {
    // Push goes to whoever allowed it in a browser; mail preferences are about mail.
    if (purpose === 'push') return true;
    const prefs = mailPrefsOf(person.notification_prefs);
    return prefs.email && (purpose === 'email' || prefs.digest);
  });
}

const percent = (value: unknown, digits = 1) => `${(Number(value) * 100).toFixed(digits)}%`;

/** One line for a warn-level trip, with the level at which it would pause. */
export function describeWarning(data: Record<string, unknown>): string {
  switch (data.signal) {
    case 'hard_bounce_rate':
      return `${data.email}: hard bounces at ${percent(data.rate)} over 7 days (it pauses at 4%).`;
    case 'complaint_rate':
      return `${data.email}: spam complaints at ${percent(data.rate, 2)} over 7 days (it pauses at 0.3%).`;
    case 'campaign_early_bounces':
      return `${data.name}: ${data.hard_bounces} of its first 50 emails bounced (it pauses at 5). Check the list.`;
    case 'open_rate_collapse':
      return `${data.domain}: human opens fell to ${percent(data.recent, 0)} from ${percent(data.previous, 0)}. Possibly landing in spam.`;
    case 'junk_replies':
      return `${data.domain}: ${data.junk_replies} replies were found in Junk this week.`;
    default:
      return `${String(data.signal)}: a warning.`;
  }
}

/** The end of quiet hours, when `now` falls inside them; otherwise null (§11.2). */
export function quietUntil(now: Date, zone: string, quiet: { start: string; end: string } | null | undefined): Date | null {
  if (!quiet) return null;
  const local = intlZoneCalendar.toLocal(now, zone);
  const minutes = local.hour * 60 + local.minute;
  const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  const start = toMinutes(quiet.start);
  const end = toMinutes(quiet.end);
  const inside = start <= end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
  if (!inside) return null;
  // The end is today, or tomorrow when the quiet hours run past midnight and it is evening now.
  const endsTomorrow = start > end && minutes >= start;
  const day = endsTomorrow ? new Date(Date.UTC(local.year, local.month - 1, local.day + 1)) : new Date(Date.UTC(local.year, local.month - 1, local.day));
  return intlZoneCalendar.fromLocal({ year: day.getUTCFullYear(), month: day.getUTCMonth() + 1, day: day.getUTCDate(), hour: Math.floor(end / 60), minute: end % 60, second: 0 }, zone);
}

/** Turns new alerting activities into notifications, one per recipient and channel. */
async function createAlerts(db: Db, deps: NotifyDeps, now: Date): Promise<number> {
  const pending = await db
    .select()
    .from(activities)
    .where(
      and(
        inArray(activities.type, ALERTING),
        gt(activities.created_at, new Date(now.getTime() - LOOKBACK_MS)),
        lte(activities.created_at, new Date(now.getTime() - SETTLE_MS)),
        // `activities.id` is written out: Drizzle leaves columns unqualified in a one-table select.
        notExists(sql`(select 1 from notifications n where n.activity_id = activities.id)`),
      ),
    )
    .orderBy(activities.created_at)
    .limit(500);
  let created = 0;
  for (const activity of pending) {
    const alert = await alertFor(db, activity);
    const [workspace] = await db.select({ zone: workspaces.default_timezone, settings: workspaces.settings }).from(workspaces).where(eq(workspaces.id, activity.workspace_id));
    const settings = notificationSettingsOf(workspace?.settings);
    const rows: (typeof notifications.$inferInsert)[] = [];
    if (alert) {
      const sendAfter = alert.priority === 'high' ? quietUntil(now, workspace?.zone ?? 'UTC', settings.quiet_hours) : null;
      const base = { workspace_id: activity.workspace_id, activity_id: activity.id, kind: alert.kind, priority: alert.priority, title: alert.title, body: alert.body, link: alert.link, send_after: sendAfter, created_at: now };
      for (const person of await recipients(db, activity.workspace_id, alert.assignee, 'email')) rows.push({ ...base, id: newId('notification'), user_id: person.id, channel: 'email' });
      if (settings.slack_webhook_enc) rows.push({ ...base, id: newId('notification'), user_id: null, channel: 'slack' });
      if (deps.vapid) {
        const people = await recipients(db, activity.workspace_id, alert.assignee, 'push');
        const subscribed = people.length ? await db.select({ user_id: push_subscriptions.user_id }).from(push_subscriptions).where(inArray(push_subscriptions.user_id, people.map((person) => person.id))) : [];
        for (const userId of new Set(subscribed.map((row) => row.user_id))) rows.push({ ...base, id: newId('notification'), user_id: userId, channel: 'push' });
      }
    }
    // A marker row even when no one is told, so the activity isn't looked at again.
    if (rows.length === 0) rows.push({ id: newId('notification'), workspace_id: activity.workspace_id, activity_id: activity.id, user_id: null, channel: 'email', kind: alert?.kind ?? 'none', priority: alert?.priority ?? 'normal', title: alert?.title ?? activity.type, body: '', status: 'skipped', error: alert ? 'No one to tell.' : 'Not worth telling anyone.', created_at: now });
    created += (await db.insert(notifications).values(rows).onConflictDoNothing().returning({ id: notifications.id })).length;
  }
  return created;
}

/** Sends what is due. Failures are kept with their error; mail isn't retried, so nobody gets it twice. */
async function sendDue(db: Db, deps: NotifyDeps, now: Date): Promise<{ sent: number; failed: number }> {
  const due = await db
    .select({ notification: notifications, email: users.email, settings: workspaces.settings })
    .from(notifications)
    .leftJoin(users, eq(users.id, notifications.user_id))
    .innerJoin(workspaces, eq(workspaces.id, notifications.workspace_id))
    .where(and(eq(notifications.status, 'pending'), or(isNull(notifications.send_after), lte(notifications.send_after, now))))
    .orderBy(notifications.created_at)
    .limit(200);
  const result = { sent: 0, failed: 0 };
  for (const { notification, email, settings } of due) {
    const link = notification.link && deps.appUrl ? `${deps.appUrl}${notification.link}` : null;
    let outcome: { status: 'sent' | 'failed' | 'skipped'; error: string | null };
    try {
      if (notification.channel === 'push') {
        outcome = await pushTo(db, deps, notification, link, now);
      } else if (notification.channel === 'email') {
        if (!deps.mailer) outcome = { status: 'skipped', error: 'SYSTEM_SMTP_URL is not set.' };
        else if (!email) outcome = { status: 'skipped', error: 'No address.' };
        else {
          await deps.mailer.send({ to: email, subject: notification.title, text: `${notification.body}${link ? `\n\nOpen: ${link}` : ''}\n\n— Catalyst` });
          outcome = { status: 'sent', error: null };
        }
      } else {
        const sealed = notificationSettingsOf(settings).slack_webhook_enc;
        if (!sealed) outcome = { status: 'skipped', error: 'Slack is no longer set up.' };
        else {
          const url = deps.secrets.open(Buffer.from(sealed, 'base64'));
          const unsafe = await unsafeUrlReason(url, deps.net);
          if (unsafe) throw new Error(unsafe);
          const response = await deps.net.post(url, { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: `*${notification.title}*\n${notification.body}${link ? `\n<${link}|Open in Catalyst>` : ''}` }), timeoutMs: 10_000 });
          outcome = response.status >= 200 && response.status < 300 ? { status: 'sent', error: null } : { status: 'failed', error: `Slack answered ${response.status}: ${response.body.slice(0, 200)}` };
        }
      }
    } catch (error) {
      outcome = { status: 'failed', error: (error instanceof Error ? error.message : String(error)).slice(0, 500) };
    }
    await db.update(notifications).set({ status: outcome.status, error: outcome.error, sent_at: outcome.status === 'sent' ? now : null }).where(eq(notifications.id, notification.id));
    if (outcome.status === 'sent') result.sent += 1;
    if (outcome.status === 'failed') result.failed += 1;
  }
  return result;
}

/** One alert to every browser the person allowed; a browser that unsubscribed is forgotten. */
async function pushTo(db: Db, deps: NotifyDeps, notification: typeof notifications.$inferSelect, link: string | null, now: Date): Promise<{ status: 'sent' | 'failed' | 'skipped'; error: string | null }> {
  if (!deps.vapid) return { status: 'skipped', error: 'VAPID keys are not set.' };
  const browsers = notification.user_id ? await db.select().from(push_subscriptions).where(eq(push_subscriptions.user_id, notification.user_id)) : [];
  if (browsers.length === 0) return { status: 'skipped', error: 'No browser is subscribed.' };
  // A summary only, never the contact's own words (§11.2).
  const payload = { title: notification.title, body: notification.body.slice(0, 300), url: link, priority: notification.priority };
  const errors: string[] = [];
  let sent = 0;
  for (const browser of browsers) {
    try {
      const result = await sendPush(deps.net, browser, payload, deps.vapid, now, { urgency: notification.priority === 'normal' ? 'normal' : 'high' });
      if (result.outcome === 'sent') {
        sent += 1;
        await db.update(push_subscriptions).set({ last_sent_at: now }).where(eq(push_subscriptions.id, browser.id));
      } else if (result.outcome === 'gone') await db.delete(push_subscriptions).where(eq(push_subscriptions.id, browser.id));
      else errors.push(`${new URL(browser.endpoint).host} answered ${result.status}`);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (sent > 0) return { status: 'sent', error: errors.length ? errors.join('; ').slice(0, 500) : null };
  return errors.length ? { status: 'failed', error: errors.join('; ').slice(0, 500) } : { status: 'skipped', error: 'Every browser had unsubscribed.' };
}

/** `notify.dispatch`, every minute: new alerts, then everything due. */
export async function dispatchNotifications(db: Db, deps: NotifyDeps) {
  const now = deps.now();
  const created = await createAlerts(db, deps, now);
  return { created, ...(await sendDue(db, deps, now)) };
}

/**
 * `notify.digest` (§4.4, daily 08:00 workspace time): once a day, each person who wants it gets
 * what is waiting (normal escalations, approvals) and yesterday's numbers. Runs hourly; a person
 * already sent today's is skipped. Nothing to say, nothing sent.
 */
export async function dailyDigest(db: Db, deps: NotifyDeps): Promise<{ queued: number }> {
  const now = deps.now();
  let queued = 0;
  for (const workspace of await db.select().from(workspaces)) {
    const local = intlZoneCalendar.toLocal(now, workspace.default_timezone);
    if (local.hour < DIGEST_HOUR) continue;
    const { day, dayStart } = workspaceDay(now, workspace.default_timezone);
    const yesterdayStart = new Date(dayStart.getTime() - 86_400_000);
    const yesterday = workspaceDay(yesterdayStart, workspace.default_timezone).day;
    const key = `digest:${day}`;

    const open = await db.select({ title: escalations.title, priority: escalations.priority }).from(escalations).where(and(eq(escalations.workspace_id, workspace.id), eq(escalations.status, 'open'))).orderBy(desc(escalations.created_at)).limit(50);
    const [approvals] = await db.select({ n: count() }).from(messages).where(and(eq(messages.workspace_id, workspace.id), eq(messages.status, 'pending_approval')));
    const mailboxIds = (await db.select({ id: mailboxes.id }).from(mailboxes).where(eq(mailboxes.workspace_id, workspace.id))).map((row) => row.id);
    const [stats] = mailboxIds.length
      ? await db.select({ sent: sql<number>`coalesce(sum(${mailbox_daily_stats.sent}), 0)::int`, replies: sql<number>`coalesce(sum(${mailbox_daily_stats.inbound_replies}), 0)::int` }).from(mailbox_daily_stats).where(and(inArray(mailbox_daily_stats.mailbox_id, mailboxIds), eq(mailbox_daily_stats.day, yesterday)))
      : [{ sent: 0, replies: 0 }];
    const [goals] = await db
      .select({ n: count() })
      .from(thread_goal_achievements)
      .innerJoin(threads, eq(threads.id, thread_goal_achievements.thread_id))
      .where(and(eq(threads.workspace_id, workspace.id), ne(thread_goal_achievements.method, 'implied'), isNull(thread_goal_achievements.revoked_at), gt(thread_goal_achievements.achieved_at, yesterdayStart), lte(thread_goal_achievements.achieved_at, dayStart)));
    // Warn-level breaker trips of the last day (§8.9): worth knowing, not worth waking anyone.
    const warnings = await db
      .select({ data: activities.data })
      .from(activities)
      .where(and(eq(activities.workspace_id, workspace.id), inArray(activities.type, ['deliverability.breaker_tripped', 'campaign.breaker_tripped']), gt(activities.occurred_at, new Date(now.getTime() - 86_400_000)), sql`${activities.data}->>'level' = 'warn'`))
      .orderBy(desc(activities.occurred_at))
      .limit(20);
    const waiting = open.length + (approvals?.n ?? 0);
    if (waiting === 0 && (stats?.sent ?? 0) === 0 && warnings.length === 0) continue;

    const lines = [
      open.length ? `Needs you: ${open.length} open${open.some((entry) => entry.priority === 'urgent') ? ' (some urgent)' : ''}.` : 'Nothing needs you.',
      ...open.slice(0, 5).map((entry) => `  • ${entry.title}`),
      ...(approvals?.n ? [`Waiting for approval: ${approvals.n} email${approvals.n === 1 ? '' : 's'}.`] : []),
      ...(warnings.length ? [`Deliverability warnings: ${warnings.length}.`, ...warnings.slice(0, 5).map((entry) => `  • ${describeWarning(entry.data as Record<string, unknown>)}`)] : []),
      `Yesterday: ${stats?.sent ?? 0} sent, ${stats?.replies ?? 0} replies, ${goals?.n ?? 0} goal${goals?.n === 1 ? '' : 's'} reached.`,
    ];
    for (const person of await recipients(db, workspace.id, null, 'digest')) {
      const rows = await db
        .insert(notifications)
        .values({ id: newId('notification'), workspace_id: workspace.id, user_id: person.id, activity_id: key, channel: 'email', kind: 'digest', priority: 'normal', title: `Catalyst daily: ${waiting} waiting for you`, body: lines.join('\n'), link: '/', created_at: now })
        .onConflictDoNothing()
        .returning({ id: notifications.id });
      queued += rows.length;
    }
  }
  return { queued };
}

