import assert from 'node:assert/strict';

import { audit_log, campaign_steps, contact_tags, contacts, mailboxes, messages, newId, sending_domains, suppressions, tags, thread_goal_achievements, threads, type Db } from '@catalyst/db';
import { createTestDatabase } from '@catalyst/db/testing';
import { MemoryQueue } from '@catalyst/jobs';
import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { call, seedApiKey, seedWorkspace } from '../api/testing.ts';
import { setDb, setDeps } from '../runtime.ts';
import { evaluateThread } from './evaluate.ts';

// Needs a PostgreSQL server: set TEST_DATABASE_URL to any database on it.
const adminUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!adminUrl)('threads: reading them and changing them by hand (§5, §13.4)', () => {
  let db: Db;
  let drop: () => Promise<void>;
  let workspaceId: string;
  let key: string;
  let readKey: string;
  let otherKey: string;
  let campaignId: string;
  let goalIds: string[];
  let mailboxId: string;
  let initialStepId: string;
  const jobs = new MemoryQueue();

  const as = (secret: string) => ({
    get: (path: string) => call('GET', path, { key: secret }),
    post: (path: string, body?: unknown) => call('POST', path, { key: secret, body: body ?? {} }),
    patch: (path: string, body: unknown, headers: Record<string, string> = {}) => call('PATCH', path, { key: secret, body, headers }),
    del: (path: string) => call('DELETE', path, { key: secret }),
  });
  const api = () => as(key);
  const ok = (response: { status: number; body: any }, status = 200) => {
    assert.equal(response.status, status, JSON.stringify(response.body));
    return response.body;
  };
  const problem = (response: { status: number; body: any }, status: number, code: string) => {
    assert.equal(response.status, status, JSON.stringify(response.body));
    assert.equal(response.body.code, code);
    return response.body;
  };

  /** Enrolls a fresh contact and, unless `queued`, records the initial email as sent an hour ago. */
  async function thread(options: { queued?: boolean; email?: string; first_name?: string } = {}): Promise<{ threadId: string; contactId: string }> {
    const contactId = newId('contact');
    await db.insert(contacts).values({ id: contactId, workspace_id: workspaceId, email: options.email ?? `${contactId}@globex.example`, first_name: options.first_name ?? 'Priya', last_name: 'Natarajan', email_verification: 'valid', timezone: 'America/Los_Angeles' });
    const enrolled = ok(await api().post(`/campaigns/${campaignId}/enrollments`, { contact_ids: [contactId] }));
    const threadId = enrolled.created[0].thread_id as string;
    if (!options.queued) {
      const sentAt = new Date(Date.now() - 3_600_000);
      await db.update(threads).set({ mailbox_id: mailboxId }).where(eq(threads.id, threadId));
      await db.insert(messages).values({
        id: newId('message'), workspace_id: workspaceId, thread_id: threadId, mailbox_id: mailboxId, direction: 'outbound', status: 'sent', author: 'template',
        step_id: initialStepId, message_id_header: `<${newId('message')}@getacme.com>`, from_email: 'alex@getacme.com', to_emails: ['x'], subject: 'Quick question about Globex',
        body_text: 'Hi Priya, how does onboarding work at Globex?', sent_at: sentAt, created_at: sentAt,
      });
    }
    // What the worker's thread.evaluate job would do next.
    await evaluateThread(db, threadId, { now: new Date() });
    return { threadId, contactId };
  }

  beforeAll(async () => {
    ({ db, drop } = await createTestDatabase(adminUrl!));
    setDb(db);
    setDeps({ jobs, config: { trackingTarget: null, appHost: null } });
    workspaceId = await seedWorkspace(db, 'Acme');
    ({ secret: key } = await seedApiKey(db, workspaceId, ['campaigns:read', 'campaigns:write', 'threads:read', 'threads:write', 'contacts:read']));
    ({ secret: readKey } = await seedApiKey(db, workspaceId, ['threads:read']));
    ({ secret: otherKey } = await seedApiKey(db, await seedWorkspace(db, 'Elsewhere'), ['threads:read', 'threads:write']));
    const campaign = ok(
      await api().post('/campaigns', {
        name: 'Agency outreach Q4',
        objective: 'Book discovery calls.',
        goals: [
          { key: 'call_booked', name: 'Call booked', success_criteria: 'Books a call.', playbook: 'Offer the booking link.', lifecycle_stage_on_achieve: 'opportunity' },
          { key: 'paid', name: 'Paid', success_criteria: 'Pays.', playbook: 'Send the checkout link.', marks_customer: true },
        ],
        initial_email: { subject_template: 'Quick question', body_template: 'Hi {{ contact.first_name | default: "there" }}' },
        links: { booking: 'https://cal.com/acme/intro' },
      }),
      201,
    );
    campaignId = campaign.id;
    goalIds = ok(await api().get(`/campaigns/${campaignId}/goals`)).data.map((goal: any) => goal.id);
    const [initial] = await db.select().from(campaign_steps).where(and(eq(campaign_steps.campaign_id, campaignId), isNull(campaign_steps.sequence_id)));
    initialStepId = initial!.id;
    const domainId = newId('domain');
    await db.insert(sending_domains).values({ id: domainId, workspace_id: workspaceId, domain: 'getacme.com' });
    mailboxId = newId('mailbox');
    await db.insert(mailboxes).values({
      id: mailboxId, workspace_id: workspaceId, sending_domain_id: domainId, email: 'alex@getacme.com', display_name: 'Alex', auth: 'password', status: 'active',
      smtp_host: 'smtp.gmail.com', smtp_port: 465, smtp_secure: 'tls', smtp_username: 'alex', imap_host: 'imap.gmail.com', imap_username: 'alex', credentials_enc: Buffer.from('x'), credentials_key_version: 1, folders: {},
    });
  });
  afterAll(async () => {
    setDb(undefined);
    setDeps(undefined);
    await drop?.();
  });

  it('lists and filters threads, with the contact and campaign in brief', async () => {
    const { threadId } = await thread({ first_name: 'Dana' });
    const queued = await thread({ queued: true });
    ok(await api().post(`/threads/${threadId}/pause`));
    const all = ok(await as(readKey).get(`/threads?campaign_id=${campaignId}`)).data;
    assert.ok(all.length >= 2);
    const listed = all.find((entry: any) => entry.id === threadId);
    assert.deepEqual([listed.campaign.name, listed.contact.name, listed.stage, listed.stage_label], ['Agency outreach Q4', 'Dana Natarajan', 'sent', 'Sent']);
    assert.deepEqual(ok(await api().get('/threads?state=paused')).data.map((entry: any) => entry.id), [threadId]);
    assert.ok(ok(await api().get('/threads?stage=queued')).data.some((entry: any) => entry.id === queued.threadId));
    assert.deepEqual(ok(await api().get('/threads?q=dana')).data.map((entry: any) => entry.id), [threadId]);
    assert.deepEqual(ok(await api().get(`/threads?min_stage_rank=1&contact_id=${queued.contactId}`)).data, []);
    const first = ok(await api().get('/threads?limit=1&sort=-created_at'));
    assert.equal(first.data.length, 1);
    assert.notEqual(ok(await api().get(`/threads?limit=1&sort=-created_at&cursor=${first.next_cursor}`)).data[0].id, first.data[0].id);
    assert.deepEqual(ok(await as(otherKey).get('/threads')).data, []);
    problem(await as(otherKey).get(`/threads/${threadId}`), 404, 'not_found');
    problem(await as(readKey).post(`/threads/${threadId}/resume`), 403, 'forbidden_scope');
  });

  it('pauses, resumes and takes over a thread, showing the evaluated state at once', async () => {
    const { threadId } = await thread();
    const initial = ok(await api().get(`/threads/${threadId}`));
    assert.deepEqual([initial.stage, initial.state, initial.next_action.type], ['sent', 'active', 'send_follow_up']);
    const paused = ok(await api().post(`/threads/${threadId}/pause`));
    assert.deepEqual([paused.state, paused.state_reason, paused.next_action.type], ['paused', 'paused_manually', 'none']);
    problem(await api().post(`/threads/${threadId}/pause`), 409, 'conflict');
    const resumed = ok(await api().post(`/threads/${threadId}/resume`));
    assert.deepEqual([resumed.state, resumed.next_action.type], ['active', 'send_follow_up']);
    const takenOver = ok(await api().patch(`/threads/${threadId}`, { ai_paused: true }));
    assert.deepEqual([takenOver.state, takenOver.state_reason], ['paused', 'human_took_over']);
    const back = ok(await api().patch(`/threads/${threadId}`, { ai_paused: false }));
    assert.equal(back.state, 'active');
    const types = ok(await api().get(`/threads/${threadId}/activity`)).data.map((entry: any) => entry.type);
    for (const type of ['thread.paused', 'thread.resumed', 'thread.ai_paused', 'thread.ai_resumed', 'thread.state_changed']) assert.ok(types.includes(type), type);
  });

  it('marks a later goal with the earlier one implied, completes the thread, moves the lifecycle, and revokes cleanly (§5.2)', async () => {
    const { threadId, contactId } = await thread();
    const paid = ok(await api().post(`/threads/${threadId}/goals/${goalIds[1]}/achieve`, { note: 'Paid by invoice' }));
    assert.deepEqual([paid.stage, paid.stage_label, paid.stage_rank, paid.state], ['goal_achieved', 'Paid achieved', 5, 'completed']);
    const achievements = await db.select().from(thread_goal_achievements).where(eq(thread_goal_achievements.thread_id, threadId));
    assert.deepEqual(achievements.map((entry) => [entry.goal_id, entry.method]).sort(), [[goalIds[0], 'implied'], [goalIds[1], 'manual']].sort());
    const [contact] = await db.select().from(contacts).where(eq(contacts.id, contactId));
    assert.equal(contact!.lifecycle_stage, 'customer');
    problem(await api().post(`/threads/${threadId}/goals/${goalIds[1]}/achieve`, {}), 409, 'conflict');

    const revoked = ok(await call('DELETE', `/threads/${threadId}/goals/${goalIds[1]}/achieve?reason=${encodeURIComponent('Invoice was for someone else')}`, { key }));
    assert.deepEqual([revoked.stage, revoked.state], ['sent', 'active']);
    const live = await db.select().from(thread_goal_achievements).where(and(eq(thread_goal_achievements.thread_id, threadId), isNull(thread_goal_achievements.revoked_at)));
    assert.deepEqual(live, [], 'the implied goal goes with it');
    assert.equal(ok(await api().get(`/threads?goal_id=${goalIds[0]}`)).data.length, 0);

    const booked = ok(await api().post(`/threads/${threadId}/goals/${goalIds[0]}/achieve`, { event_at: new Date(Date.now() + 7 * 86_400_000).toISOString() }));
    assert.deepEqual([booked.stage_label, booked.state, booked.follow_up.sequence_id !== null], ['Call booked achieved', 'active', true]);
    assert.equal(ok(await api().get(`/threads?goal_id=${goalIds[0]}`)).data[0].id, threadId);
    assert.ok((await db.select().from(audit_log).where(eq(audit_log.action, 'goal.revoked'))).length === 1);
  });

  it('sets a stage floor with a reason, but not before the first send', async () => {
    const { threadId } = await thread();
    const floored = ok(await api().post(`/threads/${threadId}/stage-floor`, { stage: 'responded', reason: 'They called back' }));
    assert.deepEqual([floored.stage, floored.manual_floor_rank], ['responded', 3]);
    const queued = await thread({ queued: true });
    assert.match(problem(await api().post(`/threads/${queued.threadId}/stage-floor`, { stage: 'responded', reason: 'Phone call' }), 409, 'conflict').detail, /no mailbox/);
    problem(await api().post(`/threads/${queued.threadId}/goals/${goalIds[0]}/achieve`, {}), 409, 'conflict');
  });

  it('skips, stops, resumes and postpones follow-ups (§5.10 rule 7)', async () => {
    const { threadId } = await thread();
    const before = ok(await api().get(`/threads/${threadId}`));
    assert.deepEqual([before.next_action.type, before.follow_up.step_position], ['send_follow_up', 1]);
    const skipped = ok(await api().post(`/threads/${threadId}/next-action/skip`));
    assert.equal(skipped.follow_up.step_position, 2);
    assert.ok(new Date(skipped.next_action.at) > new Date(before.next_action.at));

    const later = new Date(new Date(skipped.next_action.at).getTime() + 2 * 86_400_000).toISOString();
    const postponed = ok(await api().patch(`/threads/${threadId}/next-action`, { at: later }));
    assert.deepEqual([postponed.next_action.at, postponed.next_action.throttle_reason], [later, 'rescheduled']);
    problem(await api().patch(`/threads/${threadId}/next-action`, { at: new Date(Date.now() + 60_000).toISOString() }), 400, 'validation_failed');

    const stopped = ok(await api().post(`/threads/${threadId}/follow-ups/stop`));
    assert.deepEqual([stopped.follow_up.stopped, stopped.next_action.type], [true, 'await_reply']);
    problem(await api().post(`/threads/${threadId}/next-action/skip`), 409, 'conflict');
    const resumed = ok(await api().post(`/threads/${threadId}/follow-ups/resume`));
    assert.deepEqual([resumed.follow_up.stopped, resumed.next_action.type], [false, 'send_follow_up']);
  });

  it('closes a thread as lost, and with unsubscribe stops every thread of the contact', async () => {
    const { threadId } = await thread();
    const closed = ok(await api().post(`/threads/${threadId}/close`, { reason: 'not_interested', note: 'Uses a competitor' }));
    assert.deepEqual([closed.state, closed.closed_reason, closed.next_action.type], ['closed_lost', 'not_interested', 'none']);
    const [contactId] = (await db.select({ id: threads.contact_id }).from(threads).where(eq(threads.id, threadId))).map((row) => row.id);
    const tagged = await db.select({ name: tags.name }).from(contact_tags).innerJoin(tags, eq(tags.id, contact_tags.tag_id)).where(eq(contact_tags.contact_id, contactId!));
    assert.deepEqual(tagged.map((tag) => tag.name), ['not-interested'], 'tagged, and the lifecycle stage left alone (§5.9)');

    const shared = await thread({ email: 'both@globex.example' });
    const other = ok(await api().post('/campaigns', { name: 'Second', objective: 'More calls.' }), 201);
    const second = ok(await api().post(`/campaigns/${other.id}/enrollments`, { contact_ids: [shared.contactId] }));
    jobs.clear();
    const unsubscribed = ok(await api().post(`/threads/${shared.threadId}/close`, { reason: 'manual', unsubscribe: true }));
    assert.equal(unsubscribed.state, 'unsubscribed');
    assert.ok(jobs.of('thread.evaluate').some((job) => job.thread_id === second.created[0].thread_id), 'the other campaign’s thread is re-evaluated');
    assert.equal((await db.select().from(suppressions).where(eq(suppressions.email, 'both@globex.example'))).length, 1);
  });

  it('builds an LLM-ready context and lists messages and activity', async () => {
    const { threadId } = await thread({ first_name: 'Ken' });
    const context = ok(await api().get(`/threads/${threadId}/context`));
    assert.match(context.markdown, /^# Ken Natarajan/);
    assert.match(context.markdown, /1\. Call booked ← current goal/);
    assert.match(context.markdown, /### Playbook for "Call booked"\n\nOffer the booking link\./);
    assert.match(context.markdown, /<email direction="outbound" from="template"[^>]*>\nHi Priya, how does onboarding work at Globex\?\n<\/email>/);
    assert.deepEqual([context.allowed_links, context.constraints.autonomy], [{ booking: 'https://cal.com/acme/intro' }, 'assisted']);

    const listed = ok(await api().get(`/threads/${threadId}/messages`)).data;
    assert.deepEqual(listed.map((message: any) => [message.direction, message.status, message.author]), [['outbound', 'sent', 'template']]);
    assert.equal(ok(await api().get(`/messages/${listed[0].id}`)).subject, 'Quick question about Globex');
    problem(await as(otherKey).get(`/messages/${listed[0].id}`), 404, 'not_found');
    assert.deepEqual(ok(await api().get(`/threads/${threadId}/classifications`)), { data: [], next_cursor: null });
    const enrolled = ok(await api().get(`/activities?thread_id=${threadId}&type=thread.`)).data.map((entry: any) => entry.type);
    assert.ok(enrolled.includes('thread.enrolled'));
  });
});
