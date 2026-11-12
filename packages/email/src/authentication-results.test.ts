import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { authenticationResultsOf, parseAuthenticationResults } from './authentication-results.ts';

describe('Authentication-Results (§7.1, §8.2 alignment)', () => {
  it('reads a Gmail header: everything passes and DKIM is aligned', () => {
    const gmail = 'mx.google.com; dkim=pass header.i=@getacme.com header.s=google header.b=abc123; spf=pass (google.com: domain of alex@getacme.com designates 209.85.220.41 as permitted sender) smtp.mailfrom=alex@getacme.com; dmarc=pass (p=QUARANTINE sp=QUARANTINE dis=NONE) header.from=getacme.com';
    assert.deepEqual(parseAuthenticationResults([gmail], 'getacme.com'), { spf: 'pass', dkim: 'pass', dmarc: 'pass', dkimDomain: 'getacme.com', aligned: true });
  });

  it('is not aligned when the signer is another domain, or DMARC fails', () => {
    const relay = 'mx.example; dkim=pass header.d=sendgrid.net; spf=pass smtp.mailfrom=bounces.sendgrid.net; dmarc=fail header.from=getacme.com';
    assert.deepEqual(parseAuthenticationResults([relay], 'getacme.com'), { spf: 'pass', dkim: 'pass', dmarc: 'fail', dkimDomain: 'sendgrid.net', aligned: false });
    const microsoft = 'spf=pass (sender IP is 40.107.1.1) smtp.mailfrom=getacme.com; dkim=pass (signature was verified) header.d=getacme.com;dmarc=pass action=none header.from=getacme.com;compauth=pass reason=100';
    assert.equal(parseAuthenticationResults([microsoft], 'getacme.com').aligned, true);
    assert.deepEqual(parseAuthenticationResults([], 'getacme.com'), { spf: 'unknown', dkim: 'unknown', dmarc: 'unknown', dkimDomain: null, aligned: false });
  });

  it('finds every Authentication-Results header in the head only, unfolded', () => {
    const raw = Buffer.from('Authentication-Results: mx.google.com;\r\n       dkim=pass header.i=@getacme.com\r\nAuthentication-Results: relay.example; spf=none\r\nSubject: Hi\r\n\r\nAuthentication-Results: in the body; dkim=fail\r\n');
    assert.deepEqual(authenticationResultsOf(raw), ['mx.google.com; dkim=pass header.i=@getacme.com', 'relay.example; spf=none']);
  });
});
