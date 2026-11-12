import assert from 'node:assert/strict';

import { defaultSequences, intlZoneCalendar as calendar, type FollowUpSequence, type GoalRef } from '@catalyst/core';
import {
  activities,
  campaign_goals,
  campaign_steps,
  campaigns,
  contacts,
  escalations,
  follow_up_sequences,
  mailboxes,
  messages,
  newId,
  sending_domains,
  thread_goal_achievements,
  threads,
  tracking_events,
  workspaces,
  type Db,
} from '@catalyst/db';
import { createTestDatabase } from '@catalyst/db/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { evaluateThread } from './evaluate.ts';

const LA = 'America/Los_Angeles';
/** A wall-clock time in Los Angeles, 2026. */
const la = (month: number, day: number, hour = 0, minute = 0) => calendar.fromLocal({ year: 2026, month, day, hour, minute, second: 0 }, LA);
const local = (date: Date | null) => {
  assert.ok(date, 'expected a date');
  const l = calendar.toLocal(date, LA);
  return `${l.month}/${l.day} ${String(l.hour).padStart(2, '0')}:${String(l.minute).padStart(2, '0')}`;
};

// Needs a PostgreSQL server: set TEST_DATABASE_URL to any database on it.
const adminUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!adminUrl)('thread.evaluate against PostgreSQL (§5.6)', () => {
  let db: Db;
  let drop: () => Promise<void>;

  const workspaceId = newId('workspace');
  const mailboxId = newId('mailbox');
  const goals: GoalRef[] = [
    { id: newId('goal'), key: 'call_booked', name: 'Call booked', position: 1 },
    { id: newId('goal'), key: 'paid', name: 'Paid', position: 2 },
  ];

  /** Creates a campaign with its goals, an initial email and the given follow-up sequences. */
  async function createCampaign(sequences: FollowUpSequence[]) {
    const campaignId = newId('campaign');
    await db.insert(campaigns).values({
      id: campaignId,
      workspace_id: workspaceId,
      name: 'Agency outreach Q4',
      objective: 'Book discovery calls',
      status: 'active',
      persona: {},
      sending_window: { days: [1, 2, 3, 4, 5], start: '08:30', end: '17:30', tz: 'contact', fallback_tz: LA },
    });
    const campaignGoals = goals.map((goal) => ({ ...goal, id: newId('goal') }));
    await db.insert(campaign_goals).values(
      campaignGoals.map((goal) => ({ ...goal, campaign_id: campaignId, success_criteria: `The contact reached "${goal.name}".`, playbook: 'Be brief.' })),
    );
    const initialStepId = newId('step');
    await db.insert(campaign_steps).values({ id: initialStepId, campaign_id: campaignId, position: 1 });
    const stepIds = new Map<string, string>();
    for (const sequence of sequences) {
      await db.insert(follow_up_sequences).values({
        id: sequence.id,
        campaign_id: campaignId,
        name: sequence.name,
        stages: [...sequence.stages],
        finish: sequence.finish,
        final_wait_amount: sequence.finalWait.amount,
        final_wait_unit: sequence.finalWait.unit,
      });
      for (const step of sequence.steps) {
        const id = newId('step');
        stepIds.set(`${sequence.id}:${step.position}`, id);
        await db.insert(campaign_steps).values({
          id,
          campaign_id: campaignId,
          sequence_id: sequence.id,
          position: step.position,
          wait_amount: step.wait.amount,
          wait_unit: step.wait.unit,
          wait_from: step.waitFrom,
          mode: step.mode,
        });
      }
    }
    return { campaignId, campaignGoals, initialStepId, stepId: (sequenceId: string, position: number) => stepIds.get(`${sequenceId}:${position}`)! };
  }

  /** Enrolls a fresh contact: one queued thread. */
  async function enroll(campaignId: string, enrolledAt: Date) {
    const contactId = newId('contact');
    await db.insert(contacts).values({ id: contactId, workspace_id: workspaceId, email: `${contactId}@globex.com`, timezone: LA });
    const threadId = newId('thread');
    await db.insert(threads).values({ id: threadId, workspace_id: workspaceId, campaign_id: campaignId, contact_id: contactId, created_at: enrolledAt });
    return threadId;
  }

  async function sendMessage(threadId: string, sentAt: Date, stepId: string | null, author: 'template' | 'ai' | 'human_app' = 'template') {
    const id = newId('message');
    await db.update(threads).set({ mailbox_id: mailboxId }).where(eq(threads.id, threadId)); // assigned at the first send
    await db.insert(messages).values({
      id,
      workspace_id: workspaceId,
      thread_id: threadId,
      mailbox_id: mailboxId,
      direction: 'outbound',
      status: 'sent',
      author,
      step_id: stepId,
      message_id_header: `<${id}@getacme.com>`,
      from_email: 'alex@getacme.com',
      to_emails: ['priya@globex.com'],
      subject: 'Quick question',
      tracking_token: id,
      sent_at: sentAt,
      created_at: sentAt,
    });
    return id;
  }

  async function receiveMessage(threadId: string, receivedAt: Date, needsReply: number) {
    const id = newId('message');
    await db.insert(messages).values({
      id,
      workspace_id: workspaceId,
      thread_id: threadId,
      mailbox_id: mailboxId,
      direction: 'inbound',
      status: 'received',
      author: 'contact',
      message_id_header: `<${id}@globex.com>`,
      from_email: 'priya@globex.com',
      to_emails: ['alex@getacme.com'],
      subject: 'Re: Quick question',
      inbound_kind: 'human_reply',
      needs_reply_p: needsReply.toFixed(3),
      received_at: receivedAt,
      created_at: receivedAt,
    });
    return id;
  }

  const stored = async (threadId: string) => (await db.select().from(threads).where(eq(threads.id, threadId)))[0]!;
  const activityTypes = async (threadId: string) =>
    (await db.select({ type: activities.type }).from(activities).where(eq(activities.thread_id, threadId)).orderBy(activities.id)).map((row) => row.type);
  const escalationsOf = (threadId: string) => db.select().from(escalations).where(eq(escalations.thread_id, threadId));

  beforeAll(async () => {
    ({ db, drop } = await createTestDatabase(adminUrl!));
    await db.insert(workspaces).values({ id: workspaceId, name: 'Acme', physical_address: '500 Howard St', default_timezone: LA });
    const domainId = newId('domain');
    await db.insert(sending_domains).values({ id: domainId, workspace_id: workspaceId, domain: 'getacme.com' });
    await db.insert(mailboxes).values({
      id: mailboxId,
      workspace_id: workspaceId,
      sending_domain_id: domainId,
      email: 'alex@getacme.com',
      display_name: 'Alex',
      auth: 'password',
      smtp_host: 'smtp.example.com',
      smtp_port: 465,
      smtp_secure: 'tls',
      smtp_username: 'alex@getacme.com',
      imap_host: 'imap.example.com',
      imap_username: 'alex@getacme.com',
      credentials_enc: Buffer.from('encrypted'),
      credentials_key_version: 1,
      folders: { inbox: 'INBOX', sent: 'Sent', junk: 'Junk' },
    });
  });

  afterAll(async () => {
    await drop?.();
  });

  it('returns null for a thread that does not exist', async () => {
    assert.equal(await evaluateThread(db, newId('thread'), { now: la(10, 28, 9, 0) }), null);
  });

  it('walks a thread through the example timeline, writing only what changed (§22.E)', async () => {
    const sequences = defaultSequences(goals, () => newId('sequence'));
    const [noReply, wentQuiet] = sequences;
    const campaign = await createCampaign(sequences);
    const threadId = await enroll(campaign.campaignId, la(10, 27, 15, 2));

    // Enrolled: the initial email is next. A second evaluation changes nothing.
    const enrolled = await evaluateThread(db, threadId, { now: la(10, 27, 15, 3) });
    assert.deepEqual(enrolled!.changed, ['next_action_at']);
    assert.deepEqual((await evaluateThread(db, threadId, { now: la(10, 27, 15, 4) }))!.changed, []);
    assert.equal((await stored(threadId)).version, 1);

    // Initial email accepted: Sent, with follow-up 1 due after 3 business days.
    const initialId = await sendMessage(threadId, la(10, 28, 9, 14), campaign.initialStepId);
    await evaluateThread(db, threadId, { now: la(10, 28, 9, 15) });
    let row = await stored(threadId);
    assert.deepEqual([row.stage, row.stage_rank, row.state, row.next_action_type], ['sent', 1, 'active', 'send_follow_up']);
    assert.deepEqual([local(row.next_action_at), row.follow_up_sequence_id, row.follow_up_step_position], ['11/2 09:14', noReply!.id, 1]);
    assert.equal(local(row.first_sent_at), '10/28 09:14');

    // Grace period over: Received. The follow-up timer carries on.
    await evaluateThread(db, threadId, { now: la(10, 28, 13, 14) });
    row = await stored(threadId);
    assert.deepEqual([row.stage, local(row.received_at), local(row.next_action_at)], ['received', '10/28 13:14', '11/2 09:14']);

    // A human open recorded later: opened, and delivery stays as first established.
    await db.insert(tracking_events).values({
      id: newId('tracking_event'), workspace_id: workspaceId, message_id: initialId, thread_id: threadId, type: 'open', source: 'human', occurred_at: la(10, 28, 9, 40),
    });
    await evaluateThread(db, threadId, { now: la(10, 28, 14, 0) });
    row = await stored(threadId);
    assert.deepEqual([row.open_status, row.open_count, local(row.first_opened_at), local(row.received_at)], ['opened', 1, '10/28 09:40', '10/28 13:14']);

    // The contact replies with a question: Responded, a reply is owed.
    await receiveMessage(threadId, la(11, 10, 9, 52), 0.97);
    await evaluateThread(db, threadId, { now: la(11, 10, 9, 53) });
    row = await stored(threadId);
    assert.deepEqual([row.stage, row.stage_rank, row.next_action_type, row.next_action_at], ['responded', 3, 'send_reply', null]);
    assert.deepEqual([local(row.responded_at), row.follow_up_sequence_id], ['11/10 09:52', null]);

    // The agent can't answer: an open escalation holds the thread.
    const gapId = newId('escalation');
    await db.insert(escalations).values({
      id: gapId, workspace_id: workspaceId, thread_id: threadId, reason: 'knowledge_gap', reasons: ['knowledge_gap'], priority: 'high',
      title: 'Asked about SAML SSO', explanation: 'No knowledge item covers SSO.', due_at: la(11, 10, 13, 53),
    });
    await evaluateThread(db, threadId, { now: la(11, 10, 9, 54) });
    row = await stored(threadId);
    assert.deepEqual([row.state, row.next_action_type, row.open_escalations], ['needs_human', 'none', 1]);

    // The operator answers and the reply goes out: active again, on the Responded sequence.
    await db.update(escalations).set({ status: 'resolved', resolution: 'answered_for_ai' }).where(eq(escalations.id, gapId));
    await sendMessage(threadId, la(11, 10, 11, 20), null, 'human_app');
    await evaluateThread(db, threadId, { now: la(11, 10, 11, 21) });
    row = await stored(threadId);
    assert.deepEqual([row.state, row.next_action_type, row.open_escalations], ['active', 'send_follow_up', 0]);
    assert.deepEqual([local(row.next_action_at), row.follow_up_sequence_id, row.follow_up_step_position], ['11/12 11:20', wentQuiet!.id, 1]);
    assert.equal(local(row.waiting_since), '11/10 11:20');

    // Both Responded follow-ups go out and the contact stays quiet: the final wait runs.
    await sendMessage(threadId, la(11, 12, 11, 25), campaign.stepId(wentQuiet!.id, 1), 'ai');
    await sendMessage(threadId, la(11, 19, 11, 25), campaign.stepId(wentQuiet!.id, 2), 'ai');
    await evaluateThread(db, threadId, { now: la(11, 19, 11, 26) });
    row = await stored(threadId);
    assert.deepEqual([row.next_action_type, local(row.next_action_at), row.follow_ups_sent], ['await_reply', '11/26 11:25', 2]);

    // The final wait is over: the owner is told once, and the thread waits for them.
    const quiet = await evaluateThread(db, threadId, { now: la(11, 26, 11, 25) });
    assert.ok(quiet!.escalationId);
    row = await stored(threadId);
    assert.deepEqual([row.state, row.open_escalations, local(row.finish_applied_at)], ['needs_human', 1, '11/26 11:25']);
    const again = await evaluateThread(db, threadId, { now: la(11, 26, 11, 30) });
    assert.deepEqual([again!.changed, again!.escalationId], [[], null]);
    const raised = (await escalationsOf(threadId)).filter((escalation) => escalation.reason === 'went_quiet');
    assert.equal(raised.length, 1);
    assert.deepEqual([raised[0]!.priority, raised[0]!.status, local(raised[0]!.due_at)], ['normal', 'open', '11/27 11:25']);

    // Dismissed: the thread keeps waiting and the owner is not asked again.
    await db.update(escalations).set({ status: 'dismissed' }).where(eq(escalations.id, quiet!.escalationId!));
    await evaluateThread(db, threadId, { now: la(11, 27, 9, 0) });
    row = await stored(threadId);
    assert.deepEqual([row.state, row.next_action_type, row.next_action_at], ['active', 'await_reply', null]);
    assert.equal((await escalationsOf(threadId)).length, 2);

    // A payment arrives: final goal achieved, completed.
    const paid = campaign.campaignGoals[1]!;
    await db.insert(thread_goal_achievements).values({ thread_id: threadId, goal_id: paid.id, achieved_at: la(11, 30, 9, 12), method: 'external_event' });
    await evaluateThread(db, threadId, { now: la(11, 30, 9, 13) });
    row = await stored(threadId);
    assert.deepEqual([row.stage, row.stage_rank, row.achieved_goal_id, row.state, row.next_action_type], ['goal_achieved', 5, paid.id, 'completed', 'none']);
    assert.equal(local(row.completed_at), '11/30 09:12');

    assert.deepEqual(await activityTypes(threadId), [
      'thread.stage_changed', // queued → sent
      'thread.stage_changed', // sent → received
      'thread.stage_changed', // received → responded
      'thread.state_changed', // active → needs_human (knowledge gap)
      'thread.state_changed', // needs_human → active
      'escalation.created', // went quiet
      'thread.state_changed', // active → needs_human
      'thread.state_changed', // needs_human → active
      'thread.stage_changed', // responded → goal achieved
      'thread.state_changed', // active → completed
    ]);
  });

  it('closes a thread when the finish rule says so, and reopens it for a person when the contact replies (§5.4)', async () => {
    const sequenceId = newId('sequence');
    const campaign = await createCampaign([
      {
        id: sequenceId,
        name: 'One bump, then close',
        stages: ['sent', 'received'],
        steps: [{ position: 1, wait: { amount: 1, unit: 'business_days' }, waitFrom: 'last_message', mode: 'template' }],
        finish: 'close_lost',
        finalWait: { amount: 1, unit: 'business_days' },
        active: true,
      },
    ]);
    const threadId = await enroll(campaign.campaignId, la(11, 2, 8, 0));
    await sendMessage(threadId, la(11, 2, 9, 0), campaign.initialStepId);
    await sendMessage(threadId, la(11, 3, 9, 5), campaign.stepId(sequenceId, 1));

    await evaluateThread(db, threadId, { now: la(11, 4, 9, 5) });
    let row = await stored(threadId);
    assert.deepEqual([row.state, row.state_reason, row.closed_reason, local(row.closed_at), row.next_action_type], ['closed_lost', 'went_quiet', 'went_quiet', '11/4 09:05', 'none']);
    assert.deepEqual((await evaluateThread(db, threadId, { now: la(11, 5, 9, 0) }))!.changed, []);

    // The contact writes again: a person decides, and nothing is sent meanwhile.
    await receiveMessage(threadId, la(11, 9, 10, 0), 0.9);
    const reopened = await evaluateThread(db, threadId, { now: la(11, 9, 10, 1) });
    assert.ok(reopened!.escalationId);
    row = await stored(threadId);
    assert.deepEqual([row.stage, row.state, row.next_action_type, row.open_escalations], ['responded', 'needs_human', 'none', 1]);
    assert.deepEqual((await escalationsOf(threadId)).map((escalation) => escalation.reason), ['reopened']);
    assert.deepEqual((await evaluateThread(db, threadId, { now: la(11, 9, 10, 2) }))!.changed, []);
    assert.equal((await escalationsOf(threadId)).length, 1);
  });

  it('logs a change once when several evaluations race (optimistic lock)', async () => {
    const campaign = await createCampaign([]);
    const threadId = await enroll(campaign.campaignId, la(11, 2, 8, 0));
    await sendMessage(threadId, la(11, 2, 9, 0), campaign.initialStepId);

    const results = await Promise.all(Array.from({ length: 6 }, () => evaluateThread(db, threadId, { now: la(11, 2, 9, 1) })));
    assert.equal(results.filter((result) => result!.changed.length > 0).length, 1);
    assert.deepEqual(await activityTypes(threadId), ['thread.stage_changed']);
    const row = await stored(threadId);
    assert.deepEqual([row.stage, row.version], ['sent', 1]);

    const logged = await db.select().from(activities).where(and(eq(activities.thread_id, threadId), eq(activities.type, 'thread.stage_changed')));
    assert.deepEqual(logged[0]!.data, { from: 'queued', to: 'sent', from_rank: 0, to_rank: 1, goal_id: null });
  });
});
