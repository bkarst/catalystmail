// Polling a mailbox (spec §7.3): INBOX, Junk and Sent, incrementally by UID, header-only first;
// full messages are fetched only for mail that is ours, then ingested. Progress is saved after
// every message, so an interrupted poll picks up where it stopped.

import {
  activities,
  contacts,
  mailbox_sync_state,
  mailboxes,
  messages,
  newId,
  poll_runs,
  type Db,
} from '@catalyst/db';
import type { HeaderSummary, ImapConnector, ImapSession } from '@catalyst/email';
import type { JobQueue } from '@catalyst/jobs';
import type { ObjectStorage } from '@catalyst/storage';
import { and, desc, eq, gte, inArray, isNull, lt, ne, sql } from 'drizzle-orm';

import type { Principal } from '../api/auth.ts';
import { ApiError, conflict } from '../api/errors.ts';
import type { SecretBox } from '../secrets.ts';
import { liveImapAccount } from '../sending/accounts.ts';
import type { OAuthConfig } from '../sending/oauth.ts';
import { findMailbox } from '../sending/mailboxes.ts';
import { ingestMessage, type Folder } from './ingest.ts';

export interface PollDeps {
  imap: ImapConnector;
  secrets: SecretBox;
  jobs: JobQueue;
  storage: ObjectStorage;
  now: () => Date;
  /** The AI agent answers human replies (§10.4). */
  ai?: boolean;
  /** OAuth clients, for Google and Microsoft mailboxes' access tokens (§7.1). */
  oauth?: OAuthConfig | null;
}

export type PollTrigger = 'schedule' | 'manual' | 'api' | 'catch_up';
export const POLL_INTERVAL_MS = 30 * 60_000;
/** A failed poll is tried again after 1 and then 5 minutes (§7.3 step 4). */
export const POLL_RETRY_MINUTES = [1, 5];
const POLL_FAILURE_REASON = 'Polling failed twice in a row';

export interface PollOptions {
  /** 0 for the first try, then 1 and 2 for the retries. */
  attempt?: number;
  /** When the first try started. */
  chainStartedAt?: Date;
}

/** After a UIDVALIDITY change, the folder is re-read from this far back (§7.3 step 2.1). */
const RESYNC_DAYS = 30;

export interface PollResult {
  pollRunId: string;
  status: 'ok' | 'partial' | 'error';
  fetched: number;
  matched: number;
  ignored: number;
  /** When the retry of a failed poll is due; null when none was queued. */
  retryAt: Date | null;
}

interface Counts {
  fetched: number;
  matched: number;
  ignored: number;
}

/** Whether the header-only pass says this message is ours to fetch (§7.3 step 2.4). */
async function worthFetching(db: Db, mailbox: typeof mailboxes.$inferSelect, folder: Folder, summary: HeaderSummary, now: Date): Promise<boolean> {
  if (summary.messageId) {
    const [stored] = await db.select({ id: messages.id }).from(messages).where(and(eq(messages.mailbox_id, mailbox.id), eq(messages.message_id_header, summary.messageId)));
    if (stored) return false;
  }
  const ids = [...new Set([...(summary.inReplyTo ? [summary.inReplyTo] : []), ...summary.references])];
  const repliesToOurs =
    ids.length > 0 &&
    (await db.select({ id: messages.id }).from(messages).where(and(eq(messages.workspace_id, mailbox.workspace_id), inArray(messages.message_id_header, ids))).limit(1)).length > 0;
  if (repliesToOurs) return true;
  if (folder === 'sent') {
    // Our own sends whose Message-ID the provider rewrote: same recipient and subject, sent recently (§7.2).
    const recipient = summary.to[0];
    if (!recipient) return false;
    const [ours] = await db
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.mailbox_id, mailbox.id), eq(messages.direction, 'outbound'), eq(messages.subject, summary.subject), sql`${messages.to_emails} ? ${recipient}`, gte(messages.sent_at, new Date(now.getTime() - 3 * 86_400_000))))
      .limit(1);
    return Boolean(ours);
  }
  if (/multipart\/report/i.test(summary.contentType ?? '')) return true;
  if (!summary.from) return false;
  const [known] = await db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.workspace_id, mailbox.workspace_id), eq(contacts.email, summary.from), isNull(contacts.deleted_at))).limit(1);
  return Boolean(known);
}

async function pollFolder(db: Db, session: ImapSession, mailbox: typeof mailboxes.$inferSelect, folder: Folder, path: string, deps: PollDeps, counts: Counts): Promise<void> {
  const { uidValidity } = await session.open(path);
  const [state] = await db.select().from(mailbox_sync_state).where(and(eq(mailbox_sync_state.mailbox_id, mailbox.id), eq(mailbox_sync_state.folder, path)));
  const validity = Number(uidValidity);
  const reset = !state || state.uid_validity !== validity;
  if (reset) {
    // A new folder, or the server renumbered it: re-read the last 30 days and rely on Message-ID dedupe.
    await db
      .insert(mailbox_sync_state)
      .values({ mailbox_id: mailbox.id, folder: path, uid_validity: validity, last_seen_uid: 0 })
      .onConflictDoUpdate({ target: [mailbox_sync_state.mailbox_id, mailbox_sync_state.folder], set: { uid_validity: validity, last_seen_uid: 0, updated_at: deps.now() } });
  }
  const summaries = reset ? session.headersSince(path, new Date(deps.now().getTime() - RESYNC_DAYS * 86_400_000)) : session.headersAfter(path, state!.last_seen_uid);
  let lastSeen = reset ? 0 : state!.last_seen_uid;
  for await (const summary of summaries) {
    if (summary.uid <= lastSeen && !reset) continue;
    if (await worthFetching(db, mailbox, folder, summary, deps.now())) {
      const raw = await session.fetchRaw(path, summary.uid);
      if (raw) {
        counts.fetched += 1;
        const result = await ingestMessage(db, { mailboxId: mailbox.id, folder, raw, uid: summary.uid, internalDate: summary.internalDate }, { jobs: deps.jobs, storage: deps.storage, now: deps.now(), ai: deps.ai ?? false });
        if (result.outcome === 'stored' && result.threadId) counts.matched += 1;
        if (result.outcome === 'ignored') counts.ignored += 1;
      }
    } else counts.ignored += 1;
    lastSeen = Math.max(lastSeen, summary.uid);
    // Saved per message: an interrupted poll resumes after the last one handled (§7.3 step 2.6).
    await db.update(mailbox_sync_state).set({ last_seen_uid: lastSeen, updated_at: deps.now() }).where(and(eq(mailbox_sync_state.mailbox_id, mailbox.id), eq(mailbox_sync_state.folder, path)));
  }
}

/** One poll of one mailbox. Records a poll run; two failed scheduled polls in a row put the mailbox in error (§7.3 step 4). */
export async function pollMailbox(db: Db, mailboxId: string, trigger: PollTrigger, deps: PollDeps, options: PollOptions = {}): Promise<PollResult> {
  const started = deps.now();
  const [mailbox] = await db.select().from(mailboxes).where(eq(mailboxes.id, mailboxId));
  if (!mailbox) throw new Error(`Mailbox ${mailboxId} not found`);
  const pollRunId = newId('poll_run');
  await db.insert(poll_runs).values({ id: pollRunId, mailbox_id: mailbox.id, trigger, status: 'running', started_at: started });
  const counts: Counts = { fetched: 0, matched: 0, ignored: 0 };
  const failures: string[] = [];
  let succeeded = 0;
  let session: ImapSession | null = null;
  try {
    session = await deps.imap.connect(await liveImapAccount(db, mailbox, deps.secrets, deps.oauth, deps.now()));
    const stored = mailbox.folders as { inbox?: string; sent?: string; junk?: string };
    const folders = stored.inbox ? { inbox: stored.inbox, sent: stored.sent ?? null, junk: stored.junk ?? null } : await session.folders();
    for (const [folder, path] of [['inbox', folders.inbox], ['junk', folders.junk], ['sent', folders.sent]] as [Folder, string | null][]) {
      if (!path) continue;
      try {
        await pollFolder(db, session, mailbox, folder, path, deps, counts);
        succeeded += 1;
      } catch (error) {
        failures.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  } finally {
    await session?.close().catch(() => undefined);
  }

  const finished = deps.now();
  // Some folders failing while others worked is partial; nothing working at all is an error.
  const status: PollResult['status'] = failures.length === 0 ? 'ok' : succeeded > 0 ? 'partial' : 'error';
  const failed = status === 'error';
  await db
    .update(poll_runs)
    .set({ status, finished_at: finished, duration_ms: finished.getTime() - started.getTime(), fetched_count: counts.fetched, matched_count: counts.matched, ignored_count: counts.ignored, error: failures.join('; ').slice(0, 1000) || null })
    .where(eq(poll_runs.id, pollRunId));
  await db
    .update(mailboxes)
    .set({ last_poll_at: finished, last_poll_status: status, next_poll_at: new Date(finished.getTime() + POLL_INTERVAL_MS), updated_at: finished })
    .where(eq(mailboxes.id, mailbox.id));

  const attempt = options.attempt ?? 0;
  const chainStartedAt = options.chainStartedAt ?? started;
  let retryAt: Date | null = null;
  if (failed && attempt < POLL_RETRY_MINUTES.length) {
    // A failure is retried twice, after 1 and then 5 minutes (§7.3 step 4); the retries are the same run.
    retryAt = new Date(finished.getTime() + POLL_RETRY_MINUTES[attempt]! * 60_000);
    await deps.jobs.enqueue('mail.poll', { mailbox_id: mailbox.id, trigger, attempt: attempt + 1, chain_started_at: chainStartedAt.toISOString() }, { startAfter: retryAt });
  } else if (failed && trigger === 'schedule') {
    // Two failed scheduled runs in a row: the mailbox is in error and someone is told (§7.3 step 4).
    // The previous run's outcome is that of its last try, the latest one before this run began.
    const [previous] = await db
      .select({ status: poll_runs.status })
      .from(poll_runs)
      .where(and(eq(poll_runs.mailbox_id, mailbox.id), eq(poll_runs.trigger, 'schedule'), ne(poll_runs.id, pollRunId), lt(poll_runs.started_at, chainStartedAt)))
      .orderBy(desc(poll_runs.started_at))
      .limit(1);
    if (previous?.status === 'error' && mailbox.status !== 'error') {
      await db.update(mailboxes).set({ status: 'error', status_reason: `${POLL_FAILURE_REASON}: ${failures[0]?.slice(0, 200)}`, updated_at: finished }).where(eq(mailboxes.id, mailbox.id));
      await db.insert(activities).values({ id: newId('activity'), workspace_id: mailbox.workspace_id, type: 'mailbox.poll_failed', actor_type: 'system', data: { mailbox_id: mailbox.id, error: failures[0]?.slice(0, 300) }, occurred_at: finished });
    }
  }
  if (status === 'ok' && mailbox.status === 'error' && mailbox.status_reason?.startsWith(POLL_FAILURE_REASON)) {
    // Polling put it in error, and polling works again.
    await db.update(mailboxes).set({ status: 'active', status_reason: null, updated_at: finished }).where(eq(mailboxes.id, mailbox.id));
  }
  return { pollRunId, status, ...counts, retryAt };
}

/** Mailboxes due a poll: every active or paused one (paused still receives replies, §8.9). */
export async function mailboxesToPoll(db: Db): Promise<{ id: string; lastPollAt: Date | null }[]> {
  const rows = await db.select({ id: mailboxes.id, lastPollAt: mailboxes.last_poll_at }).from(mailboxes).where(inArray(mailboxes.status, ['active', 'paused']));
  return rows;
}

/** Whether a poll of this mailbox is running now (the singleton lock for pollMailboxNow, §4.4). */
export async function pollRunning(db: Db, mailboxId: string, now: Date): Promise<boolean> {
  const [running] = await db
    .select({ id: poll_runs.id })
    .from(poll_runs)
    .where(and(eq(poll_runs.mailbox_id, mailboxId), eq(poll_runs.status, 'running'), gte(poll_runs.started_at, new Date(now.getTime() - 10 * 60_000))))
    .limit(1);
  return Boolean(running);
}

/** "Check now" (§7.3): queues the same job as the schedule; 409 while one is running. */
export async function pollMailboxNow(db: Db, principal: Principal, mailboxId: string, jobs: JobQueue, now: Date) {
  const mailbox = await findMailbox(db, principal.workspace.id, mailboxId);
  if (mailbox.status === 'pending') throw conflict('This mailbox has not passed its connection test yet; run testMailboxConnection first.');
  if (await pollRunning(db, mailbox.id, now)) throw new ApiError(409, 'poll_in_progress', 'A poll of this mailbox is running now; listPollRuns shows when it finishes.');
  await jobs.enqueue('mail.poll', { mailbox_id: mailbox.id, trigger: principal.kind === 'user' ? 'manual' : 'api' });
  return { mailbox_id: mailbox.id, queued_at: now.toISOString(), last_poll_at: mailbox.last_poll_at?.toISOString() ?? null };
}
