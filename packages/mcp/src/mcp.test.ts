import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { operations, type Operation } from '@catalyst/contract';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { describe, it } from 'vitest';

import { derivedIdempotencyKey, handleMcpRequest, toApiCall, type ApiCall, type Invoke } from './server.ts';
import { buildTools, visibleTools, wireTool } from './tools.ts';

const tools = buildTools(operations as readonly Operation[]);
const SNAPSHOT = fileURLToPath(new URL('./tools.snapshot.json', import.meta.url));

/** The parts of the tool list a harness depends on: names, inputs, annotations and toolsets. */
const snapshotOf = () =>
  tools.map((tool) => ({
    name: tool.name,
    toolset: tool.toolset,
    scopes: [...tool.scopes],
    annotations: tool.annotations,
    inputs: Object.keys(tool.inputSchema.properties as object).sort(),
    required: (tool.inputSchema.required as string[] | undefined) ?? [],
    output: tool.outputSchema ? Object.keys(tool.outputSchema.properties as object).sort() : null,
  }));

describe('tool generation (§14.2)', () => {
  it('matches the reviewed snapshot of the tool list (run with UPDATE_SNAPSHOTS=1 after a contract change)', () => {
    const current = snapshotOf();
    if (process.env.UPDATE_SNAPSHOTS) writeFileSync(SNAPSHOT, `${JSON.stringify(current, null, 2)}\n`);
    assert.deepEqual(current, JSON.parse(readFileSync(SNAPSHOT, 'utf8')));
  });

  it('makes one tool per operation, except those kept out of MCP', () => {
    const expected = operations.filter((operation) => operation.mcp !== false).map((operation) => operation.operationId);
    assert.equal(tools.length, expected.length);
    assert.ok(!tools.some((tool) => tool.name === 'get_open_api_document'));
    for (const tool of tools) {
      assert.match(tool.name, /^[a-z0-9_]{1,64}$/);
      assert.equal(tool.inputSchema.type, 'object');
      assert.ok(!JSON.stringify(tool.inputSchema).includes('$ref'), `${tool.name} input has a $ref`);
      if (tool.outputSchema) assert.ok(!JSON.stringify(tool.outputSchema).includes('$ref'), `${tool.name} output has a $ref`);
      assert.ok(tool.description.includes(tool.operation.description));
    }
  });

  it('flattens path, query, header and body inputs into one object', () => {
    const update = tools.find((tool) => tool.name === 'update_contact')!;
    const properties = Object.keys(update.inputSchema.properties as object);
    assert.ok(['contactId', 'if_match', 'email', 'first_name', 'custom_fields'].every((name) => properties.includes(name)));
    assert.deepEqual(update.inputSchema.required, ['contactId']);
    const list = tools.find((tool) => tool.name === 'list_contacts')!;
    assert.equal(list.inputSchema.required, undefined, 'limit has a default, so nothing is required');
    assert.deepEqual(wireTool(update).annotations, { title: 'Change fields on a contact', readOnlyHint: false, idempotentHint: true, destructiveHint: false, openWorldHint: false });
    assert.equal(tools.find((tool) => tool.name === 'erase_contact')!.annotations.destructiveHint, true);
  });

  it('hides tools the key has no scope for, and narrows by toolset', () => {
    const readOnly = visibleTools(tools, ['contacts:read']);
    assert.ok(readOnly.some((tool) => tool.name === 'list_contacts'));
    assert.ok(!readOnly.some((tool) => tool.name === 'create_contact' || tool.name === 'erase_contact'));
    assert.ok(!visibleTools(tools, ['contacts:read', 'contacts:write']).some((tool) => tool.name === 'erase_contact'));
    const admin = visibleTools(tools, ['contacts:read', 'contacts:write', 'settings:manage'], ['admin']);
    assert.ok(admin.length > 0 && admin.every((tool) => tool.toolset === 'admin'));
  });
});

describe('tool calls', () => {
  it('splits arguments back into an API call', () => {
    const update = tools.find((tool) => tool.name === 'update_contact')!;
    const call = toApiCall(update, { contactId: 'ctc_01jd3x5k8qf7tb9w2m4n6p8r0s', title: 'COO', if_match: '"abc"' }, new Date()) as ApiCall;
    assert.deepEqual([call.pathParams, call.query, call.headers, call.body], [{ contactId: 'ctc_01jd3x5k8qf7tb9w2m4n6p8r0s' }, {}, { 'if-match': '"abc"' }, { title: 'COO' }]);
    const list = tools.find((tool) => tool.name === 'list_contacts')!;
    const listCall = toApiCall(list, { limit: 5, filter: { field: 'city', op: 'eq', value: 'Lyon' } }, new Date()) as ApiCall;
    assert.deepEqual(listCall.query, { limit: '5', filter: '{"field":"city","op":"eq","value":"Lyon"}' });
    assert.deepEqual(toApiCall(list, { nope: 1 }, new Date()), { unknown: ['nope'] });
  });

  it('derives the same idempotency key for a retry within 10 minutes, and a new one after', () => {
    const at = (minute: number) => new Date(Date.UTC(2026, 10, 11, 9, minute));
    const args = { threadId: 'thr_1', body_text: 'Hi', mode: 'send_now' };
    assert.equal(derivedIdempotencyKey('create_reply', args, at(1)), derivedIdempotencyKey('create_reply', { mode: 'send_now', body_text: 'Hi', threadId: 'thr_1' }, at(9)));
    assert.notEqual(derivedIdempotencyKey('create_reply', args, at(1)), derivedIdempotencyKey('create_reply', args, at(11)));
    assert.notEqual(derivedIdempotencyKey('create_reply', args, at(1)), derivedIdempotencyKey('create_reply', { ...args, body_text: 'Hello' }, at(1)));
  });

  it('serves the tools over Streamable HTTP to the MCP client SDK, filtered by scope', async () => {
    const calls: ApiCall[] = [];
    const invoke: Invoke = async (call) => {
      calls.push(call);
      if (call.operation.operationId === 'getContact') return { status: 404, body: { code: 'not_found', status: 404, title: 'Not found' } };
      return { status: 200, body: { data: [], next_cursor: null } };
    };
    const client = new Client({ name: 'test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL('http://catalyst.test/api/mcp'), {
      fetch: (url, init) => handleMcpRequest(new Request(url, init), { tools, scopes: ['contacts:read'], invoke }),
    });
    await client.connect(transport);

    const listed = await client.listTools();
    assert.ok(listed.tools.some((tool) => tool.name === 'list_contacts'));
    assert.ok(!listed.tools.some((tool) => tool.name === 'create_contact'));

    const result = await client.callTool({ name: 'list_contacts', arguments: { q: 'globex' } });
    assert.deepEqual(result.structuredContent, { data: [], next_cursor: null });
    assert.deepEqual(calls[0]!.query, { q: 'globex' });

    const missing = await client.callTool({ name: 'get_contact', arguments: { contactId: 'ctc_01jd3x5k8qf7tb9w2m4n6p8r0s' } });
    assert.equal(missing.isError, true);
    assert.match((missing.content as { text: string }[])[0]!.text, /not_found/);

    const hidden = await client.callTool({ name: 'create_contact', arguments: { email: 'x@example.com' } });
    assert.equal(hidden.isError, true);
    assert.equal(calls.length, 2, 'a hidden tool never reaches the API');
    await client.close();
  });

  it('offers a prompt only when the caller can use every tool it names (§14.3)', async () => {
    const invoke: Invoke = async () => ({ status: 200, body: {} });
    const promptsFor = async (scopes: string[]) => {
      const client = new Client({ name: 'test', version: '1.0.0' });
      await client.connect(new StreamableHTTPClientTransport(new URL('http://catalyst.test/api/mcp'), { fetch: (url, init) => handleMcpRequest(new Request(url, init), { tools, scopes: scopes as never, invoke }) }));
      const capabilities = client.getServerCapabilities();
      const names = capabilities?.prompts ? (await client.listPrompts()).prompts.map((prompt) => prompt.name) : [];
      await client.close();
      return names;
    };
    assert.ok((await promptsFor(['threads:read'])).includes('triage_attention_queue'), 'get_work_queue and get_thread_context are both readable');
    assert.ok(!(await promptsFor(['contacts:read'])).includes('triage_attention_queue'));
    assert.ok((await promptsFor(['threads:read', 'analytics:read'])).includes('weekly_pipeline_review'));
    assert.ok(!(await promptsFor(['threads:read', 'campaigns:read'])).includes('weekly_pipeline_review'), 'needs analytics:read');
  });
});
