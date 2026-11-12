// Outbound webhooks (spec §13.4, §13.6): endpoints, a test ping, the delivery log and redelivery.

import { z } from 'zod';

import { id, paginated, paginationQuery } from '../common.ts';
import { defineOperation } from '../operation.ts';
import { webhookDeliveryExample, webhookDeliverySchema, webhookEndpointExample, webhookEndpointSchema, webhookEventSchema } from '../schemas/webhooks.ts';

const endpointParams = z.object({ endpointId: id('webhook_endpoint', 'The endpoint.') });
const url = z.url({ protocol: /^https$/ }).max(2000).meta({ description: 'An https URL on a public address; private and local addresses are refused (§13.6).', examples: ['https://hooks.getacme.com/catalyst'] });
const events = z.array(webhookEventSchema).min(1).max(50).meta({ description: 'The events to receive.' });

export const listWebhookEndpoints = defineOperation({
  operationId: 'listWebhookEndpoints',
  method: 'get',
  path: '/webhooks',
  tag: 'Webhooks',
  summary: 'List webhook endpoints',
  description: 'Returns the workspace’s webhook endpoints, oldest first. Secrets are never returned after creation.',
  access: 'scoped',
  scopes: ['webhooks:manage'],
  query: z.object(paginationQuery),
  response: { status: 200, description: 'A page of endpoints.', schema: paginated(webhookEndpointSchema, 'WebhookEndpoint'), example: { data: [webhookEndpointExample], next_cursor: null } },
  mcp: { toolset: 'admin' },
});

export const createWebhookEndpoint = defineOperation({
  operationId: 'createWebhookEndpoint',
  method: 'post',
  path: '/webhooks',
  tag: 'Webhooks',
  summary: 'Add a webhook endpoint',
  description:
    'Registers a URL to receive the chosen events as signed POSTs (§13.6): the envelope `{id, type, created_at, workspace_id, data}`, signed in `Catalyst-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, t + "." + body)>`. The signing `secret` is in this response only; keep it. Events from before the endpoint existed are not sent.',
  access: 'scoped',
  scopes: ['webhooks:manage'],
  idempotencyKey: 'optional',
  body: { schema: z.object({ url, description: z.string().trim().max(200).optional().meta({ description: 'What it is for.' }), events }).strict(), example: { url: 'https://hooks.getacme.com/catalyst', description: 'CRM sync', events: ['thread.goal_achieved', 'message.received'] } },
  response: {
    status: 201,
    description: 'The endpoint, with its secret.',
    schema: webhookEndpointSchema.extend({ secret: z.string().meta({ description: 'The signing secret, shown only now.' }) }).meta({ id: 'WebhookEndpointCreated' }),
    example: { ...webhookEndpointExample, secret: 'whsec_6Jb1XbV0mC2nQ8uE4yT7pL3aR9sK5dF1' },
  },
  mcp: { toolset: 'admin' },
});

export const updateWebhookEndpoint = defineOperation({
  operationId: 'updateWebhookEndpoint',
  method: 'patch',
  path: '/webhooks/{endpointId}',
  tag: 'Webhooks',
  summary: 'Change a webhook endpoint',
  description: 'Changes the URL, description or events, or turns the endpoint off or on. Turning it back on clears its failure count; deliveries that failed meanwhile can be sent again with redeliverWebhook.',
  access: 'scoped',
  scopes: ['webhooks:manage'],
  params: endpointParams,
  body: {
    schema: z.object({ url: url.optional(), description: z.string().trim().max(200).nullable().optional().meta({ description: 'What it is for.' }), events: events.optional(), active: z.boolean().optional().meta({ description: 'Receiving events.' }) }).strict(),
    example: { events: ['thread.goal_achieved', 'message.received', 'escalation.created'] },
  },
  response: { status: 200, description: 'The endpoint.', schema: webhookEndpointSchema, example: webhookEndpointExample },
  errors: [404],
  mcp: { toolset: 'admin' },
});

export const deleteWebhookEndpoint = defineOperation({
  operationId: 'deleteWebhookEndpoint',
  method: 'delete',
  path: '/webhooks/{endpointId}',
  tag: 'Webhooks',
  summary: 'Delete a webhook endpoint',
  description: 'Removes the endpoint and its delivery log. Nothing more is sent to it.',
  access: 'scoped',
  scopes: ['webhooks:manage'],
  params: endpointParams,
  response: { status: 204, description: 'Deleted.' },
  errors: [404],
  mcp: { toolset: 'admin' },
});

export const testWebhookEndpoint = defineOperation({
  operationId: 'testWebhookEndpoint',
  method: 'post',
  path: '/webhooks/{endpointId}/test',
  tag: 'Webhooks',
  summary: 'Send a test event to a webhook endpoint',
  description: 'POSTs a signed `webhook.test` event to the endpoint now and returns the delivery with the answer. It is not retried.',
  access: 'scoped',
  scopes: ['webhooks:manage'],
  params: endpointParams,
  response: { status: 200, description: 'The test delivery.', schema: webhookDeliverySchema, example: { ...webhookDeliveryExample, event_type: 'webhook.test' } },
  errors: [404],
  mcp: { toolset: 'admin', openWorld: true },
});

export const listWebhookDeliveries = defineOperation({
  operationId: 'listWebhookDeliveries',
  method: 'get',
  path: '/webhooks/{endpointId}/deliveries',
  tag: 'Webhooks',
  summary: 'List an endpoint’s deliveries',
  description: 'The delivery log of one endpoint, newest first, with each one’s attempts and last answer.',
  access: 'scoped',
  scopes: ['webhooks:manage'],
  params: endpointParams,
  query: z.object({ ...paginationQuery, status: webhookDeliverySchema.shape.status.optional().meta({ description: 'Only this status.' }) }),
  response: { status: 200, description: 'A page of deliveries.', schema: paginated(webhookDeliverySchema, 'WebhookDelivery'), example: { data: [webhookDeliveryExample], next_cursor: null } },
  errors: [404],
  mcp: { toolset: 'admin' },
});

export const redeliverWebhook = defineOperation({
  operationId: 'redeliverWebhook',
  method: 'post',
  path: '/webhook-deliveries/{deliveryId}/redeliver',
  tag: 'Webhooks',
  summary: 'Send a delivery again',
  description: 'Queues another attempt of a delivery now, whatever its status, with a fresh signature. The endpoint must be on.',
  access: 'scoped',
  scopes: ['webhooks:manage'],
  params: z.object({ deliveryId: id('webhook_delivery', 'The delivery.') }),
  response: { status: 202, description: 'Queued.', schema: webhookDeliverySchema, example: { ...webhookDeliveryExample, status: 'pending', next_attempt_at: '2026-11-10T09:00:00Z' } },
  errors: [404, 409],
  mcp: { toolset: 'admin', openWorld: true },
});
