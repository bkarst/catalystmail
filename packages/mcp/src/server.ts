// The MCP server (spec §14.3): Streamable HTTP, stateless, authenticated per request. Each tool call
// becomes a call to the matching API operation through `invoke`, so tools and HTTP clients share
// one implementation: the same validation, scopes, idempotency and problem documents.

import { createHash } from 'node:crypto';

import type { Operation } from '@catalyst/contract';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';

import { PROMPTS, RESOURCE_TEMPLATES } from './catalog.ts';
import { HEADER_INPUTS, visibleTools, wireTool, type ToolDefinition } from './tools.ts';

export interface ApiCall {
  operation: Operation;
  pathParams: Record<string, string>;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: unknown;
}

/** Calls an API operation as the authenticated caller and returns its status and JSON body. */
export type Invoke = (call: ApiCall) => Promise<{ status: number; body: unknown }>;

export interface McpContext {
  tools: readonly ToolDefinition[];
  /** The caller's scopes; tools needing others are hidden (§14.3). */
  scopes: readonly string[];
  /** `?toolsets=threads,escalations`; empty means all. */
  toolsets?: readonly string[];
  invoke: Invoke;
  now?: () => Date;
  version?: string;
}

const IDEMPOTENCY_BUCKET_MS = 10 * 60 * 1000;

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * The key used when a sending tool is called without one: the same tool with the same arguments
 * in the same 10-minute window gets the same key, so an agent's retry can't send twice (§14.2).
 */
export function derivedIdempotencyKey(toolName: string, args: Record<string, unknown>, now: Date): string {
  const bucket = Math.floor(now.getTime() / IDEMPOTENCY_BUCKET_MS);
  return `mcp_${createHash('sha256').update(`${toolName}\n${stableStringify(args)}\n${bucket}`).digest('base64url').slice(0, 40)}`;
}

const asQueryValue = (value: unknown) => (typeof value === 'string' ? value : typeof value === 'object' ? JSON.stringify(value) : String(value));

/** Splits flat tool arguments back into the parts of an API call. */
export function toApiCall(tool: ToolDefinition, args: Record<string, unknown>, now: Date): ApiCall | { unknown: string[] } {
  const known = new Set([...tool.input.path, ...tool.input.query, ...tool.input.body, ...Object.values(HEADER_INPUTS)]);
  const unknown = Object.keys(args).filter((key) => !known.has(key));
  if (unknown.length > 0) return { unknown };

  const pathParams: Record<string, string> = {};
  const query: Record<string, string> = {};
  const headers: Record<string, string> = {};
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined) continue;
    if (tool.input.path.includes(key)) pathParams[key] = String(value);
    else if (tool.input.query.includes(key)) query[key] = asQueryValue(value);
    else if (tool.input.body.includes(key)) body[key] = value;
  }
  const operation = tool.operation;
  const idempotencyKey = args[HEADER_INPUTS['Idempotency-Key']];
  if (operation.idempotencyKey && typeof idempotencyKey === 'string') headers['idempotency-key'] = idempotencyKey;
  else if (operation.idempotencyKey && (operation.idempotencyKey === 'required' || tool.annotations.openWorldHint)) {
    headers['idempotency-key'] = derivedIdempotencyKey(tool.name, args, now);
  }
  const ifMatch = args[HEADER_INPUTS['If-Match']];
  if (operation.ifMatch && typeof ifMatch === 'string') headers['if-match'] = ifMatch;
  return { operation, pathParams, query, headers, body: operation.body ? body : undefined };
}

const text = (value: unknown) => ({ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) });

async function callTool(context: McpContext, visible: ToolDefinition[], name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const tool = visible.find((entry) => entry.name === name);
  if (!tool) {
    return { isError: true, content: [text({ code: 'not_found', title: 'Unknown tool', detail: `There is no tool named ${name} available to this API key.` })] };
  }
  const call = toApiCall(tool, args, context.now?.() ?? new Date());
  if ('unknown' in call) {
    return {
      isError: true,
      content: [text({ code: 'validation_failed', title: 'Validation failed', status: 400, errors: call.unknown.map((key) => ({ path: key, message: 'Unknown argument.' })) })],
    };
  }
  const result = await context.invoke(call);
  if (result.status >= 400) return { isError: true, content: [text(result.body)] };
  if (result.body === null || result.body === undefined) return { content: [text({ ok: true, status: result.status })] };
  return { content: [text(result.body)], structuredContent: result.body as Record<string, unknown> };
}

/** An MCP server for one request, scoped to one caller. */
export function createMcpServer(context: McpContext): Server {
  const visible = visibleTools(context.tools, context.scopes, context.toolsets);
  const available = new Set(visible.map((tool) => tool.name));
  const prompts = PROMPTS.filter((prompt) => prompt.tools.every((name) => available.has(name)));
  const templates = RESOURCE_TEMPLATES.filter((template) => available.has(template.tool));

  const server = new Server(
    { name: 'catalyst', version: context.version ?? '1.0.0' },
    {
      capabilities: { tools: {}, ...(templates.length > 0 && { resources: {} }), ...(prompts.length > 0 && { prompts: {} }) },
      instructions:
        'Catalyst runs personal outreach email campaigns. Tools map 1:1 to its API. Read before you write, never send email unless the user asked you to, and prefer the aggregate tools (get_work_queue, get_thread_context) when they are available.',
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: visible.map(wireTool) }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => callTool(context, visible, request.params.name, (request.params.arguments ?? {}) as Record<string, unknown>));

  if (templates.length > 0) {
    server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [] }));
    server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
      resourceTemplates: templates.map(({ uriTemplate, name, description }) => ({ uriTemplate, name, description, mimeType: 'application/json' })),
    }));
    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      for (const template of templates) {
        const match = template.pattern.exec(request.params.uri);
        if (!match) continue;
        const result = await callTool(context, visible, template.tool, { ...match.groups });
        if (result.isError) throw new Error((result.content[0] as { text: string }).text);
        return { contents: [{ uri: request.params.uri, mimeType: 'application/json', text: (result.content[0] as { text: string }).text }] };
      }
      throw new Error(`Unknown resource ${request.params.uri}`);
    });
  }

  if (prompts.length > 0) {
    server.setRequestHandler(ListPromptsRequestSchema, async () => ({
      prompts: prompts.map(({ name, description, arguments: args }) => ({ name, description, arguments: args })),
    }));
    server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      const prompt = prompts.find((entry) => entry.name === request.params.name);
      if (!prompt) throw new Error(`Unknown prompt ${request.params.name}`);
      return { description: prompt.description, messages: [{ role: 'user', content: { type: 'text', text: prompt.render(request.params.arguments ?? {}) } }] };
    });
  }
  return server;
}

/** Answers one Streamable HTTP request (POST, GET or DELETE on `/api/mcp`). */
export async function handleMcpRequest(request: Request, context: McpContext): Promise<Response> {
  const server = createMcpServer(context);
  // Stateless: no session IDs, and JSON answers rather than an SSE stream.
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await transport.close();
    await server.close();
  }
}
