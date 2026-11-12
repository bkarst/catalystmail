// Contact and tag operations (spec §13.4). Companies, lists, custom fields and suppressions are in
// their own files.

import { z } from 'zod';

import { describedEnum, id, paginated, paginationQuery, timestamp } from '../common.ts';
import { defineOperation } from '../operation.ts';
import {
  contactBulkActionResultSchema,
  contactBulkActionSchema,
  contactExample,
  contactExportSchema,
  contactSchema,
  createContactSchema,
  createTagSchema,
  duplicateGroupSchema,
  emailVerificationSchema,
  lifecycleStageSchema,
  mergeContactsSchema,
  subscriptionStatusSchema,
  tagSchema,
  updateContactSchema,
  upsertContactsSchema,
  upsertResultSchema,
  verificationResultSchema,
} from '../schemas/contacts.ts';
import { activityExample, activitySchema } from '../schemas/platform.ts';

const contactParams = z.object({ contactId: id('contact', 'The contact to act on.') });

const contactSort = describedEnum(
  {
    '-created_at': 'Newest first (default).',
    created_at: 'Oldest first.',
    '-updated_at': 'Most recently changed first.',
    '-last_contacted_at': 'Most recently emailed first.',
    '-last_replied_at': 'Most recent reply first.',
    email: 'By email address, A to Z.',
  },
  { description: 'Sort order. A leading `-` means descending.' },
);

export const listContacts = defineOperation({
  operationId: 'listContacts',
  method: 'get',
  path: '/contacts',
  tag: 'Contacts',
  summary: 'List and search contacts',
  description:
    'Returns contacts, newest first, one page at a time. Combine the typed filters for common cases, or pass `filter` for AND/OR conditions on any field including custom fields. Deleted contacts are never returned. Use getContact when you already have an ID.',
  access: 'scoped',
  scopes: ['contacts:read'],
  query: z.object({
    ...paginationQuery,
    q: z.string().optional().meta({ description: 'Search text matched against name, email and title.', examples: ['globex'] }),
    lifecycle_stage: lifecycleStageSchema.optional().meta({ description: 'Only contacts at this lifecycle stage.' }),
    email_verification: emailVerificationSchema.optional().meta({ description: 'Only contacts with this verification result.' }),
    subscription_status: subscriptionStatusSchema.optional().meta({ description: 'Only contacts with this subscription status.' }),
    // A parameter's description has to sit on the outermost schema, after `.optional()`.
    tag_id: id('tag').optional().meta({ description: 'Only contacts carrying this tag.' }),
    company_id: id('company').optional().meta({ description: 'Only contacts at this company.' }),
    list_id: id('list').optional().meta({ description: 'Only contacts in this list, or matching this segment.' }),
    owner_user_id: id('user').optional().meta({ description: 'Only contacts owned by this user.' }),
    updated_after: timestamp('A time in UTC.').optional().meta({ description: 'Only contacts changed after this time.' }),
    filter: z
      .string()
      .optional()
      .meta({
        description: 'URL-encoded JSON filter AST with AND/OR groups (§12.2). The same AST defines dynamic lists.',
        examples: ['{"and":[{"field":"lifecycle_stage","op":"in","value":["lead","prospect"]},{"field":"custom.industry","op":"eq","value":"SaaS"}]}'],
      }),
    sort: contactSort.optional().meta({ description: 'Sort order. A leading `-` means descending. Defaults to newest first.' }),
  }),
  response: {
    status: 200,
    description: 'A page of contacts.',
    schema: paginated(contactSchema, 'Contact'),
    example: { data: [contactExample], next_cursor: null },
  },
  mcp: { toolset: 'contacts' },
});

export const createContact = defineOperation({
  operationId: 'createContact',
  method: 'post',
  path: '/contacts',
  tag: 'Contacts',
  summary: 'Create a contact',
  description:
    'Creates one contact. The email address is trimmed, lower-cased and verified in the background; the company is linked by email domain when it is known. Fails with `conflict` if the address already exists. Creating a contact sends no email; use enrollContacts for that. For many contacts at once use upsertContacts or an import.',
  access: 'scoped',
  scopes: ['contacts:write'],
  idempotencyKey: 'optional',
  body: {
    schema: createContactSchema,
    example: { email: 'priya@globex.com', first_name: 'Priya', last_name: 'Natarajan', title: 'VP Operations', custom_fields: { industry: 'SaaS' } },
  },
  response: { status: 201, description: 'The contact that was created.', schema: contactSchema, example: contactExample },
  errors: [409],
  mcp: { toolset: 'contacts' },
});

export const getContact = defineOperation({
  operationId: 'getContact',
  method: 'get',
  path: '/contacts/{contactId}',
  tag: 'Contacts',
  summary: 'Get one contact',
  description:
    'Returns a contact by ID, with its verification and subscription status. For its email history use listContactTimeline; for its conversations use listThreads with `contact_id`.',
  access: 'scoped',
  scopes: ['contacts:read'],
  params: contactParams,
  response: { status: 200, description: 'The contact.', schema: contactSchema, example: contactExample },
  mcp: { toolset: 'contacts' },
});

export const updateContact = defineOperation({
  operationId: 'updateContact',
  method: 'patch',
  path: '/contacts/{contactId}',
  tag: 'Contacts',
  summary: 'Change fields on a contact',
  description:
    'Changes only the fields you send. Edits take effect for the next email that is composed; emails already composed are not re-rendered. Setting `do_not_contact` stops all future sending to the contact. Changing `email` re-runs verification and fails with `conflict` if the new address already exists.',
  access: 'scoped',
  scopes: ['contacts:write'],
  params: contactParams,
  ifMatch: true,
  body: { schema: updateContactSchema, example: { title: 'COO', lifecycle_stage: 'opportunity' } },
  response: { status: 200, description: 'The contact after the change.', schema: contactSchema, example: contactExample },
  errors: [409],
  mcp: { toolset: 'contacts' },
});

export const deleteContact = defineOperation({
  operationId: 'deleteContact',
  method: 'delete',
  path: '/contacts/{contactId}',
  tag: 'Contacts',
  summary: 'Delete a contact',
  description:
    "Soft-deletes the contact and stops every thread it is in. Its email address becomes free to use again, and suppressions stay in place. To remove the contact's personal data for a privacy request use eraseContact instead.",
  access: 'scoped',
  scopes: ['contacts:write'],
  params: contactParams,
  response: { status: 204, description: 'The contact was deleted.' },
  mcp: { toolset: 'contacts' },
});

export const eraseContact = defineOperation({
  operationId: 'eraseContact',
  method: 'post',
  path: '/contacts/{contactId}/erase',
  tag: 'Contacts',
  summary: 'Erase a contact’s personal data for a privacy request',
  description:
    'Permanently removes the contact’s personal data: its fields, notes, and the text of every email in its threads, which are kept as "Erased contact". Only a hash of the address stays, on the suppression list, so it is never emailed again. This cannot be undone. Use exportContactData first if the person asked for a copy.',
  access: 'scoped',
  scopes: ['contacts:erase'],
  params: contactParams,
  idempotencyKey: 'optional',
  response: { status: 204, description: 'The contact was erased.' },
  mcp: { toolset: 'contacts', destructive: true },
});

export const upsertContacts = defineOperation({
  operationId: 'upsertContacts',
  method: 'post',
  path: '/contacts/bulk-upsert',
  tag: 'Contacts',
  summary: 'Create or update up to 1,000 contacts at once',
  description:
    'Creates contacts whose email is new and, depending on `dedupe_strategy`, leaves alone, fills in or overwrites those that exist. The whole request is checked first: if any row is invalid, nothing is written and every error is reported with its row. Sends no email.',
  access: 'scoped',
  scopes: ['contacts:write'],
  idempotencyKey: 'optional',
  body: {
    schema: upsertContactsSchema,
    example: { contacts: [{ email: 'priya@globex.com', first_name: 'Priya' }, { email: 'dana@northwind.com', first_name: 'Dana' }], dedupe_strategy: 'fill_empty' },
  },
  response: {
    status: 200,
    description: 'What happened to each row.',
    schema: upsertResultSchema,
    example: {
      created: 1,
      updated: 1,
      skipped: 0,
      results: [
        { index: 0, contact_id: 'ctc_01jd3x5k8qf7tb9w2m4n6p8r0s', action: 'updated' },
        { index: 1, contact_id: 'ctc_01jd3x5k8qf7tb9w2m4n6p8r0t', action: 'created' },
      ],
    },
  },
  mcp: { toolset: 'contacts' },
});

export const applyContactBulkAction = defineOperation({
  operationId: 'applyContactBulkAction',
  method: 'post',
  path: '/contacts/bulk-actions',
  tag: 'Contacts',
  summary: 'Tag, list, assign, verify, suppress, delete or export many contacts',
  description:
    'Applies one action to contacts chosen by `contact_ids` (up to 1,000) or by a `filter` (up to 5,000 matches). Each action takes its own field: `tag_ids`, `list_id`, `owner_user_id`, `lifecycle_stage` or `note`. Contacts the action does not apply to are reported in `skipped`. `delete` stops the contacts’ threads; `suppress` blocks their addresses everywhere.',
  access: 'scoped',
  scopes: ['contacts:write'],
  idempotencyKey: 'optional',
  body: { schema: contactBulkActionSchema, example: { action: 'tag', contact_ids: ['ctc_01jd3x5k8qf7tb9w2m4n6p8r0s'], tag_ids: ['tag_01jd3x5k8qf7tb9w2m4n6p8r0s'] } },
  response: {
    status: 200,
    description: 'What the action did.',
    schema: contactBulkActionResultSchema,
    example: { action: 'tag', matched: 1, changed: 1, skipped: [], csv: null },
  },
  mcp: { toolset: 'contacts' },
});

export const listDuplicateContacts = defineOperation({
  operationId: 'listDuplicateContacts',
  method: 'get',
  path: '/contacts/duplicates',
  tag: 'Contacts',
  summary: 'Find contacts that are probably the same person',
  description:
    'Returns groups of likely duplicates: the same name at the same company, or addresses that differ only by dots or a `+tag`. Exact duplicate emails cannot exist. Merge a group with mergeContacts.',
  access: 'scoped',
  scopes: ['contacts:read'],
  query: z.object({ limit: paginationQuery.limit, cursor: paginationQuery.cursor }),
  response: {
    status: 200,
    description: 'A page of duplicate groups.',
    schema: paginated(duplicateGroupSchema, 'DuplicateGroup'),
    example: { data: [{ reason: 'same_name_and_company', contacts: [contactExample, { ...contactExample, id: 'ctc_01jd3x5k8qf7tb9w2m4n6p8r0t', email: 'p.natarajan@globex.com' }] }], next_cursor: null },
  },
  mcp: { toolset: 'contacts' },
});

export const mergeContacts = defineOperation({
  operationId: 'mergeContacts',
  method: 'post',
  path: '/contacts/{contactId}/merge',
  tag: 'Contacts',
  summary: 'Merge a duplicate contact into this one',
  description:
    'Keeps this contact and folds `merge_contact_id` into it: empty fields are filled from the duplicate (and any listed in `take_from_merged` are taken from it), tags, lists, custom fields, threads and timeline move over, and the duplicate is deleted. Fails with `conflict` if both are in the same campaign.',
  access: 'scoped',
  scopes: ['contacts:write'],
  params: contactParams,
  idempotencyKey: 'optional',
  body: { schema: mergeContactsSchema, example: { merge_contact_id: 'ctc_01jd3x5k8qf7tb9w2m4n6p8r0t', take_from_merged: ['title'] } },
  response: { status: 200, description: 'The contact after the merge.', schema: contactSchema, example: contactExample },
  errors: [409],
  mcp: { toolset: 'contacts' },
});

export const listContactTimeline = defineOperation({
  operationId: 'listContactTimeline',
  method: 'get',
  path: '/contacts/{contactId}/timeline',
  tag: 'Contacts',
  summary: 'List a contact’s timeline',
  description:
    'Returns everything that happened with the contact, newest first: emails in every campaign, opens, stage and state changes, goals, escalations, notes and field changes. Narrow it with `category`.',
  access: 'scoped',
  scopes: ['contacts:read'],
  params: contactParams,
  query: z.object({
    ...paginationQuery,
    category: describedEnum(
      {
        all: 'Everything (default).',
        emails: 'Emails sent and received, opens and clicks.',
        status: 'Stage, state, goal, escalation and follow-up changes.',
        notes: 'Notes people added.',
        changes: 'Changes to the contact record itself.',
      },
      { description: 'Which kinds of entries to return.' },
    )
      .optional()
      .meta({ description: 'Which kinds of entries to return. Defaults to all.' }),
  }),
  response: { status: 200, description: 'A page of timeline entries.', schema: paginated(activitySchema, 'Activity'), example: { data: [activityExample], next_cursor: null } },
  mcp: { toolset: 'contacts' },
});

export const addContactNote = defineOperation({
  operationId: 'addContactNote',
  method: 'post',
  path: '/contacts/{contactId}/notes',
  tag: 'Contacts',
  summary: 'Add a note to a contact’s timeline',
  description: 'Adds a dated note to the contact’s timeline. Notes are for people; the agent does not see them. For facts the agent may use, set the contact’s `notes` field.',
  access: 'scoped',
  scopes: ['contacts:write'],
  params: contactParams,
  idempotencyKey: 'optional',
  body: { schema: z.strictObject({ text: z.string().min(1).max(10_000).meta({ description: 'The note.', examples: ['Met Priya at SaaStr; she owns onboarding.'] }) }).meta({ id: 'ContactNote' }), example: { text: 'Met Priya at SaaStr; she owns onboarding.' } },
  response: { status: 201, description: 'The timeline entry that was added.', schema: activitySchema, example: activityExample },
  mcp: { toolset: 'contacts' },
});

export const verifyContactEmail = defineOperation({
  operationId: 'verifyContactEmail',
  method: 'post',
  path: '/contacts/{contactId}/verify',
  tag: 'Contacts',
  summary: 'Verify a contact’s email address now',
  description:
    'Checks the address again (syntax, typos, disposable and role accounts, and whether the domain accepts mail) and stores the result on the contact. It never sends anything to the address. A contact whose address hard-bounced stays `bounced`.',
  access: 'scoped',
  scopes: ['contacts:write'],
  params: contactParams,
  response: {
    status: 200,
    description: 'The contact with its new verification result.',
    schema: verificationResultSchema,
    example: { contact: contactExample, suggestion: null, details: ['globex.com accepts mail (MX mx.globex.com).'] },
  },
  mcp: { toolset: 'contacts' },
});

export const exportContactData = defineOperation({
  operationId: 'exportContactData',
  method: 'get',
  path: '/contacts/{contactId}/export',
  tag: 'Contacts',
  summary: 'Export everything held about a contact',
  description: 'Returns the contact with its tags, lists, threads and messages, timeline and suppressions as one JSON document, for a data-access request. It changes nothing.',
  access: 'scoped',
  scopes: ['contacts:read'],
  params: contactParams,
  response: {
    status: 200,
    description: 'The export.',
    schema: contactExportSchema,
    example: { exported_at: '2026-11-11T09:00:00Z', contact: contactExample, tags: [{ id: 'tag_01jd3x5k8qf7tb9w2m4n6p8r0s', name: 'saas' }], lists: [], threads: [], activities: [], suppressions: [] },
  },
  mcp: { toolset: 'contacts' },
});

export const listTags = defineOperation({
  operationId: 'listTags',
  method: 'get',
  path: '/tags',
  tag: 'Tags',
  summary: 'List tags',
  description: 'Returns the tags defined in the workspace, by name. Use the IDs with listContacts `tag_id` or when setting `tag_ids` on a contact.',
  access: 'scoped',
  scopes: ['contacts:read'],
  query: z.object(paginationQuery),
  response: {
    status: 200,
    description: 'A page of tags.',
    schema: paginated(tagSchema, 'Tag'),
    example: { data: [{ id: 'tag_01jd3x5k8qf7tb9w2m4n6p8r0s', name: 'saas', color: 'gray' }], next_cursor: null },
  },
  mcp: { toolset: 'contacts' },
});

export const createTag = defineOperation({
  operationId: 'createTag',
  method: 'post',
  path: '/tags',
  tag: 'Tags',
  summary: 'Create a tag',
  description: 'Creates a tag that can then be put on contacts. Tag names are unique in the workspace; a duplicate name fails with `conflict`.',
  access: 'scoped',
  scopes: ['contacts:write'],
  idempotencyKey: 'optional',
  body: { schema: createTagSchema, example: { name: 'saas' } },
  response: {
    status: 201,
    description: 'The tag that was created.',
    schema: tagSchema,
    example: { id: 'tag_01jd3x5k8qf7tb9w2m4n6p8r0s', name: 'saas', color: 'gray' },
  },
  errors: [409],
  mcp: { toolset: 'contacts' },
});

export const deleteTag = defineOperation({
  operationId: 'deleteTag',
  method: 'delete',
  path: '/tags/{tagId}',
  tag: 'Tags',
  summary: 'Delete a tag',
  description: 'Deletes the tag and removes it from every contact that carries it. The contacts themselves are not changed otherwise.',
  access: 'scoped',
  scopes: ['contacts:write'],
  params: z.object({ tagId: id('tag', 'The tag to delete.') }),
  response: { status: 204, description: 'The tag was deleted.' },
  mcp: { toolset: 'contacts' },
});
