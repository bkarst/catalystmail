// Privacy requests (spec §12.1, §6.11, §16): exporting everything held about a contact, and erasing
// it. Erasure deletes the personal data but keeps the hash of the address on the suppression list,
// so the person is never emailed again, and keeps the threads as "Erased contact".

import {
  activities,
  ai_runs,
  attachments,
  contact_tags,
  contacts,
  emailHash,
  escalations,
  integration_events,
  list_members,
  lists,
  messages,
  newId,
  suppressions,
  suppressionsFor,
  tags,
  thread_participants,
  threads,
  tracking_events,
  type Db,
} from '@catalyst/db';
import { and, asc, eq, inArray, like, or, sql } from 'drizzle-orm';

import type { Principal } from '../api/auth.ts';
import type { JobQueue } from '@catalyst/jobs';

import { actorOf, audit, iso } from '../shared.ts';
import { evaluateThreads } from '../threads/evaluation.ts';
import { suppress, serializeSuppression } from '../suppressions/service.ts';
import { findContact, serializeContact, tagIdsByContact } from './service.ts';
import { serializeActivity } from './timeline.ts';

export async function exportContactData(db: Db, workspaceId: string, contactId: string, now: Date) {
  const contact = await findContact(db, workspaceId, contactId);
  const tagIds = (await tagIdsByContact(db, [contactId])).get(contactId)!;
  const tagRows = tagIds.length ? await db.select({ id: tags.id, name: tags.name }).from(tags).where(inArray(tags.id, tagIds)) : [];
  const listRows = await db
    .select({ id: lists.id, name: lists.name })
    .from(list_members)
    .innerJoin(lists, eq(lists.id, list_members.list_id))
    .where(eq(list_members.contact_id, contactId));
  const threadRows = await db.select().from(threads).where(and(eq(threads.contact_id, contactId), eq(threads.workspace_id, workspaceId)));
  const messageRows = threadRows.length
    ? await db.select().from(messages).where(inArray(messages.thread_id, threadRows.map((thread) => thread.id))).orderBy(asc(messages.created_at))
    : [];
  const activityRows = await db.select().from(activities).where(and(eq(activities.contact_id, contactId), eq(activities.workspace_id, workspaceId))).orderBy(asc(activities.occurred_at));
  const suppressionRows = await suppressionsFor(db, workspaceId, contact.email);

  return {
    exported_at: now.toISOString(),
    contact: serializeContact(contact, tagIds),
    tags: tagRows,
    lists: listRows,
    threads: threadRows.map((thread) => ({
      id: thread.id,
      campaign_id: thread.campaign_id,
      stage: thread.stage,
      state: thread.state,
      subject: thread.subject,
      first_sent_at: iso(thread.first_sent_at),
      last_message_at: iso(thread.last_message_at),
      messages: messageRows
        .filter((message) => message.thread_id === thread.id)
        .map((message) => ({
          id: message.id,
          direction: message.direction,
          status: message.status,
          from_email: message.from_email,
          to_emails: message.to_emails,
          subject: message.subject,
          body_text: message.body_text,
          sent_at: iso(message.sent_at),
          received_at: iso(message.received_at),
          opened: message.human_open,
        })),
    })),
    activities: activityRows.map(serializeActivity),
    suppressions: suppressionRows.map(serializeSuppression),
  };
}

const ERASED = '(erased)';

export async function eraseContact(db: Db, principal: Principal, contactId: string, now: Date, jobs: JobQueue): Promise<void> {
  const workspaceId = principal.workspace.id;
  await db.transaction(async (tx) => {
    const contact = await findContact(tx, workspaceId, contactId);
    const hash = emailHash(contact.email);
    const placeholder = `erased-${contact.id.slice(contact.id.indexOf('_') + 1)}@erased.invalid`;

    // The block outlives the data: suppress the address, then keep only its hash.
    await suppress(tx, workspaceId, { email: contact.email, reason: 'erased', source: 'manual', createdBy: principal.kind === 'user' ? principal.id : null }, now);
    await tx.update(suppressions).set({ email: null }).where(and(eq(suppressions.workspace_id, workspaceId), eq(suppressions.email_hash, hash)));

    const threadIds = (await tx.select({ id: threads.id }).from(threads).where(eq(threads.contact_id, contactId))).map((thread) => thread.id);
    if (threadIds.length > 0) {
      await tx
        .update(messages)
        .set({
          subject: ERASED,
          body_text: null,
          body_html: null,
          stripped_text: null,
          snippet: null,
          raw_storage_key: null,
          from_email: sql`case when ${messages.direction} = 'inbound' then ${placeholder} else ${messages.from_email} end`,
          from_name: sql`case when ${messages.direction} = 'inbound' then null else ${messages.from_name} end`,
          to_emails: sql`case when ${messages.direction} = 'outbound' then ${JSON.stringify([placeholder])}::jsonb else ${messages.to_emails} end`,
          cc_emails: [],
          reply_to: null,
          updated_at: now,
        })
        .where(inArray(messages.thread_id, threadIds));
      const messageIds = tx.select({ id: messages.id }).from(messages).where(inArray(messages.thread_id, threadIds));
      // Attachment files go with the storage clean-up; their rows go now.
      await tx.delete(attachments).where(inArray(attachments.message_id, messageIds));
      await tx.update(tracking_events).set({ ip_hash: null, user_agent: null }).where(inArray(tracking_events.thread_id, threadIds));
      await tx.update(ai_runs).set({ output: null }).where(inArray(ai_runs.thread_id, threadIds));
      await tx.update(escalations).set({ title: 'Erased contact', explanation: '', questions: [], resolution_note: null, updated_at: now }).where(inArray(escalations.thread_id, threadIds));
      await tx.update(threads).set({ subject: null, ai_summary: null, root_message_id_header: null, updated_at: now }).where(inArray(threads.id, threadIds));
    }
    await tx.delete(thread_participants).where(eq(thread_participants.contact_id, contactId));
    await tx.update(integration_events).set({ contact_email: null, payload: {} }).where(eq(integration_events.matched_contact_id, contactId));
    // Notes and message events can quote the person; status changes and the like hold no personal data.
    await tx
      .update(activities)
      .set({ data: { erased: true } })
      .where(and(eq(activities.contact_id, contactId), or(like(activities.type, 'contact.%'), like(activities.type, 'message.%'))));
    await tx.delete(contact_tags).where(eq(contact_tags.contact_id, contactId));
    await tx.delete(list_members).where(eq(list_members.contact_id, contactId));

    await tx
      .update(contacts)
      .set({
        email: placeholder,
        first_name: 'Erased',
        last_name: 'contact',
        title: null,
        phone: null,
        linkedin_url: null,
        company_id: null,
        city: null,
        country: null,
        timezone: null,
        owner_user_id: null,
        source_detail: null,
        email_flags: [],
        custom_fields: {},
        notes: null,
        do_not_contact: true,
        subscription_status: 'unsubscribed',
        unsubscribed_at: contact.unsubscribed_at ?? now,
        deleted_at: now,
        updated_at: now,
      })
      .where(eq(contacts.id, contactId));
    await tx.insert(activities).values({ id: newId('activity'), workspace_id: workspaceId, contact_id: contactId, type: 'contact.erased', ...actorOf(principal), data: {}, occurred_at: now });
    await audit(tx, principal, 'contact.erased', { type: 'contact', id: contactId }, { threads: threadIds.length }, now);
    await evaluateThreads(tx, jobs, threadIds);
  });
}
