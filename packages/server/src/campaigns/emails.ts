// The initial email, follow-up sequences, steps and A/B variants (spec §5.10, §6.6, §15.9 Emails
// tab). Every save re-checks the campaign's sequences with the core rules, inside a transaction
// that holds the campaign row, so two saves can't both claim a stage.

import { validateInitialEmail, validateSequences, type FollowUpSequence, type StageKey } from '@catalyst/core';
import type { FollowUpSequenceResource } from '@catalyst/contract';
import { campaign_step_variants, campaign_steps, custom_field_defs, follow_up_sequences, messages, newId, type Db, type Executor } from '@catalyst/db';
import { checkTemplate, type TemplateVocabulary } from '@catalyst/email';
import { and, asc, count, eq, inArray, isNull } from 'drizzle-orm';

import type { Principal } from '../api/auth.ts';
import { ApiError, conflict, invalidField, notFound, validationFailed } from '../api/errors.ts';
import { loadGoals } from './goals.ts';
import { assertEditable, findCampaign, type CampaignRow } from './service.ts';

type StepRow = typeof campaign_steps.$inferSelect;
type VariantRow = typeof campaign_step_variants.$inferSelect;
type SequenceRow = typeof follow_up_sequences.$inferSelect;
type WaitUnit = 'hours' | 'days' | 'business_days';
type Mode = StepRow['mode'];

export async function vocabularyFor(db: Executor, campaign: CampaignRow): Promise<TemplateVocabulary> {
  const defs = await db.select({ entity: custom_field_defs.entity, key: custom_field_defs.key }).from(custom_field_defs).where(eq(custom_field_defs.workspace_id, campaign.workspace_id));
  return {
    contactCustom: defs.filter((def) => def.entity === 'contact').map((def) => def.key),
    companyCustom: defs.filter((def) => def.entity === 'company').map((def) => def.key),
    links: Object.keys(campaign.links as object),
  };
}

function serializeVariant(row: VariantRow, vocabulary: TemplateVocabulary) {
  const issues = [...(row.subject_template ? checkTemplate(row.subject_template, vocabulary) : []), ...checkTemplate(row.body_template, vocabulary)];
  return { id: row.id, label: row.label, weight: row.weight, subject_template: row.subject_template, body_template: row.body_template, active: row.active, issues };
}

function serializeStep(row: StepRow, variants: VariantRow[], vocabulary: TemplateVocabulary) {
  return {
    id: row.id,
    position: row.position,
    wait: { amount: row.wait_amount, unit: row.wait_unit },
    wait_from: row.wait_from as 'last_message' | 'goal_event',
    send_as_reply: row.send_as_reply,
    mode: row.mode,
    ai_guidance: row.ai_guidance,
    include_tracking: row.include_tracking,
    variants: variants.filter((variant) => variant.step_id === row.id).map((variant) => serializeVariant(variant, vocabulary)),
  };
}

async function variantsOf(db: Executor, stepIds: string[]): Promise<VariantRow[]> {
  if (stepIds.length === 0) return [];
  return db.select().from(campaign_step_variants).where(inArray(campaign_step_variants.step_id, stepIds)).orderBy(asc(campaign_step_variants.label), asc(campaign_step_variants.id));
}

function serializeSequence(row: SequenceRow, steps: StepRow[], variants: VariantRow[], vocabulary: TemplateVocabulary): FollowUpSequenceResource {
  return {
    id: row.id,
    name: row.name,
    stages: row.stages,
    finish: row.finish,
    final_wait: { amount: row.final_wait_amount, unit: row.final_wait_unit },
    active: row.active,
    steps: steps.filter((step) => step.sequence_id === row.id).sort((a, b) => a.position - b.position).map((step) => serializeStep(step, variants, vocabulary)),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

/** The campaign's sequences in the shape the core rules take. */
export async function loadSequences(db: Executor, campaignId: string): Promise<FollowUpSequence[]> {
  const sequences = await db.select().from(follow_up_sequences).where(eq(follow_up_sequences.campaign_id, campaignId)).orderBy(asc(follow_up_sequences.created_at), asc(follow_up_sequences.id));
  const steps = await db.select().from(campaign_steps).where(eq(campaign_steps.campaign_id, campaignId));
  return sequences.map((sequence) => toCore(sequence, steps));
}

function toCore(sequence: SequenceRow, steps: StepRow[]): FollowUpSequence {
  return {
    id: sequence.id,
    name: sequence.name,
    stages: sequence.stages as StageKey[],
    finish: sequence.finish,
    finalWait: { amount: sequence.final_wait_amount, unit: sequence.final_wait_unit },
    active: sequence.active,
    steps: steps
      .filter((step) => step.sequence_id === sequence.id)
      .map((step) => ({ position: step.position, wait: { amount: step.wait_amount, unit: step.wait_unit }, waitFrom: step.wait_from as 'last_message' | 'goal_event', mode: step.mode })),
  };
}

/**
 * Checks the campaign's sequences with `candidate` replacing (or added to) the stored one, and
 * reports only the candidate's problems: an overlapping stage is 409 `stage_already_covered`,
 * anything else `validation_failed`.
 */
async function assertSequenceValid(db: Executor, campaignId: string, candidate: FollowUpSequence): Promise<void> {
  const others = (await loadSequences(db, campaignId)).filter((sequence) => sequence.id !== candidate.id);
  const goals = await loadGoals(db, campaignId);
  // The candidate goes last, so an overlap is reported against it rather than the sequence already saved.
  const issues = validateSequences([...others, candidate], goals.map((goal) => ({ id: goal.id, key: goal.key, name: goal.name, position: goal.position }))).filter((issue) => issue.sequenceId === candidate.id);
  const overlap = issues.find((issue) => issue.code === 'stage_already_covered');
  if (overlap) {
    const other = others.find((sequence) => sequence.id === overlap.otherSequenceId);
    throw new ApiError(409, 'stage_already_covered', overlap.message, [{ path: 'body.stages', message: `Used by "${other?.name}" (${other?.id}).`, reason: overlap.stage! }]);
  }
  if (issues.length > 0) throw validationFailed(issues.map((issue) => ({ path: 'body', message: issue.message })));
}

async function findSequence(db: Executor, campaignId: string, sequenceId: string): Promise<SequenceRow> {
  const [row] = await db.select().from(follow_up_sequences).where(and(eq(follow_up_sequences.id, sequenceId), eq(follow_up_sequences.campaign_id, campaignId)));
  if (!row) throw notFound('The follow-up sequence');
  return row;
}

async function findStep(db: Executor, campaignId: string, stepId: string): Promise<StepRow> {
  const [row] = await db.select().from(campaign_steps).where(and(eq(campaign_steps.id, stepId), eq(campaign_steps.campaign_id, campaignId)));
  if (!row) throw notFound('The step');
  return row;
}

async function sequenceResource(db: Executor, campaign: CampaignRow, sequenceId: string): Promise<FollowUpSequenceResource> {
  const row = await findSequence(db, campaign.id, sequenceId);
  const steps = await db.select().from(campaign_steps).where(eq(campaign_steps.sequence_id, sequenceId));
  return serializeSequence(row, steps, await variantsOf(db, steps.map((step) => step.id)), await vocabularyFor(db, campaign));
}

async function stepResource(db: Executor, campaign: CampaignRow, step: StepRow) {
  return serializeStep(step, await variantsOf(db, [step.id]), await vocabularyFor(db, campaign));
}

async function usedByMessages(db: Executor, column: 'step_id' | 'variant_id', ids: string[]): Promise<boolean> {
  if (ids.length === 0) return false;
  const [used] = await db.select({ count: count() }).from(messages).where(inArray(column === 'step_id' ? messages.step_id : messages.variant_id, ids));
  return (used?.count ?? 0) > 0;
}

/** Writes positions 1..n in the given order, passing through 101+ so the unique positions never clash. */
async function writeStepPositions(db: Executor, ordered: StepRow[]): Promise<void> {
  for (const [index, step] of ordered.entries()) await db.update(campaign_steps).set({ position: 101 + index }).where(eq(campaign_steps.id, step.id));
  for (const [index, step] of ordered.entries()) await db.update(campaign_steps).set({ position: index + 1 }).where(eq(campaign_steps.id, step.id));
}

const nextLabel = (variants: VariantRow[]) => {
  const used = new Set(variants.map((variant) => variant.label));
  for (let code = 65; code <= 90; code += 1) if (!used.has(String.fromCharCode(code))) return String.fromCharCode(code);
  return `V${variants.length + 1}`;
};

// ── Initial email ──────────────────────────────────────────────────────────────────────────────

async function initialStep(db: Executor, campaignId: string): Promise<StepRow> {
  const [row] = await db.select().from(campaign_steps).where(and(eq(campaign_steps.campaign_id, campaignId), isNull(campaign_steps.sequence_id)));
  if (!row) throw notFound('The initial email');
  return row;
}

export async function getInitialEmail(db: Db, workspaceId: string, campaignId: string) {
  const campaign = await findCampaign(db, workspaceId, campaignId);
  return stepResource(db, campaign, await initialStep(db, campaignId));
}

export async function updateInitialEmail(db: Db, principal: Principal, campaignId: string, input: { mode: Mode; ai_guidance?: string | null | undefined; include_tracking?: boolean | null | undefined }) {
  return db.transaction(async (tx) => {
    const campaign = await findCampaign(tx, principal.workspace.id, campaignId, { lock: true });
    assertEditable(campaign);
    const problems = validateInitialEmail({ mode: input.mode, wait: { amount: 0, unit: 'business_days' } });
    if (problems.length > 0) throw invalidField('body.mode', problems[0]!);
    const step = await initialStep(tx, campaignId);
    const [row] = await tx
      .update(campaign_steps)
      .set({ mode: input.mode, ...(input.ai_guidance !== undefined && { ai_guidance: input.ai_guidance }), ...(input.include_tracking !== undefined && { include_tracking: input.include_tracking }) })
      .where(eq(campaign_steps.id, step.id))
      .returning();
    return stepResource(tx, campaign, row!);
  });
}

// ── Sequences ──────────────────────────────────────────────────────────────────────────────────

const STAGE_LABELS: Record<string, string> = { sent: 'Sent', received: 'Received', responded: 'Responded' };

export async function listSequences(db: Db, workspaceId: string, campaignId: string) {
  const campaign = await findCampaign(db, workspaceId, campaignId);
  const rows = await db.select().from(follow_up_sequences).where(eq(follow_up_sequences.campaign_id, campaignId)).orderBy(asc(follow_up_sequences.created_at), asc(follow_up_sequences.id));
  const steps = await db.select().from(campaign_steps).where(eq(campaign_steps.campaign_id, campaignId));
  const variants = await variantsOf(db, steps.map((step) => step.id));
  const vocabulary = await vocabularyFor(db, campaign);
  const goals = await loadGoals(db, campaignId);
  // Every stage that can have follow-ups: Sent, Received, Responded and each goal except the final one.
  const stages = [
    ...['sent', 'received', 'responded'].map((stage) => ({ stage, label: STAGE_LABELS[stage]! })),
    ...goals.slice(0, -1).map((goal) => ({ stage: `goal:${goal.key}`, label: `${goal.name} achieved` })),
  ];
  return {
    data: rows.map((row) => serializeSequence(row, steps, variants, vocabulary)),
    stages: stages.map((entry) => ({ ...entry, sequence_id: rows.find((row) => row.active && row.stages.includes(entry.stage))?.id ?? null })),
  };
}

export async function getSequence(db: Db, workspaceId: string, campaignId: string, sequenceId: string) {
  return sequenceResource(db, await findCampaign(db, workspaceId, campaignId), sequenceId);
}

interface WaitInput {
  amount: number;
  unit: WaitUnit;
}

export interface StepInput {
  wait: WaitInput;
  wait_from?: 'last_message' | 'goal_event' | undefined;
  send_as_reply?: boolean | undefined;
  mode?: Mode | undefined;
  ai_guidance?: string | null | undefined;
  include_tracking?: boolean | null | undefined;
  variant: VariantInput;
}

export interface VariantInput {
  label?: string | undefined;
  weight?: number | undefined;
  subject_template?: string | null | undefined;
  body_template: string;
  active?: boolean | undefined;
}

async function insertStep(db: Executor, campaignId: string, sequenceId: string, position: number, input: StepInput): Promise<StepRow> {
  const [row] = await db
    .insert(campaign_steps)
    .values({
      id: newId('step'),
      campaign_id: campaignId,
      sequence_id: sequenceId,
      position,
      wait_amount: input.wait.amount,
      wait_unit: input.wait.unit,
      wait_from: input.wait_from ?? 'last_message',
      send_as_reply: input.send_as_reply ?? true,
      mode: input.mode ?? 'template',
      ai_guidance: input.ai_guidance ?? null,
      include_tracking: input.include_tracking ?? null,
    })
    .returning();
  await db.insert(campaign_step_variants).values({
    id: newId('variant'),
    step_id: row!.id,
    label: input.variant.label ?? 'A',
    weight: input.variant.weight ?? 1,
    subject_template: input.variant.subject_template ?? null,
    body_template: input.variant.body_template,
    active: input.variant.active ?? true,
  });
  return row!;
}

const coreStep = (position: number, input: Pick<StepInput, 'wait' | 'wait_from' | 'mode'>) => ({
  position,
  wait: input.wait,
  waitFrom: input.wait_from ?? ('last_message' as const),
  mode: input.mode ?? ('template' as const),
});

export interface SequenceInput {
  name: string;
  stages: string[];
  finish?: SequenceRow['finish'] | undefined;
  final_wait?: WaitInput | undefined;
  steps: StepInput[];
}

export async function createSequence(db: Db, principal: Principal, campaignId: string, input: SequenceInput, now: Date) {
  return db.transaction(async (tx) => {
    const campaign = await findCampaign(tx, principal.workspace.id, campaignId, { lock: true });
    assertEditable(campaign);
    const id = newId('sequence');
    const finalWait = input.final_wait ?? { amount: 5, unit: 'business_days' as const };
    await assertSequenceValid(tx, campaignId, {
      id,
      name: input.name,
      stages: input.stages as StageKey[],
      finish: input.finish ?? 'exhaust',
      finalWait,
      active: true,
      steps: input.steps.map((step, index) => coreStep(index + 1, step)),
    });
    await tx.insert(follow_up_sequences).values({
      id,
      campaign_id: campaignId,
      name: input.name,
      stages: [...new Set(input.stages)],
      finish: input.finish ?? 'exhaust',
      final_wait_amount: finalWait.amount,
      final_wait_unit: finalWait.unit,
      created_at: now,
      updated_at: now,
    });
    for (const [index, step] of input.steps.entries()) await insertStep(tx, campaignId, id, index + 1, step);
    return sequenceResource(tx, campaign, id);
  });
}

export async function updateSequence(
  db: Db,
  principal: Principal,
  campaignId: string,
  sequenceId: string,
  input: { name?: string | undefined; stages?: string[] | undefined; finish?: SequenceRow['finish'] | undefined; final_wait?: WaitInput | undefined; active?: boolean | undefined },
  now: Date,
) {
  return db.transaction(async (tx) => {
    const campaign = await findCampaign(tx, principal.workspace.id, campaignId, { lock: true });
    assertEditable(campaign);
    const current = await findSequence(tx, campaignId, sequenceId);
    const steps = await tx.select().from(campaign_steps).where(eq(campaign_steps.sequence_id, sequenceId));
    const next = toCore(
      {
        ...current,
        name: input.name ?? current.name,
        stages: input.stages ? [...new Set(input.stages)] : current.stages,
        finish: input.finish ?? current.finish,
        final_wait_amount: input.final_wait?.amount ?? current.final_wait_amount,
        final_wait_unit: input.final_wait?.unit ?? current.final_wait_unit,
        active: input.active ?? current.active,
      },
      steps,
    );
    await assertSequenceValid(tx, campaignId, next);
    await tx
      .update(follow_up_sequences)
      .set({ name: next.name, stages: [...next.stages], finish: next.finish, final_wait_amount: next.finalWait.amount, final_wait_unit: next.finalWait.unit, active: next.active, updated_at: now })
      .where(eq(follow_up_sequences.id, sequenceId));
    return sequenceResource(tx, campaign, sequenceId);
  });
}

export async function deleteSequence(db: Db, principal: Principal, campaignId: string, sequenceId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const campaign = await findCampaign(tx, principal.workspace.id, campaignId, { lock: true });
    assertEditable(campaign);
    await findSequence(tx, campaignId, sequenceId);
    const stepIds = (await tx.select({ id: campaign_steps.id }).from(campaign_steps).where(eq(campaign_steps.sequence_id, sequenceId))).map((step) => step.id);
    if (await usedByMessages(tx, 'step_id', stepIds)) throw conflict('Follow-ups from this sequence were already sent. Set it inactive instead, so their history stays.');
    await tx.delete(follow_up_sequences).where(eq(follow_up_sequences.id, sequenceId));
  });
}

// ── Steps ──────────────────────────────────────────────────────────────────────────────────────

export async function createStep(db: Db, principal: Principal, campaignId: string, sequenceId: string, input: StepInput, now: Date) {
  return db.transaction(async (tx) => {
    const campaign = await findCampaign(tx, principal.workspace.id, campaignId, { lock: true });
    assertEditable(campaign);
    const sequence = await findSequence(tx, campaignId, sequenceId);
    const steps = await tx.select().from(campaign_steps).where(eq(campaign_steps.sequence_id, sequenceId));
    const candidate = toCore(sequence, steps);
    await assertSequenceValid(tx, campaignId, { ...candidate, steps: [...candidate.steps, coreStep(steps.length + 1, input)] });
    const row = await insertStep(tx, campaignId, sequenceId, steps.length + 1, input);
    await tx.update(follow_up_sequences).set({ updated_at: now }).where(eq(follow_up_sequences.id, sequenceId));
    return stepResource(tx, campaign, row);
  });
}

export async function updateStep(db: Db, principal: Principal, campaignId: string, sequenceId: string, stepId: string, input: Partial<Omit<StepInput, 'variant'>>, now: Date) {
  return db.transaction(async (tx) => {
    const campaign = await findCampaign(tx, principal.workspace.id, campaignId, { lock: true });
    assertEditable(campaign);
    const sequence = await findSequence(tx, campaignId, sequenceId);
    const step = await findStep(tx, campaignId, stepId);
    if (step.sequence_id !== sequenceId) throw notFound('The step');
    const patch: Partial<typeof campaign_steps.$inferInsert> = {};
    if (input.wait) Object.assign(patch, { wait_amount: input.wait.amount, wait_unit: input.wait.unit });
    if (input.wait_from !== undefined) patch.wait_from = input.wait_from;
    if (input.send_as_reply !== undefined) patch.send_as_reply = input.send_as_reply;
    if (input.mode !== undefined) patch.mode = input.mode;
    if (input.ai_guidance !== undefined) patch.ai_guidance = input.ai_guidance;
    if (input.include_tracking !== undefined) patch.include_tracking = input.include_tracking;
    const steps = (await tx.select().from(campaign_steps).where(eq(campaign_steps.sequence_id, sequenceId))).map((entry) => (entry.id === stepId ? { ...entry, ...patch } : entry));
    await assertSequenceValid(tx, campaignId, toCore(sequence, steps as StepRow[]));
    const [row] = Object.keys(patch).length > 0 ? await tx.update(campaign_steps).set(patch).where(eq(campaign_steps.id, stepId)).returning() : [step];
    await tx.update(follow_up_sequences).set({ updated_at: now }).where(eq(follow_up_sequences.id, sequenceId));
    return stepResource(tx, campaign, row!);
  });
}

export async function deleteStep(db: Db, principal: Principal, campaignId: string, sequenceId: string, stepId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const campaign = await findCampaign(tx, principal.workspace.id, campaignId, { lock: true });
    assertEditable(campaign);
    await findSequence(tx, campaignId, sequenceId);
    const step = await findStep(tx, campaignId, stepId);
    if (step.sequence_id !== sequenceId) throw notFound('The step');
    const steps = await tx.select().from(campaign_steps).where(eq(campaign_steps.sequence_id, sequenceId)).orderBy(asc(campaign_steps.position));
    if (steps.length === 1) throw conflict('A sequence needs at least one step; delete the sequence instead.');
    if (await usedByMessages(tx, 'step_id', [stepId])) throw conflict('This step was already sent, so it stays for the record. Change its text instead.');
    await tx.delete(campaign_steps).where(eq(campaign_steps.id, stepId));
    await writeStepPositions(tx, steps.filter((entry) => entry.id !== stepId));
  });
}

export async function reorderSteps(db: Db, principal: Principal, campaignId: string, sequenceId: string, stepIds: string[], now: Date) {
  return db.transaction(async (tx) => {
    const campaign = await findCampaign(tx, principal.workspace.id, campaignId, { lock: true });
    assertEditable(campaign);
    const sequence = await findSequence(tx, campaignId, sequenceId);
    const steps = await tx.select().from(campaign_steps).where(eq(campaign_steps.sequence_id, sequenceId));
    if (stepIds.length !== steps.length || new Set(stepIds).size !== stepIds.length || !steps.every((step) => stepIds.includes(step.id))) {
      throw invalidField('body.step_ids', 'List every step of the sequence exactly once.');
    }
    const ordered = stepIds.map((stepId) => steps.find((step) => step.id === stepId)!);
    await assertSequenceValid(tx, campaignId, toCore(sequence, ordered.map((step, index) => ({ ...step, position: index + 1 }))));
    await writeStepPositions(tx, ordered);
    await tx.update(follow_up_sequences).set({ updated_at: now }).where(eq(follow_up_sequences.id, sequenceId));
    return sequenceResource(tx, campaign, sequenceId);
  });
}

// ── Variants ───────────────────────────────────────────────────────────────────────────────────

async function stepForVariant(db: Executor, principal: Principal, campaignId: string, stepId: string) {
  const campaign = await findCampaign(db, principal.workspace.id, campaignId, { lock: true });
  assertEditable(campaign);
  return { campaign, step: await findStep(db, campaignId, stepId) };
}

export async function createVariant(db: Db, principal: Principal, campaignId: string, stepId: string, input: VariantInput) {
  return db.transaction(async (tx) => {
    const { campaign, step } = await stepForVariant(tx, principal, campaignId, stepId);
    if (step.sequence_id === null && !input.subject_template) throw invalidField('body.subject_template', 'The initial email needs a subject.');
    const existing = await variantsOf(tx, [stepId]);
    if (existing.length >= 10) throw invalidField('body', 'A step has at most 10 variants.');
    const [row] = await tx
      .insert(campaign_step_variants)
      .values({
        id: newId('variant'),
        step_id: stepId,
        label: input.label ?? nextLabel(existing),
        weight: input.weight ?? 1,
        subject_template: input.subject_template ?? null,
        body_template: input.body_template,
        active: input.active ?? true,
      })
      .returning();
    return serializeVariant(row!, await vocabularyFor(tx, campaign));
  });
}

async function findVariant(db: Executor, stepId: string, variantId: string): Promise<VariantRow> {
  const [row] = await db.select().from(campaign_step_variants).where(and(eq(campaign_step_variants.id, variantId), eq(campaign_step_variants.step_id, stepId)));
  if (!row) throw notFound('The variant');
  return row;
}

export async function updateVariant(db: Db, principal: Principal, campaignId: string, stepId: string, variantId: string, input: Partial<VariantInput>) {
  return db.transaction(async (tx) => {
    const { campaign, step } = await stepForVariant(tx, principal, campaignId, stepId);
    const current = await findVariant(tx, stepId, variantId);
    if (step.sequence_id === null && input.subject_template === null) throw invalidField('body.subject_template', 'The initial email needs a subject.');
    const patch: Partial<typeof campaign_step_variants.$inferInsert> = {};
    for (const field of ['label', 'weight', 'subject_template', 'body_template', 'active'] as const) if (input[field] !== undefined) Object.assign(patch, { [field]: input[field] });
    if (patch.active === false) {
      const others = (await variantsOf(tx, [stepId])).filter((variant) => variant.id !== variantId && variant.active);
      if (others.length === 0) throw conflict('This is the step’s only active variant.');
    }
    const [row] = Object.keys(patch).length > 0 ? await tx.update(campaign_step_variants).set(patch).where(eq(campaign_step_variants.id, variantId)).returning() : [current];
    return serializeVariant(row!, await vocabularyFor(tx, campaign));
  });
}

export async function deleteVariant(db: Db, principal: Principal, campaignId: string, stepId: string, variantId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await stepForVariant(tx, principal, campaignId, stepId);
    await findVariant(tx, stepId, variantId);
    const all = await variantsOf(tx, [stepId]);
    if (all.length === 1) throw conflict('A step needs at least one variant.');
    if (await usedByMessages(tx, 'variant_id', [variantId])) throw conflict('Emails were sent with this variant; set it inactive instead so its statistics stay.');
    await tx.delete(campaign_step_variants).where(eq(campaign_step_variants.id, variantId));
  });
}

export { findStep, initialStep, variantsOf };
