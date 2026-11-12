// Parsing inbound mail (spec §7.3–§7.5): the headers, addresses, text and attachments of a raw
// message, the parts of a bounce or complaint report, and the reply with quoted history removed.

import { simpleParser, type AddressObject } from 'mailparser';

export interface ParsedEmail {
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  from: { email: string; name: string | null } | null;
  to: string[];
  cc: string[];
  replyTo: string | null;
  subject: string;
  date: Date | null;
  /** Header names in lower case, values as text. */
  headers: Record<string, string>;
  text: string | null;
  html: string | null;
  /** The reply without quoted history or signature. */
  strippedText: string;
  /** For a bounce: the `message/delivery-status` part. */
  deliveryStatusPart: string | null;
  /** For a bounce or complaint: the headers of the original message it is about. */
  embeddedHeaders: string | null;
  isReport: boolean;
  attachments: { filename: string | null; contentType: string; size: number; contentId: string | null; inline: boolean; content: Buffer }[];
}

const addresses = (value: AddressObject | AddressObject[] | undefined) =>
  (Array.isArray(value) ? value : value ? [value] : []).flatMap((entry) => entry.value).flatMap((entry) => (entry.address ? [entry.address.toLowerCase()] : []));

const ids = (value: unknown): string[] => {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/\s+/) : [];
  return list.map((entry) => String(entry).trim()).filter((entry) => /^<[^<>\s]+>$/.test(entry));
};

/** The body of the first MIME part with this content type, read straight from the raw message. */
function rawPart(raw: string, contentType: RegExp): string | null {
  const header = new RegExp(`^Content-Type:\\s*${contentType.source}[^\\n]*\\r?\\n(?:[ \\t][^\\n]*\\r?\\n|[A-Za-z-]+:[^\\n]*\\r?\\n)*\\r?\\n`, 'im').exec(raw);
  if (!header) return null;
  const start = header.index + header[0].length;
  const end = raw.slice(start).search(/^--[^\r\n]+$/m);
  return (end === -1 ? raw.slice(start) : raw.slice(start, start + end)).trim();
}

const headerText = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && 'value' in (value as object)) {
    const { value: main, params } = value as { value: string; params?: Record<string, string> };
    return [main, ...Object.entries(params ?? {}).map(([key, param]) => `${key}=${param}`)].join('; ');
  }
  if (typeof value === 'object' && 'text' in (value as object)) return String((value as { text: string }).text);
  return Array.isArray(value) ? value.map(headerText).join(', ') : String(value);
};

export async function parseEmail(raw: Buffer): Promise<ParsedEmail> {
  const parsed = await simpleParser(raw, { skipImageLinks: true, skipTextToHtml: true });
  const headers: Record<string, string> = {};
  for (const [name, value] of parsed.headers) headers[name.toLowerCase()] = headerText(value);
  const rawText = raw.toString('latin1');
  const isReport = /multipart\/report/i.test(headers['content-type'] ?? '');
  const embedded =
    parsed.attachments.find((attachment) => /text\/rfc822-headers|message\/rfc822/i.test(attachment.contentType))?.content.toString('utf8') ??
    rawPart(rawText, /(?:text\/rfc822-headers|message\/rfc822)/) ??
    null;
  const from = parsed.from?.value[0];
  const text = parsed.text ?? null;
  const html = typeof parsed.html === 'string' ? parsed.html : null;
  return {
    messageId: parsed.messageId ?? null,
    inReplyTo: ids(parsed.inReplyTo)[0] ?? null,
    references: ids(parsed.references),
    from: from?.address ? { email: from.address.toLowerCase(), name: from.name || null } : null,
    to: addresses(parsed.to),
    cc: addresses(parsed.cc),
    replyTo: addresses(parsed.replyTo)[0] ?? null,
    subject: parsed.subject ?? '',
    date: parsed.date ?? null,
    headers,
    text,
    html,
    strippedText: stripReply(text ?? htmlToText(html ?? '')),
    deliveryStatusPart: isReport ? rawPart(rawText, /message\/delivery-status/) : null,
    embeddedHeaders: embedded,
    isReport,
    attachments: parsed.attachments
      .filter((attachment) => !/text\/rfc822-headers|message\/rfc822|message\/delivery-status|message\/feedback-report/i.test(attachment.contentType))
      .map((attachment) => ({
        filename: attachment.filename ?? null,
        contentType: attachment.contentType,
        size: attachment.size,
        contentId: attachment.contentId ?? null,
        inline: attachment.contentDisposition === 'inline',
        content: attachment.content,
      })),
  };
}

/** Text from HTML for mail without a plain part: Gmail and Outlook quote blocks removed first (§7.5). */
export function htmlToText(html: string): string {
  return html
    .replace(/<div[^>]+class="?gmail_quote[\s\S]*$/i, '')
    .replace(/<div[^>]+id="?divRplyFwdMsg[\s\S]*$/i, '')
    .replace(/<blockquote[^>]+type="?cite[\s\S]*?<\/blockquote>/gi, '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&(amp|lt|gt|quot|#39);/g, (_, entity: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[entity]!)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Lines where quoted history starts (§7.5), in the languages of §7.5.
const QUOTE_HEADERS = [
  /^On .{4,200}(wrote|schrieb|a écrit|escribió|escreveu|schreef|ha scritto):?\s*$/i,
  /^Am .{4,200} schrieb .{1,200}:\s*$/i,
  /^Le .{4,200} a écrit\s*:\s*$/i,
  /^El .{4,200} escribió:\s*$/i,
  /^-{2,}\s*(Original Message|Ursprüngliche Nachricht|Message d'origine|Mensaje original|Messaggio originale|Oorspronkelijk bericht)\s*-{2,}\s*$/i,
  /^_{10,}\s*$/,
  /^From:\s.+$/i,
  /^Von:\s.+$/i,
  /^De\s?:\s.+$/i,
];
// Signature openings: the RFC 3676 delimiter and phone-client footers.
const SIGNATURE = [/^-- ?$/, /^Sent from my (iPhone|iPad|Android|mobile|Galaxy|Samsung)/i, /^Get Outlook for (iOS|Android)/i, /^Von meinem iPhone gesendet/i, /^Envoyé de mon iPhone/i, /^Enviado desde mi iPhone/i];

/**
 * The reply alone: quoted lines (`>`), the "On … wrote:" or Outlook "From: … Sent: …" block and
 * everything after it, and the signature delimiter and phone footers are removed (§7.5). The full
 * body is always kept elsewhere.
 */
export function stripReply(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const kept: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const trimmed = line.trim();
    if (SIGNATURE.some((pattern) => pattern.test(trimmed))) break;
    if (QUOTE_HEADERS.some((pattern) => pattern.test(trimmed))) {
      // "From:" alone is only a quote header when an Outlook block follows (Sent/Date, To, Subject).
      if (/^(From|Von|De)\s?:/i.test(trimmed)) {
        const next = lines.slice(index + 1, index + 5).join('\n');
        if (!/^(Sent|Date|Gesendet|Envoyé|Enviado|Datum)\s?:/im.test(next)) {
          kept.push(line);
          continue;
        }
      }
      break;
    }
    // A wrapped "On … <x@y>\nwrote:" header spans two lines.
    if (/^On .{4,200}$/i.test(trimmed) && /^\S*.*wrote:\s*$/i.test(lines[index + 1]?.trim() ?? '')) break;
    if (trimmed.startsWith('>')) continue;
    kept.push(line);
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
