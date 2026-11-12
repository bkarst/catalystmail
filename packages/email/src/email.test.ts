import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
  classifyDeterministically,
  originalMessageId,
  parseDeliveryStatus,
  type InboundSignals,
} from './inbound-classification.ts';
import { looksLikeReply, matchInbound, shouldFetchBody, type InboundEnvelope, type MatchCandidates } from './matching.ts';
import { hasReplyPrefix, normalizeSubject, subjectsMatch } from './subject.ts';
import { signTrackingToken, verifyTrackingToken } from './tracking-token.ts';

describe('subject normalisation (§7.4)', () => {
  it('strips stacked reply, forward and external-sender prefixes', () => {
    assert.equal(normalizeSubject('Re: RE: AW: Fwd: [EXT] Quick question about Globex'), 'Quick question about Globex');
    assert.equal(normalizeSubject('RE[2]: Quick question'), 'Quick question');
    assert.equal(normalizeSubject('Re(3): Quick question'), 'Quick question');
    assert.equal(normalizeSubject('SV : Quick question'), 'Quick question');
    assert.equal(normalizeSubject('[EXTERNAL] WG: TR: Quick question'), 'Quick question');
  });

  it('collapses whitespace and leaves ordinary words alone', () => {
    assert.equal(normalizeSubject('  Quick   question \t about\nGlobex '), 'Quick question about Globex');
    assert.equal(normalizeSubject('Regarding: your trial'), 'Regarding: your trial');
    assert.equal(normalizeSubject('Reminder: call on Thursday'), 'Reminder: call on Thursday');
    assert.equal(normalizeSubject('Re:'), '');
  });

  it('compares subjects without prefixes or letter case', () => {
    assert.equal(subjectsMatch('RE: quick QUESTION', 'Quick question'), true);
    assert.equal(subjectsMatch('Re: Another topic', 'Quick question'), false);
    assert.equal(subjectsMatch('Re:', ''), false);
  });

  it('recognises reply prefixes but not forwards', () => {
    assert.equal(hasReplyPrefix('Re: Quick question'), true);
    assert.equal(hasReplyPrefix('[EXT] AW: Quick question'), true);
    assert.equal(hasReplyPrefix('Fwd: Quick question'), false);
    assert.equal(hasReplyPrefix('Quick question'), false);
  });
});

describe('thread matching (§7.4)', () => {
  const now = new Date('2026-11-10T18:00:00Z');
  const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);
  const envelope = (overrides: Partial<InboundEnvelope> = {}): InboundEnvelope => ({
    subject: 'Re: Quick question',
    inReplyTo: '<abc@getacme.com>',
    references: ['<abc@getacme.com>'],
    isReport: false,
    ...overrides,
  });
  const candidates = (overrides: Partial<MatchCandidates> = {}): MatchCandidates => ({
    duplicate: false,
    threadByHeaders: null,
    threadByReportOriginal: null,
    senderThreads: null,
    ...overrides,
  });
  const quickQuestion = { threadId: 'thr_quick', subject: 'Quick question', lastActivityAt: daysAgo(90) };
  const other = { threadId: 'thr_other', subject: 'Pricing for 2027', lastActivityAt: daysAgo(10) };

  it('1. skips a message already stored', () => {
    assert.deepEqual(matchInbound(envelope(), candidates({ duplicate: true, threadByHeaders: 'thr_1' }), now), { outcome: 'duplicate' });
  });

  it('2. matches by In-Reply-To or References first', () => {
    const result = matchInbound(envelope(), candidates({ threadByHeaders: 'thr_1', senderThreads: [other] }), now);
    assert.deepEqual(result, { outcome: 'matched', threadId: 'thr_1', method: 'headers' });
  });

  it('3. matches a bounce by the original message inside the report', () => {
    const result = matchInbound(envelope({ isReport: true, inReplyTo: null, references: [] }), candidates({ threadByReportOriginal: 'thr_2' }), now);
    assert.deepEqual(result, { outcome: 'matched', threadId: 'thr_2', method: 'dsn_original' });
  });

  it('4. matches a known sender by subject, even on an old thread', () => {
    const result = matchInbound(envelope({ inReplyTo: null, references: [] }), candidates({ senderThreads: [quickQuestion, other] }), now);
    assert.deepEqual(result, { outcome: 'matched', threadId: 'thr_quick', method: 'subject_sender' });
  });

  it('5. falls back to the most recent thread with activity in the last 60 days', () => {
    const older = { threadId: 'thr_older', subject: 'Something else', lastActivityAt: daysAgo(40) };
    const result = matchInbound(envelope({ subject: 'New topic' }), candidates({ senderThreads: [older, other] }), now);
    assert.deepEqual(result, { outcome: 'matched', threadId: 'thr_other', method: 'sender_fallback' });
    const edge = { threadId: 'thr_edge', subject: 'Something else', lastActivityAt: daysAgo(60) };
    assert.equal(matchInbound(envelope({ subject: 'New topic' }), candidates({ senderThreads: [edge] }), now).outcome, 'matched');
  });

  it('6. stores mail from a known contact that matches nothing, escalating only if it looks like a reply', () => {
    const stale = { threadId: 'thr_stale', subject: 'Something else', lastActivityAt: daysAgo(61) };
    assert.deepEqual(matchInbound(envelope({ subject: 'Re: New topic' }), candidates({ senderThreads: [stale] }), now), {
      outcome: 'unmatched', raiseUnmatchedReply: true,
    });
    assert.deepEqual(matchInbound(envelope({ subject: 'Hello', inReplyTo: null, references: [] }), candidates({ senderThreads: [] }), now), {
      outcome: 'unmatched', raiseUnmatchedReply: false,
    });
  });

  it('7. ignores unknown senders and reports about mail that is not ours', () => {
    assert.deepEqual(matchInbound(envelope(), candidates(), now), { outcome: 'ignored' });
    assert.deepEqual(matchInbound(envelope({ isReport: true }), candidates({ senderThreads: [other] }), now), { outcome: 'ignored' });
  });

  it('knows what a reply looks like', () => {
    assert.equal(looksLikeReply(envelope({ subject: 'Hello', inReplyTo: null, references: [] })), false);
    assert.equal(looksLikeReply(envelope({ subject: 'Hello', inReplyTo: null, references: ['<x@y>'] })), true);
    assert.equal(looksLikeReply(envelope({ subject: 'AW: Hello', inReplyTo: null, references: [] })), true);
  });

  it('fetches a body only for mail that concerns Catalyst (§7.3)', () => {
    const fetch = (overrides: Partial<Parameters<typeof shouldFetchBody>[0]>) =>
      shouldFetchBody({ folder: 'inbox', match: { outcome: 'ignored' }, senderIsKnownContact: false, isReport: false, ...overrides });
    assert.equal(fetch({}), false);
    assert.equal(fetch({ match: { outcome: 'matched', threadId: 'thr_1', method: 'headers' } }), true);
    assert.equal(fetch({ senderIsKnownContact: true, match: { outcome: 'unmatched', raiseUnmatchedReply: false } }), true);
    assert.equal(fetch({ isReport: true }), true);
    assert.equal(fetch({ match: { outcome: 'duplicate' }, senderIsKnownContact: true }), false);
    assert.equal(fetch({ folder: 'sent', senderIsKnownContact: true }), false);
    assert.equal(fetch({ folder: 'sent', match: { outcome: 'matched', threadId: 'thr_1', method: 'headers' } }), true);
  });
});

describe('delivery-status parsing', () => {
  const part = [
    'Reporting-MTA: dns; googlemail.com',
    '',
    'Final-Recipient: rfc822; Priya@Globex.com',
    'Action: failed',
    'Status: 5.1.1',
    'Diagnostic-Code: smtp; 550-5.1.1 The email account that you tried to reach does not exist.',
  ].join('\r\n');

  it('reads status, action and recipient', () => {
    assert.deepEqual(parseDeliveryStatus(part), { status: '5.1.1', action: 'failed', finalRecipient: 'priya@globex.com' });
    assert.deepEqual(parseDeliveryStatus('nothing useful'), { status: null, action: null, finalRecipient: null });
  });

  it('finds the original Message-ID, including when it is folded onto the next line', () => {
    assert.equal(originalMessageId('Subject: Hi\r\nMessage-ID: <abc.123@getacme.com>\r\nTo: x@y.z'), '<abc.123@getacme.com>');
    assert.equal(originalMessageId('Message-Id:\r\n <abc.123@getacme.com>\r\n'), '<abc.123@getacme.com>');
    assert.equal(originalMessageId('Subject: Hi'), null);
  });
});

describe('deterministic inbound classification (§7.5)', () => {
  const signals = (overrides: Partial<InboundSignals> = {}): InboundSignals => ({
    headers: {},
    fromEmail: 'priya@globex.com',
    subject: 'Re: Quick question',
    strippedText: 'Looks interesting. Do you support SAML SSO and SCIM?',
    ...overrides,
  });
  const kind = (overrides: Partial<InboundSignals>) => classifyDeterministically(signals(overrides))?.kind ?? null;
  const report = (type: string) => ({ 'content-type': `multipart/report; report-type=${type}; boundary="b1"` });

  it('leaves an ordinary reply to the model', () => {
    assert.equal(classifyDeterministically(signals()), null);
  });

  it('reads hard and soft bounces from the DSN status', () => {
    const hard = classifyDeterministically(signals({ headers: report('delivery-status'), deliveryStatusPart: 'Action: failed\nStatus: 5.1.1' }));
    assert.deepEqual(hard, { kind: 'bounce_hard', rule: 'dsn_status', dsnStatus: '5.1.1' });
    assert.equal(kind({ headers: report('delivery-status'), deliveryStatusPart: 'Action: delayed\nStatus: 4.2.2' }), 'bounce_soft');
    assert.equal(kind({ headers: report('delivery-status'), deliveryStatusPart: 'Action: delivered\nStatus: 2.0.0' }), 'auto_reply');
  });

  it('reads a feedback report as a complaint', () => {
    assert.equal(kind({ headers: report('feedback-report') }), 'complaint');
  });

  it('catches non-standard bounces by sender and subject', () => {
    assert.equal(kind({ fromEmail: 'MAILER-DAEMON@mx.example.net', subject: 'Undeliverable: Quick question' }), 'bounce_hard');
    assert.equal(kind({ fromEmail: 'postmaster@example.net', subject: 'Delivery Status Notification (Failure)' }), 'bounce_hard');
    assert.equal(kind({ fromEmail: 'postmaster@example.net', subject: 'Delivery Status Notification (Delay)' }), 'bounce_soft');
    assert.equal(kind({ fromEmail: 'postmaster@globex.com', subject: 'Re: Quick question' }), null);
    assert.equal(kind({ subject: 'Undeliverable: Quick question' }), null);
  });

  it('recognises automatic replies from their headers', () => {
    assert.equal(kind({ headers: { 'auto-submitted': 'auto-replied' } }), 'auto_reply');
    assert.equal(kind({ headers: { 'auto-submitted': 'no' } }), null);
    assert.equal(kind({ headers: { 'x-autoreply': 'yes' } }), 'auto_reply');
    assert.equal(kind({ headers: { 'x-autorespond': '' } }), 'auto_reply');
    assert.equal(kind({ headers: { 'x-auto-response-suppress': 'All' } }), 'auto_reply');
    assert.equal(kind({ headers: { precedence: 'auto_reply' } }), 'auto_reply');
    assert.equal(kind({ headers: { precedence: 'list' } }), null);
  });

  it('recognises out-of-office and automatic-reply subjects in seven languages', () => {
    const outOfOffice = [
      'Out of Office: Re: Quick question',
      'Abwesenheitsnotiz: Quick question',
      'Absence du bureau',
      'Fuera de la oficina',
      'Fora do escritório',
      'Afwezigheid: Quick question',
      'Fuori ufficio',
    ];
    for (const subject of outOfOffice) assert.equal(kind({ subject }), 'out_of_office', subject);
    const automatic = ['Automatic reply: Quick question', 'Automatische Antwort: Quick question', 'Réponse automatique : Quick question', 'Respuesta automática', 'Risposta automatica'];
    for (const subject of automatic) assert.equal(kind({ subject }), 'auto_reply', subject);
    assert.equal(kind({ subject: 'Out of office', headers: { 'auto-submitted': 'auto-replied' } }), 'out_of_office');
  });

  it('acts on high-precision unsubscribe phrases', () => {
    const clear = [
      'unsubscribe',
      'Please remove me.',
      'STOP emailing me!',
      'Take me off your list please',
      'Please remove me from your mailing list',
      'Thanks but no. Remove me from this.',
    ];
    for (const strippedText of clear) assert.equal(kind({ strippedText }), 'unsubscribe_request', strippedText);
    assert.equal(kind({ strippedText: '', subject: 'unsubscribe' }), 'unsubscribe_request');
  });

  it('leaves ambiguous wording to the model', () => {
    const ambiguous = [
      // A negation or a question next to the phrase is enough to hand it over.
      'Not interested, remove me',
      'How do I unsubscribe?',
      "I don't want to unsubscribe, I just have a question",
      'Maybe later, not now please',
      'We looked at this last year and our team decided to unsubscribe from the old tool, so the timing is good. Can you send pricing for 40 seats and tell me about onboarding?',
    ];
    for (const strippedText of ambiguous) assert.equal(kind({ strippedText }), null, strippedText);
  });
});

describe('tracking tokens (§9.1)', () => {
  const secret = 'test-signing-secret';
  const id = 'msg_01jd3x5k8qf7tb9w2m4n6p8r0s';

  it('round-trips an ID in URL-safe characters', () => {
    const token = signTrackingToken(id, secret);
    assert.match(token, /^[A-Za-z0-9_-]+$/);
    assert.equal(verifyTrackingToken(token, secret), id);
    assert.equal(signTrackingToken(id, secret), token);
  });

  it('rejects tampering, the wrong secret and malformed input alike', () => {
    const token = signTrackingToken(id, secret);
    const flipped = token.slice(0, 5) + (token[5] === 'A' ? 'B' : 'A') + token.slice(6);
    const otherIdSameMac = Buffer.concat([Buffer.from('msg_someone_else'), Buffer.from(token, 'base64url').subarray(-12)]).toString('base64url');
    for (const bad of [flipped, otherIdSameMac, token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A'), '', 'short', 'not a token!', '....']) {
      assert.equal(verifyTrackingToken(bad, secret), null, bad);
    }
    assert.equal(verifyTrackingToken(token, 'another-secret'), null);
    assert.throws(() => signTrackingToken('', secret), RangeError);
  });
});
