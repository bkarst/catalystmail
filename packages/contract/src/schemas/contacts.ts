// Contact and tag resources (spec §6.4, §12).

import { z } from 'zod';

import { describedEnum, id, timestamp } from '../common.ts';

export const lifecycleStageSchema = describedEnum(
  {
    lead: 'Known, not yet contacted.',
    prospect: 'Enrolled in a campaign.',
    engaged: 'Has replied at least once.',
    opportunity: 'Reached a goal that marks real buying intent, such as a booked call.',
    customer: 'Reached a final goal that marks a customer, such as a payment.',
    churned: 'Was a customer and no longer is.',
    disqualified: 'Not a fit; set by a person.',
  },
  { id: 'LifecycleStage', description: 'Where the contact stands in the sales lifecycle. Automatic moves never go backwards.' },
);

export const emailVerificationSchema = describedEnum(
  {
    unverified: 'Not checked yet.',
    valid: 'Passed syntax and mail-server checks.',
    risky: 'Deliverable but risky, such as a role account (`info@`). Skipped at enrollment unless allowed.',
    catch_all: 'The domain accepts every address, so this one cannot be confirmed.',
    invalid: 'Failed verification. Never emailed.',
    bounced: 'A real send hard-bounced. Never emailed again.',
  },
  { id: 'EmailVerification', description: 'Result of verifying the email address (§8.5).' },
);

export const subscriptionStatusSchema = describedEnum(
  {
    subscribed: 'May be emailed.',
    unsubscribed: 'Opted out. No further email of any kind.',
    complained: 'Reported an email as spam. No further email of any kind.',
  },
  { id: 'SubscriptionStatus', description: 'Whether the contact may be emailed. Applies to every campaign.' },
);

export const consentBasisSchema = describedEnum(
  {
    legitimate_interest: 'B2B legitimate interest.',
    consent: 'The contact gave consent.',
    existing_relationship: 'An existing business relationship.',
    unknown: 'Not recorded. Blocks enrollment where consent is required, such as Canada.',
  },
  { id: 'ConsentBasis', description: 'The legal basis for emailing this contact.' },
);

const text = (description: string, example?: string) =>
  z.string().meta(example === undefined ? { description } : { description, examples: [example] });

export const tagSchema = z
  .object({
    id: id('tag'),
    name: text('Tag name, unique in the workspace.', 'saas'),
    color: text('Display color.', 'gray'),
  })
  .meta({ id: 'Tag', description: 'A label that can be put on contacts.' });

export const createTagSchema = z
  .strictObject({
    name: z.string().min(1).max(60).meta({ description: 'Tag name, unique in the workspace.', examples: ['saas'] }),
    color: z.string().max(30).optional().meta({ description: 'Display color; defaults to gray.' }),
  })
  .meta({ id: 'CreateTag' });

/** The fields a caller may set on a contact. */
const contactFields = {
  first_name: z.string().max(200).nullable().meta({ description: 'Given name.', examples: ['Priya'] }),
  last_name: z.string().max(200).nullable().meta({ description: 'Family name.', examples: ['Natarajan'] }),
  title: z.string().max(200).nullable().meta({ description: 'Job title.', examples: ['VP Operations'] }),
  phone: z.string().max(60).nullable().meta({ description: 'Phone number, free text.' }),
  linkedin_url: z.url().nullable().meta({ description: 'LinkedIn profile URL.' }),
  company_id: id('company', 'The company the contact belongs to.').nullable(),
  city: z.string().max(120).nullable().meta({ description: 'City, used to infer the timezone.' }),
  country: z.string().max(2).nullable().meta({ description: 'ISO 3166-1 alpha-2 country code.', examples: ['US'] }),
  timezone: z.string().nullable().meta({ description: 'IANA timezone. Inferred from city and country when null.', examples: ['America/Los_Angeles'] }),
  lifecycle_stage: lifecycleStageSchema,
  owner_user_id: id('user', 'The user who owns this contact.').nullable(),
  consent_basis: consentBasisSchema,
  do_not_contact: z.boolean().meta({ description: 'When true the contact is never emailed, whatever its subscription status.' }),
  custom_fields: z.record(z.string(), z.unknown()).meta({ description: 'Values of the custom fields defined for contacts, by field key.', examples: [{ industry: 'SaaS' }] }),
  notes: z.string().max(10_000).nullable().meta({ description: 'Free-text notes. The agent may use them for personalization.' }),
  tag_ids: z.array(id('tag')).meta({ description: 'Tags on the contact.' }),
};

export const contactSchema = z
  .object({
    id: id('contact'),
    email: z.email().meta({ description: 'Email address, lower-cased. Unique in the workspace.', examples: ['priya@globex.com'] }),
    ...contactFields,
    source: text('How the contact was created: manual, import, api, referral or thread_participant.', 'import'),
    source_detail: z.string().nullable().meta({ description: 'More about the source, such as the import file name.' }),
    email_verification: emailVerificationSchema,
    email_verified_at: timestamp('When the address was last verified.').nullable(),
    email_flags: z.array(z.string()).meta({ description: 'Flags from verification: role, freemail, disposable, typo_suspect.' }),
    subscription_status: subscriptionStatusSchema,
    unsubscribed_at: timestamp('When the contact unsubscribed.').nullable(),
    last_contacted_at: timestamp('When Catalyst last emailed the contact.').nullable(),
    last_replied_at: timestamp('When the contact last replied.').nullable(),
    last_opened_at: timestamp('When the contact last opened an email (human opens only).').nullable(),
    created_at: timestamp('When the contact was created.'),
    updated_at: timestamp('When the contact last changed.'),
  })
  .meta({ id: 'Contact', description: 'A person Catalyst can email. Unique per workspace by email address.' });
export type Contact = z.infer<typeof contactSchema>;

export const createContactSchema = z
  .strictObject({
    email: z.email().max(320).meta({ description: 'Email address. Trimmed and lower-cased on write.', examples: ['priya@globex.com'] }),
    ...z.object(contactFields).partial().shape,
  })
  .meta({ id: 'CreateContact', description: 'A new contact. Only `email` is required.' });

export const updateContactSchema = z
  .strictObject({
    email: z.email().max(320).meta({ description: 'A new email address. Verification runs again.' }),
    ...contactFields,
    custom_fields: z
      .record(z.string(), z.unknown())
      .meta({ description: 'Custom field values to change, by key. A null value removes the key; keys left out keep their values.', examples: [{ industry: 'SaaS', seats: null }] }),
  })
  .partial()
  .meta({ id: 'UpdateContact', description: 'The fields to change. Fields left out stay as they are.' });

export const contactExample: Contact = {
  id: 'ctc_01jd3x5k8qf7tb9w2m4n6p8r0s',
  email: 'priya@globex.com',
  first_name: 'Priya',
  last_name: 'Natarajan',
  title: 'VP Operations',
  phone: null,
  linkedin_url: null,
  company_id: 'co_01jd3x5k8qf7tb9w2m4n6p8r0s',
  city: 'San Francisco',
  country: 'US',
  timezone: 'America/Los_Angeles',
  lifecycle_stage: 'engaged',
  owner_user_id: 'usr_01jd3x5k8qf7tb9w2m4n6p8r0s',
  consent_basis: 'legitimate_interest',
  do_not_contact: false,
  custom_fields: { industry: 'SaaS' },
  notes: null,
  tag_ids: ['tag_01jd3x5k8qf7tb9w2m4n6p8r0s'],
  source: 'import',
  source_detail: 'webinar.csv',
  email_verification: 'valid',
  email_verified_at: '2026-10-02T15:04:00Z',
  email_flags: [],
  subscription_status: 'subscribed',
  unsubscribed_at: null,
  last_contacted_at: '2026-10-31T16:31:00Z',
  last_replied_at: '2026-11-10T17:52:00Z',
  last_opened_at: '2026-10-28T16:40:00Z',
  created_at: '2026-10-02T15:04:00Z',
  updated_at: '2026-11-10T17:52:00Z',
};

// ── Bulk writes, merge, verification, export ──────────────────────────────────────────────────

export const dedupeStrategySchema = describedEnum(
  {
    skip: 'Leave an existing contact exactly as it is (default).',
    fill_empty: 'Only fill fields that are empty on the existing contact.',
    overwrite: 'Overwrite the existing contact with every field given.',
  },
  { id: 'DedupeStrategy', description: 'What to do when a contact with the same email already exists.' },
);

export const upsertContactsSchema = z
  .strictObject({
    contacts: z.array(createContactSchema).min(1).max(1000).meta({ description: 'The contacts, at most 1,000. Each needs an `email`.' }),
    dedupe_strategy: dedupeStrategySchema.optional().meta({ description: 'What to do with addresses that already exist. Defaults to skip.' }),
  })
  .meta({ id: 'UpsertContacts' });

export const upsertResultSchema = z
  .object({
    created: z.int().min(0).meta({ description: 'Contacts created.' }),
    updated: z.int().min(0).meta({ description: 'Existing contacts changed.' }),
    skipped: z.int().min(0).meta({ description: 'Rows left alone: existing contacts under `skip`, unchanged ones, and repeats of an earlier row.' }),
    results: z
      .array(
        z.object({
          index: z.int().min(0).meta({ description: 'Position of the row in the request.' }),
          contact_id: id('contact', 'The contact the row created or matched.'),
          action: describedEnum(
            {
              created: 'A new contact was created.',
              updated: 'An existing contact was changed.',
              unchanged: 'An existing contact matched and nothing needed to change.',
              skipped: 'An existing contact was left alone because of the dedupe strategy.',
              duplicate_in_request: 'The same address appeared earlier in the request; that row was used.',
            },
            { description: 'What happened to this row.' },
          ),
        }),
      )
      .meta({ description: 'One entry per row, in request order.' }),
  })
  .meta({ id: 'UpsertResult' });

export const bulkActionSchema = describedEnum(
  {
    tag: 'Add the tags in `tag_ids`.',
    untag: 'Remove the tags in `tag_ids`.',
    add_to_list: 'Add to the static list `list_id`.',
    remove_from_list: 'Remove from the static list `list_id`.',
    set_owner: 'Set the owner to `owner_user_id` (null clears it).',
    set_lifecycle_stage: 'Set the lifecycle stage to `lifecycle_stage`.',
    verify: 'Verify the email addresses again now.',
    suppress: 'Add each address to the suppression list, with `note`.',
    delete: 'Soft-delete the contacts and stop their threads.',
    export: 'Return the contacts as CSV in `csv`.',
  },
  { id: 'ContactBulkAction', description: 'What to do to every selected contact.' },
);

export const contactBulkActionSchema = z
  .strictObject({
    action: bulkActionSchema,
    contact_ids: z.array(id('contact')).min(1).max(1000).optional().meta({ description: 'The contacts to act on, at most 1,000. Give this or `filter`.' }),
    filter: z.record(z.string(), z.unknown()).optional().meta({ description: 'A filter AST (§12.2) selecting the contacts, at most 5,000 of them. Give this or `contact_ids`.' }),
    tag_ids: z.array(id('tag')).min(1).max(50).optional().meta({ description: 'For `tag` and `untag`.' }),
    list_id: id('list', 'For `add_to_list` and `remove_from_list`: a static list.').optional(),
    owner_user_id: id('user', 'For `set_owner`; null clears the owner.').nullable().optional(),
    lifecycle_stage: lifecycleStageSchema.optional().meta({ description: 'For `set_lifecycle_stage`.' }),
    note: z.string().max(1000).optional().meta({ description: 'For `suppress`: why, in words.' }),
  })
  .meta({ id: 'ContactBulkActionRequest', description: 'A bulk action and the contacts it applies to.' });

export const contactBulkActionResultSchema = z
  .object({
    action: bulkActionSchema,
    matched: z.int().min(0).meta({ description: 'How many contacts were selected.' }),
    changed: z.int().min(0).meta({ description: 'How many were actually changed (or exported).' }),
    skipped: z
      .array(z.object({ contact_id: z.string().meta({ description: 'The contact.' }), reason: z.string().meta({ description: 'Why it was skipped.' }) }))
      .meta({ description: 'Selected contacts that were left alone, and why.' }),
    csv: z.string().nullable().meta({ description: 'For `export`: the contacts as CSV with a header row; null otherwise.' }),
  })
  .meta({ id: 'ContactBulkActionResult' });

export const MERGEABLE_FIELDS = [
  'first_name', 'last_name', 'title', 'phone', 'linkedin_url', 'company_id', 'city', 'country', 'timezone', 'owner_user_id', 'notes',
] as const;

export const mergeContactsSchema = z
  .strictObject({
    merge_contact_id: id('contact', 'The duplicate to merge into this contact. It is deleted afterwards.'),
    take_from_merged: z
      .array(z.enum(MERGEABLE_FIELDS).meta({ description: 'A contact field.', 'x-enum-descriptions': Object.fromEntries(MERGEABLE_FIELDS.map((field) => [field, `The \`${field}\` field.`])) }))
      .optional()
      .meta({ description: 'Fields whose value should come from the merged contact even where this contact has one. Empty fields are always filled from it.' }),
  })
  .meta({ id: 'MergeContacts' });

export const verificationResultSchema = z
  .object({
    contact: contactSchema,
    suggestion: z.string().nullable().meta({ description: 'A likely intended address when the domain looks mistyped.', examples: ['priya@gmail.com'] }),
    details: z.array(z.string()).meta({ description: 'What each check found, in words.' }),
  })
  .meta({ id: 'VerificationResult' });

export const duplicateGroupSchema = z
  .object({
    reason: describedEnum(
      {
        same_name_and_company: 'Same first and last name at the same company (or the same email domain).',
        similar_email: 'The same address apart from dots or a `+tag` in the local part.',
      },
      { description: 'Why these contacts look like the same person.' },
    ),
    contacts: z.array(contactSchema).meta({ description: 'The contacts in the group, oldest first.' }),
  })
  .meta({ id: 'DuplicateGroup' });

export const contactExportSchema = z
  .object({
    exported_at: z.iso.datetime().meta({ description: 'When the export was made.' }),
    contact: contactSchema,
    tags: z.array(z.object({ id: z.string(), name: z.string() })).meta({ description: 'Tags on the contact.' }),
    lists: z.array(z.object({ id: z.string(), name: z.string() })).meta({ description: 'Static lists the contact is in.' }),
    threads: z
      .array(z.record(z.string(), z.unknown()))
      .meta({ description: 'Every conversation with the contact, with its messages.' }),
    activities: z.array(z.record(z.string(), z.unknown())).meta({ description: 'The contact’s full timeline.' }),
    suppressions: z.array(z.record(z.string(), z.unknown())).meta({ description: 'Suppressions that apply to the contact’s address or domain.' }),
  })
  .meta({ id: 'ContactExport', description: 'Everything Catalyst holds about one contact, for a data-access request.' });
