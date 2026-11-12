import assert from 'node:assert/strict';

import { campaigns, newId, type Db } from '@catalyst/db';
import { createTestDatabase } from '@catalyst/db/testing';
import { MemoryQueue } from '@catalyst/jobs';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { call, seedApiKey, seedWorkspace } from '../api/testing.ts';
import { setDb, setDeps } from '../runtime.ts';

// Needs a PostgreSQL server: set TEST_DATABASE_URL to any database on it.
const adminUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!adminUrl)('the knowledge base (§10, §13.4, §15.17)', () => {
  let db: Db;
  let drop: () => Promise<void>;
  let key: string;
  let otherKey: string;
  let campaignId: string;
  let foreignCampaign: string;

  beforeAll(async () => {
    ({ db, drop } = await createTestDatabase(adminUrl!));
    setDb(db);
    setDeps({ jobs: new MemoryQueue(), config: { trackingTarget: null, appHost: null } });
    const workspaceId = await seedWorkspace(db, 'Acme');
    const otherWorkspace = await seedWorkspace(db, 'Other');
    ({ secret: key } = await seedApiKey(db, workspaceId, ['knowledge:read', 'knowledge:write']));
    ({ secret: otherKey } = await seedApiKey(db, otherWorkspace, ['knowledge:read', 'knowledge:write']));
    campaignId = newId('campaign');
    foreignCampaign = newId('campaign');
    const window = { days: [1, 2, 3, 4, 5], start: '08:30', end: '17:30' };
    await db.insert(campaigns).values([
      { id: campaignId, workspace_id: workspaceId, name: 'Q4', objective: 'Calls', persona: {}, sending_window: window },
      { id: foreignCampaign, workspace_id: otherWorkspace, name: 'Theirs', objective: 'Calls', persona: {}, sending_window: window },
    ]);
  });
  afterAll(async () => {
    setDb(undefined);
    setDeps(undefined);
    await drop?.();
  });

  it('adds, finds, changes and deletes items, scoped by workspace and campaign', async () => {
    const sso = await call('POST', '/knowledge', { key, body: { kind: 'faq', title: 'Do you support SAML SSO?', content: 'Yes, on every plan.', tags: ['security', 'security'] } });
    assert.equal(sso.status, 201, JSON.stringify(sso.body));
    assert.deepEqual([sso.body.source, sso.body.visibility, sso.body.active, sso.body.tags, sso.body.campaign_id], ['api', 'shareable', true, ['security'], null]);
    const pricing = await call('POST', '/knowledge', { key, body: { kind: 'pricing', title: 'Q4 discount', content: '20% off annual plans until December.', campaign_id: campaignId, visibility: 'internal' } });
    assert.equal(pricing.status, 201);
    assert.equal((await call('POST', '/knowledge', { key, body: { kind: 'faq', title: 'x', content: 'y', campaign_id: foreignCampaign } })).status, 400, 'another workspace’s campaign');

    const titles = async (query: string) => (await call('GET', `/knowledge${query}`, { key })).body.data.map((item: { title: string }) => item.title);
    assert.deepEqual(await titles(''), ['Do you support SAML SSO?', 'Q4 discount'], 'by kind, then title');
    assert.deepEqual(await titles('?scope=workspace'), ['Do you support SAML SSO?']);
    assert.deepEqual(await titles(`?scope=${campaignId}`), ['Q4 discount']);
    assert.deepEqual(await titles('?q=annual'), ['Q4 discount']);
    assert.deepEqual(await titles('?kind=faq&source=api'), ['Do you support SAML SSO?']);

    const fetched = await call('GET', `/knowledge/${sso.body.id}`, { key });
    const stale = await call('PATCH', `/knowledge/${sso.body.id}`, { key, body: { active: false }, headers: { 'if-match': '"old"' } });
    assert.equal(stale.status, 412);
    const updated = await call('PATCH', `/knowledge/${sso.body.id}`, { key, body: { active: false, content: 'Yes, SAML SSO and SCIM on every plan.' }, headers: { 'if-match': fetched.headers.get('etag')! } });
    assert.deepEqual([updated.status, updated.body.active, updated.body.content], [200, false, 'Yes, SAML SSO and SCIM on every plan.']);
    assert.deepEqual(await titles('?active=true'), ['Q4 discount']);

    assert.equal((await call('GET', `/knowledge/${sso.body.id}`, { key: otherKey })).status, 404);
    assert.equal((await call('DELETE', `/knowledge/${sso.body.id}`, { key: otherKey })).status, 404);
    assert.equal((await call('GET', '/knowledge', { key: otherKey })).body.data.length, 0);
    assert.equal((await call('DELETE', `/knowledge/${sso.body.id}`, { key })).status, 204);
    assert.equal((await call('GET', `/knowledge/${sso.body.id}`, { key })).status, 404);
    assert.deepEqual(await titles(''), ['Q4 discount']);
  });
});
