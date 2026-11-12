import assert from 'node:assert/strict';

import hoodiecrow from 'hoodiecrow-imap';
import { ImapFlow } from 'imapflow';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { imapflowConnector, type ImapAccount } from './imap.ts';

const message = (id: string, subject: string, extra = '') => `From: Priya <priya@globex.example>\r\nTo: alex@getacme.com\r\nSubject: ${subject}\r\nMessage-ID: <${id}>\r\n${extra}\r\nBody of ${id}`;

describe('IMAP over ImapFlow, against an in-process server (§7.3, IT-20)', () => {
  let server: ReturnType<typeof hoodiecrow>;
  let account: ImapAccount;

  beforeAll(async () => {
    server = hoodiecrow({
      plugins: ['id', 'sasl-ir', 'auth-plain', 'namespace', 'enable', 'condstore', 'literalplus', 'unselect', 'special-use', 'uidplus'],
      storage: {
        INBOX: {
          messages: [
            { raw: message('read@globex.example', 'Already read'), flags: ['\\Seen'], internaldate: '10-Nov-2026 09:00:00 +0000' },
            { raw: message('unread@globex.example', 'Re: Quick question', 'In-Reply-To: <orig.1@getacme.com>\r\nReferences: <root@getacme.com> <orig.1@getacme.com>\r\n'), flags: [], internaldate: '10-Nov-2026 10:00:00 +0000' },
          ],
        },
        '': { separator: '/', folders: { '[Gmail]': { flags: ['\\Noselect'], folders: { 'Sent Mail': { 'special-use': '\\Sent', messages: [] }, Spam: { 'special-use': '\\Junk', messages: [] } } } } },
      },
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    account = { host: '127.0.0.1', port: server.server.address().port, username: 'testuser', auth: { type: 'password', password: 'testpass' } };
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('finds the folders by SPECIAL-USE and reads headers incrementally by UID', async () => {
    const session = await imapflowConnector({ allowPlaintext: true }).connect(account);
    assert.deepEqual(await session.folders(), { inbox: 'INBOX', sent: '[Gmail]/Sent Mail', junk: '[Gmail]/Spam' });
    const opened = await session.open('INBOX');
    assert.equal(typeof opened.uidValidity, 'bigint');
    const all = [];
    for await (const summary of session.headersAfter('INBOX', 0)) all.push(summary);
    assert.deepEqual(all.map((entry) => [entry.uid, entry.messageId, entry.from, entry.subject]), [[1, '<read@globex.example>', 'priya@globex.example', 'Already read'], [2, '<unread@globex.example>', 'priya@globex.example', 'Re: Quick question']]);
    assert.deepEqual([all[1]!.inReplyTo, all[1]!.references], ['<orig.1@getacme.com>', ['<root@getacme.com>', '<orig.1@getacme.com>']]);
    const later = [];
    for await (const summary of session.headersAfter('INBOX', 1)) later.push(summary.uid);
    assert.deepEqual(later, [2]);
    await session.close();
  });

  it('fetches whole messages without marking them read (IT-20), appends to Sent and finds by Message-ID', async () => {
    const session = await imapflowConnector({ allowPlaintext: true }).connect(account);
    const raw = await session.fetchRaw('INBOX', 2);
    assert.match(raw!.toString(), /Body of unread@globex\.example/);

    // Look at the flags with a separate client, as the user's own mail app would.
    const observer = new ImapFlow({ host: account.host, port: account.port, secure: false, doSTARTTLS: false, auth: { user: 'testuser', pass: 'testpass' }, logger: false });
    await observer.connect();
    await observer.mailboxOpen('INBOX', { readOnly: true });
    const flags: Record<number, string[]> = {};
    for await (const entry of observer.fetch('1:*', { uid: true, flags: true }, { uid: true })) flags[entry.uid] = [...(entry.flags ?? [])];
    assert.deepEqual(flags, { 1: ['\\Seen'], 2: [] }, 'polling never changes \\Seen');
    await observer.logout();

    await session.append('[Gmail]/Sent Mail', Buffer.from(message('sent.1@getacme.com', 'Hello')), ['\\Seen']);
    const uid = await session.findByMessageId('[Gmail]/Sent Mail', '<sent.1@getacme.com>');
    assert.equal(uid, 1);
    assert.equal(await session.findByMessageId('[Gmail]/Sent Mail', '<missing@getacme.com>'), null);
    await session.remove('[Gmail]/Sent Mail', 1);
    assert.equal(await session.findByMessageId('[Gmail]/Sent Mail', '<sent.1@getacme.com>'), null);
    await session.close();
  });
});
