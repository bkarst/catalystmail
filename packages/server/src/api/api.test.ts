import assert from 'node:assert/strict';

import { contactSchema, problemSchema } from '@catalyst/contract';
import { activities, api_keys, companies, contact_tags, contacts, idempotency_keys, newId, tags, users, type Db } from '@catalyst/db';
import { createTestDatabase } from '@catalyst/db/testing';
import { MemoryQueue } from '@catalyst/jobs';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { setDb, setDeps } from '../runtime.ts';
import { call, seedApiKey, seedWorkspace } from './testing.ts';

// Needs a PostgreSQL server: set TEST_DATABASE_URL to any database on it.
const adminUrl = process.env.TEST_DATABASE_URL;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!adminUrl)('public API against PostgreSQL', () => {
  let db: Db;
  const jobs = new MemoryQueue();
  let drop: () => Promise<void>;
  let workspaceId: string;
  let key: string; // contacts:read + contacts:write
  let readOnlyKey: string;
  let otherWorkspaceKey: string;
  let keyId: string;

  /** Asserts an error response is a valid problem document with the expected status and code. */
  function assertProblem(response: Awaited<ReturnType<typeof call>>, status: number, code: string) {
    assert.equal(response.status, status, JSON.stringify(response.body));
    assert.equal(response.headers.get('content-type'), 'application/problem+json');
    const problem = problemSchema.parse(response.body);
    assert.deepEqual([problem.status, problem.code], [status, code]);
    assert.equal(problem.instance, response.headers.get('x-request-id'));
    return problem;
  }
  const create = (body: Record<string, unknown>) => call('POST', '/contacts', { key, body });

  beforeAll(async () => {
    ({ db, drop } = await createTestDatabase(adminUrl!));
    setDb(db);
    setDeps({ jobs });
    workspaceId = await seedWorkspace(db, 'Acme');
    ({ id: keyId, secret: key } = await seedApiKey(db, workspaceId, ['contacts:read', 'contacts:write']));
    ({ secret: readOnlyKey } = await seedApiKey(db, workspaceId, ['contacts:read']));
    ({ secret: otherWorkspaceKey } = await seedApiKey(db, await seedWorkspace(db, 'Initech'), ['contacts:read', 'contacts:write']));
  });

  afterAll(async () => {
    setDb(undefined);
    await drop?.();
  });

  describe('authentication and scopes (§13.2)', () => {
    it('serves the OpenAPI document without credentials', async () => {
      const response = await call('GET', '/openapi.json');
      assert.equal(response.status, 200);
      assert.equal(response.body.openapi, '3.1.0');
      assert.ok(response.body.paths['/contacts'].post);
    });

    it('rejects a missing, unknown, revoked or expired key', async () => {
      const missing = await call('GET', '/me');
      assertProblem(missing, 401, 'unauthorized');
      assert.equal(missing.headers.get('www-authenticate'), 'Bearer');
      assertProblem(await call('GET', '/me', { key: 'ck_live_not-a-real-key' }), 401, 'unauthorized');
      assertProblem(await call('GET', '/me', { key: 'not-even-the-right-prefix' }), 401, 'unauthorized');

      const revoked = await seedApiKey(db, workspaceId, ['contacts:read'], { revoked_at: new Date() });
      assertProblem(await call('GET', '/me', { key: revoked.secret }), 401, 'unauthorized');
      const expired = await seedApiKey(db, workspaceId, ['contacts:read'], { expires_at: new Date(Date.now() - 1000) });
      assertProblem(await call('GET', '/me', { key: expired.secret }), 401, 'unauthorized');
    });

    it('tells a key who it is, and records that it was used', async () => {
      const response = await call('GET', '/me', { key });
      assert.equal(response.status, 200);
      assert.deepEqual(response.body, {
        kind: 'api_key',
        id: keyId,
        name: 'Test key',
        role: null,
        scopes: ['contacts:read', 'contacts:write'],
        workspace: { id: workspaceId, name: 'Acme' },
        two_factor_required: false,
      });
      const [stored] = await db.select().from(api_keys).where(eq(api_keys.id, keyId));
      assert.ok(stored!.last_used_at);
    });

    it('refuses an operation the key has no scope for, naming the scope', async () => {
      const problem = assertProblem(await call('POST', '/contacts', { key: readOnlyKey, body: { email: 'x@example.com' } }), 403, 'forbidden_scope');
      assert.match(problem.detail!, /contacts:write/);
      assert.equal((await call('GET', '/contacts', { key: readOnlyKey })).status, 200);
    });
  });

  describe('contacts (§12)', () => {
    it('creates a contact, normalising the email and returning exactly the contract shape', async () => {
      const [company] = await db.insert(companies).values({ id: newId('company'), workspace_id: workspaceId, name: 'Globex', domain: 'globex.com' }).returning();
      const response = await create({ email: 'Priya@Globex.COM', first_name: 'Priya', title: 'VP Operations', custom_fields: { industry: 'SaaS', seats: 240 } });
      assert.equal(response.status, 201, JSON.stringify(response.body));
      const contact = contactSchema.strict().parse(response.body);
      assert.deepEqual(
        [contact.email, contact.first_name, contact.company_id, contact.source, contact.lifecycle_stage, contact.email_verification, contact.subscription_status],
        ['priya@globex.com', 'Priya', company!.id, 'api', 'lead', 'unverified', 'subscribed'],
      );
      assert.match(contact.id, /^ctc_[0-9a-z]{26}$/);
      assert.match(response.headers.get('etag')!, /^"[\w-]{22}"$/);
      assert.match(response.headers.get('x-request-id')!, /^req_/);

      assert.ok(jobs.of('contact.verify').some((job) => job.contact_id === contact.id), 'a new address is verified in the background');
      const log = await db.select().from(activities).where(eq(activities.contact_id, contact.id));
      assert.deepEqual(log.map((entry) => [entry.type, entry.actor_type, entry.actor_id]), [['contact.created', 'api_key', keyId]]);
    });

    it('refuses a duplicate email, whatever its letter case, and says which contact has it', async () => {
      const first = await create({ email: 'dana@northwind.com' });
      const problem = assertProblem(await create({ email: 'DANA@northwind.com' }), 409, 'conflict');
      assert.ok(problem.detail!.includes(first.body.id));
      assert.deepEqual(problem.errors, [{ path: 'body.email', message: 'Already used by another contact.' }]);
    });

    it('reports every invalid field with its path', async () => {
      const problem = assertProblem(await create({ email: 'not-an-email', lifecycle_stage: 'vip', nickname: 'P' }), 400, 'validation_failed');
      const paths = problem.errors!.map((error) => error.path);
      assert.ok(paths.includes('body.email') && paths.includes('body.lifecycle_stage'), paths.join(', '));
      assert.ok(paths.length >= 3, 'the unknown property is reported too');

      assertProblem(await call('POST', '/contacts', { key, rawBody: '{not json' }), 400, 'validation_failed');
      assertProblem(await create({ email: 'tz@example.com', timezone: 'Mars/Olympus_Mons' }), 400, 'validation_failed');
      const unknownTag = assertProblem(await create({ email: 'tag@example.com', tag_ids: [newId('tag')] }), 400, 'validation_failed');
      assert.equal(unknownTag.errors![0]!.path, 'body.tag_ids.0');
    });

    it('never lets one workspace see or point at another', async () => {
      const created = await create({ email: 'sam@acme-customer.com' });
      assertProblem(await call('GET', `/contacts/${created.body.id}`, { key: otherWorkspaceKey }), 404, 'not_found');
      assertProblem(await call('PATCH', `/contacts/${created.body.id}`, { key: otherWorkspaceKey, body: { title: 'x' } }), 404, 'not_found');
      assertProblem(await call('DELETE', `/contacts/${created.body.id}`, { key: otherWorkspaceKey }), 404, 'not_found');
      assert.deepEqual((await call('GET', '/contacts', { key: otherWorkspaceKey })).body, { data: [], next_cursor: null });

      const [foreignUser] = await db.insert(users).values({ id: newId('user'), workspace_id: await seedWorkspace(db, 'Elsewhere'), email: 'x@elsewhere.com', name: 'X' }).returning();
      const problem = assertProblem(await create({ email: 'owned@example.com', owner_user_id: foreignUser!.id }), 400, 'validation_failed');
      assert.equal(problem.errors![0]!.path, 'body.owner_user_id');
    });

    it('gets a contact with an ETag, and rejects a malformed ID', async () => {
      const created = await create({ email: 'ken@fabrikam.com' });
      const fetched = await call('GET', `/contacts/${created.body.id}`, { key });
      assert.equal(fetched.status, 200);
      assert.deepEqual(fetched.body, created.body);
      assert.equal(fetched.headers.get('etag'), created.headers.get('etag'));
      assertProblem(await call('GET', '/contacts/ctc_nope', { key }), 400, 'validation_failed');
      assertProblem(await call('GET', `/contacts/${newId('contact')}`, { key }), 404, 'not_found');
    });

    it('updates only the fields sent, guarded by If-Match', async () => {
      const created = await create({ email: 'ana@contoso.com', first_name: 'Ana', title: 'CTO' });
      const path = `/contacts/${created.body.id}`;
      const etag = created.headers.get('etag')!;
      await pause(5);

      const updated = await call('PATCH', path, { key, body: { title: 'COO', lifecycle_stage: 'opportunity' }, headers: { 'if-match': etag } });
      assert.equal(updated.status, 200, JSON.stringify(updated.body));
      assert.deepEqual([updated.body.title, updated.body.lifecycle_stage, updated.body.first_name], ['COO', 'opportunity', 'Ana']);
      assert.notEqual(updated.body.updated_at, created.body.updated_at);
      assert.notEqual(updated.headers.get('etag'), etag);

      // The old ETag is stale now.
      assertProblem(await call('PATCH', path, { key, body: { title: 'CEO' }, headers: { 'if-match': etag } }), 412, 'precondition_failed');
      assert.equal((await call('GET', path, { key })).body.title, 'COO');

      // Sending the same values again changes nothing, not even updated_at.
      const same = await call('PATCH', path, { key, body: { title: 'COO' } });
      assert.equal(same.body.updated_at, updated.body.updated_at);

      const log = await db.select().from(activities).where(eq(activities.contact_id, created.body.id));
      assert.deepEqual(log.filter((entry) => entry.type === 'contact.updated').map((entry) => entry.data), [{ fields: ['title', 'lifecycle_stage'] }]);
    });

    it('resets verification when the email changes, and refuses an address already in use', async () => {
      const created = await create({ email: 'old@example.com' });
      await db.update(contacts).set({ email_verification: 'valid', email_verified_at: new Date() }).where(eq(contacts.id, created.body.id));
      const moved = await call('PATCH', `/contacts/${created.body.id}`, { key, body: { email: 'New@Example.com' } });
      assert.deepEqual([moved.body.email, moved.body.email_verification, moved.body.email_verified_at], ['new@example.com', 'unverified', null]);

      await create({ email: 'taken@example.com' });
      assertProblem(await call('PATCH', `/contacts/${created.body.id}`, { key, body: { email: 'taken@example.com' } }), 409, 'conflict');
    });

    it('soft-deletes a contact and frees its email', async () => {
      const created = await create({ email: 'gone@example.com' });
      const deleted = await call('DELETE', `/contacts/${created.body.id}`, { key });
      assert.deepEqual([deleted.status, deleted.body], [204, null]);
      assertProblem(await call('GET', `/contacts/${created.body.id}`, { key }), 404, 'not_found');
      assertProblem(await call('DELETE', `/contacts/${created.body.id}`, { key }), 404, 'not_found');

      const [row] = await db.select().from(contacts).where(eq(contacts.id, created.body.id));
      assert.ok(row!.deleted_at, 'the row is kept');
      assert.equal((await create({ email: 'gone@example.com' })).status, 201);
    });
  });

  describe('tags and idempotency (§13.3)', () => {
    it('creates, lists and deletes tags', async () => {
      const saas = await call('POST', '/tags', { key, body: { name: 'saas' } });
      assert.deepEqual([saas.status, saas.body.name, saas.body.color], [201, 'saas', 'gray']);
      await call('POST', '/tags', { key, body: { name: 'agency', color: 'blue' } });
      assertProblem(await call('POST', '/tags', { key, body: { name: 'saas' } }), 409, 'conflict');

      const tagged = await create({ email: 'tagged@example.com', tag_ids: [saas.body.id] });
      assert.deepEqual(tagged.body.tag_ids, [saas.body.id]);

      const firstPage = await call('GET', '/tags?limit=1', { key });
      assert.deepEqual(firstPage.body.data.map((tag: { name: string }) => tag.name), ['agency']);
      const secondPage = await call('GET', `/tags?limit=1&cursor=${firstPage.body.next_cursor}`, { key });
      assert.deepEqual([secondPage.body.data.map((tag: { name: string }) => tag.name), secondPage.body.next_cursor], [['saas'], null]);

      assert.equal((await call('DELETE', `/tags/${saas.body.id}`, { key })).status, 204);
      assert.deepEqual((await call('GET', `/contacts/${tagged.body.id}`, { key })).body.tag_ids, []);
      assert.equal((await db.select().from(contact_tags).where(eq(contact_tags.tag_id, saas.body.id))).length, 0);
      assertProblem(await call('DELETE', `/tags/${saas.body.id}`, { key }), 404, 'not_found');
    });

    it('replays a POST with the same Idempotency-Key instead of acting twice', async () => {
      const headers = { 'idempotency-key': 'create-enterprise-tag' };
      const first = await call('POST', '/tags', { key, body: { name: 'enterprise' }, headers });
      const replay = await call('POST', '/tags', { key, body: { name: 'enterprise' }, headers });
      assert.equal(first.status, 201);
      assert.deepEqual([replay.status, replay.body], [201, first.body]);
      assert.deepEqual([first.headers.get('idempotency-replayed'), replay.headers.get('idempotency-replayed')], [null, 'true']);
      assert.equal((await db.select().from(tags).where(eq(tags.name, 'enterprise'))).length, 1);

      assertProblem(await call('POST', '/tags', { key, body: { name: 'something-else' }, headers }), 422, 'idempotency_key_reused');
      // Another caller's identical key is a different key.
      assert.equal((await call('POST', '/tags', { key: otherWorkspaceKey, body: { name: 'enterprise' }, headers })).status, 201);
    });

    it('does not burn the key on a failed request', async () => {
      const headers = { 'idempotency-key': 'retry-after-fixing' };
      assertProblem(await call('POST', '/tags', { key, body: { name: 'agency' }, headers }), 409, 'conflict');
      assert.equal((await db.select().from(idempotency_keys).where(eq(idempotency_keys.key, 'retry-after-fixing'))).length, 0);
      assert.equal((await call('POST', '/tags', { key, body: { name: 'agency-2' }, headers })).status, 201);
    });
  });
});
