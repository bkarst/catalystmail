// Contacts, Companies and Lists (spec §15.11–§15.14): searching and opening a contact, E2E-02 (an
// import with a duplicate, an invalid row, a role account, a suppressed address and an existing
// contact: dry-run counts, commit, report), E2E-07 (the unsubscribe link in a sent email), bulk
// "Add to list", a segment's live count, and companies.

import { alertIn, data, expect, expectAccessible, test, unsubscribePath } from './fixtures.ts';

test('search the contacts and open one', async ({ page }) => {
  await page.goto('/contacts');
  await expect(page.getByRole('heading', { level: 1, name: 'Contacts' })).toBeVisible();
  const table = page.getByRole('table');
  await expect(table.getByRole('link', { name: 'Priya Natarajan' })).toBeVisible();
  await expect(table.getByRole('link', { name: 'Dana Wu' })).toBeVisible();
  await expectAccessible(page);

  await page.getByRole('searchbox', { name: 'Search contacts' }).fill('globex');
  await expect(table.getByRole('link', { name: 'Dana Wu' })).toBeHidden();
  await table.getByRole('link', { name: 'Priya Natarajan' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Priya Natarajan' })).toBeVisible();
  await expect(page.getByText('priya@globex.example').first()).toBeVisible();
  await expect(page.getByRole('link', { name: /Quick question about Globex onboarding|Agency outreach Q4/ }).first()).toBeVisible();
  await expectAccessible(page);
});

test('E2E-02: import with problems, see the dry run, commit, read the report', async ({ page, seed }) => {
  await data('suppress', seed.workspaceId, 'blocked@hooli.example');
  const csv = [
    'Email,First name,Last name,Company,Title',
    'ann@hooli.example,Ann,Lee,Hooli,COO',
    'bo@hooli.example,Bo,Chan,Hooli,VP Operations',
    'bo@hooli.example,Bo,Chan,Hooli,VP Operations',
    'not-an-email,Bad,Row,Hooli,',
    'info@hooli.example,,,Hooli,',
    'blocked@hooli.example,Blocked,Person,Hooli,',
    'priya@globex.example,Priya,Natarajan,Globex,VP Operations',
  ].join('\n');

  await page.goto('/contacts');
  await page.getByRole('link', { name: 'Import' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Import contacts' })).toBeVisible();
  await page.locator('input[type=file]').setInputFiles({ name: 'hooli.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByText('hooli.csv: 7 rows.', { exact: false })).toBeVisible();
  await expect(page.getByLabel('Field for Email')).toHaveValue('email');
  await expectAccessible(page);

  await page.getByRole('button', { name: 'Check (dry run)' }).click();
  const check = page.getByRole('region', { name: 'Check, then import' });
  await expect(check.getByText('3 new')).toBeVisible();
  await expect(check.getByText('1 unchanged')).toBeVisible();
  await expect(check.getByText('1 invalid')).toBeVisible();
  await expect(check.getByText('1 suppressed')).toBeVisible();
  await expect(check.getByText('1 duplicates in file')).toBeVisible();
  await expect(check.getByText(/^Row \d+ \(Email\): /)).toBeVisible();

  const committed = page.waitForResponse((response) => /\/api\/v1\/imports\/[^/]+\/commit$/.test(response.url()) && response.ok());
  await check.getByRole('button', { name: 'Import 3 contacts' }).click();
  const started = (await (await committed).json()) as { id: string };
  await expect(page.getByRole('heading', { level: 1, name: 'Importing hooli.csv' })).toBeVisible();
  // The worker's import.process job writes the contacts; the suite runs that job itself.
  expect(await data<{ outcome: string }>('import', started.id)).toEqual({ outcome: 'done' });
  await expect(page.getByText('Done.')).toBeVisible();
  await expect(page.getByText('3 created')).toBeVisible();
  await expect(page.getByText('1 with problems')).toBeVisible();

  await page.getByRole('link', { name: 'See the contacts' }).click();
  for (const name of ['Ann Lee', 'Bo Chan']) await expect(page.getByRole('table').getByRole('link', { name })).toBeVisible();
  await expect(page.getByRole('table').getByRole('link', { name: 'info@hooli.example' })).toBeVisible();
  await expect(page.getByRole('table').getByRole('link', { name: /Blocked/ })).toHaveCount(0);
});

test('E2E-07: the unsubscribe link in a sent email unsubscribes the contact everywhere', async ({ page, seed }) => {
  await page.goto(unsubscribePath(seed.messages.priyaFirst));
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Unsubscribe from emails from');
  await page.getByRole('button', { name: 'Unsubscribe' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('You won’t hear from us again.');

  await page.goto(`/contacts/${seed.contacts.priya}`);
  await expect(page.getByText('Unsubscribed. Never emailed again.').first()).toBeAttached();
  await data('evaluate', seed.threads.priya);
  await page.goto(`/threads/${seed.threads.priya}`);
  await expect(page.getByRole('complementary', { name: 'About this thread' })).toContainText('Unsubscribed');
  await expect(page.getByRole('form', { name: 'Reply' })).toHaveCount(0);
});

test('a static list filled from Contacts, and a segment with a live count', async ({ page }) => {
  await page.goto('/lists');
  await page.getByRole('button', { name: 'New list' }).click();
  await page.getByLabel('Name').fill('Q1 targets');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('textbox', { name: 'List name' })).toHaveValue('Q1 targets');
  await expect(page.getByRole('region', { name: 'Members' })).toContainText('Empty.');

  await page.goto('/contacts');
  await page.getByRole('checkbox', { name: 'Select Priya Natarajan' }).check();
  await page.getByRole('checkbox', { name: 'Select Dana Wu' }).check();
  const bulk = page.getByRole('region', { name: 'Bulk actions' });
  await bulk.getByRole('button', { name: 'Add to list' }).click();
  await bulk.getByLabel('List').selectOption({ label: 'Q1 targets' });
  await bulk.getByRole('button', { name: 'Apply' }).click();
  await expect(bulk.getByRole('status')).toBeVisible();

  await page.goto('/lists');
  await expect(page.getByRole('listitem').filter({ hasText: 'Q1 targets' })).toContainText('2 contacts');
  await page.getByRole('link', { name: 'Q1 targets' }).click();
  const members = page.getByRole('region', { name: 'Members' });
  await expect(members.getByRole('link', { name: 'Priya Natarajan' })).toBeVisible();
  await expect(members.getByRole('link', { name: 'Dana Wu' })).toBeVisible();
  await expectAccessible(page);

  await page.goto('/lists');
  await page.getByRole('button', { name: 'Segments (dynamic)' }).click();
  await page.getByRole('button', { name: 'New segment' }).click();
  await page.getByLabel('Name').fill('Portland');
  await page.getByLabel('Field').selectOption({ label: 'City' });
  await page.getByLabel('Value').fill('Portland');
  await expect(page.getByText('3 contacts match')).toBeVisible();
  await page.getByLabel('Value').fill('Nowhere');
  await expect(page.getByText('0 contacts match')).toBeVisible();
  await page.getByLabel('Value').fill('Portland');
  await expect(page.getByText('3 contacts match')).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('region', { name: 'Members' }).getByRole('listitem')).toHaveCount(3);
});

test('companies: search, open one, add one', async ({ page }) => {
  await page.goto('/companies');
  await expect(page.getByRole('heading', { level: 1, name: 'Companies' })).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('searchbox', { name: 'Search companies' }).fill('north');
  await expect(page.getByRole('link', { name: 'Globex' })).toBeHidden();
  await page.getByRole('link', { name: 'Northwind' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Northwind' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Contacts' }).getByRole('link', { name: 'Dana Wu' })).toBeVisible();
  await expectAccessible(page);

  await page.goto('/companies');
  await page.getByRole('button', { name: 'Add company' }).click();
  await page.getByLabel('Name').fill('Hooli');
  await page.getByPlaceholder('globex.com').fill('hooli.example');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Hooli' })).toBeVisible();
  await expect(alertIn(page)).toHaveCount(0);
});
