// Meta operations (spec §13.4).

import { z } from 'zod';

import { describedEnum, id, scopeSchema } from '../common.ts';
import { defineOperation } from '../operation.ts';

export const userRoleSchema = describedEnum(
  {
    owner: 'Everything, including API keys and deleting the workspace.',
    admin: 'Settings, mailboxes, domains and keys.',
    member: 'Campaigns, contacts, threads and escalations.',
    viewer: 'Read-only.',
  },
  { id: 'UserRole', description: 'Role of a signed-in user (§16).' },
);

export const principalSchema = z
  .object({
    kind: describedEnum(
      { user: 'A signed-in person.', api_key: 'An API key, typically an agent harness.' },
      { description: 'What kind of caller this is.' },
    ),
    id: z.string().meta({ description: 'The user ID (`usr_…`) or API key ID (`key_…`).', examples: ['key_01jd3x5k8qf7tb9w2m4n6p8r0s'] }),
    name: z.string().meta({ description: "The user's name or the key's label.", examples: ['Claude Code (draft only)'] }),
    role: userRoleSchema.nullable().meta({ description: 'Role of the user; null for an API key.' }),
    scopes: z.array(scopeSchema).meta({ description: 'What this caller may do. For a user, the scopes its role grants.' }),
    workspace: z.object({ id: id('workspace'), name: z.string().meta({ description: 'Workspace name.', examples: ['Acme'] }) }),
    two_factor_required: z.boolean().meta({ description: 'An owner of a workspace that requires two-factor sign-in, who hasn’t set it up: every other operation answers 403 `two_factor_required` until they do (§16).' }),
  })
  .meta({ id: 'Principal', description: 'Who is calling, and what they may do.' });

export const getCurrentPrincipal = defineOperation({
  operationId: 'getCurrentPrincipal',
  method: 'get',
  path: '/me',
  tag: 'Meta',
  summary: 'Show who is calling and what they may do',
  description:
    'Returns the user or API key behind this request, its scopes and its workspace. Call it first to learn which operations are available to you. It has no side effects.',
  access: 'authenticated',
  scopes: [],
  response: {
    status: 200,
    description: 'The current principal.',
    schema: principalSchema,
    example: {
      kind: 'api_key',
      id: 'key_01jd3x5k8qf7tb9w2m4n6p8r0s',
      name: 'Claude Code (draft only)',
      role: null,
      scopes: ['contacts:read', 'contacts:write', 'threads:read', 'threads:write'],
      workspace: { id: 'wsp_01jd3x5k8qf7tb9w2m4n6p8r0s', name: 'Acme' },
      two_factor_required: false,
    },
  },
  mcp: { toolset: 'admin' },
});

export const getOpenApiDocument = defineOperation({
  operationId: 'getOpenApiDocument',
  method: 'get',
  path: '/openapi.json',
  tag: 'Meta',
  summary: 'Get the OpenAPI 3.1 document for this API',
  description:
    'Returns the contract every operation is generated from. It is public, so clients and agent harnesses can discover the API before authenticating.',
  access: 'public',
  scopes: [],
  response: {
    status: 200,
    description: 'The OpenAPI 3.1 document.',
    schema: z.record(z.string(), z.unknown()).meta({ description: 'An OpenAPI 3.1 document.' }),
    example: { openapi: '3.1.0', info: { title: 'Catalyst API', version: '1.0.0' }, paths: {} },
  },
  mcp: false,
});

export const searchResultSchema = z
  .object({
    kind: describedEnum(
      { contact: 'A contact.', company: 'A company.', thread: 'A conversation.', campaign: 'A campaign.' },
      { description: 'What the result is.' },
    ),
    id: z.string().meta({ description: 'Its ID.', examples: ['ctc_01jd3x5k8qf7tb9w2m4n6p8r0s'] }),
    title: z.string().meta({ description: 'The main line to show.', examples: ['Priya Natarajan'] }),
    subtitle: z.string().nullable().meta({ description: 'A second line with context.', examples: ['VP Operations · priya@globex.com'] }),
  })
  .meta({ id: 'SearchResult' });

export const searchAll = defineOperation({
  operationId: 'searchAll',
  method: 'get',
  path: '/search',
  tag: 'Meta',
  summary: 'Search contacts, companies, threads and campaigns at once',
  description:
    'The ⌘K search: matches names, emails, company domains, thread subjects and snippets, and campaign names, best matches first. Threads appear only for callers with `threads:read`, campaigns only with `campaigns:read`. Use the typed list operations for anything more precise.',
  access: 'scoped',
  scopes: ['contacts:read'],
  query: z.object({
    q: z.string().min(1).max(200).meta({ description: 'What to search for.', examples: ['globex'] }),
    limit: z.coerce.number().int().min(1).max(50).default(20).meta({ description: 'Most results to return, 1 to 50.', examples: [20] }),
  }),
  response: {
    status: 200,
    description: 'The best matches.',
    schema: z.object({ data: z.array(searchResultSchema).meta({ description: 'Results, best first.' }) }).meta({ id: 'SearchResults' }),
    example: {
      data: [
        { kind: 'company', id: 'co_01jd3x5k8qf7tb9w2m4n6p8r0s', title: 'Globex', subtitle: 'globex.com' },
        { kind: 'contact', id: 'ctc_01jd3x5k8qf7tb9w2m4n6p8r0s', title: 'Priya Natarajan', subtitle: 'VP Operations · priya@globex.com' },
      ],
    },
  },
  mcp: { toolset: 'contacts' },
});

export const workItemSchema = z
  .object({
    kind: describedEnum(
      {
        escalation: 'An open escalation (§11).',
        draft: 'An email waiting for approval, or a person’s saved draft.',
        unmatched_reply: 'Mail from a known contact that matched no thread.',
        mailbox: 'A mailbox in error, or paused by a circuit breaker.',
        reply_needed: 'External agent mode (§10.7): a contact replied and the campaign’s own agent answers.',
        follow_up_needed: 'External agent mode: an AI-written follow-up or a check-in is due for the campaign’s own agent to write.',
      },
      { description: 'What kind of item.' },
    ),
    id: z.string().meta({ description: 'The escalation, email, mailbox or (for `reply_needed` and `follow_up_needed`) thread ID, depending on `kind`.' }),
    priority: describedEnum({ urgent: 'Now.', high: 'Within hours.', normal: 'Within a day.' }, { description: 'How soon it needs a person.' }),
    title: z.string().meta({ description: 'In a few words.' }),
    why: z.string().meta({ description: 'Why it needs a person, in plain language.' }),
    thread_id: id('thread', 'The thread it is about.').nullable(),
    contact_id: id('contact', 'The contact it is about.').nullable(),
    due_at: z.iso.datetime().nullable().meta({ description: 'When it is due (escalations), if it has a deadline.' }),
    created_at: z.iso.datetime().meta({ description: 'Since when it has been waiting.' }),
    suggested_tools: z.array(z.string()).meta({ description: 'MCP tools that settle it, in the order you would use them.' }),
  })
  .meta({ id: 'WorkItem' });

export const getWorkQueue = defineOperation({
  operationId: 'getWorkQueue',
  method: 'get',
  path: '/work-queue',
  tag: 'Meta',
  summary: 'Everything waiting for a person, most urgent first',
  description:
    'One prioritized list across open escalations, emails waiting for approval and saved drafts, unmatched replies, mailboxes in error or paused by a breaker, and (in external agent mode) replies to answer and follow-ups to write (§14.5). Most urgent first, then soonest due, then longest waiting. Each item says why it is here and which tools settle it; `counts` has the totals by kind.',
  access: 'scoped',
  scopes: ['threads:read'],
  query: z.object({ limit: z.coerce.number().int().min(1).max(200).default(50).meta({ description: 'Most items to return, 1 to 200.', examples: [50] }) }),
  response: {
    status: 200,
    description: 'The queue.',
    schema: z
      .object({
        items: z.array(workItemSchema),
        counts: z.object({ escalation: z.int().min(0), draft: z.int().min(0), unmatched_reply: z.int().min(0), mailbox: z.int().min(0), reply_needed: z.int().min(0), follow_up_needed: z.int().min(0) }).meta({ description: 'How many of each kind are waiting in all.' }),
      })
      .meta({ id: 'WorkQueue' }),
    example: {
      items: [
        {
          kind: 'escalation',
          id: 'esc_01jd3x5k8qf7tb9w2m4n6p8r0s',
          priority: 'high',
          title: 'Priya Natarajan replied',
          why: 'The reply needs an answer, and the AI agent isn’t connected yet, so nothing was drafted.',
          thread_id: 'thr_01jd3x5k8qf7tb9w2m4n6p8r0s',
          contact_id: 'ctc_01jd3x5k8qf7tb9w2m4n6p8r0s',
          due_at: '2026-11-10T21:53:00Z',
          created_at: '2026-11-10T17:53:00Z',
          suggested_tools: ['get_thread_context', 'create_reply', 'resolve_escalation'],
        },
      ],
      counts: { escalation: 1, draft: 0, unmatched_reply: 0, mailbox: 0, reply_needed: 0, follow_up_needed: 0 },
    },
  },
  mcp: { toolset: 'threads' },
});

export const getJob = defineOperation({
  operationId: 'getJob',
  method: 'get',
  path: '/jobs/{jobId}',
  tag: 'Meta',
  summary: 'Check on a long-running task',
  description: 'The status of an asynchronous task by the ID its 202 answer gave: an import (`imp_…`, from commitImport) or a mailbox poll (`prn_…`, from listPollRuns). Poll it until `status` is `succeeded` or `failed`.',
  access: 'authenticated',
  scopes: [],
  params: z.object({ jobId: z.string().regex(/^(imp|prn)_[0-9a-z]{26}$/).meta({ description: 'The task’s ID.', examples: ['imp_01jd3x5k8qf7tb9w2m4n6p8r0s'] }) }),
  response: {
    status: 200,
    description: 'The task.',
    schema: z
      .object({
        id: z.string(),
        kind: describedEnum({ import: 'A contact import.', mailbox_poll: 'A check of a mailbox for new mail.' }, { description: 'What it is.' }),
        status: describedEnum({ queued: 'Waiting to start.', running: 'Under way.', succeeded: 'Done.', failed: 'Stopped with an error.' }, { description: 'Where it stands.' }),
        progress: z.object({ done: z.int().min(0), total: z.int().min(0).nullable() }).nullable().meta({ description: 'How far along, when it can tell.' }),
        error: z.string().nullable(),
        created_at: z.iso.datetime(),
        finished_at: z.iso.datetime().nullable(),
      })
      .meta({ id: 'Job' }),
    example: { id: 'imp_01jd3x5k8qf7tb9w2m4n6p8r0s', kind: 'import', status: 'running', progress: { done: 1200, total: 4800 }, error: null, created_at: '2026-11-10T09:00:00Z', finished_at: null },
  },
  errors: [404],
  mcp: { toolset: 'contacts' },
});

export const streamEvents = defineOperation({
  operationId: 'streamEvents',
  method: 'get',
  path: '/events/stream',
  tag: 'Meta',
  summary: 'Follow the workspace’s activity live (server-sent events)',
  description:
    'A `text/event-stream` of the workspace’s activities as they are written (§4.2), for live views. Each event is one Activity in its JSON shape: the event name is its `type` (e.g. `thread.stage_changed`) and the event ID is its `id`. Reconnect with the standard `Last-Event-ID` header to get what you missed first (up to 500 events). A comment line every 25 seconds keeps the connection open. Not an MCP tool.',
  access: 'authenticated',
  scopes: [],
  response: { status: 200, description: 'The event stream; it stays open.', mediaType: 'text/event-stream' },
  mcp: false,
});
