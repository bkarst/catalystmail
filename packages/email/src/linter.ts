// Content linter (§8.7). Blockers stop sending; warnings show in the UI and feed the AI's
// revision loop. It works on a rendered message whose links, images and attachments have already
// been extracted, so it doesn't depend on the MIME or HTML parser.

import { hasReplyPrefix } from './subject.ts';

export type LintSeverity = 'blocker' | 'warning';

export interface LintFinding {
  rule: string;
  severity: LintSeverity;
  message: string;
}

export interface LintLink {
  /** The visible link text. */
  text: string;
  href: string;
  /** The compliance unsubscribe link, which doesn't count toward link limits. */
  isUnsubscribe?: boolean;
}

export interface LintInput {
  subject: string;
  /** The rendered `text/plain` part. */
  text: string;
  /** The rendered `text/html` part; null when the message has none. */
  html: string | null;
  links: readonly LintLink[];
  /** Images in the body, not counting the tracking pixel. */
  imageCount: number;
  attachmentCount: number;
  isFirstTouch: boolean;
  /** The workspace requires the compliance footer. */
  complianceRequired: boolean;
  /** An unsubscribe link in the body or a List-Unsubscribe header. */
  hasUnsubscribeMechanism: boolean;
  /** `workspaces.physical_address`, which the footer must show. */
  physicalAddress: string | null;
  /** Whether the text part fully stands in for the HTML part, as judged by the MIME builder. */
  textMatchesHtml?: boolean;
  /** SpamAssassin score, when the optional sidecar is configured. */
  spamAssassinScore?: number | null;
}

const SHORTENERS = [
  'bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly', 'rebrand.ly', 'cutt.ly', 'lnkd.in', 'tiny.cc', 'shorturl.at', 'rb.gy',
];
const SPAM_PHRASES = [
  'act now', 'risk-free', 'risk free', 'guarantee', '100% free', 'winner', 'click here', 'limited time', 'no obligation', 'free money', 'buy now', 'urgent',
];

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean);
const collapse = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();

function hostOf(value: string): string | null {
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`);
    return url.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

/** The host a link's visible text claims to go to, when the text itself looks like an address. */
function hostShownIn(text: string): string | null {
  const candidate = /(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/\S*)?/i.exec(text.trim())?.[0];
  return candidate ? hostOf(candidate) : null;
}

const sameSite = (a: string, b: string) => a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
const isIpAddress = (host: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[');

export function lintMessage(input: LintInput): LintFinding[] {
  const findings: LintFinding[] = [];
  const add = (severity: LintSeverity, rule: string, message: string) => findings.push({ rule, severity, message });
  const { subject, text } = input;
  const everything = `${subject}\n${text}\n${input.html ?? ''}`;

  if (/\{\{|\}\}|\{%|%\}/.test(everything)) add('blocker', 'unresolved_variable', 'A template variable was left unresolved.');

  if (input.complianceRequired) {
    if (!input.hasUnsubscribeMechanism) add('blocker', 'missing_unsubscribe', 'The message has no way to unsubscribe.');
    if (!input.physicalAddress || !collapse(text).includes(collapse(input.physicalAddress))) {
      add('blocker', 'missing_physical_address', 'The physical address is missing from the footer.');
    }
  }

  for (const link of input.links) {
    const target = hostOf(link.href);
    if (!target) {
      add('blocker', 'invalid_link', `"${link.href}" is not a valid link.`);
      continue;
    }
    const shown = hostShownIn(link.text);
    if (shown && !sameSite(shown, target)) {
      add('blocker', 'link_text_mismatch', `The link shows ${shown} but goes to ${target}.`);
    }
    if (SHORTENERS.some((shortener) => sameSite(target, shortener) && target.endsWith(shortener))) {
      add('blocker', 'url_shortener', `${target} is a URL shortener; link to the destination directly.`);
    }
    if (isIpAddress(target)) add('blocker', 'ip_address_url', `"${link.href}" points at an IP address.`);
  }

  const counted = input.links.filter((link) => !link.isUnsubscribe).length;
  if (input.isFirstTouch) {
    if (input.attachmentCount > 0) add('blocker', 'first_touch_attachment', 'A first email must not carry attachments.');
    if (counted > 1) add('warning', 'first_touch_links', `A first email works best with at most 1 link; this has ${counted}.`);
    if (hasReplyPrefix(subject) || /^\s*(fwd?|wg|tr)\s*:/i.test(subject)) {
      add('blocker', 'deceptive_subject', 'The subject looks like a reply or forward, but there is no earlier conversation.');
    }
  }
  if (counted > 2) add('warning', 'too_many_links', `The message has ${counted} links; keep it to 2.`);

  if (text.trim().length === 0) add('blocker', 'missing_text_part', 'The message has no plain-text part.');
  else if (input.html !== null && input.textMatchesHtml === false) {
    add('blocker', 'text_html_mismatch', 'The plain-text part does not say the same as the HTML part.');
  }

  const score = input.spamAssassinScore;
  if (score !== null && score !== undefined) {
    if (score >= 5) add('blocker', 'spamassassin', `SpamAssassin scores this ${score}; 5.0 or more is blocked.`);
    else if (score >= 3) add('warning', 'spamassassin', `SpamAssassin scores this ${score}.`);
  }

  if (input.imageCount > 0) add('warning', 'images', 'Images in the body hurt deliverability.');

  const wordCount = words(text).length;
  if (wordCount > 250) add('warning', 'too_long', `The body has ${wordCount} words; keep it under 250.`);
  else if (input.isFirstTouch && wordCount > 150) add('warning', 'first_touch_too_long', `A first email has ${wordCount} words; keep it under 150.`);

  if (subject.length > 60) add('warning', 'subject_too_long', `The subject has ${subject.length} characters; keep it to 60.`);
  const shouting = words(`${subject} ${text}`).filter((word) => /^[^a-z]*[A-Z]{4,}[^a-z]*$/.test(word)).length;
  if (shouting > 2) add('warning', 'all_caps', `${shouting} words are in capitals.`);
  const exclamations = (`${subject} ${text}`.match(/!/g) ?? []).length;
  if (exclamations > 1) add('warning', 'exclamation_marks', `${exclamations} exclamation marks; use at most 1.`);
  if (/[$€£]{2,}/.test(`${subject} ${text}`)) add('warning', 'currency_spam', 'Repeated currency symbols read as spam.');
  const haystack = collapse(`${subject} ${text}`);
  const phrases = SPAM_PHRASES.filter((phrase) => new RegExp(`(?<![a-z0-9])${phrase.replace(/[%.]/g, '\\$&')}(?![a-z0-9])`).test(haystack));
  if (phrases.length > 0) add('warning', 'spam_phrases', `Spam-trigger wording: ${phrases.map((phrase) => `"${phrase}"`).join(', ')}.`);

  return findings;
}

export const hasBlockers = (findings: readonly LintFinding[]) => findings.some((finding) => finding.severity === 'blocker');
