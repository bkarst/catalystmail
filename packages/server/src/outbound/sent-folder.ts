// The Sent folder in the send path (spec §7.2 steps 7 and 8): saving a copy when the provider keeps
// none, and settling an interrupted send by looking for it there. Nothing is ever sent blindly twice.

import { activities, mailboxes, messages, newId, threads, type Db } from '@catalyst/db';
import type { ImapConnector, ImapSession } from '@catalyst/email';
import { and, eq, sql } from 'drizzle-orm';

import { raiseEscalation } from '../escalations/raise.ts';
import { liveImapAccount } from '../sending/accounts.ts';
import { kindOf, rawKeyFor, record, type SendDeps } from './send.ts';

export interface SentFolderDeps extends SendDeps {
  imap: ImapConnector;
}

type MailboxRow = typeof mailboxes.$inferSelect;
const sentFolderOf = (mailbox: MailboxRow) => (mailbox.folders as { sent?: string }).sent ?? null;

async function withSession<T>(db: Db, mailbox: MailboxRow, deps: SentFolderDeps, run: (session: ImapSession) => Promise<T>): Promise<T> {
  const session = await deps.imap.connect(await liveImapAccount(db, mailbox, deps.secrets, deps.oauth, deps.now()));
  try {
    return await run(session);
  } finally {
    await session.close().catch(() => undefined);
  }
}

/**
 * APPENDs the exact bytes that went over SMTP to Sent with `\Seen` (§7.2 step 8). Skipped when
 * Sent already has the message, so a retried job never saves two copies. IMAP errors throw, and
 * the queue retries.
 */
export async function appendToSent(db: Db, messageId: string, deps: SentFolderDeps): Promise<'appended' | 'present' | 'skipped'> {
  const [message] = await db.select().from(messages).where(eq(messages.id, messageId));
  if (!message || !message.raw_storage_key || !message.sent_at || message.direction !== 'outbound') return 'skipped';
  const [mailbox] = await db.select().from(mailboxes).where(eq(mailboxes.id, message.mailbox_id));
  const sent = mailbox ? sentFolderOf(mailbox) : null;
  if (!mailbox || !sent || !mailbox.append_to_sent) return 'skipped';
  const raw = await deps.storage.get(message.raw_storage_key);
  return withSession(db, mailbox, deps, async (session) => {
    if ((await session.findByMessageId(sent, message.message_id_header)) !== null) return 'present';
    await session.append(sent, raw, ['\\Seen']);
    return 'appended';
  });
}

export type ReconcileOutcome = 'sent' | 'retrying' | 'escalated' | 'skipped';

/**
 * Settles a `send_unknown` email (§7.2 step 7): found in Sent means it went, and it is recorded as
 * sent; not found means it is retried once, through the pre-send guard. When Sent can't settle it
 * (the provider keeps no copies, there is no Sent folder, IMAP fails, or it was already retried),
 * a person is asked.
 */
export async function reconcileUnknownSend(db: Db, messageId: string, deps: SentFolderDeps): Promise<ReconcileOutcome> {
  const [message] = await db.select().from(messages).where(eq(messages.id, messageId));
  if (!message || message.status !== 'send_unknown' || !message.thread_id) return 'skipped';
  const [mailbox] = await db.select().from(mailboxes).where(eq(mailboxes.id, message.mailbox_id));
  const sent = mailbox ? sentFolderOf(mailbox) : null;
  const now = deps.now();

  const escalate = (why: string) =>
    db.transaction(async (tx) => {
      await raiseEscalation(
        tx,
        { workspaceId: message.workspace_id, threadId: message.thread_id, reason: 'send_failure', title: 'An email may not have been sent', explanation: `Sending was interrupted, and ${why} Check the mailbox’s Sent folder before sending it again; Catalyst never resends blindly.`, triggerMessageId: message.id },
        now,
      );
      await deps.jobs.enqueue('thread.evaluate', { thread_id: message.thread_id! }, { db: tx });
      return 'escalated' as const;
    });

  if (!mailbox || !sent) return escalate('the mailbox has no Sent folder to check.');
  if (mailbox.append_to_sent) return escalate('this provider keeps no copy of sent mail, so its absence proves nothing.');

  let found: number | null;
  try {
    found = await withSession(db, mailbox, deps, (session) => session.findByMessageId(sent, message.message_id_header));
  } catch (error) {
    return escalate(`the Sent folder could not be checked (${error instanceof Error ? error.message.slice(0, 200) : String(error)}).`);
  }

  if (found !== null) {
    // It went: record it exactly as if SMTP had answered 250.
    let raw: Buffer | null = null;
    try {
      raw = await deps.storage.get(rawKeyFor(message));
    } catch {
      raw = null;
    }
    return db.transaction(async (tx) => {
      const [current] = await tx.select().from(messages).where(eq(messages.id, message.id)).for('update');
      if (current?.status !== 'send_unknown') return 'skipped' as const;
      const kind = await kindOf(tx, current);
      await record(tx, { message: current, mailbox, kind, rawKey: rawKeyFor(current), size: raw?.length ?? current.size_bytes ?? 0, result: { kind: 'accepted', response: `Found in ${sent} after an interrupted send.` } }, deps, now);
      return 'sent' as const;
    });
  }

  const [retried] = await db
    .select({ id: activities.id })
    .from(activities)
    .where(and(eq(activities.workspace_id, message.workspace_id), eq(activities.type, 'message.send_retried'), eq(activities.thread_id, message.thread_id), sql`${activities.data}->>'message_id' = ${message.id}`))
    .limit(1);
  if (retried) return escalate('it is not in Sent after being retried once already.');

  // Not in Sent: it didn't go. One retry, through the pre-send guard like any send.
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(messages).where(eq(messages.id, message.id)).for('update');
    if (current?.status !== 'send_unknown') return 'skipped' as const;
    await tx.update(messages).set({ status: 'scheduled', scheduled_for: now, error: null, updated_at: now }).where(eq(messages.id, message.id));
    const [thread] = await tx.select({ contact_id: threads.contact_id, campaign_id: threads.campaign_id }).from(threads).where(eq(threads.id, message.thread_id!));
    await tx.insert(activities).values({ id: newId('activity'), workspace_id: message.workspace_id, contact_id: thread?.contact_id, thread_id: message.thread_id, campaign_id: thread?.campaign_id, type: 'message.send_retried', actor_type: 'system', data: { message_id: message.id }, occurred_at: now });
    await deps.jobs.enqueue('outbound.send', { message_id: message.id }, { db: tx });
    return 'retrying' as const;
  });
}
