// E2E-03, the campaign builder (spec §15.10): two goals, an audience, an initial email with
// variables and the default follow-up sequences; preflight fails on a variable without a fallback,
// the fix is made where Fix → leads, preflight passes, and the campaign launches.

import type { Page } from '@playwright/test';

import { data, expect, expectAccessible, test } from './fixtures.ts';

const card = (page: Page, title: string) => page.getByRole('region', { name: title, exact: true });

/** Continue →, then wait until the step bar shows the next step, so two clicks never land on one step. */
async function continueTo(page: Page, step: string) {
  await page.getByRole('button', { name: 'Continue →' }).click();
  await expect(page.getByRole('list', { name: 'Steps' }).locator('[aria-current=step]')).toContainText(step);
}

async function addGoal(page: Page, goal: { name: string; when: string; playbook: string }) {
  await page.getByRole('button', { name: 'Add goal' }).click();
  const form = page.getByRole('form', { name: 'New goal' });
  await form.getByLabel('Name').fill(goal.name);
  await form.getByLabel('Achieved when').fill(goal.when);
  await form.getByLabel('Playbook').fill(goal.playbook);
  await form.getByRole('button', { name: 'Add goal' }).click();
  await expect(form).toBeHidden();
}

test('E2E-03: build a campaign, fix what preflight finds, launch it', async ({ page, seed }) => {
  test.slow();
  await data('list', seed.workspaceId, 'Initech ops leads', '3');

  await page.goto('/campaigns');
  await page.getByRole('link', { name: '+ New campaign' }).click();
  await page.getByLabel('Name').fill('Initech pilot');
  await page.getByLabel('Objective').fill('Book a discovery call with Initech’s operations leads, then start a paid pilot.');
  await page.getByRole('button', { name: 'Create the draft and continue →' }).click();

  // 2 · Goals
  await expect(card(page, '2 · Goals: what does success look like?')).toBeVisible();
  await expectAccessible(page);
  await addGoal(page, { name: 'Call booked', when: 'They book a call or agree a time.', playbook: 'Answer briefly, then offer the booking link.' });
  await addGoal(page, { name: 'Pilot paid', when: 'They pay for the pilot.', playbook: 'Send the pilot terms and the checkout link.' });
  await expect(page.getByRole('form', { name: 'Goal 1: Call booked' })).toBeVisible();
  await expect(page.getByRole('form', { name: 'Goal 2: Pilot paid' })).toContainText('Final');
  await continueTo(page, 'Audience');

  // 3 · Audience
  await card(page, '3 · Audience').getByLabel('Enroll a list or segment').selectOption({ label: 'Initech ops leads (3)' });
  await card(page, '3 · Audience').getByRole('button', { name: 'Enroll' }).click();
  await expect(card(page, '3 · Audience').getByRole('status')).toContainText('3 enrolled');
  await continueTo(page, 'Emails');

  // 4 · Emails: the initial email uses {{ company.name }} with no fallback; Initech's leads have no company.
  const initial = card(page, 'Initial email');
  await initial.getByRole('button', { name: 'Add A/B variant' }).click();
  const variant = initial.getByRole('form', { name: 'Variant A' });
  await variant.getByLabel('Subject').fill('Onboarding at {{ company.name }}');
  await variant.getByLabel('Text').fill('Hi {{ contact.first_name | default: "there" }},\n\nHow do new operations hires get set up today?\n\n{{ sender.first_name }}');
  await variant.getByRole('button', { name: 'Save' }).click();
  await expect(variant.getByRole('status')).toHaveText('Saved.');
  // The default no-reply sequence has a step only the operator can write.
  const texts = page.getByRole('textbox', { name: 'Text', exact: true });
  await expect(texts.first()).toBeVisible();
  let placeholder = null;
  for (let index = 0; index < (await texts.count()); index++) {
    if ((await texts.nth(index).inputValue()).includes('[Replace')) placeholder = texts.nth(index);
  }
  expect(placeholder, 'a default step still to be written').not.toBeNull();
  await placeholder!.fill('Hi {{ contact.first_name | default: "there" }},\n\nTeams like yours cut onboarding time by a third with us.\n\n{{ sender.first_name }}');
  const form = placeholder!.locator('xpath=ancestor::form[1]');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form.getByRole('status')).toHaveText('Saved.');
  await continueTo(page, 'Agent');

  // 5 · Agent, then 6 · Sending: the mailbox.
  await continueTo(page, 'Sending');
  const mailboxes = card(page, '6 · Sending: mailboxes');
  await mailboxes.getByRole('checkbox', { name: 'alex@getacme.example' }).check();
  await mailboxes.getByRole('button', { name: 'Save mailboxes' }).click();
  await expect(mailboxes.getByRole('status')).toHaveText('Saved.');
  await continueTo(page, 'Review');

  // 7 · Review: the initial email fails for contacts without a company.
  const review = card(page, '7 · Review');
  const initialCheck = review.getByRole('listitem').filter({ hasText: 'Initial email' });
  await expect(initialCheck.getByRole('img', { name: 'Fails' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Launch…' })).toBeDisabled();
  await expectAccessible(page);
  await initialCheck.getByRole('button', { name: 'Fix →' }).click();
  await expect(page).toHaveURL(/step=emails/);
  await initial.getByRole('form', { name: 'Variant A' }).getByLabel('Subject').fill('Onboarding at {{ company.name | default: "your team" }}');
  await initial.getByRole('form', { name: 'Variant A' }).getByRole('button', { name: 'Save' }).click();
  await expect(initial.getByRole('form', { name: 'Variant A' }).getByRole('status')).toHaveText('Saved.');

  await page.getByRole('list', { name: 'Steps' }).getByRole('link', { name: '7 Review' }).click();
  await expect(initialCheck.getByRole('img', { name: 'Pass' })).toBeVisible();
  await expect(review.getByRole('img', { name: 'Fails' })).toHaveCount(0);
  await expect(card(page, 'Three sample emails')).toContainText('Onboarding at your team');

  await page.getByRole('button', { name: 'Launch…' }).click();
  await page.getByRole('alertdialog', { name: 'Launch the campaign?' }).getByRole('button', { name: 'Launch' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Initech pilot' })).toBeVisible();
  await expect(page.getByText('Active').first()).toBeVisible();
});
