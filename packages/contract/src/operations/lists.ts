// Lists and segments, suppressions and custom fields (spec §13.4).

import { z } from 'zod';

import { describedEnum, id, paginated, paginationQuery } from '../common.ts';
import { defineOperation } from '../operation.ts';
import { contactExample, contactSchema } from '../schemas/contacts.ts';
import {
  contactFilterSchema,
  createListSchema,
  createSuppressionSchema,
  listExample,
  listKindSchema,
  listMembersBodySchema,
  listSchema,
  suppressionExample,
  suppressionReasonSchema,
  suppressionSchema,
  updateListSchema,
} from '../schemas/lists.ts';
import {
  createCustomFieldSchema,
  customFieldEntitySchema,
  customFieldExample,
  customFieldSchema,
  updateCustomFieldSchema,
} from '../schemas/platform.ts';

// ── Lists ──────────────────────────────────────────────────────────────────────────────────────

const listParams = z.object({ listId: id('list', 'The list to act on.') });

export const listLists = defineOperation({
  operationId: 'listLists',
  method: 'get',
  path: '/lists',
  tag: 'Lists',
  summary: 'List contact lists and segments',
  description:
    'Returns static lists and dynamic segments, by name, with their current member counts. Use listListMembers or listContacts with `list_id` for the members.',
  access: 'scoped',
  scopes: ['contacts:read'],
  query: z.object({ ...paginationQuery, kind: listKindSchema.optional().meta({ description: 'Only lists of this kind.' }) }),
  response: { status: 200, description: 'A page of lists.', schema: paginated(listSchema, 'List'), example: { data: [listExample], next_cursor: null } },
  mcp: { toolset: 'contacts' },
});

export const createList = defineOperation({
  operationId: 'createList',
  method: 'post',
  path: '/lists',
  tag: 'Lists',
  summary: 'Create a static list or a dynamic segment',
  description:
    'Creates a list. A static list holds the contacts you add (optionally `contact_ids` straight away). A dynamic list is a saved `filter` whose members are worked out each time it is read. Check a filter first with previewSegment.',
  access: 'scoped',
  scopes: ['contacts:write'],
  idempotencyKey: 'optional',
  body: { schema: createListSchema, example: { name: 'SaaS leads', kind: 'dynamic', filter: listExample.filter } },
  response: { status: 201, description: 'The list that was created.', schema: listSchema, example: listExample },
  mcp: { toolset: 'contacts' },
});

export const getList = defineOperation({
  operationId: 'getList',
  method: 'get',
  path: '/lists/{listId}',
  tag: 'Lists',
  summary: 'Get one list',
  description: 'Returns a list with its filter (for a segment) and its current member count.',
  access: 'scoped',
  scopes: ['contacts:read'],
  params: listParams,
  response: { status: 200, description: 'The list.', schema: listSchema, example: listExample },
  mcp: { toolset: 'contacts' },
});

export const updateList = defineOperation({
  operationId: 'updateList',
  method: 'patch',
  path: '/lists/{listId}',
  tag: 'Lists',
  summary: 'Rename a list or change a segment filter',
  description: 'Changes the name, or the filter of a dynamic list. Membership of a static list changes through addListMembers and removeListMembers.',
  access: 'scoped',
  scopes: ['contacts:write'],
  params: listParams,
  ifMatch: true,
  body: { schema: updateListSchema, example: { name: 'SaaS leads (US)' } },
  response: { status: 200, description: 'The list after the change.', schema: listSchema, example: listExample },
  errors: [409],
  mcp: { toolset: 'contacts' },
});

export const deleteList = defineOperation({
  operationId: 'deleteList',
  method: 'delete',
  path: '/lists/{listId}',
  tag: 'Lists',
  summary: 'Delete a list',
  description: 'Deletes the list. Its contacts are not changed, and campaigns that were enrolled from it keep their threads.',
  access: 'scoped',
  scopes: ['contacts:write'],
  params: listParams,
  response: { status: 204, description: 'The list was deleted.' },
  mcp: { toolset: 'contacts' },
});

export const listListMembers = defineOperation({
  operationId: 'listListMembers',
  method: 'get',
  path: '/lists/{listId}/members',
  tag: 'Lists',
  summary: 'List the contacts in a list',
  description: 'Returns the contacts in a static list, or the contacts a dynamic segment matches right now, newest first. Deleted contacts are never included.',
  access: 'scoped',
  scopes: ['contacts:read'],
  params: listParams,
  query: z.object(paginationQuery),
  response: { status: 200, description: 'A page of contacts.', schema: paginated(contactSchema, 'Contact'), example: { data: [contactExample], next_cursor: null } },
  mcp: { toolset: 'contacts' },
});

const memberChange = (verb: string) =>
  z
    .object({
      changed: z.int().min(0).meta({ description: `How many contacts were ${verb}.` }),
      unchanged: z.int().min(0).meta({ description: `How many were ${verb === 'added' ? 'already members' : 'not members'}.` }),
    })
    .meta({ id: `ListMembers${verb[0]!.toUpperCase()}${verb.slice(1)}`, description: `The result of a membership change.` });

export const addListMembers = defineOperation({
  operationId: 'addListMembers',
  method: 'post',
  path: '/lists/{listId}/members',
  tag: 'Lists',
  summary: 'Add contacts to a static list',
  description: 'Adds up to 1,000 contacts to a static list. Contacts already in it are counted as unchanged. A dynamic list answers `conflict`: change its filter instead.',
  access: 'scoped',
  scopes: ['contacts:write'],
  params: listParams,
  idempotencyKey: 'optional',
  body: { schema: listMembersBodySchema, example: { contact_ids: ['ctc_01jd3x5k8qf7tb9w2m4n6p8r0s'] } },
  response: { status: 200, description: 'How many were added.', schema: memberChange('added'), example: { changed: 1, unchanged: 0 } },
  errors: [409],
  mcp: { toolset: 'contacts' },
});

export const removeListMembers = defineOperation({
  operationId: 'removeListMembers',
  method: 'delete',
  path: '/lists/{listId}/members',
  tag: 'Lists',
  summary: 'Remove contacts from a static list',
  description: 'Removes the given contacts from a static list. The contacts themselves are not changed. A dynamic list answers `conflict`.',
  access: 'scoped',
  scopes: ['contacts:write'],
  params: listParams,
  query: z.object({
    contact_ids: z
      .string()
      .regex(/^ctc_[0-9a-z]{26}(,ctc_[0-9a-z]{26}){0,99}$/, 'A comma-separated list of 1 to 100 contact IDs')
      .meta({ description: 'Comma-separated contact IDs to remove, at most 100.', examples: ['ctc_01jd3x5k8qf7tb9w2m4n6p8r0s'] }),
  }),
  response: { status: 200, description: 'How many were removed.', schema: memberChange('removed'), example: { changed: 1, unchanged: 0 } },
  errors: [409],
  mcp: { toolset: 'contacts' },
});

export const previewSegment = defineOperation({
  operationId: 'previewSegment',
  method: 'post',
  path: '/lists/preview',
  tag: 'Lists',
  summary: 'Count and sample the contacts a filter matches',
  description:
    'Runs a filter without saving it and returns how many contacts match and the first 10 of them. Use it to check a filter before createList or listContacts. It changes nothing.',
  access: 'scoped',
  scopes: ['contacts:read'],
  body: { schema: z.strictObject({ filter: contactFilterSchema }).meta({ id: 'PreviewSegment' }), example: { filter: listExample.filter } },
  response: {
    status: 200,
    description: 'The count and a sample.',
    schema: z
      .object({
        count: z.int().min(0).meta({ description: 'How many contacts match.' }),
        sample: z.array(contactSchema).meta({ description: 'Up to 10 matching contacts, newest first.' }),
      })
      .meta({ id: 'SegmentPreview' }),
    example: { count: 212, sample: [contactExample] },
  },
  mcp: { toolset: 'contacts' },
});

// ── Custom fields ──────────────────────────────────────────────────────────────────────────────

const fieldParams = z.object({ fieldId: id('custom_field', 'The custom field to act on.') });

export const listCustomFields = defineOperation({
  operationId: 'listCustomFields',
  method: 'get',
  path: '/custom-fields',
  tag: 'Custom fields',
  summary: 'List custom field definitions',
  description: 'Returns the custom fields defined for contacts and companies, by entity and key. Values live in each record’s `custom_fields`.',
  access: 'scoped',
  scopes: ['settings:manage'],
  query: z.object({ ...paginationQuery, entity: customFieldEntitySchema.optional().meta({ description: 'Only fields of this entity.' }) }),
  response: { status: 200, description: 'A page of custom fields.', schema: paginated(customFieldSchema, 'CustomField'), example: { data: [customFieldExample], next_cursor: null } },
  mcp: { toolset: 'admin' },
});

export const createCustomField = defineOperation({
  operationId: 'createCustomField',
  method: 'post',
  path: '/custom-fields',
  tag: 'Custom fields',
  summary: 'Define a custom field',
  description:
    'Defines a typed field for contacts or companies. From then on, values written under its key are checked against its type. Values already stored are not checked or changed. Fails with `conflict` if the key is taken.',
  access: 'scoped',
  scopes: ['settings:manage'],
  idempotencyKey: 'optional',
  body: { schema: createCustomFieldSchema, example: { entity: 'contact', key: 'industry', label: 'Industry', type: 'select', options: ['SaaS', 'Agency', 'E-commerce'] } },
  response: { status: 201, description: 'The field that was defined.', schema: customFieldSchema, example: customFieldExample },
  errors: [409],
  mcp: { toolset: 'admin' },
});

export const updateCustomField = defineOperation({
  operationId: 'updateCustomField',
  method: 'patch',
  path: '/custom-fields/{fieldId}',
  tag: 'Custom fields',
  summary: 'Change a custom field’s label, options or required flag',
  description: 'Changes the label, the options of a `select` field, or whether it is required. Values already stored are not changed. The key, entity and type are fixed.',
  access: 'scoped',
  scopes: ['settings:manage'],
  params: fieldParams,
  body: { schema: updateCustomFieldSchema, example: { label: 'Vertical' } },
  response: { status: 200, description: 'The field after the change.', schema: customFieldSchema, example: customFieldExample },
  mcp: { toolset: 'admin' },
});

export const deleteCustomField = defineOperation({
  operationId: 'deleteCustomField',
  method: 'delete',
  path: '/custom-fields/{fieldId}',
  tag: 'Custom fields',
  summary: 'Delete a custom field definition',
  description: 'Deletes the definition. Values already stored under its key stay on the records, unchecked, and remain usable in filters and templates.',
  access: 'scoped',
  scopes: ['settings:manage'],
  params: fieldParams,
  response: { status: 204, description: 'The field was deleted.' },
  mcp: { toolset: 'admin' },
});

// ── Suppressions ───────────────────────────────────────────────────────────────────────────────

export const listSuppressions = defineOperation({
  operationId: 'listSuppressions',
  method: 'get',
  path: '/suppressions',
  tag: 'Suppressions',
  summary: 'List suppressed addresses and domains',
  description: 'Returns the suppression list, newest first. Suppressed addresses and domains are never emailed by any campaign or send path. Use checkSuppression to test one address.',
  access: 'scoped',
  scopes: ['contacts:read'],
  query: z.object({
    ...paginationQuery,
    reason: suppressionReasonSchema.optional().meta({ description: 'Only suppressions with this reason.' }),
    q: z.string().optional().meta({ description: 'Text matched against the address or domain.', examples: ['globex'] }),
  }),
  response: { status: 200, description: 'A page of suppressions.', schema: paginated(suppressionSchema, 'Suppression'), example: { data: [suppressionExample], next_cursor: null } },
  mcp: { toolset: 'contacts' },
});

export const createSuppression = defineOperation({
  operationId: 'createSuppression',
  method: 'post',
  path: '/suppressions',
  tag: 'Suppressions',
  summary: 'Suppress an address or a domain',
  description:
    'Adds an address or a whole domain to the suppression list. It takes effect at once: threads with a matching contact stop, and nothing is sent to it again. The contact’s subscription status is not changed. Fails with `conflict` if it is already suppressed.',
  access: 'scoped',
  scopes: ['contacts:write'],
  idempotencyKey: 'optional',
  body: { schema: createSuppressionSchema, example: { email: 'priya@globex.com', note: 'Existing customer; handled by account management.' } },
  response: { status: 201, description: 'The suppression that was added.', schema: suppressionSchema, example: suppressionExample },
  errors: [409],
  mcp: { toolset: 'contacts' },
});

export const deleteSuppression = defineOperation({
  operationId: 'deleteSuppression',
  method: 'delete',
  path: '/suppressions/{suppressionId}',
  tag: 'Suppressions',
  summary: 'Remove a suppression',
  description:
    'Removes an entry from the suppression list and writes it to the audit log. It does not resubscribe a contact who unsubscribed or clear a hard bounce: those stay on the contact. Needs `settings:manage`.',
  access: 'scoped',
  scopes: ['settings:manage'],
  params: z.object({ suppressionId: id('suppression', 'The suppression to remove.') }),
  response: { status: 204, description: 'The suppression was removed.' },
  mcp: { toolset: 'admin' },
});

export const checkSuppression = defineOperation({
  operationId: 'checkSuppression',
  method: 'get',
  path: '/suppressions/check',
  tag: 'Suppressions',
  summary: 'Check whether an address may be emailed',
  description:
    'Says whether Catalyst would refuse to email this address, and why: a suppression (by address or domain), or the contact’s own status (unsubscribed, bounced, invalid, do-not-contact). It changes nothing.',
  access: 'scoped',
  scopes: ['contacts:read'],
  query: z.object({ email: z.email().meta({ description: 'The address to check.', examples: ['priya@globex.com'] }) }),
  response: {
    status: 200,
    description: 'Whether the address is blocked.',
    schema: z
      .object({
        email: z.string().meta({ description: 'The address checked, lower-cased.' }),
        blocked: z.boolean().meta({ description: 'True when Catalyst will not email this address.' }),
        reasons: z
          .array(
            describedEnum(
              {
                suppressed: 'On the suppression list, by address or domain.',
                unsubscribed: 'The contact unsubscribed or complained.',
                bounced: 'A send to the address hard-bounced.',
                invalid: 'Verification found the address undeliverable.',
                do_not_contact: 'The contact is marked do-not-contact.',
              },
              { description: 'One reason the address is blocked.' },
            ),
          )
          .meta({ description: 'Why it is blocked; empty when it is not.' }),
        suppressions: z.array(suppressionSchema).meta({ description: 'The suppressions that match.' }),
        contact_id: id('contact', 'The contact with this address, if there is one.').nullable(),
      })
      .meta({ id: 'SuppressionCheck' }),
    example: { email: 'priya@globex.com', blocked: true, reasons: ['suppressed'], suppressions: [suppressionExample], contact_id: 'ctc_01jd3x5k8qf7tb9w2m4n6p8r0s' },
  },
  mcp: { toolset: 'contacts' },
});
