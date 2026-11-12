// Context assembly (spec §10.3): the blocks a Claude task sees, in caching order: the static
// system block, then the campaign block (both cached), then the thread, then the task. Only this
// thread, only shareable knowledge, no email addresses beyond the sender's, no tracking data.

import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

export interface PromptBlock {
  text: string;
  /** Put a cache breakpoint after this block. */
  cache: boolean;
}

export interface AgentContext {
  sender: { name: string; email: string; company: string; title: string | null };
  campaign: {
    id: string;
    name: string;
    objective: string;
    persona: { tone?: string | null; sender_role?: string | null };
    goals: { id: string; key: string; name: string; position: number; success_criteria: string; playbook: string }[];
    currentGoalId: string | null;
    links: Record<string, string>;
    /** Shareable items only: internal ones never reach the model. */
    knowledge: { id: string; kind: string; title: string; content: string }[];
  };
  contact: { first_name: string | null; last_name: string | null; title: string | null; company: string | null; timezone: string | null; custom_fields: Record<string, unknown> };
  thread: {
    stage: string;
    summary: string | null;
    /** Oldest first; inbound text is the reply with quoted history removed. */
    messages: { direction: 'inbound' | 'outbound'; author: string; date: string; text: string }[];
  };
  /** Today, YYYY-MM-DD in the contact's timezone. */
  today: string;
}

const prompts = new Map<string, string>();
/** A versioned prompt from `packages/ai/prompts`, read once (§10.2). */
export function prompt(name: string, version = 1): string {
  const key = `${name}.v${version}`;
  if (!prompts.has(key)) prompts.set(key, readFileSync(new URL(`../prompts/${key}.md`, import.meta.url), 'utf8'));
  return prompts.get(key)!;
}

export const fill = (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (match, name: string) => values[name] ?? '');

/**
 * The canary token (§10.3, §10.9 leak check). One per campaign rather than per request, so the
 * system block stays the same across the campaign's threads and its cache holds.
 */
export const canaryFor = (campaignId: string, secret: string) => `cnry-${createHmac('sha256', secret).update(campaignId).digest('hex').slice(0, 16)}`;

/** Text that can't close the tags around it. */
const escape = (text: string) => text.replace(/</g, '‹').replace(/>/g, '›');
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
/** Addresses are left out of what the model sees, the sender's own aside (§10.3). */
const withoutEmails = (text: string, senderEmail: string) => text.replace(EMAIL, (address) => (address.toLowerCase() === senderEmail.toLowerCase() ? address : '[email]'));

function campaignBlock(context: AgentContext): string {
  const { campaign, sender } = context;
  const goals = campaign.goals
    .sort((a, b) => a.position - b.position)
    .map((goal) => `<goal id="${goal.id}" key="${goal.key}" position="${goal.position}"${goal.id === campaign.currentGoalId ? ' current="true"' : ''}>\nName: ${escape(goal.name)}\nAchieved when: ${escape(goal.success_criteria)}\nPlaybook: ${escape(goal.playbook)}\n</goal>`)
    .join('\n');
  const links = Object.entries(campaign.links)
    .map(([name, url]) => `- ${name}: ${url}`)
    .join('\n');
  const knowledge = campaign.knowledge.map((item) => `<kb id="${item.id}" kind="${item.kind}">\nTitle: ${escape(item.title)}\n${escape(item.content)}\n</kb>`).join('\n');
  return [
    `You write on behalf of ${sender.name}${sender.title ? `, ${sender.title}` : ''} at ${sender.company} (${sender.email}).`,
    `<campaign name="${escape(campaign.name)}">`,
    `Objective: ${escape(campaign.objective)}`,
    campaign.persona.tone ? `Tone: ${escape(campaign.persona.tone)}` : '',
    `<goals>\n${goals}\n</goals>`,
    `<links>\n${links || '(none)'}\n</links>`,
    `<knowledge>\n${knowledge || '(empty)'}\n</knowledge>`,
    '</campaign>',
  ]
    .filter(Boolean)
    .join('\n');
}

function threadBlock(context: AgentContext): string {
  const { contact, thread, sender } = context;
  const fields = Object.entries(contact.custom_fields)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => `${key}: ${escape(String(value))}`);
  const profile = [
    `Name: ${[contact.first_name, contact.last_name].filter(Boolean).join(' ') || '(unknown)'}`,
    contact.title ? `Title: ${escape(contact.title)}` : '',
    contact.company ? `Company: ${escape(contact.company)}` : '',
    contact.timezone ? `Timezone: ${contact.timezone}` : '',
    ...fields,
  ].filter(Boolean);
  const emails = thread.messages
    .slice(-20)
    .map((message) => `<email direction="${message.direction}" from="${message.author}" date="${message.date}">\n${escape(withoutEmails(message.text, sender.email))}\n</email>`)
    .join('\n');
  return [`<contact>\n${profile.join('\n')}\n</contact>`, `Stage: ${thread.stage}`, thread.summary ? `Summary so far: ${escape(thread.summary)}` : '', `<thread>\n${emails}\n</thread>`].filter(Boolean).join('\n');
}

/** The blocks for one task, ready for the client. */
export function assemble(context: AgentContext, task: { instruction: string; extra?: string }, canary: string): { system: PromptBlock[]; user: PromptBlock[] } {
  return {
    system: [
      { text: fill(prompt('system'), { canary }), cache: true },
      { text: campaignBlock(context), cache: true },
    ],
    user: [
      { text: threadBlock(context), cache: false },
      { text: [task.extra, task.instruction].filter(Boolean).join('\n\n'), cache: false },
    ],
  };
}
