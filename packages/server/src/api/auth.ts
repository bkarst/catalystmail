// Who is calling (spec §13.2). API keys are implemented; session cookies arrive with the UI.

import { createHash, randomBytes } from 'node:crypto';

import { scopeSchema, type Scope } from '@catalyst/contract';
import { api_keys, workspaces, type Db } from '@catalyst/db';
import { and, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';

import { sessionPrincipal, type Auth } from '../auth/session.ts';
export interface Principal {
  kind: 'user' | 'api_key';
  /** `usr_…` or `key_…`. */
  id: string;
  name: string;
  role: 'owner' | 'admin' | 'member' | 'viewer' | null;
  scopes: Scope[];
  workspace: { id: string; name: string };
  /** A signed-in owner of a workspace that requires two-factor sign-in, who hasn't set it up (§16). */
  needsTwoFactor?: boolean;
}

const KEY_PREFIX = 'ck_live_';

/** Only the SHA-256 of a key is stored; the secret itself is shown once at creation. */
export function hashApiKey(secret: string): Buffer {
  return createHash('sha256').update(secret, 'utf8').digest();
}

/** A new API key: the secret to show once, the prefix to display afterwards, and the hash to store. */
export function generateApiKey(): { secret: string; prefix: string; hash: Buffer } {
  const secret = KEY_PREFIX + randomBytes(32).toString('base64url');
  return { secret, prefix: secret.slice(0, KEY_PREFIX.length + 4), hash: hashApiKey(secret) };
}

function bearerToken(request: Request): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '');
  return match ? match[1]! : null;
}

/**
 * Resolves the caller from the request, or null if it carries no valid credentials: an API key
 * (`Authorization: Bearer ck_live_…`), else a signed-in person's session cookie (§13.2).
 */
export async function authenticate(db: Db, request: Request, now: Date, auth: Auth | null = null): Promise<Principal | null> {
  const token = bearerToken(request);
  if (!token) return auth ? sessionPrincipal(db, auth, request.headers) : null;
  if (!token.startsWith(KEY_PREFIX)) return null;

  const [key] = await db
    .select({ id: api_keys.id, name: api_keys.name, scopes: api_keys.scopes, workspace_id: workspaces.id, workspace_name: workspaces.name })
    .from(api_keys)
    .innerJoin(workspaces, eq(workspaces.id, api_keys.workspace_id))
    .where(and(eq(api_keys.key_hash, hashApiKey(token)), isNull(api_keys.revoked_at), or(isNull(api_keys.expires_at), gt(api_keys.expires_at, now))));
  if (!key) return null;

  // Record use at most once a minute, so a busy agent doesn't write on every request.
  await db
    .update(api_keys)
    .set({ last_used_at: now })
    .where(and(eq(api_keys.id, key.id), or(isNull(api_keys.last_used_at), lt(api_keys.last_used_at, sql`${now}::timestamptz - interval '1 minute'`))));

  return {
    kind: 'api_key',
    id: key.id,
    name: key.name,
    role: null,
    scopes: key.scopes.filter((scope): scope is Scope => scopeSchema.safeParse(scope).success),
    workspace: { id: key.workspace_id, name: key.workspace_name },
  };
}
