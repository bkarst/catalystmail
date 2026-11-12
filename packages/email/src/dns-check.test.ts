import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';

import { describe, it } from 'vitest';

import { checkDomainDns, dkimKeyBits, providerOf, type DnsCheckInput, type DomainDns } from './dns-check.ts';
import { DnsError } from './verification.ts';

const dkimRecord = (bits: number) => {
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: bits });
  return `v=DKIM1; k=rsa; p=${publicKey.export({ type: 'spki', format: 'der' }).toString('base64')}`;
};
const KEY_2048 = dkimRecord(2048);
const KEY_1024 = dkimRecord(1024);

function fakeDns(txt: Record<string, string[] | 'fail'>, mx: Record<string, string[]> = {}, cname: Record<string, string[]> = {}): DomainDns {
  return {
    async resolveTxt(name) {
      const entry = txt[name];
      if (entry === 'fail') throw new DnsError('ETIMEOUT');
      return entry ?? [];
    },
    resolveMx: async (name) => mx[name] ?? [],
    resolveCname: async (name) => cname[name] ?? [],
  };
}

const input: DnsCheckInput = { domain: 'getacme.com', providers: ['google'], dkimSelectors: [], trackingHost: 'go.getacme.com', trackingTarget: 'catalyst.example.com' };
const good = {
  'getacme.com': ['google-site-verification=abc', 'v=spf1 include:_spf.google.com ~all'],
  'google._domainkey.getacme.com': [KEY_2048],
  '_dmarc.getacme.com': ['v=DMARC1; p=quarantine; rua=mailto:dmarc@getacme.com'],
};

describe('domain DNS checks (§8.2)', () => {
  it('passes a correctly set-up Google Workspace domain', async () => {
    const result = await checkDomainDns(fakeDns(good, { 'getacme.com': ['aspmx.l.google.com'] }, { 'go.getacme.com': ['catalyst.example.com'] }), input);
    assert.deepEqual([result.spf.status, result.dkim.status, result.dmarc.status, result.dmarc.policy, result.mx.status, result.tracking.status, result.ready], ['pass', 'pass', 'pass', 'quarantine', 'pass', 'pass', true]);
    assert.match(result.dkim.message, /2048-bit/);
  });

  it('fails SPF that is missing, doubled, without the provider, too permissive or over 10 lookups', async () => {
    const spf = async (records: string[], extra: Record<string, string[]> = {}) => (await checkDomainDns(fakeDns({ ...good, 'getacme.com': records, ...extra }), input)).spf;
    assert.match((await spf([])).message, /no SPF record/);
    assert.match((await spf(['v=spf1 include:_spf.google.com ~all', 'v=spf1 -all'])).message, /more than one/);
    assert.match((await spf(['v=spf1 include:mailgun.org ~all'])).message, /_spf\.google\.com/);
    assert.match((await spf(['v=spf1 include:_spf.google.com +all'])).message, /lets anyone/);
    assert.match((await spf(['v=spf1 include:_spf.google.com'])).message, /no "all"/);
    const many = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`n${index}.example`, ['v=spf1 a ~all']]));
    const record = `v=spf1 include:_spf.google.com ${Object.keys(many).map((name) => `include:${name}`).join(' ')} ~all`;
    const over = await spf([record], many);
    assert.equal(over.status, 'fail');
    assert.match(over.message, /21 DNS lookups/);
    assert.equal((await spf(['v=spf1 include:_spf.google.com -all'])).status, 'pass');
    assert.equal((await spf(['v=spf1 redirect=_spf.getacme.com'], { '_spf.getacme.com': ['v=spf1 include:_spf.google.com ~all'] })).status, 'fail', 'the provider include must be on the domain itself');
  });

  it('checks DKIM key size, and the provider selectors', async () => {
    const dkim = async (records: Record<string, string[]>, providers: DnsCheckInput['providers'] = ['google'], dkimSelectors: string[] = []) =>
      (await checkDomainDns(fakeDns({ ...good, ...records }), { ...input, providers, dkimSelectors })).dkim;
    assert.equal((await dkim({ 'google._domainkey.getacme.com': [KEY_1024] })).status, 'warn');
    assert.equal((await dkim({ 'google._domainkey.getacme.com': [] })).status, 'fail');
    assert.equal((await dkim({ 'google._domainkey.getacme.com': ['v=DKIM1; p='] })).status, 'fail', 'an empty key is revoked');
    assert.equal((await dkim({ 'selector2._domainkey.getacme.com': [KEY_2048] }, ['microsoft'])).status, 'pass');
    assert.equal((await dkim({}, ['other'])).status, 'warn');
    assert.equal((await dkim({ 's1._domainkey.getacme.com': [KEY_2048] }, ['other'], ['s1'])).status, 'pass');
    assert.equal(dkimKeyBits(KEY_2048), 2048);
    assert.equal(dkimKeyBits('v=DKIM1; p=bm90IGEga2V5'), null);
  });

  it('warns on p=none or no reporting address, and fails without a policy', async () => {
    const dmarc = async (records: string[]) => (await checkDomainDns(fakeDns({ ...good, '_dmarc.getacme.com': records }), input)).dmarc;
    const none = await dmarc(['v=DMARC1; p=none']);
    assert.equal(none.status, 'warn');
    assert.match(none.message, /rua=.*quarantine/);
    assert.equal((await dmarc(['v=DMARC1; rua=mailto:x@getacme.com'])).status, 'fail');
    assert.equal((await dmarc([])).status, 'fail');
  });

  it('fails a missing MX and a tracking CNAME pointing elsewhere; a failed lookup is a failure, not a pass', async () => {
    const result = await checkDomainDns(fakeDns({ ...good, '_dmarc.getacme.com': 'fail' }, {}, { 'go.getacme.com': ['tracking.other.com.'] }), input);
    assert.deepEqual([result.mx.status, result.tracking.status, result.dmarc.status, result.ready], ['fail', 'fail', 'fail', false]);
    assert.match(result.tracking.message, /tracking\.other\.com/);
    assert.match(result.dmarc.message, /ETIMEOUT/);
    const noHost = await checkDomainDns(fakeDns(good, { 'getacme.com': ['mx'] }), { ...input, trackingHost: null });
    assert.deepEqual([noHost.tracking.status, noHost.ready], ['warn', true]);
  });

  it('tells providers apart by SMTP host', () => {
    assert.deepEqual(['smtp.gmail.com', 'smtp.office365.com', 'mail.fastmail.com'].map(providerOf), ['google', 'microsoft', 'other']);
  });
});
