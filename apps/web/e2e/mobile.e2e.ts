// A phone (spec §15.20): every view fits 390 px without scrolling sideways, the sidebar is a drawer,
// and E2E-12: approve a draft and reply from the Thread view.

import { expect, expectNoSidewaysScroll, test } from './fixtures.ts';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });

test('every view fits the screen', async ({ page, seed }) => {
  const views = [
    '/',
    '/needs-you',
    '/inbox',
    `/threads/${seed.threads.priya}`,
    '/campaigns',
    `/campaigns/${seed.campaignId}`,
    `/campaigns/${seed.campaignId}?tab=board`,
    `/campaigns/${seed.campaignId}?tab=emails`,
    `/campaigns/${seed.campaignId}/build?step=goals`,
    '/contacts',
    `/contacts/${seed.contacts.priya}`,
    '/contacts/import',
    '/companies',
    '/lists',
    '/knowledge',
    '/deliverability',
    `/deliverability/domains/${seed.domainId}`,
    `/deliverability/mailboxes/${seed.mailboxId}`,
    '/settings',
    '/settings?section=api',
  ];
  for (const view of views) {
    await page.goto(view);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await expect(page.getByText('Loading…')).toHaveCount(0);
    await expectNoSidewaysScroll(page);
  }
});

test('the sidebar is a drawer behind the menu button', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();
  await page.getByRole('button', { name: 'Open the menu' }).tap();
  const drawer = page.getByRole('navigation', { name: 'Main' });
  await expect(drawer).toBeVisible();
  await drawer.getByRole('link', { name: 'Inbox' }).tap();
  await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
  await expect(drawer).toBeHidden();
});

test('E2E-12: approve a draft and reply from the Thread view', async ({ page, seed }) => {
  await page.goto(`/threads/${seed.threads.dana}`);
  const draft = page.getByRole('article', { name: /^Draft:/ });
  await draft.getByRole('button', { name: 'Approve and send' }).tap();
  await expect(draft).toBeHidden();

  const reply = page.getByRole('textbox', { name: 'Your reply' });
  await reply.tap();
  await reply.fill('And here is the order form, in case it helps.');
  await page.getByRole('form', { name: 'Reply' }).getByRole('button', { name: 'Send' }).tap();
  await expect(page.getByText('Sending.')).toBeVisible();
  await expect(page.getByText('And here is the order form, in case it helps.').first()).toBeVisible();
  await expectNoSidewaysScroll(page);
});
