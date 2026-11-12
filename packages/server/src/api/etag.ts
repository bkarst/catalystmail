// ETags for optimistic concurrency (spec §13.3): single-resource GETs return one, and a PATCH
// with a stale `If-Match` is refused with 412.

import { createHash } from 'node:crypto';

import { ApiError } from './errors.ts';

export interface Versioned {
  id: string;
  updated_at: string;
}

export function etagFor(resource: Versioned): string {
  return `"${createHash('sha256').update(`${resource.id}:${resource.updated_at}`).digest('base64url').slice(0, 22)}"`;
}

/** Throws `precondition_failed` when the caller's `If-Match` no longer matches the resource. */
export function assertFresh(resource: Versioned, ifMatch: string | null): void {
  if (ifMatch === null || ifMatch.trim() === '*') return;
  const accepted = ifMatch.split(',').map((tag) => tag.trim().replace(/^W\//, ''));
  if (!accepted.includes(etagFor(resource))) {
    throw new ApiError(412, 'precondition_failed', 'The resource has changed since you fetched it. Fetch it again and retry.');
  }
}
