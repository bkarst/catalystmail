// Lists and segments (spec §6.4, §12.1, §12.2), and suppressions (§8.6).

import { z } from 'zod';

import { describedEnum, id, timestamp } from '../common.ts';
import { domainName } from './companies.ts';

export const contactFilterSchema = z.record(z.string(), z.unknown()).meta({
  id: 'ContactFilter',
  description:
    'A filter AST (§12.2). A condition is `{field, op, value}`; groups are `{and: [...]}`, `{or: [...]}` and `{not: ...}`, nested up to 6 deep with at most 50 conditions. ' +
    'Fields: contact columns (`email`, `first_name`, `lifecycle_stage`, `last_contacted_at`, …), `tag_id`, `list_id` and `custom.<key>`. ' +
    'Operators: eq, neq, in, not_in, contains, starts_with, ends_with, gt, gte, lt, lte, is_null, is_not_null. ' +
    'Timestamps accept ISO-8601 or a relative age such as `-30d` (30 days ago), so saved segments stay current.',
  examples: [{ and: [{ field: 'lifecycle_stage', op: 'in', value: ['lead', 'prospect'] }, { field: 'custom.industry', op: 'eq', value: 'SaaS' }] }],
});

export const listKindSchema = describedEnum(
  {
    static: 'Contacts are added and removed by hand or through the API.',
    dynamic: 'A saved filter (segment); membership is re-evaluated every time it is read.',
  },
  { id: 'ListKind', description: 'How a list decides its members.' },
);

export const listSchema = z
  .object({
    id: id('list'),
    name: z.string().meta({ description: 'List name.', examples: ['Webinar attendees'] }),
    kind: listKindSchema,
    filter: contactFilterSchema.nullable().meta({ description: 'The segment filter of a dynamic list; null for a static list.' }),
    member_count: z.int().min(0).meta({ description: 'How many (non-deleted) contacts are in the list right now.' }),
    created_by: id('user', 'The user who created the list.').nullable(),
    created_at: timestamp('When the list was created.'),
    updated_at: timestamp('When the list last changed.'),
  })
  .meta({ id: 'List', description: 'A static list of contacts, or a dynamic segment defined by a filter.' });
export type List = z.infer<typeof listSchema>;

export const listExample: List = {
  id: 'lst_01jd3x5k8qf7tb9w2m4n6p8r0s',
  name: 'SaaS leads',
  kind: 'dynamic',
  filter: { and: [{ field: 'lifecycle_stage', op: 'eq', value: 'lead' }, { field: 'custom.industry', op: 'eq', value: 'SaaS' }] },
  member_count: 212,
  created_by: 'usr_01jd3x5k8qf7tb9w2m4n6p8r0s',
  created_at: '2026-10-02T15:04:00Z',
  updated_at: '2026-10-02T15:04:00Z',
};

const contactIds = z.array(id('contact')).min(1).max(1000).meta({ description: 'Contacts to act on, at most 1,000.' });

export const createListSchema = z
  .strictObject({
    name: z.string().min(1).max(200).meta({ description: 'List name.', examples: ['Webinar attendees'] }),
    kind: listKindSchema,
    filter: contactFilterSchema.optional().meta({ description: 'Required for a dynamic list; not allowed on a static one.' }),
    contact_ids: contactIds.optional().meta({ description: 'Initial members of a static list, at most 1,000.' }),
  })
  .meta({ id: 'CreateList' });

export const updateListSchema = z
  .strictObject({
    name: z.string().min(1).max(200).meta({ description: 'List name.' }),
    filter: contactFilterSchema.meta({ description: 'A new segment filter. Dynamic lists only.' }),
  })
  .partial()
  .meta({ id: 'UpdateList', description: 'The fields to change. A list cannot change between static and dynamic.' });

export const listMembersBodySchema = z.strictObject({ contact_ids: contactIds }).meta({ id: 'ListMembers' });

export const suppressionReasonSchema = describedEnum(
  {
    unsubscribed: 'The contact unsubscribed by link, one-click, mailto or reply.',
    hard_bounce: 'A send to the address hard-bounced.',
    complaint: 'The contact reported an email as spam.',
    manual: 'Added by a person or the API.',
    do_not_contact: 'From an imported do-not-contact list.',
    erased: 'The contact was erased; only the hash of the address is kept.',
  },
  { id: 'SuppressionReason', description: 'Why an address or domain is suppressed.' },
);

export const suppressionSchema = z
  .object({
    id: id('suppression'),
    email: z.string().nullable().meta({ description: 'The suppressed address; null for a domain suppression, or after the contact was erased.', examples: ['priya@globex.com'] }),
    domain: z.string().nullable().meta({ description: 'The suppressed domain; null for an address suppression.', examples: [null] }),
    hashed_only: z.boolean().meta({ description: 'True when only the hash of the address is kept (after erasure). The block still applies.' }),
    reason: suppressionReasonSchema,
    source: z.string().meta({ description: 'Where it came from: link, one_click, reply, bounce, complaint, manual, import or api.', examples: ['api'] }),
    note: z.string().nullable().meta({ description: 'Why it was added, in words.' }),
    created_by: id('user', 'The user who added it.').nullable(),
    created_at: timestamp('When it was added.'),
  })
  .meta({ id: 'Suppression', description: 'An address or domain that must never be emailed, in any campaign or by any send path.' });
export type Suppression = z.infer<typeof suppressionSchema>;

export const suppressionExample: Suppression = {
  id: 'sup_01jd3x5k8qf7tb9w2m4n6p8r0s',
  email: 'priya@globex.com',
  domain: null,
  hashed_only: false,
  reason: 'manual',
  source: 'api',
  note: 'Existing customer; handled by account management.',
  created_by: null,
  created_at: '2026-11-10T18:20:00Z',
};

export const createSuppressionSchema = z
  .strictObject({
    email: z.email().max(320).optional().meta({ description: 'An address to suppress. Give `email` or `domain`, not both.', examples: ['priya@globex.com'] }),
    domain: domainName('A whole domain to suppress, such as a competitor or an existing customer. Give `email` or `domain`, not both.').optional(),
    reason: describedEnum(
      { manual: 'A one-off block (default).', do_not_contact: 'From a do-not-contact list.' },
      { description: 'Why. The other reasons are recorded by Catalyst itself.' },
    ).optional(),
    note: z.string().max(1000).optional().meta({ description: 'Why it was added, in words.' }),
  })
  .refine((body) => (body.email === undefined) !== (body.domain === undefined), { message: 'Give exactly one of email or domain.', path: ['email'] })
  .meta({ id: 'CreateSuppression' });
