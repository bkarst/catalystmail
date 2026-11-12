import assert from 'node:assert/strict';

import { activities, newId, pgActivityFeed, type ActivityFeed, type Db } from '@catalyst/db';
import { createTestDatabase } from '@catalyst/db/testing';
import { MemoryQueue } from '@catalyst/jobs';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { call, seedApiKey, seedWorkspace } from '../api/testing.ts';
import { setDb, setDeps } from '../runtime.ts';
import { openEventStream } from './stream.ts';

// Needs a PostgreSQL server: set TEST_DATABASE_URL to any database on it.
const adminUrl = process.env.TEST_DATABASE_URL;

/** Reads the stream's events until `count` have arrived (or a second passes). */
async function collect(stream: ReadableStream<Uint8Array>, count: number): Promise<{ id: string; event: string; data: { id: string; type: string } }[]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = '';
  const events = () => text.split('\n\n').filter((block) => block.startsWith('id: '));
  const deadline = Date.now() + 2000;
  while (events().length < count && Date.now() < deadline) {
    const next = await Promise.race([reader.read(), new Promise<null>((resolve) => setTimeout(() => resolve(null), deadline - Date.now()))]);
    if (!next || next.done) break;
    text += decoder.decode(next.value, { stream: true });
  }
  await reader.cancel();
  return events().map((block) => {
    const field = (name: string) => block.split('\n').find((line) => line.startsWith(`${name}: `))!.slice(name.length + 2);
    return { id: field('id'), event: field('event'), data: JSON.parse(field('data')) };
  });
}

describe.skipIf(!adminUrl)('live activity as server-sent events (§4.2, streamEvents)', () => {
  let db: Db;
  let drop: () => Promise<void>;
  let feed: ActivityFeed;
  let workspaceId: string;
  let otherWorkspaceId: string;
  const log = (workspace: string, type: string) => {
    const id = newId('activity');
    return db.insert(activities).values({ id, workspace_id: workspace, type, actor_type: 'system', data: {}, occurred_at: new Date() }).then(() => id);
  };

  beforeAll(async () => {
    let url: string;
    ({ db, drop, url } = await createTestDatabase(adminUrl!));
    feed = pgActivityFeed(url);
    workspaceId = await seedWorkspace(db, 'Acme');
    otherWorkspaceId = await seedWorkspace(db, 'Other');
  });
  afterAll(async () => {
    setDb(undefined);
    setDeps(undefined);
    await feed?.close();
    await drop?.();
  });

  it('streams each new activity of the workspace as it is written, and none of another’s', async () => {
    const stream = openEventStream(db, feed, workspaceId, { lastEventId: null });
    const reading = collect(stream, 2);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const first = await log(workspaceId, 'thread.stage_changed');
    await log(otherWorkspaceId, 'thread.stage_changed');
    const second = await log(workspaceId, 'message.received');
    const events = await reading;
    assert.deepEqual(events.map((event) => [event.id, event.event, event.data.id]), [[first, 'thread.stage_changed', first], [second, 'message.received', second]]);
  });

  it('replays what a reconnecting client missed, after its Last-Event-ID, once', async () => {
    const seen = await log(workspaceId, 'thread.paused');
    const missed = [await log(workspaceId, 'thread.resumed'), await log(workspaceId, 'thread.closed')];
    await log(otherWorkspaceId, 'thread.closed');
    const events = await collect(openEventStream(db, feed, workspaceId, { lastEventId: seen }), 3);
    assert.deepEqual(events.map((event) => event.id), missed, 'only the two missed, in order; nothing from the other workspace');
  });

  it('is served by the API to any key, as text/event-stream', async () => {
    setDb(db);
    setDeps({ jobs: new MemoryQueue(), activityFeed: feed, config: { trackingTarget: null, appHost: null } });
    const { secret: key } = await seedApiKey(db, workspaceId, []);
    const response = await call('GET', '/events/stream', { key, raw: true });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/event-stream');
    assert.equal(response.headers.get('cache-control'), 'no-cache, no-transform');
    await response.stream!.cancel();
    assert.equal((await call('GET', '/events/stream', { raw: true })).status, 401);
  });
});
