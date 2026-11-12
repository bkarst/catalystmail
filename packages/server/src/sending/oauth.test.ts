import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';

import { mailboxes, newId, sending_domains, users, type Db } from '@catalyst/db';
import { createTestDatabase } from '@catalyst/db/testing';
import { MemoryQueue } from '@catalyst/jobs';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { seedApiKey, seedWorkspace } from '../api/testing.ts';
import { authHandler, setDb, setDeps } from '../runtime.ts';
import { createSecretBox, parseEncryptionKeys } from '../secrets.ts';
import { liveSmtpAccount } from './accounts.ts';
import { freshAccessToken, type OAuthHttp } from './oauth.ts';
import { oauthCallback, oauthStart } from './oauth-routes.ts';

// Needs a PostgreSQL server: set TEST_DATABASE_URL to any database on it.
const adminUrl = process.env.TEST_DATABASE_URL;
const APP = 'http://localhost:3000';
/** An ID token as a provider's token endpoint returns it; only its claims are read. */
const idToken = (claims: Record<string, unknown>) => `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;

describe.skipIf(!adminUrl)('mailbox OAuth for Google Workspace and Microsoft 365 (§7.1)', () => {
  let db: Db;
  let drop: () => Promise<void>;
  let workspaceId: string;
  let cookie: string;
  const secrets = createSecretBox(parseEncryptionKeys(`1:${randomBytes(32).toString('base64')}`));
  const calls: { url: string; form: Record<string, string> }[] = [];
  let reply: (form: Record<string, string>) => { status: number; body: Record<string, unknown> } = () => ({ status: 500, body: {} });
  const http: OAuthHttp = { postForm: async (url, form) => (calls.push({ url, form }), reply(form)) };

  beforeAll(async () => {
    ({ db, drop } = await createTestDatabase(adminUrl!));
    setDb(db);
    setDeps({ jobs: new MemoryQueue(), secrets, oauth: { google: { clientId: 'google-client', clientSecret: 'google-secret' }, microsoft: null, http }, config: { trackingTarget: null, appHost: null, appUrl: APP, auth: { secret: 'a-test-secret-that-is-long-enough-to-sign-cookies', baseURL: APP, trustedOrigins: [APP], secureCookies: false } } });
    workspaceId = await seedWorkspace(db, 'Acme');
    await db.insert(sending_domains).values({ id: newId('domain'), workspace_id: workspaceId, domain: 'getacme.com' });
    await db.insert(users).values({ id: newId('user'), workspace_id: workspaceId, email: 'ada@getacme.com', name: 'Ada', role: 'admin' });
    const signUp = await authHandler(new Request(`${APP}/api/auth/sign-up/email`, { method: 'POST', headers: { 'content-type': 'application/json', origin: APP, 'x-forwarded-for': '203.0.113.60' }, body: JSON.stringify({ email: 'ada@getacme.com', password: 'correct horse battery staple', name: 'Ada' }) }));
    cookie = signUp.headers.getSetCookie().map((line) => line.split(';')[0]).join('; ');
  });
  afterAll(async () => {
    setDb(undefined);
    setDeps(undefined);
    await drop?.();
  });

  /** Start, then come back from Google with `claims` in the ID token. */
  async function connect(email: string, claims: Record<string, unknown>) {
    const started = await oauthStart(new Request(`${APP}/api/v1/oauth/google/start?email=${encodeURIComponent(email)}&display_name=Alex`, { headers: { cookie } }), 'google');
    assert.equal(started.status, 302, await started.clone().text());
    const location = new URL(started.headers.get('location')!);
    const verifier = /catalyst_oauth_pkce=([^;]+)/.exec(started.headers.get('set-cookie')!)![1]!;
    reply = (form) => (form.grant_type === 'authorization_code' ? { status: 200, body: { access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600, id_token: idToken(claims) } } : { status: 400, body: { error: 'unsupported' } });
    const back = await oauthCallback(new Request(`${APP}/api/v1/oauth/google/callback?code=the-code&state=${encodeURIComponent(location.searchParams.get('state')!)}`, { headers: { cookie: `${cookie}; catalyst_oauth_pkce=${verifier}` } }), 'google');
    return { location, verifier, back };
  }

  it('sends an admin to Google with a signed state and PKCE, and adds the mailbox it comes back with', async () => {
    const { location, verifier, back } = await connect('alex@getacme.com', { email: 'alex@getacme.com' });
    assert.equal(location.origin + location.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.deepEqual([location.searchParams.get('client_id'), location.searchParams.get('redirect_uri'), location.searchParams.get('login_hint'), location.searchParams.get('access_type')], ['google-client', `${APP}/api/v1/oauth/google/callback`, 'alex@getacme.com', 'offline']);
    assert.ok(location.searchParams.get('scope')!.split(' ').includes('https://mail.google.com/'));
    assert.equal(location.searchParams.get('code_challenge'), createHash('sha256').update(verifier).digest('base64url'));

    assert.equal(back.status, 302);
    const exchange = calls.at(-1)!;
    assert.deepEqual([exchange.url, exchange.form.code, exchange.form.code_verifier, exchange.form.client_secret], ['https://oauth2.googleapis.com/token', 'the-code', verifier, 'google-secret']);
    const [mailbox] = await db.select().from(mailboxes).where(eq(mailboxes.email, 'alex@getacme.com'));
    assert.equal(back.headers.get('location'), `${APP}/deliverability/mailboxes/${mailbox!.id}?connected=1`);
    assert.deepEqual([mailbox!.auth, mailbox!.smtp_host, mailbox!.imap_host, mailbox!.status, mailbox!.display_name], ['oauth2_google', 'smtp.gmail.com', 'imap.gmail.com', 'pending', 'Alex']);
    assert.equal(JSON.parse(secrets.open(mailbox!.credentials_enc)).refresh_token, 'refresh-1', 'the refresh token is kept, sealed');
    const account = await liveSmtpAccount(db, mailbox!, secrets, { google: { clientId: 'google-client', clientSecret: 'google-secret' }, http }, new Date());
    assert.deepEqual(account.auth, { type: 'oauth2', accessToken: 'access-1' });
  });

  it('refuses a different account, a forged state and an API key', async () => {
    const { back } = await connect('sam@getacme.com', { email: 'someone@gmail.com' });
    assert.match(decodeURIComponent(back.headers.get('location')!), /oauth_error=You signed in as someone@gmail\.com, not sam@getacme\.com/);
    assert.equal((await db.select().from(mailboxes).where(eq(mailboxes.email, 'sam@getacme.com'))).length, 0);

    const forged = await oauthCallback(new Request(`${APP}/api/v1/oauth/google/callback?code=x&state=eyJ9.forged`, { headers: { cookie: `${cookie}; catalyst_oauth_pkce=v` } }), 'google');
    assert.match(decodeURIComponent(forged.headers.get('location')!), /invalid or expired/);
    const { secret } = await seedApiKey(db, workspaceId, ['mailboxes:write']);
    assert.equal((await oauthStart(new Request(`${APP}/api/v1/oauth/google/start?email=x@getacme.com`, { headers: { authorization: `Bearer ${secret}` } }), 'google')).status, 401, 'session only');
    assert.equal((await oauthStart(new Request(`${APP}/api/v1/oauth/google/start?email=x@other.com`, { headers: { cookie } }), 'google')).status, 400, 'the domain comes first');
    assert.equal((await oauthStart(new Request(`${APP}/api/v1/oauth/microsoft/start?email=x@getacme.com`, { headers: { cookie } }), 'microsoft')).status, 409, 'Microsoft isn’t set up here');
  });

  it('refreshes an expired access token, and puts the mailbox in error when Google says no', async () => {
    const [mailbox] = await db.select().from(mailboxes).where(eq(mailboxes.email, 'alex@getacme.com'));
    const oauth = { google: { clientId: 'google-client', clientSecret: 'google-secret' }, http };
    const before = calls.length;
    assert.equal(await freshAccessToken(db, mailbox!, secrets, oauth, new Date()), 'access-1');
    assert.equal(calls.length, before, 'a token with time left is used as it is');

    const later = new Date(Date.now() + 2 * 3600_000);
    reply = (form) => (form.grant_type === 'refresh_token' && form.refresh_token === 'refresh-1' ? { status: 200, body: { access_token: 'access-2', expires_in: 3600 } } : { status: 400, body: { error: 'invalid_request' } });
    assert.equal(await freshAccessToken(db, mailbox!, secrets, oauth, later), 'access-2');
    const [renewed] = await db.select().from(mailboxes).where(eq(mailboxes.id, mailbox!.id));
    assert.deepEqual(JSON.parse(secrets.open(renewed!.credentials_enc)), { refresh_token: 'refresh-1', access_token: 'access-2', expires_at: new Date(later.getTime() + 3600_000).toISOString() });

    reply = () => ({ status: 400, body: { error: 'invalid_grant' } });
    await assert.rejects(freshAccessToken(db, renewed!, secrets, oauth, new Date(later.getTime() + 2 * 3600_000)), /invalid_grant/);
    const [broken] = await db.select().from(mailboxes).where(eq(mailboxes.id, mailbox!.id));
    assert.deepEqual([broken!.status, /Connect the mailbox again/.test(broken!.status_reason!)], ['error', true]);
  });
});
