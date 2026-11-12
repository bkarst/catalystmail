// Generates the OpenAPI 3.1 document from the operation registry (spec §13). The same document is
// served at /api/v1/openapi.json and is what the MCP tools are generated from (§14.2).

import { z } from 'zod';
import { createDocument, type ZodOpenApiOperationObject, type ZodOpenApiPathsObject, type ZodOpenApiResponseObject } from 'zod-openapi';

import { problemSchema } from './common.ts';
import { mcpAnnotations, TAGS, toolName, type Operation } from './operation.ts';
import { operations } from './operations/index.ts';
import { WEBHOOK_EVENTS } from './schemas/webhooks.ts';

export const API_BASE_PATH = '/api/v1';

const ERROR_DESCRIPTIONS: Record<number, string> = {
  400: 'The request is invalid (`validation_failed`).',
  401: 'No valid session or API key (`unauthorized`).',
  403: 'A required scope or role is missing (`forbidden_scope`).',
  404: 'The resource does not exist in this workspace (`not_found`).',
  409: 'The request conflicts with the current state (`conflict`).',
  412: 'The `If-Match` ETag is stale (`precondition_failed`).',
  422: 'The request cannot be carried out as sent (`idempotency_key_reused`, `send_blocked`).',
  429: 'Too many requests (`rate_limited`). `Retry-After` says when to try again.',
  500: 'Server error (`internal_error`).',
  503: 'The AI agent is off, failed or is over budget (`ai_unavailable`, `budget_exceeded`).',
};

/** Every error status an operation can answer with: the standard ones plus those it declares. */
export function errorStatuses(operation: Operation): number[] {
  const statuses = new Set<number>([429, 500, ...(operation.errors ?? [])]);
  if (operation.access !== 'public') statuses.add(401);
  if (operation.access === 'scoped' || operation.access === 'session') statuses.add(403);
  if (operation.params || operation.query || operation.body) statuses.add(400);
  if (operation.params) statuses.add(404);
  if (operation.ifMatch) statuses.add(412);
  if (operation.idempotencyKey) statuses.add(422);
  return [...statuses].sort((a, b) => a - b);
}

/** The header parameters an operation takes, as a zod object; undefined when it takes none. */
export function headerParams(operation: Operation): z.ZodObject | undefined {
  const shape: Record<string, z.ZodType> = {};
  if (operation.idempotencyKey) {
    const key = z.string().max(128);
    const description = 'A unique key for this request. Sending it again within 24 hours returns the stored response instead of acting twice.';
    shape['Idempotency-Key'] = operation.idempotencyKey === 'required' ? key.meta({ description }) : key.optional().meta({ description });
  }
  if (operation.ifMatch) {
    shape['If-Match'] = z
      .string()
      .optional()
      .meta({ description: 'The `ETag` from your last GET of this resource. The change is refused if the resource has changed since.' });
  }
  return Object.keys(shape).length > 0 ? z.object(shape) : undefined;
}

function toOpenApiOperation(operation: Operation): ZodOpenApiOperationObject {
  const header = headerParams(operation);
  const { response } = operation;

  const responses: Record<string, ZodOpenApiResponseObject> = {
    [response.status]: {
      description: response.description,
      ...(response.mediaType && { content: { [response.mediaType]: { schema: z.string().meta({ format: 'binary' }) } } }),
      ...(response.schema && {
        content: {
          'application/json': {
            schema: response.schema,
            ...(response.example !== undefined && { examples: { default: { value: response.example } } }),
          },
        },
      }),
    },
  };
  for (const status of errorStatuses(operation)) {
    responses[status] = { description: ERROR_DESCRIPTIONS[status]!, content: { 'application/problem+json': { schema: problemSchema } } };
  }

  return {
    operationId: operation.operationId,
    tags: [operation.tag],
    summary: operation.summary,
    description: operation.description,
    security: operation.access === 'public' ? [] : operation.access === 'session' ? [{ sessionCookie: [] }] : [{ bearerAuth: [] }, { sessionCookie: [] }],
    'x-required-scopes': [...operation.scopes],
    'x-mcp':
      operation.mcp === false
        ? false
        : { toolset: operation.mcp.toolset, tool: toolName(operation.operationId), annotations: mcpAnnotations(operation) },
    ...((operation.params || operation.query || header) && {
      requestParams: {
        ...(operation.params && { path: operation.params }),
        ...(operation.query && { query: operation.query }),
        ...(header && { header }),
      },
    }),
    ...(operation.body && {
      requestBody: {
        required: true,
        content: { 'application/json': { schema: operation.body.schema, examples: { default: { value: operation.body.example } } } },
      },
    }),
    responses,
  };
}

/** One OpenAPI `webhooks` entry per event an endpoint can receive (§13.6), each with the shared envelope. */
function webhookEvents(): ZodOpenApiPathsObject {
  const entries: ZodOpenApiPathsObject = {};
  for (const [type, description] of Object.entries(WEBHOOK_EVENTS)) {
    const envelope = z
      .object({
        id: z.string().meta({ description: 'The event ID (`evt_…`), the same for every endpoint; use it to drop duplicates.' }),
        type: z.literal(type),
        created_at: z.iso.datetime().meta({ description: 'When it happened.' }),
        workspace_id: z.string(),
        data: z.record(z.string(), z.unknown()).meta({ description: 'What happened, with `thread_id`, `contact_id` and `campaign_id` where they apply.' }),
      })
      .meta({ description });
    entries[type] = {
      post: {
        summary: description,
        description: `Sent to endpoints subscribed to \`${type}\`, signed in \`Catalyst-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, t + "." + body)>\`. Reject anything older than 5 minutes. Answer 2xx; anything else is retried at 1 m, 5 m, 30 m, 2 h, 6 h, 12 h and 24 h.`,
        requestBody: { content: { 'application/json': { schema: envelope } } },
        responses: { '200': { description: 'Received.' } },
      },
    };
  }
  return entries;
}

export function buildOpenApiDocument(options: { operations?: readonly Operation[]; version?: string } = {}) {
  const paths: ZodOpenApiPathsObject = {};
  for (const operation of options.operations ?? operations) {
    paths[operation.path] = { ...paths[operation.path], [operation.method]: toOpenApiOperation(operation) };
  }

  return createDocument({
    openapi: '3.1.0',
    info: {
      title: 'Catalyst API',
      version: options.version ?? '1.0.0',
      description:
        'Everything the Catalyst UI can do, as an API. JSON with snake_case fields, ISO-8601 UTC timestamps and prefixed IDs. ' +
        'Lists are cursor-paginated. Errors are RFC 9457 problem documents with a stable `code`. ' +
        'Sending email through the API passes the same suppression, capacity, lint and guardrail checks as the UI.',
    },
    servers: [{ url: API_BASE_PATH }],
    tags: TAGS.map((name) => ({ name })),
    paths,
    webhooks: webhookEvents(),
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', description: 'An API key: `Authorization: Bearer ck_live_…`. Keys carry scopes.' },
        sessionCookie: { type: 'apiKey', in: 'cookie', name: 'catalyst_session', description: 'The session cookie of a signed-in user.' },
      },
    },
  });
}
