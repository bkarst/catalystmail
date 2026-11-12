import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { hasBlockers, lintMessage, type LintInput } from './linter.ts';

const ADDRESS = '500 Howard St, San Francisco, CA 94105';
const clean = (overrides: Partial<LintInput> = {}): LintInput => ({
  subject: 'Quick question about Globex onboarding',
  text: `Hi Priya,\n\nSaw that Globex is hiring ops managers. Worth a short call next week?\n\nAlex\n\nIf you'd rather not hear from me, just reply "no thanks". ${ADDRESS}`,
  html: '<p>Hi Priya,</p>',
  links: [],
  imageCount: 0,
  attachmentCount: 0,
  isFirstTouch: true,
  complianceRequired: true,
  hasUnsubscribeMechanism: true,
  physicalAddress: ADDRESS,
  textMatchesHtml: true,
  ...overrides,
});
const rules = (overrides: Partial<LintInput>) => lintMessage(clean(overrides)).map((finding) => `${finding.severity}:${finding.rule}`);
const link = (text: string, href: string, isUnsubscribe = false) => ({ text, href, isUnsubscribe });

describe('content linter (§8.7)', () => {
  it('passes a short, plain first email', () => {
    assert.deepEqual(lintMessage(clean()), []);
    assert.equal(hasBlockers(lintMessage(clean())), false);
  });

  it('blocks unresolved template variables anywhere', () => {
    assert.deepEqual(rules({ subject: 'Hi {{contact.first_name}}' }), ['blocker:unresolved_variable']);
    assert.deepEqual(rules({ html: '<p>{% if x %}</p>' }), ['blocker:unresolved_variable']);
    assert.equal(hasBlockers(lintMessage(clean({ subject: 'Hi {{contact.first_name}}' }))), true);
  });

  it('blocks a missing unsubscribe mechanism or address only when compliance requires them', () => {
    assert.deepEqual(rules({ hasUnsubscribeMechanism: false }), ['blocker:missing_unsubscribe']);
    assert.deepEqual(rules({ text: 'Hi Priya, worth a call?' }), ['blocker:missing_physical_address']);
    assert.deepEqual(rules({ physicalAddress: null }), ['blocker:missing_physical_address']);
    assert.deepEqual(rules({ complianceRequired: false, hasUnsubscribeMechanism: false, physicalAddress: null }), []);
  });

  it('blocks link text that shows one site and goes to another', () => {
    assert.deepEqual(rules({ links: [link('acme.com/pricing', 'https://evil.example/pricing')] }), ['blocker:link_text_mismatch']);
    assert.deepEqual(rules({ links: [link('https://www.acme.com', 'https://go.acme.com/x')] }), []);
    assert.deepEqual(rules({ links: [link('our pricing page', 'https://acme.com/pricing')] }), []);
  });

  it('blocks URL shorteners, IP-address links and invalid links', () => {
    assert.deepEqual(rules({ links: [link('book a call', 'https://bit.ly/3abc')] }), ['blocker:url_shortener']);
    assert.deepEqual(rules({ links: [link('book a call', 'http://203.0.113.9/book')] }), ['blocker:ip_address_url']);
    assert.deepEqual(rules({ links: [link('book a call', 'http://')] }), ['blocker:invalid_link']);
    assert.deepEqual(rules({ links: [link('book a call', 'https://rabbit.ly/x')] }), []);
  });

  it('limits a first email to 1 link and no attachments, without counting the unsubscribe link', () => {
    const booking = link('book a call', 'https://cal.com/alex');
    const pricing = link('pricing', 'https://acme.com/pricing');
    const unsubscribe = link('click here to opt out', 'https://go.getacme.com/u/abc', true);
    assert.deepEqual(rules({ links: [booking, unsubscribe] }), []);
    assert.deepEqual(rules({ links: [booking, pricing] }), ['warning:first_touch_links']);
    assert.deepEqual(rules({ links: [booking, pricing], isFirstTouch: false }), []);
    assert.deepEqual(rules({ attachmentCount: 1 }), ['blocker:first_touch_attachment']);
    assert.deepEqual(rules({ attachmentCount: 1, isFirstTouch: false }), []);
  });

  it('warns above 2 links on any message', () => {
    const three = [1, 2, 3].map((n) => link(`page ${n}`, `https://acme.com/${n}`));
    assert.deepEqual(rules({ links: three, isFirstTouch: false }), ['warning:too_many_links']);
    assert.deepEqual(rules({ links: three }), ['warning:first_touch_links', 'warning:too_many_links']);
  });

  it('blocks a first email dressed up as a reply or forward', () => {
    assert.deepEqual(rules({ subject: 'Re: our conversation' }), ['blocker:deceptive_subject']);
    assert.deepEqual(rules({ subject: 'Fwd: proposal' }), ['blocker:deceptive_subject']);
    assert.deepEqual(rules({ subject: 'Re: our conversation', isFirstTouch: false }), []);
  });

  it('blocks a missing or mismatched plain-text part', () => {
    assert.deepEqual(rules({ text: '  ', complianceRequired: false }), ['blocker:missing_text_part']);
    assert.deepEqual(rules({ textMatchesHtml: false }), ['blocker:text_html_mismatch']);
    assert.deepEqual(rules({ textMatchesHtml: false, html: null }), []);
  });

  it('applies the SpamAssassin thresholds when a score is given', () => {
    assert.deepEqual(rules({ spamAssassinScore: 2.9 }), []);
    assert.deepEqual(rules({ spamAssassinScore: 3 }), ['warning:spamassassin']);
    assert.deepEqual(rules({ spamAssassinScore: 5 }), ['blocker:spamassassin']);
    assert.deepEqual(rules({ spamAssassinScore: null }), []);
  });

  it('warns about images and length', () => {
    assert.deepEqual(rules({ imageCount: 1 }), ['warning:images']);
    const body = (count: number) => `${Array.from({ length: count }, () => 'word').join(' ')} ${ADDRESS}`;
    assert.deepEqual(rules({ text: body(150) }), ['warning:first_touch_too_long']);
    assert.deepEqual(rules({ text: body(150), isFirstTouch: false }), []);
    assert.deepEqual(rules({ text: body(250), isFirstTouch: false }), ['warning:too_long']);
    assert.deepEqual(rules({ text: body(130) }), []);
  });

  it('warns about subject length, shouting, exclamation marks, currency spam and trigger phrases', () => {
    assert.deepEqual(rules({ subject: 'x'.repeat(61) }), ['warning:subject_too_long']);
    assert.deepEqual(rules({ subject: 'x'.repeat(60) }), []);
    assert.deepEqual(rules({ subject: 'HUGE NEWS ABOUT YOUR ONBOARDING' }), ['warning:all_caps']);
    assert.deepEqual(rules({ subject: 'Does Globex use SAML and SCIM' }), []);
    assert.deepEqual(rules({ subject: 'Quick question! Really!' }), ['warning:exclamation_marks']);
    assert.deepEqual(rules({ subject: 'Quick question!' }), []);
    assert.deepEqual(rules({ subject: 'Save $$$ on onboarding' }), ['warning:currency_spam']);
    assert.deepEqual(rules({ subject: 'Act now for a risk-free trial' }), ['warning:spam_phrases']);
    assert.deepEqual(rules({ subject: 'We guaranteed nothing to the winners' }), []);
  });
});
