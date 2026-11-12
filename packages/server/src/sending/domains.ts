// Sending domains (spec §6.5, §8.2, §8.3, §8.10): DNS checks, reputation, and the ramp with its
// admin controls (§8.3.6). Every ramp change needs a reason and is audited.

import {
  BAND_MULTIPLIER_PERCENT,
  intlZoneCalendar,
  rampCap,
  rampFinalStep,
  validateCapOverride,
  validateCustomSchedule,
  type Band,
  type RampPlan,
  type RampScheduleEntry,
} from '@catalyst/core';
import type { Domain } from '@catalyst/contract';
import { activities, domain_daily_stats, mailboxes, newId, sending_domains, workspaces, type Db, type Executor } from '@catalyst/db';
import { checkDomainDns as runDnsCheck, providerOf, type DnsCheckResult, type DomainDns } from '@catalyst/email';
import { and, asc, count, eq, gte, sql } from 'drizzle-orm';

import type { Principal } from '../api/auth.ts';
import { conflict, invalidField, notFound, PG_UNIQUE_VIOLATION, pgErrorCode, validationFailed } from '../api/errors.ts';
import { decodeCursor, page } from '../api/pagination.ts';
import type { PostmasterData } from '../deliverability/postmaster.ts';
import { logTrip, rollupWorkspaceNow } from '../deliverability/rollup.ts';
import { actorOf, audit } from '../shared.ts';

export type DomainRow = typeof sending_domains.$inferSelect;

/** Mailboxes that count toward a domain's ceiling: the ones that send or will once tested. */
const COUNTED_STATUSES = ['active', 'pending'] as const;

interface DomainContext {
  mailboxCapTotal: number;
  mailboxCount: number;
  /** `YYYY-MM-DD` in the workspace timezone. */
  today: string;
}

const isoDate = (date: Date, zone: string) => {
  const local = intlZoneCalendar.toLocal(date, zone);
  return `${local.year}-${String(local.month).padStart(2, '0')}-${String(local.day).padStart(2, '0')}`;
};

async function contextFor(db: Executor, row: DomainRow, now: Date): Promise<DomainContext> {
  const [workspace] = await db.select({ zone: workspaces.default_timezone }).from(workspaces).where(eq(workspaces.id, row.workspace_id));
  const [totals] = await db
    .select({
      count: count(),
      capTotal: sql<number>`coalesce(sum(${mailboxes.daily_limit}) filter (where ${mailboxes.status} in ('active', 'pending')), 0)::int`,
    })
    .from(mailboxes)
    .where(eq(mailboxes.sending_domain_id, row.id));
  return { mailboxCapTotal: totals?.capTotal ?? 0, mailboxCount: totals?.count ?? 0, today: isoDate(now, workspace?.zone ?? 'UTC') };
}

function rampInput(row: DomainRow, mailboxCapTotal: number) {
  return {
    plan: row.ramp_plan as RampPlan,
    mailboxCapTotal,
    ...(row.ramp_plan === 'custom' && { customSchedule: row.ramp_custom_schedule as RampScheduleEntry[] }),
  };
}

const activeOverride = (row: DomainRow, today: string) =>
  row.cap_override !== null && row.cap_override_until !== null && row.cap_override_until >= today
    ? { cap: row.cap_override, until: row.cap_override_until, reason: row.cap_override_reason }
    : null;

const withBand = (cap: number, band: string) => Math.floor((cap * BAND_MULTIPLIER_PERCENT[band as Band]) / 100);

function todayCap(row: DomainRow, context: DomainContext): number {
  const override = activeOverride(row, context.today);
  return withBand(override?.cap ?? rampCap({ ...rampInput(row, context.mailboxCapTotal), step: row.ramp_step }), row.reputation_band);
}

export function serializeDomain(row: DomainRow, context: DomainContext): Domain {
  return {
    id: row.id,
    domain: row.domain,
    tracking_host: row.tracking_host,
    dkim_selectors: row.dkim_selectors,
    checks: Object.keys(row.check_details as object).length > 0 ? (row.check_details as DnsCheckResult) : null,
    alignment_status: row.alignment_status as Domain['alignment_status'],
    last_checked_at: row.last_checked_at?.toISOString() ?? null,
    blocklisted: row.blocklisted,
    postmaster: postmasterOf(row),
    first_touches_paused: row.first_touches_paused_at ? { since: row.first_touches_paused_at.toISOString(), reason: row.first_touches_paused_reason ?? '' } : null,
    reputation_score: row.reputation_score,
    reputation_band: row.reputation_band as Band,
    ramp: {
      plan: row.ramp_plan as RampPlan,
      step: row.ramp_step,
      final_step: rampFinalStep(rampInput(row, context.mailboxCapTotal)),
      status: row.ramp_status as Domain['ramp']['status'],
      manual_hold: row.ramp_manual_hold,
      today_cap: todayCap(row, context),
      cap_override: activeOverride(row, context.today),
    },
    mailbox_count: context.mailboxCount,
    created_at: row.created_at.toISOString(),
  };
}

function postmasterOf(row: DomainRow): Domain['postmaster'] {
  const data = (row.postmaster_data ?? null) as Partial<PostmasterData> | null;
  return {
    connected: row.postmaster_connected,
    synced_at: data?.synced_at ?? null,
    spam_rate: data?.spam_rate ?? null,
    auth: { spf: data?.auth?.spf ?? null, dkim: data?.auth?.dkim ?? null, dmarc: data?.auth?.dmarc ?? null },
    compliance: data?.compliance?.status ?? 'unknown',
    needs_work: data?.compliance?.needs_work ?? [],
    no_data: data?.no_data ?? true,
    error: data?.error ?? null,
  };
}

export async function findDomain(db: Executor, workspaceId: string, domainId: string): Promise<DomainRow> {
  const [row] = await db.select().from(sending_domains).where(and(eq(sending_domains.id, domainId), eq(sending_domains.workspace_id, workspaceId)));
  if (!row) throw notFound('The domain');
  return row;
}

const SORT = 'domain';

export async function listDomains(db: Db, workspaceId: string, query: { limit: number; cursor?: string | undefined }, now: Date) {
  const where = [eq(sending_domains.workspace_id, workspaceId)];
  if (query.cursor) {
    const cursorId = decodeCursor(query.cursor, SORT);
    where.push(sql`(${sending_domains.domain}, ${sending_domains.id}) > (select d.domain, d.id from sending_domains d where d.id = ${cursorId} and d.workspace_id = ${workspaceId})`);
  }
  const rows = await db.select().from(sending_domains).where(and(...where)).orderBy(asc(sending_domains.domain), asc(sending_domains.id)).limit(query.limit + 1);
  const { rows: kept, next_cursor } = page(rows, query.limit, SORT);
  const data: Domain[] = [];
  for (const row of kept) data.push(serializeDomain(row, await contextFor(db, row, now)));
  return { data, next_cursor };
}

export async function getDomain(db: Db, workspaceId: string, domainId: string, now: Date): Promise<Domain> {
  const row = await findDomain(db, workspaceId, domainId);
  return serializeDomain(row, await contextFor(db, row, now));
}

export async function createDomain(
  db: Db,
  principal: Principal,
  input: { domain: string; tracking_host?: string | undefined; ramp_plan?: 'new_domain' | 'aged_domain' | undefined; dkim_selectors?: string[] | undefined },
  now: Date,
): Promise<Domain> {
  const domain = input.domain.toLowerCase();
  const trackingHost = input.tracking_host?.toLowerCase() ?? null;
  if (trackingHost && trackingHost !== domain && !trackingHost.endsWith(`.${domain}`)) {
    throw invalidField('body.tracking_host', `The tracking host must be on ${domain}, such as go.${domain}; a shared tracking domain is a spam signal (§9.1).`);
  }
  try {
    const [row] = await db
      .insert(sending_domains)
      .values({
        id: newId('domain'),
        workspace_id: principal.workspace.id,
        domain,
        tracking_host: trackingHost,
        ramp_plan: input.ramp_plan ?? 'new_domain',
        dkim_selectors: input.dkim_selectors ?? [],
        created_at: now,
      })
      .returning();
    await audit(db, principal, 'domain.created', { type: 'domain', id: row!.id }, { domain, ramp_plan: row!.ramp_plan }, now);
    return serializeDomain(row!, await contextFor(db, row!, now));
  } catch (error) {
    if (pgErrorCode(error) === PG_UNIQUE_VIOLATION) throw conflict(`${domain} is already added.`, [{ path: 'body.domain', message: 'Already added.' }]);
    throw error;
  }
}

export async function deleteDomain(db: Db, principal: Principal, domainId: string, now: Date): Promise<void> {
  await db.transaction(async (tx) => {
    const row = await findDomain(tx, principal.workspace.id, domainId);
    const [mailboxCount] = await tx.select({ count: count() }).from(mailboxes).where(eq(mailboxes.sending_domain_id, domainId));
    if ((mailboxCount?.count ?? 0) > 0) throw conflict(`${row.domain} still has ${mailboxCount!.count} mailbox(es). Remove them first.`);
    await tx.delete(sending_domains).where(eq(sending_domains.id, domainId));
    await audit(tx, principal, 'domain.deleted', { type: 'domain', id: domainId }, { domain: row.domain }, now);
  });
}

export async function checkDomain(db: Db, workspaceId: string, domainId: string, deps: { domainDns: DomainDns; trackingTarget: string | null }, now: Date): Promise<Domain> {
  const row = await findDomain(db, workspaceId, domainId);
  const hosts = await db.select({ smtp_host: mailboxes.smtp_host }).from(mailboxes).where(eq(mailboxes.sending_domain_id, domainId));
  const providers = [...new Set(hosts.map((host) => providerOf(host.smtp_host)))];
  const result = await runDnsCheck(deps.domainDns, {
    domain: row.domain,
    providers: providers.length > 0 ? providers : ['other'],
    dkimSelectors: row.dkim_selectors,
    trackingHost: row.tracking_host,
    trackingTarget: deps.trackingTarget,
  });
  // §8.9: SPF, DKIM or DMARC that passed and now fails pauses the domain's first touches.
  const started = AUTH_RECORDS.filter((record) => (row[`${record}_status`] === 'pass' || row[`${record}_status`] === 'warn') && result[record].status === 'fail');
  const trips = started.length > 0 && row.first_touches_paused_at === null;
  const updated = await db.transaction(async (tx) => {
    const [saved] = await tx
      .update(sending_domains)
      .set({
        spf_status: result.spf.status,
        dkim_status: result.dkim.status,
        dmarc_status: result.dmarc.status,
        dmarc_policy: result.dmarc.policy,
        mx_status: result.mx.status,
        tracking_status: result.tracking.status,
        check_details: result,
        last_checked_at: now,
        ...(trips && { first_touches_paused_at: now, first_touches_paused_reason: started.join(', ') }),
      })
      .where(eq(sending_domains.id, domainId))
      .returning();
    if (trips) await logTrip(tx, row.workspace_id, { signal: 'authentication', level: 'pause', scope: 'domain_first_touches' }, { domain_id: row.id, domain: row.domain, records: started }, now);
    return saved!;
  });
  if (trips) await rollupWorkspaceNow(db, row.workspace_id, now);
  return serializeDomain(updated, await contextFor(db, updated, now));
}

const AUTH_RECORDS = ['spf', 'dkim', 'dmarc'] as const;

/** Lets first touches go again after the authentication breaker, once a person has read why and the records pass (§8.9). */
export async function resumeDomainFirstTouches(db: Db, principal: Principal, domainId: string, input: { acknowledge_cause?: boolean | undefined }, now: Date): Promise<Domain> {
  const row = await findDomain(db, principal.workspace.id, domainId);
  if (row.first_touches_paused_at === null) throw conflict('First touches aren’t paused on this domain.');
  if (input.acknowledge_cause !== true) throw invalidField('body.acknowledge_cause', `First touches were paused because ${row.first_touches_paused_reason ?? 'authentication'} started failing. Pass acknowledge_cause: true to confirm you have dealt with it.`);
  const failing = AUTH_RECORDS.filter((record) => row[`${record}_status`] === 'fail');
  if (failing.length > 0) throw conflict(`${failing.map((record) => record.toUpperCase()).join(', ')} still fails. Fix the record, run checkDomainDns again, then resume.`);
  const updated = await db.transaction(async (tx) => {
    const [saved] = await tx.update(sending_domains).set({ first_touches_paused_at: null, first_touches_paused_reason: null }).where(eq(sending_domains.id, row.id)).returning();
    await tx.insert(activities).values({ id: newId('activity'), workspace_id: row.workspace_id, type: 'domain.first_touches_resumed', ...actorOf(principal), data: { domain_id: row.id, domain: row.domain, paused_since: row.first_touches_paused_at!.toISOString(), reason: row.first_touches_paused_reason }, occurred_at: now });
    await audit(tx, principal, 'domain.first_touches_resumed', { type: 'domain', id: row.id }, { acknowledged: true, reason: row.first_touches_paused_reason }, now);
    return saved!;
  });
  return serializeDomain(updated, await contextFor(db, updated, now));
}

async function history(db: Executor, domainId: string, today: string) {
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10);
  return db.select().from(domain_daily_stats).where(and(eq(domain_daily_stats.domain_id, domainId), gte(domain_daily_stats.day, since))).orderBy(asc(domain_daily_stats.day));
}

export async function getDomainReputation(db: Db, workspaceId: string, domainId: string, now: Date) {
  const row = await findDomain(db, workspaceId, domainId);
  const context = await contextFor(db, row, now);
  return {
    domain_id: row.id,
    score: row.reputation_score,
    band: row.reputation_band as Band,
    band_changed_at: row.band_changed_at?.toISOString() ?? null,
    inputs: row.reputation_inputs as Record<string, unknown>,
    history: (await history(db, row.id, context.today)).map((day) => ({ day: day.day, score: day.reputation_score, band: day.reputation_band })),
  };
}

async function rampView(db: Executor, row: DomainRow, now: Date) {
  const context = await contextFor(db, row, now);
  const input = rampInput(row, context.mailboxCapTotal);
  const finalStep = rampFinalStep(input);
  const schedule = Array.from({ length: finalStep + 1 }, (_, step) => ({ step, cap: rampCap({ ...input, step }) }));
  const nextStep = Math.min(row.ramp_step + 1, finalStep);
  const tomorrowStep = row.ramp_manual_hold || row.ramp_status === 'stopped' ? row.ramp_step : nextStep;
  return {
    domain_id: row.id,
    plan: row.ramp_plan as RampPlan,
    custom_schedule: (row.ramp_custom_schedule as RampScheduleEntry[] | null) ?? null,
    step: row.ramp_step,
    final_step: finalStep,
    status: row.ramp_status as Domain['ramp']['status'],
    status_reason: row.ramp_status_reason,
    manual_hold: row.ramp_manual_hold,
    mailbox_cap_total: context.mailboxCapTotal,
    today_cap: todayCap(row, context),
    tomorrow_cap: rampCap({ ...input, step: tomorrowStep }),
    schedule,
    cap_override: activeOverride(row, context.today),
    history: (await history(db, row.id, context.today)).map((day) => ({
      day: day.day,
      planned_cap: day.planned_cap,
      sent: day.sent ?? 0,
      ramp_step: day.ramp_step,
      ramp_action: day.ramp_action,
      reputation_band: day.reputation_band,
    })),
  };
}

export async function getDomainRamp(db: Db, workspaceId: string, domainId: string, now: Date) {
  return rampView(db, await findDomain(db, workspaceId, domainId), now);
}

/** Applies one admin change to a domain's ramp: the row update, an activity for the Events tab, and an audit entry. */
async function changeRamp(
  db: Db,
  principal: Principal,
  domainId: string,
  now: Date,
  change: (row: DomainRow, context: DomainContext) => { patch: Partial<typeof sending_domains.$inferInsert>; activity: string; data: Record<string, unknown> },
) {
  return db.transaction(async (tx) => {
    const row = await findDomain(tx, principal.workspace.id, domainId);
    const { patch, activity, data } = change(row, await contextFor(tx, row, now));
    const [updated] = await tx.update(sending_domains).set(patch).where(eq(sending_domains.id, domainId)).returning();
    const details = { domain_id: domainId, domain: row.domain, ...data };
    await tx.insert(activities).values({ id: newId('activity'), workspace_id: principal.workspace.id, type: activity, ...actorOf(principal), data: details, occurred_at: now });
    await audit(tx, principal, activity, { type: 'domain', id: domainId }, details, now);
    return rampView(tx, updated!, now);
  });
}

export function updateDomainRamp(db: Db, principal: Principal, domainId: string, input: { plan: RampPlan; custom_schedule?: RampScheduleEntry[] | undefined; reason: string }, now: Date) {
  if (input.plan === 'custom') {
    if (!input.custom_schedule) throw invalidField('body.custom_schedule', 'A custom plan needs a schedule.');
    const problems = validateCustomSchedule(input.custom_schedule);
    if (problems.length > 0) throw validationFailed(problems.map((message) => ({ path: 'body.custom_schedule', message })));
  } else if (input.custom_schedule) throw invalidField('body.custom_schedule', 'Only the custom plan takes a schedule.');

  return changeRamp(db, principal, domainId, now, (row, context) => {
    const schedule = input.plan === 'custom' ? [...input.custom_schedule!].sort((a, b) => a.step - b.step) : null;
    const finalStep = rampFinalStep({ plan: input.plan, mailboxCapTotal: context.mailboxCapTotal, ...(schedule && { customSchedule: schedule }) });
    const step = Math.min(row.ramp_step, finalStep);
    return {
      patch: {
        ramp_plan: input.plan,
        ramp_custom_schedule: schedule,
        ramp_step: step,
        ramp_status: step >= finalStep ? 'complete' : row.ramp_manual_hold ? 'holding' : 'ramping',
        ramp_status_reason: `plan changed: ${input.reason}`,
      },
      activity: 'domain.ramp_plan_changed',
      data: { from: row.ramp_plan, to: input.plan, reason: input.reason },
    };
  });
}

export function holdDomainRamp(db: Db, principal: Principal, domainId: string, input: { reason: string }, now: Date) {
  return changeRamp(db, principal, domainId, now, (row) => {
    if (row.ramp_manual_hold) throw conflict('The ramp is already held.');
    return {
      patch: { ramp_manual_hold: true, ramp_status: 'holding', ramp_status_reason: `held by an admin: ${input.reason}` },
      activity: 'domain.ramp_held',
      data: { step: row.ramp_step, reason: input.reason, manual: true },
    };
  });
}

export function resumeDomainRamp(db: Db, principal: Principal, domainId: string, input: { reason: string }, now: Date) {
  return changeRamp(db, principal, domainId, now, (row, context) => {
    if (!row.ramp_manual_hold) throw conflict('The ramp is not held.');
    const complete = row.ramp_step >= rampFinalStep(rampInput(row, context.mailboxCapTotal));
    return {
      patch: { ramp_manual_hold: false, ramp_status: complete ? 'complete' : 'ramping', ramp_status_reason: `resumed by an admin: ${input.reason}` },
      activity: 'domain.ramp_resumed',
      data: { step: row.ramp_step, reason: input.reason },
    };
  });
}

export function stepBackDomainRamp(db: Db, principal: Principal, domainId: string, input: { steps?: number | undefined; reason: string }, now: Date) {
  return changeRamp(db, principal, domainId, now, (row) => {
    const steps = input.steps ?? 1;
    if (row.ramp_step === 0) throw conflict('The ramp is already at its first step.');
    const step = Math.max(0, row.ramp_step - steps);
    return {
      patch: { ramp_step: step, ramp_status: 'stepped_back', ramp_status_reason: `stepped back by an admin: ${input.reason}` },
      activity: 'domain.ramp_stepped_back',
      data: { from: row.ramp_step, to: step, reason: input.reason, manual: true },
    };
  });
}

export function setDomainCapOverride(db: Db, principal: Principal, domainId: string, input: { cap: number; until: string; reason: string }, now: Date) {
  return changeRamp(db, principal, domainId, now, (row, context) => {
    const currentStepCap = rampCap({ ...rampInput(row, context.mailboxCapTotal), step: row.ramp_step });
    const problems = validateCapOverride({ cap: input.cap, currentStepCap, today: context.today, until: input.until });
    if (problems.length > 0) throw validationFailed(problems.map((message) => ({ path: message.includes('date') || message.includes('days') ? 'body.until' : 'body.cap', message })));
    return {
      patch: { cap_override: input.cap, cap_override_until: input.until, cap_override_reason: input.reason, cap_override_by: principal.kind === 'user' ? principal.id : null },
      activity: 'domain.cap_overridden',
      data: { cap: input.cap, until: input.until, step_cap: currentStepCap, reason: input.reason },
    };
  });
}

export async function clearDomainCapOverride(db: Db, principal: Principal, domainId: string, now: Date): Promise<void> {
  await changeRamp(db, principal, domainId, now, (row) => {
    if (row.cap_override === null) throw conflict('There is no cap override to remove.');
    return {
      patch: { cap_override: null, cap_override_until: null, cap_override_reason: null, cap_override_by: null },
      activity: 'domain.cap_overridden',
      data: { cleared: true, previous_cap: row.cap_override },
    };
  });
}

