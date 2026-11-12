// Building outbound messages (spec §7.2 "MIME and headers", §9.1): multipart/alternative with a
// plain-text part that fully stands in for a minimal HTML part, threading headers on replies,
// List-Unsubscribe with one-click, and nothing that names Catalyst or a mailing tool.

import { randomBytes } from 'node:crypto';

import MailComposer from 'nodemailer/lib/mail-composer/index.js';

export interface OutboundEmail {
  from: { name: string; email: string };
  /** The contact only: first touches never have more than one recipient. */
  to: string;
  subject: string;
  text: string;
  /** Built with `textToHtml`; null sends plain text only. */
  html: string | null;
  messageId: string;
  inReplyTo?: string | null;
  references?: readonly string[];
  listUnsubscribe?: { url: string; mailto: string } | null;
  date: Date;
}

/** `<{message TypeID suffix}.{random}@{sending domain}>` (§7.2). */
export function messageIdFor(messageId: string, sendingDomain: string, random: () => Buffer = () => randomBytes(6)): string {
  const suffix = messageId.slice(messageId.indexOf('_') + 1);
  return `<${suffix}.${random().toString('hex')}@${sendingDomain.toLowerCase()}>`;
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
const URL_PATTERN = /https?:\/\/[^\s<>()"']+[^\s<>()"'.,;:!?]/g;

/** The pixel markup (§9.1), placed at the end of the HTML part. */
export const pixelImg = (url: string) => `<img src="${escapeHtml(url)}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px">`;

/**
 * The HTML part, made from the text: paragraphs and line breaks, links with their own address
 * as text, system font, no tables and no images but the optional pixel.
 */
/** The HTML part from the text. `href` rewrites where a link points (click tracking, §9.3); its visible text stays the original URL. */
export function textToHtml(text: string, options: { pixelUrl?: string | null; href?: ((url: string) => string) | null } = {}): string {
  const paragraphs = text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => {
      let html = '';
      let last = 0;
      for (const match of paragraph.matchAll(URL_PATTERN)) {
        html += escapeHtml(paragraph.slice(last, match.index)).replace(/\n/g, '<br>');
        html += `<a href="${escapeHtml(options.href ? options.href(match[0]) : match[0])}">${escapeHtml(match[0])}</a>`;
        last = match.index! + match[0].length;
      }
      html += escapeHtml(paragraph.slice(last)).replace(/\n/g, '<br>');
      return `<p style="margin:0 0 1em">${html}</p>`;
    });
  return `<!doctype html><html><body><div style="font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.5;color:#222">${paragraphs.join('')}</div>${options.pixelUrl ? pixelImg(options.pixelUrl) : ''}</body></html>`;
}

/** The visible text of the HTML part, for checking that the text part says the same (§8.7). */
export function htmlText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|#39);/g, (_, entity: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[entity]!)
    .replace(/\s+/g, ' ')
    .trim();
}

export const textMatchesHtml = (text: string, html: string) => htmlText(html) === text.replace(/\s+/g, ' ').trim();

/** The raw RFC 5322 message, ready for SMTP and for an IMAP APPEND to Sent. */
export async function buildMime(email: OutboundEmail): Promise<Buffer> {
  const headers: Record<string, string> = {};
  if (email.listUnsubscribe) {
    headers['List-Unsubscribe'] = `<${email.listUnsubscribe.url}>, <${email.listUnsubscribe.mailto}>`;
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  }
  const composer = new MailComposer({
    from: { name: email.from.name, address: email.from.email },
    to: email.to,
    subject: email.subject,
    text: email.text,
    ...(email.html && { html: email.html }),
    messageId: email.messageId,
    date: email.date,
    ...(email.inReplyTo && { inReplyTo: email.inReplyTo }),
    ...(email.references?.length && { references: [...email.references] }),
    headers,
    // No X-Mailer or other header that names the software (§7.2).
    xMailer: false,
  } as ConstructorParameters<typeof MailComposer>[0]);
  const root = composer.compile();
  // The default boundary prefix would name the library that built the message.
  root.boundaryPrefix = '----=_Part';
  return new Promise((resolve, reject) => root.build((error, message) => (error ? reject(error) : resolve(message))));
}
