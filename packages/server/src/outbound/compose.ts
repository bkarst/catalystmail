// Composing the next email of a thread (spec §7.2 step 4, `outbound.compose`): the step and a
// variant by weight, the template rendered for the contact with signature and footer, lint, the
// tracking pixel and unsubscribe link, threading headers, and the message stored as scheduled.

import type { Rng } from '@catalyst/core';
import { activities, campaign_step_variants, campaign_steps, campaigns, companies, contacts, mailboxes, messages, newId, sending_domains, threads, workspaces, type Executor } from '@catalyst/db';
import { messageIdFor, normalizeSubject, textToHtml } from '@catalyst/email';
import type { JobQueue } from '@catalyst/jobs';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { disclosesAi } from '../agent/budget.ts';
import { vocabularyFor } from '../campaigns/emails.ts';
import { buildContext, finishBody, lintBody, renderStep } from '../campaigns/render.ts';
import { raiseEscalation } from '../escalations/raise.ts';
import { openToken, unsubscribeToken } from '../public/tracking.ts';
import { planTrackedLinks, saveTrackedLinks } from './links.ts';

export interface ComposeDeps {
  jobs: JobQueue;
  rng: Rng;
  trackingSecret: string | null;
  /** Links fall back to the app's host when the domain has no tracking host. */
  appHost: string | null;
  now: Date;
  /** The AI agent is on: AI-mode steps go to `ai.compose` instead of to a person (§10.8). */
  ai?: boolean;
}

/** What the agent wrote for an AI-mode step, and whether it may send on its own (§10.7). */
export interface AiComposition {
  /** `ai_opening_line`: the line the template's `{{ ai.opening_line }}` takes. */
  openingLine?: string;
  /** `ai_adapt` / `ai_write`: the whole text, before signature and footer. */
  written?: { subject: string | null; body: string };
  status: 'scheduled' | 'pending_approval';
  runId: string | null;
  approvalReasons: string[];
  /** The variant the agent wrote from. */
  variantId?: string;
}

const AWAIT_AGENT_MS = 60 * 60_000;

export type ComposeResult =
  | { status: 'scheduled' | 'pending_approval'; messageId: string }
  | { status: 'ai_queued' }
  /** External agent mode (§10.7): the campaign's own agent writes it; the thread waits in the work queue. */
  | { status: 'awaiting_agent' }
  | { status: 'escalated'; escalationId: string; reason: 'ai_unavailable' | 'guardrail_failed' }
  | { status: 'skipped'; why: string };

const AI_MODES = new Set(['ai_opening_line', 'ai_adapt', 'ai_write']);

/** A variant drawn by weight from the active ones (§7.2 step 4). */
export function pickVariant<V extends { weight: number; active: boolean }>(variants: V[], rng: Rng): V | null {
  const live = variants.filter((variant) => variant.active && variant.weight > 0);
  const total = live.reduce((sum, variant) => sum + variant.weight, 0);
  if (total === 0) return null;
  let roll = rng() * total;
  for (const variant of live) {
    roll -= variant.weight;
    if (roll < 0) return variant;
  }
  return live.at(-1)!;
}

/**
 * Composes the thread's due initial email or follow-up on `mailboxId`, to send at `scheduledFor`.
 * Runs in the caller's transaction and re-checks the thread under a lock, so a stale scheduler
 * decision composes nothing.
 */
export async function composeNext(tx: Executor, input: { threadId: string; mailboxId: string; scheduledFor: Date; stepId?: string }, deps: ComposeDeps, ai?: AiComposition): Promise<ComposeResult> {
  const { now } = deps;
  const [thread] = await tx.select().from(threads).where(eq(threads.id, input.threadId)).for('update');
  if (!thread || thread.state !== 'active' || thread.next_action_message_id !== null) return { status: 'skipped', why: 'not due' };
  const kind = thread.next_action_type;
  if (kind !== 'send_initial' && kind !== 'send_follow_up') return { status: 'skipped', why: `next action is ${kind}` };

  const [owner] = await tx.select({ agentMode: campaigns.agent_mode }).from(campaigns).where(eq(campaigns.id, thread.campaign_id));
  // In external agent mode the built-in agent writes nothing (§10.7). The thread is looked at again
  // hourly meanwhile, and a reply the campaign's agent writes for it is taken as this email.
  const awaitAgent = async (): Promise<ComposeResult> => {
    await tx.update(threads).set({ next_action_at: new Date(Math.max(input.scheduledFor.getTime(), now.getTime()) + AWAIT_AGENT_MS), throttle_reason: 'awaiting_agent', updated_at: now }).where(eq(threads.id, thread.id));
    return { status: 'awaiting_agent' };
  };

  // A check-in the contact asked for (§5.10 rule 5) is always the agent's to write.
  if (kind === 'send_follow_up' && thread.check_in_at && thread.follow_up_sequence_id === null) {
    if (owner?.agentMode === 'external') return awaitAgent();
    if (deps.ai) {
      await deps.jobs.enqueue('ai.check_in', { thread_id: thread.id, mailbox_id: input.mailboxId, scheduled_for: input.scheduledFor.toISOString() }, { db: tx });
      await tx.update(threads).set({ next_action_at: new Date(Math.max(input.scheduledFor.getTime(), now.getTime()) + 10 * 60_000), throttle_reason: 'composing', updated_at: now }).where(eq(threads.id, thread.id));
      return { status: 'ai_queued' };
    }
    const { id } = await raiseEscalation(tx, { workspaceId: thread.workspace_id, threadId: thread.id, reason: 'ai_unavailable', title: 'A check-in is due', explanation: `The contact asked to hear from us again around ${thread.check_in_at.toISOString().slice(0, 10)}. The AI agent writes check-ins and isn’t connected: write it yourself, or cancel the check-in.` }, now);
    await deps.jobs.enqueue('thread.evaluate', { thread_id: thread.id }, { db: tx });
    return { status: 'escalated', escalationId: id, reason: 'ai_unavailable' };
  }

  const [step] =
    kind === 'send_initial'
      ? await tx.select().from(campaign_steps).where(and(eq(campaign_steps.campaign_id, thread.campaign_id), isNull(campaign_steps.sequence_id)))
      : await tx
          .select()
          .from(campaign_steps)
          .where(and(eq(campaign_steps.sequence_id, thread.follow_up_sequence_id ?? ''), eq(campaign_steps.position, thread.follow_up_step_position ?? 0)));
  if (!step) return { status: 'skipped', why: 'the step no longer exists' };

  const escalate = async (reason: 'ai_unavailable' | 'guardrail_failed', title: string, explanation: string): Promise<ComposeResult> => {
    const { id } = await raiseEscalation(tx, { workspaceId: thread.workspace_id, threadId: thread.id, reason, title, explanation }, now);
    await deps.jobs.enqueue('thread.evaluate', { thread_id: thread.id }, { db: tx });
    return { status: 'escalated', escalationId: id, reason };
  };

  // The agent was asked for one step; if the thread has moved on since, nothing is composed.
  if (input.stepId && input.stepId !== step.id) return { status: 'skipped', why: 'a different step is due now' };
  if (AI_MODES.has(step.mode) && !ai && owner?.agentMode === 'external') return awaitAgent();
  if (AI_MODES.has(step.mode) && !ai && deps.ai) {
    // The agent writes it (§10.8). The thread is held a little, so the next tick doesn't ask again.
    await deps.jobs.enqueue('ai.compose', { thread_id: thread.id, step_id: step.id, mailbox_id: input.mailboxId, scheduled_for: input.scheduledFor.toISOString() }, { db: tx });
    await tx.update(threads).set({ next_action_at: new Date(Math.max(input.scheduledFor.getTime(), now.getTime()) + 10 * 60_000), throttle_reason: 'composing', updated_at: now }).where(eq(threads.id, thread.id));
    return { status: 'ai_queued' };
  }
  if (AI_MODES.has(step.mode) && !ai) {
    return escalate(
      'ai_unavailable',
      'An AI-written email is due',
      `This ${kind === 'send_initial' ? 'initial email' : `follow-up (step ${step.position})`} is written by the AI agent (${step.mode}), which isn't connected yet. Write it yourself, or change the step to a template.`,
    );
  }

  const variants = await tx.select().from(campaign_step_variants).where(eq(campaign_step_variants.step_id, step.id)).orderBy(asc(campaign_step_variants.label));
  // The agent wrote from one variant; that is the one recorded.
  const variant = (ai?.variantId ? variants.find((entry) => entry.id === ai.variantId && entry.active) : undefined) ?? pickVariant(variants, deps.rng);
  if (!variant) return escalate('guardrail_failed', 'No active variant to send', 'The step that is due has no active variant. Add one or activate one on the Emails tab.');

  const [campaign] = await tx.select().from(campaigns).where(eq(campaigns.id, thread.campaign_id));
  const [contact] = await tx.select().from(contacts).where(eq(contacts.id, thread.contact_id));
  const [company] = contact!.company_id ? await tx.select().from(companies).where(eq(companies.id, contact!.company_id)) : [];
  const [mailbox] = await tx.select().from(mailboxes).where(eq(mailboxes.id, input.mailboxId));
  const [domain] = await tx.select().from(sending_domains).where(eq(sending_domains.id, mailbox!.sending_domain_id));
  const [workspace] = await tx.select({ name: workspaces.name, physical_address: workspaces.physical_address, settings: workspaces.settings }).from(workspaces).where(eq(workspaces.id, thread.workspace_id));

  const messageId = newId('message');
  const host = domain!.tracking_host ?? deps.appHost;
  const unsubscribe = deps.trackingSecret && host ? unsubscribeToken(messageId, deps.trackingSecret) : null;
  const unsubscribeUrl = unsubscribe ? `https://${host}/u/${unsubscribe}` : '';
  const vocabulary = await vocabularyFor(tx, campaign!);
  const campaignData = {
    name: campaign!.name,
    links: campaign!.links as Record<string, string>,
    persona: campaign!.persona as { sender_role?: string | null },
    unsubscribe_footer: campaign!.unsubscribe_footer && unsubscribe !== null,
    list_unsubscribe_header: campaign!.list_unsubscribe_header && unsubscribe !== null,
  };
  const context = buildContext(
    { contact: contact!, company: company ? { name: company.name, domain: company.domain, custom_fields: company.custom_fields } : null },
    { display_name: mailbox!.display_name, signature_text: mailbox!.signature_text },
    campaignData,
    workspace!,
    unsubscribeUrl,
    vocabulary,
  );
  const asReply = kind === 'send_follow_up' && step.send_as_reply && thread.subject !== null;
  if (ai?.openingLine !== undefined) context.ai = { opening_line: ai.openingLine };
  const renderCampaign = { ...campaignData, unsubscribe_footer: campaign!.unsubscribe_footer, list_unsubscribe_header: campaign!.list_unsubscribe_header };
  // The agent wrote some of it: an opening line, or all of it.
  const aiDisclosure = (ai?.openingLine !== undefined || ai?.written !== undefined) && disclosesAi(workspace!.settings);
  const fromTemplate = renderStep({
    subjectTemplate: variant.subject_template,
    bodyTemplate: variant.body_template,
    replySubject: asReply ? `Re: ${thread.subject}` : null,
    context,
    vocabulary,
    campaign: renderCampaign,
    isFirstTouch: kind === 'send_initial',
    aiMode: false,
    aiDisclosure,
  });
  // Text the agent wrote takes the template's place; the signature and footer are added the same way.
  const rendered = ai?.written
    ? (() => {
        const subject = asReply ? `Re: ${thread.subject}` : (ai.written.subject ?? fromTemplate.subject);
        const bodyText = finishBody(ai.written.body, context, vocabulary, renderCampaign, { aiDisclosure });
        const lint = subject === null ? [] : lintBody({ subject, bodyText, isFirstTouch: kind === 'send_initial', campaign: renderCampaign, physicalAddress: workspace!.physical_address });
        return { subject, bodyText, templateIssues: [], lint, sendable: subject !== null && !lint.some((finding) => finding.severity === 'blocker') };
      })()
    : fromTemplate;
  if (!rendered.sendable || rendered.bodyText === null || rendered.subject === null) {
    const problems = [...rendered.templateIssues.map((issue) => issue.message), ...rendered.lint.filter((finding) => finding.severity === 'blocker').map((finding) => finding.message)];
    return escalate('guardrail_failed', 'An email failed its checks and was not sent', `Variant ${variant.label} of ${kind === 'send_initial' ? 'the initial email' : `follow-up step ${step.position}`} can't be sent to ${contact!.email}: ${problems.join(' ')}`);
  }

  // Open tracking needs the domain's own tracking host: a shared one is a spam signal (§9.1).
  const tracked = (step.include_tracking ?? (campaign!.open_tracking && (kind !== 'send_initial' || campaign!.track_first_touch))) && domain!.tracking_host !== null && deps.trackingSecret !== null;
  const pixel = tracked ? openToken(messageId, deps.trackingSecret!) : null;
  const links = planTrackedLinks(messageId, rendered.bodyText, { enabled: campaign!.click_tracking, host: domain!.tracking_host, secret: deps.trackingSecret, links: campaign!.links as Record<string, string> });
  const html = textToHtml(rendered.bodyText, { pixelUrl: pixel ? `https://${domain!.tracking_host}/t/o/${pixel}.gif` : null, href: links.href });

  const earlier = asReply
    ? await tx
        .select({ header: messages.message_id_header })
        .from(messages)
        .where(and(eq(messages.thread_id, thread.id), inArray(messages.status, ['sent', 'received', 'bounced'])))
        .orderBy(sql`coalesce(${messages.sent_at}, ${messages.received_at}, ${messages.created_at})`)
    : [];
  const references = earlier.map((entry) => entry.header).slice(-20);
  const header = messageIdFor(messageId, domain!.domain);

  await tx.insert(messages).values({
    id: messageId,
    workspace_id: thread.workspace_id,
    thread_id: thread.id,
    mailbox_id: mailbox!.id,
    direction: 'outbound',
    status: ai?.status ?? 'scheduled',
    author: ai ? 'ai' : 'template',
    ai_run_id: ai?.runId ?? null,
    step_id: step.id,
    variant_id: variant.id,
    message_id_header: header,
    in_reply_to_header: references.at(-1) ?? null,
    references_headers: references,
    from_email: mailbox!.email,
    from_name: mailbox!.display_name,
    to_emails: [contact!.email],
    subject: rendered.subject,
    body_text: rendered.bodyText,
    body_html: html,
    snippet: rendered.bodyText.replace(/\s+/g, ' ').slice(0, 140),
    scheduled_for: input.scheduledFor,
    tracking_token: pixel,
    lint_report: rendered.lint,
    created_at: now,
    updated_at: now,
  });
  await saveTrackedLinks(tx, links);
  await tx
    .update(threads)
    .set({
      mailbox_id: mailbox!.id,
      // Claimed here, not left to evaluation: the next tick must not compose this send again.
      next_action_message_id: messageId,
      next_action_at: input.scheduledFor,
      throttle_reason: null,
      ...(kind === 'send_initial' && { subject: normalizeSubject(rendered.subject), root_message_id_header: header }),
      updated_at: now,
    })
    .where(eq(threads.id, thread.id));
  await tx.insert(activities).values({
    id: newId('activity'),
    workspace_id: thread.workspace_id,
    contact_id: thread.contact_id,
    thread_id: thread.id,
    campaign_id: thread.campaign_id,
    type: ai?.status === 'pending_approval' ? 'message.pending_approval' : 'message.scheduled',
    actor_type: ai ? 'ai' : 'system',
    data: {
      message_id: messageId,
      step: kind === 'send_initial' ? 'initial' : `follow_up:${step.position}`,
      variant: variant.label,
      scheduled_for: input.scheduledFor.toISOString(),
      ...(ai && { ai_run_id: ai.runId, approval_reasons: ai.approvalReasons }),
    },
    occurred_at: now,
  });
  // Waiting for approval: it goes when a person approves it (approveDraft).
  if (ai?.status !== 'pending_approval') await deps.jobs.enqueue('outbound.send', { message_id: messageId }, { db: tx, startAfter: input.scheduledFor });
  await deps.jobs.enqueue('thread.evaluate', { thread_id: thread.id }, { db: tx });
  return { status: ai?.status ?? 'scheduled', messageId };
}
