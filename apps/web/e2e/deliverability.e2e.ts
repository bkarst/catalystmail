// Deliverability (spec §15.15): the tabs, E2E-11 (the bounce breaker trips: the mailbox is paused,
// and resuming needs the cause acknowledged), and what of E2E-01 runs without a mail server: a new
// domain checked against a scripted DNS resolver until every record passes, then the mailbox wizard
// as far as its connection test, which fails cleanly against a host that doesn't exist.

import { data, expect, expectAccessible, test } from './fixtures.ts';

test('the tabs', async ({ page }) => {
  await page.goto('/deliverability');
  await expect(page.getByRole('heading', { level: 1, name: 'Deliverability' })).toBeVisible();
  await expect(page.getByText('getacme.example').first()).toBeVisible();
  await expectAccessible(page);
  const tabs = page.getByRole('navigation', { name: 'Deliverability sections' });
  for (const tab of ['Domains', 'Mailboxes', 'Capacity', 'Events']) {
    await tabs.getByRole('button', { name: tab }).click();
    await expect(tabs.getByRole('button', { name: tab })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByText('Loading…')).toHaveCount(0);
    await expectAccessible(page);
  }
  await tabs.getByRole('button', { name: 'Mailboxes' }).click();
  await page.getByRole('link', { name: 'alex@getacme.example' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'alex@getacme.example' })).toBeVisible();
  await expectAccessible(page);
});

test('E2E-11: the bounce breaker pauses the mailbox; resuming needs the cause acknowledged', async ({ page, seed }) => {
  const tripped = await data<{ status: string; reason: string }>('bounces', seed.workspaceId, seed.mailboxId);
  expect(tripped.status).toBe('paused');

  await page.goto(`/deliverability/mailboxes/${seed.mailboxId}`);
  await expect(page.getByText('Paused', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/^breaker: .*hard-bounce rate/)).toBeVisible();
  const resume = page.getByRole('button', { name: 'Resume sending' });
  await expect(resume).toBeDisabled();
  await expectAccessible(page);
  await page.getByRole('checkbox', { name: 'I read the cause and dealt with it' }).check();
  await resume.click();
  await expect(page.getByText('Active', { exact: true }).first()).toBeVisible();
  await expect(resume).toBeHidden();

  await page.goto('/deliverability?tab=events');
  await expect(page.getByRole('region', { name: 'Events' })).toContainText(/breaker/i);
});

test('E2E-01 without a mail server: a domain checked against a scripted resolver, then the mailbox wizard', async ({ page, seed }) => {
  await page.goto('/deliverability?tab=domains');
  await page.getByLabel('Domain to send from').fill('hooli-mail.example');
  await page.getByRole('button', { name: '+ Add domain' }).click();
  await page.getByRole('link', { name: 'hooli-mail.example' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'hooli-mail.example' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Ramp' })).toContainText('0 of 0');
  await page.getByText('Authentication & DNS').click();
  await expect(page.getByText('Not checked yet.')).toBeVisible();
  const domainId = page.url().split('/').pop()!;

  // The app's own "Check DNS now" asks real DNS; here a scripted resolver answers, as §19.9 says.
  expect(await data<{ ready: boolean }>('dns', seed.workspaceId, domainId)).toEqual({ ready: true });
  await page.reload();
  await page.getByText('Authentication & DNS').click();
  await expect(page.getByText('Ready to send')).toBeVisible();
  for (const record of ['SPF', 'DMARC', 'MX']) await expect(page.getByTitle(`${record}: pass`)).toBeVisible();
  // Which DKIM selector to look up depends on the provider, known once a mailbox is added.
  await expect(page.getByTitle('DKIM: warn')).toBeVisible();
  await expectAccessible(page);

  await page.goto('/deliverability/mailboxes/new');
  await expect(page.getByRole('heading', { level: 1, name: 'Add a mailbox' })).toBeVisible();
  await page.getByRole('radio', { name: /Other \(SMTP and IMAP\)/ }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Email address').fill('sam@hooli-mail.example');
  await page.getByLabel('Sender name').fill('Sam Ortiz');
  await page.getByLabel('Password').fill('an app password');
  await page.getByLabel('SMTP host').fill('smtp.hooli-mail.invalid');
  await page.getByLabel('SMTP port').fill('465');
  await page.getByLabel('IMAP host').fill('imap.hooli-mail.invalid');
  await page.getByLabel('IMAP port').fill('993');
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Add and test' }).click();
  await expect(page.getByText('Connection test for sam@hooli-mail.example')).toBeVisible();
  await expect(page.getByText(/Fix what failed, then test again/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('img', { name: 'fail' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();
});
