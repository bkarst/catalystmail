// The Inbox (spec §15.6): its views, search and filters, unmatched mail filed onto a thread, and
// E2E-10, the open indicators moving from unopened to auto to opened as the real tracking pixel is
// fetched by a privacy proxy and then by a mail client.

import type { Page } from '@playwright/test';

import { data, expect, expectAccessible, openPixelPath, test } from './fixtures.ts';

const rows = (page: Page) => page.getByRole('table').locator('tbody tr');
const row = (page: Page, name: string) => rows(page).filter({ has: page.getByRole('link', { name }) });

test('views, search and filters', async ({ page }) => {
  await page.goto('/inbox');
  await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
  await expect(rows(page)).toHaveCount(3);
  await expect(row(page, 'Priya Natarajan')).toContainText('Needs you');
  await expect(row(page, 'Dana Wu')).toContainText('To approve');
  await expectAccessible(page);

  await page.getByRole('searchbox', { name: 'Search threads' }).fill('Northwind');
  await expect(page).toHaveURL(/q=Northwind/);
  await expect(rows(page)).toHaveCount(1);
  await expect(row(page, 'Dana Wu')).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search threads' }).fill('');
  await expect(rows(page)).toHaveCount(3);

  await page.getByLabel('Stage').selectOption({ label: 'Received' });
  await expect(page).toHaveURL(/stage=received/);
  await expect(rows(page)).toHaveCount(1);
  await expect(row(page, 'Ken Ito')).toBeVisible();
  await page.getByLabel('Stage').selectOption({ label: 'Stage: any' });

  const views = page.getByRole('navigation', { name: 'Inbox views' });
  await views.getByRole('button', { name: 'Hot' }).click();
  await expect(page).toHaveURL(/view=hot/);
  await expect(page.getByRole('columnheader', { name: 'Temperature' })).toBeVisible();
  await expect(rows(page)).toHaveCount(1);
  await expect(row(page, 'Priya Natarajan')).toContainText('Evaluating');
  await expectAccessible(page);

  await views.getByRole('button', { name: 'Needs you' }).click();
  await expect(rows(page)).toHaveCount(2);
  await expect(row(page, 'Ken Ito')).toHaveCount(0);

  await views.getByRole('button', { name: 'Assigned to me' }).click();
  await expect(page.getByText('No conversations match.')).toBeVisible();

  await views.getByRole('button', { name: 'All' }).click();
  await row(page, 'Ken Ito').getByRole('link', { name: 'Ken Ito' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /Ken Ito/ })).toBeVisible();
});

test('unmatched mail is filed onto the sender’s thread', async ({ page, seed }) => {
  await page.goto('/inbox?view=unmatched');
  const item = page.getByRole('listitem').filter({ hasText: 'Ken Ito <ken@fabrikam.example>' });
  await expect(item).toContainText('Saw your note. Can you send a deck?');
  await expectAccessible(page);
  await item.getByRole('button', { name: 'Attach to thread…' }).click();
  await item.getByRole('button', { name: /Quick question about Fabrikam onboarding/ }).click();
  await expect(page.getByText('No unmatched mail.', { exact: false })).toBeVisible();

  await page.goto(`/threads/${seed.threads.ken}`);
  await expect(page.getByText('Saw your note. Can you send a deck?').first()).toBeVisible();
});

test('E2E-10: opens go from unopened to auto to opened, in the Inbox and the thread', async ({ page, seed }) => {
  const ken = () => row(page, 'Ken Ito');
  await page.goto('/inbox');
  await expect(ken().getByText('Not opened')).toBeAttached();

  // A privacy proxy fetches the pixel: delivered, maybe not read.
  const proxy = await page.request.get(openPixelPath(seed.messages.kenFirst), { headers: { 'user-agent': 'Mozilla/5.0' } });
  expect(proxy.headers()['content-type']).toBe('image/gif');
  // The worker's thread.evaluate job picks the open up; the suite runs that job itself.
  await expect(async () => {
    await data('evaluate', seed.threads.ken);
    await page.reload();
    await expect(ken().getByText('auto')).toBeVisible({ timeout: 1_000 });
  }).toPass();
  const status = page.getByRole('complementary', { name: 'About this thread' }).locator('details', { has: page.locator('summary', { hasText: 'Status' }) });
  await page.goto(`/threads/${seed.threads.ken}`);
  await expect(status).toContainText('auto (a proxy or scanner, maybe not read)');

  // Then the person's mail client loads it.
  await page.request.get(openPixelPath(seed.messages.kenFirst), { headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)' } });
  await expect(async () => {
    await data('evaluate', seed.threads.ken);
    await page.reload();
    await expect(page.getByText('Opened 1×')).toBeVisible({ timeout: 1_000 });
    await expect(status).toContainText('1×', { timeout: 1_000 });
  }).toPass();
  await page.goto('/inbox');
  await expect(ken().getByText('1×')).toBeVisible();
});
