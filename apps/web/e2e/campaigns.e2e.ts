// Campaigns (spec §15.8, §15.9): the list, the detail's tabs, E2E-06 (drag a card to a goal,
// confirm, undo), the Board's "Move to…" menus, E2E-13 (hold the domain's ramp with a reason, see
// the campaign's Sending pace say so, resume, and find both changes with who and why on the Events
// tab), and the builder half of E2E-14 (a step added to the Responded sequence, previewed).

import type { Page } from '@playwright/test';

import { data, expect, expectAccessible, test } from './fixtures.ts';

const column = (page: Page, name: string) => page.getByRole('region', { name, exact: true });
const card = (page: Page, columnName: string, person: string) => column(page, columnName).getByRole('listitem').filter({ has: page.getByRole('link', { name: person }) });

test('the list and the detail’s tabs', async ({ page, seed }) => {
  await page.goto('/campaigns');
  await expect(page.getByRole('heading', { level: 1, name: 'Campaigns' })).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('link', { name: 'Agency outreach Q4' }).click();
  await expect(page).toHaveURL(new RegExp(`/campaigns/${seed.campaignId}$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Agency outreach Q4' })).toBeVisible();
  await expectAccessible(page);

  const tabs = page.getByRole('navigation', { name: 'Campaign sections' });
  await tabs.getByRole('button', { name: 'Board' }).click();
  await expect(card(page, 'Responded', 'Priya Natarajan')).toBeVisible();
  await expect(card(page, 'Received', 'Ken Ito')).toBeVisible();
  await expectAccessible(page);

  await tabs.getByRole('button', { name: 'Threads' }).click();
  await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(3);

  await tabs.getByRole('button', { name: 'Emails' }).click();
  await expect(page.getByRole('region', { name: 'Initial email' })).toContainText('Quick question about {{company}} onboarding');
  await expect(page.getByRole('region', { name: 'No reply to the first email' })).toContainText('Bumping this up.');
  await expectAccessible(page);

  await tabs.getByRole('button', { name: 'Goals' }).click();
  await expect(page.getByRole('heading', { name: 'Call booked' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Paid' })).toBeVisible();
  await expectAccessible(page);

  await tabs.getByRole('button', { name: 'Agent' }).click();
  await expectAccessible(page);
  await tabs.getByRole('button', { name: 'Settings' }).click();
  await expectAccessible(page);
});

test('E2E-06: drag a card to “Call booked”, confirm, undo', async ({ page, seed }) => {
  await page.goto(`/campaigns/${seed.campaignId}?tab=board`);
  const priya = card(page, 'Responded', 'Priya Natarajan');
  await priya.dragTo(column(page, 'Call booked'));
  const confirm = page.getByRole('alertdialog', { name: 'Mark Call booked achieved?' });
  await confirm.getByRole('textbox', { name: 'Evidence' }).fill('Booked on the phone');
  await confirm.getByRole('button', { name: 'Mark achieved' }).click();
  await expect(card(page, 'Call booked', 'Priya Natarajan')).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Priya Natarajan: “Call booked” marked achieved.');

  await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
  await expect(card(page, 'Responded', 'Priya Natarajan')).toBeVisible();
  await expect(column(page, 'Call booked').getByText('None')).toBeVisible();
});

test('the Board’s “Move to…” menu does the same without dragging', async ({ page, seed }) => {
  await page.goto(`/campaigns/${seed.campaignId}?tab=board`);
  await card(page, 'Responded', 'Dana Wu').getByLabel('Move Dana Wu to').selectOption({ label: 'Paid: mark achieved' });
  await page.getByRole('alertdialog', { name: 'Mark Paid achieved?' }).getByRole('button', { name: 'Mark achieved' }).click();
  await expect(card(page, 'Paid', 'Dana Wu')).toBeVisible();

  await card(page, 'Paid', 'Dana Wu').getByLabel('Move Dana Wu to').selectOption({ label: 'Back: revoke “Paid”' });
  const revoke = page.getByRole('alertdialog', { name: 'Revoke Paid?' });
  await revoke.getByRole('textbox', { name: 'Why it was wrong' }).fill('The invoice bounced');
  await revoke.getByRole('button', { name: 'Revoke' }).click();
  await expect(card(page, 'Responded', 'Dana Wu')).toBeVisible();
});

test('E2E-13: holding the ramp shows on the campaign, and both changes are on the Events tab', async ({ page, seed }) => {
  await data('enroll', seed.workspaceId, seed.campaignId, '5');
  await page.goto(`/campaigns/${seed.campaignId}`);
  const pace = page.getByRole('region', { name: 'Sending pace' });
  await expect(pace).toContainText(/Waiting\s*5/);
  await expect(pace).toContainText('the domain’s ramp step');
  await expect(pace).not.toContainText('held by an admin');

  await page.goto(`/deliverability/domains/${seed.domainId}`);
  await page.getByRole('button', { name: 'Hold ramp…' }).click();
  await page.getByRole('textbox', { name: 'Reason' }).fill('Waiting for the Postmaster numbers');
  await page.getByRole('button', { name: 'Hold ramp', exact: true }).click();
  await expect(page.getByText('Holding · held by an admin')).toBeVisible();

  await page.goto(`/campaigns/${seed.campaignId}`);
  await expect(pace).toContainText('the domain’s ramp step (held by an admin)');

  await page.goto(`/deliverability/domains/${seed.domainId}`);
  await page.getByRole('button', { name: 'Resume ramp…' }).click();
  await page.getByRole('textbox', { name: 'Reason' }).fill('Numbers look fine');
  await page.getByRole('button', { name: 'Resume ramp', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Hold ramp…' })).toBeVisible();

  await page.goto('/deliverability?tab=events');
  const events = page.getByRole('region', { name: 'Events' });
  await expect(events.getByRole('listitem').filter({ hasText: 'Ramp held' })).toContainText(`by ${seed.owner.name} · “Waiting for the Postmaster numbers”`);
  await expect(events.getByRole('listitem').filter({ hasText: 'Ramp moving again' })).toContainText(`by ${seed.owner.name} · “Numbers look fine”`);
  await expectAccessible(page);
});

test('E2E-14, in the builder: a step added to the Responded sequence, a stage another sequence uses, a preview for a real thread', async ({ page, seed }) => {
  await page.goto(`/campaigns/${seed.campaignId}/build?step=emails`);
  await page.getByRole('region', { name: 'Responded', exact: true }).getByRole('button', { name: 'Create sequence' }).click();
  const responded = page.getByRole('region', { name: 'Responded', exact: true }).filter({ has: page.getByRole('button', { name: 'Add step' }) });
  await expect(responded).toContainText('Follow-ups at Responded');
  await responded.getByRole('button', { name: 'Add step' }).click();
  await expect(responded.getByRole('spinbutton', { name: 'Wait' })).toHaveCount(2);

  // Sent is covered by the no-reply sequence, so it can't be added here.
  const sent = responded.getByRole('checkbox', { name: /^Sent/ });
  await expect(sent).toBeDisabled();
  await expect(responded.getByText('(used by “No reply to the first email”)').first()).toBeVisible();
  await expect(responded.getByRole('checkbox', { name: /^Responded/ })).toBeChecked();

  // The first step is an AI brief; previewed for Priya, it says what the AI will do with it.
  await responded.getByRole('button', { name: 'Preview' }).first().click();
  await responded.getByLabel('Preview for').first().selectOption({ label: 'Priya Natarajan' });
  await expect(responded.getByText('This text is a brief: the AI rewrites it to fit each conversation').first()).toBeVisible();
  await expectAccessible(page);

  await page.goto(`/campaigns/${seed.campaignId}?tab=emails`);
  await expect(page.getByRole('region', { name: 'Follow-ups at Responded' }).getByRole('listitem')).toHaveCount(2);
});
