// The shell (spec §15.3): the views in the sidebar, the skip link, the Dashboard, the ⌘K palette
// (search and commands), the `g` shortcuts and the `?` cheat sheet.

import { expect, expectAccessible, test } from './fixtures.ts';

test('the sidebar, the skip link and the Dashboard', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  await expectAccessible(page);
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
  // Two escalations about Priya, one about Ken, and Dana's draft.
  await expect(nav.getByRole('link', { name: /Needs you/ })).toContainText('4');

  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#main$/);

  for (const [name, heading] of [
    ['Needs you', /Needs you/],
    ['Inbox', 'Inbox'],
    ['Campaigns', 'Campaigns'],
    ['Contacts', 'Contacts'],
    ['Companies', 'Companies'],
    ['Lists', 'Lists'],
    ['Knowledge', 'Knowledge'],
    ['Deliverability', 'Deliverability'],
    ['Settings', 'Settings'],
  ] as const) {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name }).click();
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name })).toHaveAttribute('aria-current', 'page');
  }
});

test('⌘K finds a contact and runs a command', async ({ page, seed }) => {
  await page.goto('/');
  await page.keyboard.press('ControlOrMeta+k');
  const palette = page.getByRole('dialog', { name: 'Search and commands' });
  await expect(palette).toBeVisible();
  await expectAccessible(page);
  await palette.getByRole('combobox').fill('Priya');
  await expect(palette.getByRole('option', { name: /Priya Natarajan/ }).first()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/contacts/${seed.contacts.priya}$`));
  await expect(palette).toBeHidden();

  await page.keyboard.press('ControlOrMeta+k');
  await palette.getByRole('combobox').fill('import');
  await expect(palette.getByRole('option', { name: 'Import contacts' })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Import contacts' })).toBeVisible();

  await page.keyboard.press('ControlOrMeta+k');
  await expect(palette).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(palette).toBeHidden();
});

test('g then a letter goes to a view; ? lists the shortcuts', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  for (const [key, heading] of [
    ['n', /Needs you/],
    ['i', 'Inbox'],
    ['c', 'Campaigns'],
    ['o', 'Contacts'],
    ['d', 'Dashboard'],
  ] as const) {
    await page.keyboard.press('g');
    await page.keyboard.press(key);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
  }

  await page.keyboard.press('?');
  const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('Needs you: snooze until tomorrow 9:00');
  await expectAccessible(page);
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();

  // Typing in a field is just typing.
  await page.goto('/contacts');
  await page.getByRole('searchbox', { name: 'Search contacts' }).fill('gi');
  await expect(page.getByRole('heading', { level: 1, name: 'Contacts' })).toBeVisible();
});
