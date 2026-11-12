// Domain authentication checks (spec §8.2): SPF, DKIM, DMARC, MX and the tracking CNAME. Each record
// gets a status, what was found and what is expected, so the UI can show a copyable fix. DNS is
// passed in, so tests need no network.

import { createPublicKey } from 'node:crypto';

import { DnsError } from './verification.ts';

export interface DomainDns {
  /** TXT records at a name, each joined into one string; empty when there are none. */
  resolveTxt(name: string): Promise<string[]>;
  resolveMx(name: string): Promise<string[]>;
  /** CNAME targets of a name, without the trailing dot; empty when there is none. */
  resolveCname(name: string): Promise<string[]>;
}

export type MailProvider = 'google' | 'microsoft' | 'other';
export type CheckStatus = 'pass' | 'warn' | 'fail';

export interface RecordCheck {
  status: CheckStatus;
  /** Where the record lives, e.g. `_dmarc.getacme.com`. */
  name: string;
  found: string[];
  expected: string;
  message: string;
}

export interface DnsCheckInput {
  domain: string;
  /** The providers of the domain's mailboxes, which decide the SPF include and DKIM selectors. */
  providers: readonly MailProvider[];
  /** DKIM selectors set by hand; otherwise the providers' defaults. */
  dkimSelectors: readonly string[];
  trackingHost: string | null;
  /** The host the tracking CNAME must point at (the Catalyst host). */
  trackingTarget: string | null;
}

export interface DnsCheckResult {
  spf: RecordCheck;
  dkim: RecordCheck;
  dmarc: RecordCheck & { policy: string | null };
  mx: RecordCheck;
  tracking: RecordCheck;
  /** No launch blocker failed: SPF, DKIM, DMARC and MX are at least `warn`, and tracking too when a host is set. */
  ready: boolean;
}

const SPF_INCLUDES: Record<MailProvider, string | null> = {
  google: '_spf.google.com',
  microsoft: 'spf.protection.outlook.com',
  other: null,
};
const DKIM_SELECTORS: Record<MailProvider, string[]> = { google: ['google'], microsoft: ['selector1', 'selector2'], other: [] };
const MAX_SPF_LOOKUPS = 10;

/** A lookup whose failure is returned rather than thrown, so one bad record doesn't hide the others. */
const lookup = async <T>(run: () => Promise<T>): Promise<T | DnsError> => {
  try {
    return await run();
  } catch (error) {
    if (error instanceof DnsError) return error;
    throw error;
  }
};

/** Mechanisms and modifiers that cost a DNS lookup (RFC 7208 §4.6.4). */
async function countSpfLookups(dns: DomainDns, record: string, depth: number, seen: Set<string>): Promise<number> {
  let count = 0;
  for (const term of record.split(/\s+/).slice(1)) {
    const lower = term.toLowerCase().replace(/^[+~?-]/, '');
    const target = /^(?:include:|redirect=)(.+)$/.exec(lower)?.[1];
    if (target || /^(a|mx|ptr|exists)([:/]|$)/.test(lower)) count += 1;
    if (target && depth < MAX_SPF_LOOKUPS && !seen.has(target)) {
      seen.add(target);
      const nested = await lookup(() => dns.resolveTxt(target));
      const spf = Array.isArray(nested) ? nested.find((entry) => /^v=spf1(\s|$)/i.test(entry)) : undefined;
      if (spf) count += await countSpfLookups(dns, spf, depth + 1, seen);
    }
  }
  return count;
}

async function checkSpf(dns: DomainDns, input: DnsCheckInput): Promise<RecordCheck> {
  const includes = [...new Set(input.providers.map((provider) => SPF_INCLUDES[provider]).filter((include): include is string => include !== null))];
  const expected = `v=spf1 ${includes.map((include) => `include:${include}`).join(' ')}${includes.length ? ' ' : ''}~all`;
  const base = { name: input.domain, expected };
  const records = await lookup(() => dns.resolveTxt(input.domain));
  if (records instanceof DnsError) return { ...base, status: 'fail', found: [], message: `The lookup failed (${records.message}); try again.` };
  const spf = records.filter((record) => /^v=spf1(\s|$)/i.test(record));
  if (spf.length === 0) return { ...base, status: 'fail', found: [], message: 'There is no SPF record. Add the expected TXT record.' };
  if (spf.length > 1) return { ...base, status: 'fail', found: spf, message: 'There is more than one SPF record; receivers then treat SPF as broken. Merge them into one.' };
  const record = spf[0]!;
  const terms = record.toLowerCase().split(/\s+/);
  const missing = includes.filter((include) => !terms.includes(`include:${include}`) && !terms.includes(`+include:${include}`));
  if (missing.length > 0) return { ...base, status: 'fail', found: spf, message: `The SPF record doesn't include your mail provider (${missing.map((include) => `include:${include}`).join(', ')}).` };
  const all = terms.find((term) => /^[+~?-]?all$/.test(term));
  if (!terms.some((term) => term.startsWith('redirect='))) {
    if (!all) return { ...base, status: 'fail', found: spf, message: 'The SPF record has no "all" at the end. End it with ~all or -all.' };
    if (all === 'all' || all === '+all' || all === '?all') return { ...base, status: 'fail', found: spf, message: `"${all}" lets anyone send as your domain. End the record with ~all or -all.` };
  }
  const lookups = await countSpfLookups(dns, record, 0, new Set());
  if (lookups > MAX_SPF_LOOKUPS) return { ...base, status: 'fail', found: spf, message: `The SPF record needs ${lookups} DNS lookups; receivers allow at most ${MAX_SPF_LOOKUPS}. Remove includes you no longer use.` };
  return { ...base, status: 'pass', found: spf, message: `SPF is set up (${lookups} of ${MAX_SPF_LOOKUPS} lookups).` };
}

/** Bits in the RSA key of a DKIM record's `p=` tag, or null when there is no usable key. */
export function dkimKeyBits(record: string): number | null {
  const tags = new Map(record.split(';').map((part) => part.trim().split('=')).filter((pair) => pair.length >= 2).map(([name, ...value]) => [name!.trim().toLowerCase(), value.join('=').replace(/\s+/g, '')]));
  const key = tags.get('p');
  if (!key) return null;
  try {
    const details = createPublicKey({ key: Buffer.from(key, 'base64'), format: 'der', type: 'spki' }).asymmetricKeyDetails;
    return details?.modulusLength ?? null;
  } catch {
    return null;
  }
}

async function checkDkim(dns: DomainDns, input: DnsCheckInput): Promise<RecordCheck> {
  const selectors = input.dkimSelectors.length > 0 ? [...input.dkimSelectors] : [...new Set(input.providers.flatMap((provider) => DKIM_SELECTORS[provider]))];
  const name = (selector: string) => `${selector}._domainkey.${input.domain}`;
  if (selectors.length === 0) {
    return { status: 'warn', name: `<selector>._domainkey.${input.domain}`, found: [], expected: 'v=DKIM1; k=rsa; p=<public key from your mail provider>', message: 'Your provider’s DKIM selector is not known. Add it to the domain so Catalyst can check the key.' };
  }
  const found: string[] = [];
  let best: { selector: string; bits: number } | null = null;
  for (const selector of selectors) {
    const records = await lookup(() => dns.resolveTxt(name(selector)));
    if (records instanceof DnsError) continue;
    for (const record of records.filter((entry) => /(^|;)\s*p=/i.test(entry))) {
      found.push(`${selector}: ${record.slice(0, 60)}${record.length > 60 ? '…' : ''}`);
      const bits = dkimKeyBits(record);
      if (bits && (!best || bits > best.bits)) best = { selector, bits };
    }
  }
  const base = { name: selectors.map(name).join(', '), found, expected: 'v=DKIM1; k=rsa; p=<2048-bit public key from your mail provider>' };
  if (!best) return { ...base, status: 'fail', message: `No DKIM key was found at ${selectors.map(name).join(' or ')}. Turn on DKIM signing with your mail provider and publish its key.` };
  if (best.bits < 1024) return { ...base, status: 'fail', message: `The DKIM key at ${name(best.selector)} is ${best.bits} bits; receivers need at least 1024.` };
  if (best.bits < 2048) return { ...base, status: 'warn', message: `The DKIM key at ${name(best.selector)} is ${best.bits} bits. It works, but 2048 bits is recommended.` };
  return { ...base, status: 'pass', message: `DKIM is set up (${best.bits}-bit key at ${name(best.selector)}).` };
}

async function checkDmarc(dns: DomainDns, input: DnsCheckInput): Promise<RecordCheck & { policy: string | null }> {
  const base = { name: `_dmarc.${input.domain}`, expected: `v=DMARC1; p=none; rua=mailto:dmarc@${input.domain}` };
  const records = await lookup(() => dns.resolveTxt(`_dmarc.${input.domain}`));
  if (records instanceof DnsError) return { ...base, status: 'fail', found: [], policy: null, message: `The lookup failed (${records.message}); try again.` };
  const dmarc = records.filter((record) => /^v=DMARC1(\s*;|$)/i.test(record));
  if (dmarc.length === 0) return { ...base, status: 'fail', found: [], policy: null, message: 'There is no DMARC record. Add the expected TXT record; p=none is enough to start.' };
  if (dmarc.length > 1) return { ...base, status: 'fail', found: dmarc, policy: null, message: 'There is more than one DMARC record; receivers then ignore DMARC. Keep one.' };
  const tags = new Map(dmarc[0]!.split(';').map((part) => part.trim().split('=')).filter((pair) => pair.length >= 2).map(([name, value]) => [name!.toLowerCase(), value!.trim().toLowerCase()]));
  const policy = tags.get('p') ?? null;
  if (!policy || !['none', 'quarantine', 'reject'].includes(policy)) return { ...base, status: 'fail', found: dmarc, policy, message: 'The DMARC record has no valid policy (p=none, quarantine or reject).' };
  const notes = [];
  if (!tags.has('rua')) notes.push('add rua= so you receive aggregate reports');
  if (policy === 'none') notes.push('move to p=quarantine or p=reject after about 30 days of clean reports');
  if (notes.length > 0) return { ...base, status: 'warn', found: dmarc, policy, message: `DMARC is set up with p=${policy}. Recommended: ${notes.join('; ')}.` };
  return { ...base, status: 'pass', found: dmarc, policy, message: `DMARC is set up with p=${policy}.` };
}

async function checkMx(dns: DomainDns, input: DnsCheckInput): Promise<RecordCheck> {
  const base = { name: input.domain, expected: 'Your mail provider’s MX records, so replies reach you' };
  const records = await lookup(() => dns.resolveMx(input.domain));
  if (records instanceof DnsError) return { ...base, status: 'fail', found: [], message: `The lookup failed (${records.message}); try again.` };
  const hosts = records.filter((host) => host && host !== '.');
  if (hosts.length === 0) return { ...base, status: 'fail', found: [], message: 'The domain has no MX record, so replies would bounce.' };
  return { ...base, status: 'pass', found: hosts, message: `Replies are delivered to ${hosts[0]}.` };
}

async function checkTracking(dns: DomainDns, input: DnsCheckInput): Promise<RecordCheck> {
  const target = input.trackingTarget ?? '<your Catalyst host>';
  if (!input.trackingHost) {
    return { status: 'warn', name: `track.${input.domain}`, found: [], expected: `CNAME ${target}`, message: 'No tracking host is set, so opens and clicks are not tracked. Add one on the sending domain, for example go.' + input.domain + '.' };
  }
  const base = { name: input.trackingHost, expected: `CNAME ${target}` };
  const records = await lookup(() => dns.resolveCname(input.trackingHost!));
  if (records instanceof DnsError) return { ...base, status: 'fail', found: [], message: `The lookup failed (${records.message}); try again.` };
  const normalized = records.map((record) => record.replace(/\.$/, '').toLowerCase());
  if (input.trackingTarget && normalized.includes(input.trackingTarget.toLowerCase())) return { ...base, status: 'pass', found: normalized, message: `${input.trackingHost} points at Catalyst.` };
  return { ...base, status: 'fail', found: normalized, message: normalized.length ? `${input.trackingHost} points at ${normalized[0]}, not at ${target}.` : `${input.trackingHost} has no CNAME record.` };
}

export async function checkDomainDns(dns: DomainDns, input: DnsCheckInput): Promise<DnsCheckResult> {
  const [spf, dkim, dmarc, mx, tracking] = await Promise.all([checkSpf(dns, input), checkDkim(dns, input), checkDmarc(dns, input), checkMx(dns, input), checkTracking(dns, input)]);
  const blockers = [spf, dkim, dmarc, mx, ...(input.trackingHost ? [tracking] : [])];
  return { spf, dkim, dmarc, mx, tracking, ready: blockers.every((check) => check.status !== 'fail') };
}

/** The live resolver, built on `node:dns`. */
export async function systemDomainDns(): Promise<DomainDns> {
  const { promises: dns } = await import('node:dns');
  const missing = (error: unknown) => ['ENOTFOUND', 'ENODATA', 'ENONAME', 'NXDOMAIN'].includes((error as { code?: string }).code ?? '');
  const wrap = async <T>(run: () => Promise<T[]>): Promise<T[]> => {
    try {
      return await run();
    } catch (error) {
      if (missing(error)) return [];
      throw new DnsError((error as { code?: string }).code ?? 'lookup failed');
    }
  };
  return {
    resolveTxt: async (name) => (await wrap(() => dns.resolveTxt(name))).map((chunks) => chunks.join('')),
    resolveMx: async (name) => (await wrap(() => dns.resolveMx(name))).sort((a, b) => a.priority - b.priority).map((record) => record.exchange || '.'),
    resolveCname: async (name) => (await wrap(() => dns.resolveCname(name))).map((target) => target.replace(/\.$/, '')),
  };
}

/** The provider a mailbox's SMTP host belongs to. */
export function providerOf(smtpHost: string): MailProvider {
  const host = smtpHost.toLowerCase();
  if (host.endsWith('gmail.com') || host.endsWith('google.com') || host.endsWith('googlemail.com')) return 'google';
  if (host.endsWith('office365.com') || host.endsWith('outlook.com') || host.endsWith('microsoft.com')) return 'microsoft';
  return 'other';
}
