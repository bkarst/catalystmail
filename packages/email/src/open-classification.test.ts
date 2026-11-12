import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { classifyFetch, TRANSPARENT_GIF } from './open-classification.ts';

const at = (userAgent: string | null, extra: Partial<Parameters<typeof classifyFetch>[0]> = {}) =>
  classifyFetch({ userAgent, ip: '203.0.113.9', method: 'GET', secondsSinceSent: 3600, ...extra }).source;

describe('open and click classification (§9.2)', () => {
  it('counts Gmail and Yahoo proxy fetches and mail clients as people', () => {
    assert.equal(at('Mozilla/5.0 (Windows NT 5.1; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)'), 'human');
    assert.equal(at('YahooMailProxy; https://help.yahoo.com/kb/yahoo-mail-proxy-SLN28749.html'), 'human');
    assert.equal(at('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Thunderbird/128.0'), 'human');
    assert.equal(at('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'), 'human');
  });

  it('marks Apple Mail Privacy Protection as a proxy: delivered, maybe not read', () => {
    assert.equal(at('Mozilla/5.0', { ip: '17.58.101.4' }), 'privacy_proxy');
    assert.equal(at('Mozilla/5.0'), 'privacy_proxy');
    assert.equal(at(null), 'privacy_proxy');
  });

  it('marks scanners, HEAD requests, link bursts and instant fetches as security scanners', () => {
    assert.equal(at('Mimecast-Url-Protect/1.0'), 'security_scanner');
    assert.equal(at('Mozilla/5.0 (compatible; Proofpoint URL Defense)'), 'security_scanner');
    assert.equal(at('Mozilla/5.0 (Windows NT 10.0)', { method: 'HEAD' }), 'security_scanner');
    assert.equal(at('Mozilla/5.0 (Windows NT 10.0)', { burstOfLinks: true }), 'security_scanner');
    assert.equal(at('Mozilla/5.0 (Windows NT 10.0)', { secondsSinceSent: 4 }), 'security_scanner');
    assert.equal(at('Googlebot/2.1 (+http://www.google.com/bot.html)'), 'security_scanner');
  });

  it('ignores the sender’s own provider fetching within a minute of sending', () => {
    assert.equal(at('Mozilla/5.0 (via ggpht.com GoogleImageProxy)', { secondsSinceSent: 30 }), 'sender_self');
  });

  it('records the rule and version, and the pixel is the 43-byte GIF', () => {
    const result = classifyFetch({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', ip: null, method: 'GET', secondsSinceSent: null });
    assert.deepEqual([result.source, result.rule], ['unknown', 'no_rule_matched']);
    assert.match(result.rulesVersion, /^\d{4}-\d{2}\.\d+$/);
    assert.equal(TRANSPARENT_GIF.length, 43);
  });
});
