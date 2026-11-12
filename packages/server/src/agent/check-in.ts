// The check-in a contact asked for (spec §5.10 rule 5, §10.1 `draft_follow_up`): "not now, try in
// March" set `threads.check_in_at`; on that date the composer hands it here. The agent writes it
// like a reply (threading, signature, footer), the guardrails check it with one revision, and the
// autonomy rules for an AI follow-up decide whether it sends (§10.7). Storing it clears the
// check-in; once it is sent, the stage's sequence restarts at step 1 from it.

import { intlZoneCalendar, isoDate } from '@catalyst/core';
import { campaigns, messages, threads, type Db } from '@catalyst/db';
import { and, count, eq } from 'drizzle-orm';

import { raiseEscalation } from '../escalations/raise.ts';
import { evaluateThread } from '../threads/evaluate.ts';
import { budgetExhausted, forWorkspace } from './budget.ts';
import { loadSetup, writeDraft, type AgentDeps } from './inbound.ts';

export interface CheckInInput {
  threadId: string;
  mailboxId: string;
  scheduledFor: Date;
}

export type CheckInOutcome = { status: 'skipped'; why: string } | { status: 'failed'; why: string } | { status: 'scheduled' | 'pending_approval'; messageId: string };

export async function composeCheckIn(db: Db, input: CheckInInput, deps: AgentDeps): Promise<CheckInOutcome> {
  const { now } = deps;
  const [thread] = await db.select().from(threads).where(eq(threads.id, input.threadId));
  if (!thread?.check_in_at || thread.state !== 'active' || thread.next_action_message_id || thread.next_action_type !== 'send_follow_up') return { status: 'skipped', why: 'no check-in is due' };
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, thread.campaign_id));
  if (campaign!.agent_mode !== 'built_in') return { status: 'skipped', why: 'the campaign uses an external agent' };
  deps = await forWorkspace(db, thread.workspace_id, deps);
  const setup = await loadSetup(db, thread, campaign!, deps, input.mailboxId);
  const date = isoDate(intlZoneCalendar.toLocal(thread.check_in_at, setup.zone));

  const fail = async (why: string): Promise<CheckInOutcome> => {
    await raiseEscalation(db, { workspaceId: thread.workspace_id, threadId: thread.id, reason: 'ai_unavailable', title: 'A check-in is due', explanation: `The contact asked to hear from us again around ${date}, and the AI agent couldn’t write the check-in (${why}). Write it yourself, or cancel the check-in.` }, now);
    await evaluateThread(db, thread.id, { now }).catch(() => deps.jobs.enqueue('thread.evaluate', { thread_id: thread.id }));
    return { status: 'failed', why };
  };
  if (await budgetExhausted(db, thread.workspace_id, now)) return fail('the workspace’s AI budget for this month is spent');

  // The contact has replied before: the check-in goes by that classification, the fallback's while Jev is off.
  const [replied] = await db.select({ n: count() }).from(messages).where(and(eq(messages.thread_id, thread.id), eq(messages.direction, 'inbound'), eq(messages.inbound_kind, 'human_reply')));
  const written = await writeDraft(
    db,
    setup,
    {
      notes: null,
      triggerMessageId: null,
      classificationBlockers: (replied?.n ?? 0) > 0 ? ['classification_fallback'] : null,
      escalationReasons: [],
      isNewParticipant: false,
      forceApproval: false,
      checkIn: { date, scheduledFor: new Date(Math.max(input.scheduledFor.getTime(), thread.check_in_at.getTime())) },
    },
    deps,
  );
  if (written.status === 'failed') return fail(written.error);
  if (written.failures.length > 0) {
    // A second guardrail failure escalates, with the email attached (§10.9).
    await raiseEscalation(db, { workspaceId: thread.workspace_id, threadId: thread.id, reason: 'guardrail_failed', title: 'An AI-written check-in failed its checks', explanation: written.failures.map((failure) => failure.message).join(' '), suggestedDraftId: written.stored.row.id }, now);
  }
  await evaluateThread(db, thread.id, { now }).catch(() => deps.jobs.enqueue('thread.evaluate', { thread_id: thread.id }));
  return { status: written.stored.scheduledFor ? 'scheduled' : 'pending_approval', messageId: written.stored.row.id };
}
