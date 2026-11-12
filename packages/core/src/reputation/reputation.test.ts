import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
  bandForScore,
  campaignBreaker,
  domainBreakers,
  domainReputation,
  eventRate,
  limitAfterQuotaError,
  mailboxBreakers,
  mailboxHealth,
  nextBand,
  type DomainReputationInputs,
  type RateWindow,
} from './score.ts';

const window = (sends: number, hardBounces = 0, complaints = 0): RateWindow => ({ sends, hardBounces, complaints });
const domain = (overrides: Partial<DomainReputationInputs> = {}): DomainReputationInputs => ({
  last7Days: window(1000),
  last30Days: window(4000),
  gmailSpamRate: null,
  blocklisted: false,
  authenticationFailing: false,
  junkReplies: 0,
  humanOpenRate: null,
  ...overrides,
});

describe('bands', () => {
  it('has its boundaries at 80, 60 and 40', () => {
    assert.deepEqual([100, 80, 79, 60, 59, 40, 39, 0].map(bandForScore), [
      'healthy', 'healthy', 'at_risk', 'at_risk', 'critical', 'critical', 'paused', 'paused',
    ]);
  });
});

describe('event rates at small volumes (§8.10)', () => {
  const bounces = (w: RateWindow) => w.hardBounces;

  it('uses 7 days when they have 50 sends', () => {
    assert.equal(eventRate({ last7Days: window(50, 1), last30Days: window(500, 100) }, bounces), 0.02);
  });

  it('falls back to 30 days below 50 sends in 7 days', () => {
    assert.equal(eventRate({ last7Days: window(49, 5), last30Days: window(200, 6) }, bounces), 0.03);
  });

  it('ignores fewer than 3 events below 50 sends in 30 days', () => {
    assert.equal(eventRate({ last7Days: window(10, 2), last30Days: window(30, 2) }, bounces), 0);
    assert.equal(eventRate({ last7Days: window(10, 3), last30Days: window(30, 3) }, bounces), 0.1);
    assert.equal(eventRate({ last7Days: window(0), last30Days: window(0) }, bounces), 0);
  });
});

describe('domain reputation score', () => {
  it('is 100 with nothing wrong', () => {
    const result = domainReputation(domain());
    assert.equal(result.score, 100);
    assert.equal(result.band, 'healthy');
  });

  it('matches the domain page wireframe: 1.1% hard bounces cost 9 points (§15.15)', () => {
    const result = domainReputation(domain({ last7Days: window(1000, 11) }));
    assert.equal(result.points.hardBounces, 9);
    assert.equal(result.score, 91);
    assert.equal(result.band, 'healthy');
  });

  it('caps the bounce term at 5% and the complaint term at 0.3%', () => {
    assert.equal(domainReputation(domain({ last7Days: window(1000, 50) })).points.hardBounces, 40);
    assert.equal(domainReputation(domain({ last7Days: window(1000, 200) })).points.hardBounces, 40);
    assert.equal(domainReputation(domain({ last7Days: window(1000, 0, 3) })).points.complaints, 30);
    assert.equal(domainReputation(domain({ last7Days: window(1000, 0, 1) })).points.complaints, 10);
  });

  it('takes the worse of our complaint rate and the Gmail spam rate', () => {
    assert.equal(domainReputation(domain({ gmailSpamRate: 0.0015 })).points.complaints, 15);
    assert.equal(domainReputation(domain({ last7Days: window(1000, 0, 3), gmailSpamRate: 0.001 })).points.complaints, 30);
  });

  it('charges the flags their fixed points', () => {
    const result = domainReputation(
      domain({
        blocklisted: true,
        authenticationFailing: true,
        junkReplies: 2,
        humanOpenRate: { recent: 0.09, baseline: 0.2, sends: 200 },
      }),
    );
    assert.deepEqual(result.points, { hardBounces: 0, complaints: 0, blocklist: 30, authentication: 20, junkReplies: 10, openRate: 10 });
    assert.equal(result.score, 30);
    assert.equal(result.band, 'paused');
  });

  it('needs 2 junk replies and 200 sends before those terms count', () => {
    const result = domainReputation(domain({ junkReplies: 1, humanOpenRate: { recent: 0.01, baseline: 0.2, sends: 199 } }));
    assert.equal(result.score, 100);
  });

  it('is floored at 0', () => {
    const result = domainReputation(
      domain({ last7Days: window(1000, 100, 10), blocklisted: true, authenticationFailing: true, junkReplies: 5 }),
    );
    assert.equal(result.score, 0);
  });

  it('keeps a domain Healthy at exactly 2.5% hard bounces (the formula gives 80)', () => {
    const result = domainReputation(domain({ last7Days: window(1000, 25) }));
    assert.equal(result.score, 80);
    assert.equal(result.band, 'healthy');
  });
});

describe('mailbox health score', () => {
  it('combines rates with provider and error flags', () => {
    const result = mailboxHealth({
      last7Days: window(100, 2),
      last30Days: window(300, 2),
      providerQuotaError: true,
      recentErrors: true,
    });
    assert.deepEqual(result.points, { hardBounces: 16, complaints: 0, providerQuota: 20, recentErrors: 10 });
    assert.equal(result.score, 54);
    assert.equal(result.band, 'critical');
  });
});

describe('band hysteresis', () => {
  const t0 = new Date('2026-11-10T09:00:00Z');
  const hours = (n: number) => new Date(t0.getTime() + n * 3_600_000);

  it('gets worse immediately', () => {
    assert.deepEqual(nextBand({ band: 'healthy', improvingSince: null }, 55, t0), { band: 'critical', improvingSince: null, changed: true });
  });

  it('improves only after 24 hours in the better range', () => {
    const started = nextBand({ band: 'at_risk', improvingSince: null }, 90, t0);
    assert.deepEqual(started, { band: 'at_risk', improvingSince: t0, changed: false });
    assert.equal(nextBand(started, 90, hours(23)).band, 'at_risk');
    assert.deepEqual(nextBand(started, 90, hours(24)), { band: 'healthy', improvingSince: null, changed: true });
  });

  it('restarts the clock if the score dips back', () => {
    const started = nextBand({ band: 'at_risk', improvingSince: null }, 90, t0);
    const dipped = nextBand(started, 70, hours(12));
    assert.deepEqual(dipped, { band: 'at_risk', improvingSince: null, changed: false });
    assert.equal(nextBand(dipped, 90, hours(30)).band, 'at_risk');
  });
});

describe('circuit breakers (§8.9)', () => {
  const quiet = { sends: 100, hardBounces: 0, complaints: 0, providerQuotaError: false };

  it('warns at 2% hard bounces and pauses at 4%, from 50 sends', () => {
    assert.deepEqual(mailboxBreakers({ ...quiet, hardBounces: 1 }), []);
    assert.deepEqual(mailboxBreakers({ ...quiet, hardBounces: 2 }), [{ signal: 'hard_bounce_rate', level: 'warn', scope: 'mailbox' }]);
    assert.deepEqual(mailboxBreakers({ ...quiet, hardBounces: 4 }), [{ signal: 'hard_bounce_rate', level: 'pause', scope: 'mailbox' }]);
    assert.deepEqual(mailboxBreakers({ ...quiet, sends: 49, hardBounces: 10 }), []);
  });

  it('warns at 0.1% complaints and pauses at 0.3%', () => {
    assert.deepEqual(mailboxBreakers({ ...quiet, sends: 1000, complaints: 1 }), [{ signal: 'complaint_rate', level: 'warn', scope: 'mailbox' }]);
    assert.deepEqual(mailboxBreakers({ ...quiet, sends: 1000, complaints: 3 }), [{ signal: 'complaint_rate', level: 'pause', scope: 'mailbox' }]);
    assert.deepEqual(mailboxBreakers({ ...quiet, sends: 2000, complaints: 1 }), []);
  });

  it('pauses the mailbox on a provider quota error and cuts its limit by 20%', () => {
    assert.deepEqual(mailboxBreakers({ ...quiet, providerQuotaError: true }), [{ signal: 'provider_quota', level: 'pause', scope: 'mailbox' }]);
    assert.equal(limitAfterQuotaError(40), 32);
    assert.equal(limitAfterQuotaError(1), 1);
  });

  it('pauses a campaign at 5 hard bounces in its first 50 sends (IT-15)', () => {
    assert.equal(campaignBreaker(2), null);
    assert.equal(campaignBreaker(3)!.level, 'warn');
    assert.deepEqual(campaignBreaker(5), { signal: 'campaign_early_bounces', level: 'pause', scope: 'campaign' });
  });

  it('pauses the whole domain on a blocklist hit, and only first touches on an authentication failure', () => {
    const base = { blocklisted: false, authenticationFailing: false, junkReplies: 0, humanOpenRate: null };
    assert.deepEqual(domainBreakers({ ...base, blocklisted: true }), [{ signal: 'blocklist', level: 'pause', scope: 'domain' }]);
    assert.deepEqual(domainBreakers({ ...base, authenticationFailing: true }), [
      { signal: 'authentication', level: 'pause', scope: 'domain_first_touches' },
    ]);
    assert.deepEqual(domainBreakers({ ...base, junkReplies: 2, humanOpenRate: { recent: 0.04, previous: 0.25, sends: 200 } }), [
      { signal: 'open_rate_collapse', level: 'warn', scope: 'domain' },
      { signal: 'junk_replies', level: 'warn', scope: 'domain' },
    ]);
    assert.deepEqual(domainBreakers({ ...base, junkReplies: 1, humanOpenRate: { recent: 0.04, previous: 0.2, sends: 500 } }), []);
  });
});
