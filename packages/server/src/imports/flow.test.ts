import assert from 'node:assert/strict';

import { companies, contacts, list_members, tags, type Db } from '@catalyst/db';
import { createTestDatabase } from '@catalyst/db/testing';
import { MemoryQueue } from '@catalyst/jobs';
import { MemoryStorage } from '@catalyst/storage';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { call, seedApiKey, seedWorkspace } from '../api/testing.ts';
import { setDb, setDeps } from '../runtime.ts';
import { processImport } from './service.ts';

// Needs a PostgreSQL server: set TEST_DATABASE_URL to any database on it.
const adminUrl = process.env.TEST_DATABASE_URL;

const FILE = [
  'Email,Name,Company,Industry,Tags,Country',
  'priya@globex.com,Priya Natarajan,Globex,SaaS,webinar;q4,United States',
  'dana@northwind.com,Dana Wu,Northwind,Retail,webinar,US',
  'not-an-email,Bad Row,,,,',
  'PRIYA@globex.com,Priya Again,Globex,SaaS,,',
  'blocked@competitor.example,Blocked,,,,',
  'ken@fabrikam.com,Ken Ito,Fabrikam,,,Japan',
  'existing@acme-import.example,Changed Name,,,,',
].join('\n');

describe.skipIf(!adminUrl)('contact import (§12.3, E2E-02 through the API)', () => {
  let db: Db;
  let drop: () => Promise<void>;
  const jobs = new MemoryQueue();
  const storage = new MemoryStorage();
  let key: string;
  let otherKey: string;
  let settingsKey: string;
  let workspaceId: string;

  const post = (path: string, body: unknown, as = key) => call('POST', path, { key: as, body });
  const ok = (response: { status: number; body: any }, status = 200) => {
    assert.equal(response.status, status, JSON.stringify(response.body));
    return response.body;
  };
  const upload = async (content = FILE) => ok(await post('/imports', { filename: 'webinar.csv', content }), 201);

  beforeAll(async () => {
    ({ db, drop } = await createTestDatabase(adminUrl!));
    setDb(db);
    setDeps({ jobs, storage });
    workspaceId = await seedWorkspace(db, 'Acme');
    ({ secret: key } = await seedApiKey(db, workspaceId, ['contacts:read', 'contacts:write']));
    ({ secret: settingsKey } = await seedApiKey(db, workspaceId, ['settings:manage']));
    ({ secret: otherKey } = await seedApiKey(db, await seedWorkspace(db, 'Elsewhere'), ['contacts:read', 'contacts:write']));
    ok(await post('/custom-fields', { entity: 'contact', key: 'industry', label: 'Industry', type: 'select', options: ['SaaS', 'Agency'] }, settingsKey), 201);
    ok(await post('/suppressions', { domain: 'competitor.example' }), 201);
    ok(await post('/contacts', { email: 'existing@acme-import.example', first_name: 'Original' }), 201);
  });
  afterAll(async () => {
    setDb(undefined);
    setDeps(undefined);
    await drop?.();
  });

  it('stores the file and suggests a mapping', async () => {
    const created = await upload();
    assert.deepEqual([created.status, created.total_rows, created.headers], ['uploaded', 7, ['Email', 'Name', 'Company', 'Industry', 'Tags', 'Country']]);
    assert.deepEqual(created.suggested_mapping, { Email: 'email', Name: 'full_name', Company: 'company', Industry: 'custom.industry', Tags: 'tags', Country: 'country' });
    assert.equal(created.sample_rows.length, 5);
    assert.equal(storage.objects.size, 1);
    assert.equal((await call('GET', `/imports/${created.id}`, { key: otherKey })).status, 404);
    assert.equal((await post('/imports', { filename: 'empty.csv', content: 'Email\n' })).status, 400);
  });

  it('dry-runs, then imports in the background with every row accounted for', async () => {
    const created = await upload();
    const tagId = ok(await post('/tags', { name: 'imported' }), 201).id;
    const list = ok(await post('/lists', { name: 'Webinar', kind: 'static' }), 201);
    const options = { mapping: created.suggested_mapping, dedupe_strategy: 'fill_empty', tag_ids: [tagId], list_id: list.id, consent_basis: 'legitimate_interest' };

    const summary = ok(await post(`/imports/${created.id}/preview`, options));
    assert.deepEqual(
      [summary.new, summary.update, summary.skip, summary.invalid, summary.suppressed, summary.duplicates_in_file],
      [2, 1, 0, 2, 1, 1],
      JSON.stringify(summary),
    );
    assert.deepEqual(summary.errors.map((error: { row: number; column: string }) => [error.row, error.column]), [[3, 'Industry'], [4, 'Email']]);
    assert.equal((await db.select().from(contacts)).length, 1, 'a dry run writes nothing');

    const committed = ok(await post(`/imports/${created.id}/commit`, options), 202);
    assert.equal(committed.status, 'processing');
    assert.deepEqual(jobs.of('import.process'), [{ import_id: created.id }]);
    assert.equal((await post(`/imports/${created.id}/commit`, options)).status, 409, 'an import is committed once');

    assert.equal(await processImport(db, created.id, { storage, jobs }, new Date()), 'done');
    const done = ok(await call('GET', `/imports/${created.id}`, { key }));
    assert.deepEqual(
      [done.status, done.processed_rows, done.created_count, done.updated_count, done.skipped_count, done.error_count],
      ['done', 7, 2, 1, 2, 2],
      JSON.stringify(done),
    );
    assert.ok(done.finished_at);

    const [priya] = await db.select().from(contacts).where(eq(contacts.email, 'priya@globex.com'));
    assert.deepEqual(
      [priya!.first_name, priya!.last_name, priya!.country, priya!.source, priya!.source_detail, priya!.consent_basis, priya!.custom_fields],
      ['Priya', 'Natarajan', 'US', 'import', 'webinar.csv', 'legitimate_interest', { industry: 'SaaS' }],
    );
    const [globex] = await db.select().from(companies).where(eq(companies.id, priya!.company_id!));
    assert.equal(globex!.name, 'Globex');
    const tagNames = (await db.select({ name: tags.name }).from(tags)).map((tag) => tag.name).sort();
    assert.deepEqual(tagNames, ['imported', 'q4', 'webinar']);
    assert.equal((await db.select().from(list_members).where(eq(list_members.list_id, list.id))).length, 3);

    const [existing] = await db.select().from(contacts).where(eq(contacts.email, 'existing@acme-import.example'));
    assert.equal(existing!.first_name, 'Original', 'fill_empty never overwrites');
    assert.equal((await db.select().from(contacts).where(eq(contacts.email, 'blocked@competitor.example'))).length, 0);
    assert.ok(jobs.of('contact.verify').length >= 2, 'new addresses are verified afterwards');
  });

  it('imports the rows it can when a row breaks a rule only the database knows', async () => {
    ok(await post('/custom-fields', { entity: 'contact', key: 'region', label: 'Region', type: 'text', required: true }, settingsKey), 201);
    const created = await upload('Email,Region\nwith@region.example,EMEA\nwithout@region.example,\n');
    ok(await post(`/imports/${created.id}/commit`, { mapping: { Email: 'email', Region: 'custom.region' } }), 202);
    assert.equal(await processImport(db, created.id, { storage, jobs }, new Date()), 'done');
    const done = ok(await call('GET', `/imports/${created.id}`, { key }));
    assert.deepEqual([done.created_count, done.error_count], [1, 1]);
    assert.equal(done.errors[0].row, 3);
    assert.match(done.errors[0].message, /Region is required/);
  });

  it('refuses a mapping without an email column, or naming fields that do not exist', async () => {
    const created = await upload();
    const bad = await post(`/imports/${created.id}/preview`, { mapping: { Name: 'full_name', Industry: 'custom.missing' } });
    assert.equal(bad.status, 400);
    assert.deepEqual(bad.body.errors.map((error: { path: string }) => error.path).sort(), ['body.mapping', 'body.mapping.Industry']);
  });
});
