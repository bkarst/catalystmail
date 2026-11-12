// Escalations (spec §11, §13.4 "Escalations & knowledge"): the "Needs you" queue and how each item
// is settled. answerEscalation needs the AI agent and the knowledge base, and is not here yet.

import { z } from 'zod';

import { describedEnum, id, paginated, paginationQuery } from '../common.ts';
import { defineOperation } from '../operation.ts';
import { escalationExample, escalationPrioritySchema, escalationReasonSchema, escalationSchema } from '../schemas/escalations.ts';
import { draftExample, messageSchema } from '../schemas/threads.ts';

const escalationParams = z.object({ escalationId: id('escalation', 'The escalation.') });
const note = z.string().trim().max(1000).meta({ description: 'A note for the record.' });

export const listEscalations = defineOperation({
  operationId: 'listEscalations',
  method: 'get',
  path: '/escalations',
  tag: 'Escalations',
  summary: 'List escalations ("Needs you")',
  description: 'Returns escalations, most urgent first, then soonest due. By default only those waiting for a person (`open`); pass `status` for snoozed, resolved or dismissed ones.',
  access: 'scoped',
  scopes: ['escalations:read'],
  query: z.object({
    ...paginationQuery,
    status: describedEnum({ open: 'Waiting for a person (the default).', snoozed: 'Snoozed.', resolved: 'Settled.', dismissed: 'Dismissed.', all: 'Every status.' }, { description: 'Which status.' })
      .default('open')
      .meta({ description: 'Which status.' }),
    priority: escalationPrioritySchema.optional().meta({ description: 'Only this priority.' }),
    reason: escalationReasonSchema.optional().meta({ description: 'Only this reason.' }),
    thread_id: id('thread').optional().meta({ description: 'Only escalations on this thread.' }),
    campaign_id: id('campaign').optional().meta({ description: 'Only escalations in this campaign.' }),
    assigned_user_id: id('user').optional().meta({ description: 'Only those assigned to this person.' }),
    overdue: z.enum(['true', 'false']).optional().meta({ description: 'true: only those past their SLA; false: only those within it.', 'x-enum-descriptions': { true: 'Only overdue ones.', false: 'Only ones still within their SLA.' } }),
  }),
  response: { status: 200, description: 'A page of escalations.', schema: paginated(escalationSchema, 'Escalation'), example: { data: [escalationExample], next_cursor: null } },
  mcp: { toolset: 'escalations' },
});

export const getEscalation = defineOperation({
  operationId: 'getEscalation',
  method: 'get',
  path: '/escalations/{escalationId}',
  tag: 'Escalations',
  summary: 'Get one escalation',
  description: 'Returns an escalation: why it was raised, by when it is due, and how it was settled. getThreadContext has the conversation around it.',
  access: 'scoped',
  scopes: ['escalations:read'],
  params: escalationParams,
  response: { status: 200, description: 'The escalation.', schema: escalationSchema, example: escalationExample },
  mcp: { toolset: 'escalations' },
});

export const resolveEscalation = defineOperation({
  operationId: 'resolveEscalation',
  method: 'post',
  path: '/escalations/{escalationId}/resolve',
  tag: 'Escalations',
  summary: 'Mark an escalation resolved',
  description:
    'Settles an open or snoozed escalation and records how (§11.3). `took_over` also pauses the agent on the thread (ai_paused). `goal_confirmed` on a goal confirmation records its goal (`goal_id`) as reached, confirmed by you; `goal_rejected` leaves it unreached. The other resolutions record what was done elsewhere: createReply, markGoalAchieved, closeThread. Once no escalation is open, the thread resumes automation.',
  access: 'scoped',
  scopes: ['escalations:write'],
  params: escalationParams,
  body: {
    schema: z
      .object({
        resolution: describedEnum(
          {
            replied: 'A person replied.',
            answered_for_ai: 'A person gave the agent the missing answer.',
            goal_confirmed: 'The goal was confirmed.',
            goal_rejected: 'The goal was declined.',
            took_over: 'A person takes the thread over; the agent stands back.',
            closed_thread: 'The thread was closed.',
          },
          { description: 'How it was settled.' },
        ),
        note: note.optional(),
      })
      .strict(),
    example: { resolution: 'replied', note: 'Answered the SSO question myself.' },
  },
  response: { status: 200, description: 'The escalation.', schema: escalationSchema, example: { ...escalationExample, status: 'resolved', resolution: 'replied', resolution_note: 'Answered the SSO question myself.', resolved_at: '2026-11-10T18:10:00Z' } },
  errors: [404, 409],
  mcp: { toolset: 'escalations' },
});

export const snoozeEscalation = defineOperation({
  operationId: 'snoozeEscalation',
  method: 'post',
  path: '/escalations/{escalationId}/snooze',
  tag: 'Escalations',
  summary: 'Snooze an escalation',
  description: 'Hides an open escalation until `until` (at most 30 days ahead). Its SLA is paused: the due time moves by as long as it sleeps. The thread stays held meanwhile.',
  access: 'scoped',
  scopes: ['escalations:write'],
  params: escalationParams,
  body: {
    schema: z.object({ until: z.iso.datetime().meta({ description: 'When it comes back.', examples: ['2026-11-12T09:00:00Z'] }), note: note.optional() }).strict(),
    example: { until: '2026-11-12T09:00:00Z' },
  },
  response: { status: 200, description: 'The escalation.', schema: escalationSchema, example: { ...escalationExample, status: 'snoozed', snoozed_until: '2026-11-12T09:00:00Z' } },
  errors: [404, 409],
  mcp: { toolset: 'escalations' },
});

export const assignEscalation = defineOperation({
  operationId: 'assignEscalation',
  method: 'post',
  path: '/escalations/{escalationId}/assign',
  tag: 'Escalations',
  summary: 'Assign an escalation to a person',
  description: 'Gives the escalation to someone in the workspace, or back to the workspace owners with `user_id: null`.',
  access: 'scoped',
  scopes: ['escalations:write'],
  params: escalationParams,
  body: { schema: z.object({ user_id: id('user', 'Who handles it; null for the workspace owners.').nullable() }).strict(), example: { user_id: 'usr_01jd3x5k8qf7tb9w2m4n6p8r0s' } },
  response: { status: 200, description: 'The escalation.', schema: escalationSchema, example: { ...escalationExample, assigned_user_id: 'usr_01jd3x5k8qf7tb9w2m4n6p8r0s' } },
  errors: [404, 409],
  mcp: { toolset: 'escalations' },
});

export const dismissEscalation = defineOperation({
  operationId: 'dismissEscalation',
  method: 'post',
  path: '/escalations/{escalationId}/dismiss',
  tag: 'Escalations',
  summary: 'Dismiss an escalation',
  description: 'Closes an open or snoozed escalation without action, with a reason. Once no escalation is open, the thread resumes automation.',
  access: 'scoped',
  scopes: ['escalations:write'],
  params: escalationParams,
  body: { schema: z.object({ reason: z.string().trim().min(3).max(500).meta({ description: 'Why no action is needed.' }) }).strict(), example: { reason: 'Out-of-office, nothing to do' } },
  response: { status: 200, description: 'The escalation.', schema: escalationSchema, example: { ...escalationExample, status: 'dismissed', resolution: 'dismissed', resolution_note: 'Out-of-office, nothing to do', resolved_at: '2026-11-10T18:10:00Z' } },
  errors: [404, 409],
  mcp: { toolset: 'escalations' },
});

export const answerEscalation = defineOperation({
  operationId: 'answerEscalation',
  method: 'post',
  path: '/escalations/{escalationId}/answer',
  tag: 'Escalations',
  summary: 'Answer for the agent, and get a new draft',
  description:
    '"Answer for the agent" (§11.3): give the missing knowledge in plain language. The agent drafts the reply again with it, and the draft waits for your approval. With `save_to_knowledge` (on by default) the answer becomes a knowledge item, so the agent won’t ask again. The escalation is resolved (`answered_for_ai`). 503 `ai_unavailable` when the agent is off or fails; nothing changes then.',
  access: 'scoped',
  scopes: ['escalations:write'],
  params: escalationParams,
  body: {
    schema: z
      .object({
        answer: z.string().trim().min(1).max(5000).meta({ description: 'The answer, in plain language.' }),
        save_to_knowledge: z.boolean().default(true).meta({ description: 'Keep it as a knowledge item.' }),
        knowledge_scope: describedEnum({ campaign: 'Only this campaign.', workspace: 'Every campaign.' }, { description: 'Where the knowledge item applies.' }).default('campaign'),
      })
      .strict(),
    example: { answer: 'We are HIPAA-ready and sign BAAs on the Enterprise plan.', knowledge_scope: 'workspace' },
  },
  response: {
    status: 200,
    description: 'The resolved escalation and the new draft.',
    schema: z
      .object({ escalation: escalationSchema, draft: messageSchema, knowledge_item_id: id('knowledge_item', 'The item the answer was saved as.').nullable() })
      .meta({ id: 'EscalationAnswered' }),
    example: { escalation: { ...escalationExample, status: 'resolved', resolution: 'answered_for_ai', resolved_at: '2026-11-10T18:10:00Z' }, draft: { ...draftExample, author: 'ai', status: 'pending_approval' }, knowledge_item_id: 'kbi_01jd3x5k8qf7tb9w2m4n6p8r0s' },
  },
  errors: [404, 409, 503],
  mcp: { toolset: 'escalations' },
});
