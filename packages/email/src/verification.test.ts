import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { DnsError, isValidAddressSyntax, suggestDomain, verifyEmailAddress, type MailDns } from './verification.ts';

/** A resolver answering from a table: domain → MX hosts, or 'a' for an address record only, or 'fail'. */
function fakeDns(table: Record<string, string[] | 'a' | 'fail'>): MailDns {
  return {
    async resolveMx(domain) {
      const entry = table[domain];
      if (entry === 'fail') throw new DnsError('ETIMEOUT');
      return Array.isArray(entry) ? entry : [];
    },
    async hasAddress(domain) {
      return table[domain] === 'a';
    },
  };
}

const dns = fakeDns({
  'globex.com': ['mx.globex.com'],
  'gmail.com': ['gmail-smtp-in.l.google.com'],
  'gmial.com': ['mx.gmial.com'],
  'legacy.example': 'a',
  'slow.example': 'fail',
  'nomail.example': ['.'],
});

describe('address verification (§8.5)', () => {
  it('checks syntax against the practical RFC 5322 subset', () => {
    for (const ok of ['priya@globex.com', 'priya.n+q4@globex.co.uk', "o'brien@globex.com", 'a@b.io', 'x@xn--bcher-kva.example']) {
      assert.equal(isValidAddressSyntax(ok), true, ok);
    }
    for (const bad of ['priya', '@globex.com', 'priya@', 'priya@globex', 'pri ya@globex.com', 'priya..n@globex.com', '.priya@globex.com', 'priya@-globex.com', 'priya@globex.c', `${'a'.repeat(65)}@globex.com`]) {
      assert.equal(isValidAddressSyntax(bad), false, bad);
    }
  });

  it('marks a deliverable personal address valid', async () => {
    assert.deepEqual(await verifyEmailAddress('priya@globex.com', dns), {
      outcome: 'valid',
      flags: [],
      suggestion: null,
      details: ['globex.com accepts mail (MX mx.globex.com).'],
    });
  });

  it('flags free-mail without marking it risky', async () => {
    const result = await verifyEmailAddress('priya.n@gmail.com', dns);
    assert.equal(result.outcome, 'valid');
    assert.deepEqual(result.flags, ['freemail']);
  });

  it('suggests the intended domain for common typos', async () => {
    assert.equal(suggestDomain('gmial.com'), 'gmail.com');
    assert.equal(suggestDomain('hotmial.com'), 'hotmail.com');
    assert.equal(suggestDomain('outlok.com'), 'outlook.com');
    assert.equal(suggestDomain('yahooo.com'), 'yahoo.com');
    assert.equal(suggestDomain('globex.com'), null);
    assert.equal(suggestDomain('gmail.com'), null);
    assert.equal(suggestDomain('gmx.de'), null);
    const result = await verifyEmailAddress('priya@gmial.com', dns);
    assert.equal(result.suggestion, 'priya@gmail.com');
    assert.ok(result.flags.includes('typo_suspect'));
  });

  it('rejects disposable domains and domains that cannot receive mail', async () => {
    const disposable = await verifyEmailAddress('x@mailinator.com', dns);
    assert.equal(disposable.outcome, 'invalid');
    assert.deepEqual(disposable.flags, ['disposable']);
    assert.equal((await verifyEmailAddress('x@nowhere.example', dns)).outcome, 'invalid');
    assert.equal((await verifyEmailAddress('x@nomail.example', dns)).outcome, 'invalid');
    assert.equal((await verifyEmailAddress('not an address', dns)).outcome, 'invalid');
  });

  it('falls back to an address record when there is no MX', async () => {
    assert.equal((await verifyEmailAddress('info@legacy.example', dns)).outcome, 'risky');
    assert.equal((await verifyEmailAddress('dana@legacy.example', dns)).outcome, 'valid');
  });

  it('marks role accounts risky with the role flag', async () => {
    for (const local of ['info', 'sales', 'support', 'admin', 'no-reply', 'no_reply']) {
      const result = await verifyEmailAddress(`${local}@globex.com`, dns);
      assert.equal(result.outcome, 'risky', local);
      assert.ok(result.flags.includes('role'), local);
    }
    assert.equal((await verifyEmailAddress('information.desk@globex.com', dns)).outcome, 'valid');
  });

  it('leaves an address unverified when the lookup itself fails', async () => {
    const result = await verifyEmailAddress('priya@slow.example', dns);
    assert.equal(result.outcome, 'unverified');
    assert.match(result.details[0]!, /ETIMEOUT/);
  });
});
