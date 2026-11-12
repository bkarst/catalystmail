import assert from 'node:assert/strict';

import { rate_limit_windows, type Db } from '@catalyst/db';
import { createTestDatabase } from '@catalyst/db/testing';
import { MemoryQueue } from '@catalyst/jobs';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { setDb, setDeps } from '../runtime.ts';
import { purgeRateLimitWindows } from './rate-limit.ts';
import { call, seedApiKey, seedWorkspace } from './testing.ts';

// Needs a PostgreSQL server: set TEST_DATABASE_URL to any database on it.
const adminUrl = process.env.TEST_DATABASE_URL;
/** The windows are calendar minutes: start well inside one, so a test never straddles two. */
const freshMinute = async () => {
  const into = Date.now() % 60_000;
  if (into > 55_000) await new Promise((resolve) => setTimeout(resolve, 60_100 - into));
};

describe.skipIf(!adminUrl)('rate limits per key (§13.3)', () => {
  let db: Db;
  let drop: () => Promise<void>;

  beforeAll(async () => {
    ({ db, drop } = await createTestDatabase(adminUrl!));
    setDb(db);
    setDeps({ jobs: new MemoryQueue(), config: { trackingTarget: null, appHost: null, rateLimits: { perMinute: 3, sendPerMinute: 1 } } });
  });
  afterAll(async () => {
    setDb(undefined);
    setDeps(undefined);
    await drop?.();
  });

  it('counts each key’s requests a minute, says so on every response, and answers 429 past the limit', async () => {
    await freshMinute();
    const workspaceId = await seedWorkspace(db, 'Acme');
    const { secret: key } = await seedApiKey(db, workspaceId, []);
    const { secret: other } = await seedApiKey(db, workspaceId, []);
    const remaining: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const response = await call('GET', '/me', { key });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('ratelimit-limit'), '3');
      remaining.push(response.headers.get('ratelimit-remaining')!);
      assert.ok(Number(response.headers.get('ratelimit-reset')) <= 60);
    }
    assert.deepEqual(remaining, ['2', '1', '0']);
    const refused = await call('GET', '/me', { key });
    assert.deepEqual([refused.status, refused.body.code], [429, 'rate_limited']);
    assert.ok(Number(refused.headers.get('retry-after')) >= 1);
    assert.equal(refused.headers.get('ratelimit-remaining'), '0');
    assert.equal((await call('GET', '/me', { key: other })).status, 200, 'each key has its own count');
    assert.equal((await call('GET', '/me')).headers.get('ratelimit-limit'), null, 'no key, nothing to count');
  });

  it('holds sending operations to their own, lower limit', async () => {
    await freshMinute();
    const workspaceId = await seedWorkspace(db, 'Sender');
    const { secret: key } = await seedApiKey(db, workspaceId, ['threads:write', 'messages:send']);
    // Counted once the caller is known, before the request is even read: a bad one counts too.
    const first = await call('POST', '/threads/thr_01jd3x5k8qf7tb9w2m4n6p8r0s/replies', { key, body: {} });
    assert.deepEqual([first.status, first.headers.get('ratelimit-limit'), first.headers.get('ratelimit-remaining')], [400, '1', '0']);
    assert.equal((await call('POST', '/threads/thr_01jd3x5k8qf7tb9w2m4n6p8r0s/replies', { key, body: {} })).status, 429);
    assert.equal((await call('GET', '/me', { key })).status, 200, 'other operations still have room');
  });

  it('forgets windows older than an hour', async () => {
    const now = new Date();
    await db.insert(rate_limit_windows).values({ key: 'old:general', window_start: new Date(now.getTime() - 2 * 3_600_000), count: 9 });
    assert.ok((await purgeRateLimitWindows(db, now)) >= 1);
    assert.equal((await db.select().from(rate_limit_windows)).some((row) => row.key === 'old:general'), false);
  });
});
