// Mailboxes (spec §6.5, §7.1, §8.3.4): connecting with encrypted credentials, limits and warm-up
// within the fixed bounds, and pausing and resuming. Credentials are write-only.

import { generateKeyPairSync } from 'node:crypto';

import { BAND_MULTIPLIER_PERCENT, type Band } from '@catalyst/core';
import type { Mailbox } from '@catalyst/contract';
import { activities, campaign_mailboxes, emailDomain, mailbox_daily_stats, mailboxes, messages, newId, normalizeEmail, poll_runs, sending_domains, threads, users, type Db, type Executor } from '@catalyst/db';
import { providerOf, type MailProvider } from '@catalyst/email';
import { and, asc, desc, eq, gte, sql, type SQL } from 'drizzle-orm';

import type { Principal } from '../api/auth.ts';
import { conflict, invalidField, notFound, PG_UNIQUE_VIOLATION, pgErrorCode, validationFailed, type FieldError } from '../api/errors.ts';
import { assertFresh } from '../api/etag.ts';
import { decodeCursor, page } from '../api/pagination.ts';
import type { SecretBox } from '../secrets.ts';
import { actorOf, audit } from '../shared.ts';

export type MailboxRow = typeof mailboxes.$inferSelect;

/** Over this daily limit an admin must approve (§8.3.4). */
export const DAILY_LIMIT_WITHOUT_ADMIN = 150;
/** Warm-up can't be turned off for a mailbox younger than this (§8.3.4). */
const WARMUP_LOCK_DAYS = 14;
/** A `status_reason` with this prefix means a circuit breaker paused the mailbox (§8.9). */
export const BREAKER_PREFIX = 'breaker:';
/** How a provider rate or quota pause is marked; it lasts until the next local day (§7.2 step 6). */
export const QUOTA_REASON_PREFIX = `${BREAKER_PREFIX} the provider's rate or quota limit`;

export const PRESETS: Record<Exclude<MailProvider, 'other'>, { smtp_host: string; smtp_port: number; smtp_secure: 'tls' | 'starttls'; imap_host: string; folders: Record<string, string> }> = {
  google: { smtp_host: 'smtp.gmail.com', smtp_port: 465, smtp_secure: 'tls', imap_host: 'imap.gmail.com', folders: { inbox: 'INBOX', sent: '[Gmail]/Sent Mail', junk: '[Gmail]/Spam' } },
  microsoft: { smtp_host: 'smtp.office365.com', smtp_port: 587, smtp_secure: 'starttls', imap_host: 'outlook.office365.com', folders: { inbox: 'INBOX', sent: 'Sent Items', junk: 'Junk Email' } },
};
const DEFAULT_FOLDERS = { inbox: 'INBOX', sent: 'Sent', junk: 'Junk' };
/** §8.3.4 and §22.B defaults for a new mailbox. */
export const MAILBOX_DEFAULTS = { daily_limit: 40, hourly_limit: 12, min_interval_sec: 120, max_interval_sec: 420, warmup_enabled: true, warmup_start_volume: 10, warmup_daily_increment: 5 } as const;

/** Today's own cap of a mailbox: daily limit and warm-up, times its health multiplier (§8.3.3). */
export function mailboxTodayCap(row: Pick<MailboxRow, 'daily_limit' | 'warmup_enabled' | 'warmup_start_volume' | 'warmup_daily_increment' | 'warmup_step' | 'health_band'>): number {
  const warm = row.warmup_enabled ? Math.min(row.daily_limit, row.warmup_start_volume + row.warmup_daily_increment * row.warmup_step) : row.daily_limit;
  return Math.floor((warm * BAND_MULTIPLIER_PERCENT[row.health_band as Band]) / 100);
}

export function serializeMailbox(row: MailboxRow): Mailbox {
  const iso = (date: Date | null) => date?.toISOString() ?? null;
  return {
    id: row.id,
    email: row.email,
    sending_domain_id: row.sending_domain_id,
    provider: providerOf(row.smtp_host),
    auth: row.auth,
    smtp_host: row.smtp_host,
    smtp_port: row.smtp_port,
    smtp_secure: row.smtp_secure as 'tls' | 'starttls',
    smtp_username: row.smtp_username,
    imap_host: row.imap_host,
    imap_port: row.imap_port,
    imap_username: row.imap_username,
    folders: row.folders as Record<string, string>,
    status: row.status,
    status_reason: row.status_reason,
    daily_limit: row.daily_limit,
    hourly_limit: row.hourly_limit,
    min_interval_sec: row.min_interval_sec,
    max_interval_sec: row.max_interval_sec,
    warmup_enabled: row.warmup_enabled,
    warmup_start_volume: row.warmup_start_volume,
    warmup_daily_increment: row.warmup_daily_increment,
    display_name: row.display_name,
    signature_text: row.signature_text,
    owner_user_id: row.owner_user_id,
    warmup_step: row.warmup_step,
    today_cap: mailboxTodayCap(row),
    health_score: row.health_score,
    health_band: row.health_band as Band,
    last_sent_at: iso(row.last_sent_at),
    last_poll_at: iso(row.last_poll_at),
    last_poll_status: row.last_poll_status,
    next_poll_at: iso(row.next_poll_at),
    catalyst_dkim: publicDkimOf(row),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

/** `mailboxes.catalyst_dkim` (§6.5): the selector, the sealed private key and the public key. */
export interface CatalystDkim {
  selector: string;
  private_key_enc: string;
  public_key: string;
}

const dkimOf = (row: MailboxRow): CatalystDkim | null => (row.catalyst_dkim as CatalystDkim | null) ?? null;

function publicDkimOf(row: MailboxRow): Mailbox['catalyst_dkim'] {
  const dkim = dkimOf(row);
  if (!dkim) return null;
  return { selector: dkim.selector, record_name: `${dkim.selector}._domainkey.${emailDomain(row.email)}`, record_value: `v=DKIM1; k=rsa; p=${dkim.public_key}` };
}

/** How the transport signs: `d=` the From domain, with the opened private key. */
export function dkimSigningFor(row: MailboxRow, secrets: SecretBox): { domainName: string; keySelector: string; privateKey: string } | null {
  const dkim = dkimOf(row);
  return dkim ? { domainName: emailDomain(row.email), keySelector: dkim.selector, privateKey: secrets.open(Buffer.from(dkim.private_key_enc, 'base64')) } : null;
}

/**
 * Catalyst signs DKIM for a generic host that doesn't (§7.1). Mailboxes on one domain share a key,
 * so the domain needs one DNS record; the selector joins the domain's, so the DNS check covers it.
 */
export async function createMailboxDkimKey(db: Db, principal: Principal, mailboxId: string, input: { selector?: string | undefined }, deps: { secrets: SecretBox }, now: Date): Promise<Mailbox> {
  return db.transaction(async (tx) => {
    const row = await findMailbox(tx, principal.workspace.id, mailboxId);
    const provider = providerOf(row.smtp_host);
    if (provider !== 'other') throw conflict(`${provider === 'google' ? 'Google' : 'Microsoft'} signs this mailbox’s mail with its own DKIM key; publish its selector instead.`);
    if (dkimOf(row)) throw conflict('Catalyst already signs this mailbox’s mail. Delete the key first to make a new one.');
    const [domain] = await tx.select().from(sending_domains).where(eq(sending_domains.id, row.sending_domain_id)).for('update');
    const siblings = await tx.select().from(mailboxes).where(and(eq(mailboxes.sending_domain_id, row.sending_domain_id), sql`${mailboxes.catalyst_dkim} is not null`));
    const shared = siblings.map(dkimOf).find((dkim) => dkim && (!input.selector || dkim.selector === input.selector)) ?? null;
    let dkim = shared;
    if (!dkim) {
      const selector = input.selector ?? 'catalyst';
      if (siblings.some((sibling) => dkimOf(sibling)?.selector === selector)) throw conflict(`Another mailbox on ${domain!.domain} uses the selector ${selector} with its own key.`);
      const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
      dkim = {
        selector,
        private_key_enc: deps.secrets.seal(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()).toString('base64'),
        public_key: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
      };
    }
    const [updated] = await tx.update(mailboxes).set({ catalyst_dkim: dkim, updated_at: now }).where(eq(mailboxes.id, row.id)).returning();
    if (!domain!.dkim_selectors.includes(dkim.selector)) await tx.update(sending_domains).set({ dkim_selectors: [...domain!.dkim_selectors, dkim.selector] }).where(eq(sending_domains.id, domain!.id));
    await audit(tx, principal, 'mailbox.dkim_key_created', { type: 'mailbox', id: row.id }, { selector: dkim.selector, shared: shared !== null }, now);
    return serializeMailbox(updated!);
  });
}

export async function deleteMailboxDkimKey(db: Db, principal: Principal, mailboxId: string, now: Date): Promise<Mailbox> {
  return db.transaction(async (tx) => {
    const row = await findMailbox(tx, principal.workspace.id, mailboxId);
    const dkim = dkimOf(row);
    if (!dkim) throw conflict('Catalyst doesn’t sign this mailbox’s mail.');
    const [updated] = await tx.update(mailboxes).set({ catalyst_dkim: null, updated_at: now }).where(eq(mailboxes.id, row.id)).returning();
    const [still] = await tx.select({ id: mailboxes.id }).from(mailboxes).where(and(eq(mailboxes.sending_domain_id, row.sending_domain_id), sql`${mailboxes.catalyst_dkim}->>'selector' = ${dkim.selector}`)).limit(1);
    if (!still) {
      const [domain] = await tx.select().from(sending_domains).where(eq(sending_domains.id, row.sending_domain_id));
      await tx.update(sending_domains).set({ dkim_selectors: domain!.dkim_selectors.filter((selector) => selector !== dkim.selector) }).where(eq(sending_domains.id, domain!.id));
    }
    await audit(tx, principal, 'mailbox.dkim_key_deleted', { type: 'mailbox', id: row.id }, { selector: dkim.selector, key_deleted: !still }, now);
    return serializeMailbox(updated!);
  });
}

export async function findMailbox(db: Executor, workspaceId: string, mailboxId: string): Promise<MailboxRow> {
  const [row] = await db.select().from(mailboxes).where(and(eq(mailboxes.id, mailboxId), eq(mailboxes.workspace_id, workspaceId)));
  if (!row) throw notFound('The mailbox');
  return row;
}

const SORT = 'email';

export async function listMailboxes(db: Db, workspaceId: string, query: { limit: number; cursor?: string | undefined; domain_id?: string | undefined; status?: MailboxRow['status'] | undefined }) {
  const where: SQL[] = [eq(mailboxes.workspace_id, workspaceId)];
  if (query.domain_id) where.push(eq(mailboxes.sending_domain_id, query.domain_id));
  if (query.status) where.push(eq(mailboxes.status, query.status));
  if (query.cursor) {
    const cursorId = decodeCursor(query.cursor, SORT);
    where.push(sql`(${mailboxes.email}, ${mailboxes.id}) > (select m.email, m.id from mailboxes m where m.id = ${cursorId} and m.workspace_id = ${workspaceId})`);
  }
  const rows = await db.select().from(mailboxes).where(and(...where)).orderBy(asc(mailboxes.email), asc(mailboxes.id)).limit(query.limit + 1);
  const { rows: kept, next_cursor } = page(rows, query.limit, SORT);
  return { data: kept.map(serializeMailbox), next_cursor };
}

export async function getMailbox(db: Db, workspaceId: string, mailboxId: string): Promise<Mailbox> {
  return serializeMailbox(await findMailbox(db, workspaceId, mailboxId));
}

interface LimitInput {
  daily_limit?: number | undefined;
  hourly_limit?: number | undefined;
  min_interval_sec?: number | undefined;
  max_interval_sec?: number | undefined;
  warmup_enabled?: boolean | undefined;
  warmup_start_volume?: number | undefined;
  warmup_daily_increment?: number | undefined;
}

/** The fixed limits of §8.3.4, checked against the values the mailbox would end up with. */
function limitProblems(principal: Principal, next: Required<{ [K in keyof LimitInput]: NonNullable<LimitInput[K]> }>, input: LimitInput, createdAt: Date | null, now: Date): FieldError[] {
  const problems: FieldError[] = [];
  if (input.daily_limit !== undefined && input.daily_limit > DAILY_LIMIT_WITHOUT_ADMIN && !principal.scopes.includes('settings:manage')) {
    problems.push({ path: 'body.daily_limit', message: `A daily limit above ${DAILY_LIMIT_WITHOUT_ADMIN} needs an admin (settings:manage). Adding mailboxes is the safer way to grow volume.` });
  }
  if (next.max_interval_sec < next.min_interval_sec) problems.push({ path: 'body.max_interval_sec', message: 'The longest gap must be at least the shortest gap.' });
  if (input.warmup_enabled === false) {
    const age = createdAt ? (now.getTime() - createdAt.getTime()) / 86_400_000 : 0;
    if (age < WARMUP_LOCK_DAYS) problems.push({ path: 'body.warmup_enabled', message: `Warm-up stays on for a mailbox's first ${WARMUP_LOCK_DAYS} days.` });
  }
  return problems;
}

async function checkOwner(db: Executor, workspaceId: string, ownerId: string | null | undefined): Promise<FieldError[]> {
  if (!ownerId) return [];
  const [owner] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, ownerId), eq(users.workspace_id, workspaceId)));
  return owner ? [] : [{ path: 'body.owner_user_id', message: 'No such user in this workspace.' }];
}

export interface CreateMailboxInput extends LimitInput {
  email: string;
  display_name: string;
  provider: MailProvider;
  password: string;
  smtp_host?: string | undefined;
  smtp_port?: number | undefined;
  smtp_secure?: 'tls' | 'starttls' | undefined;
  smtp_username?: string | undefined;
  imap_host?: string | undefined;
  imap_port?: number | undefined;
  imap_username?: string | undefined;
  signature_text?: string | null | undefined;
  owner_user_id?: string | null | undefined;
}

export async function createMailbox(db: Db, principal: Principal, input: CreateMailboxInput, secrets: SecretBox, now: Date): Promise<Mailbox> {
  const workspaceId = principal.workspace.id;
  const email = normalizeEmail(input.email);
  const domainName = emailDomain(email);
  const [domain] = await db.select({ id: sending_domains.id }).from(sending_domains).where(and(eq(sending_domains.workspace_id, workspaceId), eq(sending_domains.domain, domainName)));
  const errors: FieldError[] = [];
  if (!domain) errors.push({ path: 'body.email', message: `Add the domain ${domainName} with createDomain first.` });

  const preset = input.provider === 'other' ? null : PRESETS[input.provider];
  const smtpHost = input.smtp_host ?? preset?.smtp_host;
  const imapHost = input.imap_host ?? preset?.imap_host;
  if (!smtpHost) errors.push({ path: 'body.smtp_host', message: 'Required for provider other.' });
  if (!imapHost) errors.push({ path: 'body.imap_host', message: 'Required for provider other.' });
  const smtpPort = input.smtp_port ?? preset?.smtp_port ?? 587;
  const limits = {
    daily_limit: input.daily_limit ?? MAILBOX_DEFAULTS.daily_limit,
    hourly_limit: input.hourly_limit ?? MAILBOX_DEFAULTS.hourly_limit,
    min_interval_sec: input.min_interval_sec ?? MAILBOX_DEFAULTS.min_interval_sec,
    max_interval_sec: input.max_interval_sec ?? MAILBOX_DEFAULTS.max_interval_sec,
    warmup_enabled: input.warmup_enabled ?? MAILBOX_DEFAULTS.warmup_enabled,
    warmup_start_volume: input.warmup_start_volume ?? MAILBOX_DEFAULTS.warmup_start_volume,
    warmup_daily_increment: input.warmup_daily_increment ?? MAILBOX_DEFAULTS.warmup_daily_increment,
  };
  errors.push(...limitProblems(principal, limits, input, null, now), ...(await checkOwner(db, workspaceId, input.owner_user_id)));
  if (errors.length > 0) throw validationFailed(errors);

  const sealed = secrets.seal(JSON.stringify({ password: input.password }));
  const smtpUsername = input.smtp_username ?? email;
  try {
    const [row] = await db
      .insert(mailboxes)
      .values({
        id: newId('mailbox'),
        workspace_id: workspaceId,
        sending_domain_id: domain!.id,
        email,
        display_name: input.display_name,
        signature_text: input.signature_text ?? null,
        owner_user_id: input.owner_user_id ?? null,
        auth: 'password',
        smtp_host: smtpHost!,
        smtp_port: smtpPort,
        smtp_secure: input.smtp_secure ?? preset?.smtp_secure ?? (smtpPort === 465 ? 'tls' : 'starttls'),
        smtp_username: smtpUsername,
        imap_host: imapHost!,
        imap_port: input.imap_port ?? 993,
        imap_username: input.imap_username ?? smtpUsername,
        credentials_enc: sealed,
        credentials_key_version: secrets.activeVersion,
        folders: preset?.folders ?? DEFAULT_FOLDERS,
        status: 'pending',
        ...limits,
        warmup_started_at: now.toISOString().slice(0, 10),
        created_at: now,
        updated_at: now,
      })
      .returning();
    await audit(db, principal, 'mailbox.connected', { type: 'mailbox', id: row!.id }, { email, provider: input.provider }, now);
    return serializeMailbox(row!);
  } catch (error) {
    if (pgErrorCode(error) === PG_UNIQUE_VIOLATION) throw conflict(`${email} is already connected.`, [{ path: 'body.email', message: 'Already connected.' }]);
    throw error;
  }
}

export interface UpdateMailboxInput extends LimitInput {
  display_name?: string | undefined;
  signature_text?: string | null | undefined;
  owner_user_id?: string | null | undefined;
  password?: string | undefined;
}

const LIMIT_FIELDS = ['daily_limit', 'hourly_limit', 'min_interval_sec', 'max_interval_sec', 'warmup_enabled', 'warmup_start_volume', 'warmup_daily_increment'] as const;
const PLAIN_FIELDS = ['display_name', 'signature_text', 'owner_user_id'] as const;

export async function updateMailbox(db: Db, principal: Principal, mailboxId: string, input: UpdateMailboxInput, ifMatch: string | null, secrets: SecretBox, now: Date): Promise<Mailbox> {
  const workspaceId = principal.workspace.id;
  return db.transaction(async (tx) => {
    const current = await findMailbox(tx, workspaceId, mailboxId);
    assertFresh(serializeMailbox(current), ifMatch);
    const next = Object.fromEntries(LIMIT_FIELDS.map((field) => [field, input[field] ?? current[field]])) as Required<{ [K in keyof LimitInput]: NonNullable<LimitInput[K]> }>;
    const errors = [...limitProblems(principal, next, input, current.created_at, now), ...(await checkOwner(tx, workspaceId, input.owner_user_id))];
    if (errors.length > 0) throw validationFailed(errors);

    const patch: Partial<typeof mailboxes.$inferInsert> = {};
    for (const field of [...LIMIT_FIELDS, ...PLAIN_FIELDS]) {
      if (input[field] !== undefined && input[field] !== current[field]) Object.assign(patch, { [field]: input[field] });
    }
    const limitChanges = Object.fromEntries(LIMIT_FIELDS.filter((field) => field in patch).map((field) => [field, { from: current[field], to: patch[field] }]));
    if (input.password !== undefined) {
      // New credentials have to pass the connection test again before the mailbox sends.
      Object.assign(patch, { credentials_enc: secrets.seal(JSON.stringify({ password: input.password })), credentials_key_version: secrets.activeVersion, status: 'pending', status_reason: 'Credentials changed; run the connection test.' });
    }
    if (Object.keys(patch).length === 0) return serializeMailbox(current);
    const [row] = await tx.update(mailboxes).set({ ...patch, updated_at: now }).where(eq(mailboxes.id, mailboxId)).returning();
    if (input.password !== undefined) await audit(tx, principal, 'mailbox.credentials_changed', { type: 'mailbox', id: mailboxId }, {}, now);
    if (Object.keys(limitChanges).length > 0) await audit(tx, principal, 'mailbox.limits_changed', { type: 'mailbox', id: mailboxId }, limitChanges, now);
    return serializeMailbox(row!);
  });
}

export async function deleteMailbox(db: Db, principal: Principal, mailboxId: string, now: Date): Promise<void> {
  await db.transaction(async (tx) => {
    const row = await findMailbox(tx, principal.workspace.id, mailboxId);
    const [used] = await tx.execute<{ used: boolean }>(
      sql`select exists (select 1 from ${threads} where ${threads.mailbox_id} = ${mailboxId}) or exists (select 1 from ${messages} where ${messages.mailbox_id} = ${mailboxId}) as used`,
    ).then((result) => result.rows);
    if (used?.used) throw conflict(`${row.email} has conversations, which would lose their sender. Pause it instead.`);
    await tx.delete(campaign_mailboxes).where(eq(campaign_mailboxes.mailbox_id, mailboxId));
    await tx.delete(poll_runs).where(eq(poll_runs.mailbox_id, mailboxId));
    await tx.delete(mailboxes).where(eq(mailboxes.id, mailboxId));
    await audit(tx, principal, 'mailbox.deleted', { type: 'mailbox', id: mailboxId }, { email: row.email }, now);
  });
}

export async function pauseMailbox(db: Db, principal: Principal, mailboxId: string, input: { reason?: string | undefined }, now: Date): Promise<Mailbox> {
  return db.transaction(async (tx) => {
    const current = await findMailbox(tx, principal.workspace.id, mailboxId);
    if (current.status !== 'active') throw conflict(`Only an active mailbox can be paused; this one is ${current.status}.`);
    const reason = `Paused by hand${input.reason ? `: ${input.reason}` : ''}`;
    const [row] = await tx.update(mailboxes).set({ status: 'paused', status_reason: reason, updated_at: now }).where(eq(mailboxes.id, mailboxId)).returning();
    await tx.insert(activities).values({ id: newId('activity'), workspace_id: principal.workspace.id, type: 'mailbox.paused', ...actorOf(principal), data: { mailbox_id: mailboxId, email: current.email, reason }, occurred_at: now });
    return serializeMailbox(row!);
  });
}

export async function resumeMailbox(db: Db, principal: Principal, mailboxId: string, input: { acknowledge_cause?: boolean | undefined }, now: Date): Promise<Mailbox> {
  return db.transaction(async (tx) => {
    const current = await findMailbox(tx, principal.workspace.id, mailboxId);
    if (current.status !== 'paused') throw conflict(`Only a paused mailbox can be resumed; this one is ${current.status}.`);
    const byBreaker = current.status_reason?.startsWith(BREAKER_PREFIX) ?? false;
    if (byBreaker && input.acknowledge_cause !== true) {
      throw invalidField('body.acknowledge_cause', `A circuit breaker paused this mailbox (${current.status_reason!.slice(BREAKER_PREFIX.length).trim()}). Confirm you have dealt with the cause by sending acknowledge_cause: true.`);
    }
    const [row] = await tx.update(mailboxes).set({ status: 'active', status_reason: null, updated_at: now }).where(eq(mailboxes.id, mailboxId)).returning();
    await tx.insert(activities).values({ id: newId('activity'), workspace_id: principal.workspace.id, type: 'mailbox.resumed', ...actorOf(principal), data: { mailbox_id: mailboxId, email: current.email, previous_reason: current.status_reason }, occurred_at: now });
    if (byBreaker) await audit(tx, principal, 'mailbox.breaker_acknowledged', { type: 'mailbox', id: mailboxId }, { cause: current.status_reason }, now);
    return serializeMailbox(row!);
  });
}

const POLL_SORT = '-started_at';

export async function listPollRuns(db: Db, workspaceId: string, mailboxId: string, query: { limit: number; cursor?: string | undefined }) {
  await findMailbox(db, workspaceId, mailboxId);
  const where: SQL[] = [eq(poll_runs.mailbox_id, mailboxId)];
  if (query.cursor) {
    const cursorId = decodeCursor(query.cursor, POLL_SORT);
    where.push(sql`(${poll_runs.started_at}, ${poll_runs.id}) < (select p.started_at, p.id from poll_runs p where p.id = ${cursorId})`);
  }
  const rows = await db.select().from(poll_runs).where(and(...where)).orderBy(desc(poll_runs.started_at), desc(poll_runs.id)).limit(query.limit + 1);
  const { rows: kept, next_cursor } = page(rows, query.limit, POLL_SORT);
  return {
    data: kept.map((run) => ({
      id: run.id,
      trigger: run.trigger as 'schedule' | 'manual' | 'api' | 'catch_up',
      status: run.status as 'running' | 'ok' | 'partial' | 'error',
      started_at: run.started_at.toISOString(),
      finished_at: run.finished_at?.toISOString() ?? null,
      duration_ms: run.duration_ms,
      fetched_count: run.fetched_count ?? 0,
      matched_count: run.matched_count ?? 0,
      ignored_count: run.ignored_count ?? 0,
      error: run.error,
    })),
    next_cursor,
  };
}

const COUNTS = ['sent', 'new_threads', 'replies_sent', 'bounced_hard', 'bounced_soft', 'complaints', 'inbound_replies', 'opens_human', 'unsubscribes'] as const;

export async function getMailboxStats(db: Db, workspaceId: string, mailboxId: string, query: { days: number }, now: Date) {
  const mailbox = await findMailbox(db, workspaceId, mailboxId);
  const since = new Date(now.getTime() - (query.days - 1) * 86_400_000).toISOString().slice(0, 10);
  const rows = await db.select().from(mailbox_daily_stats).where(and(eq(mailbox_daily_stats.mailbox_id, mailboxId), gte(mailbox_daily_stats.day, since))).orderBy(asc(mailbox_daily_stats.day));
  const days = rows.map((row) => ({ day: row.day, ...Object.fromEntries(COUNTS.map((name) => [name, row[name] ?? 0])) }) as { day: string } & Record<(typeof COUNTS)[number], number>);
  const totals = Object.fromEntries(COUNTS.map((name) => [name, days.reduce((sum, day) => sum + day[name], 0)]));
  return { mailbox_id: mailboxId, days, totals, health_inputs: mailbox.health_inputs as Record<string, unknown> };
}

