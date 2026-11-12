// Browser push (spec §11.2): a signed-in person's browsers subscribe to urgent and high alerts.
// Session only, and not MCP tools: a subscription belongs to a person's browser, not to an agent.

import { z } from 'zod';

import { id, timestamp } from '../common.ts';
import { defineOperation } from '../operation.ts';

const subscriptionSchema = z
  .object({
    id: id('push_subscription'),
    endpoint_host: z.string().meta({ description: 'The browser’s push service, e.g. fcm.googleapis.com.', examples: ['fcm.googleapis.com'] }),
    user_agent: z.string().nullable().meta({ description: 'The browser that subscribed.' }),
    created_at: timestamp('When it subscribed.'),
    last_sent_at: timestamp('When an alert last reached it.').nullable(),
  })
  .meta({ id: 'PushSubscription', description: 'A browser that shows alerts. Its keys are never returned.' });
const example = { id: 'psb_01jd3x5k8qf7tb9w2m4n6p8r0s', endpoint_host: 'fcm.googleapis.com', user_agent: 'Mozilla/5.0 (Macintosh)', created_at: '2026-11-10T09:00:00Z', last_sent_at: null };

export const getPushSettings = defineOperation({
  operationId: 'getPushSettings',
  method: 'get',
  path: '/me/push',
  tag: 'Settings',
  summary: 'Browser push: the server’s key and your subscribed browsers',
  description: 'The VAPID public key a browser subscribes with (`applicationServerKey`), null when push isn’t set up on this server, and the browsers that get your urgent and high alerts (§11.2).',
  access: 'session',
  scopes: [],
  response: { status: 200, description: 'Push settings.', schema: z.object({ vapid_public_key: z.string().nullable().meta({ description: 'Base64url, for `pushManager.subscribe`.' }), subscriptions: z.array(subscriptionSchema) }).meta({ id: 'PushSettings' }), example: { vapid_public_key: 'BNc…', subscriptions: [example] } },
  mcp: false,
});

export const createPushSubscription = defineOperation({
  operationId: 'createPushSubscription',
  method: 'post',
  path: '/me/push/subscriptions',
  tag: 'Settings',
  summary: 'Show alerts in this browser',
  description: 'Saves a browser’s push subscription, as `PushSubscription.toJSON()` gives it. Urgent and high alerts then reach it (high ones after quiet hours). Subscribing the same browser again replaces the old subscription.',
  access: 'session',
  scopes: [],
  body: {
    schema: z
      .strictObject({
        endpoint: z.url({ protocol: /^https$/ }).max(2000).meta({ description: 'The push service URL.' }),
        keys: z.strictObject({ p256dh: z.string().regex(/^[A-Za-z0-9_-]{86,88}={0,2}$/).meta({ description: 'The browser’s P-256 public key, base64url.' }), auth: z.string().regex(/^[A-Za-z0-9_-]{22,24}={0,2}$/).meta({ description: 'Its 16-byte auth secret, base64url.' }) }),
        expirationTime: z.number().nullable().optional().meta({ description: 'Ignored; browsers resubscribe when it changes.' }),
      })
      .meta({ id: 'CreatePushSubscription' }),
    example: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' } },
  },
  response: { status: 201, description: 'The subscription.', schema: subscriptionSchema, example },
  errors: [409],
  mcp: false,
});

export const deletePushSubscription = defineOperation({
  operationId: 'deletePushSubscription',
  method: 'delete',
  path: '/me/push/subscriptions/{subscriptionId}',
  tag: 'Settings',
  summary: 'Stop showing alerts in a browser',
  description: 'Removes one of your browsers from push: it gets no more alerts. Other browsers you subscribed keep theirs.',
  access: 'session',
  scopes: [],
  params: z.object({ subscriptionId: id('push_subscription', 'The subscription.') }),
  response: { status: 204, description: 'Removed.' },
  errors: [404],
  mcp: false,
});
