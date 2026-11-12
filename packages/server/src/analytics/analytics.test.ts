import assert from 'node:assert/strict';

import { campaign_goals, escalations, campaign_step_variants, campaign_steps, campaigns, contacts, follow_up_sequences, mailboxes, messages, newId, sending_domains, thread_goal_achievements, threads, type Db } from '@catalyst/db';
import { createTestDatabase } from '@catalyst/db/testing';
import { MemoryQueue } from '@catalyst/jobs';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { call, seedApiKey, seedWorkspace } from '../api/testing.ts';
import { raiseEscalation } from '../escalations/raise.ts';
import { setDb, setDeps } from '../runtime.ts';

// Needs a PostgreSQL server: set TEST_DATABASE_URL to any database on it.
const adminUrl = process.env.TEST_DATABASE_URL;
const ago = (days: number) => new Date(Date.now() - days * 86_400_000);

describe.skipIf(!adminUrl)('analytics: funnel, campaign stats and the Dashboard (§13.4, §15.4, §15.9)', () => {
  let db: Db;
  let drop: () => Promise<void>;
  let key: string;
  let otherKey: string;
  let campaignId: string;
  let workspaceId: string;
  const ids = { initial: newId('step'), followUp: newId('step'), a: newId('variant'), b: newId('variant'), a2: newId('variant'), call: newId('goal'), paid: newId('goal') };

  beforeAll(async () => {
    ({ db, drop } = await createTestDatabase(adminUrl!));
    setDb(db);
    setDeps({ jobs: new MemoryQueue(), config: { trackingTarget: null, appHost: null } });
    workspaceId = await seedWorkspace(db, 'Acme');
    ({ secret: key } = await seedApiKey(db, workspaceId, ['analytics:read']));
    ({ secret: otherKey } = await seedApiKey(db, await seedWorkspace(db, 'Other'), ['analytics:read']));
    const domainId = newId('domain');
    await db.insert(sending_domains).values({ id: domainId, workspace_id: workspaceId, domain: 'getacme.com', spf_status: 'pass', dkim_status: 'pass', dmarc_status: 'warn' });
    const mailboxId = newId('mailbox');
    await db.insert(mailboxes).values({ id: mailboxId, workspace_id: workspaceId, sending_domain_id: domainId, email: 'alex@getacme.com', display_name: 'Alex', auth: 'password', status: 'active', smtp_host: 's', smtp_port: 465, smtp_secure: 'tls', smtp_username: 'a', imap_host: 'i', imap_username: 'a', credentials_enc: Buffer.from('x'), credentials_key_version: 1, folders: {} });
    campaignId = newId('campaign');
    await db.insert(campaigns).values({ id: campaignId, workspace_id: workspaceId, name: 'Agency outreach Q4', objective: 'Paid', status: 'active', persona: {}, sending_window: { days: [1, 2, 3, 4, 5], start: '08:30', end: '17:30' } });
    await db.insert(campaign_goals).values([
      { id: ids.call, campaign_id: campaignId, position: 1, key: 'call', name: 'Call booked', success_criteria: 'Books', playbook: 'Offer a call' },
      { id: ids.paid, campaign_id: campaignId, position: 2, key: 'paid', name: 'Paid', success_criteria: 'Pays', playbook: 'Checkout', value_cents: 160_000 },
    ]);
    const sequenceId = newId('sequence');
    await db.insert(follow_up_sequences).values({ id: sequenceId, campaign_id: campaignId, name: 'No reply', stages: ['sent', 'received'] });
    await db.insert(campaign_steps).values([{ id: ids.initial, campaign_id: campaignId, position: 1 }, { id: ids.followUp, campaign_id: campaignId, sequence_id: sequenceId, position: 1 }]);
    await db.insert(campaign_step_variants).values([
      { id: ids.a, step_id: ids.initial, label: 'A', body_template: 'Hi' },
      { id: ids.b, step_id: ids.initial, label: 'B', body_template: 'Hello' },
      { id: ids.a2, step_id: ids.followUp, label: 'A', body_template: 'Bump' },
    ]);

    // Four threads: one replies and pays, one replies to the follow-up, one bounces, one only opens.
    const thread = async (name: string, milestones: Partial<typeof threads.$inferInsert>) => {
      const contactId = newId('contact');
      await db.insert(contacts).values({ id: contactId, workspace_id: workspaceId, email: `${name}@prospect.example` });
      const id = newId('thread');
      await db.insert(threads).values({ id, workspace_id: workspaceId, campaign_id: campaignId, contact_id: contactId, mailbox_id: mailboxId, stage: 'sent', stage_rank: 1, first_sent_at: ago(3), ...milestones });
      return id;
    };
    const email = (threadId: string, values: Partial<typeof messages.$inferInsert>) =>
      db.insert(messages).values({ id: newId('message'), workspace_id: workspaceId, thread_id: threadId, mailbox_id: mailboxId, direction: 'outbound', status: 'sent', author: 'template', message_id_header: `<${newId('message')}@x>`, from_email: 'alex@getacme.com', to_emails: [], subject: 'Hi', sent_at: ago(3), ...values });
    const reply = (threadId: string, at: Date) => email(threadId, { direction: 'inbound', status: 'received', author: 'contact', inbound_kind: 'human_reply', sent_at: null, received_at: at });

    const payer = await thread('payer', { received_at: ago(2.9), responded_at: ago(2) });
    await email(payer, { step_id: ids.initial, variant_id: ids.a });
    await reply(payer, ago(2));
    await db.insert(thread_goal_achievements).values([
      { thread_id: payer, goal_id: ids.call, achieved_at: ago(1), method: 'implied' },
      { thread_id: payer, goal_id: ids.paid, achieved_at: ago(1), method: 'external_event' },
    ]);
    const nudged = await thread('nudged', { received_at: ago(2.9), responded_at: ago(0.5) });
    await email(nudged, { step_id: ids.initial, variant_id: ids.b });
    await email(nudged, { step_id: ids.followUp, variant_id: ids.a2, sent_at: ago(1) });
    await reply(nudged, ago(0.5));
    const bounced = await thread('bounced', {});
    await email(bounced, { step_id: ids.initial, variant_id: ids.a, status: 'bounced' });
    const opener = await thread('opener', {});
    await email(opener, { step_id: ids.initial, variant_id: ids.b, human_open: true });
    await raiseEscalation(db, { workspaceId, threadId: payer, reason: 'complaint', title: 'Angry', explanation: 'Spam!' }, new Date());
  });
  afterAll(async () => {
    setDb(undefined);
    setDeps(undefined);
    await drop?.();
  });

  it('counts the funnel by stage, then by goal, with each step’s conversion', async () => {
    const response = await call('GET', `/analytics/funnel?campaign_id=${campaignId}`, { key });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.deepEqual(response.body.stages.map((stage: { key: string; count: number }) => [stage.key, stage.count]), [['sent', 4], ['received', 2], ['responded', 2], ['goal:call', 1], ['goal:paid', 1]]);
    assert.equal(response.body.stages[2].conversion, 1);
    assert.equal(response.body.stages[3].conversion, 0.5);
    assert.equal((await call('GET', `/analytics/funnel?campaign_id=${campaignId}`, { key: otherKey })).status, 404);
  });

  it('gives campaign stats by step and variant, crediting each first reply to the last email before it', async () => {
    const response = await call('GET', `/campaigns/${campaignId}/stats`, { key });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const stats = response.body;
    assert.deepEqual(stats.emails, { sent: 5, opened: 1, bounced: 1, replies: 2, open_rate: 0.2, reply_rate: 0.4, bounce_rate: 0.2 });
    const [initial, followUp] = stats.steps;
    assert.deepEqual([initial.label, initial.sent, initial.replies], ['Initial email', 4, 1]);
    assert.deepEqual(initial.variants.map((variant: { label: string; sent: number; replies: number; bounced: number; opened: number }) => [variant.label, variant.sent, variant.replies, variant.bounced, variant.opened]), [['A', 2, 1, 1, 0], ['B', 2, 0, 0, 1]]);
    assert.deepEqual([followUp.label, followUp.sent, followUp.replies, followUp.reply_rate], ['No reply · step 1', 1, 1, 1]);
    assert.deepEqual(stats.goals.map((goal: { key: string; achieved: number; value_cents: number | null }) => [goal.key, goal.achieved, goal.value_cents]), [['call', 1, null], ['paid', 1, 160_000]]);
    assert.equal(stats.value_cents, 160_000);
    assert.equal(stats.threads.total, 4);
    assert.equal((await call('GET', `/campaigns/${campaignId}/stats`, { key: otherKey })).status, 404);
  });

  it('fills the Dashboard tiles', async () => {
    const response = await call('GET', '/analytics/overview', { key });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const overview = response.body;
    assert.deepEqual(overview.needs_you, { open: 1, urgent: 1, pending_approval: 0 });
    assert.deepEqual([overview.reply_rate.rate, overview.reply_rate.previous, overview.reply_rate.change_points], [0.5, 0, 50], '2 of 4 threads emailed this week replied');
    assert.deepEqual(overview.goals, { reached: [{ name: 'Paid', count: 1 }], value_cents: 160_000 }, 'implied goals are not counted twice');
    assert.equal(overview.campaigns[0].funnel[0].count, 4);
    assert.deepEqual([overview.deliverability.domains_passing_dns, overview.deliverability.domains[0].domain], [1, 'getacme.com']);
    assert.ok(overview.recent_activity.some((activity: { type: string }) => activity.type === 'escalation.created'));
    const empty = (await call('GET', '/analytics/overview', { key: otherKey })).body;
    assert.deepEqual([empty.needs_you.open, empty.campaigns, empty.deliverability.domains], [0, [], []]);
  });

  it('lists the questions the knowledge base couldn’t answer, most asked first (§11.3)', async () => {
    const otherCampaign = newId('campaign');
    await db.insert(campaigns).values({ id: otherCampaign, workspace_id: workspaceId, name: 'Partners', objective: 'Partners', status: 'active', persona: {}, sending_window: { days: [1, 2, 3, 4, 5], start: '08:30', end: '17:30' } });
    const asked = async (campaign: string, questions: string[], daysAgo: number) => {
      const contactId = newId('contact');
      await db.insert(contacts).values({ id: contactId, workspace_id: workspaceId, email: `${contactId.slice(-8)}@asker.example` });
      const threadId = newId('thread');
      await db.insert(threads).values({ id: threadId, workspace_id: workspaceId, campaign_id: campaign, contact_id: contactId });
      const { id } = await raiseEscalation(db, { workspaceId, threadId, reason: 'knowledge_gap', title: `Asked: ${questions[0]}`, explanation: 'Unanswered.', questions: questions.map((text) => ({ text, why_unanswerable: 'The knowledge base doesn’t answer it.' })) }, ago(daysAgo));
      await db.update(escalations).set({ created_at: ago(daysAgo) }).where(eq(escalations.id, id));
      return id;
    };
    const first = await asked(campaignId, ['Do you support SAML SSO?', 'Is there an on-prem version?'], 20);
    const second = await asked(campaignId, ['do you support  SAML-SSO'], 3);
    const third = await asked(otherCampaign, ['Do you support SAML SSO??', 'Do you sign BAAs?'], 1);
    await db.update(escalations).set({ status: 'resolved', resolution: 'dismissed' }).where(eq(escalations.id, first));

    const response = await call('GET', '/analytics/knowledge-gaps', { key });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const [sso, ...rest] = response.body.data;
    assert.deepEqual(sso, { question: 'Do you support SAML SSO??', asked: 3, open: 2, answered: false, last_asked_at: sso.last_asked_at, escalation_ids: [third, second, first] }, 'the same question however it’s written, newest wording');
    assert.deepEqual(rest.map((gap: { question: string; asked: number }) => [gap.question, gap.asked]).sort(), [['Do you sign BAAs?', 1], ['Is there an on-prem version?', 1]]);

    const recent = (await call('GET', `/analytics/knowledge-gaps?days=7&campaign_id=${campaignId}`, { key })).body.data;
    assert.deepEqual(recent.map((gap: { question: string; asked: number; open: number }) => [gap.question, gap.asked, gap.open]), [['do you support  SAML-SSO', 1, 1]]);
    assert.equal((await call('GET', '/analytics/knowledge-gaps?limit=1', { key })).body.data.length, 1);
    assert.deepEqual((await call('GET', '/analytics/knowledge-gaps', { key: otherKey })).body.data, [], 'another workspace sees none of them');
    assert.equal((await call('GET', `/analytics/knowledge-gaps?campaign_id=${campaignId}`, { key: otherKey })).status, 404);
  });
});
