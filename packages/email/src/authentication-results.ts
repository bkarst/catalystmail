// Reading `Authentication-Results` (RFC 8601) from the connection test's own message (spec §7.1,
// §8.2): did SPF, DKIM and DMARC pass, and is the From domain aligned with the DKIM signature?

export type AuthOutcome = 'pass' | 'fail' | 'softfail' | 'neutral' | 'none' | 'temperror' | 'permerror' | 'policy' | 'unknown';

export interface AuthenticationResults {
  spf: AuthOutcome;
  dkim: AuthOutcome;
  dmarc: AuthOutcome;
  /** The domain that signed with DKIM (`header.d` or the domain of `header.i`). */
  dkimDomain: string | null;
  /** DMARC passed with the From domain aligned to the DKIM signer (§8.2). */
  aligned: boolean;
}

const OUTCOMES = new Set(['pass', 'fail', 'softfail', 'neutral', 'none', 'temperror', 'permerror', 'policy']);

/** Combines every `Authentication-Results` header (the receiving server's comes first). */
export function parseAuthenticationResults(values: readonly string[], fromDomain: string): AuthenticationResults {
  const text = values.join('; ').replace(/\([^)]*\)/g, ' ');
  const method = (name: string): AuthOutcome => {
    const outcome = new RegExp(`\\b${name}=([a-z]+)`, 'i').exec(text)?.[1]?.toLowerCase();
    return outcome && OUTCOMES.has(outcome) ? (outcome as AuthOutcome) : 'unknown';
  };
  const dkimClause = /\bdkim=pass\b[^;]*/i.exec(text)?.[0] ?? '';
  const dkimDomain = (/header\.d=([^\s;]+)/i.exec(dkimClause)?.[1] ?? /header\.i=@?(?:[^@\s;]*@)?([^\s;]+)/i.exec(dkimClause)?.[1] ?? null)?.toLowerCase() ?? null;
  const from = fromDomain.toLowerCase();
  // Relaxed alignment: the signer is the From domain or its parent or child.
  const relaxed = dkimDomain !== null && (dkimDomain === from || from.endsWith(`.${dkimDomain}`) || dkimDomain.endsWith(`.${from}`));
  const dmarc = method('dmarc');
  return { spf: method('spf'), dkim: method('dkim'), dmarc, dkimDomain, aligned: dmarc === 'pass' && relaxed };
}

/** Every `Authentication-Results` header in a raw message, unfolded, topmost (the receiver's) first. */
export function authenticationResultsOf(raw: Buffer): string[] {
  const text = raw.toString('latin1');
  const end = text.search(/\r?\n\r?\n/);
  const head = (end === -1 ? text : text.slice(0, end)).replace(/\r?\n[ \t]+/g, ' ');
  return [...head.matchAll(/^Authentication-Results:[ \t]*(.*)$/gim)].map((match) => match[1]!.trim());
}
