// Outbound webhooks (spec §13.6): the events an endpoint can subscribe to, endpoints and deliveries.

import { z } from 'zod';

import { describedEnum, id, timestamp } from '../common.ts';

export const WEBHOOK_EVENTS = {
  'thread.stage_changed': 'A thread moved to another stage.',
  'thread.state_changed': 'A thread’s state changed (active, paused, needs_human, …).',
  'thread.goal_achieved': 'A thread reached a goal.',
  'thread.classified': 'A thread’s top intent or temperature level changed.',
  'message.sent': 'An email was sent.',
  'message.received': 'An email arrived on a thread.',
  'message.opened': 'A person opened an email for the first time.',
  'message.bounced': 'An email bounced.',
  'draft.pending_approval': 'An email is waiting for approval.',
  'escalation.created': 'An escalation was raised.',
  'escalation.resolved': 'An escalation was resolved or dismissed.',
  'contact.created': 'A contact was created.',
  'contact.unsubscribed': 'A contact unsubscribed.',
  'campaign.status_changed': 'A campaign was launched, paused, resumed, completed or archived.',
  'mailbox.health_changed': 'A mailbox’s health band changed.',
  'mailbox.poll_failed': 'A mailbox failed two scheduled polls in a row.',
  'deliverability.breaker_tripped': 'A circuit breaker paused a mailbox, a domain’s mailboxes or a campaign.',
  'domain.reputation_changed': 'A domain’s reputation band changed.',
  'domain.ramp_changed': 'A domain’s ramp moved, held, stepped back, or had its plan or cap changed.',
} as const;
export type WebhookEventType = keyof typeof WEBHOOK_EVENTS;

export const webhookEventSchema = describedEnum(WEBHOOK_EVENTS, { id: 'WebhookEventType', description: 'An event an endpoint can subscribe to (§13.6).' });

export const webhookEndpointSchema = z
  .object({
    id: id('webhook_endpoint'),
    url: z.string().meta({ description: 'Where events are POSTed: https, on a public address.' }),
    description: z.string().nullable(),
    events: z.array(webhookEventSchema).meta({ description: 'The events it receives.' }),
    active: z.boolean().meta({ description: 'Receiving events. Turned off by hand, or automatically after 3 days of failures.' }),
    consecutive_failures: z.int().min(0).meta({ description: 'Failed attempts since the last success.' }),
    disabled_at: timestamp('When it was turned off automatically.').nullable(),
    created_at: timestamp('When it was added.'),
  })
  .meta({ id: 'WebhookEndpoint', description: 'A URL that receives signed event POSTs.' });
export type WebhookEndpoint = z.infer<typeof webhookEndpointSchema>;

export const webhookEndpointExample: WebhookEndpoint = {
  id: 'whk_01jd3x5k8qf7tb9w2m4n6p8r0s',
  url: 'https://hooks.getacme.com/catalyst',
  description: 'CRM sync',
  events: ['thread.goal_achieved', 'message.received'],
  active: true,
  consecutive_failures: 0,
  disabled_at: null,
  created_at: '2026-11-10T08:00:00Z',
};

export const webhookDeliverySchema = z
  .object({
    id: id('webhook_delivery'),
    endpoint_id: id('webhook_endpoint'),
    event_id: z.string().meta({ description: 'The event’s `evt_` ID, the same for every endpoint.' }),
    event_type: z.string().meta({ description: 'The event type, or `webhook.test` for a test.' }),
    attempt: z.int().min(0).meta({ description: 'Attempts made so far.' }),
    status: describedEnum({ pending: 'Waiting for its next attempt.', delivered: 'The endpoint answered 2xx.', failed: 'Every attempt failed.', skipped: 'The endpoint was off when it came due.' }, { description: 'Where it stands.' }),
    response_status: z.int().nullable().meta({ description: 'The HTTP status of the last attempt; null when it got no answer.' }),
    response_snippet: z.string().nullable().meta({ description: 'The start of the last answer, or the error.' }),
    next_attempt_at: timestamp('When it is tried next.').nullable(),
    delivered_at: timestamp('When it was delivered.').nullable(),
    created_at: timestamp('When the event was queued for this endpoint.'),
  })
  .meta({ id: 'WebhookDelivery', description: 'One event sent to one endpoint, with its attempts.' });
export type WebhookDelivery = z.infer<typeof webhookDeliverySchema>;

export const webhookDeliveryExample: WebhookDelivery = {
  id: 'whd_01jd3x5k8qf7tb9w2m4n6p8r0s',
  endpoint_id: webhookEndpointExample.id,
  event_id: 'evt_01jd3x5k8qf7tb9w2m4n6p8r0s',
  event_type: 'thread.goal_achieved',
  attempt: 1,
  status: 'delivered',
  response_status: 200,
  response_snippet: 'ok',
  next_attempt_at: null,
  delivered_at: '2026-11-10T08:00:03Z',
  created_at: '2026-11-10T08:00:00Z',
};
