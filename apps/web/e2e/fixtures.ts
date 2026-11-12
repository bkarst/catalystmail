// What every end-to-end test starts from: its own seeded workspace (e2e/support/data.ts), and a
// browser already signed in as that workspace's owner. Plus the checks many tests share: axe-core
// (spec §19.9: no serious or critical violations on any page), no sideways scrolling on a phone,
// TOTP codes, and signed tracking tokens.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import AxeBuilder from '@axe-core/playwright';
import { test as base, expect, type Locator, type Page } from '@playwright/test';

export { expect };

export interface Seed {
  workspaceId: string;
  owner: { id: string; email: string; name: string; password: string };
  domainId: string;
  mailboxId: string;
  campaignId: string;
  goals: { call: string; paid: string };
  contacts: { priya: string; dana: string; ken: string };
  companies: { globex: string; northwind: string; fabrikam: string };
  threads: { priya: string; dana: string; ken: string };
  draftId: string;
  /** Sent emails: the first one to Priya (opened three times) and to Ken (not opened). */
  messages: { priyaFirst: string; kenFirst: string };
}

// One data process per Playwright worker (each worker is its own process), started on first use; it
// exits when the worker does and its input closes.
let helper: { child: ChildProcessWithoutNullStreams; waiting: Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }> } | undefined;
let nextId = 0;

/** Runs a command of e2e/support/data.ts against the suite's database and returns its result. */
export function data<T = unknown>(command: string, ...args: string[]): Promise<T> {
  if (!helper) {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./support/data.ts', import.meta.url))], { env: { ...process.env, DATABASE_URL: process.env.E2E_DATABASE_URL }, stdio: 'pipe' });
    const waiting = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
    child.stderr.pipe(process.stderr);
    createInterface({ input: child.stdout }).on('line', (line) => {
      const answer = JSON.parse(line) as { id: number; result?: unknown; error?: string };
      const pending = waiting.get(answer.id);
      waiting.delete(answer.id);
      if (answer.error) pending?.reject(new Error(`data ${answer.error}`));
      else pending?.resolve(answer.result);
    });
    child.unref();
    helper = { child, waiting };
  }
  const id = nextId++;
  const { child, waiting } = helper;
  return new Promise<T>((resolve, reject) => {
    waiting.set(id, { resolve: resolve as (value: unknown) => void, reject });
    child.stdin.write(`${JSON.stringify({ id, command, args })}\n`);
  });
}

/**
 * A client address of its own for each test. Sign-in is throttled per address (§16, five tries a
 * minute), and Better Auth takes the address from X-Forwarded-For, so parallel tests don't share.
 */
export const clientAddress = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`;

export const test = base.extend<{ seed: Seed }>({
  seed: async ({}, use) => {
    await use(await data<Seed>('seed'));
  },
  extraHTTPHeaders: async ({}, use) => {
    await use({ 'x-forwarded-for': clientAddress() });
  },
  // The owner makes their password the way an invited person does (§16), which signs them in.
  storageState: async ({ seed, playwright, baseURL, extraHTTPHeaders }, use) => {
    const request = await playwright.request.newContext({ baseURL, extraHTTPHeaders });
    const response = await request.post('/api/auth/sign-up/email', { data: { email: seed.owner.email, password: seed.owner.password, name: seed.owner.name }, headers: { origin: baseURL! } });
    if (!response.ok()) throw new Error(`Signing up ${seed.owner.email} failed: ${response.status()} ${await response.text()}`);
    const state = await request.storageState();
    await request.dispose();
    await use(state);
  },
});

/** Signed out, for the sign-in tests. */
export const signedOut = { cookies: [], origins: [] };

/**
 * §15.20 and §19.9: axe-core finds no serious or critical WCAG 2.2 AA violations on the page. It
 * waits for the view to finish loading, and looks again for a few seconds before failing, so a
 * colour caught mid-transition or a list still rendering isn't reported; a real violation stays.
 */
export async function expectAccessible(page: Page, options: { exclude?: string[] } = {}): Promise<void> {
  await expect(page.getByText('Loading…')).toHaveCount(0);
  await expect(async () => {
    let builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']);
    for (const selector of options.exclude ?? []) builder = builder.exclude(selector);
    const { violations } = await builder.analyze();
    const serious = violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical');
    expect(
      serious.map((violation) => `${violation.id} (${violation.impact}): ${violation.help}\n  ${violation.nodes.map((node) => node.target.join(' ')).join('\n  ')}`),
      `axe-core on ${page.url()}`,
    ).toEqual([]);
  }).toPass({ timeout: 5_000 });
}

/** §15.20: on a phone nothing scrolls sideways. */
export async function expectNoSidewaysScroll(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), { message: `sideways scroll on ${page.url()}` }).toBeLessThanOrEqual(0);
}

/** The current six-digit code for a TOTP secret (RFC 6238: SHA-1, 30 seconds), from an otpauth:// URI. */
export function totp(uri: string, at = Date.now()): string {
  const secret = new URL(uri).searchParams.get('secret')!;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of secret.replace(/=+$/, '').toUpperCase()) bits += alphabet.indexOf(char).toString(2).padStart(5, '0');
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((byte) => parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const digest = createHmac('sha1', key).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0xf;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

/** A token for the public tracking routes (§9.1), signed with the suite's TRACKING_SIGNING_SECRET. */
function trackingToken(value: string): string {
  const mac = createHmac('sha256', process.env.E2E_TRACKING_SECRET!).update(value, 'utf8').digest().subarray(0, 12);
  return Buffer.concat([Buffer.from(value, 'utf8'), mac]).toString('base64url');
}

/** The unsubscribe link in a sent email (§8.8). */
export const unsubscribePath = (messageId: string) => `/u/${trackingToken(`unsub:${messageId}`)}`;
/** The open pixel in a sent email (§9.2). */
export const openPixelPath = (messageId: string) => `/t/o/${trackingToken(messageId)}`;

/** The visible error of a view or action; Next's own route announcer is an empty alert too. */
export const alertIn = (scope: Page | Locator) => scope.getByRole('alert').filter({ hasText: /\S/ });
