import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import type * as core from '@catalyst/core';
import { eq, getTableName, is, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { isPgEnum, PgTable, type PgEnum } from 'drizzle-orm/pg-core';
import pg from 'pg';
import { afterAll, beforeAll, describe, expectTypeOf, it } from 'vitest';

import { ID_PREFIXES, idKind, newId } from './ids.ts';
import * as schema from './schema/index.ts';

const exported: unknown[] = Object.values(schema);
const tables = exported.filter((value): value is PgTable => is(value, PgTable));
const enums = exported.filter((value): value is PgEnum<[string, ...string[]]> => isPgEnum(value));

describe('IDs (§6.1)', () => {
  it('carry the entity prefix and can be read back', () => {
    const id = newId('contact');
    assert.match(id, /^ctc_[0-9a-z]{26}$/);
    assert.equal(idKind(id), 'contact');
    assert.equal(idKind(newId('api_key')), 'api_key');
    assert.equal(idKind('nope_01jd'), null);
    assert.equal(idKind('noprefix'), null);
  });

  it('sort by creation time', async () => {
    const first = newId('message');
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = newId('message');
    assert.ok(first < second);
  });

  it('use a distinct prefix per entity', () => {
    const prefixes = Object.values(ID_PREFIXES);
    assert.equal(new Set(prefixes).size, prefixes.length);
  });
});

describe('schema definition', () => {
  it('defines the 51 tables and 30 enums of spec §6', () => {
    assert.equal(tables.length, 51);
    assert.equal(enums.length, 30);
  });

  it('keeps its enums identical to the unions in @catalyst/core', () => {
    type Values<E extends { enumValues: readonly string[] }> = E['enumValues'][number];
    expectTypeOf<Values<typeof schema.threadStage>>().toEqualTypeOf<core.ThreadStage>();
    expectTypeOf<Values<typeof schema.threadState>>().toEqualTypeOf<core.ThreadState>();
    expectTypeOf<Values<typeof schema.nextActionType>>().toEqualTypeOf<core.NextActionType>();
    expectTypeOf<Values<typeof schema.stepMode>>().toEqualTypeOf<core.StepMode>();
    expectTypeOf<Values<typeof schema.sequenceFinish>>().toEqualTypeOf<core.SequenceFinish>();
    expectTypeOf<Values<typeof schema.waitUnit>>().toEqualTypeOf<core.WaitUnit>();
    expectTypeOf<Values<typeof schema.messageDirection>>().toEqualTypeOf<core.MessageDirection>();
    expectTypeOf<Values<typeof schema.messageStatus>>().toEqualTypeOf<core.MessageStatus>();
    expectTypeOf<Values<typeof schema.messageAuthor>>().toEqualTypeOf<core.MessageAuthor>();
    expectTypeOf<Values<typeof schema.inboundKind>>().toEqualTypeOf<core.InboundKind>();
    expectTypeOf<Values<typeof schema.openStatus>>().toEqualTypeOf<core.OpenStatus>();
    expectTypeOf<Values<typeof schema.trackingType>>().toEqualTypeOf<core.TrackingType>();
    expectTypeOf<Values<typeof schema.trackingSource>>().toEqualTypeOf<core.TrackingSource>();
    expectTypeOf<Values<typeof schema.campaignStatus>>().toEqualTypeOf<core.CampaignStatus>();
    expectTypeOf<Values<typeof schema.autonomyLevel>>().toEqualTypeOf<core.AutonomyLevel>();
    expectTypeOf<Values<typeof schema.escalationReason>>().toEqualTypeOf<core.EscalationReason>();
    expectTypeOf<Values<typeof schema.escalationPriority>>().toEqualTypeOf<core.EscalationPriority>();
  });
});

// Needs a PostgreSQL server: set TEST_DATABASE_URL to any database on it. Each run creates and
// drops its own database, so nothing else on the server is touched.
const adminUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!adminUrl)('migrations against PostgreSQL', () => {
  const databaseName = `catalyst_test_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
  const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));
  let pool: pg.Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  const workspaceId = newId('workspace');
  const campaignId = newId('campaign');
  const contactId = newId('contact');

  /** Asserts that the statement fails with the given PostgreSQL error code. */
  const rejects = (code: string, run: () => PromiseLike<unknown>) =>
    assert.rejects(async () => run(), (error: { code?: string; cause?: { code?: string } }) => {
      assert.equal(error.code ?? error.cause?.code, code);
      return true;
    });
  const UNIQUE_VIOLATION = '23505';
  const CHECK_VIOLATION = '23514';

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`create database ${databaseName}`);
    await admin.end();

    const url = new URL(adminUrl!);
    url.pathname = `/${databaseName}`;
    pool = new pg.Pool({ connectionString: url.toString() });
    db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder });

    await db.insert(schema.workspaces).values({ id: workspaceId, name: 'Acme', physical_address: '500 Howard St, San Francisco' });
    await db.insert(schema.campaigns).values({
      id: campaignId,
      workspace_id: workspaceId,
      name: 'Agency outreach Q4',
      objective: 'Book discovery calls',
      persona: { tone: 'friendly' },
      sending_window: { days: [1, 2, 3, 4, 5], start: '08:30', end: '17:30', tz: 'contact' },
    });
    await db.insert(schema.contacts).values({ id: contactId, workspace_id: workspaceId, email: 'Priya@Globex.com', first_name: 'Priya', title: 'VP Operations' });
  });

  afterAll(async () => {
    await pool?.end();
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`drop database if exists ${databaseName}`);
    await admin.end();
  });

  it('creates every table and enum, with the same values', async () => {
    const tableRows = await pool.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' order by 1",
    );
    assert.deepEqual(tableRows.rows.map((row) => row.table_name), tables.map((table) => getTableName(table)).sort());

    const enumRows = await pool.query<{ typname: string; labels: string[] }>(
      'select t.typname, array_agg(e.enumlabel::text order by e.enumsortorder) as labels from pg_enum e join pg_type t on t.oid = e.enumtypid group by 1',
    );
    const inDatabase = Object.fromEntries(enumRows.rows.map((row) => [row.typname, row.labels]));
    assert.deepEqual(inDatabase, Object.fromEntries(enums.map((entry) => [entry.enumName, [...entry.enumValues]])));
  });

  it('is a no-op when migrated again', async () => {
    await migrate(db, { migrationsFolder });
  });

  it('applies the campaign defaults from the spec', async () => {
    const [campaign] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, campaignId));
    assert.ok(campaign);
    assert.deepEqual(
      [campaign.status, campaign.autonomy, campaign.agent_mode, campaign.sending_priority, campaign.delivery_grace_minutes],
      ['draft', 'assisted', 'built_in', 'normal', 240],
    );
    assert.deepEqual([campaign.auto_send_min_confidence, campaign.goal_auto_confirm_threshold], ['0.800', '0.850']);
    assert.deepEqual(campaign.blackout_dates, []);
    assert.deepEqual(campaign.enrollment_rules, { skip_active_elsewhere: true, cooldown_days: 30, allow_role_accounts: false, allow_risky: false });
    assert.ok(campaign.created_at instanceof Date);
  });

  it('treats contact emails case-insensitively and frees them on soft delete', async () => {
    const duplicate = { id: newId('contact'), workspace_id: workspaceId, email: 'priya@globex.com' };
    await rejects(UNIQUE_VIOLATION, () => db.insert(schema.contacts).values(duplicate));

    const found = await db.select({ id: schema.contacts.id }).from(schema.contacts).where(eq(schema.contacts.email, 'PRIYA@GLOBEX.COM'));
    assert.deepEqual(found, [{ id: contactId }]);

    await db.update(schema.contacts).set({ deleted_at: new Date() }).where(eq(schema.contacts.id, contactId));
    await db.insert(schema.contacts).values(duplicate);
    await db.delete(schema.contacts).where(eq(schema.contacts.id, duplicate.id));
    await db.update(schema.contacts).set({ deleted_at: null }).where(eq(schema.contacts.id, contactId));
  });

  it('maintains the generated full-text search column', async () => {
    const hits = await db
      .select({ id: schema.contacts.id })
      .from(schema.contacts)
      .where(sql`${schema.contacts.search} @@ to_tsquery('simple', 'operations & priya')`);
    assert.deepEqual(hits, [{ id: contactId }]);
  });

  it('allows one initial email per campaign and keeps ai_adapt off it', async () => {
    const step = () => ({ id: newId('step'), campaign_id: campaignId, position: 1 });
    await db.insert(schema.campaign_steps).values(step());
    await rejects(UNIQUE_VIOLATION, () => db.insert(schema.campaign_steps).values(step()));

    const sequenceId = newId('sequence');
    await db.insert(schema.follow_up_sequences).values({ id: sequenceId, campaign_id: campaignId, name: 'No reply to the first email', stages: ['sent', 'received'] });
    const followUp = (position: number) => ({ id: newId('step'), campaign_id: campaignId, sequence_id: sequenceId, position, wait_amount: 3, mode: 'ai_adapt' as const });
    await db.insert(schema.campaign_steps).values(followUp(1));
    await rejects(UNIQUE_VIOLATION, () => db.insert(schema.campaign_steps).values(followUp(1)));
    // At most 6 steps is checked when saving (§5.10); the database only keeps positions positive, so steps can be reordered.
    await rejects(CHECK_VIOLATION, () => db.insert(schema.campaign_steps).values(followUp(0)));

    await db.delete(schema.campaign_steps).where(sql`${schema.campaign_steps.sequence_id} is null`);
    await rejects(CHECK_VIOLATION, () => db.insert(schema.campaign_steps).values({ ...step(), mode: 'ai_adapt' }));
    await rejects(CHECK_VIOLATION, () => db.insert(schema.campaign_steps).values({ ...step(), wait_amount: 2 }));
    await rejects(CHECK_VIOLATION, () => db.insert(schema.follow_up_sequences).values({ id: newId('sequence'), campaign_id: campaignId, name: 'Empty', stages: [] }));
  });

  it('enforces one thread per contact per campaign and the stage constraints', async () => {
    const threadId = newId('thread');
    const thread = { id: threadId, workspace_id: workspaceId, campaign_id: campaignId, contact_id: contactId };
    await db.insert(schema.threads).values(thread);
    await rejects(UNIQUE_VIOLATION, () => db.insert(schema.threads).values({ ...thread, id: newId('thread') }));

    const [stored] = await db.select().from(schema.threads).where(eq(schema.threads.id, threadId));
    assert.ok(stored);
    assert.deepEqual(
      [stored.stage, stored.stage_rank, stored.state, stored.next_action_type, stored.open_status, stored.manually_paused, stored.closed_at],
      ['queued', 0, 'active', 'send_initial', 'unopened', false, null],
    );

    // A thread past Queued needs its mailbox, and a goal stage needs its goal.
    const update = (values: Partial<typeof schema.threads.$inferInsert>) => db.update(schema.threads).set(values).where(eq(schema.threads.id, threadId));
    await rejects(CHECK_VIOLATION, () => update({ stage: 'sent' }));
    await rejects(CHECK_VIOLATION, () => update({ stage: 'goal_achieved' }));
  });

  it('requires a suppression to name an address, a hash or a domain', async () => {
    const suppression = { id: newId('suppression'), workspace_id: workspaceId, reason: 'manual' as const, source: 'manual' };
    await rejects(CHECK_VIOLATION, () => db.insert(schema.suppressions).values(suppression));
    await db.insert(schema.suppressions).values({ ...suppression, domain: 'Competitor.com' });
    await rejects(UNIQUE_VIOLATION, () => db.insert(schema.suppressions).values({ ...suppression, id: newId('suppression'), domain: 'competitor.com' }));
  });
});
