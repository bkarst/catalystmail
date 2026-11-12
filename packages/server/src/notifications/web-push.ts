// Browser push (spec §11.2): urgent and high alerts to the browsers people allowed, through the
// browser's own push service. The payload is encrypted for that browser (RFC 8291, aes128gcm),
// and Catalyst signs each request with its VAPID key (RFC 8292), so the push service knows who
// sends. Everything here is node:crypto; nothing is sent in the clear.

import { createCipheriv, createECDH, createPrivateKey, hkdfSync, randomBytes, sign } from 'node:crypto';

import type { WebhookNet } from '../webhooks/net.ts';

export interface PushSubscriptionKeys {
  endpoint: string;
  /** The browser's P-256 public key, uncompressed, base64url. */
  p256dh: string;
  /** Its 16-byte authentication secret, base64url. */
  auth: string;
}

export interface VapidKeys {
  /** Uncompressed P-256 public key, base64url: what the browser subscribes with. */
  publicKey: string;
  /** The private scalar, base64url. */
  privateKey: string;
  /** `mailto:` or an https URL the push service can reach the sender at. */
  subject: string;
}

const b64url = (value: Buffer) => value.toString('base64url');
const RECORD_SIZE = 4096;

/** A new VAPID key pair, for VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY. */
export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { publicKey: b64url(ecdh.getPublicKey()), privateKey: b64url(ecdh.getPrivateKey()) };
}

/** RFC 8291: the payload as one aes128gcm record, encrypted for this subscription. */
export function encryptPayload(subscription: Pick<PushSubscriptionKeys, 'p256dh' | 'auth'>, payload: Buffer, random: (size: number) => Buffer = randomBytes): Buffer {
  const receiverPublic = Buffer.from(subscription.p256dh, 'base64url');
  const authSecret = Buffer.from(subscription.auth, 'base64url');
  if (receiverPublic.length !== 65 || receiverPublic[0] !== 4) throw new Error('The subscription’s p256dh is not an uncompressed P-256 key.');
  if (authSecret.length !== 16) throw new Error('The subscription’s auth secret is not 16 bytes.');
  if (payload.length > RECORD_SIZE - 17 - 86) throw new Error('The push payload is too large.');

  const sender = createECDH('prime256v1');
  sender.generateKeys();
  const senderPublic = sender.getPublicKey();
  const shared = sender.computeSecret(receiverPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), receiverPublic, senderPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, authSecret, keyInfo, 32));
  const salt = random(16);
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));

  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  // One record, so it ends with the last-record delimiter (0x02) and no padding.
  const sealed = Buffer.concat([cipher.update(Buffer.concat([payload, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(senderPublic.length, 20);
  return Buffer.concat([header, senderPublic, sealed]);
}

/** RFC 8292: `Authorization: vapid t=<ES256 JWT for the push service's origin>, k=<public key>`. */
export function vapidAuthorization(endpoint: string, vapid: VapidKeys, now: Date): string {
  const publicKey = Buffer.from(vapid.publicKey, 'base64url');
  const key = createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d: vapid.privateKey, x: b64url(publicKey.subarray(1, 33)), y: b64url(publicKey.subarray(33, 65)) }, format: 'jwk' });
  const header = b64url(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64url(Buffer.from(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now.getTime() / 1000) + 12 * 3600, sub: vapid.subject })));
  const signature = sign('sha256', Buffer.from(`${header}.${claims}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${header}.${claims}.${b64url(signature)}, k=${vapid.publicKey}`;
}

/** Checks the pair belongs together, so a misconfigured key fails at start rather than per push. */
export function checkVapidKeys(vapid: Pick<VapidKeys, 'publicKey' | 'privateKey'>): void {
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(Buffer.from(vapid.privateKey, 'base64url'));
  if (!ecdh.getPublicKey().equals(Buffer.from(vapid.publicKey, 'base64url'))) throw new Error('VAPID_PUBLIC_KEY doesn’t match VAPID_PRIVATE_KEY.');
}

export type PushOutcome = 'sent' | 'gone' | 'failed';

/** Sends one push; `gone` (404, 410) means the browser unsubscribed and the subscription should go. */
export async function sendPush(net: Pick<WebhookNet, 'post'>, subscription: PushSubscriptionKeys, payload: unknown, vapid: VapidKeys, now: Date, options: { urgency?: 'high' | 'normal'; ttlSeconds?: number } = {}): Promise<{ outcome: PushOutcome; status: number; detail: string }> {
  const body = encryptPayload(subscription, Buffer.from(JSON.stringify(payload)));
  const response = await net.post(subscription.endpoint, {
    headers: {
      authorization: vapidAuthorization(subscription.endpoint, vapid, now),
      'content-encoding': 'aes128gcm',
      'content-type': 'application/octet-stream',
      ttl: String(options.ttlSeconds ?? 86_400),
      urgency: options.urgency ?? 'high',
    },
    body,
    timeoutMs: 10_000,
  });
  if (response.status >= 200 && response.status < 300) return { outcome: 'sent', status: response.status, detail: '' };
  return { outcome: response.status === 404 || response.status === 410 ? 'gone' : 'failed', status: response.status, detail: response.body.slice(0, 200) };
}
