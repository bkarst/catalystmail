// Inbound integration events (spec §13.7): verify the sender's signature on the exact bytes it
// sent, store the event once per (source, external_id), find the contact's most recently active
// thread whose campaign has a goal for it, and write the achievement (`external_event`).

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { activities, campaign_goals, contacts, integration_events, integrations, newId, thread_goal_achievements, threads, type Db, type Executor } from '@catalyst/db';
import type { JobQueue } from '@catalyst/jobs';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import type { Principal } from '../api/auth.ts';
import { ApiError, conflict, invalidField, notFound } from '../api/errors.ts';
import { decodeCursor, page } from '../api/pagination.ts';
import type { SecretBox } from '../secrets.ts';
import { audit, iso } from '../shared.ts';
import { evaluateThread } from '../threads/evaluate.ts';
import { writeAchievement } from '../threads/service.ts';

export type IntegrationKind = 'stripe' | 'calcom' | 'calendly' | 'generic';
export type Outcome = 'matched' | 'already_achieved' | 'no_contact' | 'no_goal' | 'not_sent' | 'ignored';
type IntegrationRow = typeof integrations.$inferSelect;
type EventRow = typeof integration_events.$inferSelect;

/** Signatures older than this are refused, so a captured request can't be replayed later. */
const TOLERANCE_SECONDS = 300;

// ── Signatures ──────────────────────────────────────────────────────────────────────────────────

const hmacHex = (secret: string, text: string) => createHmac('sha256', secret).update(text).digest('hex');
function sameHex(expected: string, given: string): boolean {
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(given, 'hex');
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}
/** `t=<unix>,v1=<hex>[,v1=…]`, the shape Catalyst, Stripe and Calendly share. */
function timestamped(header: string | null, secret: string, body: string, now: Date): boolean {
  if (!header) return false;
  const parts = header.split(',').map((part) => part.trim().split('='));
  const t = Number(parts.find(([name]) => name === 't')?.[1]);
  if (!Number.isFinite(t) || Math.abs(now.getTime() / 1000 - t) > TOLERANCE_SECONDS) return false;
  const expected = hmacHex(secret, `${t}.${body}`);
  return parts.some(([name, value]) => name === 'v1' && value !== undefined && sameHex(expected, value));
}

export function verifySignature(kind: IntegrationKind, headers: Headers, secret: string, body: string, now: Date): boolean {
  switch (kind) {
    case 'generic':
      return timestamped(headers.get('catalyst-signature'), secret, body, now);
    case 'stripe':
      return timestamped(headers.get('stripe-signature'), secret, body, now);
    case 'calendly':
      return timestamped(headers.get('calendly-webhook-signature'), secret, body, now);
    case 'calcom': {
      // Cal.com signs the body alone, with no timestamp.
      const given = headers.get('x-cal-signature-256');
      return Boolean(given) && sameHex(hmacHex(secret, body), given!);
    }
  }
}

// ── Payloads ────────────────────────────────────────────────────────────────────────────────────

export interface NormalizedEvent {
  source: string;
  type: string;
  externalId: string;
  email: string | null;
  goalKey: string | null;
  valueCents: number | null;
  /** When the goal's event happens: a booking's start, a payment's time. */
  eventAt: Date | null;
  /** A type Catalyst acts on (§13.7). */
  supported: boolean;
}

type Json = Record<string, unknown>;
const object = (value: unknown): Json => (value && typeof value === 'object' ? (value as Json) : {});
const text = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);
const integer = (value: unknown): number | null => (typeof value === 'number' && Number.isInteger(value) ? value : null);
const date = (value: unknown): Date | null => {
  if (typeof value === 'number') return new Date(value * 1000);
  const parsed = typeof value === 'string' ? new Date(value) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
};

/** The provider's event in Catalyst's terms. */
export function normalize(kind: Exclude<IntegrationKind, 'generic'>, payload: unknown): NormalizedEvent | null {
  const event = object(payload);
  if (kind === 'stripe') {
    const type = text(event.type);
    const id = text(event.id);
    if (!type || !id) return null;
    const data = object(object(event.data).object);
    const checkout = type === 'checkout.session.completed';
    return {
      source: 'stripe',
      type,
      externalId: id,
      email: text(object(data.customer_details).email) ?? text(data.customer_email),
      goalKey: null,
      valueCents: checkout ? integer(data.amount_total) : integer(data.amount_paid),
      eventAt: date(event.created),
      supported: checkout || type === 'invoice.paid',
    };
  }
  if (kind === 'calcom') {
    const type = text(event.triggerEvent);
    const booking = object(event.payload);
    const id = text(booking.uid) ?? (integer(booking.bookingId) !== null ? String(booking.bookingId) : null);
    if (!type || !id) return null;
    const attendees = Array.isArray(booking.attendees) ? booking.attendees : [];
    return { source: 'calcom', type, externalId: id, email: text(object(attendees[0]).email), goalKey: null, valueCents: null, eventAt: date(booking.startTime), supported: type === 'BOOKING_CREATED' };
  }
  const type = text(event.event);
  const invitee = object(event.payload);
  const id = text(invitee.uri);
  if (!type || !id) return null;
  return { source: 'calendly', type, externalId: id, email: text(invitee.email), goalKey: null, valueCents: null, eventAt: date(object(invitee.scheduled_event).start_time), supported: type === 'invitee.created' };
}

// ── Matching ────────────────────────────────────────────────────────────────────────────────────

/** Whether a goal's `external_event_match` (one `{source, type}` or a list of them) fits. */
function matchesExternal(match: unknown, event: NormalizedEvent): boolean {
  const rules = Array.isArray(match) ? match : match ? [match] : [];
  return rules.some((rule) => {
    const entry = object(rule);
    return entry.source === event.source && (entry.type === undefined || entry.type === event.type);
  });
}

interface MatchResult {
  outcome: Outcome;
  contactId: string | null;
  threadId: string | null;
}

/** §13.7 steps 1–4, in the caller's transaction. */
async function matchAndAchieve(tx: Executor, workspaceId: string, eventId: string, event: NormalizedEvent, now: Date): Promise<MatchResult> {
  if (!event.supported) return { outcome: 'ignored', contactId: null, threadId: null };
  const [contact] = event.email ? await tx.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.workspace_id, workspaceId), eq(contacts.email, event.email), isNull(contacts.deleted_at))) : [];
  if (!contact) return { outcome: 'no_contact', contactId: null, threadId: null };

  const candidates = await tx
    .select({ thread: threads, goal: campaign_goals })
    .from(threads)
    .innerJoin(campaign_goals, eq(campaign_goals.campaign_id, threads.campaign_id))
    .where(eq(threads.contact_id, contact.id))
    .orderBy(desc(sql`coalesce(${threads.last_message_at}, ${threads.created_at})`), desc(campaign_goals.position));
  const fitting = candidates.filter(({ goal }) => matchesExternal(goal.external_event_match, event) || (event.goalKey !== null && goal.key === event.goalKey));
  const best = fitting[0];
  if (!best) return { outcome: 'no_goal', contactId: contact.id, threadId: null };
  const [thread] = await tx.select().from(threads).where(eq(threads.id, best.thread.id)).for('update');
  if (thread!.mailbox_id === null) return { outcome: 'not_sent', contactId: contact.id, threadId: thread!.id };

  const [held] = await tx
    .select({ method: thread_goal_achievements.method })
    .from(thread_goal_achievements)
    .where(and(eq(thread_goal_achievements.thread_id, thread!.id), eq(thread_goal_achievements.goal_id, best.goal.id), isNull(thread_goal_achievements.revoked_at)));
  if (held && held.method !== 'implied') return { outcome: 'already_achieved', contactId: contact.id, threadId: thread!.id };

  await achieve(tx, thread!, best.goal, eventId, event, now);
  return { outcome: 'matched', contactId: contact.id, threadId: thread!.id };
}

async function achieve(tx: Executor, thread: typeof threads.$inferSelect, goal: typeof campaign_goals.$inferSelect, eventId: string, event: NormalizedEvent, now: Date): Promise<void> {
  await writeAchievement(
    tx,
    thread,
    goal.id,
    { method: 'external_event', confidence: '1.000', evidence: `${event.source} ${event.type} ${event.externalId}`, eventAt: event.eventAt, confirmedBy: null, integrationEventId: eventId },
    now,
  );
  await tx.insert(activities).values({
    id: newId('activity'),
    workspace_id: thread.workspace_id,
    contact_id: thread.contact_id,
    thread_id: thread.id,
    campaign_id: thread.campaign_id,
    type: 'goal.achieved',
    actor_type: 'integration',
    data: { goal_id: goal.id, goal_name: goal.name, method: 'external_event', integration_event_id: eventId, source: event.source, event_type: event.type, value_cents: event.valueCents },
    occurred_at: now,
  });
}

async function evaluateQuietly(db: Db, jobs: JobQueue, threadId: string | null, now: Date): Promise<void> {
  if (!threadId) return;
  try {
    await evaluateThread(db, threadId, { now });
  } catch (error) {
    console.error(`[integrations] evaluating ${threadId} inline failed; queued instead`, error);
    await jobs.enqueue('thread.evaluate', { thread_id: threadId });
  }
}

// ── Receiving ───────────────────────────────────────────────────────────────────────────────────

export interface ReceiveDeps {
  secrets: SecretBox;
  jobs: JobQueue;
  now: Date;
}

async function activeIntegration(db: Db, integrationId: string | null, kind: IntegrationKind): Promise<IntegrationRow> {
  const [row] = integrationId ? await db.select().from(integrations).where(eq(integrations.id, integrationId)) : [];
  // The same answer for a missing, disconnected or other-kind integration.
  if (!row || !row.active || row.kind !== kind) throw notFound('The integration');
  return row;
}

async function receive(db: Db, integration: IntegrationRow, event: NormalizedEvent, payload: unknown, deps: ReceiveDeps) {
  const { now } = deps;
  const id = newId('integration_event');
  const [inserted] = await db
    .insert(integration_events)
    .values({ id, workspace_id: integration.workspace_id, integration_id: integration.id, source: event.source, external_id: event.externalId, type: event.type, contact_email: event.email, goal_key: event.goalKey, value_cents: event.valueCents, payload: payload as object, received_at: now })
    .onConflictDoNothing({ target: [integration_events.workspace_id, integration_events.source, integration_events.external_id] })
    .returning({ id: integration_events.id });
  if (!inserted) {
    // Providers retry: a second delivery of the same event changes nothing.
    const [existing] = await db.select().from(integration_events).where(and(eq(integration_events.workspace_id, integration.workspace_id), eq(integration_events.source, event.source), eq(integration_events.external_id, event.externalId)));
    return { id: existing!.id, outcome: existing!.outcome as Outcome | null, duplicate: true };
  }
  const result = await db.transaction(async (tx) => {
    const match = await matchAndAchieve(tx, integration.workspace_id, id, event, now);
    await tx.update(integration_events).set({ outcome: match.outcome, matched_contact_id: match.contactId, matched_thread_id: match.threadId, processed_at: now }).where(eq(integration_events.id, id));
    return match;
  });
  if (result.outcome === 'matched') await evaluateQuietly(db, deps.jobs, result.threadId, now);
  return { id, outcome: result.outcome, duplicate: false };
}

const unauthorized = () => new ApiError(401, 'unauthorized', 'The signature is missing, does not match, or is older than 5 minutes.');

export async function receiveProviderWebhook(db: Db, kind: Exclude<IntegrationKind, 'generic'>, integrationId: string, headers: Headers, body: string, deps: ReceiveDeps) {
  const integration = await activeIntegration(db, integrationId, kind);
  if (!verifySignature(kind, headers, deps.secrets.open(integration.signing_secret_enc), body, deps.now)) throw unauthorized();
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw invalidField('body', 'The body is not JSON.');
  }
  const event = normalize(kind, payload);
  if (!event) throw invalidField('body', `This doesn't look like a ${kind} event.`);
  return receive(db, integration, event, payload, deps);
}

export async function ingestIntegrationEvent(
  db: Db,
  headers: Headers,
  body: string,
  input: { source: string; type: string; external_id: string; contact_email: string; goal_key?: string | undefined; value_cents?: number | undefined; occurred_at: string },
  deps: ReceiveDeps,
) {
  const integration = await activeIntegration(db, headers.get('catalyst-integration'), 'generic');
  if (!verifySignature('generic', headers, deps.secrets.open(integration.signing_secret_enc), body, deps.now)) throw unauthorized();
  const event: NormalizedEvent = { source: input.source, type: input.type, externalId: input.external_id, email: input.contact_email, goalKey: input.goal_key ?? null, valueCents: input.value_cents ?? null, eventAt: new Date(input.occurred_at), supported: true };
  return receive(db, integration, event, input, deps);
}

// ── Managing ────────────────────────────────────────────────────────────────────────────────────

const webhookPath = (row: IntegrationRow) => (row.kind === 'generic' ? '/api/v1/integrations/events' : `/api/v1/integrations/${row.kind}/webhook?integration_id=${row.id}`);
const serializeIntegration = (row: IntegrationRow) => ({ id: row.id, kind: row.kind as IntegrationKind, active: row.active, webhook_path: webhookPath(row) });

export async function listIntegrations(db: Db, workspaceId: string) {
  const rows = await db.select().from(integrations).where(eq(integrations.workspace_id, workspaceId)).orderBy(integrations.id);
  return { data: rows.map(serializeIntegration) };
}

export async function createIntegration(db: Db, principal: Principal, input: { kind: IntegrationKind; signing_secret?: string | undefined }, secrets: SecretBox, now: Date) {
  if (input.kind !== 'generic' && !input.signing_secret) throw invalidField('body.signing_secret', `Give the signing secret ${input.kind} shows for the webhook.`);
  if (input.kind === 'generic' && input.signing_secret) throw invalidField('body.signing_secret', 'Catalyst makes the secret for a generic integration.');
  const secret = input.signing_secret ?? `ingsec_${randomBytes(24).toString('base64url')}`;
  const id = newId('integration');
  const row = await db.transaction(async (tx) => {
    const [created] = await tx.insert(integrations).values({ id, workspace_id: principal.workspace.id, kind: input.kind, signing_secret_enc: secrets.seal(secret) }).returning();
    await audit(tx, principal, 'integration.created', { type: 'integration', id }, { kind: input.kind }, now);
    return created!;
  });
  return { ...serializeIntegration(row), secret: input.kind === 'generic' ? secret : null };
}

export async function deleteIntegration(db: Db, principal: Principal, integrationId: string, now: Date): Promise<void> {
  const [row] = await db.select().from(integrations).where(and(eq(integrations.id, integrationId), eq(integrations.workspace_id, principal.workspace.id)));
  if (!row) throw notFound('The integration');
  await db.transaction(async (tx) => {
    // Kept, turned off: its events still point at it.
    await tx.update(integrations).set({ active: false }).where(eq(integrations.id, integrationId));
    await audit(tx, principal, 'integration.deleted', { type: 'integration', id: integrationId }, { kind: row.kind }, now);
  });
}

const serializeEvent = (row: EventRow) => ({
  id: row.id,
  integration_id: row.integration_id,
  source: row.source,
  type: row.type,
  external_id: row.external_id,
  contact_email: row.contact_email,
  goal_key: row.goal_key,
  value_cents: row.value_cents,
  outcome: row.outcome as Outcome | null,
  matched_contact_id: row.matched_contact_id,
  matched_thread_id: row.matched_thread_id,
  received_at: row.received_at.toISOString(),
  processed_at: iso(row.processed_at),
});

export async function listIntegrationEvents(db: Db, workspaceId: string, query: { limit: number; cursor?: string | undefined; outcome?: Outcome | undefined }) {
  const where = [eq(integration_events.workspace_id, workspaceId)];
  if (query.outcome) where.push(eq(integration_events.outcome, query.outcome));
  if (query.cursor) where.push(sql`(${integration_events.received_at}, ${integration_events.id}) < (select received_at, id from integration_events where id = ${decodeCursor(query.cursor, '-received_at')})`);
  const rows = await db.select().from(integration_events).where(and(...where)).orderBy(desc(integration_events.received_at), desc(integration_events.id)).limit(query.limit + 1);
  const { rows: kept, next_cursor } = page(rows, query.limit, '-received_at');
  return { data: kept.map(serializeEvent), next_cursor };
}

/** "Attached by hand" (§13.7): an unmatched event achieves a chosen goal on a chosen thread. */
export async function attachIntegrationEvent(db: Db, principal: Principal, eventId: string, input: { thread_id: string; goal_id: string }, deps: { jobs: JobQueue; now: Date }) {
  const { now } = deps;
  const row = await db.transaction(async (tx) => {
    const [event] = await tx.select().from(integration_events).where(and(eq(integration_events.id, eventId), eq(integration_events.workspace_id, principal.workspace.id))).for('update');
    if (!event) throw notFound('The integration event');
    if (event.outcome === 'matched') throw conflict('This event already achieved a goal.');
    const [thread] = await tx.select().from(threads).where(and(eq(threads.id, input.thread_id), eq(threads.workspace_id, principal.workspace.id))).for('update');
    if (!thread) throw invalidField('body.thread_id', 'No such thread in this workspace.');
    const [goal] = await tx.select().from(campaign_goals).where(and(eq(campaign_goals.id, input.goal_id), eq(campaign_goals.campaign_id, thread.campaign_id)));
    if (!goal) throw invalidField('body.goal_id', 'That goal is not in the thread’s campaign.');
    if (thread.mailbox_id === null) throw conflict('Nothing was sent on this thread yet, so it can’t reach a goal.');
    const normalized: NormalizedEvent = { source: event.source, type: event.type, externalId: event.external_id, email: event.contact_email, goalKey: event.goal_key, valueCents: event.value_cents, eventAt: null, supported: true };
    await achieve(tx, thread, goal, event.id, normalized, now);
    const [updated] = await tx.update(integration_events).set({ outcome: 'matched', matched_contact_id: thread.contact_id, matched_thread_id: thread.id, processed_at: now }).where(eq(integration_events.id, event.id)).returning();
    return updated!;
  });
  await evaluateQuietly(db, deps.jobs, input.thread_id, now);
  return serializeEvent(row);
}

