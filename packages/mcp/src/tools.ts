// OpenAPI → MCP mapping (spec §14.2). Every operation in the contract becomes one tool, unless it
// is marked `mcp: false`. Inputs are flattened into one object: path, query and header parameters
// plus the body's properties, which the contract guarantees never collide.

import { mcpAnnotations, toolName, type Operation, type Scope, type Toolset } from '@catalyst/contract';
import { z } from 'zod';

type JsonSchema = Record<string, unknown>;

/** Header parameters appear under friendlier names in tool inputs. */
export const HEADER_INPUTS = { 'Idempotency-Key': 'idempotency_key', 'If-Match': 'if_match' } as const;

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema & { type: 'object' };
  outputSchema?: JsonSchema & { type: 'object' };
  annotations: { title: string; readOnlyHint: boolean; idempotentHint: boolean; destructiveHint: boolean; openWorldHint: boolean };
  /** Not part of the MCP tool: how to turn arguments back into an API call. */
  operation: Operation;
  toolset: Toolset;
  scopes: readonly Scope[];
  input: { path: string[]; query: string[]; body: string[] };
}

/** Replaces every `$ref` to `#/$defs/…` with the definition, so each tool schema stands alone. */
function inline(node: unknown, defs: Record<string, unknown>, seen: string[] = []): unknown {
  if (Array.isArray(node)) return node.map((entry) => inline(entry, defs, seen));
  if (node === null || typeof node !== 'object') return node;
  const object = node as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  const ref = typeof object.$ref === 'string' ? /^#\/\$defs\/(.+)$/.exec(object.$ref)?.[1] : undefined;
  if (ref !== undefined) {
    if (seen.includes(ref)) throw new Error(`Recursive schema ${ref} cannot be inlined`);
    Object.assign(result, inline(defs[ref], defs, [...seen, ref]));
  }
  for (const [key, value] of Object.entries(object)) {
    if (key === '$ref' && ref !== undefined) continue;
    if (key === '$defs' || key === '$schema') continue;
    result[key] = inline(value, defs, seen);
  }
  return result;
}

export function toJsonSchema(schema: z.ZodType, io: 'input' | 'output'): JsonSchema {
  const raw = z.toJSONSchema(schema, { io, unrepresentable: 'any' }) as JsonSchema;
  return inline(raw, (raw.$defs as Record<string, unknown>) ?? {}) as JsonSchema;
}

function objectProperties(schema: z.ZodType | undefined, io: 'input' | 'output'): { properties: Record<string, JsonSchema>; required: string[] } {
  if (!schema) return { properties: {}, required: [] };
  const json = toJsonSchema(schema, io);
  if (json.type !== 'object') throw new Error('Expected an object schema');
  return { properties: (json.properties as Record<string, JsonSchema>) ?? {}, required: (json.required as string[]) ?? [] };
}

function describe(operation: Operation): string {
  const parts = [operation.summary + '.', operation.description];
  if (operation.scopes.length > 0) parts.push(`Requires the scope${operation.scopes.length > 1 ? 's' : ''} ${operation.scopes.join(', ')}.`);
  if (operation.idempotencyKey === 'required') parts.push('Pass `idempotency_key` so a retry never acts twice; one is derived for you if you leave it out.');
  if (operation.body) parts.push(`Example input: ${JSON.stringify(operation.body.example)}`);
  return parts.join('\n\n');
}

export function toolFor(operation: Operation): ToolDefinition | null {
  if (operation.mcp === false || operation.access === 'public' || operation.access === 'session') return null;
  const path = objectProperties(operation.params, 'input');
  const query = objectProperties(operation.query, 'input');
  const body = objectProperties(operation.body?.schema, 'input');

  const properties: Record<string, JsonSchema> = { ...path.properties, ...query.properties, ...body.properties };
  const required = [...path.required, ...query.required.filter((name) => !('default' in (query.properties[name] ?? {}))), ...body.required];
  if (operation.idempotencyKey) {
    properties[HEADER_INPUTS['Idempotency-Key']] = {
      type: 'string',
      maxLength: 128,
      description: 'A unique key for this call. Repeating it within 24 hours returns the first result instead of acting twice.',
    };
  }
  if (operation.ifMatch) {
    properties[HEADER_INPUTS['If-Match']] = { type: 'string', description: 'The ETag from your last read. The change is refused if the resource changed since.' };
  }

  const annotations = mcpAnnotations(operation)!;
  const response = operation.response.schema ? toJsonSchema(operation.response.schema, 'output') : undefined;
  return {
    name: toolName(operation.operationId),
    title: operation.summary,
    description: describe(operation),
    inputSchema: { type: 'object', properties, ...(required.length > 0 && { required }), additionalProperties: false },
    ...(response?.type === 'object' && { outputSchema: response as JsonSchema & { type: 'object' } }),
    annotations: { title: operation.summary, ...annotations },
    operation,
    toolset: operation.mcp.toolset,
    scopes: operation.scopes,
    input: { path: Object.keys(path.properties), query: Object.keys(query.properties), body: Object.keys(body.properties) },
  };
}

export function buildTools(operations: readonly Operation[]): ToolDefinition[] {
  return operations.map(toolFor).filter((tool): tool is ToolDefinition => tool !== null);
}

/** The tools a caller may see: every scope the tool needs is held, and its toolset was asked for (§14.3). */
export function visibleTools(tools: readonly ToolDefinition[], scopes: readonly string[], toolsets?: readonly string[]): ToolDefinition[] {
  return tools.filter((tool) => tool.scopes.every((scope) => scopes.includes(scope)) && (!toolsets || toolsets.length === 0 || toolsets.includes(tool.toolset)));
}

/** What a tool definition looks like on the wire, without Catalyst's own bookkeeping. */
export function wireTool(tool: ToolDefinition) {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    ...(tool.outputSchema && { outputSchema: tool.outputSchema }),
    annotations: tool.annotations,
  };
}
