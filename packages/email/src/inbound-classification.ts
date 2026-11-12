// Deterministic inbound classification (§7.5): the checks that run before any model is asked.
// Works on already-parsed parts, so it doesn't depend on the MIME parser.

import type { InboundKind } from '@catalyst/core';

export interface DeliveryStatus {
  /** Enhanced status code, e.g. `5.1.1`. */
  status: string | null;
  action: string | null;
  finalRecipient: string | null;
}

const field = (text: string, name: string): string | null =>
  new RegExp(`^${name}:[ \\t]*(.+)$`, 'im').exec(text)?.[1]?.trim() ?? null;

/** Reads the per-recipient fields of a `message/delivery-status` part (RFC 3464). */
export function parseDeliveryStatus(part: string): DeliveryStatus {
  const recipient = field(part, 'Final-Recipient') ?? field(part, 'Original-Recipient');
  return {
    status: /\b([245]\.\d{1,3}\.\d{1,3})\b/.exec(field(part, 'Status') ?? '')?.[1] ?? null,
    action: field(part, 'Action')?.toLowerCase() ?? null,
    // "rfc822; user@example.com" → the address.
    finalRecipient: recipient?.split(';').pop()?.trim().toLowerCase() ?? null,
  };
}

/** The Message-ID of the original message embedded in a report (`message/rfc822` or `text/rfc822-headers`). */
export function originalMessageId(embeddedHeaders: string): string | null {
  // Unfold continuation lines first: the ID is often on the line after "Message-ID:".
  return /^Message-ID:\s*(<[^>\s]+>)/im.exec(embeddedHeaders.replace(/\r?\n[ \t]+/g, ' '))?.[1] ?? null;
}

export interface InboundSignals {
  /** Header names in lower case. */
  headers: Readonly<Record<string, string | undefined>>;
  fromEmail: string;
  subject: string;
  /** The reply text with quoted history and signature removed. */
  strippedText: string;
  /** The `message/delivery-status` part, when the message is a `multipart/report`. */
  deliveryStatusPart?: string | null;
}

export interface DeterministicClassification {
  kind: InboundKind;
  /** Which rule decided, for the activity log. */
  rule: string;
  dsnStatus?: string | null;
}

const BOUNCE_SENDER = /^(mailer-daemon|postmaster)@/i;
const BOUNCE_SUBJECT =
  /undeliverable|undelivered mail|delivery status notification \(failure\)|mail delivery failed|delivery has failed|returned mail|failure notice|non remis|unzustellbar|no se pudo entregar/i;
const DELAY_SUBJECT = /delivery status notification \(delay\)|delivery delayed|delayed mail/i;

// Absence notices in EN, DE, FR, ES, PT, NL and IT.
const OUT_OF_OFFICE_SUBJECT =
  /out of (the )?office|away from (the |my )?office|abwesenheit|nicht im b[üu]ro|absence du bureau|absent du bureau|en cong[ée]s?\b|fuera de la oficina|fora do escrit[óo]rio|aus[êe]ncia tempor[áa]ria|afwezigheid|niet aanwezig|fuori ufficio|fuori sede/i;
const AUTO_REPLY_SUBJECT =
  /^auto(matic|mated)?[ -]?(reply|response)|^automatische antwort|^r[ée]ponse automatique|^respuesta autom[áa]tica|^resposta autom[áa]tica|^automatisch antwoord|^risposta automatica|^autosvar/i;

const UNSUBSCRIBE_PHRASE = /\b(unsubscribe|remove me|stop emailing me|take me off (your|the|this) (mailing )?list)\b/i;
const UNSUBSCRIBE_ONLY =
  /^\W*(please\s+)?(unsubscribe(\s+me)?|remove me(\s+from\s+(your|the|this)\s+(mailing\s+)?list)?|stop emailing me|take me off (your|the|this) (mailing )?list)(\s+please)?\W*$/i;
// Wording that turns the phrase into a question or a refusal: left to the model.
const UNSUBSCRIBE_HEDGE = /\b(not|don['’]?t|doesn['’]?t|didn['’]?t|never|how|why|if|whether|can i|could i)\b|\?/i;
const MAX_WORDS_FOR_PHRASE = 12;

function reportType(headers: InboundSignals['headers']): string | null {
  const contentType = headers['content-type'] ?? '';
  if (!/multipart\/report/i.test(contentType)) return null;
  return /report-type\s*=\s*"?([a-z-]+)/i.exec(contentType)?.[1]?.toLowerCase() ?? null;
}

/**
 * Applies the header and phrase rules. Returns null when none settles the message, in which case
 * Jev classifies the conversation (§10.4).
 */
export function classifyDeterministically(signals: InboundSignals): DeterministicClassification | null {
  const { headers, subject } = signals;
  const report = reportType(headers);

  if (report === 'feedback-report') return { kind: 'complaint', rule: 'arf_report' };

  if (report === 'delivery-status') {
    const { status, action } = parseDeliveryStatus(signals.deliveryStatusPart ?? '');
    if (status?.startsWith('5') || action === 'failed') return { kind: 'bounce_hard', rule: 'dsn_status', dsnStatus: status };
    if (status?.startsWith('4') || action === 'delayed') return { kind: 'bounce_soft', rule: 'dsn_status', dsnStatus: status };
    // A success or relay report is automatic mail, not a bounce.
    return { kind: 'auto_reply', rule: 'dsn_other', dsnStatus: status };
  }

  if (BOUNCE_SENDER.test(signals.fromEmail)) {
    if (DELAY_SUBJECT.test(subject)) return { kind: 'bounce_soft', rule: 'bounce_heuristic' };
    if (BOUNCE_SUBJECT.test(subject)) return { kind: 'bounce_hard', rule: 'bounce_heuristic' };
  }

  const autoSubmitted = headers['auto-submitted']?.trim().toLowerCase();
  const automaticHeader =
    (autoSubmitted !== undefined && autoSubmitted !== 'no') ||
    headers['x-autoreply'] !== undefined ||
    headers['x-autorespond'] !== undefined ||
    headers['x-auto-response-suppress'] !== undefined ||
    /^auto[_-]reply$/i.test(headers['precedence']?.trim() ?? '');
  if (OUT_OF_OFFICE_SUBJECT.test(subject)) return { kind: 'out_of_office', rule: 'subject_pattern' };
  if (automaticHeader) return { kind: 'auto_reply', rule: 'auto_headers' };
  if (AUTO_REPLY_SUBJECT.test(subject.trim())) return { kind: 'auto_reply', rule: 'subject_pattern' };

  // High-precision unsubscribe phrases act at once. Anything ambiguous goes to the model.
  const text = signals.strippedText.replace(/\s+/g, ' ').trim();
  const words = text.length === 0 ? 0 : text.split(' ').length;
  if (UNSUBSCRIBE_ONLY.test(text) || UNSUBSCRIBE_ONLY.test(subject)) return { kind: 'unsubscribe_request', rule: 'unsubscribe_phrase' };
  if (words <= MAX_WORDS_FOR_PHRASE && UNSUBSCRIBE_PHRASE.test(text) && !UNSUBSCRIBE_HEDGE.test(text)) {
    return { kind: 'unsubscribe_request', rule: 'unsubscribe_phrase' };
  }

  return null;
}
