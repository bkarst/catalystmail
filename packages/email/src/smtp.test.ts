import assert from 'node:assert/strict';
import { createHash, createVerify, generateKeyPairSync, type KeyObject } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import { SMTPServer } from 'smtp-server';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { buildMime } from './mime.ts';
import { classifySmtpReply, nodemailerTransport, type SmtpAccount } from './smtp.ts';

describe('SMTP replies (§7.2 step 6)', () => {
  it('sorts every kind of answer', () => {
    const kind = (code: number | null, response: string, errorCode: string | null = null) => classifySmtpReply({ code, response, errorCode }).kind;
    assert.equal(kind(250, '250 2.0.0 OK 1699 - gsmtp'), 'accepted');
    assert.equal(kind(null, '250 Accepted'), 'accepted');
    assert.equal(kind(451, '451 4.3.0 Temporary server error'), 'temporary');
    assert.equal(kind(null, 'Connection timeout', 'ETIMEDOUT'), 'temporary');
    assert.equal(kind(421, '421 4.7.0 Try again later, closing connection'), 'quota');
    assert.equal(kind(450, '450 4.7.28 Our system has detected an unusual rate'), 'quota');
    assert.equal(kind(550, '550 5.4.5 Daily user sending quota exceeded'), 'quota');
    assert.equal(kind(550, '550 5.1.1 The email account that you tried to reach does not exist'), 'recipient_rejected');
    assert.equal(kind(553, '553 5.1.3 Bad recipient address syntax'), 'recipient_rejected');
    assert.equal(kind(550, '550 5.7.1 Message rejected due to policy'), 'rejected');
    assert.equal(kind(535, '535 5.7.8 Username and Password not accepted'), 'auth_failed');
    const bounce = classifySmtpReply({ code: 550, response: '550 5.1.1 User unknown' });
    assert.deepEqual(bounce, { kind: 'recipient_rejected', response: '550 5.1.1 User unknown', status: '5.1.1' });
  });
});

describe('Nodemailer transport against an SMTP server', () => {
  const received: { from: string; to: string[]; data: string; user: string }[] = [];
  let server: SMTPServer;
  let account: SmtpAccount;

  beforeAll(async () => {
    server = new SMTPServer({
      secure: false,
      disabledCommands: ['STARTTLS'],
      authOptional: false,
      allowInsecureAuth: true,
      onAuth(auth, _session, callback) {
        if (auth.username === 'alex@getacme.com' && auth.password === 'app-password') return callback(null, { user: auth.username });
        return callback(Object.assign(new Error('Invalid credentials'), { responseCode: 535 }));
      },
      onRcptTo(address, _session, callback) {
        if (address.address === 'nobody@globex.example') return callback(Object.assign(new Error('5.1.1 User unknown'), { responseCode: 550 }));
        callback();
      },
      onData(stream, session, callback) {
        let data = '';
        stream.on('data', (chunk) => (data += chunk));
        stream.on('end', () => {
          received.push({ from: session.envelope.mailFrom ? (session.envelope.mailFrom as { address: string }).address : '', to: session.envelope.rcptTo.map((entry) => entry.address), data, user: String(session.user) });
          callback();
        });
      },
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.server.address() as AddressInfo).port;
    // STARTTLS is disabled on the test server, so "starttls" here means plain SMTP on that port.
    account = { key: 'mbx_test', host: '127.0.0.1', port, secure: 'starttls', username: 'alex@getacme.com', auth: { type: 'password', password: 'app-password' } };
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('submits the raw message to exactly one recipient, and reports refusals', async () => {
    const transport = nodemailerTransport({ connectionTimeoutMs: 5000, allowPlaintext: true });
    const raw = await buildMime({ from: { name: 'Alex', email: 'alex@getacme.com' }, to: 'priya@globex.example', subject: 'Hello', text: 'Hi Priya', html: null, messageId: '<x.1@getacme.com>', date: new Date() });
    const accepted = await transport.submit(account, { from: 'alex@getacme.com', to: 'priya@globex.example' }, raw);
    assert.equal(accepted.kind, 'accepted');
    assert.equal(received.length, 1);
    assert.deepEqual([received[0]!.from, received[0]!.to, received[0]!.user], ['alex@getacme.com', ['priya@globex.example'], 'alex@getacme.com']);
    assert.ok(received[0]!.data.includes('Message-ID: <x.1@getacme.com>'));

    const bounced = await transport.submit(account, { from: 'alex@getacme.com', to: 'nobody@globex.example' }, raw);
    assert.equal(bounced.kind, 'recipient_rejected');
    const badLogin = await transport.submit({ ...account, key: 'other', auth: { type: 'password', password: 'wrong' } }, { from: 'alex@getacme.com', to: 'priya@globex.example' }, raw);
    assert.equal(badLogin.kind, 'auth_failed');
    await assert.rejects(transport.verify({ ...account, auth: { type: 'password', password: 'wrong' } }));
    await transport.verify(account);
    await transport.close();
  });

  it('signs DKIM with the mailbox’s own key when asked, and the signature verifies (§7.1)', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const transport = nodemailerTransport({ connectionTimeoutMs: 5000, allowPlaintext: true });
    const raw = await buildMime({ from: { name: 'Alex', email: 'alex@getacme.com' }, to: 'priya@globex.example', subject: 'Signed', text: 'Hi Priya,\n\nA signed one.', html: '<p>Hi Priya,</p><p>A signed one.</p>', messageId: '<x.2@getacme.com>', date: new Date() });
    const signed = { ...account, key: 'mbx_dkim', dkim: { domainName: 'getacme.com', keySelector: 'catalyst', privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() } };
    assert.equal((await transport.submit(signed, { from: 'alex@getacme.com', to: 'priya@globex.example' }, raw)).kind, 'accepted');
    await transport.close();
    const data = received.at(-1)!.data;
    const tags = verifyDkim(data, publicKey);
    assert.deepEqual([tags.d, tags.s, tags.a], ['getacme.com', 'catalyst', 'rsa-sha256']);
    assert.ok(!received[0]!.data.includes('DKIM-Signature'), 'unsigned without a key');
    assert.throws(() => verifyDkim(data.replace('A signed one.', 'A changed one.'), publicKey), /body hash/);
  });
});

/** A relaxed/relaxed rsa-sha256 DKIM check (RFC 6376 §3.4, §3.7), independent of Nodemailer's signer. */
function verifyDkim(message: string, publicKey: KeyObject): Record<string, string> {
  const split = message.indexOf('\r\n\r\n');
  const head = message.slice(0, split + 2);
  const body = message.slice(split + 4);
  const fields = head.split(/\r\n(?![ \t])/).filter(Boolean);
  const signature = fields.find((field) => /^dkim-signature:/i.test(field));
  if (!signature) throw new Error('no DKIM-Signature');
  const value = signature.slice(signature.indexOf(':') + 1);
  const tags = Object.fromEntries(value.replace(/\s+/g, '').split(';').filter(Boolean).map((tag) => [tag.slice(0, tag.indexOf('=')), tag.slice(tag.indexOf('=') + 1)]));
  assert.equal(tags.c, 'relaxed/relaxed');
  const relaxedBody = body.split('\r\n').map((line) => line.replace(/[ \t]+/g, ' ').replace(/ +$/, '')).join('\r\n').replace(/(\r\n)*$/, '') + '\r\n';
  if (createHash('sha256').update(relaxedBody).digest('base64') !== tags.bh) throw new Error('body hash does not match');
  const relaxedHeader = (field: string) => `${field.slice(0, field.indexOf(':')).trim().toLowerCase()}:${field.slice(field.indexOf(':') + 1).replace(/\r\n/g, '').replace(/[ \t]+/g, ' ').trim()}`;
  const remaining = [...fields];
  const signedHeaders = tags.h!.split(':').flatMap((name) => {
    const index = remaining.map((field) => field.slice(0, field.indexOf(':')).trim().toLowerCase()).lastIndexOf(name.toLowerCase());
    return index === -1 ? [] : [relaxedHeader(remaining.splice(index, 1)[0]!)];
  });
  // The signature header itself is signed with its b= value empty, and without a trailing CRLF.
  const unsigned = relaxedHeader(signature).replace(/([;:]\s*)b=[^;]*/, '$1b=');
  const input = [...signedHeaders, unsigned].join('\r\n');
  if (!createVerify('RSA-SHA256').update(input).verify(publicKey, tags.b!, 'base64')) throw new Error('signature does not verify');
  return tags as Record<string, string>;
}
