import assert from 'node:assert/strict';

import { activities, campaign_goals, campaign_steps, campaigns, contacts, escalations, newId, thread_goal_achievements, threads, users, type Db } from '@catalyst/db';
import { createTestDatabase } from '@catalyst/db/testing';
import { MemoryQueue } from '@catalyst/jobs';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { call, seedApiKey, seedWorkspace } from '../api/testing.ts';
import { setDb, setDeps } from '../runtime.ts';
import { evaluateThread } from '../threads/evaluate.ts';
import { raiseEscalation } from './raise.ts';
import { escalationSlaCheck } from './service.ts';

// Needs a PostgreSQL server: set TEST_DATABASE_URL to any database on it.
const adminUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!adminUrl)('escalations: the "Needs you" queue (§11, §13.4)', () => {
  let db: Db;
  let drop: () => Promise<void>;
  let workspaceId: string;
  let campaignId: string;
  let goalId: string;
  let key: string;
  let otherKey: string;
  const jobs = new MemoryQueue();

  async function newThread(): Promise<string> {
    const contactId = newId('contact');
    await db.insert(contacts).values({ id: contactId, workspace_id: workspaceId, email: `p.${contactId.slice(-8)}@globex.example`, email_verification: 'valid' });
    const threadId = newId('thread');
    await db.insert(threads).values({ id: threadId, workspace_id: workspaceId, campaign_id: campaignId, contact_id: contactId });
    return threadId;
  }
  const raise = (threadId: string | null, reason: Parameters<typeof raiseEscalation>[1]['reason'], now = new Date()) =>
    raiseEscalation(db, { workspaceId, threadId, reason, title: `About ${reason}`, explanation: 'A person is needed.' }, now).then((result) => result.id);
  const row = async (id: string) => (await db.select().from(escalations).where(eq(escalations.id, id)))[0]!;
  const post = (path: string, body: unknown, as = key) => call('POST', path, { key: as, body });

  beforeAll(async () => {
    ({ db, drop } = await createTestDatabase(adminUrl!));
    setDb(db);
    setDeps({ jobs, config: { trackingTarget: null, appHost: null } });
    workspaceId = await seedWorkspace(db, 'Acme');
    ({ secret: key } = await seedApiKey(db, workspaceId, ['escalations:read', 'escalations:write', 'threads:read']));
    ({ secret: otherKey } = await seedApiKey(db, await seedWorkspace(db, 'Other'), ['escalations:read', 'escalations:write']));
    campaignId = newId('campaign');
    await db.insert(campaigns).values({ id: campaignId, workspace_id: workspaceId, name: 'Q4', objective: 'Calls', status: 'active', persona: {}, sending_window: { days: [1, 2, 3, 4, 5], start: '08:30', end: '17:30', tz: 'contact', fallback_tz: 'UTC' } });
    goalId = newId('goal');
    await db.insert(campaign_goals).values({ id: goalId, campaign_id: campaignId, position: 1, key: 'call', name: 'Call', success_criteria: 'Booked', playbook: 'Ask' });
    await db.insert(campaign_steps).values({ id: newId('step'), campaign_id: campaignId, position: 1 });
  });
  afterAll(async () => {
    setDb(undefined);
    setDeps(undefined);
    await drop?.();
  });

  it('lists open escalations most urgent first, then soonest due, page by page; another workspace sees none', async () => {
    const normal = await raise(await newThread(), 'went_quiet');
    const urgent = await raise(await newThread(), 'complaint');
    const high = await raise(await newThread(), 'send_failure');
    const first = await call('GET', '/escalations?limit=2', { key });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.deepEqual(first.body.data.map((entry: { id: string }) => entry.id), [urgent, high]);
    const second = await call('GET', `/escalations?limit=2&cursor=${first.body.next_cursor}`, { key });
    assert.deepEqual(second.body.data.map((entry: { id: string }) => entry.id), [normal]);
    assert.equal(first.body.data[0].contact_id !== null && first.body.data[0].campaign_id, campaignId);
    assert.deepEqual((await call('GET', '/escalations?priority=high', { key })).body.data.map((entry: { id: string }) => entry.id), [high]);

    assert.equal((await call('GET', '/escalations', { key: otherKey })).body.data.length, 0);
    assert.equal((await call('GET', `/escalations/${urgent}`, { key: otherKey })).status, 404);
    assert.equal((await post(`/escalations/${urgent}/dismiss`, { reason: 'Not mine' }, otherKey)).status, 404);
    for (const id of [normal, urgent, high]) await post(`/escalations/${id}/dismiss`, { reason: 'Cleaning up' });
  });

  it('resolves one, and the thread leaves needs_human; a second resolve is 409', async () => {
    const threadId = await newThread();
    const id = await raise(threadId, 'ai_unavailable');
    await evaluateThread(db, threadId, { now: new Date() });
    assert.equal((await db.select().from(threads).where(eq(threads.id, threadId)))[0]!.state, 'needs_human');

    const resolved = await post(`/escalations/${id}/resolve`, { resolution: 'replied', note: 'Answered by phone.' });
    assert.equal(resolved.status, 200, JSON.stringify(resolved.body));
    assert.deepEqual([resolved.body.status, resolved.body.resolution, resolved.body.resolution_note], ['resolved', 'replied', 'Answered by phone.']);
    assert.ok(resolved.body.resolved_at);
    assert.notEqual((await db.select().from(threads).where(eq(threads.id, threadId)))[0]!.state, 'needs_human');
    assert.equal((await post(`/escalations/${id}/resolve`, { resolution: 'replied' })).status, 409);
    const [logged] = await db.select().from(activities).where(and(eq(activities.thread_id, threadId), eq(activities.type, 'escalation.resolved')));
    assert.equal((logged!.data as { resolution: string }).resolution, 'replied');
  });

  it('took_over pauses the agent on the thread; dismissing records the reason', async () => {
    const threadId = await newThread();
    const taken = await raise(threadId, 'human_requested');
    assert.equal((await post(`/escalations/${taken}/resolve`, { resolution: 'took_over' })).status, 200);
    assert.equal((await db.select().from(threads).where(eq(threads.id, threadId)))[0]!.ai_paused, true);

    const dismissed = await post(`/escalations/${await raise(await newThread(), 'attachment_received')}/dismiss`, { reason: 'Just a logo in the signature' });
    assert.deepEqual([dismissed.body.status, dismissed.body.resolution, dismissed.body.resolution_note], ['dismissed', 'dismissed', 'Just a logo in the signature']);
    assert.equal((await post(`/escalations/${await raise(null, 'unmatched_reply')}/resolve`, { resolution: 'took_over' })).status, 400, 'nothing to take over without a thread');
  });

  it('a goal confirmation names its goal: Confirm records it as the classifier read it, Not yet leaves it (§5.2, §15.5)', async () => {
    const paidId = newId('goal');
    await db.insert(campaign_goals).values({ id: paidId, campaign_id: campaignId, position: 2, key: 'paid', name: 'Paid', success_criteria: 'Pays', playbook: 'Invoice' });
    const threadId = await newThread();
    const confirm = (goal: string, p: number) => raiseEscalation(db, { workspaceId, threadId, reason: 'goal_confirmation', title: 'Reached it?', explanation: 'They said Thursday works (72%).', goal: { id: goal, p } }, new Date());
    const call1 = await confirm(goalId, 0.72);
    assert.deepEqual(await confirm(goalId, 0.8), { id: call1.id, created: false }, 'one open confirmation per goal');
    const paid = await confirm(paidId, 0.6);
    assert.equal(paid.created, true, 'another goal gets its own');

    const shown = (await call('GET', `/escalations/${call1.id}`, { key })).body;
    assert.deepEqual([shown.goal_id, shown.goal_p], [goalId, 0.72]);
    assert.equal((await post(`/escalations/${paid.id}/resolve`, { resolution: 'goal_rejected', note: 'Not yet' })).status, 200);
    assert.equal((await db.select().from(thread_goal_achievements).where(eq(thread_goal_achievements.thread_id, threadId))).length, 0, 'Not yet records nothing');

    assert.equal((await post(`/escalations/${call1.id}/resolve`, { resolution: 'goal_confirmed' })).status, 200);
    const [held] = await db.select().from(thread_goal_achievements).where(and(eq(thread_goal_achievements.thread_id, threadId), eq(thread_goal_achievements.goal_id, goalId)));
    assert.deepEqual([held?.method, held?.confidence, held?.confirmed_by, held?.revoked_at], ['ai', '0.720', null, null]);
    const [logged] = await db.select().from(activities).where(and(eq(activities.thread_id, threadId), eq(activities.type, 'goal.achieved')));
    assert.equal((logged!.data as { escalation_id: string }).escalation_id, call1.id);
  });

  it('snoozes with the SLA paused, hides it from the open list, and wakes it when the time comes', async () => {
    const id = await raise(await newThread(), 'meeting_logistics');
    const before = await row(id);
    assert.equal((await post(`/escalations/${id}/snooze`, { until: new Date(Date.now() - 60_000).toISOString() })).status, 400);
    assert.equal((await post(`/escalations/${id}/snooze`, { until: new Date(Date.now() + 31 * 86_400_000).toISOString() })).status, 400);
    const until = new Date(Date.now() + 2 * 86_400_000);
    const snoozed = await post(`/escalations/${id}/snooze`, { until: until.toISOString() });
    assert.equal(snoozed.status, 200, JSON.stringify(snoozed.body));
    assert.equal(snoozed.body.status, 'snoozed');
    const moved = (await row(id)).due_at.getTime() - before.due_at.getTime();
    assert.ok(Math.abs(moved - 2 * 86_400_000) < 5_000, `due time moved by the snooze (${moved} ms)`);
    assert.ok(!(await call('GET', '/escalations', { key })).body.data.some((entry: { id: string }) => entry.id === id));
    assert.ok((await call('GET', '/escalations?status=snoozed', { key })).body.data.some((entry: { id: string }) => entry.id === id));

    assert.deepEqual(await escalationSlaCheck(db, new Date(until.getTime() + 1_000)).then((result) => result.woken), 1);
    assert.deepEqual([(await row(id)).status, (await row(id)).snoozed_until], ['open', null]);
  });

  it('assigns to someone in the workspace, or back to the owners', async () => {
    const id = await raise(await newThread(), 'pricing_negotiation');
    const userId = newId('user');
    await db.insert(users).values({ id: userId, workspace_id: workspaceId, email: `sam.${userId.slice(-6)}@getacme.example`, name: 'Sam' });
    assert.equal((await post(`/escalations/${id}/assign`, { user_id: newId('user') })).status, 400);
    assert.equal((await post(`/escalations/${id}/assign`, { user_id: userId })).body.assigned_user_id, userId);
    assert.equal((await post(`/escalations/${id}/assign`, { user_id: null })).body.assigned_user_id, null);
  });

  it('raises the priority of an overdue escalation once per SLA period (§11.1)', async () => {
    const id = await raise(await newThread(), 'went_quiet', new Date(Date.now() - 10 * 86_400_000));
    assert.equal((await row(id)).priority, 'normal');
    assert.ok((await call('GET', '/escalations?overdue=true', { key })).body.data.some((entry: { id: string; overdue: boolean }) => entry.id === id && entry.overdue));
    const now = new Date();
    assert.ok((await escalationSlaCheck(db, now)).breached >= 1);
    const raised = await row(id);
    assert.equal(raised.priority, 'high');
    assert.ok(raised.due_at.getTime() > now.getTime(), 'a new due time from now');
    await escalationSlaCheck(db, now);
    assert.equal((await row(id)).priority, 'high', 'not again until the new due time passes');
    const [breach] = await db.select().from(activities).where(eq(activities.type, 'escalation.sla_breached'));
    assert.deepEqual([(breach!.data as { from: string }).from, (breach!.data as { to: string }).to], ['normal', 'high']);
  });
});
