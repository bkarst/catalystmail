// Ingesting one email from a mailbox (spec §7.3–§7.6): match it to a thread, classify it
// deterministically, store it, and act on what it is. Polling calls this for each new message.

import { createHash } from 'node:crypto';

import {
  activities,
  attachments,
  campaigns,
  contacts,
  emailDomain,
  mailbox_daily_stats,
  mailboxes,
  messages,
  newId,
  thread_participants,
  threads,
  workspaces,
  type Db,
  type Executor,
} from '@catalyst/db';
import { classifyDeterministically, matchInbound, originalMessageId, parseEmail, type ParsedEmail } from '@catalyst/email';
import type { JobQueue } from '@catalyst/jobs';
import type { ObjectStorage } from '@catalyst/storage';
import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';

import { unsubscribeContact } from '../contacts/unsubscribe.ts';
import { raiseEscalation } from '../escalations/raise.ts';
import { workspaceDay } from '../outbound/capacity.ts';
import { suppress } from '../suppressions/service.ts';

export type Folder = 'inbox' | 'junk' | 'sent';

export interface IngestInput {
  mailboxId: string;
  folder: Folder;
  raw: Buffer;
  /** IMAP UID and INTERNALDATE, when it came from a poll. */
  uid?: number;
  internalDate?: Date | null;
}

export interface IngestDeps {
  jobs: JobQueue;
  storage: ObjectStorage;
  now: Date;
  /** The AI agent is on: human replies go to it (`ai.process_inbound`) instead of straight to a person. */
  ai?: boolean;
}

export type IngestOutcome =
  | { outcome: 'duplicate' }
  | { outcome: 'ignored' }
  | { outcome: 'stored'; messageId: string; threadId: string | null; kind: string };

/** Soft bounces within this many days that add up to a hard bounce (§7.5). */
const SOFT_BOUNCE_DAYS = 14;
const SOFT_BOUNCES_FOR_HARD = 3;

const syntheticId = (raw: Buffer) => `<${createHash('sha256').update(raw).digest('hex').slice(0, 32)}@no-message-id.invalid>`;

async function threadByMessageIds(db: Executor, workspaceId: string, ids: string[]): Promise<string | null> {
  if (ids.length === 0) return null;
  const [row] = await db
    .select({ thread_id: messages.thread_id })
    .from(messages)
    .where(and(eq(messages.workspace_id, workspaceId), inArray(messages.message_id_header, ids), sql`${messages.thread_id} is not null`))
    .orderBy(desc(messages.created_at))
    .limit(1);
  return row?.thread_id ?? null;
}

async function bumpStats(db: Executor, mailboxId: string, day: string, column: 'bounced_hard' | 'bounced_soft' | 'complaints' | 'inbound_replies' | 'unsubscribes'): Promise<void> {
  await db
    .insert(mailbox_daily_stats)
    .values({ mailbox_id: mailboxId, day, [column]: 1 })
    .onConflictDoUpdate({ target: [mailbox_daily_stats.mailbox_id, mailbox_daily_stats.day], set: { [column]: sql`coalesce(${mailbox_daily_stats[column]}, 0) + 1` } });
}

export async function ingestMessage(db: Db, input: IngestInput, deps: IngestDeps): Promise<IngestOutcome> {
  const parsed = await parseEmail(input.raw);
  const [mailbox] = await db.select().from(mailboxes).where(eq(mailboxes.id, input.mailboxId));
  if (!mailbox) throw new Error(`Mailbox ${input.mailboxId} not found`);
  const header = parsed.messageId ?? syntheticId(input.raw);
  const [existing] = await db.select({ id: messages.id }).from(messages).where(and(eq(messages.mailbox_id, mailbox.id), eq(messages.message_id_header, header)));
  if (existing) return { outcome: 'duplicate' };

  if (input.folder === 'sent') return ingestSent(db, mailbox, parsed, header, input, deps);

  const references = [...new Set([...(parsed.inReplyTo ? [parsed.inReplyTo] : []), ...parsed.references])];
  const fromEmail = parsed.from?.email ?? '';
  const [contact] = fromEmail
    ? await db.select().from(contacts).where(and(eq(contacts.workspace_id, mailbox.workspace_id), eq(contacts.email, fromEmail), isNull(contacts.deleted_at)))
    : [];
  const senderThreads = contact
    ? (
        await db
          .select({ threadId: threads.id, subject: threads.subject, last: threads.last_message_at, created: threads.created_at })
          .from(threads)
          .where(and(eq(threads.contact_id, contact.id), eq(threads.mailbox_id, mailbox.id)))
      ).map((thread) => ({ threadId: thread.threadId, subject: thread.subject, lastActivityAt: thread.last ?? thread.created }))
    : null;
  const reportOriginal = parsed.isReport && parsed.embeddedHeaders ? originalMessageId(parsed.embeddedHeaders) : null;
  const match = matchInbound(
    { subject: parsed.subject, inReplyTo: parsed.inReplyTo, references: parsed.references, isReport: parsed.isReport },
    {
      duplicate: false,
      threadByHeaders: await threadByMessageIds(db, mailbox.workspace_id, references),
      threadByReportOriginal: reportOriginal ? await threadByMessageIds(db, mailbox.workspace_id, [reportOriginal]) : null,
      senderThreads,
    },
    deps.now,
  );
  if (match.outcome === 'duplicate') return { outcome: 'duplicate' };
  // An unknown sender's mail is never stored: Catalyst must not ingest unrelated mail (§7.4).
  if (match.outcome === 'ignored') return { outcome: 'ignored' };

  const threadId = match.outcome === 'matched' ? match.threadId : null;
  const classified = classifyDeterministically({ headers: parsed.headers, fromEmail, subject: parsed.subject, strippedText: parsed.strippedText, deliveryStatusPart: parsed.deliveryStatusPart });
  // Without a model to ask, mail that no rule settles is treated as a human reply (§7.5, §10.4).
  const kind = classified?.kind ?? 'human_reply';
  const [thread] = threadId ? await db.select().from(threads).where(eq(threads.id, threadId)) : [];
  const isReport = kind === 'bounce_hard' || kind === 'bounce_soft' || kind === 'complaint';
  const fromContact = thread ? contact?.id === thread.contact_id : contact !== undefined;
  const author = isReport ? 'system' : fromContact ? 'contact' : 'third_party';

  const id = newId('message');
  const rawKey = `raw/${mailbox.workspace_id}/${id}.eml`;
  await deps.storage.put(rawKey, input.raw, 'message/rfc822');
  const attachmentRows: (typeof attachments.$inferInsert)[] = [];
  for (const [index, attachment] of parsed.attachments.entries()) {
    const storageKey = `attachments/${mailbox.workspace_id}/${id}/${index}`;
    await deps.storage.put(storageKey, attachment.content, attachment.contentType);
    attachmentRows.push({ id: newId('attachment'), message_id: id, filename: attachment.filename, content_type: attachment.contentType, size_bytes: attachment.size, storage_key: storageKey, content_id: attachment.contentId, is_inline: attachment.inline });
  }

  return db.transaction(async (tx) => {
    const now = deps.now;
    const receivedAt = input.internalDate ?? parsed.date ?? now;
    await tx.insert(messages).values({
      id,
      workspace_id: mailbox.workspace_id,
      thread_id: threadId,
      mailbox_id: mailbox.id,
      direction: 'inbound',
      status: 'received',
      author,
      message_id_header: header,
      in_reply_to_header: parsed.inReplyTo,
      references_headers: parsed.references,
      match_method: match.outcome === 'matched' ? match.method : null,
      from_email: fromEmail || 'unknown@unknown.invalid',
      from_name: parsed.from?.name ?? null,
      to_emails: parsed.to,
      cc_emails: parsed.cc,
      reply_to: parsed.replyTo,
      subject: parsed.subject,
      body_text: parsed.text,
      body_html: parsed.html,
      stripped_text: parsed.strippedText,
      snippet: parsed.strippedText.replace(/\s+/g, ' ').slice(0, 140),
      has_attachments: attachmentRows.length > 0,
      raw_storage_key: rawKey,
      size_bytes: input.raw.length,
      received_at: receivedAt,
      imap_folder: input.folder,
      imap_uid: input.uid ?? null,
      inbound_kind: kind,
      dsn_status: classified?.dsnStatus ?? null,
      created_at: now,
      updated_at: now,
    });
    if (attachmentRows.length > 0) await tx.insert(attachments).values(attachmentRows);

    const log = (type: string, data: Record<string, unknown>) =>
      tx.insert(activities).values({
        id: newId('activity'),
        workspace_id: mailbox.workspace_id,
        contact_id: thread?.contact_id ?? contact?.id ?? null,
        thread_id: threadId,
        campaign_id: thread?.campaign_id ?? null,
        type,
        actor_type: author === 'system' ? 'system' : 'contact',
        data: { message_id: id, kind, ...(input.folder === 'junk' && { found_in_junk: true }), ...data },
        occurred_at: now,
      });

    if (!thread) {
      await log('message.received', { unmatched: true });
      if (match.outcome === 'unmatched' && match.raiseUnmatchedReply && kind === 'human_reply') {
        await raiseEscalation(tx, { workspaceId: mailbox.workspace_id, threadId: null, reason: 'unmatched_reply', title: `A reply from ${fromEmail} couldn't be matched`, explanation: `"${parsed.subject}" looks like a reply, but no thread on ${mailbox.email} fits. Attach it to a thread or ignore it.`, triggerMessageId: id }, now);
      }
      return { outcome: 'stored', messageId: id, threadId: null, kind };
    }

    await applyToThread(tx, mailbox, thread, { id, kind, author, fromEmail, fromName: parsed.from?.name ?? null, receivedAt, attachmentCount: attachmentRows.length, folder: input.folder, dsnStatus: classified?.dsnStatus ?? null, rule: classified?.rule ?? null, reportOriginal }, deps);
    return { outcome: 'stored', messageId: id, threadId, kind };
  });
}

/** A stored inbound email, as far as acting on it goes. */
export interface StoredInbound {
  id: string;
  kind: string;
  author: 'contact' | 'third_party' | 'system';
  fromEmail: string;
  fromName: string | null;
  receivedAt: Date;
  attachmentCount: number;
  folder: Folder;
  dsnStatus: string | null;
  rule: string | null;
  /** For a bounce or complaint: the Message-ID of our email it is about. */
  reportOriginal: string | null;
}

/**
 * What an email does to the thread it belongs to (§7.5): a bounce, complaint, unsubscribe,
 * auto-reply or reply, then evaluation. Ingest calls it for matched mail, and attaching an
 * unmatched email by hand calls it too, so both have the same effects.
 */
export async function applyToThread(tx: Executor, mailbox: typeof mailboxes.$inferSelect, thread: typeof threads.$inferSelect, message: StoredInbound, deps: Pick<IngestDeps, 'jobs' | 'now' | 'ai'>): Promise<void> {
  const now = deps.now;
  const threadId = thread.id;
  const [workspace] = await tx.select({ zone: workspaces.default_timezone }).from(workspaces).where(eq(workspaces.id, mailbox.workspace_id));
  const { day } = workspaceDay(now, workspace?.zone ?? 'UTC');
  const log = (type: string, data: Record<string, unknown>) =>
    tx.insert(activities).values({
      id: newId('activity'),
      workspace_id: mailbox.workspace_id,
      contact_id: thread.contact_id,
      thread_id: threadId,
      campaign_id: thread.campaign_id,
      type,
      actor_type: message.author === 'system' ? 'system' : 'contact',
      data: { message_id: message.id, kind: message.kind, ...(message.folder === 'junk' && { found_in_junk: true }), ...data },
      occurred_at: now,
    });
  const [threadContact] = await tx.select().from(contacts).where(eq(contacts.id, thread.contact_id));
  switch (message.kind) {
    case 'bounce_hard':
    case 'bounce_soft': {
      const [original] = message.reportOriginal ? await tx.select().from(messages).where(and(eq(messages.workspace_id, mailbox.workspace_id), eq(messages.message_id_header, message.reportOriginal))) : [];
      let hard = message.kind === 'bounce_hard';
      if (!hard) {
        await bumpStats(tx, mailbox.id, day, 'bounced_soft');
        const [soft] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(messages)
          .innerJoin(threads, eq(threads.id, messages.thread_id))
          .where(and(eq(threads.contact_id, thread.contact_id), eq(messages.inbound_kind, 'bounce_soft'), gte(messages.created_at, new Date(now.getTime() - SOFT_BOUNCE_DAYS * 86_400_000))));
        hard = (soft?.count ?? 0) >= SOFT_BOUNCES_FOR_HARD;
      }
      if (hard) {
        if (original?.direction === 'outbound') await tx.update(messages).set({ status: 'bounced', dsn_status: message.dsnStatus, updated_at: now }).where(eq(messages.id, original.id));
        await tx.update(contacts).set({ email_verification: 'bounced', updated_at: now }).where(eq(contacts.id, thread.contact_id));
        await suppress(tx, mailbox.workspace_id, { email: threadContact!.email, reason: 'hard_bounce', source: 'bounce', jobs: deps.jobs }, now);
        await bumpStats(tx, mailbox.id, day, 'bounced_hard');
        await log('message.bounced', { dsn_status: message.dsnStatus, original_message_id: original?.id ?? null, after_soft_bounces: message.kind === 'bounce_soft' });
      } else await log('message.received', { soft_bounce: true });
      break;
    }
    case 'complaint':
      await unsubscribeContact(tx, { workspaceId: mailbox.workspace_id, contactId: thread.contact_id, source: 'complaint', threadId, actor: { actor_type: 'contact', actor_id: null } }, deps.jobs, now);
      await bumpStats(tx, mailbox.id, day, 'complaints');
      await log('message.received', {});
      break;
    case 'unsubscribe_request':
      await unsubscribeContact(tx, { workspaceId: mailbox.workspace_id, contactId: thread.contact_id, source: 'reply', threadId, actor: { actor_type: 'contact', actor_id: null } }, deps.jobs, now);
      await bumpStats(tx, mailbox.id, day, 'unsubscribes');
      await log('message.received', {});
      break;
    case 'out_of_office':
    case 'auto_reply':
      await log('message.received', { rule: message.rule });
      break;
    default: {
      await tx.update(threads).set({ last_inbound_at: message.receivedAt, updated_at: now }).where(eq(threads.id, threadId));
      if (message.author === 'contact') {
        await tx
          .update(contacts)
          .set({ last_replied_at: message.receivedAt, lifecycle_stage: sql`case when ${contacts.lifecycle_stage} in ('lead', 'prospect') then 'engaged'::lifecycle_stage else ${contacts.lifecycle_stage} end`, updated_at: now })
          .where(eq(contacts.id, thread.contact_id));
      }
      await bumpStats(tx, mailbox.id, day, 'inbound_replies');
      await log('message.received', {});
      if (message.author === 'third_party' && message.fromEmail) await addParticipant(tx, mailbox.workspace_id, thread, message.fromEmail, message.fromName, message.id, now);
      if (message.attachmentCount > 0) {
        await raiseEscalation(tx, { workspaceId: mailbox.workspace_id, threadId, reason: 'attachment_received', title: 'A reply came with attachments', explanation: `${message.attachmentCount} attachment(s) arrived with the reply; the agent doesn't open attachments.`, triggerMessageId: message.id }, now);
      }
      // The agent reads and answers it (§10.4); without one, a person does.
      const [campaign] = await tx.select({ agent_mode: campaigns.agent_mode }).from(campaigns).where(eq(campaigns.id, thread.campaign_id));
      // External agent mode: the harness answers, but Jev still classifies for it (§10.7).
      if (campaign?.agent_mode === 'external' && deps.ai) await deps.jobs.enqueue('ai.classify_inbound', { message_id: message.id }, { db: tx });
      if (campaign?.agent_mode === 'built_in' && !thread.ai_paused) {
        if (deps.ai) await deps.jobs.enqueue('ai.process_inbound', { message_id: message.id }, { db: tx });
        else await raiseEscalation(tx, { workspaceId: mailbox.workspace_id, threadId, reason: 'ai_unavailable', title: `${message.fromName ?? message.fromEmail} replied`, explanation: `The reply needs an answer, and the AI agent isn't turned on, so nothing was drafted. Reply yourself, or close the thread.`, triggerMessageId: message.id }, now);
      }
      if (message.folder === 'junk') {
        await tx.insert(activities).values({ id: newId('activity'), workspace_id: mailbox.workspace_id, thread_id: threadId, contact_id: thread.contact_id, type: 'deliverability.junk_reply', actor_type: 'system', data: { mailbox_id: mailbox.id, domain: emailDomain(mailbox.email) }, occurred_at: now });
      }
    }
  }
  await deps.jobs.enqueue('thread.evaluate', { thread_id: threadId }, { db: tx });
}

/** Someone other than the contact wrote on the thread: link them and ask before writing to them (§7.4). */
async function addParticipant(tx: Executor, workspaceId: string, thread: typeof threads.$inferSelect, email: string, name: string | null, messageId: string, now: Date): Promise<void> {
  let [participant] = await tx.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.workspace_id, workspaceId), eq(contacts.email, email), isNull(contacts.deleted_at)));
  if (!participant) {
    const [first, ...rest] = (name ?? '').split(/\s+/).filter(Boolean);
    [participant] = await tx
      .insert(contacts)
      .values({ id: newId('contact'), workspace_id: workspaceId, email, first_name: first ?? null, last_name: rest.join(' ') || null, source: 'thread_participant', source_detail: thread.id, created_at: now, updated_at: now })
      .returning({ id: contacts.id });
  }
  await tx.insert(thread_participants).values({ thread_id: thread.id, contact_id: participant!.id, role: 'reply', added_at: now }).onConflictDoNothing();
  await raiseEscalation(tx, { workspaceId, threadId: thread.id, reason: 'new_participant', title: `${name ?? email} joined the conversation`, explanation: `${email} replied on this thread. The agent won't write to them until you decide.`, triggerMessageId: messageId }, now);
}

/** A message in Sent: ours already, or the operator writing from their own mail client (§7.2, §7.6). */
async function ingestSent(db: Db, mailbox: typeof mailboxes.$inferSelect, parsed: ParsedEmail, header: string, input: IngestInput, deps: IngestDeps): Promise<IngestOutcome> {
  const now = deps.now;
  const sentAt = input.internalDate ?? parsed.date ?? now;
  const recipient = parsed.to[0] ?? null;
  // A provider that rewrote our Message-ID: match by recipient, subject and time, and keep its ID (§7.2).
  if (recipient) {
    const [ours] = await db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.mailbox_id, mailbox.id),
          eq(messages.direction, 'outbound'),
          eq(messages.subject, parsed.subject),
          sql`${messages.to_emails} ? ${recipient}`,
          sql`abs(extract(epoch from (${messages.sent_at} - ${sentAt}))) <= 120`,
        ),
      );
    if (ours) {
      await db.update(messages).set({ message_id_header: header, updated_at: now }).where(eq(messages.id, ours.id));
      return { outcome: 'duplicate' };
    }
  }
  const references = [...new Set([...(parsed.inReplyTo ? [parsed.inReplyTo] : []), ...parsed.references])];
  const threadId = await threadByMessageIds(db, mailbox.workspace_id, references);
  if (!threadId) return { outcome: 'ignored' };

  return db.transaction(async (tx) => {
    const [thread] = await tx.select().from(threads).where(eq(threads.id, threadId)).for('update');
    const [campaign] = await tx.select({ pause: campaigns.pause_on_manual_reply }).from(campaigns).where(eq(campaigns.id, thread!.campaign_id));
    const id = newId('message');
    const rawKey = `raw/${mailbox.workspace_id}/${id}.eml`;
    await deps.storage.put(rawKey, input.raw, 'message/rfc822');
    await tx.insert(messages).values({
      id,
      workspace_id: mailbox.workspace_id,
      thread_id: threadId,
      mailbox_id: mailbox.id,
      direction: 'outbound',
      status: 'sent',
      author: 'human_external',
      message_id_header: header,
      in_reply_to_header: parsed.inReplyTo,
      references_headers: parsed.references,
      match_method: 'headers',
      from_email: mailbox.email,
      from_name: parsed.from?.name ?? mailbox.display_name,
      to_emails: parsed.to,
      cc_emails: parsed.cc,
      subject: parsed.subject,
      body_text: parsed.text,
      body_html: parsed.html,
      stripped_text: parsed.strippedText,
      snippet: parsed.strippedText.replace(/\s+/g, ' ').slice(0, 140),
      raw_storage_key: rawKey,
      size_bytes: input.raw.length,
      sent_at: sentAt,
      imap_folder: 'sent',
      imap_uid: input.uid ?? null,
      created_at: now,
      updated_at: now,
    });
    // The operator answered directly: the agent stands back so it never double-replies (§7.6).
    const superseded = await tx
      .update(messages)
      .set({ status: 'superseded', updated_at: now })
      .where(and(eq(messages.thread_id, threadId), eq(messages.author, 'ai'), inArray(messages.status, ['draft', 'pending_approval', 'scheduled'])))
      .returning({ id: messages.id });
    if (campaign?.pause && !thread!.ai_paused) {
      await tx.update(threads).set({ ai_paused: true, updated_at: now }).where(eq(threads.id, threadId));
      await tx.insert(activities).values({ id: newId('activity'), workspace_id: mailbox.workspace_id, contact_id: thread!.contact_id, thread_id: threadId, campaign_id: thread!.campaign_id, type: 'thread.ai_paused', actor_type: 'user', data: { reason: 'You replied directly', message_id: id }, occurred_at: now });
    }
    await tx.insert(activities).values({ id: newId('activity'), workspace_id: mailbox.workspace_id, contact_id: thread!.contact_id, thread_id: threadId, campaign_id: thread!.campaign_id, type: 'message.sent', actor_type: 'user', data: { message_id: id, outside_catalyst: true, superseded: superseded.length }, occurred_at: now });
    await deps.jobs.enqueue('thread.evaluate', { thread_id: threadId }, { db: tx });
    await deps.jobs.enqueue('ai.classify_outbound', { message_id: id }, { db: tx });
    return { outcome: 'stored', messageId: id, threadId, kind: 'human_external' };
  });
}
