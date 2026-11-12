// Guardrails (spec §10.9): deterministic checks on every draft before it can go anywhere. A
// failing draft is revised once with the failures fed back; a second failure escalates
// (`guardrail_failed`). The content linter (§8.7) runs separately, on the finished body.

export type GuardrailCheck = 'links' | 'recipients' | 'numbers' | 'commitments' | 'honesty' | 'leak' | 'format';

export interface GuardrailFailure {
  check: GuardrailCheck;
  message: string;
}

export interface GuardrailInput {
  subject: string | null;
  body: string;
  senderEmail: string;
  /** Campaign links and URLs that appear in knowledge items. */
  allowedLinks: readonly string[];
  /** Where facts may come from: knowledge items, campaign texts, the thread itself. */
  sources: { knowledge: readonly string[]; campaign: readonly string[]; thread: readonly string[] };
  /** Text that must never appear: internal knowledge items and system prompt fragments. */
  secrets: { canary: string; internalKnowledge: readonly string[]; systemFragments: readonly string[] };
  maxWords: number;
}

const URL_PATTERN = /https?:\/\/[^\s<>()"']+[^\s<>()"'.,;:!?]/gi;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
/** Prices, percentages and multi-digit figures: each must come from somewhere. */
const NUMBER_PATTERN = /(?:[$€£]\s?\d[\d,.]*\s?(?:k|m)?|\d[\d,.]*\s?(?:%|percent|usd|eur|gbp|dollars?|euros?)|\b\d{2,}(?:[.,]\d+)?\b)/gi;

const COMMITMENTS: { pattern: RegExp; what: string }[] = [
  { pattern: /\b(discount|% off|percent off|reduced price|special price|cheaper)\b/i, what: 'a discount' },
  { pattern: /\b(refund|money[- ]back)\b/i, what: 'a refund' },
  { pattern: /\b(guarantee[ds]?|we promise|100% (sure|certain))\b/i, what: 'a guarantee' },
  { pattern: /\b(contract|terms of service|SLA|service level|uptime commitment)\b/i, what: 'contract terms' },
  { pattern: /\b(soc ?2|iso ?27001|hipaa|gdpr[- ]compliant|pci|certified|penetration test(ed)?)\b/i, what: 'a security or compliance attestation' },
  { pattern: /\b(legally|liability|indemnif\w*)\b/i, what: 'a legal commitment' },
];

const HONESTY: { pattern: RegExp; what: string }[] = [
  { pattern: /\b(i am|i'm|this is) (a |an )?(real |actual )?(human|person|human being)\b/i, what: 'claims to be human' },
  { pattern: /\b(not|never) (a |an )?(ai|bot|robot|machine|automated)\b/i, what: 'denies being AI-assisted' },
  { pattern: /\b(as (we|i) (discussed|agreed|talked about)|following (up on )?our (call|meeting|conversation)|great (speaking|talking) (with you|earlier))\b/i, what: 'refers to a past conversation' },
];

const PLACEHOLDER = /(\{\{|\}\}|\[(first ?name|name|company|replace[^\]]*|insert[^\]]*|your name)\]|<<|>>|\bTODO\b|\bXXX\b|lorem ipsum)/i;

const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, ' ');
const wordsOf = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}$%]+/u).filter(Boolean);
const SHINGLE = 7;
const digitsOf = (figure: string) => figure.replace(/[^\d.]/g, '').replace(/\.$/, '');
const trimUrl = (url: string) => url.replace(/\/$/, '').toLowerCase();

export function checkDraft(input: GuardrailInput): GuardrailFailure[] {
  const failures: GuardrailFailure[] = [];
  const text = `${input.subject ?? ''}\n${input.body}`;
  const known = [...input.sources.knowledge, ...input.sources.campaign, ...input.sources.thread].map(normalize).join('\n');
  const senderDomain = input.senderEmail.slice(input.senderEmail.indexOf('@') + 1).toLowerCase();

  // 1. Links: from the campaign, a knowledge item, or the sender's own domain.
  const allowed = new Set(input.allowedLinks.map(trimUrl));
  for (const url of text.match(URL_PATTERN) ?? []) {
    let host = '';
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      host = '';
    }
    const ownDomain = host === senderDomain || host.endsWith(`.${senderDomain}`);
    if (!allowed.has(trimUrl(url)) && !ownDomain) failures.push({ check: 'links', message: `The link ${url} is not one of the campaign’s links or knowledge items.` });
  }

  // 2. Recipients: no addresses but the sender's.
  for (const address of text.match(EMAIL_PATTERN) ?? []) {
    if (address.toLowerCase() !== input.senderEmail.toLowerCase()) failures.push({ check: 'recipients', message: `The draft contains the address ${address}; only the sender’s may appear.` });
  }

  // 3. Numbers: every figure appears in the knowledge, the campaign or the thread.
  const knownDigits = known.match(NUMBER_PATTERN)?.map(digitsOf) ?? [];
  for (const figure of new Set(input.body.match(NUMBER_PATTERN) ?? [])) {
    const digits = digitsOf(figure);
    if (digits && !knownDigits.includes(digits) && !known.includes(normalize(figure))) failures.push({ check: 'numbers', message: `“${figure.trim()}” isn’t in the knowledge base, the campaign or the thread.` });
  }

  // 4. Prohibited commitments, unless a knowledge item allows that exact kind.
  const knowledge = input.sources.knowledge.join('\n');
  for (const { pattern, what } of COMMITMENTS) {
    if (pattern.test(input.body) && !pattern.test(knowledge)) failures.push({ check: 'commitments', message: `It offers ${what}, which no knowledge item allows.` });
  }

  // 5. Honesty.
  const thread = input.sources.thread.join('\n');
  for (const { pattern, what } of HONESTY) {
    // A past conversation is fine when the thread has one.
    if (what === 'refers to a past conversation' && /\b(call|meeting|spoke|talked)\b/i.test(thread)) continue;
    if (pattern.test(input.body)) failures.push({ check: 'honesty', message: `The draft ${what}.` });
  }

  // 6. Leaks: the canary, internal knowledge, the system prompt.
  if (text.includes(input.secrets.canary)) failures.push({ check: 'leak', message: 'The draft contains the confidential canary token.' });
  // Any run of 7 words from private text, so a lightly trimmed copy is caught too.
  const draftWords = ` ${wordsOf(text).join(' ')} `;
  for (const secret of [...input.secrets.internalKnowledge, ...input.secrets.systemFragments]) {
    const words = wordsOf(secret);
    for (let start = 0; start + SHINGLE <= words.length; start += 1) {
      const run = words.slice(start, start + SHINGLE).join(' ');
      if (draftWords.includes(` ${run} `)) {
        failures.push({ check: 'leak', message: `The draft repeats text it must keep private (“${run}…”).` });
        break;
      }
    }
  }

  // 7. Format: no placeholders, within length.
  if (PLACEHOLDER.test(text)) failures.push({ check: 'format', message: 'The draft has an unfilled placeholder.' });
  const words = input.body.trim().split(/\s+/).filter(Boolean).length;
  if (words > input.maxWords) failures.push({ check: 'format', message: `It is ${words} words; the limit is ${input.maxWords}.` });
  if (input.body.trim().length === 0) failures.push({ check: 'format', message: 'The draft is empty.' });
  if (input.subject && (input.subject.length > 100 || /^[^a-z]*[A-Z]{5,}[^a-z]*$/.test(input.subject))) failures.push({ check: 'format', message: 'The subject is too long or shouted.' });
  return failures;
}

/** The failures as feedback for the one revision (§10.9). */
export const revisionNote = (failures: readonly GuardrailFailure[]) =>
  failures.length ? `Your previous draft failed these checks. Fix every one:\n${failures.map((failure) => `- ${failure.message}`).join('\n')}` : '';
