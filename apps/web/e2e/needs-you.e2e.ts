// Needs you (spec §15.5): E2E-09 keyboard-only triage, goal confirmations, dismissing, and the
// knowledge-gap part of E2E-05 that needs no model (with AI off, "Draft reply with this answer"
// says so; the person writes the reply themselves and marks the escalation done).

import type { Page } from '@playwright/test';

import { alertIn, expect, expectAccessible, test } from './fixtures.ts';

const list = (page: Page) => page.getByRole('list', { name: 'Waiting items' });
const selected = (page: Page) => list(page).locator('button[aria-current=true]');

/** Presses j (then k from the bottom) until the selected item mentions `text`. */
async function moveTo(page: Page, text: string) {
  for (const key of ['j', 'k']) {
    for (let step = 0; step < 8; step++) {
      if (((await selected(page).textContent()) ?? '').includes(text)) return;
      await page.keyboard.press(key);
      await page.waitForTimeout(50);
    }
  }
  await expect(selected(page)).toContainText(text);
}

test('E2E-09: triage the queue with j, k, e, s and t', async ({ page }) => {
  await page.goto('/needs-you');
  await expect(page.getByRole('heading', { level: 1, name: /Needs you/ })).toBeVisible();
  // Two escalations about Priya, the draft for Dana, Ken's unmatched reply and its escalation.
  const items = list(page).getByRole('listitem');
  await expect(items).toHaveCount(5);
  // Most urgent first: the high-priority knowledge gap.
  await expect(selected(page)).toContainText('Asked about SAML SSO and SCIM');
  await expectAccessible(page);

  await page.keyboard.press('j');
  await expect(selected(page)).not.toContainText('Asked about SAML SSO and SCIM');
  await page.keyboard.press('k');
  await expect(selected(page)).toContainText('Asked about SAML SSO and SCIM');

  // e approves and sends the selected draft.
  await moveTo(page, 'Northwind');
  await expect(page.getByRole('article', { name: /^Draft:/ })).toBeVisible();
  await page.keyboard.press('e');
  await expect(items).toHaveCount(4);
  await expect(list(page)).not.toContainText('Northwind');

  // s snoozes the selected escalation until tomorrow morning.
  await moveTo(page, 'Asked about SAML SSO and SCIM');
  await page.keyboard.press('s');
  await expect(page.getByRole('status')).toHaveText('Snoozed until tomorrow 9:00.');
  await expect(items).toHaveCount(3);
  await expect(list(page)).not.toContainText('Asked about SAML SSO and SCIM');

  // t takes the selected escalation's thread over.
  await moveTo(page, 'Did Priya Natarajan reach');
  await page.keyboard.press('t');
  await expect(items).toHaveCount(2);
  await expect(list(page)).not.toContainText('Did Priya Natarajan reach');

  // An unmatched reply has no thread; it points to the Inbox.
  await moveTo(page, 'Unmatched: onboarding');
  await expect(page.getByRole('link', { name: 'Open Inbox → Unmatched →' })).toBeVisible();
});

test('Enter opens the selected item’s thread, and r its reply box', async ({ page, seed }) => {
  await page.goto('/needs-you');
  await expect(selected(page)).toContainText('Asked about SAML SSO and SCIM');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/threads/${seed.threads.priya}$`));
  await expect(page.getByRole('heading', { level: 1, name: /Priya Natarajan/ })).toBeVisible();

  await page.goBack();
  await expect(selected(page)).toContainText('Asked about SAML SSO and SCIM');
  await page.keyboard.press('r');
  await expect(page).toHaveURL(new RegExp(`/threads/${seed.threads.priya}#composer$`));
  await expect(page.getByRole('textbox', { name: 'Your reply' })).toBeFocused();
});

test('confirming a goal moves the thread to that goal', async ({ page, seed }) => {
  await page.goto('/needs-you');
  await list(page).getByRole('button', { name: /Did Priya Natarajan reach/ }).click();
  const card = page.getByRole('article', { name: 'Did Priya Natarajan reach “Call booked”?' });
  await expect(card.getByText('Classifier’s confidence: 55%')).toBeVisible();
  await card.getByRole('button', { name: 'Confirm' }).click();
  await expect(list(page)).not.toContainText('Did Priya Natarajan reach');

  await page.goto(`/threads/${seed.threads.priya}`);
  await expect(page.getByRole('list', { name: 'Stage' }).getByText('Call booked (reached)')).toBeAttached();
  await expect(page.getByRole('list', { name: 'Stage' }).getByText('Paid (not yet)')).toBeAttached();
});

test('dismissing needs a reason', async ({ page }) => {
  await page.goto('/needs-you');
  await list(page).getByRole('button', { name: /Unmatched: onboarding/ }).click();
  await page.getByRole('link', { name: 'Open Inbox → Unmatched →' }).click();
  await expect(page).toHaveURL(/\/inbox\?view=unmatched/);

  await page.goto('/needs-you');
  await list(page).getByRole('button', { name: /Did Priya Natarajan reach/ }).click();
  const card = page.getByRole('article', { name: /Did Priya Natarajan reach/ });
  await card.getByRole('button', { name: 'Dismiss…' }).click();
  await card.getByRole('textbox', { name: 'Why no action is needed' }).fill('Duplicate of the SSO question');
  await card.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await expect(list(page)).not.toContainText('Did Priya Natarajan reach');
});

test('E2E-05 without AI: the agent is off, so the person replies and marks the escalation done', async ({ page, seed }) => {
  await page.goto('/needs-you');
  const card = page.getByRole('article', { name: 'Asked about SAML SSO and SCIM' });
  await expect(card.getByText('Do you support SAML SSO?')).toBeVisible();
  await expect(page.getByText('Their message')).toBeVisible();

  await card.getByRole('textbox', { name: 'Answer for the agent' }).fill('SAML SSO: yes, on the Business plan. SCIM: Q1 2027.');
  await card.getByRole('button', { name: 'Draft reply with this answer' }).click();
  const alert = alertIn(card);
  await expect(alert).toContainText('The AI agent is off');
  await expect(alert).toContainText(/Request \S+/);

  await card.getByRole('link', { name: 'Write it myself' }).click();
  await expect(page).toHaveURL(new RegExp(`/threads/${seed.threads.priya}#composer$`));
  const reply = page.getByRole('textbox', { name: 'Your reply' });
  await expect(reply).toBeFocused();
  await reply.fill('Hi Priya, yes: SAML SSO is on our Business plan, and SCIM arrives in Q1 2027.');
  await page.getByRole('form', { name: 'Reply' }).getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Sending.')).toBeVisible();

  const inThread = page.getByRole('article', { name: 'Asked about SAML SSO and SCIM' });
  await inThread.getByRole('button', { name: 'I replied: done' }).click();
  await expect(inThread).toBeHidden();
  await page.goto('/needs-you');
  await expect(list(page)).not.toContainText('Asked about SAML SSO and SCIM');
});

test('Review drafts shows only the drafts', async ({ page }) => {
  await page.goto('/needs-you');
  await page.getByRole('button', { name: /Review drafts \(1\)/ }).click();
  await expect(page).toHaveURL(/tab=drafts/);
  await expect(list(page).getByRole('listitem')).toHaveCount(1);
  await expect(list(page)).toContainText('Approve: Re: Quick question about Northwind onboarding');
  const draft = page.getByRole('article', { name: /^Draft:/ });
  await expect(draft.getByText('Suggested reply (AI)')).toBeVisible();
  await expect(draft.getByText('One link is fine; keep it to one.')).toBeVisible();
  await expect(draft.getByRole('button', { name: 'Approve and send' })).toBeEnabled();
  await expectAccessible(page);
});
