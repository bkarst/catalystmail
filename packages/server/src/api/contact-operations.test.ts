import assert from 'node:assert/strict';

import { activities, audit_log, campaigns, contacts, emailHash, messages, newId, suppressions, threads, type Db } from '@catalyst/db';
import { createTestDatabase } from '@catalyst/db/testing';
import { MemoryQueue } from '@catalyst/jobs';
import { DnsError, type MailDns } from '@catalyst/email';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { setDb, setDeps } from '../runtime.ts';
import { call, seedApiKey, seedWorkspace } from './testing.ts';

// Needs a PostgreSQL server: set TEST_DATABASE_URL to any database on it.
const adminUrl = process.env.TEST_DATABASE_URL;

/** Every domain accepts mail except `nomail.example`; `slow.example` times out. */
const fakeDns: MailDns = {
  async resolveMx(domain) {
    if (domain === 'slow.example') throw new DnsError('ETIMEOUT');
    return domain === 'nomail.example' ? [] : [`mx.${domain}`];
  },
  async hasAddress() {
    return false;
  },
};

describe.skipIf(!adminUrl)('contact operations: timeline, verification, bulk, merge, privacy (§12.1)', () => {
  let db: Db;
  const jobs = new MemoryQueue();
  let drop: () => Promise<void>;
  let workspaceId: string;
  let key: string;
  let eraseKey: string;
  let otherKey: string;

  const post = (path: string, body: unknown, as = key) => call('POST', path, { key: as, ...(body !== undefined && { body }) });
  const get = (path: string, as = key) => call('GET', path, { key: as });
  const ok = (response: { status: number; body: any }, status = 200) => {
    assert.equal(response.status, status, JSON.stringify(response.body));
    return response.body;
  };
  const problem = (response: { status: number; body: any }, status: number, code: string) => {
    assert.equal(response.status, status, JSON.stringify(response.body));
    assert.equal(response.body.code, code);
    return response.body as { detail: string; errors?: { path: string; message: string }[] };
  };
  const contact = async (email: string, extra: Record<string, unknown> = {}) => ok(await post('/contacts', { email, ...extra }), 201);
  const tag = async (name: string) => ok(await post('/tags', { name }), 201).id as string;
  const seedCampaign = async () => {
    const id = newId('campaign');
    await db.insert(campaigns).values({ id, workspace_id: workspaceId, name: `Campaign ${id.slice(-4)}`, objective: 'Calls', persona: {}, sending_window: {} });
    return id;
  };

  beforeAll(async () => {
    ({ db, drop } = await createTestDatabase(adminUrl!));
    setDb(db);
    setDeps({ jobs });
    setDeps({ dns: fakeDns });
    workspaceId = await seedWorkspace(db, 'Acme');
    ({ secret: key } = await seedApiKey(db, workspaceId, ['contacts:read', 'contacts:write']));
    ({ secret: eraseKey } = await seedApiKey(db, workspaceId, ['contacts:read', 'contacts:erase']));
    ({ secret: otherKey } = await seedApiKey(db, await seedWorkspace(db, 'Elsewhere'), ['contacts:read', 'contacts:write', 'contacts:erase']));
  });
  afterAll(async () => {
    setDb(undefined);
    setDeps(undefined);
    await drop?.();
  });

  describe('timeline and notes', () => {
    it('adds notes and narrows the timeline by category, newest first', async () => {
      const person = await contact('timeline@example.com');
      ok(await call('PATCH', `/contacts/${person.id}`, { key, body: { title: 'CTO' } }));
      const note = ok(await post(`/contacts/${person.id}/notes`, { text: 'Met at SaaStr.' }), 201);
      assert.deepEqual([note.type, note.actor_type, note.data], ['contact.note_added', 'api_key', { text: 'Met at SaaStr.' }]);

      const all = ok(await get(`/contacts/${person.id}/timeline`)).data.map((entry: { type: string }) => entry.type);
      assert.deepEqual(all, ['contact.note_added', 'contact.updated', 'contact.created']);
      assert.deepEqual(ok(await get(`/contacts/${person.id}/timeline?category=notes`)).data.length, 1);
      assert.deepEqual(ok(await get(`/contacts/${person.id}/timeline?category=changes`)).data.map((entry: { type: string }) => entry.type), ['contact.updated', 'contact.created']);
      const first = ok(await get(`/contacts/${person.id}/timeline?limit=2`));
      assert.equal(ok(await get(`/contacts/${person.id}/timeline?limit=2&cursor=${first.next_cursor}`)).data[0].type, 'contact.created');
      problem(await get(`/contacts/${person.id}/timeline`, otherKey), 404, 'not_found');
    });
  });

  describe('verification (§8.5)', () => {
    it('stores the outcome and flags, keeps a bounced address bounced, and leaves a failed lookup alone', async () => {
      const valid = ok(await post(`/contacts/${(await contact('priya@globex.com')).id}/verify`, undefined));
      assert.deepEqual([valid.contact.email_verification, valid.contact.email_flags, valid.suggestion], ['valid', [], null]);
      assert.ok(valid.contact.email_verified_at);

      const role = ok(await post(`/contacts/${(await contact('info@globex.com')).id}/verify`, undefined));
      assert.deepEqual([role.contact.email_verification, role.contact.email_flags], ['risky', ['role']]);

      const typo = ok(await post(`/contacts/${(await contact('dana@gmial.com')).id}/verify`, undefined));
      assert.equal(typo.suggestion, 'dana@gmail.com');

      assert.equal(ok(await post(`/contacts/${(await contact('x@nomail.example')).id}/verify`, undefined)).contact.email_verification, 'invalid');
      assert.equal(ok(await post(`/contacts/${(await contact('x@slow.example')).id}/verify`, undefined)).contact.email_verification, 'unverified');

      const bounced = await contact('bounced@globex.com');
      await db.update(contacts).set({ email_verification: 'bounced' }).where(eq(contacts.id, bounced.id));
      assert.equal(ok(await post(`/contacts/${bounced.id}/verify`, undefined)).contact.email_verification, 'bounced');
    });
  });

  describe('bulk upsert', () => {
    it('creates, skips, fills and overwrites by email, and only ever adds tags', async () => {
      const saas = await tag('saas-upsert');
      const vip = await tag('vip-upsert');
      const existing = await contact('ken@fabrikam.com', { first_name: 'Ken', tag_ids: [vip] });

      const skipped = ok(await post('/contacts/bulk-upsert', { contacts: [{ email: 'KEN@fabrikam.com', first_name: 'Kenji', title: 'Founder' }, { email: 'new1@fabrikam.com' }] }));
      assert.deepEqual([skipped.created, skipped.updated, skipped.skipped], [1, 0, 1]);
      assert.deepEqual(skipped.results.map((result: { action: string }) => result.action), ['skipped', 'created']);

      const filled = ok(await post('/contacts/bulk-upsert', { dedupe_strategy: 'fill_empty', contacts: [{ email: 'ken@fabrikam.com', first_name: 'Kenji', title: 'Founder', tag_ids: [saas] }] }));
      assert.equal(filled.results[0].action, 'updated');
      let ken = ok(await get(`/contacts/${existing.id}`));
      assert.deepEqual([ken.first_name, ken.title, ken.tag_ids.sort()], ['Ken', 'Founder', [saas, vip].sort()]);

      const overwritten = ok(await post('/contacts/bulk-upsert', { dedupe_strategy: 'overwrite', contacts: [{ email: 'ken@fabrikam.com', first_name: 'Kenji' }, { email: 'Ken@Fabrikam.com', first_name: 'Repeat' }] }));
      assert.deepEqual(overwritten.results.map((result: { action: string; contact_id: string }) => [result.action, result.contact_id]), [['updated', existing.id], ['duplicate_in_request', existing.id]]);
      ken = ok(await get(`/contacts/${existing.id}`));
      assert.deepEqual([ken.first_name, ken.tag_ids.length], ['Kenji', 2]);

      const unchanged = ok(await post('/contacts/bulk-upsert', { dedupe_strategy: 'overwrite', contacts: [{ email: 'ken@fabrikam.com', first_name: 'Kenji' }] }));
      assert.equal(unchanged.results[0].action, 'unchanged');
    });

    it('writes nothing when any row is invalid, and names every bad row', async () => {
      const before = (await db.select().from(contacts)).length;
      const bad = problem(
        await post('/contacts/bulk-upsert', { contacts: [{ email: 'ok@valid.example' }, { email: 'tz@valid.example', timezone: 'Mars/Base' }, { email: 'tag@valid.example', tag_ids: [newId('tag')] }] }),
        400,
        'validation_failed',
      );
      assert.deepEqual(bad.errors!.map((error) => error.path).sort(), ['body.contacts.1.timezone', 'body.contacts.2.tag_ids.0']);
      assert.equal((await db.select().from(contacts)).length, before);
      problem(await post('/contacts/bulk-upsert', { contacts: [{ email: 'not an email' }] }), 400, 'validation_failed');
    });
  });

  describe('bulk actions', () => {
    let people: { id: string }[];
    beforeAll(async () => {
      people = [];
      for (const name of ['ann', 'bob', 'cat']) people.push(await contact(`${name}@bulk.example`, { first_name: name, city: 'Lyon' }));
    });

    it('tags and untags by ID, reporting IDs that do not exist', async () => {
      const lyon = await tag('lyon');
      const missing = newId('contact');
      const tagged = ok(await post('/contacts/bulk-actions', { action: 'tag', contact_ids: [...people.map((person) => person.id), missing], tag_ids: [lyon] }));
      assert.deepEqual([tagged.matched, tagged.changed, tagged.skipped], [3, 3, [{ contact_id: missing, reason: 'not_found' }]]);
      assert.equal(ok(await post('/contacts/bulk-actions', { action: 'tag', contact_ids: [people[0]!.id], tag_ids: [lyon] })).changed, 0);
      assert.equal(ok(await post('/contacts/bulk-actions', { action: 'untag', filter: { field: 'tag_id', op: 'eq', value: lyon }, tag_ids: [lyon] })).changed, 3);
      problem(await post('/contacts/bulk-actions', { action: 'tag', contact_ids: [people[0]!.id] }), 400, 'validation_failed');
      problem(await post('/contacts/bulk-actions', { action: 'tag', tag_ids: [lyon] }), 400, 'validation_failed');
    });

    it('sets lifecycle stage by filter, adds to a static list, and refuses a segment', async () => {
      const staged = ok(await post('/contacts/bulk-actions', { action: 'set_lifecycle_stage', filter: { field: 'city', op: 'eq', value: 'Lyon' }, lifecycle_stage: 'prospect' }));
      assert.deepEqual([staged.matched, staged.changed], [3, 3]);
      const list = ok(await post('/lists', { name: 'Lyon', kind: 'static' }), 201);
      assert.equal(ok(await post('/contacts/bulk-actions', { action: 'add_to_list', contact_ids: [people[0]!.id, people[1]!.id], list_id: list.id })).changed, 2);
      assert.equal(ok(await get(`/lists/${list.id}`)).member_count, 2);
      const segment = ok(await post('/lists', { name: 'Seg', kind: 'dynamic', filter: { field: 'city', op: 'eq', value: 'Lyon' } }), 201);
      problem(await post('/contacts/bulk-actions', { action: 'add_to_list', contact_ids: [people[0]!.id], list_id: segment.id }), 400, 'validation_failed');
    });

    it('exports CSV that a spreadsheet cannot run as a formula', async () => {
      const risky = await contact('formula@bulk.example', { first_name: '=HYPERLINK("http://evil")', notes: 'a,b' });
      const result = ok(await post('/contacts/bulk-actions', { action: 'export', contact_ids: [risky.id] }));
      const [header, line] = result.csv.trim().split('\r\n');
      assert.ok(header.startsWith('id,email,first_name,'));
      assert.ok(line.includes(`"'=HYPERLINK(""http://evil"")"`), line);
    });

    it('suppresses and deletes', async () => {
      const suppressed = ok(await post('/contacts/bulk-actions', { action: 'suppress', contact_ids: [people[2]!.id], note: 'asked by phone' }));
      assert.equal(suppressed.changed, 1);
      assert.equal(ok(await post('/contacts/bulk-actions', { action: 'suppress', contact_ids: [people[2]!.id] })).skipped[0].reason, 'already_suppressed');
      assert.equal(ok(await get('/suppressions/check?email=cat@bulk.example')).blocked, true);

      assert.equal(ok(await post('/contacts/bulk-actions', { action: 'delete', contact_ids: [people[2]!.id] })).changed, 1);
      problem(await get(`/contacts/${people[2]!.id}`), 404, 'not_found');
      assert.equal(ok(await post('/contacts/bulk-actions', { action: 'delete', contact_ids: [people[2]!.id] }, otherKey)).skipped[0].reason, 'not_found');
    });

    it('verifies in bulk', async () => {
      const result = ok(await post('/contacts/bulk-actions', { action: 'verify', contact_ids: [people[0]!.id] }));
      assert.deepEqual([result.matched, result.changed], [1, 1]);
    });
  });

  describe('duplicates and merge', () => {
    it('groups the same name at the same company, and addresses differing by dots or +tags', async () => {
      const a = await contact('maria.lopez@contoso.com', { first_name: 'Maria', last_name: 'Lopez' });
      const b = await contact('mlopez@contoso.com', { first_name: 'maria', last_name: 'LOPEZ ' });
      const c = await contact('mariaLopez+news@contoso.com');
      const groups = ok(await get('/contacts/duplicates')).data as { reason: string; contacts: { id: string }[] }[];
      const ids = (reason: string) => groups.filter((group) => group.reason === reason).map((group) => group.contacts.map((entry) => entry.id));
      assert.deepEqual(ids('same_name_and_company'), [[a.id, b.id]]);
      assert.deepEqual(ids('similar_email'), [[a.id, c.id]]);
    });

    it('folds a duplicate in: fields, tags, lists, threads and timeline move; the stricter opt-out wins', async () => {
      const t1 = await tag('merge-a');
      const t2 = await tag('merge-b');
      const keep = await contact('sam@acme-merge.example', { first_name: 'Sam', title: 'CEO', tag_ids: [t1], lifecycle_stage: 'prospect' });
      const dupe = await contact('samuel@acme-merge.example', { first_name: 'Samuel', last_name: 'Lee', title: 'Founder', tag_ids: [t2], lifecycle_stage: 'opportunity', custom_fields: { seats: 5 } });
      await db.update(contacts).set({ subscription_status: 'unsubscribed' }).where(eq(contacts.id, dupe.id));
      const list = ok(await post('/lists', { name: 'Merge list', kind: 'static', contact_ids: [dupe.id] }), 201);
      const campaignId = await seedCampaign();
      const threadId = newId('thread');
      await db.insert(threads).values({ id: threadId, workspace_id: workspaceId, campaign_id: campaignId, contact_id: dupe.id });
      ok(await post(`/contacts/${dupe.id}/notes`, { text: 'dupe note' }), 201);

      const merged = ok(await post(`/contacts/${keep.id}/merge`, { merge_contact_id: dupe.id, take_from_merged: ['title'] }));
      assert.deepEqual(
        [merged.first_name, merged.last_name, merged.title, merged.lifecycle_stage, merged.subscription_status, merged.custom_fields, merged.tag_ids.sort()],
        ['Sam', 'Lee', 'Founder', 'opportunity', 'unsubscribed', { seats: 5 }, [t1, t2].sort()],
      );
      problem(await get(`/contacts/${dupe.id}`), 404, 'not_found');
      const [thread] = await db.select().from(threads).where(eq(threads.id, threadId));
      assert.equal(thread!.contact_id, keep.id);
      assert.ok(jobs.of('thread.evaluate').some((job) => job.thread_id === threadId), 'the moved thread is re-evaluated');
      assert.equal(ok(await get(`/lists/${list.id}/members`)).data[0].id, keep.id);
      const types = ok(await get(`/contacts/${keep.id}/timeline`)).data.map((entry: { type: string }) => entry.type);
      assert.equal(types[0], 'contact.merged');
      assert.ok(types.includes('contact.note_added'));
    });

    it('refuses to merge two contacts with threads in the same campaign, or a contact into itself', async () => {
      const a = await contact('one@clash.example');
      const b = await contact('two@clash.example');
      const campaignId = await seedCampaign();
      await db.insert(threads).values([
        { id: newId('thread'), workspace_id: workspaceId, campaign_id: campaignId, contact_id: a.id },
        { id: newId('thread'), workspace_id: workspaceId, campaign_id: campaignId, contact_id: b.id },
      ]);
      assert.match(problem(await post(`/contacts/${a.id}/merge`, { merge_contact_id: b.id }), 409, 'conflict').detail, new RegExp(campaignId));
      problem(await post(`/contacts/${a.id}/merge`, { merge_contact_id: a.id }), 400, 'validation_failed');
      problem(await post(`/contacts/${a.id}/merge`, { merge_contact_id: b.id }, otherKey), 404, 'not_found');
    });
  });

  describe('export and erasure (§12.1, §6.11)', () => {
    it('exports everything held, then erases it while keeping the suppression hash', async () => {
      const person = await contact('erase.me@privacy.example', { first_name: 'Erin', last_name: 'Ma', notes: 'likes golf', custom_fields: { seats: 3 } });
      ok(await post(`/contacts/${person.id}/notes`, { text: 'Called Erin' }), 201);
      const campaignId = await seedCampaign();
      const threadId = newId('thread');
      await db.insert(threads).values({ id: threadId, workspace_id: workspaceId, campaign_id: campaignId, contact_id: person.id, subject: 'Hi Erin' });
      const mailboxId = await seedMailbox();
      await db.insert(messages).values({
        id: newId('message'), workspace_id: workspaceId, thread_id: threadId, mailbox_id: mailboxId, direction: 'inbound', status: 'received', author: 'contact',
        message_id_header: '<1@privacy.example>', from_email: 'erase.me@privacy.example', from_name: 'Erin Ma', to_emails: ['alex@sender.example'], subject: 'Re: Hi Erin', body_text: 'My number is 555-0100',
      });

      const exported = ok(await get(`/contacts/${person.id}/export`));
      assert.equal(exported.contact.email, 'erase.me@privacy.example');
      assert.equal(exported.threads[0].messages[0].body_text, 'My number is 555-0100');
      assert.ok(exported.activities.some((entry: { type: string }) => entry.type === 'contact.note_added'));

      problem(await post(`/contacts/${person.id}/erase`, undefined), 403, 'forbidden_scope');
      problem(await post(`/contacts/${person.id}/erase`, undefined, otherKey), 404, 'not_found');
      jobs.clear();
      assert.equal((await post(`/contacts/${person.id}/erase`, undefined, eraseKey)).status, 204);
      assert.deepEqual(jobs.of('thread.evaluate'), [{ thread_id: threadId }]);

      const [row] = await db.select().from(contacts).where(eq(contacts.id, person.id));
      assert.deepEqual([row!.first_name, row!.last_name, row!.notes, row!.custom_fields, row!.do_not_contact], ['Erased', 'contact', null, {}, true]);
      assert.match(row!.email, /@erased\.invalid$/);
      assert.ok(row!.deleted_at);
      const [message] = await db.select().from(messages).where(eq(messages.thread_id, threadId));
      assert.deepEqual([message!.body_text, message!.from_name, message!.subject], [null, null, '(erased)']);
      assert.notEqual(message!.from_email, 'erase.me@privacy.example');
      const [block] = await db.select().from(suppressions).where(eq(suppressions.email_hash, emailHash('erase.me@privacy.example')));
      assert.deepEqual([block!.email, block!.reason], [null, 'erased']);
      const notes = await db.select().from(activities).where(eq(activities.contact_id, person.id));
      assert.ok(notes.every((entry) => !JSON.stringify(entry.data).includes('Erin')));
      const [audited] = await db.select().from(audit_log).where(eq(audit_log.target_id, person.id));
      assert.equal(audited!.action, 'contact.erased');

      // The address can never be emailed again, even as a new contact.
      const again = await contact('erase.me@privacy.example');
      const check = ok(await get('/suppressions/check?email=erase.me@privacy.example'));
      assert.deepEqual([check.blocked, check.contact_id, check.suppressions[0].hashed_only], [true, again.id, true]);
    });
  });

  async function seedMailbox(): Promise<string> {
    const { sending_domains, mailboxes } = await import('@catalyst/db');
    const domainId = newId('domain');
    await db.insert(sending_domains).values({ id: domainId, workspace_id: workspaceId, domain: 'sender.example' });
    const mailboxId = newId('mailbox');
    await db.insert(mailboxes).values({
      id: mailboxId, workspace_id: workspaceId, sending_domain_id: domainId, email: 'alex@sender.example', display_name: 'Alex', auth: 'password',
      smtp_host: 'smtp.sender.example', smtp_port: 587, smtp_secure: 'starttls', smtp_username: 'alex', imap_host: 'imap.sender.example', imap_username: 'alex',
      credentials_enc: Buffer.from('x'), credentials_key_version: 1, folders: {},
    });
    return mailboxId;
  }
});
