import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';

import { activities, audit_log, capacity_plans, domain_daily_stats, mailbox_daily_stats, mailboxes, newId, sending_domains, type Db } from '@catalyst/db';
import { createTestDatabase } from '@catalyst/db/testing';
import { MemoryQueue } from '@catalyst/jobs';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { call, seedApiKey, seedWorkspace } from '../api/testing.ts';
import { loadCapacity, workspaceDay } from '../outbound/capacity.ts';
import { describeWarning } from '../notifications/dispatch.ts';
import { setDb, setDeps } from '../runtime.ts';
import { QUOTA_REASON_PREFIX } from '../sending/mailboxes.ts';
import { blocklistCheck, dailyDnsCheck } from './checks.ts';
import { dailyCapacityPlan } from './daily.ts';
import { daysBefore, statsRollup } from './rollup.ts';

// Needs a PostgreSQL server: set TEST_DATABASE_URL to any database on it.
const adminUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!adminUrl)('the daily ramp and warm-up, and the hourly scores and breakers (§8.3.2, §8.9, §8.10)', () => {
  let db: Db;
  let drop: () => Promise<void>;
  const now = new Date();
  const { day: today } = workspaceDay(now, 'UTC');
  const yesterday = daysBefore(today, 1);

  beforeAll(async () => {
    ({ db, drop } = await createTestDatabase(adminUrl!));
  });
  afterAll(async () => {
    await drop?.();
  });

  /** A workspace of its own with one domain and its mailboxes. */
  async function setup(options: { band?: string; mailboxes?: Partial<typeof mailboxes.$inferInsert>[] } = {}) {
    const workspaceId = await seedWorkspace(db, `W ${newId('workspace').slice(-6)}`);
    const domainId = newId('domain');
    const domain = `${domainId.slice(-8)}.example`;
    await db.insert(sending_domains).values({ id: domainId, workspace_id: workspaceId, domain, reputation_band: options.band ?? 'healthy' });
    const mailboxIds: string[] = [];
    for (const [index, extra] of (options.mailboxes ?? [{}]).entries()) {
      const id = newId('mailbox');
      await db.insert(mailboxes).values({
        id, workspace_id: workspaceId, sending_domain_id: domainId, email: `m${index}@${domain}`, display_name: 'Alex', auth: 'password', status: 'active',
        smtp_host: 's', smtp_port: 465, smtp_secure: 'tls', smtp_username: 'a', imap_host: 'i', imap_username: 'a', credentials_enc: Buffer.from('x'), credentials_key_version: 1, folders: {}, ...extra,
      });
      mailboxIds.push(id);
    }
    return { workspaceId, domainId, domain, mailboxIds };
  }
  const domainRow = async (id: string) => (await db.select().from(sending_domains).where(eq(sending_domains.id, id)))[0]!;
  const mailboxRow = async (id: string) => (await db.select().from(mailboxes).where(eq(mailboxes.id, id)))[0]!;
  const logged = async (workspaceId: string, type: string) => db.select().from(activities).where(and(eq(activities.workspace_id, workspaceId), eq(activities.type, type)));

  it('moves a Healthy domain up one step after a sending day, warms its mailboxes, and does it once a day', async () => {
    const { workspaceId, domainId, mailboxIds } = await setup();
    await db.insert(domain_daily_stats).values({ domain_id: domainId, day: yesterday, planned_cap: 20, sent: 12, reputation_band: 'healthy' });
    await dailyCapacityPlan(db, now);
    const domain = await domainRow(domainId);
    assert.deepEqual([domain.ramp_step, domain.ramp_status, domain.last_sending_day], [1, 'ramping', yesterday]);
    assert.equal((await mailboxRow(mailboxIds[0]!)).warmup_step, 1);
    const [ramp] = await logged(workspaceId, 'domain.ramp_advanced');
    assert.deepEqual([(ramp!.data as { from_step: number }).from_step, (ramp!.data as { to_step: number }).to_step], [0, 1]);
    const [row] = await db.select().from(domain_daily_stats).where(and(eq(domain_daily_stats.domain_id, domainId), eq(domain_daily_stats.day, today)));
    assert.deepEqual([row!.ramp_step, row!.ramp_action], [1, 'advanced']);
    assert.ok(row!.planned_cap > 0, 'today’s cap is planned');
    assert.equal((await db.select().from(domain_daily_stats).where(and(eq(domain_daily_stats.domain_id, domainId), eq(domain_daily_stats.day, yesterday))))[0]!.counted_as_sending_day, true);

    await dailyCapacityPlan(db, new Date(now.getTime() + 60_000));
    assert.equal((await domainRow(domainId)).ramp_step, 1, 'a second run the same day changes nothing');
    assert.equal((await mailboxRow(mailboxIds[0]!)).warmup_step, 1);
  });

  it('does not move on a day that used under half the cap, and holds while At risk', async () => {
    const quiet = await setup();
    await db.insert(domain_daily_stats).values({ domain_id: quiet.domainId, day: yesterday, planned_cap: 20, sent: 5, reputation_band: 'healthy' });
    await dailyCapacityPlan(db, now);
    assert.deepEqual([(await domainRow(quiet.domainId)).ramp_step, (await domainRow(quiet.domainId)).ramp_status_reason], [0, 'not_a_sending_day']);

    const risky = await setup({ band: 'at_risk', mailboxes: [{ health_band: 'at_risk' }] });
    await db.insert(domain_daily_stats).values({ domain_id: risky.domainId, day: yesterday, planned_cap: 20, sent: 20, reputation_band: 'at_risk' });
    await dailyCapacityPlan(db, now);
    assert.deepEqual([(await domainRow(risky.domainId)).ramp_step, (await domainRow(risky.domainId)).ramp_status], [0, 'holding']);
    assert.equal((await logged(risky.workspaceId, 'domain.ramp_held')).length, 1);
    assert.equal((await mailboxRow(risky.mailboxIds[0]!)).warmup_step, 0);
    assert.equal((await logged(risky.workspaceId, 'mailbox.warmup_held')).length, 1);
  });

  it('opens a mailbox paused for a provider quota on the next local day, but not one paused today', async () => {
    const { mailboxIds } = await setup({
      mailboxes: [
        { status: 'paused', status_reason: `${QUOTA_REASON_PREFIX} (421 4.7.0 Try again later); paused until tomorrow`, updated_at: new Date(Date.parse(`${yesterday}T15:00:00Z`)) },
        { status: 'paused', status_reason: `${QUOTA_REASON_PREFIX} (421); paused until tomorrow`, updated_at: now },
        { status: 'paused', status_reason: 'breaker: hard-bounce rate 5.0% over 7 days', updated_at: new Date(Date.parse(`${yesterday}T15:00:00Z`)) },
      ],
    });
    await dailyCapacityPlan(db, now);
    assert.deepEqual(await Promise.all(mailboxIds.map(async (id) => (await mailboxRow(id)).status)), ['active', 'paused', 'paused']);
  });

  it('scores a bouncing mailbox and its domain At risk at once, pauses the mailbox, and fills today’s domain stats', async () => {
    const { workspaceId, domainId, mailboxIds } = await setup({ mailboxes: [{}, {}] });
    await db.insert(mailbox_daily_stats).values([
      { mailbox_id: mailboxIds[0]!, day: today, sent: 60, bounced_hard: 3 },
      { mailbox_id: mailboxIds[1]!, day: today, sent: 40, bounced_hard: 0 },
    ]);
    const result = await statsRollup(db, now);
    assert.ok(result.trips >= 1);
    const bouncing = await mailboxRow(mailboxIds[0]!);
    assert.deepEqual([bouncing.health_score, bouncing.health_band, bouncing.status], [60, 'at_risk', 'paused']);
    assert.match(bouncing.status_reason!, /^breaker: hard-bounce rate 5\.0% over 7 days/);
    assert.equal((await mailboxRow(mailboxIds[1]!)).status, 'active');
    const domain = await domainRow(domainId);
    assert.equal(domain.reputation_score, 100 - Math.round((40 * 0.03) / 0.05), '3 bounces in 100 sends cost 24 points');
    assert.equal(domain.reputation_band, 'at_risk', '76 is At risk');
    assert.equal((await logged(workspaceId, 'domain.reputation_changed')).length, 1);
    assert.equal((await logged(workspaceId, 'deliverability.breaker_tripped')).length, 1);
    assert.equal((await logged(workspaceId, 'mailbox.health_changed')).length, 1);
    const [row] = await db.select().from(domain_daily_stats).where(and(eq(domain_daily_stats.domain_id, domainId), eq(domain_daily_stats.day, today)));
    assert.deepEqual([row!.sent, row!.bounced_hard], [100, 3]);

    // Clean again: the band improves only after 24 hours in the better range.
    await db.update(mailbox_daily_stats).set({ bounced_hard: 0 }).where(eq(mailbox_daily_stats.mailbox_id, mailboxIds[0]!));
    await statsRollup(db, new Date(now.getTime() + 60_000));
    assert.equal((await mailboxRow(mailboxIds[0]!)).health_band, 'at_risk', 'no flapping');
    await statsRollup(db, new Date(now.getTime() + 25 * 3_600_000));
    assert.equal((await mailboxRow(mailboxIds[0]!)).health_band, 'healthy');
  });

  it('keeps today’s plan and the 7-day forecast in capacity_plans, refreshed each hour (§8.3.3)', async () => {
    const { workspaceId, mailboxIds } = await setup({ mailboxes: [{ daily_limit: 40, warmup_enabled: false }] });
    await db.insert(mailbox_daily_stats).values({ mailbox_id: mailboxIds[0]!, day: today, sent: 3 });
    await statsRollup(db, now);
    const rows = await db.select().from(capacity_plans).where(eq(capacity_plans.mailbox_id, mailboxIds[0]!));
    const today_ = rows.filter((row) => row.kind === 'allocation');
    assert.deepEqual(today_.map((row) => row.bucket).sort(), ['follow_ups', 'reply_reserve']);
    assert.ok(today_.every((row) => row.day === today && row.limited_by !== undefined));
    const live = (await loadCapacity(db, workspaceId, now)).plan.mailboxes[0]!;
    assert.deepEqual([today_.find((row) => row.bucket === 'reply_reserve')!.allocated, today_.find((row) => row.bucket === 'follow_ups')!.limited_by], [live.replyReserve, live.limitedBy], 'the record is the live plan');
    assert.equal(new Set(rows.filter((row) => row.kind === 'forecast').map((row) => row.day)).size, 7);
    await statsRollup(db, new Date(now.getTime() + 3_600_000));
    assert.equal((await db.select().from(capacity_plans).where(eq(capacity_plans.mailbox_id, mailboxIds[0]!))).length, rows.length, 'updated in place, not added to');
  });

  it('logs a warn-level trip once a week, pausing nothing (§8.9)', async () => {
    const { workspaceId, domain, mailboxIds } = await setup();
    await db.insert(mailbox_daily_stats).values({ mailbox_id: mailboxIds[0]!, day: today, sent: 100, bounced_hard: 2 });
    assert.ok((await statsRollup(db, now)).warnings >= 1);
    await statsRollup(db, new Date(now.getTime() + 3_600_000));
    const warnings = await logged(workspaceId, 'deliverability.breaker_tripped');
    assert.equal(warnings.length, 1, 'once, not every hour');
    assert.deepEqual(warnings[0]!.data, { signal: 'hard_bounce_rate', level: 'warn', scope: 'mailbox', mailbox_id: mailboxIds[0], email: `m0@${domain}`, rate: 0.02 });
    assert.equal((await mailboxRow(mailboxIds[0]!)).status, 'active');
    assert.equal(describeWarning(warnings[0]!.data as Record<string, unknown>), `m0@${domain}: hard bounces at 2.0% over 7 days (it pauses at 4%).`);
  });

  it('pauses every mailbox on a blocklisted domain', async () => {
    const { workspaceId, domainId, mailboxIds } = await setup({ mailboxes: [{}, {}] });
    await db.update(sending_domains).set({ blocklisted: true }).where(eq(sending_domains.id, domainId));
    await statsRollup(db, now);
    assert.deepEqual(await Promise.all(mailboxIds.map(async (id) => (await mailboxRow(id)).status)), ['paused', 'paused']);
    assert.equal((await domainRow(domainId)).reputation_score, 70);
    const [trip] = await logged(workspaceId, 'deliverability.breaker_tripped');
    assert.deepEqual([(trip!.data as { signal: string }).signal, (trip!.data as { mailboxes_paused: number }).mailboxes_paused], ['blocklist', 2]);
  });

  it('pauses a domain’s mailboxes when it is newly blocklisted, and needs every list to answer before delisting', async () => {
    const { workspaceId, domainId, domain, mailboxIds } = await setup({ mailboxes: [{}, {}] });
    let answers: Record<string, string[] | 'fail'> = { [`${domain}.dbl.spamhaus.org`]: ['127.0.1.2'] };
    const dns = { resolve4: async (name: string) => { const answer = answers[name]; if (answer === 'fail') throw new Error('ETIMEOUT'); return answer ?? []; } };
    await blocklistCheck(db, { dns }, now);
    assert.equal((await domainRow(domainId)).blocklisted, true);
    assert.deepEqual(await Promise.all(mailboxIds.map(async (id) => (await mailboxRow(id)).status)), ['paused', 'paused']);
    const [trip] = await logged(workspaceId, 'deliverability.breaker_tripped');
    assert.deepEqual((trip!.data as { lists: string[] }).lists, ['spamhaus_dbl']);

    answers = { [`${domain}.multi.uribl.com`]: 'fail' };
    await blocklistCheck(db, { dns }, now);
    assert.equal((await domainRow(domainId)).blocklisted, true, 'a failed lookup can’t clear it');
    answers = {};
    await blocklistCheck(db, { dns }, now);
    assert.equal((await domainRow(domainId)).blocklisted, false);
    assert.equal((await logged(workspaceId, 'domain.delisted')).length, 1);
    assert.equal((await mailboxRow(mailboxIds[0]!)).status, 'paused', 'a person resumes the mailboxes');
  });

  it('checks DNS daily and logs a record that changed', async () => {
    const { workspaceId, domainId, domain } = await setup();
    let spf = [`v=spf1 include:_spf.google.com ~all`];
    const domainDns = { resolveTxt: async (name: string) => (name === domain ? spf : name === `_dmarc.${domain}` ? ['v=DMARC1; p=none'] : []), resolveMx: async () => ['aspmx.l.google.com'], resolveCname: async () => [] };
    await dailyDnsCheck(db, { domainDns, trackingTarget: null }, now);
    assert.equal((await domainRow(domainId)).spf_status, 'pass');
    assert.equal((await logged(workspaceId, 'domain.dns_changed')).length, 0, 'the first check sets, nothing changed');
    spf = [];
    await dailyDnsCheck(db, { domainDns, trackingTarget: null }, now);
    assert.equal((await domainRow(domainId)).spf_status, 'fail');
    const [changed] = await logged(workspaceId, 'domain.dns_changed');
    assert.deepEqual((changed!.data as { changes: unknown[] }).changes, [{ record: 'spf', from: 'pass', to: 'fail' }]);
  });

  it('pauses first touches when SPF, DKIM or DMARC starts failing, until a person resumes them with the records passing (§8.9)', async () => {
    const { workspaceId, domainId, domain } = await setup({ mailboxes: [{ smtp_host: 'smtp.gmail.com' }] });
    const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const dkim = `v=DKIM1; k=rsa; p=${publicKey.export({ type: 'spki', format: 'der' }).toString('base64')}`;
    const txt: Record<string, string[]> = { [domain]: ['v=spf1 include:_spf.google.com ~all'], [`google._domainkey.${domain}`]: [dkim], [`_dmarc.${domain}`]: ['v=DMARC1; p=quarantine'] };
    const domainDns = { resolveTxt: async (name: string) => txt[name] ?? [], resolveMx: async () => ['aspmx.l.google.com'], resolveCname: async () => [] };
    await dailyDnsCheck(db, { domainDns, trackingTarget: null }, now);
    const passing = await domainRow(domainId);
    assert.deepEqual([passing.spf_status, passing.dkim_status, passing.first_touches_paused_at], ['pass', 'pass', null]);

    // The DKIM key disappears: first touches stop, with an urgent trip and the scores redone at once.
    txt[`google._domainkey.${domain}`] = [];
    await dailyDnsCheck(db, { domainDns, trackingTarget: null }, now);
    const tripped = await domainRow(domainId);
    assert.deepEqual([tripped.dkim_status, tripped.first_touches_paused_reason, tripped.first_touches_paused_at?.toISOString()], ['fail', 'dkim', now.toISOString()]);
    assert.equal((tripped.reputation_inputs as { computed_at?: string }).computed_at, now.toISOString());
    const [trip] = await logged(workspaceId, 'deliverability.breaker_tripped');
    assert.deepEqual(trip!.data, { signal: 'authentication', level: 'pause', scope: 'domain_first_touches', domain_id: domainId, domain, records: ['dkim'] });
    const capacity = await loadCapacity(db, workspaceId, now);
    assert.deepEqual([capacity.plan.mailboxes[0]!.firstTouchPool, capacity.plan.mailboxes[0]!.limitedBy], [0, 'domain_auth']);
    assert.ok(capacity.plan.mailboxes[0]!.replyLimit > 0, 'replies still go');
    await dailyDnsCheck(db, { domainDns, trackingTarget: null }, now);
    assert.equal((await logged(workspaceId, 'deliverability.breaker_tripped')).length, 1, 'still failing is not a new trip');

    // Resuming needs the acknowledgement and passing records; fixing DNS alone doesn't resume.
    setDb(db);
    setDeps({ jobs: new MemoryQueue(), config: { trackingTarget: null, appHost: null } });
    const { secret: key } = await seedApiKey(db, workspaceId, ['mailboxes:write']);
    const { secret: otherKey } = await seedApiKey(db, await seedWorkspace(db, `Other ${newId('workspace').slice(-6)}`), ['mailboxes:write']);
    const resume = (body: Record<string, unknown>, as = key) => call('POST', `/domains/${domainId}/first-touches/resume`, { key: as, body });
    assert.equal((await resume({})).status, 400);
    assert.equal((await resume({ acknowledge_cause: true })).status, 409, 'DKIM still fails');
    txt[`google._domainkey.${domain}`] = [dkim];
    await dailyDnsCheck(db, { domainDns, trackingTarget: null }, now);
    assert.ok((await domainRow(domainId)).first_touches_paused_at, 'a person resumes it');
    assert.equal((await resume({ acknowledge_cause: true }, otherKey)).status, 404);
    const resumed = await resume({ acknowledge_cause: true });
    assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
    assert.equal(resumed.body.first_touches_paused, null);
    assert.equal((await logged(workspaceId, 'domain.first_touches_resumed')).length, 1);
    assert.ok((await db.select().from(audit_log).where(and(eq(audit_log.target_id, domainId), eq(audit_log.action, 'domain.first_touches_resumed'))))[0]);
    assert.equal((await resume({ acknowledge_cause: true })).status, 409, 'not paused any more');
    setDb(undefined);
    setDeps(undefined);
  });
});
