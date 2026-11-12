// Signed tokens for the open pixel, tracked links and unsubscribe URLs (§9.1):
//   token = base64url(id ‖ HMAC-SHA256(secret, id)[0..12])
// The ID's own prefix (`msg_`, `lnk_`) says what the token is for.

import { createHmac, timingSafeEqual } from 'node:crypto';

const MAC_BYTES = 12;

function mac(id: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(id, 'utf8').digest().subarray(0, MAC_BYTES);
}

export function signTrackingToken(id: string, secret: string): string {
  if (id.length === 0) throw new RangeError('Cannot sign an empty ID');
  return Buffer.concat([Buffer.from(id, 'utf8'), mac(id, secret)]).toString('base64url');
}

/**
 * The ID inside a token, or null if the token is malformed or its signature doesn't match.
 * Callers must respond identically in both cases so the endpoint can't be used as an oracle.
 */
export function verifyTrackingToken(token: string, secret: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(token)) return null;
  const bytes = Buffer.from(token, 'base64url');
  if (bytes.length <= MAC_BYTES) return null;
  const id = bytes.subarray(0, bytes.length - MAC_BYTES).toString('utf8');
  const given = bytes.subarray(bytes.length - MAC_BYTES);
  return timingSafeEqual(given, mac(id, secret)) ? id : null;
}
