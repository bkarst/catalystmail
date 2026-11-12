import assert from 'node:assert/strict';

import { textToHtml } from '@catalyst/email';
import { describe, it } from 'vitest';

import { planTrackedLinks } from './links.ts';

describe('click tracking (§9.3)', () => {
  const text = 'Book here: https://cal.getacme.com/alex\n\nOr read https://getacme.com/sso.\n\nUnsubscribe: https://go.getacme.com/u/abc123';
  it('rewrites every link but the unsubscribe one, keyed to the campaign’s links, keeping the visible text', () => {
    const plan = planTrackedLinks('msg_1', text, { enabled: true, host: 'go.getacme.com', secret: 's3cret', links: { booking: 'https://cal.getacme.com/alex' } });
    assert.deepEqual(plan.rows.map((row) => [row.position, row.original_url, row.link_key]), [[0, 'https://cal.getacme.com/alex', 'booking'], [1, 'https://getacme.com/sso', null]]);
    const html = textToHtml(text, { href: plan.href });
    assert.match(html, /<a href="https:\/\/go\.getacme\.com\/t\/c\/[A-Za-z0-9_-]+">https:\/\/cal\.getacme\.com\/alex<\/a>/);
    assert.match(html, /<a href="https:\/\/go\.getacme\.com\/u\/abc123">/, 'unsubscribe untouched');
  });

  it('does nothing when off, or without the domain’s own tracking host', () => {
    assert.deepEqual(planTrackedLinks('msg_1', text, { enabled: false, host: 'go.getacme.com', secret: 's', links: {} }), { href: null, rows: [] });
    assert.deepEqual(planTrackedLinks('msg_1', text, { enabled: true, host: null, secret: 's', links: {} }), { href: null, rows: [] });
  });
});
