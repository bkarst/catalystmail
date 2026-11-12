// Sending by hand (spec §13.4 "Threads & messages", §11.4 "Reply myself"): a person's reply as a
// draft or sent, drafts edited, approved, rejected or cancelled, and a thread's next email sent
// now. Every send still meets the pre-send checks of §7.2; a failed one answers 422 `send_blocked`
// with each reason, before anything is stored.

import { fitIntoWindow, intlZoneCalendar, type Rng, type SendingWindow, type ZoneContext } from '@catalyst/core';
import {
  activities,
  campaign_mailboxes,
  campaign_steps,
  campaigns,
  companies,
  contacts,
  escalations,
  mailboxes,
  messages,
  newId,
  sending_domains,
  suppressionsFor,
  threads,
  tracked_links,
  workspaces,
  type Db,
  type Executor,
} from '@catalyst/db';
import { messageIdFor, textToHtml, type LintFinding } from '@catalyst/email';
import type { JobQueue } from '@catalyst/jobs';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import type { Principal } from '../api/auth.ts';
import { ApiError, conflict, invalidField, notFound, type FieldError } from '../api/errors.ts';
import { assertFresh } from '../api/etag.ts';
import { decodeCursor, page } from '../api/pagination.ts';
import { disclosesAi } from '../agent/budget.ts';
import { vocabularyFor } from '../campaigns/emails.ts';
import { buildContext, finishBody, lintBody } from '../campaigns/render.ts';
import { openToken, unsubscribeToken } from '../public/tracking.ts';
import { actorOf } from '../shared.ts';
import { evaluateThread } from '../threads/evaluate.ts';
import { getThread, serializeMessage } from '../threads/service.ts';
import { followUpRoom, initialRoom, loadCapacity, pickMailbox, replyRoom } from './capacity.ts';
import { planTrackedLinks, saveTrackedLinks, type LinkPlan } from './links.ts';
import { composeNext } from './compose.ts';
import { kindOf } from './send.ts';

export interface ManualDeps {
  jobs: JobQueue;
  rng: Rng;
  trackingSecret: string | null;
  appHost: string | null;
  now: Date;
}

type MessageRow = typeof messages.$inferSelect;
type ThreadRow = typeof threads.$inferSelect;
type Reason = 'suppressed' | 'unsubscribed' | 'bounced' | 'do_not_contact' | 'outside_window' | 'cap_reached' | 'lint_blocker' | 'mailbox_paused' | 'thread_terminal';
interface Blocker {
  reason: Reason;
  message: string;
}

/** 422 `send_blocked`, naming every check that failed (§13.3). */
function sendBlocked(blockers: Blocker[]): ApiError {
  const errors: FieldError[] = blockers.map((blocker) => ({ path: 'message', message: blocker.message, reason: blocker.reason }));
  return new ApiError(422, 'send_blocked', blockers.map((blocker) => blocker.message).join(' '), errors);
}

/** Statuses an email can still be changed or stopped in: nothing has gone to the mail server. */
const UNSENT = ['draft', 'pending_approval', 'scheduled'] as const;
const DRAFTS = ['draft', 'pending_approval'] as const;
/** Threads where nothing more may be sent, whoever writes it. */
const CLOSED_FOR_GOOD = ['bounced', 'unsubscribed'];

function requireSendScope(principal: Principal): void {
  if (!principal.scopes.includes('messages:send')) throw new ApiError(403, 'forbidden_scope', 'Sending needs the `messages:send` scope; without it, save the reply as a draft.');
}

/** What every send check needs about a thread, loaded once. */
export async function sendingContext(tx: Executor, thread: ThreadRow) {
  const [contact] = await tx.select().from(contacts).where(eq(contacts.id, thread.contact_id));
  const [campaign] = await tx.select().from(campaigns).where(eq(campaigns.id, thread.campaign_id));
  const [workspace] = await tx.select().from(workspaces).where(eq(workspaces.id, thread.workspace_id));
  const [mailbox] = thread.mailbox_id ? await tx.select().from(mailboxes).where(eq(mailboxes.id, thread.mailbox_id)) : [];
  const window = campaign!.sending_window as SendingWindow & { fallback_tz?: string };
  const zone: ZoneContext = { zone: contact!.timezone ?? window.fallback_tz ?? workspace!.default_timezone, blackoutDates: campaign!.blackout_dates, calendar: intlZoneCalendar };
  return { contact: contact!, campaign: campaign!, workspace: workspace!, mailbox: mailbox ?? null, window, zone };
}
export type SendingContext = Awaited<ReturnType<typeof sendingContext>>;

/** The recipient and mailbox checks of the pre-send guard (§7.2 step 5), plus lint blockers. */
export async function blockersFor(tx: Executor, thread: ThreadRow, context: SendingContext, lint: LintFinding[] | null): Promise<Blocker[]> {
  const { contact, mailbox } = context;
  const blockers: Blocker[] = [];
  if ((await suppressionsFor(tx, thread.workspace_id, contact.email)).length > 0) blockers.push({ reason: 'suppressed', message: `${contact.email} is on the suppression list.` });
  if (contact.subscription_status !== 'subscribed') blockers.push({ reason: 'unsubscribed', message: `${contact.email} has unsubscribed.` });
  if (contact.do_not_contact) blockers.push({ reason: 'do_not_contact', message: 'The contact is marked do-not-contact.' });
  if (contact.email_verification === 'invalid' || contact.email_verification === 'bounced') blockers.push({ reason: 'bounced', message: `${contact.email} bounces.` });
  if (CLOSED_FOR_GOOD.includes(thread.state)) blockers.push({ reason: 'thread_terminal', message: `The thread is ${thread.state}.` });
  if (!mailbox || mailbox.status !== 'active') blockers.push({ reason: 'mailbox_paused', message: mailbox ? `The mailbox ${mailbox.email} is ${mailbox.status}.` : 'The thread has no mailbox yet.' });
  for (const finding of lint ?? []) if (finding.severity === 'blocker') blockers.push({ reason: 'lint_blocker', message: finding.message });
  return blockers;
}

/** "Re: " and the thread's subject, In-Reply-To the latest message, References the chain (§7.2). */
async function threading(tx: Executor, thread: ThreadRow) {
  const earlier = await tx
    .select({ header: messages.message_id_header })
    .from(messages)
    .where(and(eq(messages.thread_id, thread.id), inArray(messages.status, ['sent', 'received', 'bounced'])))
    .orderBy(sql`coalesce(${messages.sent_at}, ${messages.received_at}, ${messages.created_at})`);
  const references = earlier.map((entry) => entry.header).slice(-20);
  return { subject: `Re: ${thread.subject ?? '(no subject)'}`, inReplyTo: references.at(-1) ?? null, references };
}

/**
 * Composed emails and AI drafts waiting on the thread yield to a person's reply: they were written
 * before it. Evaluation times the sequence again from the reply.
 */
export async function supersedeWaiting(tx: Executor, threadId: string, exceptId: string, now: Date): Promise<number> {
  const rows = await tx
    .update(messages)
    .set({ status: 'superseded', updated_at: now })
    .where(and(eq(messages.thread_id, threadId), eq(messages.direction, 'outbound'), inArray(messages.status, [...UNSENT]), sql`${messages.id} <> ${exceptId}`, sql`${messages.author} in ('ai', 'template')`))
    .returning({ id: messages.id });
  if (rows.length > 0) await tx.update(threads).set({ next_action_message_id: null, updated_at: now }).where(and(eq(threads.id, threadId), inArray(threads.next_action_message_id, rows.map((row) => row.id))));
  return rows.length;
}

/** A person answered: an escalation asking them to reply is done (§11.1). */
async function resolveReplyEscalations(tx: Executor, principal: Principal, threadId: string, now: Date): Promise<void> {
  await tx
    .update(escalations)
    .set({ status: 'resolved', resolution: 'replied', resolved_by: principal.kind === 'user' ? principal.id : null, resolved_at: now, updated_at: now })
    .where(and(eq(escalations.thread_id, threadId), eq(escalations.reason, 'ai_unavailable'), inArray(escalations.status, ['open', 'snoozed'])));
}

async function logActivity(tx: Executor, principal: Principal, thread: ThreadRow, type: string, data: Record<string, unknown>, now: Date): Promise<void> {
  await tx.insert(activities).values({ id: newId('activity'), workspace_id: thread.workspace_id, contact_id: thread.contact_id, thread_id: thread.id, campaign_id: thread.campaign_id, type, ...actorOf(principal), data, occurred_at: now });
}

/** When a send asked for `at` goes out: then or later, inside the window, never in the past. */
export function sendTime(at: string | undefined, context: SendingContext, now: Date): Date {
  const wanted = at ? new Date(Math.max(new Date(at).getTime(), now.getTime())) : now;
  return fitIntoWindow(wanted, context.window, context.zone);
}

async function evaluateAfter(db: Db, jobs: JobQueue, threadId: string, now: Date): Promise<void> {
  try {
    await evaluateThread(db, threadId, { now });
  } catch (error) {
    console.error(`[messages] evaluating ${threadId} inline failed; queued instead`, error);
    await jobs.enqueue('thread.evaluate', { thread_id: threadId });
  }
}

async function lockedThread(tx: Executor, workspaceId: string, threadId: string): Promise<ThreadRow> {
  const [thread] = await tx.select().from(threads).where(and(eq(threads.id, threadId), eq(threads.workspace_id, workspaceId))).for('update');
  if (!thread) throw notFound('The thread');
  return thread;
}

async function lockedMessage(tx: Executor, workspaceId: string, messageId: string): Promise<{ message: MessageRow; thread: ThreadRow }> {
  const [message] = await tx.select().from(messages).where(and(eq(messages.id, messageId), eq(messages.workspace_id, workspaceId))).for('update');
  if (!message) throw notFound('The email');
  if (message.direction !== 'outbound' || !message.thread_id) throw conflict('Only an outbound email in a thread can be changed.');
  const thread = await lockedThread(tx, workspaceId, message.thread_id);
  return { message, thread };
}

// ── createReply ─────────────────────────────────────────────────────────────────────────────────

export interface ReplyInput {
  body_text: string;
  mode: 'draft' | 'send_now' | 'schedule';
  send_at?: string | undefined;
}

/** A reply composed but not stored: the finished body, its threading, tracking and lint. */
export interface PreparedReply {
  id: string;
  thread: ThreadRow;
  context: SendingContext;
  subject: string;
  inReplyTo: string | null;
  references: string[];
  bodyText: string;
  html: string;
  links: LinkPlan;
  pixel: string | null;
  headerId: string;
  lint: LintFinding[];
  /** The text as written, before signature and footer, for the snippet. */
  written: string;
}

/**
 * Builds a reply the way the composer builds any email (§7.2 step 4): the text, then the
 * signature and the compliance footer, threaded under the conversation, linted, with the pixel
 * when the campaign tracks opens. Used by people (createReply) and by the agent (§10.6).
 */
export async function prepareReply(tx: Executor, thread: ThreadRow, written: string, deps: Pick<ManualDeps, 'trackingSecret' | 'appHost'>, options: { aiWritten?: boolean } = {}): Promise<PreparedReply> {
  const context = await sendingContext(tx, thread);
  const { campaign, contact, workspace, mailbox } = context;
  const [domain] = await tx.select().from(sending_domains).where(eq(sending_domains.id, mailbox!.sending_domain_id));
  const [company] = contact.company_id ? await tx.select().from(companies).where(eq(companies.id, contact.company_id)) : [];
  const id = newId('message');
  const host = domain!.tracking_host ?? deps.appHost;
  const unsubscribe = deps.trackingSecret && host ? unsubscribeToken(id, deps.trackingSecret) : null;
  const vocabulary = await vocabularyFor(tx, campaign);
  const campaignData = {
    name: campaign.name,
    links: campaign.links as Record<string, string>,
    persona: campaign.persona as { sender_role?: string | null },
    unsubscribe_footer: campaign.unsubscribe_footer && unsubscribe !== null,
    list_unsubscribe_header: campaign.list_unsubscribe_header && unsubscribe !== null,
  };
  const templateContext = buildContext(
    { contact, company: company ? { name: company.name, domain: company.domain, custom_fields: company.custom_fields } : null },
    { display_name: mailbox!.display_name, signature_text: mailbox!.signature_text },
    campaignData,
    workspace,
    unsubscribe ? `https://${host}/u/${unsubscribe}` : '',
    vocabulary,
  );
  const { subject, inReplyTo, references } = await threading(tx, thread);
  const bodyText = finishBody(written, templateContext, vocabulary, { unsubscribe_footer: campaign.unsubscribe_footer }, { aiDisclosure: Boolean(options.aiWritten) && disclosesAi(workspace.settings) });
  const lint = lintBody({ subject, bodyText, isFirstTouch: false, campaign: { unsubscribe_footer: campaign.unsubscribe_footer, list_unsubscribe_header: campaignData.list_unsubscribe_header }, physicalAddress: workspace.physical_address });
  const tracked = campaign.open_tracking && domain!.tracking_host !== null && deps.trackingSecret !== null;
  const pixel = tracked ? openToken(id, deps.trackingSecret!) : null;
  const links = planTrackedLinks(id, bodyText, { enabled: campaign.click_tracking, host: domain!.tracking_host, secret: deps.trackingSecret, links: campaign.links as Record<string, string> });
  return {
    id,
    thread,
    context,
    subject,
    inReplyTo,
    references,
    bodyText,
    html: textToHtml(bodyText, { pixelUrl: pixel ? `https://${domain!.tracking_host}/t/o/${pixel}.gif` : null, href: links.href }),
    links,
    pixel,
    headerId: messageIdFor(id, domain!.domain),
    lint,
    written,
  };
}

/** Stores a prepared reply with its status. */
export async function insertReply(
  tx: Executor,
  prepared: PreparedReply,
  fields: { status: MessageRow['status']; author: MessageRow['author']; scheduledFor: Date | null; approvedAt?: Date | null; approvedBy?: string | null; aiRunId?: string | null; goalId?: string | null; stepId?: string | null },
  now: Date,
): Promise<MessageRow> {
  const { thread, context } = prepared;
  const [created] = await tx
    .insert(messages)
    .values({
      id: prepared.id,
      workspace_id: thread.workspace_id,
      thread_id: thread.id,
      mailbox_id: context.mailbox!.id,
      direction: 'outbound',
      status: fields.status,
      author: fields.author,
      goal_id: fields.goalId ?? null,
      step_id: fields.stepId ?? null,
      message_id_header: prepared.headerId,
      in_reply_to_header: prepared.inReplyTo,
      references_headers: prepared.references,
      from_email: context.mailbox!.email,
      from_name: context.mailbox!.display_name,
      to_emails: [context.contact.email],
      subject: prepared.subject,
      body_text: prepared.bodyText,
      body_html: prepared.html,
      snippet: prepared.written.replace(/\s+/g, ' ').slice(0, 140),
      scheduled_for: fields.scheduledFor,
      tracking_token: prepared.pixel,
      lint_report: prepared.lint,
      approved_at: fields.approvedAt ?? null,
      approved_by: fields.approvedBy ?? null,
      ai_run_id: fields.aiRunId ?? null,
      created_at: now,
      updated_at: now,
    })
    .returning();
  await saveTrackedLinks(tx, prepared.links);
  return created!;
}

/**
 * External agent mode (§10.7): while a follow-up step or check-in waits for the campaign's own
 * agent (`awaiting_agent`), the reply it writes is that email, so the sequence moves on as if the
 * composer had written it.
 */
async function awaitedEmail(tx: Executor, thread: ThreadRow): Promise<{ stepId: string | null; checkIn: boolean } | null> {
  if (thread.throttle_reason !== 'awaiting_agent' || thread.next_action_type !== 'send_follow_up' || thread.next_action_message_id) return null;
  if (thread.check_in_at && thread.follow_up_sequence_id === null) return { stepId: null, checkIn: true };
  const [step] = await tx
    .select({ id: campaign_steps.id })
    .from(campaign_steps)
    .where(and(eq(campaign_steps.sequence_id, thread.follow_up_sequence_id ?? ''), eq(campaign_steps.position, thread.follow_up_step_position ?? 0)));
  return step ? { stepId: step.id, checkIn: false } : null;
}

export async function createReply(db: Db, principal: Principal, threadId: string, input: ReplyInput, idempotencyKey: string | null, deps: ManualDeps) {
  const { now } = deps;
  const sending = input.mode !== 'draft';
  if (sending) {
    requireSendScope(principal);
    if (!idempotencyKey) throw invalidField('header.Idempotency-Key', 'Sending needs an Idempotency-Key header, so a retried request never sends twice.');
  }
  if (input.mode === 'schedule' && !input.send_at) throw invalidField('body.send_at', 'Give `send_at` when `mode` is `schedule`.');

  const row = await db.transaction(async (tx) => {
    const thread = await lockedThread(tx, principal.workspace.id, threadId);
    if (CLOSED_FOR_GOOD.includes(thread.state)) throw new ApiError(409, 'thread_terminal', `The thread is ${thread.state}; nothing more can be sent on it.`);
    if (!thread.mailbox_id || !thread.subject) throw conflict('Nothing has been sent on this thread yet, so there is nothing to reply to. Its first email goes out on schedule, or use sendNextActionNow.');
    const prepared = await prepareReply(tx, thread, input.body_text, deps);
    const { context } = prepared;
    const awaited = await awaitedEmail(tx, thread);

    let scheduledFor: Date | null = null;
    if (sending) {
      const blockers = await blockersFor(tx, thread, context, prepared.lint);
      scheduledFor = sendTime(input.send_at, context, now);
      // "Send now" has to be sendable now; a scheduled reply moves into the window instead (§13.5).
      if (input.mode === 'send_now' && scheduledFor.getTime() > now.getTime()) {
        blockers.push({ reason: 'outside_window', message: `It is outside the campaign’s sending window for ${context.contact.email}; the window next opens at ${scheduledFor.toISOString()}. Schedule it instead.` });
      }
      const capacity = await loadCapacity(tx, thread.workspace_id, now);
      if (replyRoom(capacity, context.mailbox!.id) <= 0) blockers.push({ reason: 'cap_reached', message: `${context.mailbox!.email} has sent all it may today, replies included.` });
      if (blockers.length > 0) throw sendBlocked(blockers);
    }

    const created = await insertReply(
      tx,
      prepared,
      // Writing and sending it is the person's approval (§7.2 step 5).
      { status: sending ? 'scheduled' : 'draft', author: 'human_app', scheduledFor, stepId: awaited?.stepId ?? null, ...(sending && { approvedAt: now, approvedBy: principal.kind === 'user' ? principal.id : null }) },
      now,
    );
    // A written check-in clears it, as when the agent writes one.
    if (awaited?.checkIn) await tx.update(threads).set({ check_in_at: null, check_in_set_at: null, follow_ups_not_before: scheduledFor ?? now, updated_at: now }).where(eq(threads.id, thread.id));
    const superseded = await supersedeWaiting(tx, thread.id, prepared.id, now);
    if (sending) {
      await resolveReplyEscalations(tx, principal, thread.id, now);
      await deps.jobs.enqueue('outbound.send', { message_id: prepared.id }, { db: tx, startAfter: scheduledFor! });
    }
    await logActivity(tx, principal, thread, sending ? 'message.scheduled' : 'message.composed', { message_id: prepared.id, by_hand: true, scheduled_for: scheduledFor?.toISOString() ?? null, superseded }, now);
    return created;
  });
  await evaluateAfter(db, deps.jobs, threadId, now);
  return serializeMessage(row);
}

// ── Drafts ──────────────────────────────────────────────────────────────────────────────────────

export async function listPendingDrafts(
  db: Db,
  workspaceId: string,
  query: { limit: number; cursor?: string | undefined; campaign_id?: string | undefined; thread_id?: string | undefined; status?: 'draft' | 'pending_approval' | undefined },
) {
  const where = [eq(messages.workspace_id, workspaceId), eq(messages.direction, 'outbound'), query.status ? eq(messages.status, query.status) : inArray(messages.status, [...DRAFTS])];
  if (query.thread_id) where.push(eq(messages.thread_id, query.thread_id));
  if (query.campaign_id) where.push(sql`${messages.thread_id} in (select id from threads where campaign_id = ${query.campaign_id})`);
  if (query.cursor) {
    const cursorId = decodeCursor(query.cursor, 'created_at');
    where.push(sql`(${messages.created_at}, ${messages.id}) > (select created_at, id from messages where id = ${cursorId})`);
  }
  const rows = await db.select().from(messages).where(and(...where)).orderBy(asc(messages.created_at), asc(messages.id)).limit(query.limit + 1);
  const { rows: kept, next_cursor } = page(rows, query.limit, 'created_at');
  return { data: kept.map(serializeMessage), next_cursor };
}

export async function updateDraft(db: Db, principal: Principal, messageId: string, input: { body_text?: string | undefined; subject?: string | undefined }, ifMatch: string | null, now: Date, trackingSecret: string | null = null) {
  const row = await db.transaction(async (tx) => {
    const { message, thread } = await lockedMessage(tx, principal.workspace.id, messageId);
    assertFresh({ id: message.id, updated_at: message.updated_at.toISOString() }, ifMatch);
    if (!(UNSENT as readonly string[]).includes(message.status)) throw conflict(`This email is ${message.status}; only a draft, one waiting for approval, or a scheduled one can be edited.`);
    const isReply = message.in_reply_to_header !== null;
    if (input.subject !== undefined && isReply) throw invalidField('body.subject', 'A reply keeps "Re: " and the thread’s subject.');
    const context = await sendingContext(tx, thread);
    const bodyText = input.body_text ?? message.body_text ?? '';
    const subject = input.subject ?? message.subject;
    const kind = await kindOf(tx, message);
    const lint = lintBody({ subject, bodyText, isFirstTouch: kind === 'initial', campaign: context.campaign, physicalAddress: context.workspace.physical_address });
    // The tracking pixel, if any, stays as it was.
    const pixelUrl = message.tracking_token ? (/https:\/\/[^"\s]+\/t\/o\/[A-Za-z0-9_-]+\.gif/.exec(message.body_html ?? '')?.[0] ?? null) : null;
    // Its links are tracked afresh for the new text (§9.3).
    const [domain] = await tx.select({ host: sending_domains.tracking_host }).from(sending_domains).innerJoin(mailboxes, eq(mailboxes.sending_domain_id, sending_domains.id)).where(eq(mailboxes.id, message.mailbox_id));
    await tx.delete(tracked_links).where(eq(tracked_links.message_id, message.id));
    const links = planTrackedLinks(message.id, bodyText, { enabled: context.campaign.click_tracking, host: domain?.host ?? null, secret: trackingSecret, links: context.campaign.links as Record<string, string> });
    await saveTrackedLinks(tx, links);
    const [updated] = await tx
      .update(messages)
      .set({
        body_text: bodyText,
        subject,
        body_html: textToHtml(bodyText, { pixelUrl, href: links.href }),
        snippet: bodyText.replace(/\s+/g, ' ').slice(0, 140),
        lint_report: lint,
        updated_at: now,
      })
      .where(eq(messages.id, message.id))
      .returning();
    await logActivity(tx, principal, thread, 'message.edited', { message_id: message.id, fields: Object.keys(input) }, now);
    return updated!;
  });
  return serializeMessage(row);
}

/** For a step's email, stopping it is skipping the step, so the sequence moves on instead of writing it again (§5.6). */
async function stopStep(tx: Executor, principal: Principal, message: MessageRow, thread: ThreadRow, now: Date): Promise<void> {
  if (!message.step_id) return;
  const [step] = await tx.select().from(campaign_steps).where(eq(campaign_steps.id, message.step_id));
  if (step?.sequence_id) {
    await logActivity(tx, principal, thread, 'follow_up.skipped', { sequence_id: step.sequence_id, step_position: step.position, message_id: message.id }, now);
  } else {
    // The first email: hold the thread, or the scheduler would write it again on its next tick.
    await tx.update(threads).set({ manually_paused: true, updated_at: now }).where(eq(threads.id, thread.id));
    await logActivity(tx, principal, thread, 'thread.paused', { reason: 'first_email_stopped', message_id: message.id }, now);
  }
}

export async function approveDraft(db: Db, principal: Principal, messageId: string, input: { send_at?: string | undefined }, deps: ManualDeps) {
  const { now } = deps;
  const { row, threadId } = await db.transaction(async (tx) => {
    const { message, thread } = await lockedMessage(tx, principal.workspace.id, messageId);
    if (!(DRAFTS as readonly string[]).includes(message.status)) throw conflict(`This email is ${message.status}; only a draft or one waiting for approval can be approved.`);
    const context = await sendingContext(tx, thread);
    const blockers = await blockersFor(tx, thread, context, message.lint_report as LintFinding[] | null);
    const kind = await kindOf(tx, message);
    const capacity = await loadCapacity(tx, thread.workspace_id, now);
    const room = kind === 'reply' ? replyRoom(capacity, message.mailbox_id) : kind === 'follow_up' ? followUpRoom(capacity, message.mailbox_id) : initialRoom(capacity, thread.campaign_id, message.mailbox_id);
    if (room <= 0) blockers.push({ reason: 'cap_reached', message: 'The mailbox has no room left today for this email.' });
    if (blockers.length > 0) throw sendBlocked(blockers);
    // Approving at night queues it for the next window opening.
    const scheduledFor = sendTime(input.send_at, context, now);
    const [updated] = await tx
      .update(messages)
      .set({ status: 'scheduled', scheduled_for: scheduledFor, approved_at: now, approved_by: principal.kind === 'user' ? principal.id : null, updated_at: now })
      .where(eq(messages.id, message.id))
      .returning();
    if (message.author === 'human_app') await supersedeWaiting(tx, thread.id, message.id, now);
    if (kind === 'reply') await resolveReplyEscalations(tx, principal, thread.id, now);
    await deps.jobs.enqueue('outbound.send', { message_id: message.id }, { db: tx, startAfter: scheduledFor });
    await logActivity(tx, principal, thread, 'message.approved', { message_id: message.id, scheduled_for: scheduledFor.toISOString() }, now);
    return { row: updated!, threadId: thread.id };
  });
  await evaluateAfter(db, deps.jobs, threadId, now);
  return serializeMessage(row);
}

export async function rejectDraft(db: Db, principal: Principal, messageId: string, input: { reason: string; feedback?: string | undefined }, deps: Pick<ManualDeps, 'jobs' | 'now'>) {
  const { now } = deps;
  const { row, threadId } = await db.transaction(async (tx) => {
    const { message, thread } = await lockedMessage(tx, principal.workspace.id, messageId);
    if (!(DRAFTS as readonly string[]).includes(message.status)) throw conflict(`This email is ${message.status}; only a draft or one waiting for approval can be rejected.`);
    const [updated] = await tx.update(messages).set({ status: 'cancelled', error: `Rejected: ${input.reason}`.slice(0, 500), updated_at: now }).where(eq(messages.id, message.id)).returning();
    await stopStep(tx, principal, message, thread, now);
    await logActivity(tx, principal, thread, 'message.rejected', { message_id: message.id, reason: input.reason, feedback: input.feedback ?? null }, now);
    return { row: updated!, threadId: thread.id };
  });
  await evaluateAfter(db, deps.jobs, threadId, now);
  return serializeMessage(row);
}

export async function cancelScheduledMessage(db: Db, principal: Principal, messageId: string, deps: Pick<ManualDeps, 'jobs' | 'now'>) {
  const { now } = deps;
  const { row, threadId } = await db.transaction(async (tx) => {
    const { message, thread } = await lockedMessage(tx, principal.workspace.id, messageId);
    if (!(UNSENT as readonly string[]).includes(message.status)) throw conflict(`This email is ${message.status}; it can no longer be cancelled.`);
    // The pre-send guard only sends `scheduled` emails, so the queued send job finds nothing to do.
    const [updated] = await tx.update(messages).set({ status: 'cancelled', error: 'Cancelled by hand.', updated_at: now }).where(eq(messages.id, message.id)).returning();
    await stopStep(tx, principal, message, thread, now);
    await logActivity(tx, principal, thread, 'message.cancelled', { message_id: message.id, was: message.status }, now);
    return { row: updated!, threadId: thread.id };
  });
  await evaluateAfter(db, deps.jobs, threadId, now);
  return serializeMessage(row);
}

// ── lintMessage ─────────────────────────────────────────────────────────────────────────────────

/** The content linter on free text (§8.7), against the workspace's own physical address. */
export async function lintText(db: Db, workspaceId: string, input: { subject: string; body_text: string; first_touch: boolean; compliance_required: boolean }) {
  const [workspace] = await db.select({ physical_address: workspaces.physical_address }).from(workspaces).where(eq(workspaces.id, workspaceId));
  const findings = lintBody({
    subject: input.subject,
    bodyText: input.body_text,
    isFirstTouch: input.first_touch,
    campaign: { unsubscribe_footer: input.compliance_required, list_unsubscribe_header: false },
    physicalAddress: workspace?.physical_address ?? '',
  });
  return { findings, sendable: !findings.some((finding) => finding.severity === 'blocker') };
}

// ── sendNextActionNow ───────────────────────────────────────────────────────────────────────────

export async function sendNextActionNow(db: Db, principal: Principal, threadId: string, deps: ManualDeps) {
  const { now } = deps;
  await db.transaction(async (tx) => {
    // Locked in the pre-send guard's order, email before thread, so the two can't deadlock.
    const [peek] = await tx.select({ messageId: threads.next_action_message_id }).from(threads).where(and(eq(threads.id, threadId), eq(threads.workspace_id, principal.workspace.id)));
    if (peek?.messageId) await tx.select({ id: messages.id }).from(messages).where(eq(messages.id, peek.messageId)).for('update');
    const thread = await lockedThread(tx, principal.workspace.id, threadId);
    if (thread.next_action_type !== 'send_initial' && thread.next_action_type !== 'send_follow_up') {
      throw conflict(`The thread’s next action is ${thread.next_action_type}, not an email.`);
    }
    if (thread.state !== 'active') throw conflict(`The thread is ${thread.state}; resume it first.`);
    const context = await sendingContext(tx, thread);
    if (context.campaign.status !== 'active') throw conflict(`The campaign is ${context.campaign.status}.`);
    const blockers: Blocker[] = [];
    if (fitIntoWindow(now, context.window, context.zone).getTime() > now.getTime()) blockers.push({ reason: 'outside_window', message: `It is outside the campaign’s sending window for ${context.contact.email}.` });

    // Already written: move it up.
    if (thread.next_action_message_id) {
      const [message] = await tx.select().from(messages).where(eq(messages.id, thread.next_action_message_id));
      if (message && message.status === 'scheduled') {
        blockers.push(...(await blockersFor(tx, thread, context, message.lint_report as LintFinding[] | null)));
        if (blockers.length > 0) throw sendBlocked(blockers);
        await tx.update(messages).set({ scheduled_for: now, updated_at: now }).where(eq(messages.id, message.id));
        await tx.update(threads).set({ next_action_at: now, updated_at: now }).where(eq(threads.id, thread.id));
        await deps.jobs.enqueue('outbound.send', { message_id: message.id }, { db: tx, startAfter: now });
        await logActivity(tx, principal, thread, 'message.scheduled', { message_id: message.id, scheduled_for: now.toISOString(), by_hand: true }, now);
        return;
      }
      throw conflict(`The next email is ${message?.status ?? 'missing'}; approve it instead (approveDraft).`);
    }

    // Not written yet: pick its mailbox (a new thread's first send) and compose it now.
    const capacity = await loadCapacity(tx, thread.workspace_id, now);
    let mailboxId = thread.mailbox_id;
    if (!mailboxId) {
      const candidates = await tx
        .select({ mailboxId: campaign_mailboxes.mailbox_id, weight: campaign_mailboxes.weight })
        .from(campaign_mailboxes)
        .innerJoin(mailboxes, eq(mailboxes.id, campaign_mailboxes.mailbox_id))
        .where(and(eq(campaign_mailboxes.campaign_id, thread.campaign_id), eq(mailboxes.status, 'active')));
      const picked = pickMailbox(capacity, thread.campaign_id, candidates);
      if ('limitedBy' in picked) blockers.push({ reason: 'cap_reached', message: `No mailbox of the campaign has room for a first email today (${picked.limitedBy}).` });
      else mailboxId = picked.mailboxId;
    } else if (thread.next_action_type === 'send_follow_up' && followUpRoom(capacity, mailboxId) <= 0) {
      blockers.push({ reason: 'cap_reached', message: 'The mailbox has no room left for follow-ups today.' });
    }
    const [mailbox] = mailboxId ? await tx.select().from(mailboxes).where(eq(mailboxes.id, mailboxId)) : [];
    blockers.push(...(await blockersFor(tx, thread, { ...context, mailbox: mailbox ?? null }, null)).filter((blocker) => blocker.reason !== 'mailbox_paused' || mailboxId !== null));
    if (blockers.length > 0) throw sendBlocked(blockers);

    const result = await composeNext(tx, { threadId: thread.id, mailboxId: mailboxId!, scheduledFor: now }, { jobs: deps.jobs, rng: deps.rng, trackingSecret: deps.trackingSecret, appHost: deps.appHost, now });
    if (result.status === 'escalated') {
      if (result.reason === 'ai_unavailable') throw conflict('This step is written by the AI agent, which isn’t connected yet; an escalation asks a person to write it.');
      throw sendBlocked([{ reason: 'lint_blocker', message: 'The email failed its checks; an escalation explains why.' }]);
    }
    if (result.status === 'skipped') throw conflict(`Nothing to send now: ${result.why}.`);
  });
  await evaluateAfter(db, deps.jobs, threadId, now);
  return getThread(db, principal.workspace.id, threadId);
}
