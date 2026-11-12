// Enrollment (spec §8.5), preflight (§8.11) and step preview (§13.4 previewCampaignStep). Enrollment
// and the preflight audience share one set of skip rules, so what preflight promises is what
// enrollment does.

import { validateSequences } from '@catalyst/core';
import {
  activities,
  campaign_mailboxes,
  campaign_steps,
  campaigns,
  companies,
  contacts,
  emailDomain,
  emailHash,
  knowledge_items,
  mailboxes,
  newId,
  sending_domains,
  suppressions,
  threads,
  workspaces,
  type Db,
  type Executor,
} from '@catalyst/db';
import type { JobQueue } from '@catalyst/jobs';
import { and, asc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';

import type { Principal } from '../api/auth.ts';
import { conflict, invalidField, notFound } from '../api/errors.ts';
import { actorOf } from '../shared.ts';
import { evaluateThreads } from '../threads/evaluation.ts';
import { findList, membershipCondition } from '../lists/service.ts';
import { PLACEHOLDER_MARK } from './defaults.ts';
import { initialStep, loadSequences, variantsOf, vocabularyFor } from './emails.ts';
import { loadGoals } from './goals.ts';
import { buildContext, renderStep, type RecipientData, type SenderData } from './render.ts';
import { findCampaign, type CampaignRow } from './service.ts';

type ContactRow = typeof contacts.$inferSelect;
export type SkipReason =
  | 'not_found' | 'already_enrolled' | 'suppressed' | 'unsubscribed' | 'do_not_contact' | 'invalid' | 'risky' | 'role_account' | 'active_elsewhere' | 'cooldown' | 'consent_required';

const NON_TERMINAL = ['active', 'pending_approval', 'needs_human', 'paused'] as const;
const DEFAULT_RULES = { skip_active_elsewhere: true, cooldown_days: 30, allow_role_accounts: false, allow_risky: false };

/** Why each contact must not be enrolled in this campaign, or null when it may be (§8.5). */
export async function skipReasons(db: Executor, campaign: CampaignRow, rows: ContactRow[], now: Date): Promise<Map<string, SkipReason | null>> {
  const rules = { ...DEFAULT_RULES, ...(campaign.enrollment_rules as object) };
  const result = new Map<string, SkipReason | null>();
  if (rows.length === 0) return result;
  const ids = rows.map((row) => row.id);

  const hashes = rows.map((row) => emailHash(row.email));
  const domains = [...new Set(rows.map((row) => emailDomain(row.email)))];
  const blocks = await db
    .select({ email_hash: suppressions.email_hash, domain: suppressions.domain })
    .from(suppressions)
    .where(and(eq(suppressions.workspace_id, campaign.workspace_id), or(inArray(suppressions.email_hash, hashes), inArray(suppressions.domain, domains))));
  const blockedHashes = new Set(blocks.flatMap((block) => (block.email_hash ? [block.email_hash.toString('hex')] : [])));
  const blockedDomains = new Set(blocks.flatMap((block) => (block.domain ? [block.domain.toLowerCase()] : [])));

  const elsewhere = rules.skip_active_elsewhere
    ? new Set(
        (
          await db
            .select({ contact_id: threads.contact_id })
            .from(threads)
            .innerJoin(campaigns, eq(campaigns.id, threads.campaign_id))
            .where(and(inArray(threads.contact_id, ids), ne(threads.campaign_id, campaign.id), inArray(threads.state, [...NON_TERMINAL]), inArray(campaigns.status, ['active', 'paused']), isNull(campaigns.deleted_at)))
        ).map((row) => row.contact_id),
      )
    : new Set<string>();
  const cooldownStart = new Date(now.getTime() - rules.cooldown_days * 86_400_000);

  for (const row of rows) {
    let reason: SkipReason | null = null;
    if (blockedHashes.has(emailHash(row.email).toString('hex')) || blockedDomains.has(emailDomain(row.email))) reason = 'suppressed';
    else if (row.subscription_status !== 'subscribed') reason = 'unsubscribed';
    else if (row.do_not_contact) reason = 'do_not_contact';
    else if (row.email_verification === 'invalid' || row.email_verification === 'bounced') reason = 'invalid';
    else if (row.country?.toUpperCase() === 'CA' && row.consent_basis === 'unknown') reason = 'consent_required';
    else if (row.email_flags.includes('role') && !rules.allow_role_accounts) reason = 'role_account';
    else if ((row.email_verification === 'risky' || row.email_verification === 'catch_all') && !rules.allow_risky) reason = 'risky';
    else if (elsewhere.has(row.id)) reason = 'active_elsewhere';
    else if (rules.cooldown_days > 0 && row.last_contacted_at && row.last_contacted_at > cooldownStart) reason = 'cooldown';
    result.set(row.id, reason);
  }
  return result;
}

export const MAX_LIST_ENROLLMENT = 5000;

export async function enrollContacts(
  db: Db,
  principal: Principal,
  campaignId: string,
  input: { contact_ids?: string[] | undefined; list_id?: string | undefined },
  jobs: JobQueue,
  now: Date,
) {
  const workspaceId = principal.workspace.id;
  if ((input.contact_ids === undefined) === (input.list_id === undefined)) throw invalidField('body.contact_ids', 'Give exactly one of contact_ids or list_id.');
  return db.transaction(async (tx) => {
    const campaign = await findCampaign(tx, workspaceId, campaignId, { lock: true });
    if (campaign.status === 'archived' || campaign.status === 'completed') throw conflict(`A ${campaign.status} campaign takes no new contacts.`);

    const skipped: { contact_id: string; reason: SkipReason }[] = [];
    let rows: ContactRow[];
    const live = and(eq(contacts.workspace_id, workspaceId), isNull(contacts.deleted_at));
    if (input.contact_ids) {
      const ids = [...new Set(input.contact_ids)];
      rows = await tx.select().from(contacts).where(and(live, inArray(contacts.id, ids)));
      const found = new Set(rows.map((row) => row.id));
      for (const id of ids) if (!found.has(id)) skipped.push({ contact_id: id, reason: 'not_found' });
    } else {
      const list = await findList(tx, workspaceId, input.list_id!).catch(() => {
        throw invalidField('body.list_id', 'No such list in this workspace.');
      });
      rows = await tx.select().from(contacts).where(and(live, await membershipCondition(tx, workspaceId, list, now))).orderBy(asc(contacts.id)).limit(MAX_LIST_ENROLLMENT + 1);
      if (rows.length > MAX_LIST_ENROLLMENT) throw invalidField('body.list_id', `The list has more than ${MAX_LIST_ENROLLMENT} contacts; enroll it in parts.`);
    }

    const enrolled = new Set(
      rows.length ? (await tx.select({ contact_id: threads.contact_id }).from(threads).where(and(eq(threads.campaign_id, campaignId), inArray(threads.contact_id, rows.map((row) => row.id))))).map((row) => row.contact_id) : [],
    );
    const fresh = rows.filter((row) => {
      if (!enrolled.has(row.id)) return true;
      skipped.push({ contact_id: row.id, reason: 'already_enrolled' });
      return false;
    });
    const reasons = await skipReasons(tx, campaign, fresh, now);
    const accepted = fresh.filter((row) => {
      const reason = reasons.get(row.id);
      if (reason) skipped.push({ contact_id: row.id, reason });
      return !reason;
    });

    const created: { contact_id: string; thread_id: string }[] = [];
    for (let start = 0; start < accepted.length; start += 500) {
      const chunk = accepted.slice(start, start + 500).map((row) => ({ id: newId('thread'), workspace_id: workspaceId, campaign_id: campaignId, contact_id: row.id, created_at: now, updated_at: now }));
      const inserted = await tx.insert(threads).values(chunk).onConflictDoNothing().returning({ id: threads.id, contact_id: threads.contact_id });
      created.push(...inserted.map((row) => ({ contact_id: row.contact_id, thread_id: row.id })));
    }
    if (created.length > 0) {
      const contactIds = created.map((entry) => entry.contact_id);
      // Enrollment moves a lead to prospect; lifecycle never moves backwards on its own (§5.9).
      await tx.update(contacts).set({ lifecycle_stage: 'prospect', updated_at: now }).where(and(inArray(contacts.id, contactIds), eq(contacts.lifecycle_stage, 'lead')));
      for (let start = 0; start < created.length; start += 1000) {
        await tx.insert(activities).values(
          created.slice(start, start + 1000).map((entry) => ({
            id: newId('activity'),
            workspace_id: workspaceId,
            contact_id: entry.contact_id,
            thread_id: entry.thread_id,
            campaign_id: campaignId,
            type: 'thread.enrolled',
            ...actorOf(principal),
            data: { campaign_name: campaign.name },
            occurred_at: now,
          })),
        );
      }
      await evaluateThreads(tx, jobs, created.map((entry) => entry.thread_id));
    }
    return { created, skipped };
  });
}

// ── Rendering support ──────────────────────────────────────────────────────────────────────────

async function recipientsFor(db: Executor, contactRows: ContactRow[]): Promise<Map<string, RecipientData>> {
  const companyIds = [...new Set(contactRows.map((row) => row.company_id).filter((id): id is string => id !== null))];
  const companyRows = companyIds.length ? await db.select().from(companies).where(inArray(companies.id, companyIds)) : [];
  return new Map(
    contactRows.map((row) => {
      const company = companyRows.find((entry) => entry.id === row.company_id);
      return [row.id, { contact: row, company: company ? { name: company.name, domain: company.domain, custom_fields: company.custom_fields } : null }];
    }),
  );
}

interface CampaignContext {
  campaign: CampaignRow;
  workspace: { name: string; physical_address: string };
  sender: SenderData | null;
  unsubscribeUrl: string;
}

async function campaignContext(db: Executor, campaign: CampaignRow, appHost: string | null): Promise<CampaignContext> {
  const [workspace] = await db.select({ name: workspaces.name, physical_address: workspaces.physical_address }).from(workspaces).where(eq(workspaces.id, campaign.workspace_id));
  const [sender] = await db
    .select({ display_name: mailboxes.display_name, signature_text: mailboxes.signature_text, tracking_host: sending_domains.tracking_host })
    .from(campaign_mailboxes)
    .innerJoin(mailboxes, eq(mailboxes.id, campaign_mailboxes.mailbox_id))
    .innerJoin(sending_domains, eq(sending_domains.id, mailboxes.sending_domain_id))
    .where(eq(campaign_mailboxes.campaign_id, campaign.id))
    .orderBy(asc(mailboxes.email))
    .limit(1);
  const host = sender?.tracking_host ?? appHost ?? 'catalyst.invalid';
  return { campaign, workspace: workspace!, sender: sender ? { display_name: sender.display_name, signature_text: sender.signature_text } : null, unsubscribeUrl: `https://${host}/u/preview-token` };
}

const campaignData = (campaign: CampaignRow) => ({
  name: campaign.name,
  links: campaign.links as Record<string, string>,
  persona: campaign.persona as { sender_role?: string | null },
  unsubscribe_footer: campaign.unsubscribe_footer,
  list_unsubscribe_header: campaign.list_unsubscribe_header,
});

// ── Preview ────────────────────────────────────────────────────────────────────────────────────

export async function previewStep(
  db: Db,
  workspaceId: string,
  campaignId: string,
  stepId: string,
  input: { contact_id?: string | undefined; thread_id?: string | undefined; variant_id?: string | undefined },
  appHost: string | null,
) {
  const campaign = await findCampaign(db, workspaceId, campaignId);
  const [step] = await db.select().from(campaign_steps).where(and(eq(campaign_steps.id, stepId), eq(campaign_steps.campaign_id, campaignId)));
  if (!step) throw notFound('The step');
  const variants = await variantsOf(db, [stepId]);
  const variant = input.variant_id ? variants.find((entry) => entry.id === input.variant_id) : (variants.find((entry) => entry.active) ?? variants[0]);
  if (!variant) throw input.variant_id ? invalidField('body.variant_id', 'No such variant on this step.') : conflict('This step has no variants yet.');

  let contactId = input.contact_id ?? null;
  if (input.thread_id) {
    const [thread] = await db.select({ contact_id: threads.contact_id }).from(threads).where(and(eq(threads.id, input.thread_id), eq(threads.workspace_id, workspaceId)));
    if (!thread) throw invalidField('body.thread_id', 'No such thread in this workspace.');
    contactId = thread.contact_id;
  }
  let recipient: RecipientData | null = null;
  if (contactId) {
    const [row] = await db.select().from(contacts).where(and(eq(contacts.id, contactId), eq(contacts.workspace_id, workspaceId), isNull(contacts.deleted_at)));
    if (!row) throw invalidField('body.contact_id', 'No such contact in this workspace.');
    recipient = (await recipientsFor(db, [row])).get(row.id)!;
  }

  const context = await campaignContext(db, campaign, appHost);
  const vocabulary = await vocabularyFor(db, campaign);
  const templateContext = buildContext(recipient, context.sender, campaignData(campaign), context.workspace, context.unsubscribeUrl, vocabulary);
  const replySubject = step.sequence_id !== null && step.send_as_reply ? await replySubjectFor(db, campaignId, templateContext, vocabulary) : null;
  const aiMode = step.mode === 'ai_adapt' || step.mode === 'ai_write';
  const rendered = renderStep({ subjectTemplate: variant.subject_template, bodyTemplate: variant.body_template, replySubject, context: templateContext, vocabulary, campaign: campaignData(campaign), isFirstTouch: step.sequence_id === null, aiMode });
  const notes: Record<string, string | null> = {
    template: null,
    ai_opening_line: 'An AI-written first line about the contact is added above this text when it is sent.',
    ai_adapt: 'This text is a brief: the AI rewrites it to fit each conversation, keeping its call to action and links.',
    ai_write: 'The AI writes this message from the guidance and the current goal’s playbook.',
  };
  return {
    variant_id: variant.id,
    subject: rendered.subject,
    body_text: rendered.bodyText,
    template_issues: rendered.templateIssues,
    lint: rendered.lint,
    sendable: rendered.sendable,
    note: [notes[step.mode], context.sender ? null : 'No mailbox is assigned yet, so a sample sender is shown.'].filter(Boolean).join(' ') || null,
  };
}

/** "Re: " plus the initial email's subject as rendered for this recipient. */
async function replySubjectFor(db: Executor, campaignId: string, context: ReturnType<typeof buildContext>, vocabulary: Awaited<ReturnType<typeof vocabularyFor>>): Promise<string> {
  const initial = await initialStep(db, campaignId);
  const [first] = (await variantsOf(db, [initial.id])).filter((variant) => variant.active && variant.subject_template);
  if (!first) return 'Re: (the initial email’s subject)';
  const { renderTemplate } = await import('@catalyst/email');
  return `Re: ${renderTemplate(first.subject_template!, context, vocabulary).output ?? '(the initial email’s subject)'}`;
}

// ── Preflight ──────────────────────────────────────────────────────────────────────────────────

export interface PreflightItem {
  id: string;
  status: 'pass' | 'warn' | 'fail';
  title: string;
  detail: string | null;
}

const SAMPLE_SIZE = 20;
const KB_TOKEN_WARNING = 150_000;
const URL_PATTERN = /https?:\/\/[^\s<>()"'{}]+[^\s<>()"'{}.,;:!?]/g;

export async function runPreflight(db: Executor, campaign: CampaignRow, now: Date, appHost: string | null) {
  const items: PreflightItem[] = [];
  const add = (id: string, status: PreflightItem['status'], title: string, detail: string | null) => items.push({ id, status, title, detail });
  const goals = await loadGoals(db, campaign.id);
  const vocabulary = await vocabularyFor(db, campaign);
  const context = await campaignContext(db, campaign, appHost);

  // Goals and playbooks.
  if (goals.length === 0) add('goals', 'fail', 'Goals', 'Add at least one goal, such as "Call booked".');
  else {
    const missing = goals.filter((goal) => !goal.playbook.trim());
    add('goals', missing.length ? 'fail' : 'pass', 'Goals', missing.length ? `Write a playbook for ${missing.map((goal) => goal.name).join(', ')}.` : `${goals.length} goal(s), each with a playbook.`);
  }

  // Audience: enrolled contacts that may still be emailed.
  const enrolledRows = await db.select().from(contacts).innerJoin(threads, eq(threads.contact_id, contacts.id)).where(and(eq(threads.campaign_id, campaign.id), eq(threads.state, 'active')));
  const enrolled = enrolledRows.map((row) => row.contacts);
  const reasons = await skipReasons(db, campaign, enrolled, now);
  const skipped: Record<string, number> = {};
  for (const reason of reasons.values()) if (reason && reason !== 'active_elsewhere' && reason !== 'cooldown') skipped[reason] = (skipped[reason] ?? 0) + 1;
  const enrollable = enrolled.filter((row) => {
    const reason = reasons.get(row.id);
    return !reason || reason === 'active_elsewhere' || reason === 'cooldown';
  });
  add('audience', enrollable.length > 0 ? 'pass' : 'fail', 'Audience', enrollable.length > 0 ? `${enrollable.length} contact(s) can be emailed.${Object.keys(skipped).length ? ` ${Object.values(skipped).reduce((a, b) => a + b, 0)} enrolled contact(s) can no longer be emailed.` : ''}` : 'Enroll at least one contact who can be emailed.');

  // Emails: every active variant of every step renders for a sample of contacts without blockers.
  const sample = await recipientsFor(db, enrollable.slice(0, SAMPLE_SIZE));
  const recipients: (RecipientData | null)[] = sample.size > 0 ? [...sample.values()] : [null];
  const campaignInfo = campaignData(campaign);
  const initial = await initialStep(db, campaign.id);
  const sequenceRows = await loadSequences(db, campaign.id);
  const allSteps = await db.select().from(campaign_steps).where(eq(campaign_steps.campaign_id, campaign.id));
  const allVariants = await variantsOf(db, allSteps.map((step) => step.id));
  const describe = (step: (typeof allSteps)[number]) => (step.sequence_id === null ? 'The initial email' : `${sequenceRows.find((sequence) => sequence.id === step.sequence_id)?.name ?? 'A sequence'}, step ${step.position}`);

  const checkStep = (step: (typeof allSteps)[number], replySubject: string | null): string[] => {
    const problems: string[] = [];
    const variants = allVariants.filter((variant) => variant.step_id === step.id && variant.active);
    if (variants.length === 0) return [`${describe(step)} has no active variant.`];
    for (const variant of variants) {
      if (variant.body_template.includes(PLACEHOLDER_MARK)) problems.push(`${describe(step)} (variant ${variant.label}) still has placeholder text to replace.`);
      const aiMode = step.mode === 'ai_adapt' || step.mode === 'ai_write';
      for (const recipient of recipients) {
        const templateContext = buildContext(recipient, context.sender, campaignInfo, context.workspace, context.unsubscribeUrl, vocabulary);
        const rendered = renderStep({ subjectTemplate: variant.subject_template, bodyTemplate: variant.body_template, replySubject, context: templateContext, vocabulary, campaign: campaignInfo, isFirstTouch: step.sequence_id === null, aiMode });
        const blocker = rendered.templateIssues[0]?.message ?? rendered.lint.find((finding) => finding.severity === 'blocker')?.message;
        if (blocker) {
          problems.push(`${describe(step)} (variant ${variant.label})${recipient ? ` for ${recipient.contact.email}` : ''}: ${blocker}`);
          break;
        }
      }
    }
    return problems;
  };

  const initialProblems = checkStep(initial, null);
  add('initial_email', initialProblems.length ? 'fail' : 'pass', 'Initial email', initialProblems.length ? initialProblems.slice(0, 5).join(' ') : `Renders cleanly for ${recipients[0] ? recipients.length : 'a sample'} contact(s).`);
  const followUpProblems = allSteps
    .filter((step) => step.sequence_id !== null && sequenceRows.find((sequence) => sequence.id === step.sequence_id)?.active)
    .flatMap((step) => checkStep(step, step.send_as_reply ? 'Re: preflight' : null));
  add('follow_up_emails', followUpProblems.length ? 'fail' : 'pass', 'Follow-up emails', followUpProblems.length ? followUpProblems.slice(0, 5).join(' ') : 'Every active step renders cleanly.');

  // Sequence rules.
  const issues = validateSequences(sequenceRows, goals.map((goal) => ({ id: goal.id, key: goal.key, name: goal.name, position: goal.position })));
  if (issues.length > 0) add('sequences', 'fail', 'Follow-up sequences', issues.map((issue) => issue.message).join(' '));
  else {
    const covered = new Set(sequenceRows.filter((sequence) => sequence.active).flatMap((sequence) => sequence.stages));
    const gaps = [['sent', 'Sent'], ['responded', 'Responded']].filter(([stage]) => !covered.has(stage as never)).map(([, label]) => label);
    add('sequences', gaps.length ? 'warn' : 'pass', 'Follow-up sequences', gaps.length ? `${gaps.join(' and ')} ${gaps.length > 1 ? 'have' : 'has'} no follow-ups.` : 'Every stage has its sequence, with valid waits.');
  }

  // Mailboxes and domains.
  const assigned = await db
    .select({ mailbox: mailboxes, domain: sending_domains })
    .from(campaign_mailboxes)
    .innerJoin(mailboxes, eq(mailboxes.id, campaign_mailboxes.mailbox_id))
    .innerJoin(sending_domains, eq(sending_domains.id, mailboxes.sending_domain_id))
    .where(eq(campaign_mailboxes.campaign_id, campaign.id));
  if (assigned.length === 0) add('mailboxes', 'fail', 'Mailboxes', 'Assign at least one mailbox with setCampaignMailboxes.');
  else {
    const bad = assigned.filter(({ mailbox }) => mailbox.status !== 'active' || mailbox.health_score < 60);
    add('mailboxes', bad.length ? 'fail' : 'pass', 'Mailboxes', bad.length ? bad.map(({ mailbox }) => `${mailbox.email} is ${mailbox.status !== 'active' ? mailbox.status : `at health ${mailbox.health_score}`}`).join('; ') + '.' : `${assigned.length} active mailbox(es).`);
  }
  const domains = [...new Map(assigned.map(({ domain }) => [domain.id, domain])).values()];
  const domainProblems = domains.flatMap((domain) => {
    const checks = domain.check_details as { ready?: boolean };
    const problems: string[] = [];
    if (!domain.last_checked_at) problems.push(`${domain.domain}: run checkDomainDns.`);
    else if (!checks.ready) problems.push(`${domain.domain}: SPF, DKIM, DMARC or MX is failing.`);
    if (domain.reputation_band === 'critical' || domain.reputation_band === 'paused') problems.push(`${domain.domain}: reputation is ${domain.reputation_band}.`);
    return problems;
  });
  if (domains.length > 0) add('domains', domainProblems.length ? 'fail' : 'pass', 'Sending domains', domainProblems.length ? domainProblems.join(' ') : 'DNS authentication passes and reputation is Healthy or At risk.');

  // Compliance.
  const compliance: string[] = [];
  if (campaign.unsubscribe_footer && !context.workspace.physical_address.trim()) compliance.push('Set the workspace physical address for the footer.');
  if (!campaign.unsubscribe_footer && !campaign.list_unsubscribe_header) compliance.push('Turn on the unsubscribe footer or the List-Unsubscribe header.');
  const trackingHosts = domains.filter((domain) => !domain.tracking_host).map((domain) => domain.domain);
  add('compliance', compliance.length ? 'fail' : trackingHosts.length ? 'warn' : 'pass', 'Compliance', compliance.length ? compliance.join(' ') : trackingHosts.length ? `${trackingHosts.join(', ')} has no tracking host, so unsubscribe links use the app’s host.` : 'Unsubscribe footer and physical address are in place.');

  // Links: every URL in templates and playbooks must be one the campaign allows (§8.11, §10.9).
  const allowed = new Set(Object.values(campaign.links as Record<string, string>));
  const texts = [...allVariants.map((variant) => `${variant.subject_template ?? ''} ${variant.body_template}`), ...goals.map((goal) => goal.playbook)];
  const unknown = [...new Set(texts.flatMap((text) => [...text.matchAll(URL_PATTERN)].map(([url]) => url)))].filter((url) => !allowed.has(url));
  add('links', unknown.length ? 'fail' : 'pass', 'Links', unknown.length ? `Add these to the campaign links or remove them: ${unknown.join(', ')}.` : 'Every link in the emails and playbooks is allowed.');

  // Knowledge base size.
  const [kb] = await db
    .select({ characters: sql<number>`coalesce(sum(length(${knowledge_items.content})), 0)::int` })
    .from(knowledge_items)
    .where(and(eq(knowledge_items.workspace_id, campaign.workspace_id), eq(knowledge_items.visibility, 'shareable'), eq(knowledge_items.active, true), isNull(knowledge_items.deleted_at), or(isNull(knowledge_items.campaign_id), eq(knowledge_items.campaign_id, campaign.id))));
  const tokens = Math.round((kb?.characters ?? 0) / 4);
  add('knowledge', tokens > KB_TOKEN_WARNING ? 'warn' : 'pass', 'Knowledge base', tokens > KB_TOKEN_WARNING ? `About ${tokens.toLocaleString('en-US')} tokens; the agent works best under 150,000.` : `About ${tokens.toLocaleString('en-US')} tokens.`);

  return { passed: items.every((item) => item.status !== 'fail'), items, audience: { enrollable: enrollable.length, enrolled: enrolled.length, skipped } };
}

export async function campaignPreflight(db: Db, workspaceId: string, campaignId: string, now: Date, appHost: string | null) {
  return runPreflight(db, await findCampaign(db, workspaceId, campaignId), now, appHost);
}

