// Reaching webhook endpoints safely (spec §13.6, §16): https only, and only public addresses, both
// when an endpoint is registered and at the moment of each delivery's connection, so a hostname
// that later resolves to an internal address (DNS rebinding) is refused too.

import { createHmac } from 'node:crypto';
import { BlockList, isIP } from 'node:net';

export interface WebhookResponse {
  status: number;
  /** The start of the body. */
  body: string;
}

export interface WebhookNet {
  /** Every address a host resolves to. */
  resolve(host: string): Promise<string[]>;
  /** POSTs, refusing to connect to a non-public address; throws when there is no answer. */
  post(url: string, init: { headers: Record<string, string>; body: string | Buffer; timeoutMs: number }): Promise<WebhookResponse>;
}

const PRIVATE = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) PRIVATE.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['2001:db8::', 32], ['64:ff9b::', 96]] as const) PRIVATE.addSubnet(network, prefix, 'ipv6');

/** Whether an address is reachable on the public internet (§19 SSRF tests). */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  if (family === 6) {
    // An IPv4 address written as IPv6 (::ffff:10.0.0.1) is judged as IPv4.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (mapped) return isPublicAddress(mapped[1]!);
    return !PRIVATE.check(address, 'ipv6');
  }
  return !PRIVATE.check(address, 'ipv4');
}

/** Why a URL can't receive webhooks, or null when it can. */
export async function unsafeUrlReason(url: string, net: Pick<WebhookNet, 'resolve'>): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'It is not a URL.';
  }
  if (parsed.protocol !== 'https:') return 'Webhook URLs must use https.';
  if (parsed.username || parsed.password) return 'Put credentials in your receiver, not the URL.';
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return `${host} is not a public host.`;
  const addresses = isIP(host) ? [host] : await net.resolve(host).catch(() => []);
  if (addresses.length === 0) return `${host} does not resolve.`;
  const internal = addresses.find((address) => !isPublicAddress(address));
  return internal ? `${host} resolves to ${internal}, which is not a public address.` : null;
}

/** `Catalyst-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, t + "." + body)>` (§13.6). */
export function signWebhook(secret: string, body: string, now: Date): string {
  const t = Math.floor(now.getTime() / 1000);
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
}

/** The live network: node's https client with a lookup that refuses non-public addresses. */
export function httpsWebhookNet(): WebhookNet {
  return {
    async resolve(host) {
      const { promises: dns } = await import('node:dns');
      return (await dns.lookup(host, { all: true })).map((entry) => entry.address);
    },
    async post(url, init) {
      const https = await import('node:https');
      const dns = await import('node:dns');
      return new Promise<WebhookResponse>((resolve, reject) => {
        const request = https.request(
          url,
          {
            method: 'POST',
            headers: { ...init.headers, 'content-length': Buffer.byteLength(init.body).toString() },
            timeout: init.timeoutMs,
            // Checked at connect time, against DNS rebinding.
            lookup: (hostname, options, callback) => {
              dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
                if (error) return callback(error, '', 4);
                const list = addresses as unknown as { address: string; family: number }[];
                const internal = list.find((entry) => !isPublicAddress(entry.address));
                if (internal) return callback(Object.assign(new Error(`${hostname} resolves to ${internal.address}, which is not a public address`), { code: 'EPRIVATE' }), '', 4);
                if ((options as { all?: boolean }).all) return (callback as unknown as (error: null, addresses: unknown[]) => void)(null, list);
                callback(null, list[0]!.address, list[0]!.family);
              });
            },
          },
          (response) => {
            let body = '';
            response.setEncoding('utf8');
            response.on('data', (chunk: string) => {
              if (body.length < 1000) body += chunk;
            });
            response.on('end', () => resolve({ status: response.statusCode ?? 0, body: body.slice(0, 500) }));
          },
        );
        request.on('timeout', () => request.destroy(new Error(`No answer within ${init.timeoutMs / 1000} s`)));
        request.on('error', reject);
        request.end(init.body);
      });
    },
  };
}
