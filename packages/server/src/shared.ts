// Small helpers every service uses.

import { audit_log, type Executor } from '@catalyst/db';

import type { Principal } from './api/auth.ts';

export const iso = (date: Date | null) => (date ? date.toISOString() : null);

/** Escapes `%`, `_` and `\` so caller text matches literally inside a LIKE pattern. */
export const escapeLike = (value: string) => value.replace(/[\\%_]/g, (character) => `\\${character}`);

/** The `actor_type` and `actor_id` of an activity or audit entry written for this caller. */
export const actorOf = (principal: Principal) => ({ actor_type: principal.kind, actor_id: principal.id }) as const;

/** Writes a security-relevant change to the audit log (spec §16). */
export async function audit(
  db: Executor,
  principal: Principal,
  action: string,
  target: { type: string; id: string },
  diff: Record<string, unknown> = {},
  now = new Date(),
): Promise<void> {
  await db.insert(audit_log).values({
    workspace_id: principal.workspace.id,
    ...actorOf(principal),
    action,
    target_type: target.type,
    target_id: target.id,
    diff,
    created_at: now,
  });
}
