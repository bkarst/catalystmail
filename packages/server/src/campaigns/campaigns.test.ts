import assert from 'node:assert/strict';

import { contacts, follow_up_sequences, mailboxes, newId, sending_domains, threads, type Db } from '@catalyst/db';
import { createTestDatabase } from '@catalyst/db/testing';
import { MemoryQueue } from '@catalyst/jobs';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { call, seedApiKey, seedWorkspace } from '../api/testing.ts';
import { setDb, setDeps } from '../runtime.ts';

// Needs a PostgreSQL server: set TEST_DATABASE_URL to any database on it.
const adminUrl = process.env.TEST_DATABASE_URL;

const GOALS = [
  { key: 'call_booked', name: 'Call booked', success_criteria: 'Books a call or agrees a time.', playbook: 'Offer the booking link https://cal.com/acme/intro.' },
  { key: 'paid', name: 'Paid', success_criteria: 'Pays for a plan.', playbook: 'Recap the call and send the checkout link.', marks_customer: true },
];
const INITIAL = { subject_template: 'Quick question about {{ company.name | default: "your team" }}', body_template: 'Hi {{ contact.first_name | default: "there" }},\n\nHow does onboarding work at {{ company.name | default: "your company" }}?\n\n{{ sender.first_name }}' };

describe.skipIf(!adminUrl)('campaigns, goals, emails, enrollment and launch (§5, §8.11, §13.4)', () => {
  let db: Db;
  let drop: () => Promise<void>;
  let workspaceId: string;
  let key: string;
  let sendKey: string;
  let otherKey: string;
  const jobs = new MemoryQueue();

  const as = (secret: string) => ({
    get: (path: string) => call('GET', path, { key: secret }),
    post: (path: string, body?: unknown) => call('POST', path, { key: secret, body: body ?? {} }),
    patch: (path: string, body: unknown, headers: Record<string, string> = {}) => call('PATCH', path, { key: secret, body, headers }),
    put: (path: string, body: unknown) => call('PUT', path, { key: secret, body }),
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
    return response.body as { detail: string; errors?: { path: string; message: string; reason?: string }[] };
  };
  const createCampaign = async (extra: Record<string, unknown> = {}) =>
    ok(await api().post('/campaigns', { name: 'Agency outreach Q4', objective: 'Book discovery calls.', goals: GOALS, initial_email: INITIAL, links: { booking: 'https://cal.com/acme/intro' }, ...extra }), 201);
  const contact = async (values: Partial<typeof contacts.$inferInsert> & { email: string }) => {
    const id = newId('contact');
    await db.insert(contacts).values({ id, workspace_id: workspaceId, email_verification: 'valid', ...values });
    return id;
  };

  beforeAll(async () => {
    ({ db, drop } = await createTestDatabase(adminUrl!));
    setDb(db);
    setDeps({ jobs, config: { trackingTarget: 'catalyst.example.com', appHost: 'catalyst.example.com' } });
    workspaceId = await seedWorkspace(db, 'Acme');
    ({ secret: key } = await seedApiKey(db, workspaceId, ['campaigns:read', 'campaigns:write', 'contacts:read', 'contacts:write']));
    ({ secret: sendKey } = await seedApiKey(db, workspaceId, ['campaigns:read', 'campaigns:write', 'messages:send']));
    ({ secret: otherKey } = await seedApiKey(db, await seedWorkspace(db, 'Elsewhere'), ['campaigns:read', 'campaigns:write']));
  });
  afterAll(async () => {
    setDb(undefined);
    setDeps(undefined);
    await drop?.();
  });

  it('creates a draft with the default sequences for each stage (§5.10)', async () => {
    const campaign = await createCampaign();
    assert.deepEqual([campaign.status, campaign.goal_count, campaign.thread_count, campaign.sending_window], ['draft', 2, 0, { days: [1, 2, 3, 4, 5], start: '08:30', end: '17:30', fallback_tz: 'UTC' }]);
    const list = ok(await api().get(`/campaigns/${campaign.id}/follow-up-sequences`));
    assert.deepEqual(
      list.data.map((sequence: any) => [sequence.name, sequence.stages, sequence.finish, sequence.steps.map((step: any) => `${step.wait.amount} ${step.wait.unit} ${step.mode}`)]),
      [
        ['No reply to the first email', ['sent', 'received'], 'exhaust', ['3 business_days template', '4 business_days template', '7 business_days template']],
        ['Went quiet after replying', ['responded'], 'notify_owner', ['2 business_days ai_adapt', '5 business_days ai_adapt']],
        ['Call booked, not yet paid', ['goal:call_booked'], 'notify_owner', ['1 days ai_adapt', '4 business_days ai_adapt']],
      ],
    );
    assert.deepEqual(list.stages.map((stage: any) => [stage.stage, stage.label, stage.sequence_id === null]), [
      ['sent', 'Sent', false],
      ['received', 'Received', false],
      ['responded', 'Responded', false],
      ['goal:call_booked', 'Call booked achieved', false],
    ]);
    const initial = ok(await api().get(`/campaigns/${campaign.id}/initial-email`));
    assert.deepEqual([initial.mode, initial.send_as_reply, initial.variants[0].subject_template, initial.variants[0].issues], ['template', false, INITIAL.subject_template, []]);
    problem(await as(otherKey).get(`/campaigns/${campaign.id}`), 404, 'not_found');
  });

  it('changes settings under If-Match, and validates them', async () => {
    const campaign = await createCampaign();
    const fetched = await api().get(`/campaigns/${campaign.id}`);
    const updated = ok(await api().patch(`/campaigns/${campaign.id}`, { autonomy: 'manual', sending_window: { days: [1, 2, 3], start: '09:00', end: '16:00', fallback_tz: 'Europe/Berlin' }, enrollment_rules: { cooldown_days: 10 } }, { 'if-match': fetched.headers.get('etag')! }));
    assert.deepEqual([updated.autonomy, updated.sending_window.fallback_tz, updated.enrollment_rules], ['manual', 'Europe/Berlin', { skip_active_elsewhere: true, cooldown_days: 10, allow_role_accounts: false, allow_risky: false }]);
    problem(await api().patch(`/campaigns/${campaign.id}`, { notes: 'x' }, { 'if-match': fetched.headers.get('etag')! }), 400, 'validation_failed');
    problem(await api().patch(`/campaigns/${campaign.id}`, { autonomy: 'assisted' }, { 'if-match': fetched.headers.get('etag')! }), 412, 'precondition_failed');
    problem(await api().patch(`/campaigns/${campaign.id}`, { sending_window: { days: [1], start: '17:00', end: '09:00', fallback_tz: 'UTC' } }), 400, 'validation_failed');
    problem(await api().patch(`/campaigns/${campaign.id}`, { reply_delay_min_minutes: 60, reply_delay_max_minutes: 30 }), 400, 'validation_failed');
  });

  it('hands a campaign to an outside agent, and back (§10.7)', async () => {
    const created = ok(await api().post('/campaigns', { name: 'Harness', objective: 'Book calls.', agent_mode: 'external' }), 201);
    assert.equal(created.agent_mode, 'external');
    const campaign = await createCampaign();
    assert.equal(campaign.agent_mode, 'built_in', 'Catalyst’s agent by default');
    assert.equal(ok(await api().patch(`/campaigns/${campaign.id}`, { agent_mode: 'external' })).agent_mode, 'external');
    assert.equal(ok(await api().patch(`/campaigns/${campaign.id}`, { agent_mode: 'built_in' })).agent_mode, 'built_in');
    problem(await api().patch(`/campaigns/${campaign.id}`, { agent_mode: 'robot' }), 400, 'validation_failed');
  });

  it('keeps goals consistent with the sequences that cover them', async () => {
    const campaign = await createCampaign();
    const goals = ok(await api().get(`/campaigns/${campaign.id}/goals`)).data;
    problem(await api().post(`/campaigns/${campaign.id}/goals`, { key: 'paid', name: 'Again', success_criteria: 'x', playbook: 'x' }), 409, 'conflict');
    const third = ok(await api().post(`/campaigns/${campaign.id}/goals`, { key: 'renewed', name: 'Renewed', success_criteria: 'Renews.', playbook: 'Ask about renewal.' }), 201);
    assert.equal(third.position, 3);

    ok(await api().patch(`/campaigns/${campaign.id}/goals/${goals[0].id}`, { key: 'call' }));
    const [booked] = await db.select().from(follow_up_sequences).where(and(eq(follow_up_sequences.campaign_id, campaign.id), eq(follow_up_sequences.name, 'Call booked, not yet paid')));
    assert.ok(booked!.stages.includes('goal:call'), 'the covering sequence follows the key change');

    problem(await api().del(`/campaigns/${campaign.id}/goals/${goals[0].id}`), 409, 'conflict');
    // Making "Call booked" the final goal would leave a sequence covering the final goal.
    problem(await api().post(`/campaigns/${campaign.id}/goals/reorder`, { goal_ids: [goals[1].id, third.id, goals[0].id] }), 409, 'conflict');
    const reordered = ok(await api().post(`/campaigns/${campaign.id}/goals/reorder`, { goal_ids: [goals[0].id, third.id, goals[1].id] }));
    assert.deepEqual(reordered.data.map((goal: any) => [goal.key, goal.position]), [['call', 1], ['renewed', 2], ['paid', 3]]);
    assert.equal((await api().del(`/campaigns/${campaign.id}/goals/${third.id}`)).status, 204);
    assert.deepEqual(ok(await api().get(`/campaigns/${campaign.id}/goals`)).data.map((goal: any) => goal.position), [1, 2]);
  });

  it('rejects an overlapping stage and a wait under 24 hours, saving nothing (IT-33)', async () => {
    const campaign = await createCampaign();
    const before = (await db.select().from(follow_up_sequences).where(eq(follow_up_sequences.campaign_id, campaign.id))).length;
    const step = { wait: { amount: 3, unit: 'business_days' }, variant: { body_template: 'Hi again.' } };
    const overlap = problem(await api().post(`/campaigns/${campaign.id}/follow-up-sequences`, { name: 'Second responded', stages: ['responded'], steps: [step] }), 409, 'stage_already_covered');
    assert.equal(overlap.errors![0]!.reason, 'responded');
    assert.match(overlap.errors![0]!.message, /Went quiet after replying/);
    problem(await api().post(`/campaigns/${campaign.id}/follow-up-sequences`, { name: 'Too fast', stages: ['received'], steps: [{ ...step, wait: { amount: 12, unit: 'hours' } }] }), 409, 'stage_already_covered');
    const list = ok(await api().get(`/campaigns/${campaign.id}/follow-up-sequences`));
    const noReply = list.data[0];
    problem(await api().patch(`/campaigns/${campaign.id}/follow-up-sequences/${noReply.id}`, { stages: ['sent', 'received', 'responded'] }), 409, 'stage_already_covered');
    const fast = problem(await api().post(`/campaigns/${campaign.id}/follow-up-sequences/${noReply.id}/steps`, { ...step, wait: { amount: 12, unit: 'hours' } }), 400, 'validation_failed');
    assert.match(fast.errors![0]!.message, /24 hours/);
    problem(await api().post(`/campaigns/${campaign.id}/follow-up-sequences`, { name: 'Final', stages: ['goal:paid'], steps: [step] }), 400, 'validation_failed');
    assert.equal((await db.select().from(follow_up_sequences).where(eq(follow_up_sequences.campaign_id, campaign.id))).length, before);

    // Freeing the stage lets another sequence take it.
    ok(await api().patch(`/campaigns/${campaign.id}/follow-up-sequences/${list.data[1].id}`, { active: false }));
    const created = ok(await api().post(`/campaigns/${campaign.id}/follow-up-sequences`, { name: 'New responded', stages: ['responded'], finish: 'close_lost', steps: [step, { ...step, wait: { amount: 2, unit: 'days' } }] }), 201);
    assert.deepEqual(created.steps.map((entry: any) => entry.position), [1, 2]);
  });

  it('adds, reorders and deletes steps, and manages variants', async () => {
    const campaign = await createCampaign();
    const noReply = ok(await api().get(`/campaigns/${campaign.id}/follow-up-sequences`)).data[0];
    const added = ok(await api().post(`/campaigns/${campaign.id}/follow-up-sequences/${noReply.id}/steps`, { wait: { amount: 5, unit: 'business_days' }, variant: { body_template: 'Last one, {{ contact.nickname }}.' } }), 201);
    assert.deepEqual([added.position, added.variants[0].issues[0].code], [4, 'unknown_variable']);
    const reordered = ok(await api().post(`/campaigns/${campaign.id}/follow-up-sequences/${noReply.id}/steps/reorder`, { step_ids: [added.id, ...noReply.steps.map((step: any) => step.id)] }));
    assert.deepEqual(reordered.steps.map((step: any) => step.id), [added.id, ...noReply.steps.map((step: any) => step.id)]);
    assert.equal((await api().del(`/campaigns/${campaign.id}/follow-up-sequences/${noReply.id}/steps/${added.id}`)).status, 204);
    const after = ok(await api().get(`/campaigns/${campaign.id}/follow-up-sequences/${noReply.id}`));
    assert.deepEqual(after.steps.map((step: any) => step.position), [1, 2, 3]);

    const stepId = after.steps[0].id;
    const variant = ok(await api().post(`/campaigns/${campaign.id}/steps/${stepId}/variants`, { body_template: 'Version B for {{ contact.first_name | default: "you" }}.' }), 201);
    assert.equal(variant.label, 'B');
    ok(await api().patch(`/campaigns/${campaign.id}/steps/${stepId}/variants/${variant.id}`, { weight: 3 }));
    assert.equal((await api().del(`/campaigns/${campaign.id}/steps/${stepId}/variants/${variant.id}`)).status, 204);
    const [only] = ok(await api().get(`/campaigns/${campaign.id}/follow-up-sequences/${noReply.id}`)).steps[0].variants;
    problem(await api().del(`/campaigns/${campaign.id}/steps/${stepId}/variants/${only.id}`), 409, 'conflict');

    problem(await api().put(`/campaigns/${campaign.id}/initial-email`, { mode: 'ai_adapt' }), 400, 'validation_failed');
    assert.equal(ok(await api().put(`/campaigns/${campaign.id}/initial-email`, { mode: 'ai_opening_line', ai_guidance: 'Mention their title.' })).mode, 'ai_opening_line');
    const initial = ok(await api().get(`/campaigns/${campaign.id}/initial-email`));
    problem(await api().post(`/campaigns/${campaign.id}/steps/${initial.id}/variants`, { body_template: 'No subject.' }), 400, 'validation_failed');
  });

  it('previews a step for a contact, with template problems and lint', async () => {
    const campaign = await createCampaign();
    const initial = ok(await api().get(`/campaigns/${campaign.id}/initial-email`));
    const contactId = await contact({ email: 'priya@preview.example', first_name: 'Priya' });
    const preview = ok(await api().post(`/campaigns/${campaign.id}/steps/${initial.id}/preview`, { contact_id: contactId }));
    assert.equal(preview.subject, 'Quick question about your team');
    assert.match(preview.body_text, /^Hi Priya,/);
    assert.match(preview.body_text, /If you'd rather not hear from me/);
    assert.match(preview.body_text, /500 Howard St/);
    assert.equal(preview.sendable, true);
    assert.match(preview.note, /sample sender/);

    const bare = ok(await api().post(`/campaigns/${campaign.id}/steps/${initial.id}/variants`, { subject_template: 'Re: hello', body_template: 'Hi {{ contact.last_name }}' }), 201);
    const blocked = ok(await api().post(`/campaigns/${campaign.id}/steps/${initial.id}/preview`, { contact_id: contactId, variant_id: bare.id }));
    assert.deepEqual([blocked.sendable, blocked.template_issues[0].code], [false, 'empty_variable']);
    const responded = ok(await api().get(`/campaigns/${campaign.id}/follow-up-sequences`)).data[1].steps[0];
    const adapt = ok(await api().post(`/campaigns/${campaign.id}/steps/${responded.id}/preview`, {}));
    assert.match(adapt.subject, /^Re: Quick question about Globex/);
    assert.match(adapt.note, /brief/);
  });

  it('enrolls contacts, skipping each one that must not be emailed and saying why (§8.5)', async () => {
    const campaign = await createCampaign();
    const other = await createCampaign({ name: 'Other' });
    await db.execute(`update campaigns set status = 'active' where id = '${other.id}'`);
    const fine = await contact({ email: 'fine@enroll.example' });
    const ids = {
      suppressed: await contact({ email: 'blocked@enroll.example' }),
      unsubscribed: await contact({ email: 'gone@enroll.example', subscription_status: 'unsubscribed' }),
      do_not_contact: await contact({ email: 'dnc@enroll.example', do_not_contact: true }),
      invalid: await contact({ email: 'bad@enroll.example', email_verification: 'bounced' }),
      consent_required: await contact({ email: 'eh@enroll.example', country: 'CA' }),
      role_account: await contact({ email: 'info@enroll.example', email_verification: 'risky', email_flags: ['role'] }),
      risky: await contact({ email: 'maybe@enroll.example', email_verification: 'catch_all' }),
      active_elsewhere: await contact({ email: 'busy@enroll.example' }),
      cooldown: await contact({ email: 'recent@enroll.example', last_contacted_at: new Date(Date.now() - 3 * 86_400_000) }),
    };
    ok(await api().post('/suppressions', { email: 'blocked@enroll.example' }), 201);
    await db.insert(threads).values({ id: newId('thread'), workspace_id: workspaceId, campaign_id: other.id, contact_id: ids.active_elsewhere });
    const missing = newId('contact');

    jobs.clear();
    const result = ok(await api().post(`/campaigns/${campaign.id}/enrollments`, { contact_ids: [fine, ...Object.values(ids), missing] }));
    assert.deepEqual(result.created.map((entry: any) => entry.contact_id), [fine]);
    const reasons = Object.fromEntries(result.skipped.map((entry: any) => [entry.contact_id, entry.reason]));
    for (const [reason, id] of Object.entries(ids)) assert.equal(reasons[id], reason, reason);
    assert.equal(reasons[missing], 'not_found');
    assert.deepEqual(jobs.of('thread.evaluate'), [{ thread_id: result.created[0].thread_id }]);
    const [enrolled] = await db.select().from(contacts).where(eq(contacts.id, fine));
    assert.equal(enrolled!.lifecycle_stage, 'prospect');

    const again = ok(await api().post(`/campaigns/${campaign.id}/enrollments`, { contact_ids: [fine] }));
    assert.deepEqual(again.skipped, [{ contact_id: fine, reason: 'already_enrolled' }]);
    const list = ok(await api().post('/lists', { name: 'Enroll list', kind: 'dynamic', filter: { field: 'email', op: 'ends_with', value: '@listed.example' } }), 201);
    await contact({ email: 'a@listed.example' });
    await contact({ email: 'b@listed.example' });
    assert.equal(ok(await api().post(`/campaigns/${campaign.id}/enrollments`, { list_id: list.id })).created.length, 2);
    assert.equal(ok(await api().get(`/campaigns/${campaign.id}`)).thread_count, 3);
  });

  it('blocks launch until preflight passes, then runs the lifecycle', async () => {
    const campaign = await createCampaign();
    const contactId = await contact({ email: 'launch@globex-launch.example', first_name: 'Lou' });
    ok(await api().post(`/campaigns/${campaign.id}/enrollments`, { contact_ids: [contactId] }));

    let preflight = ok(await api().get(`/campaigns/${campaign.id}/preflight`));
    const status = (id: string) => preflight.items.find((item: any) => item.id === id)?.status;
    assert.equal(preflight.passed, false);
    assert.deepEqual([status('goals'), status('initial_email'), status('follow_up_emails'), status('mailboxes'), status('audience'), status('links')], ['pass', 'pass', 'fail', 'fail', 'pass', 'pass']);
    assert.match(preflight.items.find((item: any) => item.id === 'follow_up_emails').detail, /placeholder/);

    problem(await api().post(`/campaigns/${campaign.id}/launch`), 403, 'forbidden_scope');
    const refused = problem(await as(sendKey).post(`/campaigns/${campaign.id}/launch`), 422, 'preflight_failed');
    assert.ok(refused.errors!.some((error) => error.path === 'mailboxes'));

    // Fix everything preflight complained about.
    const noReply = ok(await api().get(`/campaigns/${campaign.id}/follow-up-sequences`)).data[0];
    const variant = noReply.steps[1].variants[0];
    ok(await api().patch(`/campaigns/${campaign.id}/steps/${noReply.steps[1].id}/variants/${variant.id}`, { body_template: 'Hi {{ contact.first_name | default: "there" }}, teams like yours cut onboarding time by a third with us.\n\n{{ sender.first_name }}' }));
    const domainId = newId('domain');
    await db.insert(sending_domains).values({ id: domainId, workspace_id: workspaceId, domain: 'getacme.com', tracking_host: 'go.getacme.com', last_checked_at: new Date(), check_details: { ready: true } });
    const mailboxId = newId('mailbox');
    await db.insert(mailboxes).values({
      id: mailboxId, workspace_id: workspaceId, sending_domain_id: domainId, email: 'alex@getacme.com', display_name: 'Alex Rivera', auth: 'password', status: 'active',
      smtp_host: 'smtp.gmail.com', smtp_port: 465, smtp_secure: 'tls', smtp_username: 'alex', imap_host: 'imap.gmail.com', imap_username: 'alex', credentials_enc: Buffer.from('x'), credentials_key_version: 1, folders: {},
    });
    ok(await api().put(`/campaigns/${campaign.id}/mailboxes`, { mailboxes: [{ mailbox_id: mailboxId }] }));
    preflight = ok(await api().get(`/campaigns/${campaign.id}/preflight`));
    assert.equal(preflight.passed, true, JSON.stringify(preflight.items.filter((item: any) => item.status !== 'pass')));

    jobs.clear();
    const launched = ok(await as(sendKey).post(`/campaigns/${campaign.id}/launch`));
    assert.deepEqual([launched.status, Boolean(launched.launched_at)], ['active', true]);
    assert.equal(jobs.of('thread.evaluate').length, 1);
    problem(await as(sendKey).post(`/campaigns/${campaign.id}/launch`), 409, 'conflict');
    problem(await api().del(`/campaigns/${campaign.id}`), 409, 'conflict');
    assert.equal(ok(await api().post(`/campaigns/${campaign.id}/pause`)).status, 'paused');
    assert.equal(ok(await api().post(`/campaigns/${campaign.id}/resume`)).status, 'active');
    const [thread] = await db.select().from(threads).where(eq(threads.campaign_id, campaign.id));
    assert.ok(thread!.follow_ups_not_before, 'resuming reschedules follow-ups from now');
    assert.equal(ok(await api().post(`/campaigns/${campaign.id}/archive`)).status, 'archived');
    problem(await api().patch(`/campaigns/${campaign.id}`, { name: 'Renamed' }), 409, 'conflict');
    problem(await api().post(`/campaigns/${campaign.id}/enrollments`, { contact_ids: [contactId] }), 409, 'conflict');

    const draft = await createCampaign({ name: 'Throwaway' });
    ok(await api().post(`/campaigns/${draft.id}/enrollments`, { contact_ids: [await contact({ email: 'temp@globex-launch.example' })] }));
    assert.equal((await api().del(`/campaigns/${draft.id}`)).status, 204);
    problem(await api().get(`/campaigns/${draft.id}`), 404, 'not_found');
    assert.equal(ok(await api().get('/campaigns?status=archived')).data.length, 1);
  });
});
