// Thread matching for inbound mail (§7.4). The lookups are done by the caller; this module is the
// decision: steps run in order and the first match wins.

import { hasReplyPrefix, subjectsMatch } from './subject.ts';

export type MatchMethod = 'headers' | 'subject_sender' | 'sender_fallback' | 'dsn_original';

export interface InboundEnvelope {
  subject: string;
  inReplyTo: string | null;
  references: readonly string[];
  /** A delivery-status (DSN) or feedback (ARF) report. */
  isReport: boolean;
}

export interface SenderThread {
  threadId: string;
  /** The thread's normalised root subject. */
  subject: string | null;
  lastActivityAt: Date;
}

/** What the caller found in the database for this message. */
export interface MatchCandidates {
  /** `(mailbox_id, message_id_header)` is already stored. */
  duplicate: boolean;
  /** Thread of a stored message whose Message-ID appears in In-Reply-To or References. */
  threadByHeaders: string | null;
  /** Thread of the original message embedded in a DSN or ARF report. */
  threadByReportOriginal: string | null;
  /** Threads the sender has on this mailbox; null when the sender isn't a known contact. */
  senderThreads: readonly SenderThread[] | null;
}

export type MatchResult =
  | { outcome: 'duplicate' }
  | { outcome: 'matched'; threadId: string; method: MatchMethod }
  /** Stored without a thread and shown under Inbox → Unmatched. */
  | { outcome: 'unmatched'; raiseUnmatchedReply: boolean }
  /** Not ours: the body is never fetched and nothing is stored except the dedupe digest. */
  | { outcome: 'ignored' };

const SENDER_FALLBACK_DAYS = 60;

export function looksLikeReply(envelope: InboundEnvelope): boolean {
  return envelope.inReplyTo !== null || envelope.references.length > 0 || hasReplyPrefix(envelope.subject);
}

const mostRecent = (threads: readonly SenderThread[]): SenderThread | undefined =>
  [...threads].sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime())[0];

export function matchInbound(envelope: InboundEnvelope, candidates: MatchCandidates, now: Date): MatchResult {
  if (candidates.duplicate) return { outcome: 'duplicate' };
  if (candidates.threadByHeaders) return { outcome: 'matched', threadId: candidates.threadByHeaders, method: 'headers' };
  if (candidates.threadByReportOriginal) {
    return { outcome: 'matched', threadId: candidates.threadByReportOriginal, method: 'dsn_original' };
  }
  // An unknown sender, or a report about mail that isn't ours.
  if (candidates.senderThreads === null || envelope.isReport) return { outcome: 'ignored' };

  const sameSubject = mostRecent(
    candidates.senderThreads.filter((thread) => thread.subject !== null && subjectsMatch(thread.subject, envelope.subject)),
  );
  if (sameSubject) return { outcome: 'matched', threadId: sameSubject.threadId, method: 'subject_sender' };

  const cutoff = now.getTime() - SENDER_FALLBACK_DAYS * 86_400_000;
  const recent = mostRecent(candidates.senderThreads.filter((thread) => thread.lastActivityAt.getTime() >= cutoff));
  if (recent) return { outcome: 'matched', threadId: recent.threadId, method: 'sender_fallback' };

  return { outcome: 'unmatched', raiseUnmatchedReply: looksLikeReply(envelope) };
}

/**
 * Whether the poll should fetch the full message after the header-only pass (§7.3). Catalyst must
 * not ingest the user's unrelated mail.
 */
export function shouldFetchBody(input: {
  folder: 'inbox' | 'junk' | 'sent';
  match: MatchResult;
  senderIsKnownContact: boolean;
  isReport: boolean;
}): boolean {
  if (input.match.outcome === 'duplicate') return false;
  if (input.match.outcome === 'matched') return true;
  // In Sent, only our own replies on tracked threads matter, and those match by headers.
  if (input.folder === 'sent') return false;
  return input.senderIsKnownContact || input.isReport;
}
