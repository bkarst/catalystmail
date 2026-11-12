import assert from 'node:assert/strict';

import { contact_tags, contacts, newId, tags, type Db } from '@catalyst/db';
import { createTestDatabase } from '@catalyst/db/testing';
import { MemoryQueue } from '@catalyst/jobs';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { call, seedApiKey, seedWorkspace } from '../api/testing.ts';
import { setDb, setDeps } from '../runtime.ts';

// Needs a PostgreSQL server: set TEST_DATABASE_URL to any database on it.
const adminUrl = process.env.TEST_DATABASE_URL;

interface Listed {
  id: string;
  email: string;
  created_at: string;
  last_contacted_at: string | null;
  last_replied_at: string | null;
}

describe.skipIf(!adminUrl)('listContacts against PostgreSQL (§12.2)', () => {
  let db: Db;
  const jobs = new MemoryQueue();
  let drop: () => Promise<void>;
  let key: string;
  const tag = { saas: newId('tag'), agency: newId('tag') };

  const at = (day: number, hour = 9, minute = 0) => new Date(Date.UTC(2026, 10, day, hour, minute));
  const list = (query = '') => call('GET', `/contacts${query}`, { key });
  const emails = async (query = '') => {
    const response = await list(query);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    return (response.body.data as Listed[]).map((contact) => contact.email.split('@')[0]).sort();
  };
  const filtered = (filter: unknown) => emails(`?filter=${encodeURIComponent(JSON.stringify(filter))}`);
  const rejects = async (query: string, path: string) => {
    const response = await list(query);
    assert.equal(response.status, 400, `${query} → ${JSON.stringify(response.body)}`);
    assert.equal(response.body.code, 'validation_failed');
    assert.ok(
      response.body.errors.some((error: { path: string }) => error.path.startsWith(path)),
      `${query}: expected an error at ${path}, got ${JSON.stringify(response.body.errors)}`,
    );
  };
  const rejectsFilter = (filter: unknown, path = 'query.filter') => rejects(`?filter=${encodeURIComponent(typeof filter === 'string' ? filter : JSON.stringify(filter))}`, path);

  beforeAll(async () => {
    ({ db, drop } = await createTestDatabase(adminUrl!));
    setDb(db);
    setDeps({ jobs });
    const workspace_id = await seedWorkspace(db, 'Acme');
    ({ secret: key } = await seedApiKey(db, workspace_id, ['contacts:read']));
    await db.insert(tags).values([
      { id: tag.saas, workspace_id, name: 'saas' },
      { id: tag.agency, workspace_id, name: 'agency' },
    ]);

    const rows: (typeof contacts.$inferInsert)[] = [
      { id: newId('contact'), workspace_id, email: 'priya@globex.com', first_name: 'Priya', last_name: 'Natarajan', title: 'VP Operations', city: 'San Francisco', country: 'US', lifecycle_stage: 'engaged', custom_fields: { industry: 'SaaS', seats: 240 }, last_contacted_at: at(10), last_replied_at: at(10, 10), created_at: at(1, 9, 0) },
      { id: newId('contact'), workspace_id, email: 'dana@northwind.com', first_name: 'Dana', last_name: 'Wu', title: 'Head of Sales', lifecycle_stage: 'prospect', custom_fields: { industry: 'Retail', seats: 40 }, last_contacted_at: at(5), created_at: at(1, 9, 1) },
      { id: newId('contact'), workspace_id, email: 'ken@fabrikam.com', first_name: 'Ken', last_name: 'Ito', title: 'Founder', lifecycle_stage: 'prospect', custom_fields: { industry: 'SaaS', seats: 12 }, last_contacted_at: at(8), created_at: at(1, 9, 2) },
      { id: newId('contact'), workspace_id, email: 'ana@contoso.com', first_name: 'Ana', last_name: 'Ruiz', lifecycle_stage: 'lead', created_at: at(1, 9, 3) },
      // "seats" stored as text: it must not match numeric comparisons, and must not break them.
      { id: newId('contact'), workspace_id, email: 'marcus@initech.io', first_name: 'Marcus', last_name: 'Hill', title: '100% growth lead', lifecycle_stage: 'prospect', do_not_contact: true, custom_fields: { industry: 'Fintech', seats: '55' }, last_contacted_at: at(1), created_at: at(1, 9, 3) },
      { id: newId('contact'), workspace_id, email: 'info@umbrella.co', lifecycle_stage: 'lead', email_verification: 'risky', created_at: at(1, 9, 5) },
      { id: newId('contact'), workspace_id, email: 'sam@acme.com', first_name: 'Sam', last_name: 'Lee', title: "O'Brien & Co lead", lifecycle_stage: 'customer', subscription_status: 'unsubscribed', last_contacted_at: at(2), last_replied_at: at(3), created_at: at(1, 9, 6), updated_at: at(20) },
      { id: newId('contact'), workspace_id, email: 'deleted@example.com', first_name: 'Deleted', lifecycle_stage: 'prospect', created_at: at(1, 9, 7), deleted_at: at(2) },
    ];
    await db.insert(contacts).values(rows);
    const idOf = (email: string) => rows.find((row) => row.email === email)!.id;
    await db.insert(contact_tags).values([
      { contact_id: idOf('priya@globex.com'), tag_id: tag.saas },
      { contact_id: idOf('dana@northwind.com'), tag_id: tag.saas },
      { contact_id: idOf('dana@northwind.com'), tag_id: tag.agency },
    ]);
  });

  afterAll(async () => {
    setDb(undefined);
    await drop?.();
  });

  const everyone = ['ana', 'dana', 'info', 'ken', 'marcus', 'priya', 'sam'];

  it('returns live contacts, newest first, and never deleted ones', async () => {
    const response = await list();
    const data = response.body.data as Listed[];
    assert.deepEqual(data.map((contact) => contact.email.split('@')[0]).sort(), everyone);
    assert.deepEqual([data[0]!.email, data[1]!.email, data.at(-1)!.email], ['sam@acme.com', 'info@umbrella.co', 'priya@globex.com']);
    assert.equal(response.body.next_cursor, null);
  });

  it('pages through every sort order without losing or repeating a contact', async () => {
    for (const sort of ['-created_at', 'created_at', '-updated_at', '-last_contacted_at', '-last_replied_at', 'email']) {
      const all = (await list(`?sort=${sort}&limit=100`)).body.data as Listed[];
      const paged: Listed[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const response = await list(`?sort=${sort}&limit=3${cursor ? `&cursor=${cursor}` : ''}`);
        assert.equal(response.status, 200, JSON.stringify(response.body));
        assert.ok(response.body.data.length <= 3);
        paged.push(...response.body.data);
        cursor = response.body.next_cursor;
        pages += 1;
      } while (cursor && pages < 10);
      assert.equal(pages, 3, `${sort}: 7 contacts in pages of 3`);
      assert.deepEqual(paged.map((contact) => contact.id), all.map((contact) => contact.id), sort);
      assert.equal(new Set(paged.map((contact) => contact.id)).size, 7, sort);
    }
  });

  it('sorts as asked, with empty values last', async () => {
    const ordered = async (sort: string) => ((await list(`?sort=${sort}`)).body.data as Listed[]).map((contact) => contact.email.split('@')[0]);
    assert.deepEqual(await ordered('email'), ['ana', 'dana', 'info', 'ken', 'marcus', 'priya', 'sam']);
    assert.deepEqual((await ordered('-last_contacted_at')).slice(0, 5), ['priya', 'ken', 'dana', 'sam', 'marcus']);
    assert.deepEqual((await ordered('-last_replied_at')).slice(0, 2), ['priya', 'sam']);
    assert.deepEqual((await ordered('-updated_at'))[0], 'sam');
    assert.deepEqual((await ordered('created_at'))[0], 'priya');
  });

  it('rejects bad paging parameters', async () => {
    await rejects('?limit=0', 'query.limit');
    await rejects('?limit=101', 'query.limit');
    await rejects('?sort=name', 'query.sort');
    await rejects('?cursor=not-a-cursor', 'query.cursor');
    const { next_cursor } = (await list('?limit=2')).body;
    await rejects(`?sort=email&cursor=${next_cursor}`, 'query.cursor');
  });

  it('searches names, titles and email fragments', async () => {
    assert.deepEqual(await emails('?q=globex'), ['priya']);
    assert.deepEqual(await emails('?q=ito'), ['ken']);
    assert.deepEqual(await emails('?q=operations'), ['priya']);
    assert.deepEqual(await emails('?q=ana%20ruiz'), ['ana']);
    assert.deepEqual(await emails('?q=nobody'), []);
    // Wildcard characters are searched for literally.
    assert.deepEqual(await emails('?q=%25'), []);
    assert.deepEqual(await emails('?q=_'), []);
  });

  it('applies the typed filters', async () => {
    assert.deepEqual(await emails('?lifecycle_stage=prospect'), ['dana', 'ken', 'marcus']);
    assert.deepEqual(await emails('?email_verification=risky'), ['info']);
    assert.deepEqual(await emails('?subscription_status=unsubscribed'), ['sam']);
    assert.deepEqual(await emails(`?tag_id=${tag.saas}`), ['dana', 'priya']);
    assert.deepEqual(await emails(`?tag_id=${tag.agency}&lifecycle_stage=prospect`), ['dana']);
    assert.deepEqual(await emails('?updated_after=2026-11-19T00:00:00Z'), ['sam']);
    assert.deepEqual(await emails(`?company_id=${newId('company')}`), []);
    await rejects('?lifecycle_stage=vip', 'query.lifecycle_stage');
    await rejects('?tag_id=ctc_wrong', 'query.tag_id');
  });

  it('combines conditions with AND, OR and NOT (the spec example)', async () => {
    assert.deepEqual(
      await filtered({ and: [{ field: 'lifecycle_stage', op: 'in', value: ['lead', 'prospect'] }, { field: 'custom.industry', op: 'eq', value: 'SaaS' }] }),
      ['ken'],
    );
    assert.deepEqual(
      await filtered({ or: [{ field: 'lifecycle_stage', op: 'eq', value: 'customer' }, { field: 'email_verification', op: 'eq', value: 'risky' }] }),
      ['info', 'sam'],
    );
    // NOT and "not equal" include contacts where the field is empty.
    assert.deepEqual(await filtered({ not: { field: 'title', op: 'eq', value: 'VP Operations' } }), everyone.filter((name) => name !== 'priya'));
    assert.deepEqual(await filtered({ field: 'title', op: 'neq', value: 'VP Operations' }), everyone.filter((name) => name !== 'priya'));
    assert.deepEqual(
      await filtered({ and: [{ field: 'lifecycle_stage', op: 'eq', value: 'prospect' }, { not: { or: [{ field: 'do_not_contact', op: 'eq', value: true }, { field: 'tag_id', op: 'eq', value: tag.agency }] } }] }),
      ['ken'],
    );
  });

  it('filters on text, time and empty values', async () => {
    assert.deepEqual(await filtered({ field: 'email', op: 'ends_with', value: '.io' }), ['marcus']);
    assert.deepEqual(await filtered({ field: 'email', op: 'eq', value: 'PRIYA@GLOBEX.COM' }), ['priya']);
    assert.deepEqual(await filtered({ field: 'first_name', op: 'starts_with', value: 'da' }), ['dana']);
    assert.deepEqual(await filtered({ field: 'title', op: 'contains', value: '100%' }), ['marcus']);
    assert.deepEqual(await filtered({ field: 'title', op: 'contains', value: '%' }), ['marcus']);
    assert.deepEqual(await filtered({ field: 'title', op: 'is_null' }), ['ana', 'info']);
    assert.deepEqual(await filtered({ field: 'country', op: 'not_in', value: ['US'] }), everyone.filter((name) => name !== 'priya'));
    assert.deepEqual(await filtered({ field: 'last_contacted_at', op: 'gte', value: '2026-11-05T00:00:00Z' }), ['dana', 'ken', 'priya']);
    assert.deepEqual(await filtered({ field: 'last_contacted_at', op: 'is_null' }), ['ana', 'info']);
    assert.deepEqual(await filtered({ field: 'do_not_contact', op: 'eq', value: true }), ['marcus']);
  });

  it('filters on custom fields and tags', async () => {
    assert.deepEqual(await filtered({ field: 'custom.industry', op: 'in', value: ['SaaS', 'Retail'] }), ['dana', 'ken', 'priya']);
    assert.deepEqual(await filtered({ field: 'custom.industry', op: 'is_null' }), ['ana', 'info', 'sam']);
    assert.deepEqual(await filtered({ field: 'custom.industry', op: 'neq', value: 'SaaS' }), ['ana', 'dana', 'info', 'marcus', 'sam']);
    assert.deepEqual(await filtered({ field: 'custom.seats', op: 'eq', value: 40 }), ['dana']);
    // A number stored as text neither matches nor errors.
    assert.deepEqual(await filtered({ field: 'custom.seats', op: 'gt', value: 30 }), ['dana', 'priya']);
    assert.deepEqual(await filtered({ field: 'custom.seats', op: 'lte', value: 12 }), ['ken']);
    assert.deepEqual(await filtered({ field: 'tag_id', op: 'in', value: [tag.saas, tag.agency] }), ['dana', 'priya']);
    assert.deepEqual(await filtered({ field: 'tag_id', op: 'neq', value: tag.saas }), ['ana', 'info', 'ken', 'marcus', 'sam']);
  });

  it('treats values as data, never as SQL', async () => {
    assert.deepEqual(await filtered({ field: 'title', op: 'eq', value: "x' or '1'='1" }), []);
    assert.deepEqual(await filtered({ field: 'title', op: 'contains', value: "O'Brien" }), ['sam']);
    assert.deepEqual(await filtered({ field: 'custom.industry', op: 'eq', value: "SaaS'; drop table contacts; --" }), []);
    await rejectsFilter({ field: "custom.x'); drop table contacts; --", op: 'eq', value: 'x' }, 'query.filter.field');
    await rejectsFilter({ field: 'workspace_id', op: 'eq', value: 'wsp_other' }, 'query.filter.field');
    assert.deepEqual(await emails(), everyone);
  });

  it('rejects malformed filters with the path of the fault', async () => {
    await rejectsFilter('{not json');
    await rejectsFilter([]);
    await rejectsFilter({ and: [] }, 'query.filter.and');
    await rejectsFilter({ field: 'nickname', op: 'eq', value: 'x' }, 'query.filter.field');
    await rejectsFilter({ field: 'title', op: 'gt', value: 'x' }, 'query.filter.op');
    await rejectsFilter({ field: 'lifecycle_stage', op: 'eq', value: 'vip' }, 'query.filter.value');
    await rejectsFilter({ field: 'do_not_contact', op: 'eq', value: 'yes' }, 'query.filter.value');
    await rejectsFilter({ field: 'created_at', op: 'gt', value: 'yesterday' }, 'query.filter.value');
    await rejectsFilter({ field: 'custom.seats', op: 'gt', value: '30' }, 'query.filter.value');
    await rejectsFilter({ field: 'tag_id', op: 'eq', value: 'ctc_nope' }, 'query.filter.value');
    await rejectsFilter({ field: 'title', op: 'eq', value: 'x', extra: 1 }, 'query.filter.extra');
    await rejectsFilter({ and: [{ field: 'title', op: 'is_null' }, { or: [{ field: 'nope', op: 'eq', value: 1 }] }] }, 'query.filter.and[1].or[0].field');

    let nested: unknown = { field: 'title', op: 'is_null' };
    for (let depth = 0; depth < 6; depth += 1) nested = { not: nested };
    await rejectsFilter(nested);
    await rejectsFilter({ or: Array.from({ length: 51 }, () => ({ field: 'title', op: 'is_null' })) });
  });

  it('pages through a filtered, searched list', async () => {
    const query = `?lifecycle_stage=prospect&sort=email&limit=2&filter=${encodeURIComponent(JSON.stringify({ field: 'custom.industry', op: 'is_not_null' }))}`;
    const first = await list(query);
    assert.deepEqual(first.body.data.map((contact: Listed) => contact.email), ['dana@northwind.com', 'ken@fabrikam.com']);
    const second = await list(`${query}&cursor=${first.body.next_cursor}`);
    assert.deepEqual([second.body.data.map((contact: Listed) => contact.email), second.body.next_cursor], [['marcus@initech.io'], null]);
  });
});
