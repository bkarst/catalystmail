// Campaign goals (spec §5.2): ordered milestones. The highest is the final goal; follow-up sequences
// may cover every goal stage but that one.

import { validateSequences } from '@catalyst/core';
import type { Goal } from '@catalyst/contract';
import { campaign_goals, escalations, follow_up_sequences, newId, thread_goal_achievements, type Db, type Executor } from '@catalyst/db';
import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';

import type { Principal } from '../api/auth.ts';
import { conflict, invalidField, notFound, PG_UNIQUE_VIOLATION, pgErrorCode } from '../api/errors.ts';
import { loadSequences } from './emails.ts';
import { assertEditable, findCampaign } from './service.ts';

type GoalRow = typeof campaign_goals.$inferSelect;
type Method = 'ai' | 'external_event' | 'link_click' | 'manual';
type Stage = 'lead' | 'prospect' | 'engaged' | 'opportunity' | 'customer' | 'churned' | 'disqualified';

export interface GoalInput {
  key: string;
  name: string;
  success_criteria: string;
  playbook: string;
  detection_methods?: Method[] | undefined;
  external_event_match?: Record<string, string> | null | undefined;
  tracked_link_key?: string | null | undefined;
  click_counts_as_achieved?: boolean | undefined;
  auto_confirm?: boolean | undefined;
  lifecycle_stage_on_achieve?: Stage | null | undefined;
  marks_customer?: boolean | undefined;
  value_cents?: number | null | undefined;
}

export function serializeGoal(row: GoalRow): Goal {
  return {
    id: row.id,
    position: row.position,
    key: row.key,
    name: row.name,
    success_criteria: row.success_criteria,
    detection_methods: row.detection_methods.filter((method): method is Method => method !== 'implied'),
    external_event_match: (row.external_event_match as Record<string, string> | null) ?? null,
    tracked_link_key: row.tracked_link_key,
    click_counts_as_achieved: row.click_counts_as_achieved,
    auto_confirm: row.auto_confirm,
    playbook: row.playbook,
    lifecycle_stage_on_achieve: row.lifecycle_stage_on_achieve,
    marks_customer: row.marks_customer,
    value_cents: row.value_cents,
  };
}

export async function loadGoals(db: Executor, campaignId: string): Promise<GoalRow[]> {
  return db.select().from(campaign_goals).where(eq(campaign_goals.campaign_id, campaignId)).orderBy(asc(campaign_goals.position));
}

const goalRefs = (rows: GoalRow[]) => rows.map((row) => ({ id: row.id, key: row.key, name: row.name, position: row.position }));

/** Refuses a goal change that would leave a sequence covering the final goal or an unknown goal. */
async function assertSequencesStillValid(db: Executor, campaignId: string, goals: GoalRow[]): Promise<void> {
  const sequences = await loadSequences(db, campaignId);
  const problems = validateSequences(sequences, goalRefs(goals)).filter((issue) => issue.code === 'validation_failed' && /final goal|Unknown goal/.test(issue.message));
  if (problems.length > 0) throw conflict(`That would break a follow-up sequence: ${problems[0]!.message}`);
}

async function findGoal(db: Executor, campaignId: string, goalId: string): Promise<GoalRow> {
  const [row] = await db.select().from(campaign_goals).where(and(eq(campaign_goals.id, goalId), eq(campaign_goals.campaign_id, campaignId)));
  if (!row) throw notFound('The goal');
  return row;
}

/** Writes positions 1..n in the given order. Positions are unique, so they pass through 1000+ first. */
async function writePositions(db: Executor, ordered: GoalRow[]): Promise<GoalRow[]> {
  for (const [index, goal] of ordered.entries()) await db.update(campaign_goals).set({ position: 1000 + index }).where(eq(campaign_goals.id, goal.id));
  for (const [index, goal] of ordered.entries()) await db.update(campaign_goals).set({ position: index + 1 }).where(eq(campaign_goals.id, goal.id));
  return ordered.map((goal, index) => ({ ...goal, position: index + 1 }));
}

export async function listGoals(db: Db, workspaceId: string, campaignId: string) {
  await findCampaign(db, workspaceId, campaignId);
  return { data: (await loadGoals(db, campaignId)).map(serializeGoal) };
}

const keyTaken = (key: string) => conflict(`A goal with the key "${key}" already exists in this campaign.`, [{ path: 'body.key', message: 'Already used.' }]);

export async function createGoal(db: Db, principal: Principal, campaignId: string, input: GoalInput): Promise<Goal> {
  try {
    return await db.transaction(async (tx) => {
      const campaign = await findCampaign(tx, principal.workspace.id, campaignId, { lock: true });
      assertEditable(campaign);
      const goals = await loadGoals(tx, campaignId);
      const [row] = await tx
        .insert(campaign_goals)
        .values({
          id: newId('goal'),
          campaign_id: campaignId,
          position: goals.length + 1,
          key: input.key,
          name: input.name,
          success_criteria: input.success_criteria,
          playbook: input.playbook,
          ...(input.detection_methods && { detection_methods: input.detection_methods }),
          external_event_match: input.external_event_match ?? null,
          tracked_link_key: input.tracked_link_key ?? null,
          click_counts_as_achieved: input.click_counts_as_achieved ?? false,
          auto_confirm: input.auto_confirm ?? true,
          lifecycle_stage_on_achieve: input.lifecycle_stage_on_achieve ?? null,
          marks_customer: input.marks_customer ?? false,
          value_cents: input.value_cents ?? null,
        })
        .returning();
      return serializeGoal(row!);
    });
  } catch (error) {
    if (pgErrorCode(error) === PG_UNIQUE_VIOLATION) throw keyTaken(input.key);
    throw error;
  }
}

export async function updateGoal(db: Db, principal: Principal, campaignId: string, goalId: string, input: Partial<GoalInput>): Promise<Goal> {
  try {
    return await db.transaction(async (tx) => {
      const campaign = await findCampaign(tx, principal.workspace.id, campaignId, { lock: true });
      assertEditable(campaign);
      const current = await findGoal(tx, campaignId, goalId);
      const patch: Partial<typeof campaign_goals.$inferInsert> = {};
      for (const [field, value] of Object.entries(input)) if (value !== undefined) Object.assign(patch, { [field]: value });
      if (Object.keys(patch).length === 0) return serializeGoal(current);
      const [row] = await tx.update(campaign_goals).set(patch).where(eq(campaign_goals.id, goalId)).returning();
      if (input.key && input.key !== current.key) {
        // Sequences refer to goal stages by key.
        await tx
          .update(follow_up_sequences)
          .set({ stages: sql`array_replace(${follow_up_sequences.stages}, ${`goal:${current.key}`}, ${`goal:${input.key}`})` })
          .where(eq(follow_up_sequences.campaign_id, campaignId));
      }
      return serializeGoal(row!);
    });
  } catch (error) {
    if (pgErrorCode(error) === PG_UNIQUE_VIOLATION) throw keyTaken(input.key!);
    throw error;
  }
}

export async function deleteGoal(db: Db, principal: Principal, campaignId: string, goalId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const campaign = await findCampaign(tx, principal.workspace.id, campaignId, { lock: true });
    assertEditable(campaign);
    const goal = await findGoal(tx, campaignId, goalId);
    const [reached] = await tx.select({ count: count() }).from(thread_goal_achievements).where(eq(thread_goal_achievements.goal_id, goalId));
    if ((reached?.count ?? 0) > 0) throw conflict(`${reached!.count} thread(s) reached "${goal.name}", so it can't be deleted.`);
    const covering = await tx.select({ name: follow_up_sequences.name }).from(follow_up_sequences).where(and(eq(follow_up_sequences.campaign_id, campaignId), sql`${`goal:${goal.key}`} = any(${follow_up_sequences.stages})`));
    if (covering.length > 0) throw conflict(`The sequence "${covering[0]!.name}" covers "${goal.name}". Change its stages first.`);
    // A confirmation asked about it no longer names a goal; settling it then records nothing.
    await tx.update(escalations).set({ goal_id: null }).where(eq(escalations.goal_id, goalId));
    await tx.delete(campaign_goals).where(eq(campaign_goals.id, goalId));
    const remaining = await writePositions(tx, await loadGoals(tx, campaignId));
    await assertSequencesStillValid(tx, campaignId, remaining);
  });
}

export async function reorderGoals(db: Db, principal: Principal, campaignId: string, goalIds: string[]) {
  return db.transaction(async (tx) => {
    const campaign = await findCampaign(tx, principal.workspace.id, campaignId, { lock: true });
    assertEditable(campaign);
    const goals = await loadGoals(tx, campaignId);
    if (goalIds.length !== goals.length || new Set(goalIds).size !== goalIds.length || !goals.every((goal) => goalIds.includes(goal.id))) {
      throw invalidField('body.goal_ids', 'List every goal of the campaign exactly once.');
    }
    const [reached] = await tx.select({ count: count() }).from(thread_goal_achievements).where(inArray(thread_goal_achievements.goal_id, goalIds));
    if ((reached?.count ?? 0) > 0) throw conflict('Threads have already reached these goals, so their order is fixed.');
    const ordered = await writePositions(tx, goalIds.map((goalId) => goals.find((goal) => goal.id === goalId)!));
    await assertSequencesStillValid(tx, campaignId, ordered);
    return { data: ordered.map(serializeGoal) };
  });
}
