// Test support: seeds a workspace with API keys, and calls operations through the same route
// factory the Next.js route files use.

import { operations, type Scope } from '@catalyst/contract';
import { api_keys, newId, workspaces, type Db } from '@catalyst/db';

import { generateApiKey } from './auth.ts';
import { route } from './handlers.ts';

export async function seedWorkspace(db: Db, name: string) {
  const id = newId('workspace');
  await db.insert(workspaces).values({ id, name, physical_address: '500 Howard St, San Francisco' });
  return id;
}

/** Creates an API key and returns its secret. */
export async function seedApiKey(db: Db, workspaceId: string, scopes: Scope[], overrides: Partial<typeof api_keys.$inferInsert> = {}) {
  const key = generateApiKey();
  const id = newId('api_key');
  await db.insert(api_keys).values({ id, workspace_id: workspaceId, name: 'Test key', prefix: key.prefix, key_hash: key.hash, scopes, ...overrides });
  return { id, secret: key.secret };
}

export interface CallOptions {
  key?: string;
  body?: unknown;
  rawBody?: string;
  headers?: Record<string, string>;
  /** Leave the body unread and return it as `stream` (for event streams, which never end). */
  raw?: boolean;
}

/** Calls `METHOD /path?query` as an HTTP client would, and returns the response with its parsed body. */
export async function call(method: string, pathAndQuery: string, options: CallOptions = {}) {
  const url = new URL(`http://catalyst.test/api/v1${pathAndQuery}`);
  const path = url.pathname.slice('/api/v1'.length);

  // Literal segments win over placeholders, as in Next.js routing: `/contacts/duplicates` before `/contacts/{contactId}`.
  const candidates = [...operations].sort((a, b) => (a.path.match(/\{/g)?.length ?? 0) - (b.path.match(/\{/g)?.length ?? 0));
  for (const operation of candidates) {
    if (operation.method.toUpperCase() !== method) continue;
    const pattern = new RegExp(`^${operation.path.replace(/\{(\w+)\}/g, '(?<$1>[^/]+)')}$`);
    const match = pattern.exec(path);
    if (!match) continue;

    const headers = new Headers(options.headers);
    if (options.key) headers.set('authorization', `Bearer ${options.key}`);
    const body = options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
    if (body !== undefined) headers.set('content-type', 'application/json');
    const response = await route(operation.operationId)(new Request(url, { method, headers, ...(body !== undefined && { body }) }), {
      params: Promise.resolve({ ...match.groups }),
    });
    if (options.raw) return { status: response.status, headers: response.headers, body: null, stream: response.body };
    const text = await response.text();
    return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null, stream: null };
  }
  throw new Error(`No operation matches ${method} ${path}`);
}
