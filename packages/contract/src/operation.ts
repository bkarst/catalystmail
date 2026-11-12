// What an API operation is. Every route handler under /api/v1 is declared as one of these, and
// the OpenAPI document and the MCP tools are generated from the same declarations (spec D9).

import type { z } from 'zod';

import type { Scope } from './common.ts';

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

/** Groups of MCP tools (§14.2). */
export const TOOLSETS = ['contacts', 'campaigns', 'threads', 'escalations', 'knowledge', 'deliverability', 'analytics', 'admin'] as const;
export type Toolset = (typeof TOOLSETS)[number];

export const TAGS = ['Meta', 'Contacts', 'Companies', 'Tags', 'Lists', 'Imports', 'Custom fields', 'Suppressions', 'Campaigns', 'Threads', 'Escalations', 'Domains', 'Mailboxes', 'Deliverability', 'Webhooks', 'Integrations', 'Analytics', 'Knowledge', 'Settings'] as const;
export type Tag = (typeof TAGS)[number];

export interface Operation {
  /** camelCase verbNoun; becomes the snake_case MCP tool name. */
  operationId: string;
  method: HttpMethod;
  /** Path under `/api/v1`, with `{param}` placeholders. */
  path: string;
  tag: Tag;
  /** At most 80 characters. */
  summary: string;
  /** When to use it, its side effects, and related operations. */
  description: string;
  /**
   * Who may call it.
   * - `public`: no authentication.
   * - `authenticated`: any session or API key.
   * - `scoped`: an API key needs every scope in `scopes`; a session needs a role that grants them.
   * - `session`: a signed-in person only; never an API key.
   */
  access: 'public' | 'authenticated' | 'scoped' | 'session';
  scopes: readonly Scope[];
  params?: z.ZodObject;
  query?: z.ZodObject;
  body?: { schema: z.ZodType; example: unknown };
  /** Whether the operation takes an `Idempotency-Key` header. Required on POSTs that send email. */
  idempotencyKey?: 'optional' | 'required';
  /** Honors `If-Match` and answers 412 on a stale ETag. */
  ifMatch?: boolean;
  response: {
    status: 200 | 201 | 202 | 204;
    description: string;
    schema?: z.ZodType;
    example?: unknown;
    /** A non-JSON answer, such as `message/rfc822`: the handler returns the bytes, not an object. */
    mediaType?: string;
  };
  /** Error statuses beyond the standard ones (401, 403, 429, 500 and those implied by the inputs). */
  errors?: readonly (404 | 409 | 412 | 422 | 503)[];
  /**
   * How the operation appears as an MCP tool; `false` keeps it out of MCP. Read-only, idempotent
   * and destructive hints follow from the HTTP method unless set here.
   */
  mcp: false | { toolset: Toolset; destructive?: boolean; openWorld?: boolean };
}

/** Declares an operation, keeping its literal types. */
export function defineOperation<const T extends Operation>(operation: T): T {
  return operation;
}

/** MCP tool annotations for an operation (§14.2). */
export function mcpAnnotations(operation: Operation) {
  if (operation.mcp === false) return null;
  return {
    readOnlyHint: operation.method === 'get',
    idempotentHint: operation.method === 'put' || operation.method === 'patch',
    destructiveHint: operation.mcp.destructive ?? operation.method === 'delete',
    openWorldHint: operation.mcp.openWorld ?? false,
  };
}

/** The MCP tool name: the operationId in snake_case. */
export function toolName(operationId: string): string {
  return operationId.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}
