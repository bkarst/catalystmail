// Every change that can move a thread enqueues `thread.evaluate` for it (spec §5.6). Contact-level
// changes (deletion, suppression, do-not-contact, merging) touch every thread the contact is in.

import { contacts, normalizeEmail, threads, type Executor } from '@catalyst/db';
import type { JobQueue } from '@catalyst/jobs';
import { and, eq, inArray, sql } from 'drizzle-orm';

export async function evaluateThreads(db: Executor, jobs: JobQueue, threadIds: readonly string[]): Promise<void> {
  for (const threadId of new Set(threadIds)) await jobs.enqueue('thread.evaluate', { thread_id: threadId }, { db });
}

export async function evaluateContactThreads(db: Executor, jobs: JobQueue, contactIds: readonly string[]): Promise<void> {
  if (contactIds.length === 0) return;
  const rows = await db.select({ id: threads.id }).from(threads).where(inArray(threads.contact_id, [...new Set(contactIds)]));
  await evaluateThreads(db, jobs, rows.map((row) => row.id));
}

/** The threads of every contact a suppression matches: one address, or a whole domain. */
export async function evaluateSuppressedThreads(db: Executor, jobs: JobQueue, workspaceId: string, target: { email?: string | null; domain?: string | null }): Promise<void> {
  const match = target.email
    ? eq(contacts.email, normalizeEmail(target.email))
    : sql`split_part(${contacts.email}::text, '@', 2) = ${target.domain!.toLowerCase()}`;
  const rows = await db
    .select({ id: threads.id })
    .from(threads)
    .innerJoin(contacts, eq(contacts.id, threads.contact_id))
    .where(and(eq(threads.workspace_id, workspaceId), match));
  await evaluateThreads(db, jobs, rows.map((row) => row.id));
}
