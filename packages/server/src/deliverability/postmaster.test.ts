import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { activities, newId, sending_domains, users, type Db } from '@catalyst/db';
import { createTestDatabase } from '@catalyst/db/testing';
import { MemoryQueue } from '@catalyst/jobs';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { call, seedApiKey, seedWorkspace } from '../api/testing.ts';
import { authHandler, setDb, setDeps } from '../runtime.ts';
import { createSecretBox, parseEncryptionKeys } from '../secrets.ts';
import type { OAuthHttp } from '../sending/oauth.ts';
import { oauthCallback, postmasterConnect } from '../sending/oauth-routes.ts';
import { syncPostmaster, type PostmasterHttp } from './postmaster.ts';
import { statsRollup } from './rollup.ts';

// Needs a PostgreSQL server: set TEST_DATABASE_URL to any database on it.
const adminUrl = process.env.TEST_DATABASE_URL;
const APP = 'http://localhost:3000';

describe.skipIf(!adminUrl)('Google Postmaster Tools, v2 (§8.10)', () => {
  let db: Db;
  let drop: () => Promise<void>;
  let workspaceId: string;
  let domainId: string;
  let cookie: string;
  const jobs = new MemoryQueue();
  const secrets = createSecretBox(parseEncryptionKeys(`1:${randomBytes(32).toString('base64')}`));
  let tokenReply: (form: Record<string, string>) => { status: number; body: Record<string, unknown> } = () => ({ status: 200, body: { access_token: 'pm-access', refresh_token: 'pm-refresh', expires_in: 3600 } });
  const oauthHttp: OAuthHttp = { postForm: async (_url, form) => tokenReply(form) };
  const oauth = { google: { clientId: 'google-client', clientSecret: 'google-secret' }, microsoft: null, http: oauthHttp };
  const requests: { method: string; url: string; token: string; body: unknown }[] = [];
  let api: (method: string, url: string) => { status: number; body: Record<string, unknown> } = () => ({ status: 500, body: {} });
  const http: PostmasterHttp = { request: async (method, url, token, body) => (requests.push({ method, url, token, body }), api(method, url)) };

  beforeAll(async () => {
    ({ db, drop } = await createTestDatabase(adminUrl!));
    setDb(db);
    setDeps({ jobs, secrets, oauth, config: { trackingTarget: null, appHost: null, appUrl: APP, auth: { secret: 'a-test-secret-that-is-long-enough-to-sign-cookies', baseURL: APP, trustedOrigins: [APP], secureCookies: false } } });
    workspaceId = await seedWorkspace(db, 'Acme');
    domainId = newId('domain');
    await db.insert(sending_domains).values({ id: domainId, workspace_id: workspaceId, domain: 'getacme.com', spf_status: 'pass', dkim_status: 'pass', dmarc_status: 'pass' });
    await db.insert(users).values({ id: newId('user'), workspace_id: workspaceId, email: 'ada@getacme.com', name: 'Ada', role: 'admin' });
    const signUp = await authHandler(new Request(`${APP}/api/auth/sign-up/email`, { method: 'POST', headers: { 'content-type': 'application/json', origin: APP, 'x-forwarded-for': '203.0.113.70' }, body: JSON.stringify({ email: 'ada@getacme.com', password: 'correct horse battery staple', name: 'Ada' }) }));
    cookie = signUp.headers.getSetCookie().map((line) => line.split(';')[0]).join('; ');
  });
  afterAll(async () => {
    setDb(undefined);
    setDeps(undefined);
    await drop?.();
  });

  it('connects a domain through Google with the read-only scope, then syncs it at once', async () => {
    const started = await postmasterConnect(new Request(`${APP}/api/v1/domains/${domainId}/postmaster/connect`, { headers: { cookie } }), domainId);
    assert.equal(started.status, 302, await started.clone().text());
    const location = new URL(started.headers.get('location')!);
    assert.equal(location.searchParams.get('scope'), 'https://www.googleapis.com/auth/postmaster.traffic.readonly');
    const verifier = /catalyst_oauth_pkce=([^;]+)/.exec(started.headers.get('set-cookie')!)![1]!;
    const back = await oauthCallback(new Request(`${APP}/api/v1/oauth/google/callback?code=c&state=${encodeURIComponent(location.searchParams.get('state')!)}`, { headers: { cookie: `${cookie}; catalyst_oauth_pkce=${verifier}` } }), 'google');
    assert.equal(back.headers.get('location'), `${APP}/deliverability/domains/${domainId}?postmaster=connected`);
    const [domain] = await db.select().from(sending_domains).where(eq(sending_domains.id, domainId));
    assert.equal(domain!.postmaster_connected, true);
    assert.equal(JSON.parse(secrets.open(domain!.postmaster_credentials_enc!)).refresh_token, 'pm-refresh');
    assert.deepEqual(jobs.of('deliverability.postmaster_sync'), [{ domain_id: domainId }]);
  });

  it('keeps the week’s Gmail spam and authentication rates and compliance, and scores from them', async () => {
    const now = new Date('2026-11-12T09:00:00Z');
    api = (method, url) => {
      if (url.endsWith('/domains/getacme.com/domainStats:query')) {
        return {
          status: 200,
          body: {
            domainStats: [
              { metric: 'spam_rate', date: { year: 2026, month: 11, day: 10 }, value: { doubleValue: 0.0008 } },
              { metric: 'spam_rate', date: { year: 2026, month: 11, day: 11 }, value: { doubleValue: 0.004 } },
              { metric: 'spf', date: { year: 2026, month: 11, day: 11 }, value: { doubleValue: 0.99 } },
              { metric: 'dkim', date: { year: 2026, month: 11, day: 11 }, value: { doubleValue: 1 } },
              { metric: 'dmarc', date: { year: 2026, month: 11, day: 11 }, value: { doubleValue: 0.98 } },
            ],
          },
        };
      }
      if (url.endsWith('/domains/getacme.com/complianceStatus') && method === 'GET') {
        return { status: 200, body: { complianceData: { rowData: [{ requirement: 'SPF', status: { status: 'COMPLIANT' } }, { requirement: 'ONE_CLICK_UNSUBSCRIBE', status: { status: 'NEEDS_WORK' } }], deliverabilityStatusVerdict: { reason: 'SPAM_RATE_HIGH' } } } };
      }
      return { status: 404, body: {} };
    };
    assert.deepEqual(await syncPostmaster(db, { secrets, oauth, http }, now), { synced: 1, noData: 0, failed: 0 });
    const query = requests.find((request) => request.url.endsWith('domainStats:query'))!;
    assert.equal(query.token, 'pm-access');
    assert.deepEqual((query.body as { timeQuery: unknown }).timeQuery, { dateRanges: { dateRanges: [{ start: { year: 2026, month: 11, day: 5 }, end: { year: 2026, month: 11, day: 11 } }] } });
    assert.deepEqual((query.body as { metricDefinitions: { filter?: string }[] }).metricDefinitions.map((metric) => metric.filter ?? null), [null, 'auth_type = "spf"', 'auth_type = "dkim"', 'auth_type = "dmarc"']);

    const { secret } = await seedApiKey(db, workspaceId, ['mailboxes:read']);
    const shown = (await call('GET', `/domains/${domainId}`, { key: secret })).body.postmaster;
    assert.deepEqual(shown, { connected: true, synced_at: now.toISOString(), spam_rate: 0.004, auth: { spf: 0.99, dkim: 1, dmarc: 0.98 }, compliance: 'needs_work', needs_work: ['ONE_CLICK_UNSUBSCRIBE'], no_data: false, error: null });

    // Gmail's spam rate counts as complaints, and failing compliance as failing authentication.
    await statsRollup(db, now);
    const [scored] = await db.select().from(sending_domains).where(eq(sending_domains.id, domainId));
    const points = (scored!.reputation_inputs as { points: Record<string, number>; complaint_rate: number }).points;
    assert.equal((scored!.reputation_inputs as { complaint_rate: number }).complaint_rate, 0.004);
    assert.equal(points.authentication, 20);
  });

  it('shows “no data” for a quiet domain, and says when the account can’t see the domain', async () => {
    api = (method, url) => (url.endsWith('domainStats:query') ? { status: 200, body: {} } : { status: 200, body: {} });
    assert.equal((await syncPostmaster(db, { secrets, oauth, http }, new Date())).noData, 1);
    let [domain] = await db.select().from(sending_domains).where(eq(sending_domains.id, domainId));
    assert.deepEqual([(domain!.postmaster_data as { no_data: boolean; spam_rate: null }).no_data, (domain!.postmaster_data as { spam_rate: null }).spam_rate], [true, null]);

    api = () => ({ status: 403, body: {} });
    await syncPostmaster(db, { secrets, oauth, http }, new Date());
    [domain] = await db.select().from(sending_domains).where(eq(sending_domains.id, domainId));
    assert.match((domain!.postmaster_data as { error: string }).error, /no access to getacme\.com/);
  });

  it('disconnects a domain whose Google access was withdrawn', async () => {
    tokenReply = () => ({ status: 400, body: { error: 'invalid_grant' } });
    const result = await syncPostmaster(db, { secrets, oauth, http }, new Date(Date.now() + 3 * 3600_000));
    assert.equal(result.failed, 1);
    const [domain] = await db.select().from(sending_domains).where(eq(sending_domains.id, domainId));
    assert.deepEqual([domain!.postmaster_connected, domain!.postmaster_credentials_enc], [false, null]);
    assert.ok((await db.select().from(activities).where(and(eq(activities.workspace_id, workspaceId), eq(activities.type, 'domain.postmaster_disconnected'))))[0]);
  });
});
