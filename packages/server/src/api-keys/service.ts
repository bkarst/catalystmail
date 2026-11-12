// API keys (spec §13.2, §13.4, §16): made and revoked by an owner or admin in a signed-in session,
// never by another key (the operations are session-only and not MCP tools). The secret is shown
// once; only its SHA-256 is kept. The bootstrap CLI uses the same functions for the first key.

import { scopeSchema, type Scope } from '@catalyst/contract';
import { api_keys, newId, type Db, type Executor } from '@catalyst/db';
import { and, desc, eq, isNull } from 'drizzle-orm';

import { generateApiKey, type Principal } from '../api/auth.ts';
import { ApiError, conflict, invalidField, notFound } from '../api/errors.ts';
import { audit } from '../shared.ts';

type KeyRow = typeof api_keys.$inferSelect;

export function serializeApiKey(row: KeyRow) {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scopes: row.scopes as Scope[],
    created_by: row.created_by,
    last_used_at: row.last_used_at?.toISOString() ?? null,
    expires_at: row.expires_at?.toISOString() ?? null,
    revoked_at: row.revoked_at?.toISOString() ?? null,
    created_at: row.created_at.toISOString(),
  };
}

/** Owners and admins manage keys (§16 roles). */
function requireKeyAdmin(principal: Principal): void {
  if (principal.kind !== 'user' || (principal.role !== 'owner' && principal.role !== 'admin')) throw new ApiError(403, 'forbidden_scope', 'Only an owner or admin, signed in, manages API keys.');
}

export async function listApiKeys(db: Db, principal: Principal, query: { include_revoked?: boolean | undefined }) {
  requireKeyAdmin(principal);
  const rows = await db
    .select()
    .from(api_keys)
    .where(and(eq(api_keys.workspace_id, principal.workspace.id), ...(query.include_revoked ? [] : [isNull(api_keys.revoked_at)])))
    .orderBy(desc(api_keys.created_at));
  return { data: rows.map(serializeApiKey) };
}

/** Makes a key; the only time its secret is returned. */
export async function insertApiKey(db: Executor, input: { workspaceId: string; name: string; scopes: readonly string[]; expiresAt: Date | null; createdBy: string | null }, now: Date) {
  const unknown = input.scopes.filter((scope) => !(scopeSchema.options as readonly string[]).includes(scope));
  if (unknown.length > 0) throw invalidField('body.scopes', `Unknown scope ${unknown.join(', ')}.`);
  if (input.expiresAt && input.expiresAt.getTime() <= now.getTime()) throw invalidField('body.expires_at', 'An expiry must be in the future.');
  const key = generateApiKey();
  const [row] = await db
    .insert(api_keys)
    .values({ id: newId('api_key'), workspace_id: input.workspaceId, name: input.name, prefix: key.prefix, key_hash: key.hash, scopes: [...new Set(input.scopes)], created_by: input.createdBy, expires_at: input.expiresAt, created_at: now })
    .returning();
  return { row: row!, secret: key.secret };
}

export async function createApiKey(db: Db, principal: Principal, input: { name: string; scopes: Scope[]; expires_at?: string | undefined }, now: Date) {
  requireKeyAdmin(principal);
  return db.transaction(async (tx) => {
    const { row, secret } = await insertApiKey(tx, { workspaceId: principal.workspace.id, name: input.name, scopes: input.scopes, expiresAt: input.expires_at ? new Date(input.expires_at) : null, createdBy: principal.id }, now);
    await audit(tx, principal, 'api_key.created', { type: 'api_key', id: row.id }, { name: row.name, scopes: row.scopes, expires_at: row.expires_at?.toISOString() ?? null }, now);
    return { ...serializeApiKey(row), secret };
  });
}

export async function revokeApiKey(db: Db, principal: Principal, keyId: string, now: Date) {
  requireKeyAdmin(principal);
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(api_keys).where(and(eq(api_keys.id, keyId), eq(api_keys.workspace_id, principal.workspace.id)));
    if (!row) throw notFound('The API key');
    if (row.revoked_at) throw conflict('This key is already revoked.');
    const [revoked] = await tx.update(api_keys).set({ revoked_at: now }).where(eq(api_keys.id, row.id)).returning();
    await audit(tx, principal, 'api_key.revoked', { type: 'api_key', id: row.id }, { name: row.name }, now);
    return serializeApiKey(revoked!);
  });
}
