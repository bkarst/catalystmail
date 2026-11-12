import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { checkBlocklists, type BlocklistDns } from './blocklist.ts';

const dnsWith = (answers: Record<string, string[] | Error>): BlocklistDns => ({
  resolve4: async (name) => {
    const answer = answers[name];
    if (answer instanceof Error) throw answer;
    return answer ?? [];
  },
});

describe('domain blocklists (§8.10)', () => {
  it('is clear when no list answers', async () => {
    const result = await checkBlocklists(dnsWith({}), 'getacme.com');
    assert.equal(result.listed, false);
    assert.deepEqual(result.results.map((entry) => entry.status), ['clear', 'clear', 'clear']);
  });

  it('is listed on a real answer, and unknown when the list refused the query or DNS failed', async () => {
    const result = await checkBlocklists(
      dnsWith({ 'getacme.com.dbl.spamhaus.org': ['127.0.1.2'], 'getacme.com.multi.surbl.org': ['127.0.0.1'], 'getacme.com.multi.uribl.com': new Error('ETIMEOUT') }),
      'GetAcme.com.',
    );
    assert.equal(result.listed, true);
    assert.deepEqual(result.results.map((entry) => [entry.list, entry.status]), [['spamhaus_dbl', 'listed'], ['surbl', 'unknown'], ['uribl', 'unknown']]);
    assert.equal(result.results[0]!.detail, '127.0.1.2');
    const refused = await checkBlocklists(dnsWith({ 'getacme.com.dbl.spamhaus.org': ['127.255.255.254'] }), 'getacme.com');
    assert.deepEqual([refused.listed, refused.results[0]!.status], [false, 'unknown'], 'a public resolver is refused, not listed');
  });

  it('queries Spamhaus through a DQS key when one is configured', async () => {
    const result = await checkBlocklists(dnsWith({ 'getacme.com.KEY123.dbl.dq.spamhaus.net': ['127.0.1.4'] }), 'getacme.com', { spamhausDqsKey: 'KEY123' });
    assert.equal(result.results[0]!.status, 'listed');
  });
});
