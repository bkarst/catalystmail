import assert from 'node:assert/strict';

import { audit_log, newId, users, type Db } from '@catalyst/db';
import { createTestDatabase } from '@catalyst/db/testing';
import { MemoryQueue } from '@catalyst/jobs';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, it } from 'vitest';

import type { Principal } from '../api/auth.ts';
import { call, seedApiKey, seedWorkspace } from '../api/testing.ts';
import { runCli } from '../cli/bootstrap.ts';
import { setDb, setDeps } from '../runtime.ts';
import { createApiKey, listApiKeys, revokeApiKey } from './service.ts';

// Needs a PostgreSQL server: set TEST_DATABASE_URL to any database on it.
const adminUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!adminUrl)('API keys (§13.2, §13.4)', () => {
  let db: Db;
  let drop: () => Promise<void>;
  let workspaceId: string;
  const now = new Date();
  /** A signed-in person (sessions aren't built yet, so the services are called as one). */
  const person = async (role: NonNullable<Principal['role']>, workspace = workspaceId): Promise<Principal> => {
    const id = newId('user');
    await db.insert(users).values({ id, workspace_id: workspace, email: `${id.slice(-8)}@getacme.com`, name: 'Mia', role });
    return { kind: 'user', id, name: 'Mia', role, scopes: [], workspace: { id: workspace, name: 'Acme' } };
  };

  beforeAll(async () => {
    ({ db, drop } = await createTestDatabase(adminUrl!));
    setDb(db);
    setDeps({ jobs: new MemoryQueue(), config: { trackingTarget: null, appHost: null } });
    workspaceId = await seedWorkspace(db, 'Acme');
  });
  afterAll(async () => {
    setDb(undefined);
    setDeps(undefined);
    await drop?.();
  });

  it('lets an owner or admin make a key, shown once, that works until revoked', async () => {
    const admin = await person('admin');
    const created = await createApiKey(db, admin, { name: 'Claude Code (draft only)', scopes: ['threads:read', 'threads:write'] }, now);
    assert.match(created.secret, /^ck_live_[A-Za-z0-9_-]{43}$/);
    assert.equal(created.prefix, created.secret.slice(0, 12));
    const me = await call('GET', '/me', { key: created.secret });
    assert.deepEqual([me.status, me.body.id, me.body.scopes], [200, created.id, ['threads:read', 'threads:write']]);

    const listed = await listApiKeys(db, admin, {});
    assert.ok(listed.data.some((key) => key.id === created.id));
    assert.ok(!JSON.stringify(listed).includes(created.secret), 'never the secret again');

    await assert.rejects(createApiKey(db, await person('member'), { name: 'Mine', scopes: ['threads:read'] }, now), /owner or admin/);
    await assert.rejects(revokeApiKey(db, await person('owner', await seedWorkspace(db, 'Other')), created.id, now), /not found/);
    const revoked = await revokeApiKey(db, await person('owner'), created.id, now);
    assert.ok(revoked.revoked_at);
    assert.equal((await call('GET', '/me', { key: created.secret })).status, 401);
    await assert.rejects(revokeApiKey(db, admin, created.id, now), /already revoked/);
    assert.equal((await listApiKeys(db, admin, {})).data.some((key) => key.id === created.id), false);
    assert.equal((await listApiKeys(db, admin, { include_revoked: true })).data.some((key) => key.id === created.id), true);
    assert.equal((await db.select().from(audit_log).where(eq(audit_log.target_id, created.id))).length, 2);
  });

  it('is session only: an API key can’t list, make or revoke keys', async () => {
    const { secret } = await seedApiKey(db, workspaceId, ['settings:manage']);
    for (const [method, path] of [['GET', '/api-keys'], ['POST', '/api-keys'], ['DELETE', '/api-keys/key_01jd3x5k8qf7tb9w2m4n6p8r0s']] as const) {
      const response = await call(method, path, { key: secret, ...(method === 'POST' && { body: { name: 'x', scopes: ['threads:read'] } }) });
      assert.deepEqual([response.status, response.body.code], [403, 'forbidden_scope'], `${method} ${path}`);
    }
  });

  it('bootstraps a workspace, its owner and a first key from the command line', async () => {
    const lines: string[] = [];
    const out = { write: (line: string) => lines.push(line) };
    assert.equal(await runCli(db, ['workspace', '--name', 'Initech', '--address', '1 Infinite Loop, Cupertino', '--owner-email', 'Bill@Initech.example', '--owner-name', 'Bill', '--timezone', 'America/Chicago'], out), 0);
    const { workspace_id: created, owner_user_id: owner } = JSON.parse(lines.pop()!);
    const [bill] = await db.select().from(users).where(eq(users.id, owner));
    assert.deepEqual([bill!.workspace_id, bill!.email, bill!.role], [created, 'bill@initech.example', 'owner']);

    assert.equal(await runCli(db, ['api-key', '--workspace', created, '--name', 'Claude Code', '--scopes', 'threads:read,threads:write'], out), 0);
    const key = JSON.parse(lines.pop()!);
    assert.deepEqual((await call('GET', '/me', { key: key.secret })).body.scopes, ['threads:read', 'threads:write']);
    assert.equal(await runCli(db, ['api-key', '--workspace', created, '--name', 'Admin', '--all-scopes'], out), 0);
    assert.ok(JSON.parse(lines.pop()!).scopes.includes('settings:manage'));

    assert.equal(await runCli(db, ['api-key', '--workspace', created, '--name', 'Bad', '--scopes', 'everything'], out), 2);
    assert.match(lines.pop()!, /Unknown scope everything/);
    assert.equal(await runCli(db, ['workspace', '--name', 'X'], out), 2, 'usage on missing options');
    assert.equal(await runCli(db, ['revoke-api-key', '--key', key.id], out), 0);
    assert.equal((await call('GET', '/me', { key: key.secret })).status, 401);
    assert.equal(await runCli(db, ['revoke-api-key', '--key', key.id], out), 2);
  });
});
