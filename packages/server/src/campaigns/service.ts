// Campaigns (spec §5.1, §6.6): creation with the default follow-up sequences, settings, mailboxes,
// and the draft → active ⇄ paused → archived lifecycle.

import { defaultSequences } from '@catalyst/core';
import type { Campaign } from '@catalyst/contract';
import {
  activities,
  campaign_goals,
  campaign_mailboxes,
  campaign_steps,
  campaign_step_variants,
  campaigns,
  follow_up_sequences,
  mailboxes,
  messages,
  newId,
  threads,
  users,
  workspaces,
  type Db,
  type Executor,
} from '@catalyst/db';
import type { JobQueue } from '@catalyst/jobs';
import { and, asc, count, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';

import type { Principal } from '../api/auth.ts';
import { ApiError, conflict, invalidField, notFound, validationFailed, type FieldError } from '../api/errors.ts';
import { assertFresh } from '../api/etag.ts';
import { decodeCursor, page } from '../api/pagination.ts';
import { actorOf, audit } from '../shared.ts';
import { evaluateThreads } from '../threads/evaluation.ts';
import { DEFAULT_STEP_TEXT } from './defaults.ts';
import type { GoalInput } from './goals.ts';

export type CampaignRow = typeof campaigns.$inferSelect;

const DEFAULT_WINDOW = { days: [1, 2, 3, 4, 5], start: '08:30', end: '17:30' };
const DEFAULT_ENROLLMENT = { skip_active_elsewhere: true, cooldown_days: 30, allow_role_accounts: false, allow_risky: false };

export async function serializeCampaign(db: Executor, row: CampaignRow): Promise<Campaign> {
  const assigned = await db.select({ mailbox_id: campaign_mailboxes.mailbox_id, weight: campaign_mailboxes.weight }).from(campaign_mailboxes).where(eq(campaign_mailboxes.campaign_id, row.id)).orderBy(asc(campaign_mailboxes.mailbox_id));
  const [goals] = await db.select({ count: count() }).from(campaign_goals).where(eq(campaign_goals.campaign_id, row.id));
  const [threadCount] = await db.select({ count: count() }).from(threads).where(eq(threads.campaign_id, row.id));
  const window = row.sending_window as Partial<Campaign['sending_window']>;
  const iso = (date: Date | null) => date?.toISOString() ?? null;
  return {
    id: row.id,
    status: row.status,
    name: row.name,
    description: row.description,
    objective: row.objective,
    owner_user_id: row.owner_user_id,
    autonomy: row.autonomy,
    persona: row.persona as Campaign['persona'],
    agent_instructions: row.agent_instructions,
    // Picked field by field: the stored window also carries `tz`, which the API doesn't expose.
    sending_window: { days: window.days ?? DEFAULT_WINDOW.days, start: window.start ?? DEFAULT_WINDOW.start, end: window.end ?? DEFAULT_WINDOW.end, fallback_tz: window.fallback_tz ?? 'UTC' },
    blackout_dates: row.blackout_dates,
    daily_new_threads_limit: row.daily_new_threads_limit,
    sending_priority: row.sending_priority as Campaign['sending_priority'],
    final_wait_business_days: row.final_wait_business_days,
    open_tracking: row.open_tracking,
    track_first_touch: row.track_first_touch,
    click_tracking: row.click_tracking,
    list_unsubscribe_header: row.list_unsubscribe_header,
    unsubscribe_footer: row.unsubscribe_footer,
    delivery_grace_minutes: row.delivery_grace_minutes,
    reply_delay_min_minutes: row.reply_delay_min_minutes,
    reply_delay_max_minutes: row.reply_delay_max_minutes,
    auto_send_min_confidence: Number(row.auto_send_min_confidence),
    goal_auto_confirm_threshold: Number(row.goal_auto_confirm_threshold),
    max_ai_replies_per_thread: row.max_ai_replies_per_thread,
    pause_on_manual_reply: row.pause_on_manual_reply,
    on_not_interested: row.on_not_interested as Campaign['on_not_interested'],
    review_first_n_personalized: row.review_first_n_personalized,
    enrollment_rules: { ...DEFAULT_ENROLLMENT, ...(row.enrollment_rules as object) },
    links: row.links as Record<string, string>,
    agent_mode: row.agent_mode,
    mailboxes: assigned,
    goal_count: goals?.count ?? 0,
    thread_count: threadCount?.count ?? 0,
    launched_at: iso(row.launched_at),
    completed_at: iso(row.completed_at),
    archived_at: iso(row.archived_at),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

export async function findCampaign(db: Executor, workspaceId: string, campaignId: string, options: { lock?: boolean } = {}): Promise<CampaignRow> {
  const query = db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.workspace_id, workspaceId), isNull(campaigns.deleted_at)));
  const [row] = options.lock ? await query.for('update') : await query;
  if (!row) throw notFound('The campaign');
  return row;
}

/** Archived campaigns are read-only (§5.1). */
export function assertEditable(row: CampaignRow): void {
  if (row.status === 'archived') throw conflict('This campaign is archived, so it is read-only.');
}

const SORT = '-created_at';

export async function listCampaigns(db: Db, workspaceId: string, query: { limit: number; cursor?: string | undefined; status?: CampaignRow['status'] | undefined }) {
  const where: SQL[] = [eq(campaigns.workspace_id, workspaceId), isNull(campaigns.deleted_at)];
  if (query.status) where.push(eq(campaigns.status, query.status));
  if (query.cursor) {
    const cursorId = decodeCursor(query.cursor, SORT);
    where.push(sql`(${campaigns.created_at}, ${campaigns.id}) < (select c.created_at, c.id from campaigns c where c.id = ${cursorId} and c.workspace_id = ${workspaceId})`);
  }
  const rows = await db.select().from(campaigns).where(and(...where)).orderBy(desc(campaigns.created_at), desc(campaigns.id)).limit(query.limit + 1);
  const { rows: kept, next_cursor } = page(rows, query.limit, SORT);
  const data: Campaign[] = [];
  for (const row of kept) data.push(await serializeCampaign(db, row));
  return { data, next_cursor };
}

export async function getCampaign(db: Db, workspaceId: string, campaignId: string): Promise<Campaign> {
  return serializeCampaign(db, await findCampaign(db, workspaceId, campaignId));
}

export interface CreateCampaignInput {
  name: string;
  objective: string;
  description?: string | undefined;
  persona?: Record<string, unknown> | undefined;
  goals?: GoalInput[] | undefined;
  initial_email?: { subject_template: string; body_template: string } | undefined;
  links?: Record<string, string> | undefined;
  agent_mode?: 'built_in' | 'external' | undefined;
}

export async function createCampaign(db: Db, principal: Principal, input: CreateCampaignInput, now: Date): Promise<Campaign> {
  const workspaceId = principal.workspace.id;
  const goalKeys = (input.goals ?? []).map((goal) => goal.key);
  const duplicate = goalKeys.find((key, index) => goalKeys.indexOf(key) !== index);
  if (duplicate) throw invalidField('body.goals', `Two goals share the key "${duplicate}".`);

  return db.transaction(async (tx) => {
    const [workspace] = await tx.select({ zone: workspaces.default_timezone }).from(workspaces).where(eq(workspaces.id, workspaceId));
    const id = newId('campaign');
    const [row] = await tx
      .insert(campaigns)
      .values({
        id,
        workspace_id: workspaceId,
        name: input.name,
        objective: input.objective,
        description: input.description ?? null,
        owner_user_id: principal.kind === 'user' ? principal.id : null,
        persona: input.persona ?? {},
        sending_window: { ...DEFAULT_WINDOW, tz: 'contact', fallback_tz: workspace?.zone ?? 'UTC' },
        links: input.links ?? {},
        agent_mode: input.agent_mode ?? 'built_in',
        created_at: now,
        updated_at: now,
      })
      .returning();

    const goals = (input.goals ?? []).map((goal, index) => ({ ...goal, id: newId('goal'), position: index + 1 }));
    if (goals.length > 0) {
      await tx.insert(campaign_goals).values(
        goals.map((goal) => ({
          id: goal.id,
          campaign_id: id,
          position: goal.position,
          key: goal.key,
          name: goal.name,
          success_criteria: goal.success_criteria,
          playbook: goal.playbook,
          ...(goal.detection_methods && { detection_methods: goal.detection_methods }),
          external_event_match: goal.external_event_match ?? null,
          tracked_link_key: goal.tracked_link_key ?? null,
          click_counts_as_achieved: goal.click_counts_as_achieved ?? false,
          auto_confirm: goal.auto_confirm ?? true,
          lifecycle_stage_on_achieve: goal.lifecycle_stage_on_achieve ?? null,
          marks_customer: goal.marks_customer ?? false,
          value_cents: goal.value_cents ?? null,
        })),
      );
    }

    // The initial email, and the default sequences for each stage (§5.10).
    const initialStepId = newId('step');
    await tx.insert(campaign_steps).values({ id: initialStepId, campaign_id: id, position: 1, send_as_reply: false });
    if (input.initial_email) {
      await tx.insert(campaign_step_variants).values({ id: newId('variant'), step_id: initialStepId, label: 'A', subject_template: input.initial_email.subject_template, body_template: input.initial_email.body_template });
    }
    for (const sequence of defaultSequences(goals, () => newId('sequence'))) {
      await tx.insert(follow_up_sequences).values({
        id: sequence.id,
        campaign_id: id,
        name: sequence.name,
        stages: [...sequence.stages],
        finish: sequence.finish,
        final_wait_amount: sequence.finalWait.amount,
        final_wait_unit: sequence.finalWait.unit,
        created_at: now,
        updated_at: now,
      });
      const kind = sequence.stages.includes('sent') ? 'no_reply' : sequence.stages.includes('responded') ? 'responded' : 'goal';
      for (const step of sequence.steps) {
        const stepId = newId('step');
        const text = DEFAULT_STEP_TEXT[kind][step.position - 1]!;
        await tx.insert(campaign_steps).values({
          id: stepId,
          campaign_id: id,
          sequence_id: sequence.id,
          position: step.position,
          wait_amount: step.wait.amount,
          wait_unit: step.wait.unit,
          wait_from: step.waitFrom,
          mode: step.mode,
          ai_guidance: step.mode === 'template' ? null : text,
        });
        await tx.insert(campaign_step_variants).values({ id: newId('variant'), step_id: stepId, label: 'A', body_template: text });
      }
    }
    await tx.insert(activities).values({ id: newId('activity'), workspace_id: workspaceId, campaign_id: id, type: 'campaign.created', ...actorOf(principal), data: { name: input.name }, occurred_at: now });
    return serializeCampaign(tx, row!);
  });
}

const SETTINGS = [
  'name', 'description', 'objective', 'owner_user_id', 'autonomy', 'persona', 'agent_instructions', 'sending_window', 'blackout_dates', 'daily_new_threads_limit',
  'sending_priority', 'final_wait_business_days', 'open_tracking', 'track_first_touch', 'click_tracking', 'list_unsubscribe_header', 'unsubscribe_footer',
  'delivery_grace_minutes', 'reply_delay_min_minutes', 'reply_delay_max_minutes', 'auto_send_min_confidence', 'goal_auto_confirm_threshold',
  'max_ai_replies_per_thread', 'pause_on_manual_reply', 'on_not_interested', 'review_first_n_personalized', 'enrollment_rules', 'links', 'agent_mode',
] as const;
type Settings = Partial<Record<(typeof SETTINGS)[number], unknown>>;

const isTimeZone = (zone: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
};

export async function updateCampaign(db: Db, principal: Principal, campaignId: string, input: Settings, ifMatch: string | null, now: Date): Promise<Campaign> {
  const workspaceId = principal.workspace.id;
  return db.transaction(async (tx) => {
    const current = await findCampaign(tx, workspaceId, campaignId, { lock: true });
    assertFresh({ id: current.id, updated_at: current.updated_at.toISOString() }, ifMatch);
    assertEditable(current);

    const errors: FieldError[] = [];
    const window = input.sending_window as { start: string; end: string; fallback_tz: string } | undefined;
    if (window && window.start >= window.end) errors.push({ path: 'body.sending_window.end', message: 'The window must close after it opens.' });
    if (window && !isTimeZone(window.fallback_tz)) errors.push({ path: 'body.sending_window.fallback_tz', message: 'Not an IANA timezone.' });
    const min = (input.reply_delay_min_minutes as number | undefined) ?? current.reply_delay_min_minutes;
    const max = (input.reply_delay_max_minutes as number | undefined) ?? current.reply_delay_max_minutes;
    if (max < min) errors.push({ path: 'body.reply_delay_max_minutes', message: 'The longest reply delay must be at least the shortest.' });
    if (input.owner_user_id) {
      const [owner] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, input.owner_user_id as string), eq(users.workspace_id, workspaceId)));
      if (!owner) errors.push({ path: 'body.owner_user_id', message: 'No such user in this workspace.' });
    }
    if (errors.length > 0) throw validationFailed(errors);

    const patch: Record<string, unknown> = {};
    for (const field of SETTINGS) {
      if (input[field] === undefined) continue;
      let value = input[field];
      if (field === 'sending_window') value = { ...(value as object), tz: 'contact' };
      if (field === 'enrollment_rules') value = { ...DEFAULT_ENROLLMENT, ...(current.enrollment_rules as object), ...(value as object) };
      if (field === 'persona') value = { ...(current.persona as object), ...(value as object) };
      if (field === 'auto_send_min_confidence' || field === 'goal_auto_confirm_threshold') value = (value as number).toFixed(3);
      if (JSON.stringify(value) !== JSON.stringify(current[field])) patch[field] = value;
    }
    if (Object.keys(patch).length === 0) return serializeCampaign(tx, current);
    const [row] = await tx.update(campaigns).set({ ...patch, updated_at: now }).where(eq(campaigns.id, campaignId)).returning();
    if ('sending_priority' in patch) {
      await tx.insert(activities).values({ id: newId('activity'), workspace_id: workspaceId, campaign_id: campaignId, type: 'campaign.priority_changed', ...actorOf(principal), data: { from: current.sending_priority, to: patch.sending_priority }, occurred_at: now });
    }
    return serializeCampaign(tx, row!);
  });
}

/** Deletes a campaign that never sent anything, with its queued threads. */
export async function deleteCampaign(db: Db, principal: Principal, campaignId: string, now: Date): Promise<void> {
  await db.transaction(async (tx) => {
    const row = await findCampaign(tx, principal.workspace.id, campaignId, { lock: true });
    if (row.status !== 'draft') throw conflict(`A ${row.status} campaign can't be deleted; archive it instead.`);
    const [sent] = await tx.select({ count: count() }).from(messages).innerJoin(threads, eq(threads.id, messages.thread_id)).where(eq(threads.campaign_id, campaignId));
    if ((sent?.count ?? 0) > 0) throw conflict('This campaign has messages; archive it instead.');
    await tx.delete(activities).where(and(eq(activities.campaign_id, campaignId), sql`${activities.thread_id} is not null`));
    await tx.update(activities).set({ campaign_id: null }).where(eq(activities.campaign_id, campaignId));
    await tx.delete(threads).where(eq(threads.campaign_id, campaignId));
    await tx.update(campaigns).set({ deleted_at: now, updated_at: now }).where(eq(campaigns.id, campaignId));
    await audit(tx, principal, 'campaign.deleted', { type: 'campaign', id: campaignId }, { name: row.name }, now);
  });
}

export async function setCampaignMailboxes(db: Db, principal: Principal, campaignId: string, input: { mailboxes: { mailbox_id: string; weight?: number | undefined }[] }, now: Date): Promise<Campaign> {
  const workspaceId = principal.workspace.id;
  return db.transaction(async (tx) => {
    const row = await findCampaign(tx, workspaceId, campaignId, { lock: true });
    assertEditable(row);
    const ids = input.mailboxes.map((entry) => entry.mailbox_id);
    const repeated = ids.find((id, index) => ids.indexOf(id) !== index);
    if (repeated) throw invalidField('body.mailboxes', `${repeated} is listed twice.`);
    if (ids.length > 0) {
      const found = await tx.select({ id: mailboxes.id }).from(mailboxes).where(and(inArray(mailboxes.id, ids), eq(mailboxes.workspace_id, workspaceId)));
      const known = new Set(found.map((mailbox) => mailbox.id));
      const errors = ids.flatMap((id, index) => (known.has(id) ? [] : [{ path: `body.mailboxes.${index}.mailbox_id`, message: 'No such mailbox in this workspace.' }]));
      if (errors.length > 0) throw validationFailed(errors);
    }
    await tx.delete(campaign_mailboxes).where(eq(campaign_mailboxes.campaign_id, campaignId));
    if (ids.length > 0) await tx.insert(campaign_mailboxes).values(input.mailboxes.map((entry) => ({ campaign_id: campaignId, mailbox_id: entry.mailbox_id, weight: entry.weight ?? 1 })));
    const [updated] = await tx.update(campaigns).set({ updated_at: now }).where(eq(campaigns.id, campaignId)).returning();
    return serializeCampaign(tx, updated!);
  });
}

// ── Lifecycle ──────────────────────────────────────────────────────────────────────────────────

async function threadIds(db: Executor, campaignId: string): Promise<string[]> {
  return (await db.select({ id: threads.id }).from(threads).where(eq(threads.campaign_id, campaignId))).map((thread) => thread.id);
}

async function transition(
  db: Db,
  principal: Principal,
  campaignId: string,
  now: Date,
  jobs: JobQueue,
  rule: { from: readonly CampaignRow['status'][]; to: CampaignRow['status']; activity: string; patch?: Partial<typeof campaigns.$inferInsert>; before?: (tx: Executor, row: CampaignRow) => Promise<void> },
): Promise<Campaign> {
  return db.transaction(async (tx) => {
    const row = await findCampaign(tx, principal.workspace.id, campaignId, { lock: true });
    if (!rule.from.includes(row.status)) throw conflict(`A ${row.status} campaign can't become ${rule.to}.`);
    await rule.before?.(tx, row);
    const [updated] = await tx.update(campaigns).set({ status: rule.to, ...rule.patch, updated_at: now }).where(eq(campaigns.id, campaignId)).returning();
    await tx.insert(activities).values({ id: newId('activity'), workspace_id: principal.workspace.id, campaign_id: campaignId, type: rule.activity, ...actorOf(principal), data: { from: row.status, to: rule.to }, occurred_at: now });
    await evaluateThreads(tx, jobs, await threadIds(tx, campaignId));
    return serializeCampaign(tx, updated!);
  });
}

export function launchCampaign(db: Db, principal: Principal, campaignId: string, now: Date, deps: { jobs: JobQueue; preflight: (tx: Executor, row: CampaignRow) => Promise<{ passed: boolean; items: { id: string; status: string; title: string; detail: string | null }[] }> }) {
  return transition(db, principal, campaignId, now, deps.jobs, {
    from: ['draft'],
    to: 'active',
    activity: 'campaign.launched',
    patch: { launched_at: now },
    before: async (tx, row) => {
      const result = await deps.preflight(tx, row);
      if (!result.passed) {
        const failing = result.items.filter((item) => item.status === 'fail');
        throw new ApiError(422, 'preflight_failed', `Preflight failed on ${failing.length} check(s); run runCampaignPreflight for the details.`, failing.map((item) => ({ path: item.id, message: `${item.title}: ${item.detail ?? 'failed'}` })));
      }
    },
  });
}

export function pauseCampaign(db: Db, principal: Principal, campaignId: string, now: Date, jobs: JobQueue) {
  return transition(db, principal, campaignId, now, jobs, { from: ['active'], to: 'paused', activity: 'campaign.paused' });
}

export function resumeCampaign(db: Db, principal: Principal, campaignId: string, now: Date, jobs: JobQueue) {
  return transition(db, principal, campaignId, now, jobs, {
    from: ['paused'],
    to: 'active',
    activity: 'campaign.resumed',
    // Follow-ups that fell due while paused are rescheduled from now, never sent in a burst (§5.10 rule 6).
    before: async (tx) => {
      await tx.update(threads).set({ follow_ups_not_before: now, updated_at: now }).where(eq(threads.campaign_id, campaignId));
    },
  });
}

export function archiveCampaign(db: Db, principal: Principal, campaignId: string, now: Date, jobs: JobQueue) {
  return transition(db, principal, campaignId, now, jobs, { from: ['draft', 'active', 'paused', 'completed'], to: 'archived', activity: 'campaign.archived', patch: { archived_at: now } });
}
