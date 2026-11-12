// Sending one scheduled email (spec §7.2 steps 5–8): the pre-send guard under row locks, the
// atomic scheduled → sending gate, SMTP submission, and what each kind of answer does.

import { limitAfterQuotaError, type Rng } from '@catalyst/core';
import {
  activities,
  campaign_steps,
  campaigns,
  contacts,
  mailbox_daily_stats,
  mailboxes,
  messages,
  newId,
  sending_domains,
  suppressionsFor,
  threads,
  workspaces,
  type Db,
  type Executor,
} from '@catalyst/db';
import { buildMime, type SmtpTransport, type SubmitResult } from '@catalyst/email';
import type { JobQueue } from '@catalyst/jobs';
import type { ObjectStorage } from '@catalyst/storage';
import { and, eq, gt, inArray, lt, ne, sql } from 'drizzle-orm';

import { raiseEscalation } from '../escalations/raise.ts';
import type { SecretBox } from '../secrets.ts';
import { liveSmtpAccount } from '../sending/accounts.ts';
import type { OAuthConfig } from '../sending/oauth.ts';
import { suppress } from '../suppressions/service.ts';
import { QUOTA_REASON_PREFIX } from '../sending/mailboxes.ts';
import { workspaceDay } from './capacity.ts';

export interface SendDeps {
  smtp: SmtpTransport;
  secrets: SecretBox;
  jobs: JobQueue;
  storage: ObjectStorage;
  rng: Rng;
  now: () => Date;
  /** OAuth clients, for Google and Microsoft mailboxes' access tokens (§7.1). */
  oauth?: OAuthConfig | null;
}

/** Minutes between attempts after a temporary failure (§7.2 step 6). */
export const RETRY_MINUTES = [1, 5, 15, 60, 240];
/** A message in `sending` this long is assumed interrupted (§7.2 step 7). */
export const SENDING_TIMEOUT_MS = 10 * 60_000;

export type SendOutcome =
  | { outcome: 'sent' }
  | { outcome: 'deferred'; until: Date; reason: string }
  | { outcome: 'blocked'; reason: string }
  | { outcome: 'superseded' }
  | { outcome: 'retrying'; until: Date }
  | { outcome: 'failed'; reason: string }
  | { outcome: 'bounced' }
  | { outcome: 'skipped' };

type Gate = { pass: true; message: typeof messages.$inferSelect; mailbox: typeof mailboxes.$inferSelect; domain: string; contactEmail: string; kind: 'initial' | 'follow_up' | 'reply' } | { pass: false; result: SendOutcome };

const later = (now: Date, ms: number, rng: Rng) => new Date(now.getTime() + ms + Math.floor(rng() * 60_000));

/** A first email, a follow-up from a sequence, or a reply (which has no step). */
export async function kindOf(tx: Executor, message: Pick<typeof messages.$inferSelect, 'step_id'>): Promise<'initial' | 'follow_up' | 'reply'> {
  if (!message.step_id) return 'reply';
  const [step] = await tx.select({ sequence_id: campaign_steps.sequence_id }).from(campaign_steps).where(eq(campaign_steps.id, message.step_id));
  return step?.sequence_id ? 'follow_up' : 'initial';
}

/** Where the exact bytes sent are kept: written before SMTP, so an interrupted send still has them. */
export const rawKeyFor = (message: Pick<typeof messages.$inferSelect, 'workspace_id' | 'id'>) => `raw/${message.workspace_id}/${message.id}.eml`;

/** The pre-send guard (§7.2 step 5). Every check holds, or the message doesn't go. */
async function gate(tx: Executor, messageId: string, deps: SendDeps, now: Date): Promise<Gate> {
  const [message] = await tx.select().from(messages).where(eq(messages.id, messageId)).for('update');
  if (!message || message.status !== 'scheduled' || !message.thread_id) return { pass: false, result: { outcome: 'skipped' } };
  const [thread] = await tx.select().from(threads).where(eq(threads.id, message.thread_id)).for('update');
  const [mailbox] = await tx.select().from(mailboxes).where(eq(mailboxes.id, message.mailbox_id)).for('update');
  const [domain] = await tx.select().from(sending_domains).where(eq(sending_domains.id, mailbox!.sending_domain_id));
  const [contact] = await tx.select().from(contacts).where(eq(contacts.id, thread!.contact_id));
  const [campaign] = await tx.select({ status: campaigns.status }).from(campaigns).where(eq(campaigns.id, thread!.campaign_id));
  const kind = await kindOf(tx, message);

  const cancel = async (reason: string): Promise<Gate> => {
    await tx.update(messages).set({ status: 'cancelled', error: reason, updated_at: now }).where(eq(messages.id, messageId));
    await deps.jobs.enqueue('thread.evaluate', { thread_id: thread!.id }, { db: tx });
    return { pass: false, result: { outcome: 'blocked', reason } };
  };
  const defer = async (until: Date, reason: string): Promise<Gate> => {
    await tx.update(messages).set({ scheduled_for: until, updated_at: now }).where(eq(messages.id, messageId));
    await deps.jobs.enqueue('outbound.send', { message_id: messageId }, { db: tx, startAfter: until });
    return { pass: false, result: { outcome: 'deferred', until, reason } };
  };

  // The contact may be emailed: not suppressed, subscribed, not do-not-contact, address not dead (§8.6).
  if ((await suppressionsFor(tx, message.workspace_id, contact!.email)).length > 0) return cancel('suppressed');
  if (contact!.subscription_status !== 'subscribed') return cancel('unsubscribed');
  if (contact!.do_not_contact) return cancel('do_not_contact');
  if (contact!.email_verification === 'invalid' || contact!.email_verification === 'bounced') return cancel('bounced');
  if (contact!.deleted_at) return cancel('contact_deleted');

  // A newer reply arrived after this was written. A follow-up or first email is cancelled: the
  // reply stops the sequence (§5.10). A reply draft is superseded and redone with the reply in view.
  const [newer] = await tx
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.thread_id, thread!.id), eq(messages.direction, 'inbound'), gt(messages.created_at, message.created_at)))
    .limit(1);
  if (newer) {
    if (kind !== 'reply') {
      await tx.insert(activities).values({ id: newId('activity'), workspace_id: message.workspace_id, contact_id: thread!.contact_id, thread_id: thread!.id, campaign_id: thread!.campaign_id, type: 'follow_up.cancelled', actor_type: 'system', data: { message_id: messageId, reason: 'reply' }, occurred_at: now });
      return cancel('reply');
    }
    await tx.update(messages).set({ status: 'superseded', updated_at: now }).where(eq(messages.id, messageId));
    await deps.jobs.enqueue('thread.evaluate', { thread_id: thread!.id }, { db: tx });
    return { pass: false, result: { outcome: 'superseded' } };
  }
  // The thread is active, or a person approved this very message.
  if (thread!.state !== 'active' && !message.approved_at) return cancel(`thread_${thread!.state}`);

  // Campaign, mailbox and domain may send (§8.9): a Paused band sends replies only.
  if (kind !== 'reply' && campaign!.status !== 'active') return defer(later(now, 60 * 60_000, deps.rng), `campaign_${campaign!.status}`);
  if (mailbox!.status !== 'active') return defer(later(now, 60 * 60_000, deps.rng), 'mailbox_paused');
  if (kind !== 'reply' && (domain!.reputation_band === 'paused' || mailbox!.health_band === 'paused')) return defer(later(now, 60 * 60_000, deps.rng), 'domain_reputation');

  // One send at a time per mailbox, spaced apart, within the hourly cap (§8.3.4).
  const [inFlight] = await tx.select({ id: messages.id }).from(messages).where(and(eq(messages.mailbox_id, mailbox!.id), eq(messages.status, 'sending'), ne(messages.id, messageId))).limit(1);
  if (inFlight) return defer(later(now, 60_000, deps.rng), 'mailbox_busy');
  if (mailbox!.last_sent_at && now.getTime() - mailbox!.last_sent_at.getTime() < mailbox!.min_interval_sec * 1000) {
    return defer(later(mailbox!.last_sent_at, mailbox!.min_interval_sec * 1000, deps.rng), 'spacing');
  }
  const [hour] = await tx
    .select({ count: sql<number>`count(*)::int`, oldest: sql<Date | null>`min(${messages.sent_at})` })
    .from(messages)
    .where(and(eq(messages.mailbox_id, mailbox!.id), inArray(messages.status, ['sent', 'bounced']), gt(messages.sent_at, new Date(now.getTime() - 3_600_000))));
  if ((hour?.count ?? 0) >= mailbox!.hourly_limit) return defer(later(new Date(hour!.oldest!), 3_600_000, deps.rng), 'hourly_cap');

  // The idempotency gate: only one worker ever moves a message from scheduled to sending.
  await tx.update(messages).set({ status: 'sending', smtp_attempts: sql`${messages.smtp_attempts} + 1`, updated_at: now }).where(eq(messages.id, messageId));
  return { pass: true, message, mailbox: mailbox!, domain: domain!.domain, contactEmail: contact!.email, kind };
}

async function bumpStats(tx: Executor, mailboxId: string, day: string, column: 'sent' | 'new_threads' | 'replies_sent' | 'bounced_hard', by = 1): Promise<void> {
  await tx
    .insert(mailbox_daily_stats)
    .values({ mailbox_id: mailboxId, day, [column]: by })
    .onConflictDoUpdate({ target: [mailbox_daily_stats.mailbox_id, mailbox_daily_stats.day], set: { [column]: sql`coalesce(${mailbox_daily_stats[column]}, 0) + ${by}` } });
}

export async function sendMessage(db: Db, messageId: string, deps: SendDeps): Promise<SendOutcome> {
  const now = deps.now();
  const checked = await db.transaction((tx) => gate(tx, messageId, deps, now));
  if (!checked.pass) return checked.result;
  const { message, mailbox, kind } = checked;

  // Built at send time, so the Date header is right; the same bytes go to SMTP and to storage.
  const raw = await buildMime({
    from: { name: message.from_name ?? mailbox.display_name, email: mailbox.email },
    to: checked.contactEmail,
    subject: message.subject,
    text: message.body_text ?? '',
    html: message.body_html,
    messageId: message.message_id_header,
    inReplyTo: message.in_reply_to_header,
    references: message.references_headers,
    listUnsubscribe: listUnsubscribeFor(message.body_text ?? '', mailbox.email),
    date: now,
  });
  const rawKey = rawKeyFor(message);
  await deps.storage.put(rawKey, raw, 'message/rfc822');

  let result: SubmitResult;
  try {
    result = await deps.smtp.submit(await liveSmtpAccount(db, mailbox, deps.secrets, deps.oauth, now), { from: mailbox.email, to: checked.contactEmail }, raw);
  } catch (error) {
    result = { kind: 'temporary', response: error instanceof Error ? error.message : String(error) };
  }
  return db.transaction((tx) => record(tx, { message, mailbox, kind, rawKey, size: raw.length, result }, deps, deps.now()));
}

/** The List-Unsubscribe targets, found in the footer the composer wrote (§7.2, §8.8). */
function listUnsubscribeFor(body: string, mailboxEmail: string): { url: string; mailto: string } | null {
  const url = /https:\/\/[^\s]+\/u\/([A-Za-z0-9_-]+)/.exec(body);
  return url ? { url: url[0], mailto: `mailto:${mailboxEmail}?subject=unsubscribe%20${url[1]}` } : null;
}

/** Writes down what SMTP said, and everything that follows from it (§7.2 step 6). */
export async function record(
  tx: Executor,
  input: { message: typeof messages.$inferSelect; mailbox: typeof mailboxes.$inferSelect; kind: 'initial' | 'follow_up' | 'reply'; rawKey: string; size: number; result: SubmitResult },
  deps: SendDeps,
  now: Date,
): Promise<SendOutcome> {
  const { message, mailbox, result } = input;
  const threadId = message.thread_id!;
  const [thread] = await tx.select().from(threads).where(eq(threads.id, threadId));
  const [workspace] = await tx.select({ zone: workspaces.default_timezone }).from(workspaces).where(eq(workspaces.id, message.workspace_id));
  const { day } = workspaceDay(now, workspace?.zone ?? 'UTC');
  const log = (type: string, data: Record<string, unknown>) =>
    tx.insert(activities).values({ id: newId('activity'), workspace_id: message.workspace_id, contact_id: thread!.contact_id, thread_id: threadId, campaign_id: thread!.campaign_id, type, actor_type: 'system', data: { message_id: message.id, ...data }, occurred_at: now });
  const update = (patch: Partial<typeof messages.$inferInsert>) => tx.update(messages).set({ ...patch, smtp_response: result.response.slice(0, 1000), raw_storage_key: input.rawKey, size_bytes: input.size, updated_at: now }).where(eq(messages.id, message.id));
  const attempts = message.smtp_attempts + 1;

  switch (result.kind) {
    case 'accepted': {
      await update({ status: 'sent', sent_at: now, error: null });
      await tx.update(mailboxes).set({ last_sent_at: now }).where(eq(mailboxes.id, mailbox.id));
      await tx.update(contacts).set({ last_contacted_at: now }).where(eq(contacts.id, thread!.contact_id));
      if (input.kind === 'follow_up') await tx.update(threads).set({ follow_ups_sent: sql`${threads.follow_ups_sent} + 1` }).where(eq(threads.id, threadId));
      await bumpStats(tx, mailbox.id, day, 'sent');
      if (input.kind === 'initial') await bumpStats(tx, mailbox.id, day, 'new_threads');
      if (input.kind === 'reply') await bumpStats(tx, mailbox.id, day, 'replies_sent');
      await log('message.sent', { kind: input.kind });
      // The provider keeps no copy of SMTP submissions: Catalyst saves one (§7.2 step 8).
      if (mailbox.append_to_sent) await deps.jobs.enqueue('outbound.append_sent', { message_id: message.id }, { db: tx });
      // A person's own email can move the conversation; Jev reads it if it is set up (§10.4).
      if (message.author === 'human_app') await deps.jobs.enqueue('ai.classify_outbound', { message_id: message.id }, { db: tx });
      await deps.jobs.enqueue('thread.evaluate', { thread_id: threadId }, { db: tx });
      const [campaign] = await tx.select({ grace: campaigns.delivery_grace_minutes }).from(campaigns).where(eq(campaigns.id, thread!.campaign_id));
      // After the grace period with no bounce the email counts as received (§5.3, D3).
      await deps.jobs.enqueue('delivery.confirm', { thread_id: threadId, message_id: message.id }, { db: tx, startAfter: new Date(now.getTime() + (campaign!.grace + 1) * 60_000) });
      return { outcome: 'sent' };
    }
    case 'temporary': {
      if (attempts >= RETRY_MINUTES.length) return fail(`Gave up after ${attempts} attempts: ${result.response}`);
      const until = new Date(now.getTime() + RETRY_MINUTES[attempts - 1]! * 60_000);
      await update({ status: 'scheduled', scheduled_for: until, error: result.response.slice(0, 500) });
      await deps.jobs.enqueue('outbound.send', { message_id: message.id }, { db: tx, startAfter: until });
      return { outcome: 'retrying', until };
    }
    case 'quota': {
      // The provider is rate-limiting this mailbox: pause it until tomorrow and cut its limit (§7.2, §8.9).
      const until = new Date(now.getTime() + 24 * 3_600_000);
      await update({ status: 'scheduled', scheduled_for: until, error: result.response.slice(0, 500) });
      await tx
        .update(mailboxes)
        .set({ status: 'paused', status_reason: `${QUOTA_REASON_PREFIX} (${result.response.slice(0, 120)}); paused until tomorrow`, daily_limit: limitAfterQuotaError(mailbox.daily_limit), updated_at: now })
        .where(eq(mailboxes.id, mailbox.id));
      await tx.insert(activities).values({ id: newId('activity'), workspace_id: message.workspace_id, type: 'deliverability.breaker_tripped', actor_type: 'system', data: { mailbox_id: mailbox.id, signal: 'provider_quota', response: result.response.slice(0, 200) }, occurred_at: now });
      await deps.jobs.enqueue('outbound.send', { message_id: message.id }, { db: tx, startAfter: until });
      return { outcome: 'deferred', until, reason: 'provider_quota' };
    }
    case 'recipient_rejected': {
      // A synchronous 5.1.x is a hard bounce (§7.2, §7.5).
      await update({ status: 'bounced', sent_at: now, dsn_status: result.status, error: result.response.slice(0, 500) });
      const [contact] = await tx.select({ email: contacts.email }).from(contacts).where(eq(contacts.id, thread!.contact_id));
      await tx.update(contacts).set({ email_verification: 'bounced', updated_at: now }).where(eq(contacts.id, thread!.contact_id));
      await suppress(tx, message.workspace_id, { email: contact!.email, reason: 'hard_bounce', source: 'bounce', jobs: deps.jobs }, now);
      await bumpStats(tx, mailbox.id, day, 'sent');
      await bumpStats(tx, mailbox.id, day, 'bounced_hard');
      await log('message.bounced', { status: result.status, synchronous: true });
      await deps.jobs.enqueue('thread.evaluate', { thread_id: threadId }, { db: tx });
      return { outcome: 'bounced' };
    }
    case 'auth_failed': {
      const until = new Date(now.getTime() + 60 * 60_000);
      await update({ status: 'scheduled', scheduled_for: until, error: result.response.slice(0, 500) });
      await tx.update(mailboxes).set({ status: 'error', status_reason: `The mail server refused the credentials: ${result.response.slice(0, 150)}. Reconnect the mailbox.`, updated_at: now }).where(eq(mailboxes.id, mailbox.id));
      await deps.jobs.enqueue('outbound.send', { message_id: message.id }, { db: tx, startAfter: until });
      return { outcome: 'deferred', until, reason: 'mailbox_auth_failed' };
    }
    case 'rejected':
      return fail(`The mail server refused it: ${result.response}`);
  }

  async function fail(reason: string): Promise<SendOutcome> {
    await update({ status: 'failed', error: reason.slice(0, 500) });
    await log('message.failed', { reason: reason.slice(0, 200) });
    await raiseEscalation(tx, { workspaceId: message.workspace_id, threadId, reason: 'send_failure', title: 'An email could not be sent', explanation: reason.slice(0, 1000), triggerMessageId: message.id }, now);
    await deps.jobs.enqueue('thread.evaluate', { thread_id: threadId }, { db: tx });
    return { outcome: 'failed', reason };
  }
}

/** Marks emails stuck in `sending` as `send_unknown` and queues the Sent-folder check (§7.2 step 7). */
export async function sweepStuckSends(db: Db, deps: Pick<SendDeps, 'jobs'>, now: Date): Promise<number> {
  return db.transaction(async (tx) => {
    const stuck = await tx
      .update(messages)
      .set({ status: 'send_unknown', error: 'Sending was interrupted; it may or may not have gone out.', updated_at: now })
      .where(and(eq(messages.status, 'sending'), lt(messages.updated_at, new Date(now.getTime() - SENDING_TIMEOUT_MS))))
      .returning({ id: messages.id, workspace_id: messages.workspace_id, thread_id: messages.thread_id });
    // Each is looked for in the Sent folder before anything is sent again (§7.2 step 7).
    for (const message of stuck) await deps.jobs.enqueue('outbound.reconcile', { message_id: message.id }, { db: tx });
    return stuck.length;
  });
}
