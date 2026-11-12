// Subject normalisation for thread matching (§7.4).

// Reply and forward markers used by common mail clients, in several languages.
const PREFIXES = ['re', 'aw', 'antw', 'antwort', 'sv', 'vs', 'fw', 'fwd', 'wg', 'tr', 'rv', 'res', 'enc', 'odp', 'ynt', 'rif', 'doorst'];
const REPLY_PREFIXES = ['re', 'aw', 'antw', 'antwort', 'sv', 'vs', 'rv', 'res', 'odp', 'ynt', 'rif'];

// "Re:", "RE[2]:", "Re(3):", "AW :", full-width colon, and external-sender tags such as "[EXT]".
const prefixPattern = (words: readonly string[]) =>
  new RegExp(`^(?:(?:${words.join('|')})\\s*(?:[\\[(]\\d+[\\])])?\\s*[:\\uFF1A]|\\[(?:ext|external|extern)\\])\\s*`, 'i');

const ANY_PREFIX = prefixPattern(PREFIXES);
const REPLY_PREFIX = prefixPattern(REPLY_PREFIXES);

/** The root subject: reply, forward and external-sender prefixes stripped, whitespace collapsed. */
export function normalizeSubject(subject: string): string {
  let rest = subject.replace(/\s+/g, ' ').trim();
  for (;;) {
    const stripped = rest.replace(ANY_PREFIX, '');
    if (stripped === rest) return rest;
    rest = stripped;
  }
}

/** Whether two subjects are the same conversation, ignoring prefixes and letter case. */
export function subjectsMatch(a: string, b: string): boolean {
  const left = normalizeSubject(a).toLowerCase();
  return left.length > 0 && left === normalizeSubject(b).toLowerCase();
}

/** Whether the subject starts with a reply marker, once any external-sender tag is set aside. */
export function hasReplyPrefix(subject: string): boolean {
  const rest = subject.trim().replace(/^(?:\[(?:ext|external|extern)\]\s*)+/i, '');
  return REPLY_PREFIX.test(rest);
}
