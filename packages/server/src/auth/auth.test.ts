import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import { audit_log, auth_users, newId, users, type Db } from '@catalyst/db';
import { createTestDatabase } from '@catalyst/db/testing';
import { MemoryQueue } from '@catalyst/jobs';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { call, seedWorkspace } from '../api/testing.ts';
import { authHandler, setDb, setDeps } from '../runtime.ts';

// Needs a PostgreSQL server: set TEST_DATABASE_URL to any database on it.
const adminUrl = process.env.TEST_DATABASE_URL;
const APP = 'http://localhost:3000';
const PASSWORD = 'correct horse battery staple';

/** RFC 6238 TOTP, as an authenticator app computes it: SHA-1, 30 s, 6 digits. */
function totp(base32: string, at = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = [...base32.replace(/=+$/, '').toUpperCase()].map((char) => alphabet.indexOf(char).toString(2).padStart(5, '0')).join('');
  const key = Buffer.from(bits.match(/.{8}/g)!.map((byte) => parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const mac = createHmac('sha1', key).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0xf;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

describe.skipIf(!adminUrl)('signed-in people: Better Auth sessions (§13.2, §16)', () => {
  let db: Db;
  let drop: () => Promise<void>;
  let workspaceId: string;
  let ip = 0;
  const mail: { to: string; subject: string; text: string }[] = [];

  /** A call to `/api/auth/*` as the app's own sign-in page would make it, from its own address. */
  const auth = (path: string, body: Record<string, unknown>, headers: Record<string, string> = {}) =>
    authHandler(new Request(`${APP}/api/auth${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: APP, 'x-forwarded-for': `203.0.113.${(ip += 1)}`, ...headers }, body: JSON.stringify(body) }));
  const cookieOf = (response: Response) => response.headers.getSetCookie().map((cookie) => cookie.split(';')[0]).join('; ');
  const invite = async (email: string, role: 'owner' | 'admin' | 'member' | 'viewer') => {
    const id = newId('user');
    await db.insert(users).values({ id, workspace_id: workspaceId, email, name: email.split('@')[0]!, role });
    return id;
  };
  const signUp = async (email: string) => {
    const response = await auth('/sign-up/email', { email, password: PASSWORD, name: email.split('@')[0] });
    assert.equal(response.status, 200, await response.clone().text());
    return cookieOf(response);
  };

  beforeAll(async () => {
    ({ db, drop } = await createTestDatabase(adminUrl!));
    setDb(db);
    setDeps({ jobs: new MemoryQueue(), config: { trackingTarget: null, appHost: null, auth: { secret: 'a-test-secret-that-is-long-enough-to-sign-cookies', baseURL: APP, trustedOrigins: [APP], secureCookies: false, mailer: { send: async (message) => void mail.push(message) } } } });
    workspaceId = await seedWorkspace(db, 'Acme');
  });
  afterAll(async () => {
    setDb(undefined);
    setDeps(undefined);
    await drop?.();
  });

  it('lets an invited person make an account and sign in; a stranger can’t', async () => {
    const stranger = await auth('/sign-up/email', { email: 'stranger@elsewhere.example', password: PASSWORD, name: 'Stranger' });
    assert.notEqual(stranger.status, 200);
    assert.equal((await db.select().from(auth_users).where(eq(auth_users.email, 'stranger@elsewhere.example'))).length, 0);

    const ownerId = await invite('mia@getacme.com', 'owner');
    assert.equal((await auth('/sign-up/email', { email: 'mia@getacme.com', password: 'short', name: 'Mia' })).status, 400, 'at least 12 characters');
    const cookie = await signUp('mia@getacme.com');
    assert.match(cookie, /catalyst\.session_token=/);

    const me = await call('GET', '/me', { headers: { cookie } });
    assert.equal(me.status, 200, JSON.stringify(me.body));
    assert.deepEqual([me.body.kind, me.body.id, me.body.role, me.body.workspace.id], ['user', ownerId, 'owner', workspaceId]);
    assert.ok(me.body.scopes.includes('settings:manage'));
    const [owner] = await db.select().from(users).where(eq(users.id, ownerId));
    assert.ok(owner!.last_login_at, 'the login is recorded');
    assert.ok((await db.select().from(audit_log).where(and(eq(audit_log.actor_id, ownerId), eq(audit_log.action, 'user.login'))))[0]);

    assert.equal((await auth('/sign-in/email', { email: 'mia@getacme.com', password: 'wrong password here' })).status, 401);
    const again = await auth('/sign-in/email', { email: 'mia@getacme.com', password: PASSWORD });
    assert.equal(again.status, 200);
    assert.equal((await call('GET', '/me', { headers: { cookie: cookieOf(again) } })).status, 200);
    assert.equal((await call('GET', '/me', { headers: { cookie: 'catalyst.session_token=forged' } })).status, 401);
  });

  it('gives each role its scopes (§16): members work threads, viewers only read', async () => {
    await invite('sam@getacme.com', 'member');
    await invite('vic@getacme.com', 'viewer');
    const member = await signUp('sam@getacme.com');
    const viewer = await signUp('vic@getacme.com');
    assert.equal((await call('GET', '/threads', { headers: { cookie: member } })).status, 200);
    assert.equal((await call('GET', '/settings', { headers: { cookie: member } })).status, 403, 'settings are for owners and admins');
    assert.equal((await call('GET', '/threads', { headers: { cookie: viewer } })).status, 200);
    const write = await call('POST', '/tags', { headers: { cookie: viewer, origin: APP }, body: { name: 'hot' } });
    assert.equal(write.status, 403, 'viewers read only');
  });

  it('refuses a change made with the cookie from another site (CSRF), and lets owners manage API keys', async () => {
    await invite('ada@getacme.com', 'admin');
    const cookie = await signUp('ada@getacme.com');
    const body = { name: 'Claude Code (draft only)', scopes: ['threads:read', 'threads:write'] };
    assert.equal((await call('POST', '/api-keys', { headers: { cookie, origin: 'https://evil.example' }, body })).status, 403);
    assert.equal((await call('POST', '/api-keys', { headers: { cookie }, body })).status, 403, 'no origin at all is refused too');
    const created = await call('POST', '/api-keys', { headers: { cookie, origin: APP }, body });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal((await call('GET', '/me', { key: created.body.secret })).body.kind, 'api_key');
    const listed = await call('GET', '/api-keys', { headers: { cookie } });
    assert.ok(listed.body.data.some((key: { id: string }) => key.id === created.body.id), 'reads need no origin');
    assert.equal((await call('DELETE', `/api-keys/${created.body.id}`, { headers: { cookie, origin: APP } })).status, 200);
  });

  it('ends a removed person’s access at once', async () => {
    const id = await invite('leo@getacme.com', 'member');
    const cookie = await signUp('leo@getacme.com');
    assert.equal((await call('GET', '/me', { headers: { cookie } })).status, 200);
    await db.update(users).set({ deactivated_at: new Date() }).where(eq(users.id, id));
    assert.equal((await call('GET', '/me', { headers: { cookie } })).status, 401);
  });

  it('resets a forgotten password by email, which signs the person out everywhere', async () => {
    await invite('rita@getacme.com', 'member');
    const old = await signUp('rita@getacme.com');
    assert.equal((await auth('/request-password-reset', { email: 'rita@getacme.com', redirectTo: `${APP}/reset-password` })).status, 200);
    const letter = mail.find((message) => message.to === 'rita@getacme.com');
    assert.equal(letter?.subject, 'Reset your Catalyst password');
    const token = /reset-password\/([^?\s]+)/.exec(letter!.text)?.[1];
    assert.ok(token, letter!.text);
    assert.equal((await auth('/reset-password', { newPassword: 'a brand new long password', token })).status, 200);
    assert.equal((await call('GET', '/me', { headers: { cookie: old } })).status, 401, 'the old session is gone');
    assert.equal((await auth('/sign-in/email', { email: 'rita@getacme.com', password: PASSWORD })).status, 401);
    assert.equal((await auth('/sign-in/email', { email: 'rita@getacme.com', password: 'a brand new long password' })).status, 200);
    assert.ok((await db.select().from(audit_log).where(eq(audit_log.action, 'user.password_reset')))[0]);

    const sent = mail.length;
    assert.equal((await auth('/request-password-reset', { email: 'nobody@getacme.com', redirectTo: `${APP}/reset-password` })).status, 200, 'the same answer either way');
    assert.equal(mail.length, sent, 'but nothing is sent');
  });

  it('asks for a TOTP code once two-factor is on, and holds owners to it when the workspace says so', async () => {
    await invite('tom@getacme.com', 'owner');
    let cookie = await signUp('tom@getacme.com');
    assert.equal((await call('PATCH', '/settings', { headers: { cookie, origin: APP }, body: { security: { require_owner_two_factor: true } } })).status, 200);
    assert.equal((await call('GET', '/me', { headers: { cookie } })).body.two_factor_required, true);
    const held = await call('GET', '/settings', { headers: { cookie } });
    assert.deepEqual([held.status, held.body.code], [403, 'two_factor_required'], 'nothing else until it is set up');

    // Set up: the authenticator gets the secret, and a first code confirms it.
    const enabled = await auth('/two-factor/enable', { password: PASSWORD }, { cookie });
    assert.equal(enabled.status, 200, await enabled.clone().text());
    const { totpURI, backupCodes } = (await enabled.json()) as { totpURI: string; backupCodes: string[] };
    assert.ok(backupCodes.length > 0);
    const secret = new URL(totpURI).searchParams.get('secret')!;
    const confirmed = await auth('/two-factor/verify-totp', { code: totp(secret) }, { cookie });
    assert.equal(confirmed.status, 200, await confirmed.clone().text());
    cookie = cookieOf(confirmed) || cookie;
    assert.equal((await call('GET', '/settings', { headers: { cookie } })).status, 200);

    // Signing in now takes the password, then a code.
    const first = await auth('/sign-in/email', { email: 'tom@getacme.com', password: PASSWORD });
    assert.equal(((await first.clone().json()) as { twoFactorRedirect?: boolean }).twoFactorRedirect, true);
    const pending = cookieOf(first);
    assert.equal((await call('GET', '/me', { headers: { cookie: pending } })).status, 401, 'no session before the code');
    assert.notEqual((await auth('/two-factor/verify-totp', { code: '000000' === totp(secret) ? '111111' : '000000' }, { cookie: pending })).status, 200);
    const second = await auth('/two-factor/verify-totp', { code: totp(secret) }, { cookie: pending });
    assert.equal(second.status, 200, await second.clone().text());
    assert.equal((await call('GET', '/me', { headers: { cookie: cookieOf(second) } })).body.two_factor_required, false);
    await call('PATCH', '/settings', { headers: { cookie: cookieOf(second), origin: APP }, body: { security: { require_owner_two_factor: false } } });
  });

  it('throttles sign-in attempts (§16)', async () => {
    await invite('max@getacme.com', 'member');
    await signUp('max@getacme.com');
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) statuses.push((await auth('/sign-in/email', { email: 'max@getacme.com', password: 'not the password' }, { 'x-forwarded-for': '198.51.100.9' })).status);
    assert.deepEqual(statuses, [401, 401, 401, 401, 401, 429], 'five a minute from one address');
  });
});
