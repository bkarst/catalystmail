import assert from 'node:assert/strict';

import { activities, campaigns, contacts, mailboxes, messages, newId, sending_domains, suppressions, threads, tracked_links, tracking_events, workspaces, type Db } from '@catalyst/db';
import { createTestDatabase } from '@catalyst/db/testing';
import { MemoryQueue } from '@catalyst/jobs';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { evaluateThread } from '../threads/evaluate.ts';
import { clickToken, openPixel, openToken, trackedClick, unsubscribePage, unsubscribePost, unsubscribeToken, type PublicDeps } from './tracking.ts';

// Needs a PostgreSQL server: set TEST_DATABASE_URL to any database on it.
const adminUrl = process.env.TEST_DATABASE_URL;
const SECRET = 'test-tracking-secret';

const GMAIL = 'Mozilla/5.0 (Windows NT 5.1; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)';
const MIMECAST = 'Mimecast-Url-Protect/1.0';

describe.skipIf(!adminUrl)('open pixel, tracked links and unsubscribe (§8.8, §9, IT-17, IT-18)', () => {
  let db: Db;
  let drop: () => Promise<void>;
  const jobs = new MemoryQueue();
  const pending: Promise<void>[] = [];
  const deps = (): PublicDeps => ({ db, jobs, secret: SECRET, now: new Date(), defer: (task) => void pending.push(task()) });
  const settle = async () => {
    await Promise.all(pending.splice(0));
  };
  const workspaceId = newId('workspace');
  let mailboxId: string;
  let campaignId: string;

  async function sentMessage(sentMinutesAgo = 120) {
    const contactId = newId('contact');
    await db.insert(contacts).values({ id: contactId, workspace_id: workspaceId, email: `${contactId}@globex.example`, timezone: 'UTC' });
    const threadId = newId('thread');
    await db.insert(threads).values({ id: threadId, workspace_id: workspaceId, campaign_id: campaignId, contact_id: contactId, mailbox_id: mailboxId });
    const messageId = newId('message');
    const sentAt = new Date(Date.now() - sentMinutesAgo * 60_000);
    await db.insert(messages).values({
      id: messageId, workspace_id: workspaceId, thread_id: threadId, mailbox_id: mailboxId, direction: 'outbound', status: 'sent', author: 'template',
      message_id_header: `<${messageId}@getacme.com>`, from_email: 'alex@getacme.com', to_emails: ['x'], subject: 'Hello', sent_at: sentAt, created_at: sentAt,
    });
    return { contactId, threadId, messageId };
  }

  beforeAll(async () => {
    ({ db, drop } = await createTestDatabase(adminUrl!));
    await db.insert(workspaces).values({ id: workspaceId, name: 'Acme', physical_address: '500 Howard St' });
    const domainId = newId('domain');
    await db.insert(sending_domains).values({ id: domainId, workspace_id: workspaceId, domain: 'getacme.com' });
    mailboxId = newId('mailbox');
    await db.insert(mailboxes).values({
      id: mailboxId, workspace_id: workspaceId, sending_domain_id: domainId, email: 'alex@getacme.com', display_name: 'Alex Rivera', auth: 'password', status: 'active',
      smtp_host: 'smtp.gmail.com', smtp_port: 465, smtp_secure: 'tls', smtp_username: 'a', imap_host: 'imap.gmail.com', imap_username: 'a', credentials_enc: Buffer.from('x'), credentials_key_version: 1, folders: {},
    });
    campaignId = newId('campaign');
    await db.insert(campaigns).values({ id: campaignId, workspace_id: workspaceId, name: 'Q4', objective: 'x', status: 'active', persona: {}, sending_window: { days: [1, 2, 3, 4, 5], start: '08:30', end: '17:30', tz: 'contact', fallback_tz: 'UTC' } });
  });
  afterAll(async () => {
    await drop?.();
  });

  const pixel = async (token: string, userAgent: string, ip = '203.0.113.7', method = 'GET') =>
    openPixel(new Request(`http://catalyst.test/t/o/${token}.gif`, { method, headers: { 'user-agent': userAgent, 'x-forwarded-for': ip } }), `${token}.gif`, deps());

  it('answers every pixel request with the same GIF, and records nothing for a bad token (§19.11)', async () => {
    const { messageId } = await sentMessage();
    const valid = await pixel(openToken(messageId, SECRET), GMAIL);
    const tampered = await pixel(openToken(messageId, 'another-secret'), GMAIL);
    const garbage = await pixel('not-a-token', GMAIL);
    for (const response of [valid, tampered, garbage]) {
      assert.deepEqual([response.status, response.headers.get('content-type'), response.headers.get('cache-control')], [200, 'image/gif', 'no-store, max-age=0']);
      assert.equal((await response.arrayBuffer()).byteLength, 43);
    }
    await settle();
    const events = await db.select().from(tracking_events).where(eq(tracking_events.message_id, messageId));
    assert.equal(events.length, 1);
    assert.equal(events[0]!.ip_hash!.length, 32, 'the IP is stored only as a keyed hash');
  });

  it('turns proxy and scanner fetches into "Opened (auto)", then a person’s open into "Opened" (IT-18)', async () => {
    const { threadId, messageId } = await sentMessage();
    const token = openToken(messageId, SECRET);
    await pixel(token, 'Mozilla/5.0', '17.58.0.12');
    await pixel(token, MIMECAST);
    await settle();
    await evaluateThread(db, threadId, { now: new Date() });
    let [thread] = await db.select().from(threads).where(eq(threads.id, threadId));
    assert.deepEqual([thread!.open_status, thread!.stage, thread!.open_count], ['machine_only', 'received', 0]);

    await pixel(token, GMAIL);
    await pixel(token, GMAIL);
    await settle();
    await evaluateThread(db, threadId, { now: new Date() });
    [thread] = await db.select().from(threads).where(eq(threads.id, threadId));
    assert.deepEqual([thread!.open_status, thread!.stage, thread!.open_count], ['opened', 'received', 2]);
    const sources = (await db.select().from(tracking_events).where(eq(tracking_events.message_id, messageId))).map((event) => event.source).sort();
    assert.deepEqual(sources, ['human', 'human', 'privacy_proxy', 'security_scanner']);
    const [message] = await db.select().from(messages).where(eq(messages.id, messageId));
    assert.deepEqual([message!.human_open, message!.open_count], [true, 2]);
    const opened = (await db.select().from(activities).where(eq(activities.thread_id, threadId))).filter((entry) => entry.type === 'message.opened');
    assert.equal(opened.length, 1, 'only the first human open is logged');
    assert.ok(jobs.of('thread.evaluate').some((job) => job.thread_id === threadId));
  });

  it('redirects a tracked link and records the click; a bad token goes to the fallback', async () => {
    const { messageId } = await sentMessage();
    const linkId = newId('link');
    await db.insert(tracked_links).values({ id: linkId, message_id: messageId, position: 1, original_url: 'https://cal.com/acme/intro', link_key: 'booking' });
    const click = (token: string) => trackedClick(new Request(`http://catalyst.test/t/c/${token}`, { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }), token, { ...deps(), fallbackUrl: 'https://catalyst.example.com/' });
    const good = await click(clickToken(linkId, SECRET));
    assert.deepEqual([good.status, good.headers.get('location')], [302, 'https://cal.com/acme/intro']);
    assert.equal((await click('forged')).headers.get('location'), 'https://catalyst.example.com/');
    await settle();
    const [event] = await db.select().from(tracking_events).where(eq(tracking_events.link_id, linkId));
    assert.deepEqual([event!.type, event!.source], ['click', 'human']);
  });

  it('unsubscribes on a one-click POST, never on a GET, and can be undone from the page (IT-17)', async () => {
    const { contactId, threadId, messageId } = await sentMessage();
    const token = unsubscribeToken(messageId, SECRET);
    assert.equal(openToken(messageId, SECRET) === token, false, 'pixel and unsubscribe tokens differ');

    const shown = await unsubscribePage(token, deps());
    assert.match(await shown.text(), /Unsubscribe from emails from Alex at Acme\?/);
    let [contact] = await db.select().from(contacts).where(eq(contacts.id, contactId));
    assert.equal(contact!.subscription_status, 'subscribed', 'a GET alone does not unsubscribe');

    const oneClick = await unsubscribePost(new Request(`http://catalyst.test/u/${token}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' }), token, deps());
    assert.equal(oneClick.status, 200);
    [contact] = await db.select().from(contacts).where(eq(contacts.id, contactId));
    assert.equal(contact!.subscription_status, 'unsubscribed');
    const [suppression] = await db.select().from(suppressions).where(eq(suppressions.email, contact!.email));
    assert.deepEqual([suppression!.reason, suppression!.source], ['unsubscribed', 'one_click']);
    await evaluateThread(db, threadId, { now: new Date() });
    assert.equal((await db.select().from(threads).where(eq(threads.id, threadId)))[0]!.state, 'unsubscribed');

    const undone = await unsubscribePost(new Request(`http://catalyst.test/u/${token}`, { method: 'POST', body: 'action=undo' }), token, deps());
    assert.match(await undone.text(), /subscribed again/);
    [contact] = await db.select().from(contacts).where(eq(contacts.id, contactId));
    assert.equal(contact!.subscription_status, 'subscribed');
    assert.equal((await db.select().from(suppressions).where(eq(suppressions.email, contact!.email))).length, 0);

    // A forged token gets the same pages and changes nothing.
    const forged = unsubscribeToken(messageId, 'wrong');
    assert.match(await (await unsubscribePage(forged, deps())).text(), /Unsubscribe from emails from this sender\?/);
    const done = await unsubscribePost(new Request(`http://catalyst.test/u/${forged}`, { method: 'POST', body: 'action=unsubscribe' }), forged, deps());
    assert.match(await done.text(), /You won’t hear from us again/);
    [contact] = await db.select().from(contacts).where(eq(contacts.id, contactId));
    assert.equal(contact!.subscription_status, 'subscribed');
  });
});
