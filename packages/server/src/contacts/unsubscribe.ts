// Unsubscribing (spec §8.6, §8.8): global for the workspace, immediate, and recorded as a
// suppression so every send path refuses the address. Used by the unsubscribe page, one-click
// unsubscribe, reply intent and complaints.

import { activities, contacts, emailHash, newId, suppressions, type Executor } from '@catalyst/db';
import type { JobQueue } from '@catalyst/jobs';
import { and, eq, inArray } from 'drizzle-orm';

import { suppress } from '../suppressions/service.ts';
import { evaluateContactThreads } from '../threads/evaluation.ts';

export type UnsubscribeSource = 'link' | 'one_click' | 'reply' | 'mailto' | 'complaint' | 'manual';

/** Days during which an unsubscribe from the page can be undone (§8.8). */
export const UNDO_DAYS = 30;

export async function unsubscribeContact(
  db: Executor,
  input: { workspaceId: string; contactId: string; source: UnsubscribeSource; threadId?: string | null; actor: { actor_type: 'contact' | 'user' | 'api_key' | 'system'; actor_id: string | null } },
  jobs: JobQueue,
  now: Date,
): Promise<{ changed: boolean }> {
  const [contact] = await db.select().from(contacts).where(and(eq(contacts.id, input.contactId), eq(contacts.workspace_id, input.workspaceId)));
  if (!contact) return { changed: false };
  const complaint = input.source === 'complaint';
  const target = complaint ? 'complained' : 'unsubscribed';
  const changed = contact.subscription_status === 'subscribed' || (complaint && contact.subscription_status !== 'complained');
  if (changed) {
    await db.update(contacts).set({ subscription_status: target, unsubscribed_at: contact.unsubscribed_at ?? now, updated_at: now }).where(eq(contacts.id, contact.id));
    await db.insert(activities).values({
      id: newId('activity'),
      workspace_id: input.workspaceId,
      contact_id: contact.id,
      thread_id: input.threadId ?? null,
      type: 'contact.unsubscribed',
      ...input.actor,
      data: { source: input.source },
      occurred_at: now,
    });
  }
  await suppress(db, input.workspaceId, { email: contact.email, reason: complaint ? 'complaint' : 'unsubscribed', source: input.source }, now);
  await evaluateContactThreads(db, jobs, [contact.id]);
  return { changed };
}

/** Undoes an unsubscribe made from the page or by one-click, within 30 days. */
export async function undoUnsubscribe(db: Executor, input: { workspaceId: string; contactId: string; threadId?: string | null }, jobs: JobQueue, now: Date): Promise<{ changed: boolean }> {
  const [contact] = await db.select().from(contacts).where(and(eq(contacts.id, input.contactId), eq(contacts.workspace_id, input.workspaceId)));
  if (!contact || contact.subscription_status !== 'unsubscribed' || !contact.unsubscribed_at) return { changed: false };
  if (now.getTime() - contact.unsubscribed_at.getTime() > UNDO_DAYS * 86_400_000) return { changed: false };
  // Only the link's own suppression is lifted; one from a reply, a person or a complaint stays.
  const removed = await db
    .delete(suppressions)
    .where(and(eq(suppressions.workspace_id, input.workspaceId), eq(suppressions.email_hash, emailHash(contact.email)), eq(suppressions.reason, 'unsubscribed'), inArray(suppressions.source, ['link', 'one_click'])))
    .returning({ id: suppressions.id });
  if (removed.length === 0) return { changed: false };
  await db.update(contacts).set({ subscription_status: 'subscribed', unsubscribed_at: null, updated_at: now }).where(eq(contacts.id, contact.id));
  await db.insert(activities).values({ id: newId('activity'), workspace_id: input.workspaceId, contact_id: contact.id, thread_id: input.threadId ?? null, type: 'contact.unsubscribe_undone', actor_type: 'contact', actor_id: null, data: {}, occurred_at: now });
  await evaluateContactThreads(db, jobs, [contact.id]);
  return { changed: true };
}
