// API conventions shared by every operation (spec §13.2, §13.3, §22.D).

import { ID_PREFIXES, idPattern, type IdKind } from '@catalyst/core';
import { z } from 'zod';

/**
 * An enum whose every value carries a description, rendered as `x-enum-descriptions` so the
 * contract reads well to LLMs as well as people (§13.1).
 */
export function describedEnum<const T extends Record<string, string>>(values: T, meta: { id?: string; description: string }) {
  const keys = Object.keys(values) as [keyof T & string, ...(keyof T & string)[]];
  return z.enum(keys).meta({ ...meta, 'x-enum-descriptions': values });
}

const ID_LABELS: Partial<Record<IdKind, string>> = { api_key: 'API key', ai_run: 'AI run' };

/** A prefixed ID such as `ctc_01jd…`. `description` says what the ID refers to at this point of use. */
export function id(kind: IdKind, description?: string) {
  const label = ID_LABELS[kind] ?? kind.replace(/_/g, ' ');
  return z
    .string()
    .regex(idPattern(kind))
    .meta({
      description: description ?? `ID of the ${label} (prefix \`${ID_PREFIXES[kind]}_\`).`,
      examples: [`${ID_PREFIXES[kind]}_01jd3x5k8qf7tb9w2m4n6p8r0s`],
    });
}

/** ISO-8601 timestamp in UTC. */
export const timestamp = (description: string) => z.iso.datetime().meta({ description, examples: ['2026-11-10T17:52:00Z'] });

export const scopeSchema = describedEnum(
  {
    'contacts:read': 'Read contacts, companies, tags, lists and suppressions.',
    'contacts:write': 'Create and change contacts, companies, tags, lists and suppressions.',
    'contacts:erase': 'Permanently erase a contact and its personal data.',
    'campaigns:read': 'Read campaigns, goals, emails and follow-up sequences.',
    'campaigns:write': 'Create, change, launch and pause campaigns, and enroll contacts.',
    'threads:read': 'Read threads, messages, drafts and activity.',
    'threads:write': 'Change threads: assign, pause, close, mark goals, write drafts.',
    'messages:send': 'Create, approve or schedule outbound email. Without it an agent can only draft.',
    'escalations:read': 'Read escalations.',
    'escalations:write': 'Answer, resolve, snooze, assign and dismiss escalations.',
    'knowledge:read': 'Read knowledge items.',
    'knowledge:write': 'Create and change knowledge items.',
    'mailboxes:read': 'Read mailboxes, domains, capacity and deliverability, and trigger a poll.',
    'mailboxes:write': 'Connect, change, pause and resume mailboxes and domains.',
    'analytics:read': 'Read dashboards, funnels and statistics.',
    'webhooks:manage': 'Manage outbound webhook endpoints and deliveries.',
    'settings:manage': 'Manage workspace settings, users, custom fields, ramp plans and cap overrides.',
  },
  { id: 'Scope', description: 'A permission carried by an API key. Each operation lists the scopes it needs in `x-required-scopes`.' },
);
export type Scope = z.infer<typeof scopeSchema>;

export const problemCodeSchema = describedEnum(
  {
    validation_failed: 'The request did not match the schema or a business rule; see `errors`.',
    unauthorized: 'No valid session or API key.',
    forbidden_scope: 'The API key lacks a required scope, or the user role is too low.',
    not_found: 'The resource does not exist in this workspace.',
    conflict: 'The request conflicts with the current state of the resource.',
    precondition_failed: 'The `If-Match` ETag no longer matches; fetch the resource again.',
    idempotency_key_reused: 'The `Idempotency-Key` was already used with a different request body.',
    rate_limited: 'Too many requests; retry after the time in `Retry-After`.',
    preflight_failed: 'The campaign did not pass preflight and cannot launch.',
    send_blocked: 'A send check failed; `errors[].reason` names it (suppressed, cap_reached, lint_blocker, …).',
    thread_terminal: 'The thread is in a terminal state and accepts no more email.',
    stage_already_covered: 'Another active follow-up sequence already covers this stage.',
    poll_in_progress: 'A poll of this mailbox is already running.',
    mailbox_auth_failed: 'The mailbox credentials were rejected by the mail provider.',
    dns_check_failed: 'A required DNS record is missing or wrong.',
    ai_unavailable: 'The AI provider refused, failed or returned invalid output.',
    budget_exceeded: "The workspace's monthly AI budget is used up.",
    two_factor_required: 'The workspace requires owners to sign in with two-factor authentication; set it up first.',
    internal_error: 'Something went wrong on the server; quote `instance` when reporting it.',
  },
  { id: 'ProblemCode', description: 'Stable machine-readable error code.' },
);
export type ProblemCode = z.infer<typeof problemCodeSchema>;

/** RFC 9457 problem document, served as `application/problem+json`. */
export const problemSchema = z
  .object({
    type: z.string().meta({ description: 'URI identifying the problem type.' }),
    title: z.string().meta({ description: 'Short summary of the problem type.' }),
    status: z.int().meta({ description: 'The HTTP status code.' }),
    detail: z.string().optional().meta({ description: 'What went wrong in this particular request.' }),
    instance: z.string().optional().meta({ description: 'The request ID, for support.' }),
    code: problemCodeSchema,
    errors: z
      .array(
        z.object({
          path: z.string().meta({ description: 'The field or parameter at fault, e.g. `body.email`.' }),
          message: z.string(),
          reason: z.string().optional().meta({ description: 'For `send_blocked`: the check that failed.' }),
        }),
      )
      .optional()
      .meta({ description: 'Per-field details.' }),
  })
  .meta({
    id: 'Problem',
    description: 'Error response (RFC 9457).',
    examples: [
      {
        type: 'https://catalyst.example.com/problems/validation_failed',
        title: 'Validation failed',
        status: 400,
        code: 'validation_failed',
        errors: [{ path: 'body.email', message: 'Not a valid email address' }],
      },
    ],
  });
export type Problem = z.infer<typeof problemSchema>;

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 25;

/** Cursor pagination query parameters: `?limit=25&cursor=…`. */
export const paginationQuery = {
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE)
    .meta({ description: `Page size, 1 to ${MAX_PAGE_SIZE}.`, examples: [DEFAULT_PAGE_SIZE] }),
  cursor: z.string().optional().meta({ description: 'The `next_cursor` of the previous page. Omit for the first page.' }),
};

const pages = new Map<string, z.ZodType>();

/** A page of results: `{ data: [...], next_cursor }`. One component per item type, however often it is used. */
export function paginated<T extends z.ZodType>(item: T, name: string) {
  const make = () =>
    z
      .object({
        data: z.array(item),
        next_cursor: z.string().nullable().meta({ description: 'Pass as `cursor` to get the next page; null on the last page.' }),
      })
      .meta({ id: `${name}Page`, description: `One page of ${name.toLowerCase()} results.` });
  const existing = pages.get(name) as ReturnType<typeof make> | undefined;
  if (existing) return existing;
  const created = make();
  pages.set(name, created);
  return created;
}
