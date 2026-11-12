// API keys (spec §13.2, §13.4): listed, made and revoked by an owner or admin in a signed-in
// session. Making or revoking one is not an MCP tool (†): a key can't mint another.

import { z } from 'zod';

import { id, scopeSchema, timestamp } from '../common.ts';
import { defineOperation } from '../operation.ts';

const apiKeySchema = z
  .object({
    id: id('api_key'),
    name: z.string().meta({ description: 'What it is for.', examples: ['Claude Code (draft only)'] }),
    prefix: z.string().meta({ description: 'The first characters of the secret, to recognise it by.', examples: ['ck_live_9F2a'] }),
    scopes: z.array(scopeSchema).meta({ description: 'What it may do (§13.2).' }),
    created_by: id('user', 'Who made it.').nullable(),
    last_used_at: timestamp('When it last authenticated a request (to the minute).').nullable(),
    expires_at: timestamp('When it stops working, if it does.').nullable(),
    revoked_at: timestamp('When it was revoked.').nullable(),
    created_at: timestamp('When it was made.'),
  })
  .meta({ id: 'ApiKey', description: 'An API key. The secret is shown once, when it is made; only its hash is kept.' });
const example = { id: 'key_01jd3x5k8qf7tb9w2m4n6p8r0s', name: 'Claude Code (draft only)', prefix: 'ck_live_9F2a', scopes: ['threads:read' as const, 'threads:write' as const], created_by: 'usr_01jd3x5k8qf7tb9w2m4n6p8r0s', last_used_at: null, expires_at: null, revoked_at: null, created_at: '2026-11-10T09:00:00Z' };

export const listApiKeys = defineOperation({
  operationId: 'listApiKeys',
  method: 'get',
  path: '/api-keys',
  tag: 'Settings',
  summary: 'List the workspace’s API keys',
  description: 'Every key with its scopes and when it was last used; revoked keys only with `include_revoked=true`. Never the secrets. For owners and admins, signed in.',
  access: 'session',
  scopes: [],
  query: z.object({ include_revoked: z.stringbool().optional().meta({ description: 'Also list revoked keys.' }) }),
  response: { status: 200, description: 'The keys.', schema: z.object({ data: z.array(apiKeySchema) }).meta({ id: 'ApiKeyList' }), example: { data: [example] } },
  // Session-only, and MCP clients sign in with a key, so it can't be a tool.
  mcp: false,
});

export const createApiKey = defineOperation({
  operationId: 'createApiKey',
  method: 'post',
  path: '/api-keys',
  tag: 'Settings',
  summary: 'Make an API key',
  description: 'Makes a key with the given scopes and returns its secret, the only time it is shown. Give an agent the narrowest scopes it needs, e.g. threads read and write without messages:send for draft-only (§14.2). For owners and admins, signed in; not an MCP tool.',
  access: 'session',
  scopes: [],
  body: {
    schema: z
      .strictObject({
        name: z.string().trim().min(1).max(100).meta({ description: 'What it is for.', examples: ['Claude Code (draft only)'] }),
        scopes: z.array(scopeSchema).min(1).meta({ description: 'What it may do.' }),
        expires_at: z.iso.datetime().optional().meta({ description: 'When it stops working; never, if left out.' }),
      })
      .meta({ id: 'CreateApiKey' }),
    example: { name: 'Claude Code (draft only)', scopes: ['threads:read', 'threads:write'] },
  },
  response: { status: 201, description: 'The key, with its secret.', schema: apiKeySchema.extend({ secret: z.string().meta({ description: 'The key itself, `ck_live_…`. Shown once: store it now.' }) }).meta({ id: 'CreatedApiKey' }), example: { ...example, secret: 'ck_live_9F2a…' } },
  mcp: false,
});

export const revokeApiKey = defineOperation({
  operationId: 'revokeApiKey',
  method: 'delete',
  path: '/api-keys/{keyId}',
  tag: 'Settings',
  summary: 'Revoke an API key',
  description: 'The key stops working at once. It stays listed (with `include_revoked=true`) for the audit trail. For owners and admins, signed in; not an MCP tool.',
  access: 'session',
  scopes: [],
  params: z.object({ keyId: id('api_key', 'The key.') }),
  response: { status: 200, description: 'The revoked key.', schema: apiKeySchema, example: { ...example, revoked_at: '2026-11-11T09:00:00Z' } },
  errors: [404, 409],
  mcp: false,
});
