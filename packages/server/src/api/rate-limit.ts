// Rate limits (spec §13.3): 600 requests a minute per key, and 60 a minute for the operations that
// send email or call out (send, approve, launch, webhook tests). Counted in Postgres in fixed
// one-minute windows, so every app process shares the count. Every response carries the
// `RateLimit-*` headers; going over answers 429 `rate_limited` with `Retry-After`.

import type { Operation } from '@catalyst/contract';
import { rate_limit_windows, type Executor } from '@catalyst/db';
import { lt, sql } from 'drizzle-orm';

import { ApiError } from './errors.ts';

export interface RateLimits {
  perMinute: number;
  sendPerMinute: number;
}

export const DEFAULT_RATE_LIMITS: RateLimits = { perMinute: 600, sendPerMinute: 60 };
const WINDOW_MS = 60_000;

/** The send/approve bucket: operations marked as reaching the outside world. */
export const isSendOperation = (operation: Operation) => operation.mcp !== false && operation.mcp.openWorld === true;

export class RateLimitError extends ApiError {
  readonly headers: Record<string, string>;
  constructor(detail: string, headers: Record<string, string>) {
    super(429, 'rate_limited', detail);
    this.headers = headers;
  }
}

/** Counts this request against the caller's windows; returns the headers, or throws 429. */
export async function consumeRateLimit(db: Executor, principalId: string, operation: Operation, now: Date, limits: RateLimits = DEFAULT_RATE_LIMITS): Promise<Record<string, string>> {
  const windowStart = new Date(Math.floor(now.getTime() / WINDOW_MS) * WINDOW_MS);
  const resetSeconds = Math.max(1, Math.ceil((windowStart.getTime() + WINDOW_MS - now.getTime()) / 1000));
  const buckets = [{ key: `${principalId}:general`, limit: limits.perMinute }, ...(isSendOperation(operation) ? [{ key: `${principalId}:send`, limit: limits.sendPerMinute }] : [])];
  const counted = await db
    .insert(rate_limit_windows)
    .values(buckets.map((bucket) => ({ key: bucket.key, window_start: windowStart, count: 1 })))
    .onConflictDoUpdate({ target: [rate_limit_windows.key, rate_limit_windows.window_start], set: { count: sql`${rate_limit_windows.count} + 1` } })
    .returning({ key: rate_limit_windows.key, count: rate_limit_windows.count });
  // The headers describe the tightest bucket this request used.
  const states = buckets.map((bucket) => ({ ...bucket, count: counted.find((row) => row.key === bucket.key)?.count ?? 1 }));
  const tightest = states.reduce((best, state) => (state.limit - state.count < best.limit - best.count ? state : best));
  const headers = { 'ratelimit-limit': String(tightest.limit), 'ratelimit-remaining': String(Math.max(0, tightest.limit - tightest.count)), 'ratelimit-reset': String(resetSeconds) };
  const over = states.find((state) => state.count > state.limit);
  if (over) {
    throw new RateLimitError(`This key made more than ${over.limit} ${over.key.endsWith(':send') ? 'sending ' : ''}requests this minute. Try again in ${resetSeconds} s.`, { ...headers, 'retry-after': String(resetSeconds) });
  }
  return headers;
}

/** Old windows are of no use; the retention job clears them (§6.11). */
export async function purgeRateLimitWindows(db: Executor, now: Date): Promise<number> {
  const removed = await db.delete(rate_limit_windows).where(lt(rate_limit_windows.window_start, new Date(now.getTime() - 60 * WINDOW_MS))).returning({ key: rate_limit_windows.key });
  return removed.length;
}
