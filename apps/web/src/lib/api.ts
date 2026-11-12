// The UI's client for the public API (spec §4.2, D10: the UI uses the public API for every
// mutation). Typed from the OpenAPI document; the session cookie authenticates it.

import createClient from 'openapi-fetch';

import type { components, paths } from './api-types.ts';

export const api = createClient<paths>({ baseUrl: '/api/v1', credentials: 'same-origin' });

export type Schemas = components['schemas'];

type Problem = { detail?: string; title?: string; code?: string; status?: number; instance?: string; errors?: { path?: string; message?: string }[] };

/** The problem detail of a failed call, or a generic sentence. Validation errors name each field. */
export function problemText(error: unknown): string {
  const problem = error as Problem | undefined;
  if (problem?.code === 'validation_failed' && problem.errors?.length) return problem.errors.map((item) => (item.path ? `${item.path}: ${item.message}` : item.message)).join(' ');
  if (problem?.code === 'forbidden_scope') return `You don’t have access to this. ${problem.detail ?? ''} Ask an owner or admin.`.trim();
  return problem?.detail ?? problem?.title ?? 'Something went wrong. Try again.';
}

/** A failed API call (spec §15.20): the words to show, and the request ID to quote when reporting it. */
export class ApiProblem extends Error {
  readonly status: number | null;
  readonly code: string | null;
  readonly requestId: string | null;
  constructor(problem: unknown) {
    super(problemText(problem));
    const fields = problem as Problem | undefined;
    this.status = fields?.status ?? null;
    this.code = fields?.code ?? null;
    this.requestId = fields?.instance ?? null;
  }
}

/** The data of an API call, or an ApiProblem with the problem's words and request ID. */
export async function unwrap<T>(call: Promise<{ data?: T; error?: unknown }>): Promise<T> {
  const { data, error } = await call;
  if (error !== undefined) throw new ApiProblem(error);
  return data as T;
}

/** A fresh Idempotency-Key, for `params.header` of a call that sends email or records a goal (§13.3). */
export const idempotencyKey = () => ({ 'Idempotency-Key': crypto.randomUUID() });
