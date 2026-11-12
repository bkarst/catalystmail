import assert from 'node:assert/strict';

import { companySchema, listSchema, suppressionSchema } from '@catalyst/contract';
import { audit_log, campaigns, contacts, newId, threads, type Db } from '@catalyst/db';
import { createTestDatabase } from '@catalyst/db/testing';
import { MemoryQueue } from '@catalyst/jobs';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { setDb, setDeps } from '../runtime.ts';
import { call, seedApiKey, seedWorkspace } from './testing.ts';

// Needs a PostgreSQL server: set TEST_DATABASE_URL to any database on it.
const adminUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!adminUrl)('companies, custom fields, lists, suppressions and search (§12, §8.6)', () => {
  let db: Db;
  const jobs = new MemoryQueue();
  let drop: () => Promise<void>;
  let workspaceId: string;
  let key: string;
  let settingsKey: string;
  let otherKey: string;

  const post = (path: string, body: unknown, as = key) => call('POST', path, { key: as, body });
  const get = (path: string, as = key) => call('GET', path, { key: as });
  const ok = <T = any>(response: { status: number; body: any }, status = 200): T => {
    assert.equal(response.status, status, JSON.stringify(response.body));
    return response.body as T;
  };
  const problem = (response: { status: number; body: any }, status: number, code: string) => {
    assert.equal(response.status, status, JSON.stringify(response.body));
    assert.equal(response.body.code, code);
    return response.body as { detail: string; errors?: { path: string; message: string }[] };
  };
  const contact = async (email: string, extra: Record<string, unknown> = {}) => ok(await post('/contacts', { email, ...extra }), 201);

  beforeAll(async () => {
    ({ db, drop } = await createTestDatabase(adminUrl!));
    setDb(db);
    setDeps({ jobs });
    workspaceId = await seedWorkspace(db, 'Acme');
    ({ secret: key } = await seedApiKey(db, workspaceId, ['contacts:read', 'contacts:write', 'threads:read', 'campaigns:read']));
    ({ secret: settingsKey } = await seedApiKey(db, workspaceId, ['contacts:read', 'contacts:write', 'settings:manage']));
    ({ secret: otherKey } = await seedApiKey(db, await seedWorkspace(db, 'Elsewhere'), ['contacts:read', 'contacts:write', 'settings:manage']));
  });
  afterAll(async () => {
    setDb(undefined);
    await drop?.();
  });

  describe('companies', () => {
    it('links existing and new contacts by domain, but never by a free-mail domain', async () => {
      const before = await contact('marcus@initech.io');
      const freemail = await contact('marcus.h@gmail.com');
      const company = companySchema.strict().parse(ok(await post('/companies', { name: 'Initech', domain: 'Initech.IO', industry: 'Software' }), 201));
      assert.equal(company.domain, 'initech.io');
      assert.equal(company.contact_count, 1);
      assert.equal(ok(await get(`/contacts/${before.id}`)).company_id, company.id);
      assert.equal((await contact('peter@initech.io')).company_id, company.id);
      assert.equal(ok(await get(`/contacts/${freemail.id}`)).company_id, null);

      const gmail = ok(await post('/companies', { name: 'Personal', domain: 'gmail.com' }), 201);
      assert.equal(gmail.contact_count, 0);
      assert.equal((await contact('someone@gmail.com')).company_id, null);
    });

    it('refuses a second company with the same domain, and finds companies by name or domain', async () => {
      ok(await post('/companies', { name: 'Globex', domain: 'globex.com' }), 201);
      problem(await post('/companies', { name: 'Globex Corp', domain: 'GLOBEX.com' }), 409, 'conflict');
      const found = ok(await get('/companies?q=glob'));
      assert.deepEqual(found.data.map((entry: { name: string }) => entry.name), ['Globex']);
      assert.deepEqual(ok(await get('/companies?q=globex.com')).data.length, 1);
      assert.deepEqual(ok(await get('/companies', otherKey)).data, []);
    });

    it('re-links on a domain change, and unlinks contacts when deleted', async () => {
      const company = ok(await post('/companies', { name: 'Umbrella' }), 201);
      const person = await contact('alice@umbrella.co');
      assert.equal(person.company_id, null);
      const fetched = await get(`/companies/${company.id}`);
      const updated = ok(await call('PATCH', `/companies/${company.id}`, { key, body: { domain: 'umbrella.co' }, headers: { 'if-match': fetched.headers.get('etag')! } }));
      assert.equal(updated.contact_count, 1);
      problem(await call('PATCH', `/companies/${company.id}`, { key, body: { notes: 'x' }, headers: { 'if-match': fetched.headers.get('etag')! } }), 412, 'precondition_failed');
      problem(await get(`/companies/${company.id}`, otherKey), 404, 'not_found');

      assert.equal((await call('DELETE', `/companies/${company.id}`, { key })).status, 204);
      problem(await get(`/companies/${company.id}`), 404, 'not_found');
      assert.equal(ok(await get(`/contacts/${person.id}`)).company_id, null);
    });
  });

  describe('custom fields', () => {
    it('needs settings:manage to define fields', async () => {
      problem(await post('/custom-fields', { entity: 'contact', key: 'tier', label: 'Tier', type: 'text' }), 403, 'forbidden_scope');
    });

    it('checks values against their definitions on every write', async () => {
      ok(await post('/custom-fields', { entity: 'contact', key: 'industry', label: 'Industry', type: 'select', options: ['SaaS', 'Agency'] }, settingsKey), 201);
      ok(await post('/custom-fields', { entity: 'contact', key: 'seats', label: 'Seats', type: 'number' }, settingsKey), 201);
      ok(await post('/custom-fields', { entity: 'contact', key: 'renewal', label: 'Renewal', type: 'date' }, settingsKey), 201);
      problem(await post('/custom-fields', { entity: 'contact', key: 'seats', label: 'Again', type: 'number' }, settingsKey), 409, 'conflict');
      problem(await post('/custom-fields', { entity: 'contact', key: 'plan', label: 'Plan', type: 'select' }, settingsKey), 400, 'validation_failed');
      problem(await post('/custom-fields', { entity: 'contact', key: 'Bad Key', label: 'x', type: 'text' }, settingsKey), 400, 'validation_failed');

      const bad = problem(await post('/contacts', { email: 'cf@example.com', custom_fields: { industry: 'Retail', seats: '12', renewal: '2026-02-30' } }), 400, 'validation_failed');
      assert.deepEqual(bad.errors!.map((error) => error.path).sort(), ['body.custom_fields.industry', 'body.custom_fields.renewal', 'body.custom_fields.seats']);

      // Keys without a definition are kept as they are.
      const created = await contact('cf@example.com', { custom_fields: { industry: 'SaaS', seats: 12, nickname: 'CF' } });
      // PATCH merges: given keys change, null removes, others stay.
      const patched = ok(await call('PATCH', `/contacts/${created.id}`, { key, body: { custom_fields: { seats: 15, nickname: null } } }));
      assert.deepEqual(patched.custom_fields, { industry: 'SaaS', seats: 15 });
    });

    it('enforces required fields on new records and never lets them be cleared', async () => {
      const field = ok(await post('/custom-fields', { entity: 'company', key: 'tier', label: 'Tier', type: 'text', required: true }, settingsKey), 201);
      problem(await post('/companies', { name: 'No Tier' }), 400, 'validation_failed');
      const company = ok(await post('/companies', { name: 'Tiered', custom_fields: { tier: 'gold' } }), 201);
      problem(await call('PATCH', `/companies/${company.id}`, { key, body: { custom_fields: { tier: null } } }), 400, 'validation_failed');

      const listed = ok(await get('/custom-fields?entity=company', settingsKey));
      assert.deepEqual(listed.data.map((entry: { key: string }) => entry.key), ['tier']);
      ok(await call('PATCH', `/custom-fields/${field.id}`, { key: settingsKey, body: { required: false, label: 'Account tier' } }));
      assert.equal((await call('DELETE', `/custom-fields/${field.id}`, { key: settingsKey })).status, 204);
      problem(await call('DELETE', `/custom-fields/${field.id}`, { key: otherKey }), 404, 'not_found');
      ok(await post('/companies', { name: 'Untiered' }), 201);
    });
  });

  describe('lists and segments', () => {
    let saas: { id: string }[];

    beforeAll(async () => {
      saas = [await contact('l1@saas.example', { lifecycle_stage: 'lead', city: 'Austin' }), await contact('l2@saas.example', { lifecycle_stage: 'prospect', city: 'Austin' })];
      await contact('l3@saas.example', { lifecycle_stage: 'customer', city: 'Boston' });
    });

    it('keeps static members, counts them, and filters contacts by list', async () => {
      const list = listSchema.strict().parse(ok(await post('/lists', { name: 'Webinar', kind: 'static', contact_ids: [saas[0]!.id] }), 201));
      assert.equal(list.member_count, 1);
      assert.deepEqual(ok(await post(`/lists/${list.id}/members`, { contact_ids: [saas[0]!.id, saas[1]!.id] })), { changed: 1, unchanged: 1 });
      const members = ok(await get(`/lists/${list.id}/members`));
      assert.deepEqual(members.data.map((entry: { email: string }) => entry.email).sort(), ['l1@saas.example', 'l2@saas.example']);
      assert.equal(ok(await get(`/contacts?list_id=${list.id}`)).data.length, 2);

      assert.deepEqual(ok(await call('DELETE', `/lists/${list.id}/members?contact_ids=${saas[1]!.id}`, { key })), { changed: 1, unchanged: 0 });
      assert.equal(ok(await get(`/lists/${list.id}`)).member_count, 1);
      problem(await post(`/lists/${list.id}/members`, { contact_ids: [newId('contact')] }), 400, 'validation_failed');
      problem(await get(`/lists/${list.id}`, otherKey), 404, 'not_found');
      problem(await post('/lists', { name: 'Bad', kind: 'static', filter: { field: 'city', op: 'eq', value: 'Austin' } }), 400, 'validation_failed');
    });

    it('evaluates a dynamic segment every time it is read, including other lists and relative dates', async () => {
      const austin = ok(await post('/lists', { name: 'Austin', kind: 'dynamic', filter: { field: 'city', op: 'eq', value: 'Austin' } }), 201);
      assert.equal(austin.member_count, 2);
      await contact('l4@saas.example', { city: 'Austin' });
      assert.equal(ok(await get(`/lists/${austin.id}`)).member_count, 3);

      const webinar = ok(await post('/lists', { name: 'Static', kind: 'static', contact_ids: [saas[0]!.id] }), 201);
      const both = ok(await post('/lists', { name: 'Austin and webinar', kind: 'dynamic', filter: { and: [{ field: 'list_id', op: 'eq', value: austin.id }, { field: 'list_id', op: 'eq', value: webinar.id }] } }), 201);
      assert.equal(both.member_count, 1);

      const recent = ok(await post('/lists/preview', { filter: { field: 'created_at', op: 'gt', value: '-1d' } }));
      assert.ok(recent.count >= 4 && recent.sample.length <= 10);
      assert.equal(ok(await post('/lists/preview', { filter: { field: 'created_at', op: 'lt', value: '-30d' } })).count, 0);

      problem(await post(`/lists/${austin.id}/members`, { contact_ids: [saas[0]!.id] }), 409, 'conflict');
      problem(await call('PATCH', `/lists/${austin.id}`, { key, body: { filter: { field: 'list_id', op: 'eq', value: austin.id } } }), 400, 'validation_failed');
      problem(await call('PATCH', `/lists/${webinar.id}`, { key, body: { filter: { field: 'city', op: 'eq', value: 'x' } } }), 409, 'conflict');
      problem(await post('/lists/preview', { filter: { field: 'list_id', op: 'eq', value: newId('list') } }), 400, 'validation_failed');

      const renamed = ok(await call('PATCH', `/lists/${austin.id}`, { key, body: { name: 'Austin, TX', filter: { field: 'city', op: 'eq', value: 'Boston' } } }));
      assert.equal(renamed.member_count, 1);
      assert.ok(ok(await get('/lists?kind=dynamic')).data.every((entry: { kind: string }) => entry.kind === 'dynamic'));
      assert.equal((await call('DELETE', `/lists/${webinar.id}`, { key })).status, 204);
    });
  });

  describe('suppressions', () => {
    it('suppresses an address once, matches its domain too, and explains why an address is blocked', async () => {
      const person = await contact('dana@northwind.com', { do_not_contact: true });
      const created = suppressionSchema.strict().parse(ok(await post('/suppressions', { email: 'Dana@Northwind.com', note: 'Customer' }), 201));
      assert.deepEqual([created.email, created.reason, created.source, created.hashed_only], ['dana@northwind.com', 'manual', 'api', false]);
      problem(await post('/suppressions', { email: 'dana@northwind.com' }), 409, 'conflict');
      problem(await post('/suppressions', { email: 'a@b.com', domain: 'b.com' }), 400, 'validation_failed');

      const check = ok(await get('/suppressions/check?email=DANA@northwind.com'));
      assert.deepEqual([check.blocked, check.reasons, check.contact_id], [true, ['suppressed', 'do_not_contact'], person.id]);
      assert.deepEqual(ok(await get('/suppressions/check?email=sam@northwind.com')).blocked, false);

      ok(await post('/suppressions', { domain: 'competitor.example', reason: 'do_not_contact' }), 201);
      assert.deepEqual(ok(await get('/suppressions/check?email=ceo@competitor.example')).reasons, ['suppressed']);
      assert.equal(ok(await get('/suppressions?q=competitor')).data.length, 1);
      assert.equal(ok(await get('/suppressions?reason=manual')).data.length, 1);
      assert.equal(ok(await get('/suppressions/check?email=dana@northwind.com', otherKey)).blocked, false);
    });

    it('re-evaluates the threads a suppression or its removal touches, by address or domain', async () => {
      const person = await contact('pat@touched.example');
      const campaignId = newId('campaign');
      await db.insert(campaigns).values({ id: campaignId, workspace_id: workspaceId, name: 'Touched', objective: 'x', persona: {}, sending_window: {} });
      const threadId = newId('thread');
      await db.insert(threads).values({ id: threadId, workspace_id: workspaceId, campaign_id: campaignId, contact_id: person.id });

      jobs.clear();
      const byAddress = ok(await post('/suppressions', { email: 'PAT@touched.example' }), 201);
      assert.deepEqual(jobs.of('thread.evaluate'), [{ thread_id: threadId }]);
      jobs.clear();
      ok(await post('/suppressions', { domain: 'touched.example' }), 201);
      assert.deepEqual(jobs.of('thread.evaluate'), [{ thread_id: threadId }]);
      jobs.clear();
      assert.equal((await call('DELETE', `/suppressions/${byAddress.id}`, { key: settingsKey })).status, 204);
      assert.deepEqual(jobs.of('thread.evaluate'), [{ thread_id: threadId }]);
      jobs.clear();
      ok(await call('PATCH', `/contacts/${person.id}`, { key, body: { do_not_contact: true } }));
      assert.deepEqual(jobs.of('thread.evaluate'), [{ thread_id: threadId }]);
    });

    it('needs settings:manage to remove a suppression, and audits it', async () => {
      const created = ok(await post('/suppressions', { email: 'remove-me@example.com' }), 201);
      problem(await call('DELETE', `/suppressions/${created.id}`, { key }), 403, 'forbidden_scope');
      assert.equal((await call('DELETE', `/suppressions/${created.id}`, { key: settingsKey })).status, 204);
      const [entry] = await db.select().from(audit_log).where(eq(audit_log.target_id, created.id));
      assert.equal(entry!.action, 'suppression.deleted');
      assert.equal(ok(await get('/suppressions/check?email=remove-me@example.com')).blocked, false);
    });
  });

  describe('search (⌘K)', () => {
    it('finds contacts, companies and, with the scope, threads and campaigns', async () => {
      const priya = await contact('priya@globex.com', { first_name: 'Priya', last_name: 'Natarajan', title: 'VP Operations' });
      const campaignId = newId('campaign');
      await db.insert(campaigns).values({ id: campaignId, workspace_id: workspaceId, name: 'Globex expansion', objective: 'Calls', persona: {}, sending_window: {} });
      await db.insert(threads).values({ id: newId('thread'), workspace_id: workspaceId, campaign_id: campaignId, contact_id: priya.id, subject: 'Quick question about Globex onboarding' });

      const results = ok(await get('/search?q=globex')).data as { kind: string; title: string }[];
      assert.deepEqual(new Set(results.map((result) => result.kind)), new Set(['company', 'contact', 'thread', 'campaign']));
      assert.ok(ok(await get('/search?q=Natarajn')).data.some((result: { title: string }) => result.title === 'Priya Natarajan'), 'a small typo still matches');

      const narrow = ok(await get('/search?q=globex', settingsKey)).data as { kind: string }[];
      assert.ok(narrow.every((result) => result.kind === 'company' || result.kind === 'contact'));
      assert.deepEqual(ok(await get('/search?q=globex', otherKey)).data, []);
      const [row] = await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.email, 'priya@globex.com'));
      assert.equal(row!.id, priya.id);
    });
  });
});
