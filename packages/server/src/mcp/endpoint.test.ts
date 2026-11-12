import assert from 'node:assert/strict';

import { contacts, type Db } from '@catalyst/db';
import { createTestDatabase } from '@catalyst/db/testing';
import { MemoryQueue } from '@catalyst/jobs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { seedApiKey, seedWorkspace } from '../api/testing.ts';
import { setDb, setDeps } from '../runtime.ts';
import { mcpEndpoint } from './endpoint.ts';

// Needs a PostgreSQL server: set TEST_DATABASE_URL to any database on it.
const adminUrl = process.env.TEST_DATABASE_URL;

async function connect(secret: string, query = '') {
  const client = new Client({ name: 'claude-code-test', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`http://catalyst.test/api/mcp${query}`), {
    requestInit: { headers: { authorization: `Bearer ${secret}` } },
    fetch: (url, init) => mcpEndpoint(new Request(url, init)),
  });
  await client.connect(transport);
  return client;
}

describe.skipIf(!adminUrl)('MCP endpoint (§14.3, §19.8)', () => {
  let db: Db;
  const jobs = new MemoryQueue();
  let drop: () => Promise<void>;
  let draftOnly: string;
  let readOnly: string;

  beforeAll(async () => {
    ({ db, drop } = await createTestDatabase(adminUrl!));
    setDb(db);
    setDeps({ jobs });
    const workspaceId = await seedWorkspace(db, 'Acme');
    // The "Agent: draft only" preset (§13.2), as far as the operations built so far go.
    ({ secret: draftOnly } = await seedApiKey(db, workspaceId, ['contacts:read', 'contacts:write', 'threads:read', 'threads:write']));
    ({ secret: readOnly } = await seedApiKey(db, workspaceId, ['contacts:read']));
  });
  afterAll(async () => {
    setDb(undefined);
    await drop?.();
  });

  it('refuses a request without a valid key', async () => {
    const response = await mcpEndpoint(new Request('http://catalyst.test/api/mcp', { method: 'POST', body: '{}' }));
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('www-authenticate'), 'Bearer');
  });

  it('lists only the tools the key may use, and only the toolsets asked for', async () => {
    const client = await connect(draftOnly);
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    assert.ok(names.includes('create_contact') && names.includes('list_contacts'));
    assert.ok(!names.includes('erase_contact'), 'erasing needs contacts:erase');
    assert.ok(!names.includes('create_custom_field'), 'custom fields need settings:manage');
    await client.close();

    const narrow = await connect(readOnly, '?toolsets=admin');
    assert.deepEqual((await narrow.listTools()).tools.map((tool) => tool.name), ['get_current_principal']);
    await narrow.close();
  });

  it('creates and finds a contact through tools, with problem documents as tool errors', async () => {
    const client = await connect(draftOnly);
    const created = await client.callTool({ name: 'create_contact', arguments: { email: 'Priya@Globex.com', first_name: 'Priya', idempotency_key: 'mcp-test-1' } });
    assert.equal(created.isError, undefined, JSON.stringify(created.content));
    const contact = created.structuredContent as { id: string; email: string };
    assert.equal(contact.email, 'priya@globex.com');

    const replay = await client.callTool({ name: 'create_contact', arguments: { email: 'Priya@Globex.com', first_name: 'Priya', idempotency_key: 'mcp-test-1' } });
    assert.deepEqual(replay.structuredContent, created.structuredContent, 'the same key replays instead of failing on the duplicate');
    assert.equal((await db.select().from(contacts).where(eq(contacts.email, 'priya@globex.com'))).length, 1);

    const found = await client.callTool({ name: 'list_contacts', arguments: { q: 'priya' } });
    assert.deepEqual((found.structuredContent as { data: { id: string }[] }).data.map((entry) => entry.id), [contact.id]);

    const updated = await client.callTool({ name: 'update_contact', arguments: { contactId: contact.id, title: 'VP Operations' } });
    assert.equal((updated.structuredContent as { title: string }).title, 'VP Operations');

    const duplicate = await client.callTool({ name: 'create_contact', arguments: { email: 'priya@globex.com' } });
    assert.equal(duplicate.isError, true);
    const problem = JSON.parse((duplicate.content as { text: string }[])[0]!.text);
    assert.deepEqual([problem.status, problem.code], [409, 'conflict']);

    const invalid = await client.callTool({ name: 'create_contact', arguments: { email: 'not-an-email' } });
    assert.equal(JSON.parse((invalid.content as { text: string }[])[0]!.text).code, 'validation_failed');
    await client.close();
  });
});
