// Idempotency keys (spec §13.3): replaying a POST with the same key within 24 hours returns the
// stored response instead of acting twice; the same key with a different request is an error.

import { createHash } from 'node:crypto';

import { idempotency_keys, type Db } from '@catalyst/db';
import { and, eq } from 'drizzle-orm';

import { ApiError } from './errors.ts';

const TTL_MS = 24 * 60 * 60 * 1000;

export interface StoredResponse {
  status: number;
  body: unknown;
}

export function requestHash(method: string, path: string, body: unknown): Buffer {
  return createHash('sha256').update(`${method} ${path}\n${JSON.stringify(body ?? null)}`).digest();
}

export async function withIdempotency(
  db: Db,
  scope: { workspaceId: string; principalId: string; key: string; hash: Buffer; now: Date },
  run: () => Promise<StoredResponse>,
): Promise<StoredResponse & { replayed: boolean }> {
  const identity = and(
    eq(idempotency_keys.workspace_id, scope.workspaceId),
    eq(idempotency_keys.principal_id, scope.principalId),
    eq(idempotency_keys.key, scope.key),
  );

  for (let attempt = 0; attempt < 2; attempt += 1) {
    // Claim the key first; the primary key makes this the one place two identical requests meet.
    const claimed = await db
      .insert(idempotency_keys)
      .values({ workspace_id: scope.workspaceId, principal_id: scope.principalId, key: scope.key, request_hash: scope.hash, created_at: scope.now })
      .onConflictDoNothing()
      .returning({ key: idempotency_keys.key });

    if (claimed.length > 0) {
      try {
        const response = await run();
        await db.update(idempotency_keys).set({ response_status: response.status, response_body: response.body ?? null }).where(identity);
        return { ...response, replayed: false };
      } catch (error) {
        // A failed request leaves no record, so the caller can fix it and retry with the same key.
        await db.delete(idempotency_keys).where(identity);
        throw error;
      }
    }

    const [existing] = await db.select().from(idempotency_keys).where(identity);
    if (!existing) continue; // released between the two statements
    if (scope.now.getTime() - existing.created_at.getTime() > TTL_MS) {
      await db.delete(idempotency_keys).where(identity);
      continue;
    }
    if (!existing.request_hash.equals(scope.hash)) {
      throw new ApiError(422, 'idempotency_key_reused', 'This Idempotency-Key was already used with a different request.');
    }
    if (existing.response_status === null) {
      throw new ApiError(409, 'conflict', 'A request with this Idempotency-Key is still in progress.');
    }
    return { status: existing.response_status, body: existing.response_body, replayed: true };
  }
  throw new ApiError(409, 'conflict', 'A request with this Idempotency-Key is still in progress.');
}
