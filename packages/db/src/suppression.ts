// The suppression check (spec §8.6): an address is suppressed when its hash or its domain is on the
// workspace's list. The same check runs at enrollment, at compose and in the pre-send guard.

import { and, eq, or } from 'drizzle-orm';

import type { Executor } from './client.ts';
import { emailDomain, emailHash } from './hash.ts';
import { suppressions } from './schema/contacts.ts';

export type SuppressionRow = typeof suppressions.$inferSelect;

/** Every suppression that blocks this address, by hash or by domain. */
export function suppressionsFor(db: Executor, workspaceId: string, email: string): Promise<SuppressionRow[]> {
  return db
    .select()
    .from(suppressions)
    .where(and(eq(suppressions.workspace_id, workspaceId), or(eq(suppressions.email_hash, emailHash(email)), eq(suppressions.domain, emailDomain(email)))));
}

export async function isSuppressed(db: Executor, workspaceId: string, email: string): Promise<boolean> {
  return (await suppressionsFor(db, workspaceId, email)).length > 0;
}
