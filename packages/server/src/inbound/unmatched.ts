// Unmatched mail (spec §7.4 step 6, §15 Inbox → Unmatched): inbound email from a known contact
// that fitted no thread. A person attaches it to the right thread, where it has every effect a
// matched email would have, or ignores it.

import { activities, attachments, contacts, escalations, mailboxes, messages, newId, threads, type Db, type Executor } from '@catalyst/db';
import type { JobQueue } from '@catalyst/jobs';
import { and, count, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';

import type { Principal } from '../api/auth.ts';
import { conflict, invalidField, notFound } from '../api/errors.ts';
import { decodeCursor, page } from '../api/pagination.ts';
import { actorOf } from '../shared.ts';
import { evaluateThread } from '../threads/evaluate.ts';
import { serializeMessage } from '../threads/service.ts';
import { applyToThread, type Folder, type StoredInbound } from './ingest.ts';

const SORT = 'received';
const unmatched = (workspaceId: string): SQL[] => [eq(messages.workspace_id, workspaceId), eq(messages.direction, 'inbound'), isNull(messages.thread_id), isNull(messages.ignored_at)];

export async function listUnmatchedMessages(db: Db, workspaceId: string, query: { limit: number; cursor?: string | undefined; mailbox_id?: string | undefined }) {
  const where = unmatched(workspaceId);
  if (query.mailbox_id) where.push(eq(messages.mailbox_id, query.mailbox_id));
  const at = sql`coalesce(${messages.received_at}, ${messages.created_at})`;
  if (query.cursor) {
    const cursorId = decodeCursor(query.cursor, SORT);
    where.push(sql`(${at}, ${messages.id}) < (select coalesce(m.received_at, m.created_at), m.id from messages m where m.id = ${cursorId})`);
  }
  const rows = await db.select().from(messages).where(and(...where)).orderBy(desc(at), desc(messages.id)).limit(query.limit + 1);
  const { rows: kept, next_cursor } = page(rows, query.limit, SORT);
  return { data: kept.map(serializeMessage), next_cursor };
}

async function lockedUnmatched(tx: Executor, workspaceId: string, messageId: string) {
  const [message] = await tx.select().from(messages).where(and(eq(messages.id, messageId), eq(messages.workspace_id, workspaceId))).for('update');
  if (!message) throw notFound('The email');
  if (message.direction !== 'inbound' || message.thread_id !== null) throw conflict('Only an unmatched inbound email can be attached or ignored; this one is already in a thread.');
  if (message.ignored_at) throw conflict('This email was ignored.');
  return message;
}

/** Its `unmatched_reply` escalation is settled along with it. */
async function settleEscalation(tx: Executor, messageId: string, patch: Partial<typeof escalations.$inferInsert>, now: Date): Promise<void> {
  await tx
    .update(escalations)
    .set({ ...patch, updated_at: now })
    .where(and(eq(escalations.trigger_message_id, messageId), eq(escalations.reason, 'unmatched_reply'), inArray(escalations.status, ['open', 'snoozed'])));
}

export async function attachMessageToThread(db: Db, principal: Principal, messageId: string, input: { thread_id: string }, deps: { jobs: JobQueue; now: Date }) {
  const { now } = deps;
  const row = await db.transaction(async (tx) => {
    const message = await lockedUnmatched(tx, principal.workspace.id, messageId);
    const [thread] = await tx.select().from(threads).where(and(eq(threads.id, input.thread_id), eq(threads.workspace_id, principal.workspace.id))).for('update');
    if (!thread) throw invalidField('body.thread_id', 'No such thread in this workspace.');
    const [contact] = await tx.select({ email: contacts.email }).from(contacts).where(eq(contacts.id, thread.contact_id));
    const author: StoredInbound['author'] = message.author === 'system' ? 'system' : contact?.email.toLowerCase() === message.from_email.toLowerCase() ? 'contact' : 'third_party';
    const [updated] = await tx.update(messages).set({ thread_id: thread.id, match_method: 'manual', author, updated_at: now }).where(eq(messages.id, message.id)).returning();
    const [mailbox] = await tx.select().from(mailboxes).where(eq(mailboxes.id, message.mailbox_id));
    const [attached] = await tx.select({ n: count() }).from(attachments).where(eq(attachments.message_id, message.id));
    await tx.insert(activities).values({ id: newId('activity'), workspace_id: thread.workspace_id, contact_id: thread.contact_id, thread_id: thread.id, campaign_id: thread.campaign_id, type: 'message.attached', ...actorOf(principal), data: { message_id: message.id }, occurred_at: now });
    // The same effects as a matched email: reply, bounce, unsubscribe, new participant (§7.5).
    await applyToThread(
      tx,
      mailbox!,
      thread,
      {
        id: message.id,
        kind: message.inbound_kind ?? 'human_reply',
        author,
        fromEmail: message.from_email,
        fromName: message.from_name,
        receivedAt: message.received_at ?? message.created_at,
        attachmentCount: attached?.n ?? 0,
        folder: (message.imap_folder === 'junk' ? 'junk' : 'inbox') as Folder,
        dsnStatus: message.dsn_status,
        rule: null,
        reportOriginal: null,
      },
      deps,
    );
    await settleEscalation(tx, message.id, { status: 'resolved', resolution_note: `Attached to thread ${thread.id}.`, resolved_by: principal.kind === 'user' ? principal.id : null, resolved_at: now }, now);
    return updated!;
  });
  try {
    await evaluateThread(db, input.thread_id, { now });
  } catch (error) {
    console.error(`[unmatched] evaluating ${input.thread_id} inline failed; it is queued`, error);
  }
  return serializeMessage(row);
}

export async function ignoreUnmatchedMessage(db: Db, principal: Principal, messageId: string, now: Date) {
  const row = await db.transaction(async (tx) => {
    const message = await lockedUnmatched(tx, principal.workspace.id, messageId);
    const [updated] = await tx.update(messages).set({ ignored_at: now, updated_at: now }).where(eq(messages.id, message.id)).returning();
    await settleEscalation(tx, message.id, { status: 'dismissed', resolution: 'dismissed', resolution_note: 'The email was ignored.', resolved_by: principal.kind === 'user' ? principal.id : null, resolved_at: now }, now);
    await tx.insert(activities).values({ id: newId('activity'), workspace_id: message.workspace_id, type: 'message.ignored', ...actorOf(principal), data: { message_id: message.id, from: message.from_email }, occurred_at: now });
    return updated!;
  });
  return serializeMessage(row);
}
