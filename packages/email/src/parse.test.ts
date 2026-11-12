import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { classifyDeterministically } from './inbound-classification.ts';
import { htmlToText, parseEmail, stripReply } from './parse.ts';

const mime = (lines: string[]) => Buffer.from(lines.join('\r\n'));

describe('reply stripping (§7.5, §19.2)', () => {
  it('removes Gmail, Apple Mail and Thunderbird quote headers and quoted lines', () => {
    assert.equal(stripReply('Sounds good, Thursday works.\n\nOn Tue, Nov 10, 2026 at 9:14 AM Alex Rivera <alex@getacme.com> wrote:\n> Hi Priya,\n> How about a call?'), 'Sounds good, Thursday works.');
    assert.equal(stripReply('Yes please.\n\nOn 10 Nov 2026, at 09:14, Alex <alex@getacme.com>\nwrote:\n\n> Hi'), 'Yes please.');
    assert.equal(stripReply('Ja, gerne.\n\nAm Di., 10. Nov. 2026 um 09:14 Uhr schrieb Alex <alex@getacme.com>:\n> Hallo'), 'Ja, gerne.');
  });

  it('removes Outlook "From/Sent" blocks but keeps a "From:" that is part of the reply', () => {
    const outlook = 'Can you send pricing?\n\nFrom: Alex Rivera <alex@getacme.com>\nSent: Tuesday, November 10, 2026 9:14 AM\nTo: Priya\nSubject: Quick question\n\nHi Priya';
    assert.equal(stripReply(outlook), 'Can you send pricing?');
    assert.equal(stripReply('-----Original Message-----\nold text'), '');
    assert.equal(stripReply('From: our legal team, a question.\nCan you sign a DPA?'), 'From: our legal team, a question.\nCan you sign a DPA?');
  });

  it('cuts the signature delimiter and phone footers, and inline answers keep their text', () => {
    assert.equal(stripReply('Sure.\n\n-- \nPriya Natarajan\nVP Ops'), 'Sure.');
    assert.equal(stripReply('Sure.\n\nSent from my iPhone'), 'Sure.');
    assert.equal(stripReply('> Do you have SSO?\nYes we need SAML.\n> And SCIM?\nSCIM too.'), 'Yes we need SAML.\nSCIM too.');
  });

  it('drops Gmail and Outlook quote blocks from HTML-only mail', () => {
    assert.equal(htmlToText('<div>Looks interesting.<br>Do you support SSO?</div><div class="gmail_quote">On Tue … wrote:<blockquote>old</blockquote></div>'), 'Looks interesting.\nDo you support SSO?');
    assert.equal(htmlToText('<p>Yes &amp; thanks</p><div id="divRplyFwdMsg">From: Alex</div>'), 'Yes & thanks');
  });
});

describe('parsing inbound mail (§7.3–§7.5)', () => {
  it('reads a human reply: threading headers, addresses and the stripped text', async () => {
    const parsed = await parseEmail(
      mime([
        'From: Priya Natarajan <Priya@Globex.example>',
        'To: Alex Rivera <alex@getacme.com>',
        'Cc: dana@globex.example',
        'Subject: Re: Quick question',
        'Message-ID: <reply1@globex.example>',
        'In-Reply-To: <orig.1@getacme.com>',
        'References: <root.0@getacme.com> <orig.1@getacme.com>',
        'Date: Tue, 10 Nov 2026 17:52:00 +0000',
        'Content-Type: text/plain; charset=utf-8',
        '',
        'Do you support SAML SSO?',
        '',
        'On Tue, Nov 10, 2026 at 9:14 AM Alex Rivera <alex@getacme.com> wrote:',
        '> Hi Priya',
      ]),
    );
    assert.deepEqual(
      [parsed.messageId, parsed.inReplyTo, parsed.references, parsed.from, parsed.to, parsed.cc, parsed.strippedText, parsed.isReport],
      ['<reply1@globex.example>', '<orig.1@getacme.com>', ['<root.0@getacme.com>', '<orig.1@getacme.com>'], { email: 'priya@globex.example', name: 'Priya Natarajan' }, ['alex@getacme.com'], ['dana@globex.example'], 'Do you support SAML SSO?', false],
    );
    assert.equal(classifyDeterministically({ headers: parsed.headers, fromEmail: parsed.from!.email, subject: parsed.subject, strippedText: parsed.strippedText, deliveryStatusPart: parsed.deliveryStatusPart }), null);
  });

  it('reads a Gmail bounce: the delivery status and the original message it is about', async () => {
    const parsed = await parseEmail(
      mime([
        'From: Mail Delivery Subsystem <mailer-daemon@googlemail.com>',
        'To: alex@getacme.com',
        'Subject: Delivery Status Notification (Failure)',
        'Message-ID: <dsn1@mx.google.com>',
        'MIME-Version: 1.0',
        'Content-Type: multipart/report; report-type=delivery-status; boundary="b1"',
        '',
        '--b1',
        'Content-Type: text/plain; charset=UTF-8',
        '',
        "Address not found.",
        '--b1',
        'Content-Type: message/delivery-status',
        '',
        'Reporting-MTA: dns; googlemail.com',
        '',
        'Final-Recipient: rfc822; nobody@globex.example',
        'Action: failed',
        'Status: 5.1.1',
        '--b1',
        'Content-Type: text/rfc822-headers',
        '',
        'Message-ID: <orig.123@getacme.com>',
        'Subject: Quick question',
        '--b1--',
      ]),
    );
    assert.equal(parsed.isReport, true);
    assert.match(parsed.deliveryStatusPart!, /Status: 5\.1\.1/);
    assert.match(parsed.embeddedHeaders!, /<orig\.123@getacme\.com>/);
    const classified = classifyDeterministically({ headers: parsed.headers, fromEmail: parsed.from!.email, subject: parsed.subject, strippedText: parsed.strippedText, deliveryStatusPart: parsed.deliveryStatusPart });
    assert.deepEqual([classified?.kind, classified?.dsnStatus], ['bounce_hard', '5.1.1']);
  });

  it('recognises an out-of-office reply by its headers', async () => {
    const parsed = await parseEmail(mime(['From: priya@globex.example', 'To: alex@getacme.com', 'Subject: Automatic reply: Quick question', 'Auto-Submitted: auto-replied', 'Message-ID: <ooo@globex.example>', '', 'I am out until 20 November.']));
    assert.equal(classifyDeterministically({ headers: parsed.headers, fromEmail: parsed.from!.email, subject: parsed.subject, strippedText: parsed.strippedText })?.kind, 'auto_reply');
  });
});
