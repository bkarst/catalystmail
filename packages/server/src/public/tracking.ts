// The public tracking and unsubscribe endpoints (spec §8.8, §9, §15.19), outside /api/v1. They
// answer the same way for a valid and an invalid token, and the pixel never waits on the database.

import { createHmac } from 'node:crypto';

import { activities, contacts, mailbox_daily_stats, mailboxes, messages, newId, threads, tracked_links, tracking_events, workspaces, type Db } from '@catalyst/db';
import { classifyFetch, signTrackingToken, TRANSPARENT_GIF, verifyTrackingToken, type OpenSource } from '@catalyst/email';
import type { JobQueue } from '@catalyst/jobs';
import { and, eq, gt, sql } from 'drizzle-orm';

import { undoUnsubscribe, unsubscribeContact } from '../contacts/unsubscribe.ts';
import { workspaceDay } from '../outbound/capacity.ts';

const UNSUBSCRIBE_PURPOSE = 'unsub:';

/** Open tokens sign the message ID, click tokens the link ID (§9.1). */
export const openToken = (messageId: string, secret: string) => signTrackingToken(messageId, secret);
export const clickToken = (linkId: string, secret: string) => signTrackingToken(linkId, secret);
/** Unsubscribe tokens sign a separate purpose, so a leaked pixel URL can't unsubscribe anyone. */
export const unsubscribeToken = (messageId: string, secret: string) => signTrackingToken(`${UNSUBSCRIBE_PURPOSE}${messageId}`, secret);

export interface PublicDeps {
  db: Db;
  jobs: JobQueue;
  /** TRACKING_SIGNING_SECRET; without it no token verifies. */
  secret: string | null;
  now: Date;
  /** Runs work after the response is sent (Next.js `after`). */
  defer: (task: () => Promise<void>) => void;
}

function verify(token: string, secret: string | null, prefix: string, kind: 'msg' | 'lnk'): string | null {
  if (!secret) return null;
  const value = verifyTrackingToken(token, secret);
  if (!value?.startsWith(prefix)) return null;
  const id = value.slice(prefix.length);
  return new RegExp(`^${kind}_[0-9a-z]{26}$`).test(id) ? id : null;
}

const ipHash = (ip: string | null, secret: string) => (ip ? createHmac('sha256', secret).update(`ip:${ip}`).digest() : null);

function clientIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('x-real-ip') || null;
}

interface Fetch {
  messageId: string;
  type: 'open' | 'click';
  linkId?: string;
  userAgent: string | null;
  ip: string | null;
  method: 'GET' | 'HEAD';
}

/** Stores one open or click, updates the counts a person's opens drive, and queues evaluation. */
export async function recordFetch(deps: Omit<PublicDeps, 'defer'>, fetch: Fetch): Promise<OpenSource | null> {
  const { db, now } = deps;
  const [message] = await db.select().from(messages).where(and(eq(messages.id, fetch.messageId), eq(messages.direction, 'outbound')));
  if (!message || !message.thread_id) return null;
  const burstOfLinks =
    fetch.type === 'click' &&
    (await db.select({ id: tracking_events.id }).from(tracking_events).where(and(eq(tracking_events.message_id, message.id), eq(tracking_events.type, 'click'), gt(tracking_events.occurred_at, new Date(now.getTime() - 5000))))).length > 0;
  const classification = classifyFetch({
    userAgent: fetch.userAgent,
    ip: fetch.ip,
    method: fetch.method,
    secondsSinceSent: message.sent_at ? (now.getTime() - message.sent_at.getTime()) / 1000 : null,
    burstOfLinks,
  });
  await db.transaction(async (tx) => {
    const human = classification.source === 'human';
    // Lock the message before the event row takes its foreign-key lock on it: two opens arriving
    // together then queue up instead of deadlocking, and only one counts as the first.
    const [locked] = human ? await tx.select({ human_open: messages.human_open }).from(messages).where(eq(messages.id, message.id)).for('update') : [];
    await tx.insert(tracking_events).values({
      id: newId('tracking_event'),
      workspace_id: message.workspace_id,
      message_id: message.id,
      thread_id: message.thread_id,
      type: fetch.type,
      link_id: fetch.linkId ?? null,
      source: classification.source,
      occurred_at: now,
      ip_hash: ipHash(fetch.ip, deps.secret!),
      user_agent: fetch.userAgent?.slice(0, 500) ?? null,
    });
    if (!human) return;
    const first = !locked!.human_open;
    await tx
      .update(messages)
      .set({ open_count: sql`${messages.open_count} + 1`, first_opened_at: sql`coalesce(${messages.first_opened_at}, ${now})`, last_opened_at: now, human_open: true, updated_at: now })
      .where(eq(messages.id, message.id));
    const [thread] = await tx.select({ contact_id: threads.contact_id, campaign_id: threads.campaign_id }).from(threads).where(eq(threads.id, message.thread_id!));
    await tx.update(contacts).set({ last_opened_at: now }).where(eq(contacts.id, thread!.contact_id));
    if (first) {
      // Counted on the day it was sent, so the human-open rate compares opens with those sends (§8.10).
      const [workspace] = await tx.select({ zone: workspaces.default_timezone }).from(workspaces).where(eq(workspaces.id, message.workspace_id));
      const { day } = workspaceDay(message.sent_at ?? now, workspace?.zone ?? 'UTC');
      await tx
        .insert(mailbox_daily_stats)
        .values({ mailbox_id: message.mailbox_id, day, opens_human: 1 })
        .onConflictDoUpdate({ target: [mailbox_daily_stats.mailbox_id, mailbox_daily_stats.day], set: { opens_human: sql`coalesce(${mailbox_daily_stats.opens_human}, 0) + 1` } });
    }
    if (first || fetch.type === 'click') {
      await tx.insert(activities).values({
        id: newId('activity'),
        workspace_id: message.workspace_id,
        contact_id: thread!.contact_id,
        thread_id: message.thread_id,
        campaign_id: thread!.campaign_id,
        type: fetch.type === 'click' ? 'message.clicked' : 'message.opened',
        actor_type: 'contact',
        data: { message_id: message.id, ...(fetch.linkId && { link_id: fetch.linkId }) },
        occurred_at: now,
      });
    }
  });
  await deps.jobs.enqueue('thread.evaluate', { thread_id: message.thread_id });
  return classification.source;
}

/** `GET /t/o/{token}.gif`: always the same 1×1 GIF, at once. */
export function openPixel(request: Request, token: string, deps: PublicDeps): Response {
  const messageId = verify(token.replace(/\.gif$/, ''), deps.secret, '', 'msg');
  if (messageId) {
    const fetch: Fetch = { messageId, type: 'open', userAgent: request.headers.get('user-agent'), ip: clientIp(request), method: request.method === 'HEAD' ? 'HEAD' : 'GET' };
    deps.defer(() => recordFetch(deps, fetch).then(() => undefined, (error) => console.error('[tracking] recording an open failed', error)));
  }
  return new Response(request.method === 'HEAD' ? null : new Uint8Array(TRANSPARENT_GIF), {
    status: 200,
    headers: { 'content-type': 'image/gif', 'content-length': String(TRANSPARENT_GIF.length), 'cache-control': 'no-store, max-age=0', pragma: 'no-cache' },
  });
}

/** `GET /t/c/{token}`: redirects to the original link and records the click. */
export async function trackedClick(request: Request, token: string, deps: PublicDeps & { fallbackUrl: string }): Promise<Response> {
  const linkId = verify(token, deps.secret, '', 'lnk');
  const [link] = linkId ? await deps.db.select().from(tracked_links).where(eq(tracked_links.id, linkId)) : [];
  if (link) {
    const fetch: Fetch = { messageId: link.message_id, type: 'click', linkId: link.id, userAgent: request.headers.get('user-agent'), ip: clientIp(request), method: request.method === 'HEAD' ? 'HEAD' : 'GET' };
    deps.defer(() => recordFetch(deps, fetch).then(() => undefined, (error) => console.error('[tracking] recording a click failed', error)));
  }
  return new Response(null, { status: 302, headers: { location: link?.original_url ?? deps.fallbackUrl, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
}

// ── Unsubscribe (§8.8, §15.19) ─────────────────────────────────────────────────────────────────

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);

function page(title: string, body: string): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title>
<style>body{font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#18181b;background:#fff;margin:0;display:grid;place-items:center;min-height:100vh}main{max-width:28rem;padding:2rem 1.5rem;text-align:center}h1{font-size:1.25rem;font-weight:600;margin:0 0 1.5rem}button{font:inherit;padding:.6rem 1.4rem;border-radius:8px;border:0;background:#4f46e5;color:#fff;cursor:pointer}button:focus-visible{outline:2px solid #4f46e5;outline-offset:2px}.link{background:none;color:#52525b;padding:0;text-decoration:underline;font-size:.875rem}p{color:#52525b}@media (prefers-color-scheme:dark){body{background:#09090b;color:#fafafa}p,.link{color:#a1a1aa}}</style></head>
<body><main>${body}</main></body></html>`;
  return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'" } });
}

interface Recipient {
  workspaceId: string;
  contactId: string;
  threadId: string | null;
  senderName: string;
  workspaceName: string;
}

async function recipientFor(db: Db, token: string, secret: string | null): Promise<Recipient | null> {
  const messageId = verify(token, secret, UNSUBSCRIBE_PURPOSE, 'msg');
  if (!messageId) return null;
  const [row] = await db
    .select({ workspaceId: messages.workspace_id, threadId: messages.thread_id, contactId: threads.contact_id, senderName: mailboxes.display_name, workspaceName: workspaces.name })
    .from(messages)
    .innerJoin(threads, eq(threads.id, messages.thread_id))
    .innerJoin(mailboxes, eq(mailboxes.id, messages.mailbox_id))
    .innerJoin(workspaces, eq(workspaces.id, messages.workspace_id))
    .where(and(eq(messages.id, messageId), eq(messages.direction, 'outbound')));
  return row ?? null;
}

const senderLine = (recipient: Recipient | null) => (recipient ? `${escapeHtml(recipient.senderName.split(/\s+/)[0] ?? recipient.senderName)} at ${escapeHtml(recipient.workspaceName)}` : 'this sender');

/** `GET /u/{token}`: a confirmation page. A GET never unsubscribes, because scanners prefetch links. */
export async function unsubscribePage(token: string, deps: PublicDeps): Promise<Response> {
  const recipient = await recipientFor(deps.db, token, deps.secret);
  return page('Unsubscribe', `<h1>Unsubscribe from emails from ${senderLine(recipient)}?</h1><form method="post"><input type="hidden" name="action" value="unsubscribe"><button type="submit">Unsubscribe</button></form>`);
}

/** `POST /u/{token}`: RFC 8058 one-click, or the page's button, or its undo link. */
export async function unsubscribePost(request: Request, token: string, deps: PublicDeps): Promise<Response> {
  const text = await request.text().catch(() => '');
  const form = new URLSearchParams(text);
  const oneClick = form.get('List-Unsubscribe') === 'One-Click';
  const undo = form.get('action') === 'undo';
  const recipient = await recipientFor(deps.db, token, deps.secret);
  if (recipient) {
    await deps.db.transaction(async (tx) => {
      if (undo) await undoUnsubscribe(tx, recipient, deps.jobs, deps.now);
      else await unsubscribeContact(tx, { ...recipient, source: oneClick ? 'one_click' : 'link', actor: { actor_type: 'contact', actor_id: null } }, deps.jobs, deps.now);
    });
  }
  if (oneClick) return new Response('Unsubscribed.', { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
  if (undo) return page('Subscribed again', `<h1>You’re subscribed again.</h1><p>Emails from ${senderLine(recipient)} can reach you again.</p>`);
  return page(
    'Unsubscribed',
    `<h1>Done. You won’t hear from us again.</h1><form method="post"><input type="hidden" name="action" value="undo"><button class="link" type="submit">Undo</button></form>`,
  );
}
