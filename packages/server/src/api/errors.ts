// API errors as RFC 9457 problem documents (spec §13.3, §22.D).

import type { Problem, ProblemCode } from '@catalyst/contract';

const TITLES: Record<ProblemCode, string> = {
  validation_failed: 'Validation failed',
  unauthorized: 'Not authenticated',
  forbidden_scope: 'Missing scope or role',
  not_found: 'Not found',
  conflict: 'Conflict',
  precondition_failed: 'Precondition failed',
  idempotency_key_reused: 'Idempotency key reused',
  rate_limited: 'Too many requests',
  preflight_failed: 'Preflight failed',
  send_blocked: 'Send blocked',
  thread_terminal: 'Thread is closed',
  stage_already_covered: 'Stage already covered',
  poll_in_progress: 'Poll in progress',
  mailbox_auth_failed: 'Mailbox authentication failed',
  dns_check_failed: 'DNS check failed',
  ai_unavailable: 'AI unavailable',
  budget_exceeded: 'AI budget exceeded',
  two_factor_required: 'Two-factor sign-in required',
  internal_error: 'Internal error',
};

export interface FieldError {
  /** The field or parameter at fault, e.g. `body.email` or `query.limit`. */
  path: string;
  message: string;
  reason?: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: ProblemCode;
  readonly errors: FieldError[] | undefined;

  constructor(status: number, code: ProblemCode, detail?: string, errors?: FieldError[]) {
    super(detail ?? TITLES[code]);
    this.status = status;
    this.code = code;
    this.errors = errors;
  }
}

export const validationFailed = (errors: FieldError[], detail?: string) => new ApiError(400, 'validation_failed', detail, errors);
export const invalidField = (path: string, message: string) => validationFailed([{ path, message }]);
export const notFound = (what: string) => new ApiError(404, 'not_found', `${what} was not found in this workspace.`);
export const conflict = (detail: string, errors?: FieldError[]) => new ApiError(409, 'conflict', detail, errors);

export function problemResponse(error: ApiError, requestId: string, headers: Record<string, string> = {}): Response {
  const problem: Problem = {
    type: `/problems/${error.code}`,
    title: TITLES[error.code],
    status: error.status,
    detail: error.message,
    instance: requestId,
    code: error.code,
    ...(error.errors && { errors: error.errors }),
  };
  return new Response(JSON.stringify(problem), {
    status: error.status,
    headers: { 'content-type': 'application/problem+json', 'x-request-id': requestId, ...headers },
  });
}

/** PostgreSQL error codes the services translate into API errors. */
export const PG_UNIQUE_VIOLATION = '23505';
export const PG_FOREIGN_KEY_VIOLATION = '23503';

/** The PostgreSQL error code behind a thrown error, if there is one. Drizzle wraps driver errors in `cause`. */
export function pgErrorCode(error: unknown): string | undefined {
  const candidate = error as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = candidate?.code ?? candidate?.cause?.code;
  return typeof code === 'string' ? code : undefined;
}
