import assert from 'node:assert/strict';

import { type Db } from '@catalyst/db';
import { createTestDatabase } from '@catalyst/db/testing';
import { MemoryQueue } from '@catalyst/jobs';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { call, seedApiKey, seedWorkspace } from '../api/testing.ts';
import { raiseEscalation } from '../escalations/raise.ts';
import { setDb, setDeps } from '../runtime.ts';

// Needs a PostgreSQL server: set TEST_DATABASE_URL to any database on it.
const adminUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!adminUrl)('workspace settings (§15.18)', () => {
  let db: Db;
  let drop: () => Promise<void>;
  let workspaceId: string;
  let key: string;

  beforeAll(async () => {
    ({ db, drop } = await createTestDatabase(adminUrl!));
    setDb(db);
    setDeps({ jobs: new MemoryQueue(), config: { trackingTarget: null, appHost: null } });
    workspaceId = await seedWorkspace(db, 'Acme');
    ({ secret: key } = await seedApiKey(db, workspaceId, ['settings:manage']));
  });
  afterAll(async () => {
    setDb(undefined);
    setDeps(undefined);
    await drop?.();
  });

  it('reads and changes the settings, checking the timezone, the hours and If-Match', async () => {
    const current = await call('GET', '/settings', { key });
    assert.equal(current.status, 200, JSON.stringify(current.body));
    assert.deepEqual([current.body.default_timezone, current.body.business_hours], ['UTC', { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' }]);
    assert.equal((await call('PATCH', '/settings', { key, body: { default_timezone: 'Mars/Olympus' } })).status, 400);
    assert.equal((await call('PATCH', '/settings', { key, body: { business_hours: { days: [1], start: '17:00', end: '09:00' } } })).status, 400);
    assert.equal((await call('PATCH', '/settings', { key, body: { name: 'Acme Inc' }, headers: { 'if-match': '"stale"' } })).status, 412);
    const changed = await call('PATCH', '/settings', { key, body: { name: 'Acme Inc', default_timezone: 'Europe/Berlin', business_hours: { days: [7, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59' } }, headers: { 'if-match': current.headers.get('etag')! } });
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    assert.deepEqual([changed.body.name, changed.body.default_timezone, changed.body.business_hours.days], ['Acme Inc', 'Europe/Berlin', [1, 2, 3, 4, 5, 6, 7]]);
  });

  it('counts escalation SLAs in the workspace’s business hours', async () => {
    // A Saturday at noon in Berlin: with every day open, an urgent escalation is due 2 hours later.
    const saturday = new Date('2026-11-14T11:00:00Z');
    const { id } = await raiseEscalation(db, { workspaceId, threadId: null, reason: 'complaint', title: 'Angry', explanation: 'Spam!' }, saturday);
    const escalation = await call('GET', `/escalations/${id}`, { key: (await seedApiKey(db, workspaceId, ['escalations:read'])).secret });
    assert.equal(escalation.body.due_at, '2026-11-14T13:00:00.000Z');
  });
});
