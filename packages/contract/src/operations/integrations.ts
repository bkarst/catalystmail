// Inbound integration events (spec §13.4, §13.7): Stripe, Cal.com, Calendly and a generic signed
// endpoint report bookings and payments, which become goal achievements on the contact's thread.

import { z } from 'zod';

import { describedEnum, id, paginated, paginationQuery, timestamp } from '../common.ts';
import { defineOperation } from '../operation.ts';

const kindSchema = describedEnum(
  { stripe: 'Stripe: checkout.session.completed, invoice.paid.', calcom: 'Cal.com: BOOKING_CREATED.', calendly: 'Calendly: invitee.created.', generic: 'Anything else, POSTed to ingestIntegrationEvent.' },
  { id: 'IntegrationKind', description: 'Where events come from.' },
);

const integrationSchema = z
  .object({
    id: id('integration'),
    kind: kindSchema,
    active: z.boolean(),
    webhook_path: z.string().meta({ description: 'The path to give the provider, under the app’s address.' }),
  })
  .meta({ id: 'Integration' });
const integrationExample = { id: 'int_01jd3x5k8qf7tb9w2m4n6p8r0s', kind: 'stripe' as const, active: true, webhook_path: '/api/v1/integrations/stripe/webhook?integration_id=int_01jd3x5k8qf7tb9w2m4n6p8r0s' };

const outcomeSchema = describedEnum(
  {
    matched: 'A goal was achieved on the contact’s thread.',
    already_achieved: 'The goal was already achieved there.',
    no_contact: 'No contact has this email.',
    no_goal: 'None of the contact’s threads is in a campaign with a goal for this event.',
    not_sent: 'The thread it fits has had nothing sent yet.',
    ignored: 'An event type Catalyst doesn’t act on.',
  },
  { id: 'IntegrationOutcome', description: 'What came of it.' },
);

const integrationEventSchema = z
  .object({
    id: id('integration_event'),
    integration_id: id('integration').nullable(),
    source: z.string().meta({ description: 'stripe, calcom, calendly, or what a generic sender says.' }),
    type: z.string().meta({ description: 'The provider’s event type, e.g. `checkout.session.completed`.' }),
    external_id: z.string().meta({ description: 'The provider’s ID; an event is stored once per source and ID.' }),
    contact_email: z.string().nullable(),
    goal_key: z.string().nullable().meta({ description: 'For generic events: the goal it reports.' }),
    value_cents: z.int().nullable(),
    outcome: outcomeSchema.nullable(),
    matched_contact_id: id('contact').nullable(),
    matched_thread_id: id('thread').nullable(),
    received_at: timestamp('When it arrived.'),
    processed_at: timestamp('When it was matched.').nullable(),
  })
  .meta({ id: 'IntegrationEvent' });
const integrationEventExample = {
  id: 'ine_01jd3x5k8qf7tb9w2m4n6p8r0s',
  integration_id: integrationExample.id,
  source: 'stripe',
  type: 'checkout.session.completed',
  external_id: 'evt_1QxYz2LkdIwHu7ix',
  contact_email: 'priya@globex.com',
  goal_key: null,
  value_cents: 49_900,
  outcome: 'matched' as const,
  matched_contact_id: 'ctc_01jd3x5k8qf7tb9w2m4n6p8r0s',
  matched_thread_id: 'thr_01jd3x5k8qf7tb9w2m4n6p8r0s',
  received_at: '2026-11-10T18:00:00Z',
  processed_at: '2026-11-10T18:00:00Z',
};

export const listIntegrations = defineOperation({
  operationId: 'listIntegrations',
  method: 'get',
  path: '/integrations',
  tag: 'Integrations',
  summary: 'List integrations',
  description: 'The workspace’s Stripe, Cal.com, Calendly and generic integrations, with the webhook path each one’s provider should call. Secrets are never returned.',
  access: 'scoped',
  scopes: ['settings:manage'],
  response: { status: 200, description: 'The integrations.', schema: z.object({ data: z.array(integrationSchema) }).meta({ id: 'IntegrationList' }), example: { data: [integrationExample] } },
  mcp: { toolset: 'admin' },
});

export const createIntegration = defineOperation({
  operationId: 'createIntegration',
  method: 'post',
  path: '/integrations',
  tag: 'Integrations',
  summary: 'Connect an integration',
  description:
    'Adds a source of goal events (§13.7). For Stripe, Cal.com and Calendly, give the signing secret the provider shows for the webhook, and point the provider at `webhook_path`. For `generic`, Catalyst makes the secret and returns it once: sign each POST to ingestIntegrationEvent with it.',
  access: 'scoped',
  scopes: ['settings:manage'],
  idempotencyKey: 'optional',
  body: {
    schema: z.object({ kind: kindSchema, signing_secret: z.string().min(8).max(500).optional().meta({ description: 'The provider’s webhook signing secret; required except for `generic`.' }) }).strict(),
    example: { kind: 'stripe', signing_secret: 'whsec_test_51Hx…' },
  },
  response: {
    status: 201,
    description: 'The integration; `secret` only for `generic`.',
    schema: integrationSchema.extend({ secret: z.string().nullable().meta({ description: 'For `generic`: the signing secret, shown only now.' }) }).meta({ id: 'IntegrationCreated' }),
    example: { ...integrationExample, secret: null },
  },
  mcp: { toolset: 'admin' },
});

export const deleteIntegration = defineOperation({
  operationId: 'deleteIntegration',
  method: 'delete',
  path: '/integrations/{integrationId}',
  tag: 'Integrations',
  summary: 'Disconnect an integration',
  description: 'Turns the integration off: its events are refused from now on. Events already received are kept.',
  access: 'scoped',
  scopes: ['settings:manage'],
  params: z.object({ integrationId: id('integration', 'The integration.') }),
  response: { status: 204, description: 'Disconnected.' },
  errors: [404],
  mcp: { toolset: 'admin', destructive: true },
});

export const listIntegrationEvents = defineOperation({
  operationId: 'listIntegrationEvents',
  method: 'get',
  path: '/integration-events',
  tag: 'Integrations',
  summary: 'List received integration events',
  description: 'Every booking and payment event received, newest first, with what came of it. Filter by `outcome` to find the unmatched ones and attach them with attachIntegrationEvent.',
  access: 'scoped',
  scopes: ['settings:manage'],
  query: z.object({ ...paginationQuery, outcome: outcomeSchema.optional().meta({ description: 'Only this outcome.' }) }),
  response: { status: 200, description: 'A page of events.', schema: paginated(integrationEventSchema, 'IntegrationEvent'), example: { data: [integrationEventExample], next_cursor: null } },
  mcp: { toolset: 'admin' },
});

export const attachIntegrationEvent = defineOperation({
  operationId: 'attachIntegrationEvent',
  method: 'post',
  path: '/integration-events/{eventId}/attach',
  tag: 'Integrations',
  summary: 'Achieve a goal from an unmatched integration event',
  description: 'Files an event that matched no thread under a thread and goal by hand, and writes the achievement as if it had matched (`external_event`, confidence 1).',
  access: 'scoped',
  scopes: ['settings:manage', 'threads:write'],
  params: z.object({ eventId: id('integration_event', 'The event.') }),
  body: { schema: z.object({ thread_id: id('thread', 'The thread.'), goal_id: id('goal', 'The goal it achieves.') }).strict(), example: { thread_id: 'thr_01jd3x5k8qf7tb9w2m4n6p8r0s', goal_id: 'gol_01jd3x5k8qf7tb9w2m4n6p8r0s' } },
  response: { status: 200, description: 'The event.', schema: integrationEventSchema, example: integrationEventExample },
  errors: [404, 409],
  mcp: { toolset: 'admin' },
});

const received = { status: 202 as const, description: 'Received.', schema: z.object({ id: id('integration_event'), outcome: outcomeSchema.nullable(), duplicate: z.boolean().meta({ description: 'Seen before; nothing was done again.' }) }).meta({ id: 'IntegrationEventReceived' }), example: { id: integrationEventExample.id, outcome: 'matched' as const, duplicate: false } };
const signedBy = (header: string) => `Authenticated by its signature, not an API key: \`${header}\`, checked against the integration's signing secret.`;

export const ingestIntegrationEvent = defineOperation({
  operationId: 'ingestIntegrationEvent',
  method: 'post',
  path: '/integrations/events',
  tag: 'Integrations',
  summary: 'Report a goal event from your own system',
  description: `For anything without a built-in integration: report that a contact reached a goal (\`goal_key\`, e.g. \`paid\`). ${signedBy('Catalyst-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, t + "." + body)>')} Send the integration's ID in \`Catalyst-Integration\`. Events are stored once per \`(source, external_id)\`; older than 5 minutes is refused.`,
  access: 'public',
  scopes: [],
  body: {
    schema: z
      .object({
        source: z.string().min(1).max(50).meta({ description: 'Your system’s name.', examples: ['billing'] }),
        type: z.string().min(1).max(100).meta({ description: 'What happened.', examples: ['subscription.started'] }),
        external_id: z.string().min(1).max(200).meta({ description: 'Your ID for the event, for deduplication.' }),
        contact_email: z.email().meta({ description: 'Who it is about.' }),
        goal_key: z.string().min(1).max(100).optional().meta({ description: 'The campaign goal’s key, e.g. `paid`.' }),
        value_cents: z.int().min(0).optional().meta({ description: 'Its value, in cents.' }),
        occurred_at: z.iso.datetime().meta({ description: 'When it happened (a meeting’s start, a payment’s time).' }),
      })
      .strict(),
    example: { source: 'billing', type: 'subscription.started', external_id: 'sub_123', contact_email: 'priya@globex.com', goal_key: 'paid', value_cents: 49_900, occurred_at: '2026-11-10T18:00:00Z' },
  },
  response: received,
  errors: [404],
  mcp: false,
});

const providerHook = <const Kind extends 'stripe' | 'calcom' | 'calendly', const Id extends string>(kind: Kind, operationId: Id, label: string, header: string, events: string) =>
  defineOperation({
    operationId,
    method: 'post',
    path: `/integrations/${kind}/webhook` as `/integrations/${Kind}/webhook`,
    tag: 'Integrations',
    summary: `Receive ${label} webhooks`,
    description: `The URL to give ${label} (§13.7), with \`?integration_id=\`. Acts on ${events}; other events are stored and ignored. ${signedBy(header)} The body is ${label}'s own event JSON.`,
    access: 'public',
    scopes: [],
    query: z.object({ integration_id: id('integration', `The ${label} integration.`) }),
    response: received,
    errors: [404],
    mcp: false,
  });

export const receiveStripeWebhook = providerHook('stripe', 'receiveStripeWebhook', 'Stripe', 'Stripe-Signature', '`checkout.session.completed` and `invoice.paid`');
export const receiveCalcomWebhook = providerHook('calcom', 'receiveCalcomWebhook', 'Cal.com', 'X-Cal-Signature-256', '`BOOKING_CREATED`');
export const receiveCalendlyWebhook = providerHook('calendly', 'receiveCalendlyWebhook', 'Calendly', 'Calendly-Webhook-Signature', '`invitee.created`');
