// Knowledge (spec §15.17): writing, finding, changing and switching off an item, and "Test the
// agent", which asks Claude and so, with AI off here, says the agent is off.

import { alertIn, expect, expectAccessible, test } from './fixtures.ts';

test('write an item, find it, change it, switch it off', async ({ page }) => {
  await page.goto('/knowledge');
  await expect(page.getByRole('heading', { level: 1, name: 'Knowledge' })).toBeVisible();
  await expectAccessible(page);

  await page.getByRole('button', { name: 'New item' }).click();
  const editor = page.getByRole('form', { name: 'New knowledge item' });
  await editor.getByLabel('Title').fill('SSO and SCIM');
  await editor.getByLabel('Content (markdown)').fill('SAML SSO is on the Business plan. SCIM provisioning arrives in Q1 2027.');
  await editor.getByPlaceholder('sso, security').fill('sso, security');
  await editor.getByRole('button', { name: 'Add' }).click();

  const items = page.getByRole('complementary', { name: 'Knowledge items' });
  await expect(items.getByRole('button', { name: /SSO and SCIM/ })).toBeVisible();
  await expectAccessible(page);

  await items.getByRole('button', { name: /SSO and SCIM/ }).click();
  const edit = page.getByRole('form', { name: 'Edit SSO and SCIM' });
  await edit.getByLabel('Content (markdown)').fill('SAML SSO is on the Business and Enterprise plans. SCIM arrives in Q1 2027.');
  await edit.getByRole('checkbox', { name: 'Active: the agent uses it' }).uncheck();
  await edit.getByRole('button', { name: 'Save' }).click();
  await expect(items.getByRole('button', { name: /SSO and SCIM/ })).toContainText('Inactive');

  await items.getByRole('searchbox', { name: 'Search knowledge' }).fill('pricing');
  await expect(items.getByRole('button', { name: /SSO and SCIM/ })).toBeHidden();
  await items.getByRole('searchbox', { name: 'Search knowledge' }).fill('SCIM');
  await expect(items.getByRole('button', { name: /SSO and SCIM/ })).toBeVisible();
});

test('Test the agent says the agent is off, with the request ID', async ({ page }) => {
  await page.goto('/knowledge');
  const tester = page.getByRole('region', { name: 'Test the agent' });
  await tester.getByRole('textbox', { name: 'Question' }).fill('Do you support SAML SSO?');
  await tester.getByRole('button', { name: 'Ask' }).click();
  const alert = alertIn(page);
  await expect(alert).toContainText('The AI agent is off');
  await expect(alert).toContainText(/Request \S+/);
});
