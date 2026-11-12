import assert from 'node:assert/strict';
import { createPublicKey, randomBytes } from 'node:crypto';

import { activities, audit_log, campaigns, contacts, mailboxes, newId, threads, type Db } from '@catalyst/db';
import { createTestDatabase } from '@catalyst/db/testing';
import type { DomainDns } from '@catalyst/email';
import { MemoryQueue } from '@catalyst/jobs';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { call, seedApiKey, seedWorkspace } from '../api/testing.ts';
import { setDb, setDeps } from '../runtime.ts';
import { createSecretBox, parseEncryptionKeys, sealedVersion, SecretKeyError } from '../secrets.ts';
import { smtpAccountFor } from './accounts.ts';

// Needs a PostgreSQL server: set TEST_DATABASE_URL to any database on it.
const adminUrl = process.env.TEST_DATABASE_URL;

const key1 = randomBytes(32).toString('base64');
const key2 = randomBytes(32).toString('base64');

describe('secrets at rest (§16)', () => {
  it('seals with the newest key and opens with any listed key, so keys can rotate', () => {
    const old = createSecretBox(parseEncryptionKeys(`1:${key1}`));
    const sealed = old.seal('app-password');
    assert.ok(!sealed.toString('latin1').includes('app-password'));
    const rotated = createSecretBox(parseEncryptionKeys(`1:${key1},2:${key2}`));
    assert.equal(rotated.activeVersion, 2);
    assert.equal(rotated.open(sealed), 'app-password');
    assert.equal(sealedVersion(rotated.seal('x')), 2);
    assert.notDeepEqual(rotated.seal('same'), rotated.seal('same'), 'every seal uses a fresh IV');
  });

  it('refuses a tampered value, a retired key and malformed key lists', () => {
    const box = createSecretBox(parseEncryptionKeys(`1:${key1}`));
    const sealed = box.seal('secret');
    sealed[sealed.length - 1]! ^= 1;
    assert.throws(() => box.open(sealed));
    assert.throws(() => createSecretBox(parseEncryptionKeys(`2:${key2}`)).open(box.seal('x')), SecretKeyError);
    assert.throws(() => parseEncryptionKeys('nonsense'), SecretKeyError);
    assert.throws(() => parseEncryptionKeys(`1:${randomBytes(16).toString('base64')}`), SecretKeyError);
  });
});

const dns: DomainDns = {
  async resolveTxt(name) {
    if (name === 'getacme.com') return ['v=spf1 include:_spf.google.com ~all'];
    if (name === '_dmarc.getacme.com') return ['v=DMARC1; p=none'];
    return [];
  },
  resolveMx: async (name) => (name === 'getacme.com' ? ['aspmx.l.google.com'] : []),
  resolveCname: async (name) => (name === 'go.getacme.com' ? ['catalyst.example.com.'] : []),
};

describe.skipIf(!adminUrl)('domains, ramps and mailboxes (§8.2, §8.3, §13.4)', () => {
  let db: Db;
  let drop: () => Promise<void>;
  let workspaceId: string;
  let key: string;
  let adminKey: string;
  let readKey: string;
  let otherKey: string;
  const secrets = createSecretBox(parseEncryptionKeys(`1:${key1}`));

  const as = (secret: string) => ({
    get: (path: string) => call('GET', path, { key: secret }),
    post: (path: string, body?: unknown) => call('POST', path, { key: secret, ...(body !== undefined && { body }) }),
    patch: (path: string, body: unknown, headers: Record<string, string> = {}) => call('PATCH', path, { key: secret, body, headers }),
    put: (path: string, body: unknown) => call('PUT', path, { key: secret, body }),
    del: (path: string) => call('DELETE', path, { key: secret }),
  });
  const ok = (response: { status: number; body: any }, status = 200) => {
    assert.equal(response.status, status, JSON.stringify(response.body));
    return response.body;
  };
  const problem = (response: { status: number; body: any }, status: number, code: string) => {
    assert.equal(response.status, status, JSON.stringify(response.body));
    assert.equal(response.body.code, code);
    return response.body as { detail: string; errors?: { path: string; message: string }[] };
  };

  beforeAll(async () => {
    ({ db, drop } = await createTestDatabase(adminUrl!));
    setDb(db);
    setDeps({ jobs: new MemoryQueue(), secrets, domainDns: dns, config: { trackingTarget: 'catalyst.example.com', appHost: 'catalyst.example.com' } });
    workspaceId = await seedWorkspace(db, 'Acme');
    ({ secret: key } = await seedApiKey(db, workspaceId, ['mailboxes:read', 'mailboxes:write']));
    ({ secret: adminKey } = await seedApiKey(db, workspaceId, ['mailboxes:read', 'mailboxes:write', 'settings:manage']));
    ({ secret: readKey } = await seedApiKey(db, workspaceId, ['mailboxes:read']));
    ({ secret: otherKey } = await seedApiKey(db, await seedWorkspace(db, 'Elsewhere'), ['mailboxes:read', 'mailboxes:write', 'settings:manage']));
  });
  afterAll(async () => {
    setDb(undefined);
    setDeps(undefined);
    await drop?.();
  });

  const api = () => as(key);
  let domainId: string;
  let mailboxId: string;

  it('adds a domain on the new-domain ramp, once, with its tracking host on the domain', async () => {
    const domain = ok(await api().post('/domains', { domain: 'GetAcme.com', tracking_host: 'go.getacme.com' }), 201);
    domainId = domain.id;
    assert.deepEqual([domain.domain, domain.reputation_band, domain.ramp.plan, domain.ramp.step, domain.checks, domain.mailbox_count], ['getacme.com', 'healthy', 'new_domain', 0, null, 0]);
    problem(await api().post('/domains', { domain: 'getacme.com' }), 409, 'conflict');
    problem(await api().post('/domains', { domain: 'other.com', tracking_host: 'track.shared-tracker.com' }), 400, 'validation_failed');
    problem(await as(readKey).post('/domains', { domain: 'x.com' }), 403, 'forbidden_scope');
    problem(await as(otherKey).get(`/domains/${domainId}`), 404, 'not_found');
    // Before any mailbox the ramp has nowhere to go: every step's cap is 0, not an error (found by the E2E suite).
    const ramp = ok(await api().get(`/domains/${domainId}/ramp`));
    assert.deepEqual([ramp.mailbox_cap_total, ramp.final_step, ramp.today_cap, ramp.schedule], [0, 0, 0, [{ step: 0, cap: 0 }]]);
  });

  it('connects a Google mailbox with the provider presets, keeping the password encrypted and out of every response', async () => {
    problem(await api().post('/mailboxes', { email: 'sam@unknown.com', display_name: 'Sam', provider: 'google', password: 'x' }), 400, 'validation_failed');
    const created = await api().post('/mailboxes', { email: 'Alex@GetAcme.com', display_name: 'Alex Rivera', provider: 'google', password: 'app-password-1' });
    const mailbox = ok(created, 201);
    mailboxId = mailbox.id;
    assert.deepEqual(
      [mailbox.email, mailbox.provider, mailbox.smtp_host, mailbox.smtp_port, mailbox.smtp_secure, mailbox.imap_host, mailbox.status, mailbox.today_cap, mailbox.folders.sent],
      ['alex@getacme.com', 'google', 'smtp.gmail.com', 465, 'tls', 'imap.gmail.com', 'pending', 10, '[Gmail]/Sent Mail'],
    );
    assert.ok(!JSON.stringify(mailbox).includes('app-password'));
    const [row] = await db.select().from(mailboxes).where(eq(mailboxes.id, mailboxId));
    assert.deepEqual(JSON.parse(secrets.open(row!.credentials_enc)), { password: 'app-password-1' });
    problem(await api().post('/mailboxes', { email: 'alex@getacme.com', display_name: 'Alex', provider: 'google', password: 'x' }), 409, 'conflict');
    problem(await api().post('/mailboxes', { email: 'sam@getacme.com', display_name: 'Sam', provider: 'other', password: 'x' }), 400, 'validation_failed');
  });

  it('holds mailboxes to the fixed limits (§8.3.4)', async () => {
    const tooHigh = problem(await api().post('/mailboxes', { email: 'big@getacme.com', display_name: 'Big', provider: 'google', password: 'x', daily_limit: 200 }), 400, 'validation_failed');
    assert.match(tooHigh.errors![0]!.message, /settings:manage/);
    ok(await as(adminKey).post('/mailboxes', { email: 'big@getacme.com', display_name: 'Big', provider: 'google', password: 'x', daily_limit: 200 }), 201);
    problem(await api().post('/mailboxes', { email: 'cold@getacme.com', display_name: 'Cold', provider: 'google', password: 'x', warmup_enabled: false }), 400, 'validation_failed');
    problem(await api().patch(`/mailboxes/${mailboxId}`, { min_interval_sec: 300, max_interval_sec: 200 }), 400, 'validation_failed');
    problem(await api().patch(`/mailboxes/${mailboxId}`, { min_interval_sec: 30 }), 400, 'validation_failed');
  });

  it('audits limit and credential changes, and a new password needs the connection test again', async () => {
    await db.update(mailboxes).set({ status: 'active' }).where(eq(mailboxes.id, mailboxId));
    const fetched = await api().get(`/mailboxes/${mailboxId}`);
    const updated = ok(await api().patch(`/mailboxes/${mailboxId}`, { daily_limit: 30, signature_text: 'Alex' }, { 'if-match': fetched.headers.get('etag')! }));
    assert.equal(updated.daily_limit, 30);
    problem(await api().patch(`/mailboxes/${mailboxId}`, { hourly_limit: 10 }, { 'if-match': fetched.headers.get('etag')! }), 412, 'precondition_failed');
    const repassed = ok(await api().patch(`/mailboxes/${mailboxId}`, { password: 'app-password-2' }));
    assert.equal(repassed.status, 'pending');
    const actions = (await db.select().from(audit_log).where(eq(audit_log.target_id, mailboxId))).map((entry) => entry.action);
    assert.deepEqual(actions.sort(), ['mailbox.connected', 'mailbox.credentials_changed', 'mailbox.limits_changed']);
    await db.update(mailboxes).set({ status: 'active', status_reason: null }).where(eq(mailboxes.id, mailboxId));
  });

  it('pauses and resumes; a breaker pause needs the cause acknowledged, which is audited', async () => {
    const paused = ok(await api().post(`/mailboxes/${mailboxId}/pause`, { reason: 'Vacation' }));
    assert.deepEqual([paused.status, paused.status_reason], ['paused', 'Paused by hand: Vacation']);
    problem(await api().post(`/mailboxes/${mailboxId}/pause`, {}), 409, 'conflict');
    assert.equal(ok(await api().post(`/mailboxes/${mailboxId}/resume`, {})).status, 'active');

    await db.update(mailboxes).set({ status: 'paused', status_reason: 'breaker: hard bounces 4.4% over 7 days' }).where(eq(mailboxes.id, mailboxId));
    const refused = problem(await api().post(`/mailboxes/${mailboxId}/resume`, {}), 400, 'validation_failed');
    assert.match(refused.errors![0]!.message, /hard bounces 4\.4%/);
    assert.equal(ok(await api().post(`/mailboxes/${mailboxId}/resume`, { acknowledge_cause: true })).status, 'active');
    const [acknowledged] = await db.select().from(audit_log).where(and(eq(audit_log.target_id, mailboxId), eq(audit_log.action, 'mailbox.breaker_acknowledged')));
    assert.ok(acknowledged);
    const types = (await db.select({ type: activities.type }).from(activities)).map((entry) => entry.type);
    assert.ok(types.includes('mailbox.paused') && types.includes('mailbox.resumed'));
  });

  it('signs a generic host’s mail with a DKIM key of Catalyst’s own, shared across the domain (§7.1)', async () => {
    const generic = (email: string) => ({ email, display_name: 'Ops', provider: 'other', password: 'x', smtp_host: 'mail.getacme.com', smtp_port: 587, smtp_secure: 'starttls', imap_host: 'mail.getacme.com' });
    const first = ok(await api().post('/mailboxes', generic('ops@getacme.com')), 201);
    const second = ok(await api().post('/mailboxes', generic('ops2@getacme.com')), 201);
    assert.equal(first.catalyst_dkim, null);

    const signed = ok(await api().post(`/mailboxes/${first.id}/dkim`, {}));
    assert.equal(signed.catalyst_dkim.record_name, 'catalyst._domainkey.getacme.com');
    assert.match(signed.catalyst_dkim.record_value, /^v=DKIM1; k=rsa; p=[A-Za-z0-9+/=]{300,}$/);
    assert.ok(!JSON.stringify(signed).includes('PRIVATE KEY') && !JSON.stringify(signed).includes('private_key'), 'the private key never leaves');
    assert.ok(ok(await api().get(`/domains/${domainId}`)).dkim_selectors.includes('catalyst'), 'the DNS check looks for it');
    const [row] = await db.select().from(mailboxes).where(eq(mailboxes.id, first.id));
    const account = smtpAccountFor(row!, secrets);
    assert.deepEqual([account.dkim?.domainName, account.dkim?.keySelector], ['getacme.com', 'catalyst']);
    const publicKey = createPublicKey(account.dkim!.privateKey).export({ type: 'spki', format: 'der' }).toString('base64');
    assert.equal(signed.catalyst_dkim.record_value, `v=DKIM1; k=rsa; p=${publicKey}`, 'the record is the signing key’s');

    assert.equal(ok(await api().post(`/mailboxes/${second.id}/dkim`, {})).catalyst_dkim.record_value, signed.catalyst_dkim.record_value, 'one record for the domain');
    problem(await api().post(`/mailboxes/${first.id}/dkim`, {}), 409, 'conflict');
    problem(await api().post(`/mailboxes/${mailboxId}/dkim`, {}), 409, 'conflict');
    problem(await as(otherKey).post(`/mailboxes/${first.id}/dkim`, {}), 404, 'not_found');

    assert.equal(ok(await api().del(`/mailboxes/${first.id}/dkim`)).catalyst_dkim, null);
    assert.ok(ok(await api().get(`/domains/${domainId}`)).dkim_selectors.includes('catalyst'), 'still used by the other mailbox');
    ok(await api().del(`/mailboxes/${second.id}/dkim`));
    assert.ok(!ok(await api().get(`/domains/${domainId}`)).dkim_selectors.includes('catalyst'));
    problem(await api().del(`/mailboxes/${second.id}/dkim`), 409, 'conflict');
    assert.equal((await api().del(`/mailboxes/${first.id}`)).status, 204);
    assert.equal((await api().del(`/mailboxes/${second.id}`)).status, 204);
    assert.ok((await db.select().from(audit_log).where(eq(audit_log.action, 'mailbox.dkim_key_created'))).length === 2);
  });

  it('checks DNS record by record and stores the result', async () => {
    const checked = ok(await api().post(`/domains/${domainId}/check`));
    assert.deepEqual(
      [checked.checks.spf.status, checked.checks.dkim.status, checked.checks.dmarc.status, checked.checks.mx.status, checked.checks.tracking.status, checked.checks.ready],
      ['pass', 'fail', 'warn', 'pass', 'pass', false],
    );
    assert.equal(checked.checks.dkim.name, 'google._domainkey.getacme.com', 'the Google selector comes from the mailbox provider');
    assert.ok(checked.last_checked_at);
    assert.deepEqual(ok(await api().get(`/domains/${domainId}`)).checks.dmarc.status, 'warn');
  });

  it('shows the ramp schedule up to the total of the mailbox caps', async () => {
    const ramp = ok(await api().get(`/domains/${domainId}/ramp`));
    // alex (30, active) and big (200, pending) count toward the ceiling.
    assert.equal(ramp.mailbox_cap_total, 230);
    assert.deepEqual(ramp.schedule.slice(0, 6).map((entry: { cap: number }) => entry.cap), [20, 23, 26, 30, 35, 40]);
    assert.deepEqual([ramp.step, ramp.today_cap, ramp.tomorrow_cap, ramp.schedule.at(-1).cap], [0, 20, 23, 230]);
  });

  it('lets only admins change the ramp, with a reason, and records each change (§8.3.6)', async () => {
    problem(await api().post(`/domains/${domainId}/ramp/hold`, { reason: 'Checking the list' }), 403, 'forbidden_scope');
    const admin = as(adminKey);
    await db.execute(`update sending_domains set ramp_step = 5 where id = '${domainId}'`);
    const held = ok(await admin.post(`/domains/${domainId}/ramp/hold`, { reason: 'Checking the list' }));
    assert.deepEqual([held.status, held.manual_hold, held.tomorrow_cap], ['holding', true, 40]);
    problem(await admin.post(`/domains/${domainId}/ramp/hold`, { reason: 'Again please' }), 409, 'conflict');
    problem(await admin.post(`/domains/${domainId}/ramp/hold`, { reason: '' }), 400, 'validation_failed');
    assert.equal(ok(await admin.post(`/domains/${domainId}/ramp/resume`, { reason: 'List cleaned' })).status, 'ramping');
    const back = ok(await admin.post(`/domains/${domainId}/ramp/step-back`, { steps: 2, reason: 'Bounce spike' }));
    assert.deepEqual([back.step, back.status, back.today_cap], [3, 'stepped_back', 30]);

    const custom = ok(await admin.patch(`/domains/${domainId}/ramp`, { plan: 'custom', custom_schedule: [{ step: 0, cap: 10 }, { step: 1, cap: 15 }, { step: 2, cap: 20 }], reason: 'Very careful start' }));
    assert.deepEqual([custom.plan, custom.step, custom.final_step, custom.status], ['custom', 2, 2, 'complete']);
    const steep = problem(await admin.patch(`/domains/${domainId}/ramp`, { plan: 'custom', custom_schedule: [{ step: 0, cap: 10 }, { step: 1, cap: 20 }], reason: 'Too steep' }), 400, 'validation_failed');
    assert.match(steep.errors![0]!.message, /more than 50%/);
    ok(await admin.patch(`/domains/${domainId}/ramp`, { plan: 'new_domain', reason: 'Back to normal' }));

    const events = (await db.select({ type: activities.type, data: activities.data }).from(activities)).filter((entry) => entry.type.startsWith('domain.'));
    assert.deepEqual(events.map((entry) => entry.type), ['domain.ramp_held', 'domain.ramp_resumed', 'domain.ramp_stepped_back', 'domain.ramp_plan_changed', 'domain.ramp_plan_changed']);
    assert.equal((events[0]!.data as { reason: string }).reason, 'Checking the list');
    assert.equal((await db.select().from(audit_log).where(eq(audit_log.target_id, domainId))).length, 6, 'creation plus five ramp changes');
  });

  it('accepts a +50% cap override for up to 14 days and refuses +80% (IT-24)', async () => {
    const admin = as(adminKey);
    const ramp = ok(await admin.get(`/domains/${domainId}/ramp`));
    const stepCap = ramp.schedule[ramp.step].cap as number;
    const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

    const raised = ok(await admin.put(`/domains/${domainId}/cap-override`, { cap: Math.floor(stepCap * 1.5), until: inDays(3), reason: 'Webinar follow-up week' }));
    assert.deepEqual(raised.cap_override, { cap: Math.floor(stepCap * 1.5), until: inDays(3), reason: 'Webinar follow-up week' });
    assert.equal(raised.today_cap, Math.floor(stepCap * 1.5));
    const tooHigh = problem(await admin.put(`/domains/${domainId}/cap-override`, { cap: Math.ceil(stepCap * 1.8), until: inDays(3), reason: 'Even more' }), 400, 'validation_failed');
    assert.equal(tooHigh.errors![0]!.path, 'body.cap');
    problem(await admin.put(`/domains/${domainId}/cap-override`, { cap: 1, until: inDays(15), reason: 'Too long' }), 400, 'validation_failed');
    assert.equal((await admin.del(`/domains/${domainId}/cap-override`)).status, 204);
    problem(await admin.del(`/domains/${domainId}/cap-override`), 409, 'conflict');
    assert.equal(ok(await admin.get(`/domains/${domainId}`)).ramp.cap_override, null);
  });

  it('reports reputation and stats, and refuses to delete what is in use', async () => {
    const reputation = ok(await api().get(`/domains/${domainId}/reputation`));
    assert.deepEqual([reputation.score, reputation.band, reputation.history], [100, 'healthy', []]);
    const stats = ok(await api().get(`/mailboxes/${mailboxId}/stats?days=7`));
    assert.deepEqual([stats.days, stats.totals.sent], [[], 0]);
    assert.deepEqual(ok(await api().get(`/mailboxes/${mailboxId}/poll-runs`)), { data: [], next_cursor: null });
    assert.equal(ok(await api().get(`/mailboxes?domain_id=${domainId}&status=active`)).data.length, 1);

    problem(await api().del(`/domains/${domainId}`), 409, 'conflict');
    const campaignId = newId('campaign');
    await db.insert(campaigns).values({ id: campaignId, workspace_id: workspaceId, name: 'Q4', objective: 'x', persona: {}, sending_window: {} });
    const contactId = newId('contact');
    await db.insert(contacts).values({ id: contactId, workspace_id: workspaceId, email: 'p@globex.com' });
    await db.insert(threads).values({ id: newId('thread'), workspace_id: workspaceId, campaign_id: campaignId, contact_id: contactId, mailbox_id: mailboxId });
    problem(await api().del(`/mailboxes/${mailboxId}`), 409, 'conflict');
    const big = ok(await api().get('/mailboxes')).data.find((entry: { email: string }) => entry.email === 'big@getacme.com');
    assert.equal((await api().del(`/mailboxes/${big.id}`)).status, 204);
  });
});
