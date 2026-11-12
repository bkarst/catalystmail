// The knowledge base (spec §10, §13.4, §15.17): facts the agent may use in replies, and testing an
// answer (testKnowledge), which needs the AI agent.

import { z } from 'zod';

import { describedEnum, id, paginated, paginationQuery, timestamp } from '../common.ts';
import { defineOperation } from '../operation.ts';

const kindSchema = describedEnum(
  { product: 'What it is and does.', pricing: 'Plans and prices.', faq: 'A common question.', objection: 'An objection and the answer to it.', policy: 'Terms, security, compliance.', case_study: 'A customer story.', link: 'A link worth sharing.', other: 'Anything else.' },
  { id: 'KnowledgeKind', description: 'What kind of fact.' },
);
const visibilitySchema = describedEnum(
  { shareable: 'The agent may quote it to prospects.', internal: 'For people only; never sent to the model.' },
  { id: 'KnowledgeVisibility', description: 'Who may see it.' },
);

export const knowledgeItemSchema = z
  .object({
    id: id('knowledge_item'),
    campaign_id: id('campaign', 'The campaign it belongs to; null for the whole workspace.').nullable(),
    kind: kindSchema,
    title: z.string(),
    content: z.string().meta({ description: 'Markdown.' }),
    visibility: visibilitySchema,
    tags: z.array(z.string()),
    source: describedEnum({ manual: 'Written by a person.', escalation: 'Learned from an answered escalation.', import: 'Imported.', api: 'Added through the API.' }, { description: 'Where it came from.' }),
    source_escalation_id: id('escalation', 'The escalation it was learned from.').nullable(),
    active: z.boolean().meta({ description: 'Used by the agent.' }),
    created_at: timestamp('When it was added.'),
    updated_at: timestamp('When it last changed.'),
  })
  .meta({ id: 'KnowledgeItem', description: 'One fact the agent may use (§10).' });
const example = {
  id: 'kbi_01jd3x5k8qf7tb9w2m4n6p8r0s',
  campaign_id: null,
  kind: 'faq' as const,
  title: 'Do you support SAML SSO and SCIM?',
  content: 'Yes. SAML SSO (Okta, Azure AD, Google) and SCIM provisioning are on every plan.',
  visibility: 'shareable' as const,
  tags: ['security'],
  source: 'manual' as const,
  source_escalation_id: null,
  active: true,
  created_at: '2026-11-10T08:00:00Z',
  updated_at: '2026-11-10T08:00:00Z',
};

const itemParams = z.object({ itemId: id('knowledge_item', 'The knowledge item.') });
const fields = {
  kind: kindSchema,
  title: z.string().trim().min(1).max(200).meta({ description: 'A short title, often the question.' }),
  content: z.string().trim().min(1).max(20_000).meta({ description: 'Markdown; for shareable items, written so the agent can quote it.' }),
  campaign_id: id('campaign', 'Only for this campaign; leave out for the whole workspace.').nullable(),
  visibility: visibilitySchema,
  tags: z.array(z.string().trim().min(1).max(50)).max(20).meta({ description: 'Free-form tags.' }),
  active: z.boolean().meta({ description: 'Used by the agent.' }),
};

export const listKnowledgeItems = defineOperation({
  operationId: 'listKnowledgeItems',
  method: 'get',
  path: '/knowledge',
  tag: 'Knowledge',
  summary: 'List knowledge items',
  description: 'The knowledge base, by kind then title. Filter by scope (`campaign_id`, or `workspace` for workspace-wide items), kind, source, active, or text in the title and content.',
  access: 'scoped',
  scopes: ['knowledge:read'],
  query: z.object({
    ...paginationQuery,
    scope: z.string().regex(/^(workspace|cmp_[0-9a-z]{26})$/).optional().meta({ description: '`workspace` for workspace-wide items, or a campaign ID for that campaign’s own.' }),
    kind: kindSchema.optional().meta({ description: 'Only this kind.' }),
    source: describedEnum({ manual: 'Written by a person.', escalation: 'Learned from escalations.', import: 'Imported.', api: 'From the API.' }, { description: 'Only this source.' }).optional().meta({ description: 'Only this source.' }),
    active: z.enum(['true', 'false']).optional().meta({ description: 'Only active (true) or inactive (false) items.', 'x-enum-descriptions': { true: 'Active.', false: 'Inactive.' } }),
    q: z.string().trim().min(1).max(200).optional().meta({ description: 'Text in the title or content.' }),
  }),
  response: { status: 200, description: 'A page of items.', schema: paginated(knowledgeItemSchema, 'KnowledgeItem'), example: { data: [example], next_cursor: null } },
  mcp: { toolset: 'knowledge' },
});

export const createKnowledgeItem = defineOperation({
  operationId: 'createKnowledgeItem',
  method: 'post',
  path: '/knowledge',
  tag: 'Knowledge',
  summary: 'Add a knowledge item',
  description: 'Adds a fact the agent may use: workspace-wide, or for one campaign. Internal items are for people only and never reach the model.',
  access: 'scoped',
  scopes: ['knowledge:write'],
  idempotencyKey: 'optional',
  body: {
    schema: z.object({ kind: fields.kind, title: fields.title, content: fields.content, campaign_id: fields.campaign_id.optional(), visibility: fields.visibility.default('shareable'), tags: fields.tags.default([]), active: fields.active.default(true) }).strict(),
    example: { kind: 'faq', title: 'Do you support SAML SSO and SCIM?', content: 'Yes. SAML SSO (Okta, Azure AD, Google) and SCIM provisioning are on every plan.', tags: ['security'] },
  },
  response: { status: 201, description: 'The item.', schema: knowledgeItemSchema, example },
  mcp: { toolset: 'knowledge' },
});

export const getKnowledgeItem = defineOperation({
  operationId: 'getKnowledgeItem',
  method: 'get',
  path: '/knowledge/{itemId}',
  tag: 'Knowledge',
  summary: 'Get one knowledge item',
  description: 'Returns a knowledge item with its scope, visibility and source.',
  access: 'scoped',
  scopes: ['knowledge:read'],
  params: itemParams,
  response: { status: 200, description: 'The item.', schema: knowledgeItemSchema, example },
  mcp: { toolset: 'knowledge' },
});

export const updateKnowledgeItem = defineOperation({
  operationId: 'updateKnowledgeItem',
  method: 'patch',
  path: '/knowledge/{itemId}',
  tag: 'Knowledge',
  summary: 'Change a knowledge item',
  description: 'Changes any field of a knowledge item. Turning `active` off keeps it but stops the agent using it.',
  access: 'scoped',
  scopes: ['knowledge:write'],
  params: itemParams,
  ifMatch: true,
  body: {
    schema: z.object({ kind: fields.kind.optional(), title: fields.title.optional(), content: fields.content.optional(), campaign_id: fields.campaign_id.optional(), visibility: fields.visibility.optional(), tags: fields.tags.optional(), active: fields.active.optional() }).strict(),
    example: { content: 'Yes. SAML SSO and SCIM provisioning come with every plan, including Starter.' },
  },
  response: { status: 200, description: 'The item.', schema: knowledgeItemSchema, example },
  errors: [404, 412],
  mcp: { toolset: 'knowledge' },
});

export const deleteKnowledgeItem = defineOperation({
  operationId: 'deleteKnowledgeItem',
  method: 'delete',
  path: '/knowledge/{itemId}',
  tag: 'Knowledge',
  summary: 'Delete a knowledge item',
  description: 'Removes a knowledge item; the agent stops using it at once. Escalations that taught it keep their link.',
  access: 'scoped',
  scopes: ['knowledge:write'],
  params: itemParams,
  response: { status: 204, description: 'Deleted.' },
  errors: [404],
  mcp: { toolset: 'knowledge' },
});

export const testKnowledge = defineOperation({
  operationId: 'testKnowledge',
  method: 'post',
  path: '/knowledge/test',
  tag: 'Knowledge',
  summary: 'Ask the agent a prospect’s question',
  description: '"Test the agent" (§15.17): asks the agent a question as a prospect might, against a campaign’s shareable knowledge (or the workspace’s). It answers with the items it cites, or says it would escalate as a knowledge gap. Nothing is stored or sent. 503 `ai_unavailable` when the agent is off or fails.',
  access: 'scoped',
  scopes: ['knowledge:read'],
  body: {
    schema: z
      .object({
        question: z.string().trim().min(3).max(2000).meta({ description: 'The question, as a prospect would write it.' }),
        campaign_id: id('campaign', 'Test against this campaign’s knowledge and links; without it, the workspace’s.').optional(),
      })
      .strict(),
    example: { question: 'Do you support SAML SSO?', campaign_id: 'cmp_01jd3x5k8qf7tb9w2m4n6p8r0s' },
  },
  response: {
    status: 200,
    description: 'The agent’s answer.',
    schema: z
      .object({
        answerable: z.boolean().meta({ description: 'The knowledge answers it; false means the agent would escalate (`knowledge_gap`).' }),
        answer: z.string().nullable().meta({ description: 'A sample answer, when it can give one.' }),
        citations: z.array(z.object({ id: id('knowledge_item'), title: z.string() })).meta({ description: 'The items the answer rests on.' }),
      })
      .meta({ id: 'KnowledgeTest' }),
    example: { answerable: true, answer: 'Yes: SAML SSO and SCIM are on every plan.', citations: [{ id: 'kbi_01jd3x5k8qf7tb9w2m4n6p8r0s', title: 'Do you support SAML SSO and SCIM?' }] },
  },
  errors: [503],
  mcp: { toolset: 'knowledge' },
});
