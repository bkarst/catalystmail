import assert from 'node:assert/strict';
import { createDecipheriv, createECDH, createPublicKey, hkdfSync, randomBytes, verify } from 'node:crypto';

import { describe, it } from 'vitest';

import { checkVapidKeys, encryptPayload, generateVapidKeys, sendPush, vapidAuthorization } from './web-push.ts';

/** A browser's side of RFC 8291: its key pair, and how it opens a push. */
function browser() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  const subscription = { endpoint: 'https://push.example.net/send/abc123', p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') };
  const open = (body: Buffer) => {
    const salt = body.subarray(0, 16);
    const recordSize = body.readUInt32BE(16);
    const keyLength = body.readUInt8(20);
    const senderPublic = body.subarray(21, 21 + keyLength);
    const sealed = body.subarray(21 + keyLength);
    const shared = ecdh.computeSecret(senderPublic);
    const ikm = Buffer.from(hkdfSync('sha256', shared, auth, Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), senderPublic]), 32));
    const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
    const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
    const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
    decipher.setAuthTag(sealed.subarray(sealed.length - 16));
    const plain = Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - 16)), decipher.final()]);
    assert.equal(plain.at(-1), 2, 'the last record ends with its delimiter');
    return { recordSize, text: plain.subarray(0, plain.length - 1).toString() };
  };
  return { subscription, open };
}

describe('Web Push (RFC 8291, RFC 8292)', () => {
  it('encrypts a payload only the subscribed browser can open', () => {
    const { subscription, open } = browser();
    const body = encryptPayload(subscription, Buffer.from('{"title":"Needs you"}'));
    assert.deepEqual(open(body), { recordSize: 4096, text: '{"title":"Needs you"}' });
    assert.throws(() => browser().open(body), 'another browser can’t read it');
    assert.notDeepEqual(encryptPayload(subscription, Buffer.from('x')), encryptPayload(subscription, Buffer.from('x')), 'a fresh key and salt each time');
    assert.throws(() => encryptPayload({ ...subscription, auth: 'short' }, Buffer.from('x')), /16 bytes/);
  });

  it('signs each request with the VAPID key, for the push service’s origin', () => {
    const keys = generateVapidKeys();
    checkVapidKeys(keys);
    assert.throws(() => checkVapidKeys({ publicKey: generateVapidKeys().publicKey, privateKey: keys.privateKey }), /doesn’t match/);
    const now = new Date('2026-11-11T12:00:00Z');
    const header = vapidAuthorization('https://push.example.net/send/abc123', { ...keys, subject: 'mailto:ops@getacme.com' }, now);
    const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(header)!;
    assert.equal(k, keys.publicKey);
    const [head, claims, signature] = jwt!.split('.');
    assert.deepEqual(JSON.parse(Buffer.from(claims!, 'base64url').toString()), { aud: 'https://push.example.net', exp: now.getTime() / 1000 + 43_200, sub: 'mailto:ops@getacme.com' });
    const raw = Buffer.from(keys.publicKey, 'base64url');
    const publicKey = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33).toString('base64url') }, format: 'jwk' });
    assert.ok(verify('sha256', Buffer.from(`${head}.${claims}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature!, 'base64url')));
  });

  it('posts to the endpoint with the headers push services expect, and reads 410 as unsubscribed', async () => {
    const { subscription, open } = browser();
    const vapid = { ...generateVapidKeys(), subject: 'mailto:ops@getacme.com' };
    const posted: { url: string; headers: Record<string, string>; body: Buffer }[] = [];
    let status = 201;
    const net = { post: async (url: string, init: { headers: Record<string, string>; body: string | Buffer }) => (posted.push({ url, headers: init.headers, body: Buffer.from(init.body) }), { status, body: '' }) };
    assert.equal((await sendPush(net, subscription, { title: 'Needs you', url: '/needs-you' }, vapid, new Date())).outcome, 'sent');
    const [request] = posted;
    assert.deepEqual([request!.url, request!.headers['content-encoding'], request!.headers.ttl, request!.headers.urgency], [subscription.endpoint, 'aes128gcm', '86400', 'high']);
    assert.deepEqual(JSON.parse(open(request!.body).text), { title: 'Needs you', url: '/needs-you' });
    status = 410;
    assert.equal((await sendPush(net, subscription, {}, vapid, new Date())).outcome, 'gone');
    status = 500;
    assert.equal((await sendPush(net, subscription, {}, vapid, new Date())).outcome, 'failed');
  });
});
