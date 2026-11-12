// Rendering a campaign step for one recipient (spec §7.2 step 4, §8.7, §8.8, §22.A): the template
// context, the body with signature and compliance footer, and the lint result. Preview and
// preflight use it now; the composer will use it to build the message it sends.

import {
  checkTemplate,
  lintMessage,
  renderTemplate,
  sampleContext,
  type LintFinding,
  type TemplateContext,
  type TemplateIssue,
  type TemplateVocabulary,
} from '@catalyst/email';

export interface RecipientData {
  contact: {
    email: string;
    first_name: string | null;
    last_name: string | null;
    title: string | null;
    city: string | null;
    country: string | null;
    custom_fields: unknown;
  };
  company: { name: string; domain: string | null; custom_fields: unknown } | null;
}

export interface SenderData {
  display_name: string;
  signature_text: string | null;
}

export interface CampaignData {
  name: string;
  links: Record<string, string>;
  persona: { sender_role?: string | null };
  unsubscribe_footer: boolean;
  list_unsubscribe_header: boolean;
}

export interface WorkspaceData {
  name: string;
  physical_address: string;
}

/** The compliance footer (§8.8): one plain line in the signature area. */
export const COMPLIANCE_FOOTER = "If you'd rather not hear from me, just reply 'no thanks' or click here: {{ unsubscribe_url }} · {{ workspace.physical_address }}";

export function buildContext(recipient: RecipientData | null, sender: SenderData | null, campaign: CampaignData, workspace: WorkspaceData, unsubscribeUrl: string, vocabulary: TemplateVocabulary): TemplateContext {
  const sample = sampleContext(vocabulary);
  const contact = recipient?.contact;
  const name = [contact?.first_name, contact?.last_name].filter(Boolean).join(' ');
  return {
    contact: contact
      ? {
          first_name: contact.first_name,
          last_name: contact.last_name,
          full_name: name || null,
          title: contact.title,
          email: contact.email,
          city: contact.city,
          country: contact.country,
          custom: { ...Object.fromEntries(vocabulary.contactCustom.map((key) => [key, null])), ...(contact.custom_fields as Record<string, unknown>) },
        }
      : sample.contact,
    company: recipient
      ? {
          name: recipient.company?.name ?? null,
          domain: recipient.company?.domain ?? null,
          custom: { ...Object.fromEntries(vocabulary.companyCustom.map((key) => [key, null])), ...((recipient.company?.custom_fields as Record<string, unknown>) ?? {}) },
        }
      : sample.company,
    sender: sender
      ? { first_name: sender.display_name.split(/\s+/)[0] ?? null, full_name: sender.display_name, title: campaign.persona.sender_role ?? null, signature: sender.signature_text }
      : sample.sender,
    campaign: { name: campaign.name, links: campaign.links },
    ai: { opening_line: null },
    unsubscribe_url: unsubscribeUrl,
    workspace,
  };
}

export interface RenderedStep {
  subject: string | null;
  bodyText: string | null;
  templateIssues: TemplateIssue[];
  lint: LintFinding[];
  sendable: boolean;
}

const URL_PATTERN = /https?:\/\/[^\s<>()"']+[^\s<>()"'.,;:!?]/g;

/**
 * Renders a step's subject and body for one recipient, appends the signature and footer, and
 * lints the result. AI modes are rendered as written: their text is a brief until the AI runs.
 */
export function renderStep(input: {
  subjectTemplate: string | null;
  bodyTemplate: string;
  /** Follow-ups sent as replies use "Re: " plus the thread's subject instead of their own. */
  replySubject: string | null;
  context: TemplateContext;
  vocabulary: TemplateVocabulary;
  campaign: CampaignData;
  isFirstTouch: boolean;
  aiMode: boolean;
  aiDisclosure?: boolean;
}): RenderedStep {
  const issues: TemplateIssue[] = [];
  let subject: string | null = input.replySubject;
  if (input.replySubject === null) {
    if (!input.subjectTemplate) issues.push({ code: 'syntax', message: 'This email needs a subject.' });
    else {
      const rendered = renderTemplate(input.subjectTemplate, input.context, input.vocabulary);
      issues.push(...rendered.issues);
      subject = rendered.output?.trim() ?? null;
    }
  }
  const body = input.aiMode ? { output: input.bodyTemplate, issues: checkTemplate(input.bodyTemplate, input.vocabulary) } : renderTemplate(input.bodyTemplate, input.context, input.vocabulary);
  issues.push(...body.issues);
  if (issues.length > 0 || body.output === null || subject === null) return { subject, bodyText: null, templateIssues: issues, lint: [], sendable: false };

  const bodyText = finishBody(body.output, input.context, input.vocabulary, input.campaign, { aiDisclosure: input.aiDisclosure ?? false });
  const lint = lintBody({ subject, bodyText, isFirstTouch: input.isFirstTouch, campaign: input.campaign, physicalAddress: input.context.workspace.physical_address });
  return { subject, bodyText, templateIssues: [], lint, sendable: !lint.some((finding) => finding.severity === 'blocker') };
}

/** The body as sent: the text, then the signature, then the compliance footer when the campaign uses one (§8.8). */
/** §10.9 AI disclosure (`signature_line`): under the signature of every email the agent wrote, all or part of. */
export const AI_DISCLOSURE_LINE = 'Written with help from an AI assistant.';

export function finishBody(text: string, context: TemplateContext, vocabulary: TemplateVocabulary, campaign: Pick<CampaignData, 'unsubscribe_footer'>, options: { aiDisclosure?: boolean } = {}): string {
  const parts = [text.trimEnd()];
  if (context.sender.signature) parts.push(context.sender.signature);
  if (options.aiDisclosure) parts.push(AI_DISCLOSURE_LINE);
  if (campaign.unsubscribe_footer) parts.push(renderTemplate(COMPLIANCE_FOOTER, context, vocabulary).output ?? '');
  return parts.join('\n\n');
}

/** Lints a finished body (§8.7). A link to `/u/…` counts as the unsubscribe mechanism. */
export function lintBody(input: { subject: string; bodyText: string; isFirstTouch: boolean; campaign: Pick<CampaignData, 'unsubscribe_footer' | 'list_unsubscribe_header'>; physicalAddress: string }): LintFinding[] {
  const links = [...input.bodyText.matchAll(URL_PATTERN)].map(([url]) => ({ text: url, href: url, isUnsubscribe: /\/u\/[A-Za-z0-9_-]+$/.test(url) }));
  return lintMessage({
    subject: input.subject,
    text: input.bodyText,
    html: null,
    links,
    imageCount: 0,
    attachmentCount: 0,
    isFirstTouch: input.isFirstTouch,
    complianceRequired: input.campaign.unsubscribe_footer,
    hasUnsubscribeMechanism: input.campaign.list_unsubscribe_header || links.some((link) => link.isUnsubscribe),
    physicalAddress: input.physicalAddress,
  });
}
