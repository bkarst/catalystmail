// Address verification (§8.5): syntax, typo suggestions, disposable and role accounts, and a
// mail-server lookup. Catalyst never probes a recipient with SMTP `RCPT TO`; the deepest check
// here is whether the domain can receive mail at all. DNS is passed in, so tests need no network.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const disposableDomains: Set<string> = (require('disposable-email-domains-js') as { disposableEmailBlocklistSet: () => Set<string> }).disposableEmailBlocklistSet();
// The free-mail list also holds disposable domains; those are caught first.
const freeDomains = new Set<string>(require('free-email-domains') as string[]);

export type VerificationOutcome = 'valid' | 'risky' | 'invalid' | 'unverified';
export type EmailFlag = 'role' | 'freemail' | 'disposable' | 'typo_suspect';

export interface MailDns {
  /**
   * MX hosts of a domain, most preferred first; an empty list when it has none, and `['.']` for a
   * null MX (RFC 7505). Throws `DnsError` on a lookup failure.
   */
  resolveMx(domain: string): Promise<string[]>;
  /** Whether the domain has an A or AAAA record (the fallback when there is no MX). */
  hasAddress(domain: string): Promise<boolean>;
}

/** A lookup that failed for a reason other than "no such record", such as a timeout. */
export class DnsError extends Error {}

export interface VerificationResult {
  outcome: VerificationOutcome;
  flags: EmailFlag[];
  /** A likely intended address when the domain looks mistyped, e.g. `gmial.com` → `gmail.com`. */
  suggestion: string | null;
  /** Plain-language notes on each check, for the contact panel. */
  details: string[];
}

/** Local parts that reach a team or a function rather than a person (an in-house list, §4.2). */
export const ROLE_LOCAL_PARTS = new Set([
  'admin', 'administrator', 'billing', 'careers', 'contact', 'customerservice', 'customersupport', 'dev', 'enquiries', 'feedback', 'hello', 'help',
  'hostmaster', 'hr', 'info', 'inquiries', 'jobs', 'legal', 'mail', 'marketing', 'media', 'news', 'newsletter', 'noc', 'no-reply', 'noreply',
  'office', 'orders', 'postmaster', 'press', 'privacy', 'root', 'sales', 'security', 'service', 'support', 'team', 'webmaster',
]);

/** Domains people commonly mistype, and the providers suggestions are made toward. */
const POPULAR_DOMAINS = [
  'gmail.com', 'googlemail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com', 'icloud.com', 'me.com', 'aol.com', 'msn.com',
  'protonmail.com', 'proton.me', 'gmx.com', 'gmx.de', 'web.de', 'yahoo.co.uk', 'hotmail.co.uk', 'comcast.net', 'verizon.net',
];
const KNOWN_TYPOS: Record<string, string> = {
  'gmial.com': 'gmail.com', 'gmal.com': 'gmail.com', 'gmaill.com': 'gmail.com', 'gnail.com': 'gmail.com', 'gamil.com': 'gmail.com',
  'gmail.co': 'gmail.com', 'gmail.con': 'gmail.com', 'gmail.cm': 'gmail.com', 'hotmial.com': 'hotmail.com', 'hotmal.com': 'hotmail.com',
  'hotmail.con': 'hotmail.com', 'outlok.com': 'outlook.com', 'outloo.com': 'outlook.com', 'yaho.com': 'yahoo.com', 'yahooo.com': 'yahoo.com',
  'yahoo.con': 'yahoo.com', 'icloud.co': 'icloud.com', 'iclod.com': 'icloud.com',
};

// The practical subset of RFC 5322 that real mailboxes use: dot-atom local part, dotted host name.
const LOCAL_PART = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function splitAddress(email: string): { local: string; domain: string } | null {
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) return null;
  return { local: email.slice(0, at), domain: email.slice(at + 1).toLowerCase() };
}

/** Whether an address is syntactically one a mail server would accept. */
export function isValidAddressSyntax(email: string): boolean {
  if (email.length > 254) return false;
  const parts = splitAddress(email);
  if (!parts || parts.local.length > 64 || !LOCAL_PART.test(parts.local)) return false;
  const labels = parts.domain.split('.');
  if (labels.length < 2 || !/^[a-z]{2,63}$|^xn--[a-z0-9-]+$/.test(labels.at(-1)!)) return false;
  return labels.every((label) => DOMAIN_LABEL.test(label));
}

export const isFreemailDomain = (domain: string) => freeDomains.has(domain.toLowerCase());
export const isDisposableDomain = (domain: string) => disposableDomains.has(domain.toLowerCase());
export const isRoleAccount = (local: string) => ROLE_LOCAL_PARTS.has(local.toLowerCase().replace(/[._]/g, ''));

/** Optimal-string-alignment distance: edits, with a swap of neighbours counting as one. */
function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
    }
  }
  return d[a.length]![b.length]!;
}

/** The domain the person most likely meant, or null when the domain looks deliberate. */
export function suggestDomain(domain: string): string | null {
  const lower = domain.toLowerCase();
  if (KNOWN_TYPOS[lower]) return KNOWN_TYPOS[lower];
  if (POPULAR_DOMAINS.includes(lower) || freeDomains.has(lower)) return null;
  let best: { domain: string; distance: number } | null = null;
  for (const candidate of POPULAR_DOMAINS) {
    const distance = editDistance(lower, candidate);
    if (distance > 0 && distance <= (candidate.length >= 9 ? 2 : 1) && (!best || distance < best.distance)) best = { domain: candidate, distance };
  }
  return best?.domain ?? null;
}

/** Runs every check in §8.5 that needs no third-party verifier. */
export async function verifyEmailAddress(email: string, dns: MailDns): Promise<VerificationResult> {
  const address = email.trim();
  if (!isValidAddressSyntax(address)) {
    return { outcome: 'invalid', flags: [], suggestion: null, details: ['The address is not valid email syntax.'] };
  }
  const { local, domain } = splitAddress(address)!;
  const flags: EmailFlag[] = [];
  const details: string[] = [];

  const suggestedDomain = suggestDomain(domain);
  const suggestion = suggestedDomain ? `${local}@${suggestedDomain}` : null;
  if (suggestion) {
    flags.push('typo_suspect');
    details.push(`The domain looks mistyped. Did you mean ${suggestion}?`);
  }

  if (isDisposableDomain(domain)) {
    flags.push('disposable');
    details.push(`${domain} hands out disposable addresses.`);
    return { outcome: 'invalid', flags, suggestion, details };
  }
  if (isFreemailDomain(domain)) flags.push('freemail');

  try {
    const mx = await dns.resolveMx(domain);
    if (mx.length > 0 && mx.every((host) => host === '.')) {
      details.push(`${domain} publishes a null MX record: it accepts no mail.`);
      return { outcome: 'invalid', flags, suggestion, details };
    }
    if (mx.length > 0) details.push(`${domain} accepts mail (MX ${mx[0]}).`);
    else if (await dns.hasAddress(domain)) details.push(`${domain} has no MX record but has an address record, which mail servers fall back to.`);
    else {
      details.push(`${domain} has no MX or address record, so it cannot receive mail.`);
      return { outcome: 'invalid', flags, suggestion, details };
    }
  } catch (error) {
    if (!(error instanceof DnsError)) throw error;
    details.push(`The mail-server lookup for ${domain} failed (${error.message}); try again later.`);
    return { outcome: 'unverified', flags, suggestion, details };
  }

  if (isRoleAccount(local)) {
    flags.push('role');
    details.push(`${local}@ is a role account that reaches a team, not a person.`);
    return { outcome: 'risky', flags, suggestion, details };
  }
  return { outcome: 'valid', flags, suggestion, details };
}

/** The live resolver, built on `node:dns`. No such record answers empty; other failures throw `DnsError`. */
export async function systemMailDns(): Promise<MailDns> {
  const { promises: dns } = await import('node:dns');
  const missing = (error: unknown) => ['ENOTFOUND', 'ENODATA', 'ENONAME', 'NXDOMAIN'].includes((error as { code?: string }).code ?? '');
  return {
    async resolveMx(domain) {
      try {
        const records = (await dns.resolveMx(domain)).sort((a, b) => a.priority - b.priority);
        // A "null MX" (RFC 7505) is a single record with an empty host: the domain takes no mail.
        return records.map((record) => record.exchange || '.');
      } catch (error) {
        if (missing(error)) return [];
        throw new DnsError((error as { code?: string }).code ?? 'lookup failed');
      }
    },
    async hasAddress(domain) {
      for (const lookup of [dns.resolve4, dns.resolve6]) {
        try {
          if ((await lookup(domain)).length > 0) return true;
        } catch (error) {
          if (!missing(error)) throw new DnsError((error as { code?: string }).code ?? 'lookup failed');
        }
      }
      return false;
    },
  };
}
