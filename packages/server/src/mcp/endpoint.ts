// The MCP endpoint (spec §14.3): authenticates the API key, then serves the tools that key may use.
// A tool call goes through the same route handler as the HTTP API, so nothing behaves differently.

import { randomUUID } from 'node:crypto';

import { API_BASE_PATH, operations, type Operation } from '@catalyst/contract';
import { buildTools, handleMcpRequest, type ApiCall, type ToolDefinition } from '@catalyst/mcp';

import { authenticate } from '../api/auth.ts';
import { ApiError, problemResponse } from '../api/errors.ts';
import { route } from '../api/handlers.ts';
import { getDb } from '../runtime.ts';

let tools: ToolDefinition[] | undefined;
const allTools = () => (tools ??= buildTools(operations as readonly Operation[]));

function apiRequest(call: ApiCall, authorization: string): Request {
  const path = call.operation.path.replace(/\{(\w+)\}/g, (_, name: string) => encodeURIComponent(call.pathParams[name] ?? ''));
  const url = new URL(`http://catalyst.internal${API_BASE_PATH}${path}`);
  for (const [name, value] of Object.entries(call.query)) url.searchParams.set(name, value);
  const headers = new Headers({ ...call.headers, authorization });
  const init: RequestInit = { method: call.operation.method.toUpperCase(), headers };
  if (call.body !== undefined) {
    headers.set('content-type', 'application/json');
    init.body = JSON.stringify(call.body);
  }
  return new Request(url, init);
}

export async function mcpEndpoint(request: Request): Promise<Response> {
  const principal = await authenticate(getDb(), request, new Date());
  if (!principal) {
    return problemResponse(new ApiError(401, 'unauthorized', 'Send an API key as `Authorization: Bearer ck_live_…`.'), `req_${randomUUID()}`, { 'www-authenticate': 'Bearer' });
  }
  const authorization = request.headers.get('authorization')!;
  const toolsets = new URL(request.url).searchParams.get('toolsets')?.split(',').map((name) => name.trim()).filter(Boolean);

  return handleMcpRequest(request, {
    tools: allTools(),
    scopes: principal.scopes,
    ...(toolsets && { toolsets }),
    invoke: async (call) => {
      const response = await route(call.operation.operationId as Parameters<typeof route>[0])(apiRequest(call, authorization), {
        params: Promise.resolve(call.pathParams),
      });
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : null };
    },
  });
}
