// §19.9: "Every E2E page gets an axe-core check (0 serious or critical violations)", in light and in
// dark mode (§15.20). The flows check the pages they pass through in light mode; this goes through
// every view in both.

import type { Page } from '@playwright/test';

import { expect, expectAccessible, signedOut, test, type Seed } from './fixtures.ts';

const views = (seed: Seed) => [
  '/',
  '/needs-you',
  '/needs-you?tab=drafts',
  '/inbox',
  '/inbox?view=hot',
  '/inbox?view=unmatched',
  `/threads/${seed.threads.priya}`,
  `/threads/${seed.threads.dana}`,
  '/campaigns',
  '/campaigns/new',
  `/campaigns/${seed.campaignId}`,
  ...['board', 'threads', 'emails', 'goals', 'agent', 'settings'].map((tab) => `/campaigns/${seed.campaignId}?tab=${tab}`),
  ...['basics', 'goals', 'audience', 'emails', 'agent', 'sending', 'review'].map((step) => `/campaigns/${seed.campaignId}/build?step=${step}`),
  '/contacts',
  `/contacts/${seed.contacts.priya}`,
  '/contacts/import',
  '/companies',
  `/companies/${seed.companies.globex}`,
  '/lists',
  '/knowledge',
  '/deliverability',
  ...['domains', 'mailboxes', 'capacity', 'events'].map((tab) => `/deliverability?tab=${tab}`),
  `/deliverability/domains/${seed.domainId}`,
  `/deliverability/mailboxes/${seed.mailboxId}`,
  '/deliverability/mailboxes/new',
  ...['workspace', 'team', 'ai', 'notifications', 'security', 'integrations', 'webhooks', 'api'].map((section) => `/settings?section=${section}`),
];

async function sweep(page: Page, seed: Seed) {
  for (const view of views(seed)) {
    await page.goto(view);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await expect(page.getByText('Loading…')).toHaveCount(0);
    await expectAccessible(page);
  }
}

test('every view, light', async ({ page, seed }) => {
  test.slow();
  await page.emulateMedia({ colorScheme: 'light' });
  await sweep(page, seed);
});

test('every view, dark', async ({ page, seed }) => {
  test.slow();
  await page.emulateMedia({ colorScheme: 'dark' });
  await sweep(page, seed);
});

test.describe('signed out', () => {
  test.use({ storageState: signedOut });
  for (const scheme of ['light', 'dark'] as const) {
    test(`sign-in, ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto('/sign-in');
      await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
      await expectAccessible(page);
    });
  }
});
