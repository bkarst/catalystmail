// Turns a declared operation plus its handler into a Next.js route handler. Everything the
// contract promises is enforced here, once: authentication, scopes, input validation, the
// response shape, idempotency keys, ETags and the problem+json error format (spec §13).

import { randomUUID } from 'node:crypto';

import { operations, type Operation, type OperationId } from '@catalyst/contract';
import type { Db } from '@catalyst/db';
import type { z } from 'zod';

import { sameOrigin } from '../auth/session.ts';
import { authFor, getDb, getDeps, type AppDeps } from '../runtime.ts';
import { authenticate, type Principal } from './auth.ts';
import { ApiError, problemResponse, validationFailed, type FieldError } from './errors.ts';
import { etagFor, type Versioned } from './etag.ts';
import { requestHash, withIdempotency, type StoredResponse } from './idempotency.ts';
import { consumeRateLimit, RateLimitError } from './rate-limit.ts';

type Declared = (typeof operations)[number];
export type OperationOf<Id extends OperationId> = Extract<Declared, { operationId: Id }>;

/** What a handler receives: inputs already validated against the operation's schemas. */
export interface HandlerContext<O> {
  db: Db;
  /** Services outside the process, such as DNS. */
  deps: AppDeps;
  /** Null only for public operations. */
  principal: O extends { access: 'public' } ? null : Principal;
  now: Date;
  requestId: string;
  params: O extends { params: infer P extends z.ZodType } ? z.output<P> : undefined;
  query: O extends { query: infer Q extends z.ZodType } ? z.output<Q> : undefined;
  body: O extends { body: { schema: infer B extends z.ZodType } } ? z.output<B> : undefined;
  /** The caller's `If-Match` header, for operations that honor it. */
  ifMatch: string | null;
  /** The caller's `Idempotency-Key` header, for operations that take one. */
  idempotencyKey: string | null;
  headers: Headers;
  /** The body exactly as sent, for signature checks. */
  text: string;
}

/** A non-JSON answer: the bytes, and the file name to suggest. */
export interface RawResult {
  /** A stream is sent as it is produced (server-sent events). */
  body: Buffer | ReadableStream<Uint8Array>;
  filename?: string;
}

/** What a handler returns: the response body, in the shape of the operation's response schema. */
export type HandlerResult<O> = O extends { response: { mediaType: string } } ? RawResult : O extends { response: { schema: infer S extends z.ZodType } } ? z.input<S> : void;
export type Handler<Id extends OperationId> = (context: HandlerContext<OperationOf<Id>>) => Promise<HandlerResult<OperationOf<Id>>>;

/** One handler per declared operation. A missing one is a compile error. */
export type Handlers = { [Id in OperationId]: Handler<Id> };

type LooseHandler = (context: {
  db: Db;
  deps: AppDeps;
  principal: Principal | null;
  now: Date;
  requestId: string;
  params: unknown;
  query: unknown;
  body: unknown;
  ifMatch: string | null;
  idempotencyKey: string | null;
  headers: Headers;
  text: string;
}) => Promise<unknown>;

export type RouteHandler = (request: Request, context: { params: Promise<Record<string, string | string[] | undefined>> }) => Promise<Response>;

function parsePart(part: string, schema: z.ZodType | undefined, value: unknown, errors: FieldError[]): unknown {
  if (!schema) return undefined;
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  for (const issue of result.error.issues) {
    errors.push({ path: [part, ...issue.path].join('.'), message: issue.message });
  }
  return undefined;
}

const isVersioned = (body: unknown): body is Versioned =>
  typeof body === 'object' && body !== null && typeof (body as Versioned).id === 'string' && typeof (body as Versioned).updated_at === 'string';

export function makeRoute(handlers: Handlers) {
  return function route(operationId: OperationId): RouteHandler {
    const operation: Operation = operations.find((entry) => entry.operationId === operationId)!;
    // Inside the factory the inputs are only known at run time; the typed `Handlers` map is what keeps them honest.
    const handler = handlers[operationId] as unknown as LooseHandler;

    async function respond(request: Request, routeParams: Record<string, unknown>, requestId: string, extraHeaders: Record<string, string>): Promise<Response> {
      const db = getDb();
      const now = new Date();

      let principal: Principal | null = null;
      if (operation.access !== 'public') {
        const authConfig = (await getDeps()).config.auth;
        principal = await authenticate(db, request, now, authFor(db, authConfig));
        if (!principal) throw new ApiError(401, 'unauthorized', 'Send an API key as `Authorization: Bearer ck_live_…`, or sign in.');
        // §16: an owner the workspace requires two-factor sign-in of may only see who they are, until it's set up.
        if (principal.needsTwoFactor && operation.operationId !== 'getCurrentPrincipal') {
          throw new ApiError(403, 'two_factor_required', 'This workspace requires owners to use two-factor sign-in. Set it up (POST /api/auth/two-factor/enable), then sign in again.');
        }
        // CSRF (§16): a change made with a session cookie must come from the app's own pages.
        if (principal.kind === 'user' && operation.method !== 'get' && !sameOrigin(request, authConfig?.trustedOrigins ?? [])) {
          throw new ApiError(403, 'forbidden_scope', 'Cross-site request refused: a change made with a session cookie must come from Catalyst itself.');
        }
        if (operation.access === 'session' && principal.kind !== 'user') {
          throw new ApiError(403, 'forbidden_scope', 'This operation needs a signed-in user, not an API key.');
        }
        const held = principal.scopes;
        const missing = operation.scopes.filter((scope) => !held.includes(scope));
        if (missing.length > 0) throw new ApiError(403, 'forbidden_scope', `This operation needs the scope ${missing.join(', ')}.`);
        Object.assign(extraHeaders, await consumeRateLimit(db, principal.id, operation, now, (await getDeps()).config.rateLimits));
      }

      const url = new URL(request.url);
      const errors: FieldError[] = [];
      const params = parsePart('params', operation.params, routeParams, errors);
      const query = parsePart('query', operation.query, Object.fromEntries(url.searchParams), errors);
      // The text is kept as sent: signature checks hash exactly these bytes.
      const text = operation.method === 'get' ? '' : await request.text();
      let rawBody: unknown;
      if (operation.body) {
        try {
          rawBody = JSON.parse(text);
        } catch {
          throw validationFailed([{ path: 'body', message: 'The request body is not valid JSON.' }]);
        }
      }
      const body = parsePart('body', operation.body?.schema, rawBody, errors);

      const idempotencyKey = operation.idempotencyKey ? request.headers.get('idempotency-key') : null;
      if (operation.idempotencyKey === 'required' && !idempotencyKey) {
        errors.push({ path: 'header.Idempotency-Key', message: 'This operation requires an Idempotency-Key header.' });
      }
      if (idempotencyKey && idempotencyKey.length > 128) {
        errors.push({ path: 'header.Idempotency-Key', message: 'At most 128 characters.' });
      }
      if (errors.length > 0) throw validationFailed(errors);

      if (operation.response.mediaType) {
        // Bytes, not JSON: returned as they are, never stored for idempotency (only GETs do this).
        const raw = (await handler({ db, deps: await getDeps(), principal, now, requestId, params, query, body, ifMatch: null, idempotencyKey: null, headers: request.headers, text })) as RawResult;
        const headers: Record<string, string> = { 'x-request-id': requestId, 'content-type': operation.response.mediaType };
        if (raw.filename) headers['content-disposition'] = `attachment; filename="${raw.filename.replace(/["\\]/g, '')}"`;
        if (raw.body instanceof ReadableStream) return new Response(raw.body, { status: operation.response.status, headers: { ...headers, 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no' } });
        return new Response(new Uint8Array(raw.body), { status: operation.response.status, headers });
      }

      const execute = async (): Promise<StoredResponse> => {
        const result = await handler({ db, deps: await getDeps(), principal, now, requestId, params, query, body, ifMatch: request.headers.get('if-match'), idempotencyKey, headers: request.headers, text });
        if (!operation.response.schema) return { status: operation.response.status, body: null };
        // Parsing the result strips anything the contract doesn't declare, so no column leaks by accident.
        const parsed = operation.response.schema.safeParse(result);
        if (!parsed.success) {
          console.error(`[${requestId}] ${operationId} produced a response that breaks its contract`, parsed.error.issues);
          throw new ApiError(500, 'internal_error');
        }
        return { status: operation.response.status, body: parsed.data };
      };

      const outcome =
        idempotencyKey && principal
          ? await withIdempotency(
              db,
              { workspaceId: principal.workspace.id, principalId: principal.id, key: idempotencyKey, hash: requestHash(request.method, url.pathname, rawBody), now },
              execute,
            )
          : { ...(await execute()), replayed: false };

      const headers: Record<string, string> = { 'x-request-id': requestId };
      if (outcome.replayed) headers['idempotency-replayed'] = 'true';
      if (outcome.body === null) return new Response(null, { status: outcome.status, headers });
      if (isVersioned(outcome.body)) headers.etag = etagFor(outcome.body);
      headers['content-type'] = 'application/json';
      return new Response(JSON.stringify(outcome.body), { status: outcome.status, headers });
    }

    return async (request, context) => {
      const requestId = `req_${randomUUID()}`;
      // RateLimit-* go on every response to a known caller, errors included (§13.3).
      const extraHeaders: Record<string, string> = {};
      const withLimits = (response: Response) => {
        for (const [name, value] of Object.entries(extraHeaders)) response.headers.set(name, value);
        return response;
      };
      try {
        return withLimits(await respond(request, await context.params, requestId, extraHeaders));
      } catch (error) {
        if (error instanceof RateLimitError) return problemResponse(error, requestId, error.headers);
        if (error instanceof ApiError) {
          return withLimits(problemResponse(error, requestId, error.status === 401 ? { 'www-authenticate': 'Bearer' } : {}));
        }
        console.error(`[${requestId}] ${operationId} failed`, error);
        return problemResponse(new ApiError(500, 'internal_error'), requestId);
      }
    };
  };
}
