// Domain blocklist checks (spec §8.10 "External sources"): Spamhaus DBL, SURBL and URIBL, queried
// over DNS. An answer in 127.0.0.0/8 means listed, except the codes each list uses to say the
// query itself was refused (a public resolver, or no subscription), which count as "unknown".

export interface BlocklistDns {
  /** A records of a name; empty when there are none (not listed). */
  resolve4(name: string): Promise<string[]>;
}

export interface BlocklistResult {
  list: 'spamhaus_dbl' | 'surbl' | 'uribl';
  status: 'listed' | 'clear' | 'unknown';
  /** The answer, e.g. `127.0.1.2`, or why it is unknown. */
  detail: string | null;
}

interface ListDefinition {
  list: BlocklistResult['list'];
  zone: (domain: string, dqsKey: string | null) => string;
  /** Answers that mean the query was refused rather than the domain listed. */
  refused: (answer: string) => boolean;
}

const LISTS: ListDefinition[] = [
  {
    list: 'spamhaus_dbl',
    // Commercial use goes through a Data Query Service key (§8.10).
    zone: (domain, key) => (key ? `${domain}.${key}.dbl.dq.spamhaus.net` : `${domain}.dbl.spamhaus.org`),
    refused: (answer) => answer.startsWith('127.255.255.'),
  },
  { list: 'surbl', zone: (domain) => `${domain}.multi.surbl.org`, refused: (answer) => answer === '127.0.0.1' },
  { list: 'uribl', zone: (domain) => `${domain}.multi.uribl.com`, refused: (answer) => answer === '127.0.0.1' },
];

export async function checkBlocklists(dns: BlocklistDns, domain: string, options: { spamhausDqsKey?: string | null } = {}): Promise<{ listed: boolean; results: BlocklistResult[] }> {
  const name = domain.toLowerCase().replace(/\.$/, '');
  const results = await Promise.all(
    LISTS.map(async (definition): Promise<BlocklistResult> => {
      try {
        const answers = (await dns.resolve4(definition.zone(name, options.spamhausDqsKey ?? null))).filter((answer) => answer.startsWith('127.'));
        if (answers.length === 0) return { list: definition.list, status: 'clear', detail: null };
        if (answers.every(definition.refused)) return { list: definition.list, status: 'unknown', detail: `The list refused the query (${answers.join(', ')}).` };
        return { list: definition.list, status: 'listed', detail: answers.filter((answer) => !definition.refused(answer)).join(', ') };
      } catch (error) {
        return { list: definition.list, status: 'unknown', detail: error instanceof Error ? error.message : String(error) };
      }
    }),
  );
  return { listed: results.some((result) => result.status === 'listed'), results };
}

/** The system resolver for blocklist lookups. */
export async function systemBlocklistDns(): Promise<BlocklistDns> {
  const { promises: dns } = await import('node:dns');
  return {
    async resolve4(name) {
      try {
        return await dns.resolve4(name);
      } catch (error) {
        if (['ENOTFOUND', 'ENODATA', 'ENONAME', 'NXDOMAIN'].includes((error as { code?: string }).code ?? '')) return [];
        throw error;
      }
    },
  };
}
