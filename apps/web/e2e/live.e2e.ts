// Live updates (spec §4.2, §15.3) and what of E2E-04 runs without a mail server: a reply recorded
// as inbound processing records it (in place of GreenMail and "Check now") moves the card on the
// Board to Responded without a reload, and the new reply is announced.

import { data, expect, test } from './fixtures.ts';

test('E2E-04 without a mail server: a reply moves the card on the open Board, and is announced', async ({ page, seed }) => {
  await page.goto(`/campaigns/${seed.campaignId}?tab=board`);
  const column = (name: string) => page.getByRole('region', { name, exact: true });
  await expect(column('Received').getByRole('link', { name: 'Ken Ito' })).toBeVisible();
  await expect(column('Responded').getByRole('link', { name: 'Ken Ito' })).toHaveCount(0);
  // Let the event stream connect before the reply arrives.
  await page.waitForTimeout(1_000);

  await data('reply', seed.workspaceId, seed.threads.ken);
  await expect(column('Responded').getByRole('link', { name: 'Ken Ito' })).toBeVisible({ timeout: 15_000 });
  await expect(column('Received').getByRole('link', { name: 'Ken Ito' })).toHaveCount(0);

  const notice = page.getByRole('link', { name: 'A new reply arrived →' });
  await expect(notice).toBeVisible();
  await notice.click();
  await expect(page).toHaveURL(new RegExp(`/threads/${seed.threads.ken}$`));
  await expect(page.getByText('One more thing: can we start next week?').first()).toBeVisible();
});

test('an open thread shows a new reply without a reload', async ({ page, seed }) => {
  await page.goto(`/threads/${seed.threads.dana}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Dana Wu');
  await page.waitForTimeout(1_000);
  await data('reply', seed.workspaceId, seed.threads.dana);
  await expect(page.getByText('One more thing: can we start next week?').first()).toBeVisible({ timeout: 15_000 });
});
