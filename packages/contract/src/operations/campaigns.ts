// Campaign operations (spec §13.4 "Campaigns").

import { z } from 'zod';

import { describedEnum, id, paginated, paginationQuery } from '../common.ts';
import { defineOperation } from '../operation.ts';
import {
  campaignExample,
  campaignSchema,
  campaignStatusSchema,
  createGoalSchema,
  enrollmentResultSchema,
  goalExample,
  goalSchema,
  personaSchema,
  preflightSchema,
  sequenceSchema,
  stepInputSchema,
  stepModeSchema,
  stepSchema,
  templateIssueSchema,
  updateGoalSchema,
  variantInputSchema,
  variantSchema,
  waitSchema,
  type FollowUpSequenceResource,
} from '../schemas/campaigns.ts';
import { lintFindingSchema } from '../schemas/threads.ts';

const campaignId = id('campaign', 'The campaign.');
const campaignParams = z.object({ campaignId });
const goalParams = z.object({ campaignId, goalId: id('goal', 'The goal.') });
const sequenceParams = z.object({ campaignId, sequenceId: id('sequence', 'The follow-up sequence.') });
const sequenceStepParams = z.object({ campaignId, sequenceId: id('sequence', 'The follow-up sequence.'), stepId: id('step', 'The step.') });
const stepParams = z.object({ campaignId, stepId: id('step', 'The initial email or a follow-up step.') });
const variantParams = z.object({ campaignId, stepId: id('step', 'The step.'), variantId: id('variant', 'The variant.') });

const variantExample = {
  id: 'var_01jd3x5k8qf7tb9w2m4n6p8r0s',
  label: 'A',
  weight: 1,
  subject_template: 'Quick question about {{ company.name | default: "your team" }}',
  body_template: 'Hi {{ contact.first_name | default: "there" }},\n\nHow does {{ company.name | default: "your team" }} handle onboarding today?\n\n{{ sender.first_name }}',
  active: true,
  issues: [],
};
const stepExample = { id: 'stp_01jd3x5k8qf7tb9w2m4n6p8r0s', position: 1, wait: { amount: 3, unit: 'business_days' as const }, wait_from: 'last_message' as const, send_as_reply: true, mode: 'template' as const, ai_guidance: null, include_tracking: null, variants: [variantExample] };
const sequenceExample: FollowUpSequenceResource = {
  id: 'seq_01jd3x5k8qf7tb9w2m4n6p8r0s',
  name: 'No reply to the first email',
  stages: ['sent', 'received'],
  finish: 'exhaust',
  final_wait: { amount: 5, unit: 'business_days' },
  active: true,
  steps: [stepExample],
  created_at: '2026-10-20T10:00:00Z',
  updated_at: '2026-10-20T10:00:00Z',
};
const initialEmailExample = { ...stepExample, wait: { amount: 0, unit: 'business_days' as const }, send_as_reply: false };

const goalListSchema = z.object({ data: z.array(goalSchema) }).meta({ id: 'GoalList', description: 'A campaign’s goals in order.' });

const reasonedStatus = (status: 'active' | 'paused' | 'archived') => ({ ...campaignExample, status });

// ── Campaigns ──────────────────────────────────────────────────────────────────────────────────

export const listCampaigns = defineOperation({
  operationId: 'listCampaigns',
  method: 'get',
  path: '/campaigns',
  tag: 'Campaigns',
  summary: 'List campaigns',
  description: 'Returns campaigns, newest first, with their status, settings and how many contacts are enrolled. Archived campaigns are included unless `status` filters them out.',
  access: 'scoped',
  scopes: ['campaigns:read'],
  query: z.object({ ...paginationQuery, status: campaignStatusSchema.optional().meta({ description: 'Only campaigns with this status.' }) }),
  response: { status: 200, description: 'A page of campaigns.', schema: paginated(campaignSchema, 'Campaign'), example: { data: [campaignExample], next_cursor: null } },
  mcp: { toolset: 'campaigns' },
});

export const createCampaign = defineOperation({
  operationId: 'createCampaign',
  method: 'post',
  path: '/campaigns',
  tag: 'Campaigns',
  summary: 'Create a draft campaign',
  description:
    'Creates a campaign in draft with the default follow-up sequences (§5.10), using `goals` if given (goal 1 gets a sequence when a goal follows it). Give `initial_email` to start the first email; otherwise add it with updateInitialEmail. Nothing is sent until launchCampaign.',
  access: 'scoped',
  scopes: ['campaigns:write'],
  idempotencyKey: 'optional',
  body: {
    schema: z
      .strictObject({
        name: z.string().min(1).max(200).meta({ description: 'Campaign name.' }),
        objective: z.string().min(1).max(4000).meta({ description: 'The plain-language business objective.' }),
        description: z.string().max(2000).optional().meta({ description: 'Notes for people.' }),
        persona: personaSchema.optional(),
        goals: z.array(createGoalSchema).max(10).optional().meta({ description: 'Goals in order: the first is goal 1, the last is the final goal.' }),
        initial_email: z
          .strictObject({
            subject_template: z.string().min(1).max(300).meta({ description: 'Subject template.' }),
            body_template: z.string().min(1).max(20_000).meta({ description: 'Body template.' }),
          })
          .optional()
          .meta({ description: 'The first variant of the initial email.' }),
        links: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), z.url()).optional().meta({ description: 'Links the agent may use, by key.' }),
        agent_mode: campaignSchema.shape.agent_mode.optional().meta({ description: 'Who writes replies and AI follow-ups: Catalyst’s agent (default), or your own through the API and MCP (§10.7).' }),
      })
      .meta({ id: 'CreateCampaign' }),
    example: {
      name: 'Agency outreach Q4',
      objective: 'Book discovery calls with heads of operations at SaaS companies.',
      goals: [
        { key: 'call_booked', name: 'Discovery call booked', success_criteria: 'Books a call or agrees a time.', playbook: 'Offer the booking link.' },
        { key: 'paid', name: 'Paid', success_criteria: 'Pays for a plan.', playbook: 'Send the checkout link after the call.' },
      ],
      initial_email: { subject_template: variantExample.subject_template, body_template: variantExample.body_template },
      links: { booking: 'https://cal.com/acme/intro' },
    },
  },
  response: { status: 201, description: 'The draft campaign.', schema: campaignSchema, example: { ...campaignExample, status: 'draft', thread_count: 0, launched_at: null } },
  mcp: { toolset: 'campaigns' },
});

export const getCampaign = defineOperation({
  operationId: 'getCampaign',
  method: 'get',
  path: '/campaigns/{campaignId}',
  tag: 'Campaigns',
  summary: 'Get one campaign',
  description: 'Returns a campaign with all its settings and mailboxes. Its goals, initial email and sequences have their own operations.',
  access: 'scoped',
  scopes: ['campaigns:read'],
  params: campaignParams,
  response: { status: 200, description: 'The campaign.', schema: campaignSchema, example: campaignExample },
  mcp: { toolset: 'campaigns' },
});

export const updateCampaign = defineOperation({
  operationId: 'updateCampaign',
  method: 'patch',
  path: '/campaigns/{campaignId}',
  tag: 'Campaigns',
  summary: 'Change a campaign’s settings',
  description:
    'Changes only the settings you send: agent (including `agent_mode`: Catalyst’s agent, or your own through the API and MCP, §10.7), sending window, caps, tracking, compliance, enrollment rules and links. Changes apply to emails composed from now on. An archived campaign cannot change.',
  access: 'scoped',
  scopes: ['campaigns:write'],
  params: campaignParams,
  ifMatch: true,
  body: {
    schema: campaignSchema.omit({ id: true, status: true, mailboxes: true, goal_count: true, thread_count: true, launched_at: true, completed_at: true, archived_at: true, created_at: true, updated_at: true }).strict().partial().meta({ id: 'UpdateCampaign' }),
    example: { autonomy: 'manual', daily_new_threads_limit: 20 },
  },
  response: { status: 200, description: 'The campaign after the change.', schema: campaignSchema, example: campaignExample },
  errors: [409],
  mcp: { toolset: 'campaigns' },
});

export const deleteCampaign = defineOperation({
  operationId: 'deleteCampaign',
  method: 'delete',
  path: '/campaigns/{campaignId}',
  tag: 'Campaigns',
  summary: 'Delete a draft campaign',
  description: 'Deletes a campaign that was never launched. A launched campaign answers `conflict`: archive it instead, which keeps its history.',
  access: 'scoped',
  scopes: ['campaigns:write'],
  params: campaignParams,
  response: { status: 204, description: 'The campaign was deleted.' },
  errors: [409],
  mcp: { toolset: 'campaigns' },
});

const lifecycle = <const Id extends string, const P extends string>(operationId: Id, path: P, summary: string, description: string, status: 'active' | 'paused' | 'archived', scopes: readonly ('campaigns:write' | 'messages:send')[], destructive = false) =>
  defineOperation({
    operationId,
    method: 'post',
    path,
    tag: 'Campaigns',
    summary,
    description,
    access: 'scoped',
    scopes,
    params: campaignParams,
    idempotencyKey: 'optional',
    response: { status: 200, description: 'The campaign.', schema: campaignSchema, example: reasonedStatus(status) },
    errors: [409, 422],
    mcp: { toolset: 'campaigns', ...(destructive && { destructive: true }), ...(status === 'active' && operationId === 'launchCampaign' && { openWorld: true }) },
  });

export const launchCampaign = lifecycle(
  'launchCampaign',
  '/campaigns/{campaignId}/launch',
  'Launch a campaign: start sending to enrolled contacts',
  'Runs preflight and, if nothing fails, makes the campaign active: enrolled contacts get their initial email within caps and sending windows. A failing preflight answers 422 `preflight_failed` with the items in `errors`. Needs `messages:send`.',
  'active',
  ['campaigns:write', 'messages:send'],
);
export const pauseCampaign = lifecycle(
  'pauseCampaign',
  '/campaigns/{campaignId}/pause',
  'Pause a campaign’s sending',
  'Stops all scheduled sending for the campaign. Replies are still polled and analysed, and drafts wait for approval. Undo with resumeCampaign.',
  'paused',
  ['campaigns:write'],
);
export const resumeCampaign = lifecycle(
  'resumeCampaign',
  '/campaigns/{campaignId}/resume',
  'Resume a paused campaign',
  'Makes a paused campaign active again. Follow-ups that fell due while paused are rescheduled from now, so nothing goes out in a burst.',
  'active',
  ['campaigns:write'],
);
export const archiveCampaign = lifecycle(
  'archiveCampaign',
  '/campaigns/{campaignId}/archive',
  'Archive a campaign',
  'Makes the campaign read-only and stops its remaining threads. Its history and statistics are kept. This cannot be undone.',
  'archived',
  ['campaigns:write'],
  true,
);

export const runCampaignPreflight = defineOperation({
  operationId: 'runCampaignPreflight',
  method: 'get',
  path: '/campaigns/{campaignId}/preflight',
  tag: 'Campaigns',
  summary: 'Check whether a campaign is ready to launch',
  description:
    'Runs every launch check (§8.11): goals and playbooks, the initial email and follow-ups rendered for enrolled contacts with no lint blockers, sequence rules, mailboxes and domains, compliance and audience. Any `fail` blocks launch. It changes nothing.',
  access: 'scoped',
  scopes: ['campaigns:read'],
  params: campaignParams,
  response: {
    status: 200,
    description: 'The checklist.',
    schema: preflightSchema,
    example: {
      passed: false,
      items: [
        { id: 'goals', status: 'pass', title: 'Goals', detail: '2 goals, each with a playbook.' },
        { id: 'mailboxes', status: 'fail', title: 'Mailboxes', detail: 'Assign at least one active mailbox with setCampaignMailboxes.' },
      ],
      audience: { enrollable: 212, enrolled: 212, skipped: {} },
    },
  },
  mcp: { toolset: 'campaigns' },
});

export const setCampaignMailboxes = defineOperation({
  operationId: 'setCampaignMailboxes',
  method: 'put',
  path: '/campaigns/{campaignId}/mailboxes',
  tag: 'Campaigns',
  summary: 'Choose the mailboxes a campaign sends from',
  description: 'Replaces the campaign’s mailboxes and their weights. A thread keeps the mailbox it started on; new threads pick from these (§8.3.3).',
  access: 'scoped',
  scopes: ['campaigns:write'],
  params: campaignParams,
  body: {
    schema: z
      .strictObject({
        mailboxes: z.array(z.strictObject({ mailbox_id: id('mailbox'), weight: z.int().min(1).max(10).optional().meta({ description: 'Relative share; defaults to 1.' }) })).max(50).meta({ description: 'The mailboxes, each at most once.' }),
      })
      .meta({ id: 'CampaignMailboxes' }),
    example: { mailboxes: [{ mailbox_id: 'mbx_01jd3x5k8qf7tb9w2m4n6p8r0s', weight: 1 }] },
  },
  response: { status: 200, description: 'The campaign.', schema: campaignSchema, example: campaignExample },
  errors: [409],
  mcp: { toolset: 'campaigns' },
});

export const enrollContacts = defineOperation({
  operationId: 'enrollContacts',
  method: 'post',
  path: '/campaigns/{campaignId}/enrollments',
  tag: 'Campaigns',
  summary: 'Enroll contacts in a campaign',
  description:
    'Creates a thread for each contact given by `contact_ids` (up to 1,000) or `list_id`, and skips those that must not be emailed, reporting why: suppressed, unsubscribed, invalid, risky, active elsewhere, within the cooldown and so on (§8.5). Enrolling sends nothing by itself; an active campaign sends within its caps and windows.',
  access: 'scoped',
  scopes: ['campaigns:write'],
  params: campaignParams,
  idempotencyKey: 'optional',
  body: {
    schema: z
      .strictObject({
        contact_ids: z.array(id('contact')).min(1).max(1000).optional().meta({ description: 'Contacts to enroll. Give this or list_id.' }),
        list_id: id('list', 'A list or segment to enroll, at most 5,000 contacts. Give this or contact_ids.').optional(),
      })
      .meta({ id: 'EnrollContacts' }),
    example: { list_id: 'lst_01jd3x5k8qf7tb9w2m4n6p8r0s' },
  },
  response: {
    status: 200,
    description: 'Who was enrolled and who was skipped.',
    schema: enrollmentResultSchema,
    example: { created: [{ contact_id: 'ctc_01jd3x5k8qf7tb9w2m4n6p8r0s', thread_id: 'thr_01jd3x5k8qf7tb9w2m4n6p8r0s' }], skipped: [{ contact_id: 'ctc_01jd3x5k8qf7tb9w2m4n6p8r0t', reason: 'suppressed' }] },
  },
  errors: [409],
  mcp: { toolset: 'campaigns' },
});

// ── Goals ──────────────────────────────────────────────────────────────────────────────────────

export const listCampaignGoals = defineOperation({
  operationId: 'listCampaignGoals',
  method: 'get',
  path: '/campaigns/{campaignId}/goals',
  tag: 'Campaigns',
  summary: 'List a campaign’s goals in order',
  description: 'Returns the goals by position. A thread’s stage is "⟨goal name⟩ achieved" for the highest goal reached; the last goal is final and completes the conversation.',
  access: 'scoped',
  scopes: ['campaigns:read'],
  params: campaignParams,
  response: { status: 200, description: 'The goals.', schema: goalListSchema, example: { data: [goalExample] } },
  mcp: { toolset: 'campaigns' },
});

export const createCampaignGoal = defineOperation({
  operationId: 'createCampaignGoal',
  method: 'post',
  path: '/campaigns/{campaignId}/goals',
  tag: 'Campaigns',
  summary: 'Add a goal after the existing ones',
  description: 'Adds a goal at the end, which makes it the final goal. Fails with `conflict` if the key is taken, or if a follow-up sequence would then cover the final goal.',
  access: 'scoped',
  scopes: ['campaigns:write'],
  params: campaignParams,
  idempotencyKey: 'optional',
  body: { schema: createGoalSchema, example: { key: 'paid', name: 'Paid', success_criteria: 'The contact pays for a plan.', playbook: 'Recap the call and send the checkout link.', marks_customer: true } },
  response: { status: 201, description: 'The goal.', schema: goalSchema, example: goalExample },
  errors: [409],
  mcp: { toolset: 'campaigns' },
});

export const updateCampaignGoal = defineOperation({
  operationId: 'updateCampaignGoal',
  method: 'patch',
  path: '/campaigns/{campaignId}/goals/{goalId}',
  tag: 'Campaigns',
  summary: 'Change a goal',
  description: 'Changes the fields you send. Changing the key renames the goal’s follow-up stage (goal:<key>) in every sequence.',
  access: 'scoped',
  scopes: ['campaigns:write'],
  params: goalParams,
  body: { schema: updateGoalSchema, example: { playbook: 'Answer briefly, then offer the booking link.' } },
  response: { status: 200, description: 'The goal.', schema: goalSchema, example: goalExample },
  errors: [409],
  mcp: { toolset: 'campaigns' },
});

export const deleteCampaignGoal = defineOperation({
  operationId: 'deleteCampaignGoal',
  method: 'delete',
  path: '/campaigns/{campaignId}/goals/{goalId}',
  tag: 'Campaigns',
  summary: 'Delete a goal',
  description: 'Deletes a goal no thread has reached and no sequence covers; the goals after it move up. Otherwise answers `conflict`.',
  access: 'scoped',
  scopes: ['campaigns:write'],
  params: goalParams,
  response: { status: 204, description: 'The goal was deleted.' },
  errors: [409],
  mcp: { toolset: 'campaigns' },
});

export const reorderCampaignGoals = defineOperation({
  operationId: 'reorderCampaignGoals',
  method: 'post',
  path: '/campaigns/{campaignId}/goals/reorder',
  tag: 'Campaigns',
  summary: 'Put a campaign’s goals in a new order',
  description: 'Sets the goal order from `goal_ids`, which must list every goal once. Refused once any thread has reached a goal, or if a sequence would then cover the final goal.',
  access: 'scoped',
  scopes: ['campaigns:write'],
  params: campaignParams,
  body: { schema: z.strictObject({ goal_ids: z.array(id('goal')).min(1).max(10).meta({ description: 'Every goal, in the new order.' }) }).meta({ id: 'ReorderGoals' }), example: { goal_ids: [goalExample.id] } },
  response: { status: 200, description: 'The goals in their new order.', schema: goalListSchema, example: { data: [goalExample] } },
  errors: [409],
  mcp: { toolset: 'campaigns' },
});

// ── Initial email ──────────────────────────────────────────────────────────────────────────────

export const getInitialEmail = defineOperation({
  operationId: 'getInitialEmail',
  method: 'get',
  path: '/campaigns/{campaignId}/initial-email',
  tag: 'Campaigns',
  summary: 'Get a campaign’s initial email and its variants',
  description: 'Returns the initial email (the first touch): its mode, guidance, tracking and A/B variants, each with the template problems found in it.',
  access: 'scoped',
  scopes: ['campaigns:read'],
  params: campaignParams,
  response: { status: 200, description: 'The initial email.', schema: stepSchema, example: initialEmailExample },
  mcp: { toolset: 'campaigns' },
});

export const updateInitialEmail = defineOperation({
  operationId: 'updateInitialEmail',
  method: 'put',
  path: '/campaigns/{campaignId}/initial-email',
  tag: 'Campaigns',
  summary: 'Set the initial email’s mode, guidance and tracking',
  description: 'Sets how the initial email is written (template, AI opening line or AI writes; not AI adapts) and whether its opens are tracked. Its text lives in variants: use createStepVariant and updateStepVariant.',
  access: 'scoped',
  scopes: ['campaigns:write'],
  params: campaignParams,
  body: {
    schema: z
      .strictObject({
        mode: stepModeSchema,
        ai_guidance: z.string().max(4000).nullable().optional().meta({ description: 'Guidance for AI modes.' }),
        include_tracking: z.boolean().nullable().optional().meta({ description: 'Null inherits the campaign setting.' }),
      })
      .meta({ id: 'UpdateInitialEmail' }),
    example: { mode: 'ai_opening_line', ai_guidance: 'Mention something specific from their title or company.' },
  },
  response: { status: 200, description: 'The initial email.', schema: stepSchema, example: initialEmailExample },
  errors: [409],
  mcp: { toolset: 'campaigns' },
});

// ── Follow-up sequences ────────────────────────────────────────────────────────────────────────

export const listFollowUpSequences = defineOperation({
  operationId: 'listFollowUpSequences',
  method: 'get',
  path: '/campaigns/{campaignId}/follow-up-sequences',
  tag: 'Campaigns',
  summary: 'List follow-up sequences with the stage → sequence map',
  description:
    'Returns every sequence with its steps, and which sequence covers each stage (Sent, Received, Responded and each goal but the last). A stage with no sequence gets no follow-ups and waits for its finish rule.',
  access: 'scoped',
  scopes: ['campaigns:read'],
  params: campaignParams,
  response: {
    status: 200,
    description: 'The sequences and the stage map.',
    schema: z
      .object({
        data: z.array(sequenceSchema),
        stages: z
          .array(z.object({ stage: z.string(), label: z.string(), sequence_id: z.string().nullable() }))
          .meta({ description: 'Each stage that can have follow-ups, in order, with the sequence covering it.' }),
      })
      .meta({ id: 'FollowUpSequenceList' }),
    example: { data: [sequenceExample], stages: [{ stage: 'sent', label: 'Sent', sequence_id: sequenceExample.id }] },
  },
  mcp: { toolset: 'campaigns' },
});

const sequenceFields = {
  name: z.string().min(1).max(200).meta({ description: 'Name, e.g. "No reply to the first email".' }),
  stages: z.array(z.string().regex(/^(sent|received|responded|goal:[a-z][a-z0-9_]{0,39})$/)).min(1).max(10).meta({ description: 'Stages covered: sent, received, responded or goal:<key>. Never the final goal.' }),
  finish: sequenceSchema.shape.finish,
  final_wait: waitSchema.meta({ description: 'Wait after the last step before the finish rule.' }),
};

export const createFollowUpSequence = defineOperation({
  operationId: 'createFollowUpSequence',
  method: 'post',
  path: '/campaigns/{campaignId}/follow-up-sequences',
  tag: 'Campaigns',
  summary: 'Create a follow-up sequence for one or more stages',
  description:
    'Creates a sequence with 1 to 6 steps. A stage another active sequence covers answers 409 `stage_already_covered`, naming the stage and that sequence; waits under 24 hours answer `validation_failed`. Nothing is saved on a failure.',
  access: 'scoped',
  scopes: ['campaigns:write'],
  params: campaignParams,
  idempotencyKey: 'optional',
  body: {
    schema: z
      .strictObject({
        ...sequenceFields,
        finish: sequenceFields.finish.optional(),
        final_wait: sequenceFields.final_wait.optional(),
        steps: z.array(stepInputSchema).min(1).max(6).meta({ description: 'The steps, in order.' }),
      })
      .meta({ id: 'CreateFollowUpSequence' }),
    example: { name: 'Went quiet after replying', stages: ['responded'], finish: 'notify_owner', steps: [{ wait: { amount: 2, unit: 'business_days' }, mode: 'ai_adapt', variant: { body_template: 'Follow up on their open question or the call ask.' } }] },
  },
  response: { status: 201, description: 'The sequence.', schema: sequenceSchema, example: sequenceExample },
  errors: [409],
  mcp: { toolset: 'campaigns' },
});

export const getFollowUpSequence = defineOperation({
  operationId: 'getFollowUpSequence',
  method: 'get',
  path: '/campaigns/{campaignId}/follow-up-sequences/{sequenceId}',
  tag: 'Campaigns',
  summary: 'Get one follow-up sequence with its steps',
  description: 'Returns a sequence with its stages, finish rule, final wait and steps with their variants.',
  access: 'scoped',
  scopes: ['campaigns:read'],
  params: sequenceParams,
  response: { status: 200, description: 'The sequence.', schema: sequenceSchema, example: sequenceExample },
  mcp: { toolset: 'campaigns' },
});

export const updateFollowUpSequence = defineOperation({
  operationId: 'updateFollowUpSequence',
  method: 'patch',
  path: '/campaigns/{campaignId}/follow-up-sequences/{sequenceId}',
  tag: 'Campaigns',
  summary: 'Rename a sequence, change its stages, finish rule or wait, or pause it',
  description: 'Changes the fields you send. Adding a stage another active sequence covers answers 409 `stage_already_covered`. Setting `active` false stops it and frees its stages.',
  access: 'scoped',
  scopes: ['campaigns:write'],
  params: sequenceParams,
  body: { schema: z.strictObject({ ...sequenceFields, active: z.boolean().meta({ description: 'Whether it runs.' }) }).partial().meta({ id: 'UpdateFollowUpSequence' }), example: { finish: 'close_lost' } },
  response: { status: 200, description: 'The sequence.', schema: sequenceSchema, example: sequenceExample },
  errors: [409],
  mcp: { toolset: 'campaigns' },
});

export const deleteFollowUpSequence = defineOperation({
  operationId: 'deleteFollowUpSequence',
  method: 'delete',
  path: '/campaigns/{campaignId}/follow-up-sequences/{sequenceId}',
  tag: 'Campaigns',
  summary: 'Delete a follow-up sequence',
  description: 'Deletes the sequence and its steps. Its stages then get no follow-ups. A sequence with sent follow-ups can only be paused (active false), so their history stays.',
  access: 'scoped',
  scopes: ['campaigns:write'],
  params: sequenceParams,
  response: { status: 204, description: 'The sequence was deleted.' },
  errors: [409],
  mcp: { toolset: 'campaigns' },
});

export const createFollowUpStep = defineOperation({
  operationId: 'createFollowUpStep',
  method: 'post',
  path: '/campaigns/{campaignId}/follow-up-sequences/{sequenceId}/steps',
  tag: 'Campaigns',
  summary: 'Add a step at the end of a follow-up sequence',
  description: 'Appends a step (at most 6 per sequence) with its wait, mode and first variant. Waits must be at least 24 hours.',
  access: 'scoped',
  scopes: ['campaigns:write'],
  params: sequenceParams,
  idempotencyKey: 'optional',
  body: { schema: stepInputSchema, example: { wait: { amount: 7, unit: 'business_days' }, variant: { body_template: 'Hi {{ contact.first_name | default: "there" }}, closing the loop here.' } } },
  response: { status: 201, description: 'The step.', schema: stepSchema, example: stepExample },
  errors: [409],
  mcp: { toolset: 'campaigns' },
});

export const updateFollowUpStep = defineOperation({
  operationId: 'updateFollowUpStep',
  method: 'patch',
  path: '/campaigns/{campaignId}/follow-up-sequences/{sequenceId}/steps/{stepId}',
  tag: 'Campaigns',
  summary: 'Change a follow-up step’s wait, mode or guidance',
  description: 'Changes the fields you send. The text lives in the step’s variants.',
  access: 'scoped',
  scopes: ['campaigns:write'],
  params: sequenceStepParams,
  body: { schema: stepInputSchema.omit({ variant: true }).partial().meta({ id: 'UpdateFollowUpStep' }), example: { wait: { amount: 4, unit: 'business_days' } } },
  response: { status: 200, description: 'The step.', schema: stepSchema, example: stepExample },
  mcp: { toolset: 'campaigns' },
});

export const deleteFollowUpStep = defineOperation({
  operationId: 'deleteFollowUpStep',
  method: 'delete',
  path: '/campaigns/{campaignId}/follow-up-sequences/{sequenceId}/steps/{stepId}',
  tag: 'Campaigns',
  summary: 'Delete a follow-up step',
  description: 'Deletes a step; the steps after it move up. A sequence keeps at least one step, and a step that was already sent can’t be deleted.',
  access: 'scoped',
  scopes: ['campaigns:write'],
  params: sequenceStepParams,
  response: { status: 204, description: 'The step was deleted.' },
  errors: [409],
  mcp: { toolset: 'campaigns' },
});

export const reorderFollowUpSteps = defineOperation({
  operationId: 'reorderFollowUpSteps',
  method: 'post',
  path: '/campaigns/{campaignId}/follow-up-sequences/{sequenceId}/steps/reorder',
  tag: 'Campaigns',
  summary: 'Put a sequence’s steps in a new order',
  description: 'Sets the step order from `step_ids`, which must list every step of the sequence once.',
  access: 'scoped',
  scopes: ['campaigns:write'],
  params: sequenceParams,
  body: { schema: z.strictObject({ step_ids: z.array(id('step')).min(1).max(6).meta({ description: 'Every step, in the new order.' }) }).meta({ id: 'ReorderSteps' }), example: { step_ids: [stepExample.id] } },
  response: { status: 200, description: 'The sequence.', schema: sequenceSchema, example: sequenceExample },
  mcp: { toolset: 'campaigns' },
});

// ── Variants and preview ───────────────────────────────────────────────────────────────────────

export const createStepVariant = defineOperation({
  operationId: 'createStepVariant',
  method: 'post',
  path: '/campaigns/{campaignId}/steps/{stepId}/variants',
  tag: 'Campaigns',
  summary: 'Add an A/B variant to the initial email or a follow-up step',
  description: 'Adds a version of the step’s message. Traffic is split by weight between active variants. Template problems come back in `issues`; they block sending until fixed.',
  access: 'scoped',
  scopes: ['campaigns:write'],
  params: stepParams,
  idempotencyKey: 'optional',
  body: { schema: variantInputSchema, example: { label: 'B', subject_template: 'Onboarding at {{ company.name | default: "your team" }}?', body_template: 'Hi {{ contact.first_name | default: "there" }}, …' } },
  response: { status: 201, description: 'The variant.', schema: variantSchema, example: variantExample },
  mcp: { toolset: 'campaigns' },
});

export const updateStepVariant = defineOperation({
  operationId: 'updateStepVariant',
  method: 'patch',
  path: '/campaigns/{campaignId}/steps/{stepId}/variants/{variantId}',
  tag: 'Campaigns',
  summary: 'Change a variant’s text, weight or label',
  description: 'Changes the fields you send. Emails already composed keep their text. Template problems come back in `issues`.',
  access: 'scoped',
  scopes: ['campaigns:write'],
  params: variantParams,
  body: { schema: variantInputSchema.partial().meta({ id: 'UpdateVariant' }), example: { weight: 2 } },
  response: { status: 200, description: 'The variant.', schema: variantSchema, example: variantExample },
  mcp: { toolset: 'campaigns' },
});

export const deleteStepVariant = defineOperation({
  operationId: 'deleteStepVariant',
  method: 'delete',
  path: '/campaigns/{campaignId}/steps/{stepId}/variants/{variantId}',
  tag: 'Campaigns',
  summary: 'Delete a variant',
  description: 'Deletes a variant no email has used; a used one can only be deactivated (active false). A step keeps at least one variant.',
  access: 'scoped',
  scopes: ['campaigns:write'],
  params: variantParams,
  response: { status: 204, description: 'The variant was deleted.' },
  errors: [409],
  mcp: { toolset: 'campaigns' },
});

export const previewCampaignStep = defineOperation({
  operationId: 'previewCampaignStep',
  method: 'post',
  path: '/campaigns/{campaignId}/steps/{stepId}/preview',
  tag: 'Campaigns',
  summary: 'Render a step for a contact, with its lint result',
  description:
    'Renders the initial email or a follow-up step for a contact (`contact_id`) or a thread (`thread_id`), or for a sample contact when neither is given, and lints the result (§8.7). For AI modes the template is shown as written; the AI text is not generated here. It changes nothing.',
  access: 'scoped',
  scopes: ['campaigns:read'],
  params: stepParams,
  body: {
    schema: z
      .strictObject({
        contact_id: id('contact', 'Render for this contact.').optional(),
        thread_id: id('thread', 'Render for this thread’s contact.').optional(),
        variant_id: id('variant', 'Which variant; defaults to the first active one.').optional(),
      })
      .meta({ id: 'PreviewStep' }),
    example: { contact_id: 'ctc_01jd3x5k8qf7tb9w2m4n6p8r0s' },
  },
  response: {
    status: 200,
    description: 'The rendered email.',
    schema: z
      .object({
        variant_id: id('variant'),
        subject: z.string().nullable().meta({ description: 'The rendered subject; null when it is sent as a reply or failed to render.' }),
        body_text: z.string().nullable().meta({ description: 'The rendered body, with signature and footer; null when it failed to render.' }),
        template_issues: z.array(templateIssueSchema),
        lint: z.array(lintFindingSchema).meta({ description: 'Linter findings (§8.7).' }),
        sendable: z.boolean().meta({ description: 'No template issue or lint blocker.' }),
        note: z.string().nullable().meta({ description: 'For AI modes: what the AI would do with this text.' }),
      })
      .meta({ id: 'StepPreview' }),
    example: { variant_id: variantExample.id, subject: 'Quick question about Globex', body_text: 'Hi Priya,\n\nHow does Globex handle onboarding today?\n\nAlex', template_issues: [], lint: [], sendable: true, note: null },
  },
  mcp: { toolset: 'campaigns' },
});
