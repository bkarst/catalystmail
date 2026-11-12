// Signing in (spec §16, §15.3): an invited person makes their password, signs out, and signs back
// in; a wrong password and an uninvited address are turned away; signed out, every view sends you
// to sign in.

import { expect, expectAccessible, signedOut, test } from './fixtures.ts';

test.use({ storageState: signedOut });

test('an invited person makes a password, signs out and signs back in', async ({ page, seed }) => {
  await page.goto('/needs-you');
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expectAccessible(page);

  await page.getByRole('button', { name: 'First time here? Set your password' }).click();
  await expect(page.getByRole('heading', { name: 'Set your password' })).toBeVisible();
  await page.getByLabel('Email').fill(seed.owner.email);
  await page.getByLabel('Your name').fill(seed.owner.name);
  await page.getByLabel('Password').fill(seed.owner.password);
  await page.getByRole('button', { name: 'Set password and sign in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText(`${seed.owner.name} · owner`)).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);

  await page.getByLabel('Email').fill(seed.owner.email);
  await page.getByLabel('Password').fill('not the password at all');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page).toHaveURL(/\/sign-in$/);

  await page.getByLabel('Password').fill(seed.owner.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
});

test('someone not invited to a workspace cannot make a password', async ({ page, seed }) => {
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'First time here? Set your password' }).click();
  await page.getByLabel('Email').fill(`stranger.${seed.workspaceId.slice(-6)}@elsewhere.example`);
  await page.getByLabel('Password').fill('a long enough password');
  await page.getByRole('button', { name: 'Set password and sign in' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page).toHaveURL(/\/sign-in$/);
});
