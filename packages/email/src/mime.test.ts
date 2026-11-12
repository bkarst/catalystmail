import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { buildMime, messageIdFor, textMatchesHtml, textToHtml } from './mime.ts';

const headerBlock = (raw: string) => raw.slice(0, raw.indexOf('\r\n\r\n')).replace(/\r\n[ \t]+/g, ' ');
const header = (raw: string, name: string) => new RegExp(`^${name}: (.*)$`, 'im').exec(headerBlock(raw))?.[1];

describe('outbound MIME (§7.2, §19.5 conformance)', () => {
  const text = 'Hi Priya,\n\nHow does onboarding work at Globex?\nBook here: https://cal.com/acme/intro.\n\nAlex';

  it('builds multipart/alternative with an equivalent text part, a single recipient and no tool fingerprints', async () => {
    const html = textToHtml(text, { pixelUrl: 'https://go.getacme.com/t/o/abc.gif' });
    const raw = (
      await buildMime({
        from: { name: 'Alex Rivera', email: 'alex@getacme.com' },
        to: 'priya@globex.com',
        subject: 'Quick question',
        text,
        html,
        messageId: '<01jd.abc123@getacme.com>',
        listUnsubscribe: { url: 'https://go.getacme.com/u/tok', mailto: 'mailto:alex@getacme.com?subject=unsubscribe%20tok' },
        date: new Date('2026-11-10T17:00:00Z'),
      })
    ).toString();
    assert.equal(header(raw, 'From'), 'Alex Rivera <alex@getacme.com>');
    assert.equal(header(raw, 'To'), 'priya@globex.com');
    assert.equal(header(raw, 'Message-ID'), '<01jd.abc123@getacme.com>');
    assert.match(header(raw, 'Content-Type')!, /^multipart\/alternative/);
    assert.equal(header(raw, 'List-Unsubscribe'), '<https://go.getacme.com/u/tok>, <mailto:alex@getacme.com?subject=unsubscribe%20tok>');
    assert.equal(header(raw, 'List-Unsubscribe-Post'), 'List-Unsubscribe=One-Click');
    for (const forbidden of ['X-Mailer', 'Precedence', 'X-Catalyst', 'Cc', 'Bcc']) assert.equal(header(raw, forbidden), undefined, forbidden);
    assert.ok(!/nodemailer|_NmP|catalyst/i.test(raw), 'nothing names the software');
    assert.ok(raw.includes('Content-Type: text/plain') && raw.includes('Content-Type: text/html'));
    assert.ok(Buffer.byteLength(html) < 30 * 1024);
    assert.ok(textMatchesHtml(text, html));
    assert.equal((html.match(/<img/g) ?? []).length, 1, 'the pixel is the only image');
  });

  it('threads follow-ups and replies under the conversation', async () => {
    const raw = (
      await buildMime({
        from: { name: 'Alex', email: 'alex@getacme.com' },
        to: 'priya@globex.com',
        subject: 'Re: Quick question',
        text: 'Bumping this.',
        html: null,
        messageId: '<b@getacme.com>',
        inReplyTo: '<a@getacme.com>',
        references: ['<root@getacme.com>', '<a@getacme.com>'],
        date: new Date(),
      })
    ).toString();
    assert.equal(header(raw, 'In-Reply-To'), '<a@getacme.com>');
    assert.equal(header(raw, 'References'), '<root@getacme.com> <a@getacme.com>');
    assert.match(header(raw, 'Content-Type')!, /^text\/plain/);
  });

  it('puts Message-IDs on the sending domain, from the message ID', () => {
    const id = messageIdFor('msg_01jd3x5k8qf7tb9w2m4n6p8r0s', 'GetAcme.com', () => Buffer.from('a1b2c3d4e5f6', 'hex'));
    assert.equal(id, '<01jd3x5k8qf7tb9w2m4n6p8r0s.a1b2c3d4e5f6@getacme.com>');
  });

  it('turns text into minimal HTML: escaped, linked, line breaks kept, no pixel without tracking', () => {
    const html = textToHtml('a < b & c\nnext line\n\nsee https://x.example/p?q=1&r=2');
    assert.ok(html.includes('a &lt; b &amp; c<br>next line'));
    assert.ok(html.includes('<a href="https://x.example/p?q=1&amp;r=2">https://x.example/p?q=1&amp;r=2</a>'));
    assert.ok(!html.includes('<img'));
    assert.ok(!/<table/i.test(html));
  });
});
