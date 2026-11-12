// Writing and sending by hand (spec §13.4 "Threads & messages"): replies a person writes, drafts
// waiting for review, approval, cancelling a scheduled email, linting, and sending the next action
// now. Everything that sends goes through the same checks as the scheduler (§7.2).

import { z } from 'zod';

import { describedEnum, id, paginated, paginationQuery } from '../common.ts';
import { defineOperation } from '../operation.ts';
import { draftExample, lintFindingSchema, messageExample, messageSchema, threadExample, threadSchema } from '../schemas/threads.ts';

const threadParams = z.object({ threadId: id('thread', 'The thread.') });
const messageParams = z.object({ messageId: id('message', 'The email.') });
const sendAt = z.iso.datetime().meta({ description: 'When to send it. Moved into the campaign’s sending window in the contact’s timezone if it falls outside.', examples: ['2026-11-12T15:30:00Z'] });
const bodyText = z.string().trim().min(1).max(5000).meta({ description: 'The plain-text body. Catalyst adds the signature and, where the campaign uses one, the compliance footer, and renders the HTML part.' });

const BLOCKED = 'Returns 422 `send_blocked`, with each reason in `errors[].reason` (suppressed, unsubscribed, bounced, do_not_contact, outside_window, cap_reached, lint_blocker, mailbox_paused, thread_terminal), when a check fails.';

export const createReply = defineOperation({
  operationId: 'createReply',
  method: 'post',
  path: '/threads/{threadId}/replies',
  tag: 'Threads',
  summary: 'Write a reply in a thread (draft, send now, or schedule)',
  description: `Creates a reply to the contact in this thread, threaded with In-Reply-To and References under "Re: " and the thread's subject. \`mode=draft\` stores it for review without sending (see listPendingDrafts, approveDraft). \`send_now\` and \`schedule\` need the \`messages:send\` scope and an Idempotency-Key, count as a person's approval, and still pass suppression, caps, the sending window and the linter. ${BLOCKED} Any AI draft waiting on the thread is superseded.`,
  access: 'scoped',
  scopes: ['threads:write'],
  params: threadParams,
  idempotencyKey: 'optional',
  body: {
    schema: z
      .object({
        body_text: bodyText,
        mode: describedEnum({ draft: 'Save it for review; nothing is sent.', send_now: 'Send it as soon as the mailbox allows.', schedule: 'Send it at `send_at`.' }, { description: 'What to do with it.' }),
        send_at: sendAt.optional().meta({ description: 'Required when `mode` is `schedule`.' }),
      })
      .strict(),
    example: { body_text: 'Hi Priya,\n\nYes to both: SAML SSO and SCIM are on every plan.\n\nAlex', mode: 'draft' },
  },
  response: { status: 201, description: 'The reply.', schema: messageSchema, example: draftExample },
  errors: [404, 409, 422],
  mcp: { toolset: 'threads', openWorld: true },
});

export const listPendingDrafts = defineOperation({
  operationId: 'listPendingDrafts',
  method: 'get',
  path: '/drafts',
  tag: 'Threads',
  summary: 'List drafts and emails waiting for approval',
  description: 'Returns outbound emails in `draft` or `pending_approval`, oldest first, so the longest-waiting are reviewed first. Approve with approveDraft, edit with updateDraft, or reject with rejectDraft.',
  access: 'scoped',
  scopes: ['threads:read'],
  query: z.object({
    ...paginationQuery,
    campaign_id: id('campaign').optional().meta({ description: 'Only drafts in this campaign.' }),
    thread_id: id('thread').optional().meta({ description: 'Only drafts on this thread.' }),
    status: describedEnum({ draft: 'Saved by a person, not yet submitted.', pending_approval: 'Waiting for a person to approve it.' }, { description: 'Only this status.' }).optional().meta({ description: 'Only this status.' }),
  }),
  response: { status: 200, description: 'A page of drafts.', schema: paginated(messageSchema, 'Message'), example: { data: [draftExample], next_cursor: null } },
  mcp: { toolset: 'threads' },
});

export const updateDraft = defineOperation({
  operationId: 'updateDraft',
  method: 'patch',
  path: '/messages/{messageId}',
  tag: 'Threads',
  summary: 'Edit a draft, or an email waiting to send',
  description: 'Changes the text (and, for an email that is not a reply, the subject) of a draft, an email waiting for approval, or a scheduled one that has not started sending. The text replaces the whole body, signature and footer included, and is linted again. 409 once it is sending or sent.',
  access: 'scoped',
  scopes: ['threads:write'],
  params: messageParams,
  ifMatch: true,
  body: {
    schema: z
      .object({
        body_text: z.string().trim().min(1).max(10000).optional().meta({ description: 'The whole new body, including signature and footer.' }),
        subject: z.string().trim().min(1).max(200).optional().meta({ description: 'A new subject. Replies keep "Re: " and the thread’s subject.' }),
      })
      .strict(),
    example: { body_text: 'Hi Priya,\n\nYes to both: SAML SSO and SCIM come with every plan.\n\nAlex' },
  },
  response: { status: 200, description: 'The email.', schema: messageSchema, example: draftExample },
  errors: [404, 409, 412],
  mcp: { toolset: 'threads' },
});

export const approveDraft = defineOperation({
  operationId: 'approveDraft',
  method: 'post',
  path: '/messages/{messageId}/approve',
  tag: 'Threads',
  summary: 'Approve a draft to send',
  description: `Approves a draft or an email waiting for approval and schedules it: now, or at \`send_at\`. A person's approval lets it send even if the thread is no longer active (§7.2 step 5). ${BLOCKED}`,
  access: 'scoped',
  scopes: ['messages:send'],
  params: messageParams,
  idempotencyKey: 'required',
  body: { schema: z.object({ send_at: sendAt.optional() }).strict(), example: {} },
  response: { status: 200, description: 'The scheduled email.', schema: messageSchema, example: { ...draftExample, status: 'scheduled', scheduled_for: '2026-11-10T18:06:00Z', approved_at: '2026-11-10T18:06:00Z' } },
  errors: [404, 409, 422],
  mcp: { toolset: 'threads', openWorld: true },
});

export const rejectDraft = defineOperation({
  operationId: 'rejectDraft',
  method: 'post',
  path: '/messages/{messageId}/reject',
  tag: 'Threads',
  summary: 'Reject a draft',
  description: 'Rejects a draft or an email waiting for approval; it is cancelled and never sent. The reason and any feedback are logged; once the AI agent is connected, feedback is what it redrafts with.',
  access: 'scoped',
  scopes: ['threads:write'],
  params: messageParams,
  body: {
    schema: z
      .object({
        reason: z.string().trim().min(3).max(500).meta({ description: 'Why, in words.' }),
        feedback: z.string().trim().max(2000).optional().meta({ description: 'What a redraft should do differently.' }),
      })
      .strict(),
    example: { reason: 'Too pushy for a first reply', feedback: 'Answer the SSO question first; leave pricing out.' },
  },
  response: { status: 200, description: 'The cancelled email.', schema: messageSchema, example: { ...draftExample, status: 'cancelled', error: 'Rejected: Too pushy for a first reply' } },
  errors: [404, 409],
  mcp: { toolset: 'threads' },
});

export const cancelScheduledMessage = defineOperation({
  operationId: 'cancelScheduledMessage',
  method: 'post',
  path: '/messages/{messageId}/cancel',
  tag: 'Threads',
  summary: 'Cancel an email before it sends',
  description: 'Cancels a scheduled email, or one waiting for approval, before it starts sending. A cancelled follow-up counts as skipped, so the sequence moves on (like skipNextAction). 409 once it is sending or sent.',
  access: 'scoped',
  scopes: ['threads:write'],
  params: messageParams,
  response: { status: 200, description: 'The cancelled email.', schema: messageSchema, example: { ...draftExample, status: 'cancelled' } },
  errors: [404, 409],
  mcp: { toolset: 'threads', destructive: true },
});

export const lintMessage = defineOperation({
  operationId: 'lintMessage',
  method: 'post',
  path: '/messages/lint',
  tag: 'Threads',
  summary: 'Check an email against the content linter',
  description: 'Runs the content linter (§8.7) on a subject and plain-text body: spam phrases, links, length, formatting, and the compliance footer when `compliance_required`. It stores and sends nothing.',
  access: 'scoped',
  scopes: ['threads:read'],
  body: {
    schema: z
      .object({
        subject: z.string().max(200).meta({ description: 'The subject.' }),
        body_text: z.string().min(1).max(10000).meta({ description: 'The whole plain-text body.' }),
        first_touch: z.boolean().default(false).meta({ description: 'Lint it as a first email to the contact, which is held to stricter rules.' }),
        compliance_required: z.boolean().default(false).meta({ description: 'Require an unsubscribe link and the physical address.' }),
      })
      .strict(),
    example: { subject: 'Quick question', body_text: 'Hi Priya,\n\nHow does onboarding work at Globex today?\n\nAlex' },
  },
  response: {
    status: 200,
    description: 'The findings.',
    schema: z.object({ findings: z.array(lintFindingSchema), sendable: z.boolean().meta({ description: 'No blocker.' }) }).meta({ id: 'LintResult' }),
    example: { findings: [{ rule: 'spam_phrase', severity: 'warning', message: '“Act now” reads as marketing.' }], sendable: true },
  },
  mcp: { toolset: 'threads' },
});

export const sendNextActionNow = defineOperation({
  operationId: 'sendNextActionNow',
  method: 'post',
  path: '/threads/{threadId}/next-action/send-now',
  tag: 'Threads',
  summary: 'Send the thread’s next email now',
  description: `Sends the thread's due initial email or follow-up now instead of at its time: composed on the spot if it hasn't been yet, then handed to the sender. It still passes every check and the mailbox's spacing. ${BLOCKED} 409 when the next action is not an email.`,
  access: 'scoped',
  scopes: ['messages:send'],
  params: threadParams,
  idempotencyKey: 'required',
  response: { status: 200, description: 'The thread.', schema: threadSchema, example: threadExample },
  errors: [404, 409, 422],
  mcp: { toolset: 'threads', openWorld: true },
});

export const listUnmatchedMessages = defineOperation({
  operationId: 'listUnmatchedMessages',
  method: 'get',
  path: '/messages/unmatched',
  tag: 'Threads',
  summary: 'List mail from known contacts that matched no thread',
  description: 'Returns inbound emails from known contacts that couldn’t be attached to a thread (§7.4 step 6), newest first: Inbox → Unmatched. Attach each with attachMessageToThread, or drop it with ignoreUnmatchedMessage. Mail from unknown senders is never stored, so it never shows here.',
  access: 'scoped',
  scopes: ['threads:read'],
  query: z.object({ ...paginationQuery, mailbox_id: id('mailbox').optional().meta({ description: 'Only mail that arrived in this mailbox.' }) }),
  response: { status: 200, description: 'A page of emails.', schema: paginated(messageSchema, 'Message'), example: { data: [{ ...messageExample, thread_id: null }], next_cursor: null } },
  mcp: { toolset: 'threads' },
});

export const attachMessageToThread = defineOperation({
  operationId: 'attachMessageToThread',
  method: 'post',
  path: '/messages/{messageId}/attach',
  tag: 'Threads',
  summary: 'Attach an unmatched email to a thread',
  description: 'Files an unmatched inbound email under a thread (`match_method = manual`) and acts on it exactly as if it had matched: a reply moves the thread to Responded and stops its follow-ups, a bounce or unsubscribe takes effect, someone new is added as a participant. Its `unmatched_reply` escalation is resolved.',
  access: 'scoped',
  scopes: ['threads:write'],
  params: messageParams,
  body: { schema: z.object({ thread_id: id('thread', 'The thread it belongs to.') }).strict(), example: { thread_id: threadExample.id } },
  response: { status: 200, description: 'The email, now in the thread.', schema: messageSchema, example: { ...messageExample, match_method: 'manual' } },
  errors: [404, 409],
  mcp: { toolset: 'threads' },
});

export const ignoreUnmatchedMessage = defineOperation({
  operationId: 'ignoreUnmatchedMessage',
  method: 'post',
  path: '/messages/{messageId}/ignore',
  tag: 'Threads',
  summary: 'Ignore an unmatched email',
  description: 'Takes an unmatched inbound email off the Unmatched list without filing it, and dismisses its `unmatched_reply` escalation. The email is kept.',
  access: 'scoped',
  scopes: ['threads:write'],
  params: messageParams,
  response: { status: 200, description: 'The email.', schema: messageSchema, example: { ...messageExample, thread_id: null } },
  errors: [404, 409],
  mcp: { toolset: 'threads' },
});

export const generateAiDraft = defineOperation({
  operationId: 'generateAiDraft',
  method: 'post',
  path: '/threads/{threadId}/ai-draft',
  tag: 'Threads',
  summary: 'Have the agent draft a reply',
  description: 'The agent drafts a reply to the thread now, following the current goal’s playbook and your optional `guidance`. The draft passes the guardrails (§10.9) and waits for approval; it never sends on its own. Use createReply to write it yourself. 503 `ai_unavailable` when the agent is off or fails.',
  access: 'scoped',
  scopes: ['threads:write'],
  params: threadParams,
  body: { schema: z.object({ guidance: z.string().trim().max(2000).optional().meta({ description: 'What the reply should do, e.g. "offer Thursday or Friday".' }) }).strict(), example: { guidance: 'Offer Thursday or Friday afternoon for the call.' } },
  response: { status: 201, description: 'The draft.', schema: messageSchema, example: { ...draftExample, author: 'ai', status: 'pending_approval' } },
  errors: [404, 409, 503],
  mcp: { toolset: 'threads' },
});
