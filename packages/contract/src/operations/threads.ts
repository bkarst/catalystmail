// Thread operations (spec §13.4 "Threads & messages") that need no send path. Replies, drafts and
// sending arrive with the transport.

import { z } from 'zod';

import { describedEnum, id, paginated, paginationQuery, timestamp } from '../common.ts';
import { defineOperation } from '../operation.ts';
import { activityExample, activitySchema } from '../schemas/platform.ts';
import { messageExample, messageSchema, openStatusSchema, threadExample, threadSchema, threadStageSchema, threadStateSchema } from '../schemas/threads.ts';

const threadId = id('thread', 'The thread.');
const threadParams = z.object({ threadId });
const reason = z.string().min(3).max(500).meta({ description: 'Why, in words. Logged with the change.', examples: ['They booked by phone'] });

const threadSort = describedEnum(
  {
    '-last_message_at': 'Most recent email first (default).',
    '-temperature': 'Hottest first, then most recent email.',
    '-updated_at': 'Most recently changed first.',
    '-created_at': 'Most recently enrolled first.',
  },
  { description: 'Sort order.' },
);

export const listThreads = defineOperation({
  operationId: 'listThreads',
  method: 'get',
  path: '/threads',
  tag: 'Threads',
  summary: 'List and filter threads (the Inbox)',
  description:
    'Returns conversations with their stage, state, next action, open status and latest classification. Filter by campaign, stage, state, opens, intent, temperature and more; `needs_attention` gives threads waiting on a person. Sort by `-temperature` for the Hot view.',
  access: 'scoped',
  scopes: ['threads:read'],
  query: z.object({
    ...paginationQuery,
    campaign_id: id('campaign').optional().meta({ description: 'Only threads in this campaign.' }),
    contact_id: id('contact').optional().meta({ description: 'Only threads with this contact.' }),
    mailbox_id: id('mailbox').optional().meta({ description: 'Only threads on this mailbox.' }),
    stage: threadStageSchema.optional().meta({ description: 'Only threads at this stage.' }),
    min_stage_rank: z.coerce.number().int().min(0).max(20).optional().meta({ description: 'Only threads at this stage rank or later (3 = Responded).' }),
    goal_id: id('goal').optional().meta({ description: 'Only threads that reached this goal.' }),
    state: threadStateSchema.optional().meta({ description: 'Only threads in this state.' }),
    open_status: openStatusSchema.optional().meta({ description: 'Only threads with this open status.' }),
    intent: z.string().max(40).optional().meta({ description: 'Only threads whose latest intent is this, e.g. question.' }),
    min_temperature: z.coerce.number().min(0).max(3).optional().meta({ description: 'Only threads at least this hot: 2 = evaluating (the Hot view).' }),
    assigned_to: id('user').optional().meta({ description: 'Only threads assigned to this user.' }),
    needs_attention: z.enum(['true', 'false']).optional().meta({ description: 'true: only threads waiting on a person (needs_human or pending_approval).', 'x-enum-descriptions': { true: 'Only threads waiting on a person.', false: 'Only threads not waiting on a person.' } }),
    q: z.string().max(200).optional().meta({ description: 'Text matched against the contact’s name and email and the subject.' }),
    updated_after: timestamp('A time in UTC.').optional().meta({ description: 'Only threads changed after this time.' }),
    sort: threadSort.optional().meta({ description: 'Sort order. Defaults to most recent email first.' }),
  }),
  response: { status: 200, description: 'A page of threads.', schema: paginated(threadSchema, 'Thread'), example: { data: [threadExample], next_cursor: null } },
  mcp: { toolset: 'threads' },
});

export const getThread = defineOperation({
  operationId: 'getThread',
  method: 'get',
  path: '/threads/{threadId}',
  tag: 'Threads',
  summary: 'Get one thread',
  description: 'Returns a thread’s stage, state, next action, follow-up progress, opens and latest classification. For an LLM-ready summary of everything use getThreadContext.',
  access: 'scoped',
  scopes: ['threads:read'],
  params: threadParams,
  response: { status: 200, description: 'The thread.', schema: threadSchema, example: threadExample },
  mcp: { toolset: 'threads' },
});

export const updateThread = defineOperation({
  operationId: 'updateThread',
  method: 'patch',
  path: '/threads/{threadId}',
  tag: 'Threads',
  summary: 'Assign a thread, or take it over from the agent',
  description: 'Sets who handles the thread, and whether the agent is paused on it (`ai_paused`: you took over, so the agent writes nothing). Both are logged on the timeline.',
  access: 'scoped',
  scopes: ['threads:write'],
  params: threadParams,
  ifMatch: true,
  body: {
    schema: z
      .strictObject({
        assigned_user_id: id('user', 'Who handles it; null clears it.').nullable(),
        ai_paused: z.boolean().meta({ description: 'true: you take over and the agent stops writing on this thread.' }),
      })
      .partial()
      .meta({ id: 'UpdateThread' }),
    example: { ai_paused: true },
  },
  response: { status: 200, description: 'The thread.', schema: threadSchema, example: threadExample },
  mcp: { toolset: 'threads' },
});

export const getThreadContext = defineOperation({
  operationId: 'getThreadContext',
  method: 'get',
  path: '/threads/{threadId}/context',
  tag: 'Threads',
  summary: 'Get an LLM-ready bundle of everything about a thread',
  description:
    'Returns one markdown document with the contact card, campaign objective, goals (current one marked) and its playbook, the transcript with quotes stripped, open status, open escalations and the latest classification, plus the allowed links, shareable knowledge items and sending constraints (§14.5). Use it before drafting or deciding anything about a thread.',
  access: 'scoped',
  scopes: ['threads:read'],
  params: threadParams,
  response: {
    status: 200,
    description: 'The bundle.',
    schema: z
      .object({
        thread_id: id('thread'),
        markdown: z.string().meta({ description: 'The whole context as markdown.' }),
        allowed_links: z.record(z.string(), z.string()).meta({ description: 'The only links a reply may use, by key.' }),
        kb_items: z.array(z.object({ id: z.string(), title: z.string(), content: z.string() })).meta({ description: 'Shareable knowledge for this campaign.' }),
        constraints: z.record(z.string(), z.unknown()).meta({ description: 'Autonomy, sending window, reply delay and AI reply limit.' }),
      })
      .meta({ id: 'ThreadContext' }),
    example: { thread_id: threadExample.id, markdown: '# Priya Natarajan (Globex)\n…', allowed_links: { booking: 'https://cal.com/acme/intro' }, kb_items: [], constraints: { autonomy: 'assisted' } },
  },
  mcp: { toolset: 'threads' },
});

export const listThreadMessages = defineOperation({
  operationId: 'listThreadMessages',
  method: 'get',
  path: '/threads/{threadId}/messages',
  tag: 'Threads',
  summary: 'List the emails in a thread',
  description: 'Returns the thread’s emails in order, oldest first, with their status, author and opens.',
  access: 'scoped',
  scopes: ['threads:read'],
  params: threadParams,
  query: z.object(paginationQuery),
  response: { status: 200, description: 'A page of messages.', schema: paginated(messageSchema, 'Message'), example: { data: [messageExample], next_cursor: null } },
  mcp: { toolset: 'threads' },
});

export const listThreadActivity = defineOperation({
  operationId: 'listThreadActivity',
  method: 'get',
  path: '/threads/{threadId}/activity',
  tag: 'Threads',
  summary: 'List what happened on a thread',
  description: 'Returns the thread’s activity, newest first: stage and state changes, goals, escalations, follow-ups, pauses and closes.',
  access: 'scoped',
  scopes: ['threads:read'],
  params: threadParams,
  query: z.object(paginationQuery),
  response: { status: 200, description: 'A page of activity.', schema: paginated(activitySchema, 'Activity'), example: { data: [{ ...activityExample, type: 'thread.stage_changed', data: { from: 'received', to: 'responded' } }], next_cursor: null } },
  mcp: { toolset: 'threads' },
});

export const classificationSchema = z
  .object({
    id: id('ai_run'),
    trigger_message_id: z.string().nullable(),
    provider: z.string().meta({ description: '`typesafe` for Jev; `anthropic` for Claude’s analysis, which classifies on its own while Jev is unavailable.' }),
    model: z.string(),
    classifier_version: z.string(),
    status: z.string(),
    output: z.record(z.string(), z.unknown()).nullable().meta({ description: 'The answers with their probabilities.' }),
    created_at: timestamp('When it ran.'),
  })
  .meta({ id: 'Classification' });

export const listThreadClassifications = defineOperation({
  operationId: 'listThreadClassifications',
  method: 'get',
  path: '/threads/{threadId}/classifications',
  tag: 'Threads',
  summary: 'List every classification of a thread, newest first',
  description: 'Returns each classification of the conversation (§10.4) with its answers and probabilities, model version, and the message that triggered it. While Jev is not connected, Claude’s analyses are the classifications (`provider = anthropic`).',
  access: 'scoped',
  scopes: ['threads:read'],
  params: threadParams,
  query: z.object(paginationQuery),
  response: {
    status: 200,
    description: 'A page of classifications.',
    schema: paginated(classificationSchema, 'Classification'),
    example: { data: [], next_cursor: null },
  },
  mcp: { toolset: 'threads' },
});

const goalParams = z.object({ threadId, goalId: id('goal', 'The goal.') });

export const markGoalAchieved = defineOperation({
  operationId: 'markGoalAchieved',
  method: 'post',
  path: '/threads/{threadId}/goals/{goalId}/achieve',
  tag: 'Threads',
  summary: 'Mark a goal achieved on a thread',
  description:
    'Records the goal as achieved by hand, with every earlier goal implied (§5.2). The stage moves up, the contact’s lifecycle stage follows the goal, and the final goal completes the thread. Use `event_at` for a call’s start time so follow-ups can count from it.',
  access: 'scoped',
  scopes: ['threads:write'],
  params: goalParams,
  idempotencyKey: 'optional',
  body: {
    schema: z
      .strictObject({
        note: z.string().max(1000).optional().meta({ description: 'The evidence, e.g. "Booked by phone".' }),
        event_at: timestamp('When the goal’s event happens, such as the booked call’s start.').optional(),
      })
      .meta({ id: 'MarkGoalAchieved' }),
    example: { note: 'Booked by phone for Thursday', event_at: '2026-11-19T22:00:00Z' },
  },
  response: { status: 200, description: 'The thread.', schema: threadSchema, example: threadExample },
  errors: [409],
  mcp: { toolset: 'threads' },
});

export const revokeGoalAchievement = defineOperation({
  operationId: 'revokeGoalAchievement',
  method: 'delete',
  path: '/threads/{threadId}/goals/{goalId}/achieve',
  tag: 'Threads',
  summary: 'Revoke a goal achievement that was wrong',
  description: 'Revokes the achievement, and the earlier goals it implied unless they were reached on their own. The stage drops to the highest remaining fact. Logged with the reason.',
  access: 'scoped',
  scopes: ['threads:write'],
  params: goalParams,
  query: z.object({ reason: z.string().min(3).max(500).meta({ description: 'Why it was wrong.', examples: ['The reply was about another product'] }) }),
  response: { status: 200, description: 'The thread.', schema: threadSchema, example: threadExample },
  errors: [409],
  mcp: { toolset: 'threads', destructive: false },
});

export const setThreadStageFloor = defineOperation({
  operationId: 'setThreadStageFloor',
  method: 'post',
  path: '/threads/{threadId}/stage-floor',
  tag: 'Threads',
  summary: 'Move a thread forward without email evidence',
  description:
    'Sets the lowest stage the thread can show, for progress Catalyst can’t see (the contact replied by phone). It never lowers the stage; to correct a goal, revoke it. Needs a reason and is audited.',
  access: 'scoped',
  scopes: ['threads:write'],
  params: threadParams,
  body: {
    schema: z
      .strictObject({
        stage: describedEnum({ queued: 'No floor.', sent: 'At least Sent.', received: 'At least Received.', responded: 'At least Responded.' }, { description: 'The floor. Goals are marked with markGoalAchieved.' }),
        reason,
      })
      .meta({ id: 'SetStageFloor' }),
    example: { stage: 'responded', reason: 'They called back' },
  },
  response: { status: 200, description: 'The thread.', schema: threadSchema, example: threadExample },
  errors: [409],
  mcp: { toolset: 'threads' },
});

const threadAction = <const Id extends string, const P extends string>(operationId: Id, path: P, summary: string, description: string, destructive = false) =>
  defineOperation({
    operationId,
    method: 'post',
    path,
    tag: 'Threads',
    summary,
    description,
    access: 'scoped',
    scopes: ['threads:write'],
    params: threadParams,
    response: { status: 200, description: 'The thread.', schema: threadSchema, example: threadExample },
    errors: [409],
    mcp: { toolset: 'threads', ...(destructive && { destructive: true }) },
  });

export const pauseThread = threadAction('pauseThread', '/threads/{threadId}/pause', 'Pause a thread', 'Holds all automation on the thread: nothing is sent and no follow-up runs. Replies are still received. Undo with resumeThread.');
export const resumeThread = threadAction('resumeThread', '/threads/{threadId}/resume', 'Resume a paused thread', 'Lets automation carry on. The next follow-up is timed from now, so missed steps never go out in a burst.');
export const stopFollowUps = threadAction('stopFollowUps', '/threads/{threadId}/follow-ups/stop', 'Stop follow-ups on a thread', 'No more follow-ups are sent on this thread; replies are still handled. Undo with resumeFollowUps.');
export const resumeFollowUps = threadAction('resumeFollowUps', '/threads/{threadId}/follow-ups/resume', 'Resume follow-ups on a thread', 'Restarts the current stage’s sequence at the next unsent step, timed from now.');
export const skipNextAction = threadAction('skipNextAction', '/threads/{threadId}/next-action/skip', 'Skip the next follow-up', 'Skips the follow-up step that is due next; the sequence moves on to the following step, or to its finish rule. Only for a follow-up.');

export const scheduleCheckIn = defineOperation({
  operationId: 'scheduleCheckIn',
  method: 'post',
  path: '/threads/{threadId}/check-in',
  tag: 'Threads',
  summary: 'Check in with the contact on a date they asked for',
  description:
    'For a "not now, try in March" reply (§5.10 rule 5): the stage’s follow-up sequence is replaced by one check-in the AI agent writes on that date (the start of the day in the contact’s timezone, then fitted to the sending window). A reply from the contact before then cancels it; if they don’t answer the check-in, the stage’s sequence restarts at step 1. A follow-up already written for the thread is cancelled. Setting it again moves it. Undo with cancelCheckIn.',
  access: 'scoped',
  scopes: ['threads:write'],
  params: threadParams,
  body: {
    schema: z.object({ date: z.iso.date().meta({ description: 'The day to check in, `YYYY-MM-DD` in the contact’s timezone: after today, and at most a year ahead.', examples: ['2027-03-02'] }) }).strict(),
    example: { date: '2027-03-02' },
  },
  response: { status: 200, description: 'The thread.', schema: threadSchema, example: threadExample },
  errors: [409],
  mcp: { toolset: 'threads' },
});

export const cancelCheckIn = defineOperation({
  operationId: 'cancelCheckIn',
  method: 'delete',
  path: '/threads/{threadId}/check-in',
  tag: 'Threads',
  summary: 'Cancel a check-in',
  description: 'Removes the thread’s check-in. The stage’s follow-up sequence takes over again, timed from now, so missed steps never go out in a burst.',
  access: 'scoped',
  scopes: ['threads:write'],
  params: threadParams,
  response: { status: 200, description: 'The thread.', schema: threadSchema, example: threadExample },
  errors: [409],
  mcp: { toolset: 'threads' },
});

export const closeThread = defineOperation({
  operationId: 'closeThread',
  method: 'post',
  path: '/threads/{threadId}/close',
  tag: 'Threads',
  summary: 'Close a thread as lost, or unsubscribe the contact',
  description:
    'Closes the conversation: nothing more is sent, and a later reply reopens it for a person to decide (§5.4). With `unsubscribe` true the contact is also unsubscribed everywhere and suppressed, which stops all their threads.',
  access: 'scoped',
  scopes: ['threads:write'],
  params: threadParams,
  body: {
    schema: z
      .strictObject({
        reason: describedEnum(
          { not_interested: 'They declined.', wrong_person: 'Not the right person.', went_quiet: 'They stopped replying.', manual: 'Any other reason.' },
          { description: 'Why it is closed.' },
        ),
        note: z.string().max(1000).optional().meta({ description: 'More detail, for the timeline.' }),
        unsubscribe: z.boolean().optional().meta({ description: 'Also unsubscribe and suppress the contact everywhere.' }),
      })
      .meta({ id: 'CloseThread' }),
    example: { reason: 'not_interested', note: 'Using a competitor' },
  },
  response: { status: 200, description: 'The thread.', schema: threadSchema, example: { ...threadExample, state: 'closed_lost' } },
  errors: [409],
  mcp: { toolset: 'threads', destructive: true },
});

export const rescheduleNextAction = defineOperation({
  operationId: 'rescheduleNextAction',
  method: 'patch',
  path: '/threads/{threadId}/next-action',
  tag: 'Threads',
  summary: 'Postpone the next email on a thread',
  description: 'Moves the next initial email or follow-up to a later time; it is still fitted into the sending window. To send sooner, use sendNextActionNow.',
  access: 'scoped',
  scopes: ['threads:write'],
  params: threadParams,
  body: { schema: z.strictObject({ at: timestamp('The new time, later than now and than the current due time.') }).meta({ id: 'RescheduleNextAction' }), example: { at: '2026-11-17T16:00:00Z' } },
  response: { status: 200, description: 'The thread.', schema: threadSchema, example: threadExample },
  errors: [409],
  mcp: { toolset: 'threads' },
});

export const getMessage = defineOperation({
  operationId: 'getMessage',
  method: 'get',
  path: '/messages/{messageId}',
  tag: 'Threads',
  summary: 'Get one email',
  description: 'Returns an email with its status, author, text and opens.',
  access: 'scoped',
  scopes: ['threads:read'],
  params: z.object({ messageId: id('message', 'The email.') }),
  response: { status: 200, description: 'The message.', schema: messageSchema, example: messageExample },
  mcp: { toolset: 'threads' },
});

export const getMessageRaw = defineOperation({
  operationId: 'getMessageRaw',
  method: 'get',
  path: '/messages/{messageId}/raw',
  tag: 'Threads',
  summary: 'Download an email as it was sent or received',
  description: 'The exact MIME source (`message/rfc822`) Catalyst kept: what went over SMTP, or what arrived over IMAP. 404 when no copy was kept (drafts, emails never sent).',
  access: 'scoped',
  scopes: ['threads:read'],
  params: z.object({ messageId: id('message', 'The email.') }),
  response: { status: 200, description: 'The raw email.', mediaType: 'message/rfc822' },
  mcp: false,
});

export const listActivities = defineOperation({
  operationId: 'listActivities',
  method: 'get',
  path: '/activities',
  tag: 'Threads',
  summary: 'List activity across the workspace',
  description: 'Returns the event log, newest first: the dashboard’s recent activity and the Deliverability Events tab. Narrow it by thread, contact, campaign or a type prefix such as `domain.`.',
  access: 'scoped',
  scopes: ['threads:read'],
  query: z.object({
    ...paginationQuery,
    thread_id: id('thread').optional().meta({ description: 'Only this thread’s activity.' }),
    contact_id: id('contact').optional().meta({ description: 'Only this contact’s activity.' }),
    campaign_id: id('campaign').optional().meta({ description: 'Only this campaign’s activity.' }),
    type: z.string().regex(/^[a-z_.]{1,60}$/).optional().meta({ description: 'A type, or a prefix ending in a dot: `domain.` for every domain event.', examples: ['thread.stage_changed'] }),
  }),
  response: { status: 200, description: 'A page of activity.', schema: paginated(activitySchema, 'Activity'), example: { data: [activityExample], next_cursor: null } },
  mcp: { toolset: 'threads' },
});

export const reclassifyThread = defineOperation({
  operationId: 'reclassifyThread',
  method: 'post',
  path: '/threads/{threadId}/classify',
  tag: 'Threads',
  summary: 'Classify the conversation again now',
  description: '"Reclassify" (§10.4): reads the conversation again and stores the new classification on the thread (intent, sentiment, summary). Actions already taken are not run again. While Jev is not connected, Claude classifies. 409 when the contact has never replied; 503 `ai_unavailable` when the agent is off or fails.',
  access: 'scoped',
  scopes: ['threads:write'],
  params: threadParams,
  response: { status: 200, description: 'The new classification.', schema: classificationSchema, example: { id: 'air_01jd3x5k8qf7tb9w2m4n6p8r0s', trigger_message_id: 'msg_01jd3x5k8qf7tb9w2m4n6p8r0s', provider: 'anthropic', model: 'claude-opus-5-5', classifier_version: 'analyze_inbound.v1', status: 'ok', output: { intent: 'question', confidence: 0.9 }, created_at: '2026-11-10T18:00:00Z' } },
  errors: [404, 409, 503],
  mcp: { toolset: 'threads' },
});
