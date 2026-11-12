// Shared resources: activities (the timeline and event log, §6.9, §22.C) and custom-field
// definitions (§6.4).

import { z } from 'zod';

import { describedEnum, id, timestamp } from '../common.ts';

export const actorTypeSchema = describedEnum(
  {
    system: 'Catalyst itself, such as the scheduler or thread evaluation.',
    ai: 'The AI agent.',
    user: 'A signed-in person.',
    api_key: 'An API key, typically an agent harness.',
    contact: 'The contact, for example by replying or unsubscribing.',
    integration: 'An integration such as Stripe or Cal.com.',
  },
  { id: 'ActorType', description: 'Who caused an activity.' },
);

export const activitySchema = z
  .object({
    id: id('activity'),
    type: z.string().meta({ description: 'What happened, e.g. `thread.stage_changed` or `contact.note_added` (§22.C).', examples: ['contact.note_added'] }),
    actor_type: actorTypeSchema,
    actor_id: z.string().nullable().meta({ description: 'The user, API key or integration behind it, when there is one.' }),
    contact_id: id('contact', 'The contact it concerns.').nullable(),
    thread_id: id('thread', 'The thread it concerns.').nullable(),
    campaign_id: id('campaign', 'The campaign it concerns.').nullable(),
    data: z.record(z.string(), z.unknown()).meta({ description: 'Details, depending on the type: `{from, to}` for changes, `{text}` for notes.' }),
    occurred_at: timestamp('When it happened.'),
  })
  .meta({ id: 'Activity', description: 'One entry in a contact or thread timeline.' });
export type Activity = z.infer<typeof activitySchema>;

export const activityExample: Activity = {
  id: 'act_01jd3x5k8qf7tb9w2m4n6p8r0s',
  type: 'contact.note_added',
  actor_type: 'user',
  actor_id: 'usr_01jd3x5k8qf7tb9w2m4n6p8r0s',
  contact_id: 'ctc_01jd3x5k8qf7tb9w2m4n6p8r0s',
  thread_id: null,
  campaign_id: null,
  data: { text: 'Met Priya at SaaStr; she owns onboarding.' },
  occurred_at: '2026-11-10T18:20:00Z',
};

export const customFieldEntitySchema = describedEnum(
  { contact: 'A field on contacts.', company: 'A field on companies.' },
  { id: 'CustomFieldEntity', description: 'Which records a custom field belongs to.' },
);

export const customFieldTypeSchema = describedEnum(
  {
    text: 'Any text.',
    number: 'A number.',
    date: 'A calendar date, `YYYY-MM-DD`.',
    boolean: 'true or false.',
    select: 'One of the values listed in `options`.',
    url: 'A web address.',
  },
  { id: 'CustomFieldType', description: 'What values a custom field holds. Values are checked on every write.' },
);

export const customFieldSchema = z
  .object({
    id: id('custom_field'),
    entity: customFieldEntitySchema,
    key: z.string().meta({ description: 'The key used in `custom_fields`, in filters (`custom.<key>`) and in templates (`{{contact.custom.<key>}}`).', examples: ['industry'] }),
    label: z.string().meta({ description: 'Name shown in the UI.', examples: ['Industry'] }),
    type: customFieldTypeSchema,
    options: z.array(z.string()).nullable().meta({ description: 'The allowed values of a `select` field; null for other types.', examples: [['SaaS', 'Agency', 'E-commerce']] }),
    required: z.boolean().meta({ description: 'A new record must give a value, and the value can never be cleared.' }),
  })
  .meta({ id: 'CustomField', description: 'A typed field defined for contacts or companies.' });
export type CustomField = z.infer<typeof customFieldSchema>;

export const customFieldExample: CustomField = {
  id: 'cfd_01jd3x5k8qf7tb9w2m4n6p8r0s',
  entity: 'contact',
  key: 'industry',
  label: 'Industry',
  type: 'select',
  options: ['SaaS', 'Agency', 'E-commerce'],
  required: false,
};

const options = z.array(z.string().min(1).max(100)).min(1).max(100).meta({ description: 'The allowed values; required for a `select` field and not allowed on others.' });

export const createCustomFieldSchema = z
  .strictObject({
    entity: customFieldEntitySchema,
    key: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,59}$/, 'Lower-case letters, digits and underscores, starting with a letter')
      .meta({ description: 'The key, unique for the entity: lower-case letters, digits and underscores.', examples: ['industry'] }),
    label: z.string().min(1).max(100).meta({ description: 'Name shown in the UI.', examples: ['Industry'] }),
    type: customFieldTypeSchema,
    options: options.optional(),
    required: z.boolean().optional().meta({ description: 'Whether a value must be given. Defaults to false.' }),
  })
  .meta({ id: 'CreateCustomField' });

export const updateCustomFieldSchema = z
  .strictObject({
    label: z.string().min(1).max(100).meta({ description: 'Name shown in the UI.' }),
    options,
    required: z.boolean().meta({ description: 'Whether a value must be given.' }),
  })
  .partial()
  .meta({ id: 'UpdateCustomField', description: 'The key, entity and type of a field cannot change; create a new field instead.' });
