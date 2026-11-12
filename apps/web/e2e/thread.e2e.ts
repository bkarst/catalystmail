// The Thread view (spec §15.7): the conversation and stage ladder, the side panel, drafts waiting for
// approval (approve, edit, reject; regenerating needs AI, which is off here), the composer, taking
// over, closing, goals by hand, and the thread half of E2E-14 (skip a follow-up, stop and resume
// follow-ups). E2E-12 (approve and reply on a phone) is in mobile.e2e.ts.

import type { Page } from '@playwright/test';

import { alertIn, expect, expectAccessible, test } from './fixtures.ts';

const panel = (page: Page, title: string) => page.getByRole('complementary', { name: 'About this thread' }).locator('details', { has: page.locator('summary', { hasText: title }) });

test('shows the conversation, the stage ladder and the side panel', async ({ page, seed }) => {
  await page.goto(`/threads/${seed.threads.priya}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Priya Natarajan');
  await expect(page.getByText('Globex · Agency outreach Q4 · Quick question about Globex onboarding')).toBeVisible();

  const stage = page.getByRole('list', { name: 'Stage' });
  for (const reached of ['Sent', 'Received', 'Responded']) await expect(stage.getByText(`${reached} (reached)`)).toBeAttached();
  await expect(stage.getByText('Call booked (not yet)')).toBeAttached();

  await expect(page.getByText('Initial email').first()).toBeVisible();
  await expect(page.getByText('Follow-up 1').first()).toBeVisible();
  await expect(page.getByText('Do you support SAML SSO and SCIM? That’s a hard requirement for us.').first()).toBeVisible();

  await expect(panel(page, 'Status')).toContainText('Needs you');
  await expect(panel(page, 'Contact')).toContainText('VP Operations · Globex');
  await expect(panel(page, 'AI summary')).toContainText('SAML SSO and SCIM');
  await expect(panel(page, 'Goals')).toContainText('Call booked');
  await expect(page.getByRole('article', { name: 'Asked about SAML SSO and SCIM' })).toBeVisible();
  await expectAccessible(page);
});

test('a draft waiting for approval: edit it, then approve and send', async ({ page, seed }) => {
  await page.goto(`/threads/${seed.threads.dana}`);
  const draft = page.getByRole('article', { name: /^Draft:/ });
  await expect(draft.getByText('Waiting for approval')).toBeVisible();

  await draft.getByRole('button', { name: 'Edit' }).click();
  // The stored body ends with the compliance footer; the edit keeps it, or the linter blocks sending.
  const text = draft.getByRole('textbox', { name: 'Draft text' });
  await text.fill((await text.inputValue()).replace('Worth a 20-minute call to see if it fits?', 'Want a 20-minute call?'));
  await draft.getByRole('button', { name: 'Save' }).click();
  await expect(draft.getByText('Want a 20-minute call?')).toBeVisible();

  await draft.getByRole('button', { name: 'Approve and send' }).click();
  await expect(draft).toBeHidden();
  await expect(page.getByText('Want a 20-minute call?').first()).toBeVisible();
});

test('a rejected draft needs a reason; regenerating says the agent is off', async ({ page, seed }) => {
  await page.goto(`/threads/${seed.threads.dana}`);
  const draft = page.getByRole('article', { name: /^Draft:/ });

  await draft.getByRole('button', { name: 'Regenerate' }).click();
  await draft.getByRole('textbox', { name: 'Feedback' }).fill('Lead with the price, then the call.');
  await draft.getByRole('button', { name: 'Regenerate' }).click();
  await expect(alertIn(draft)).toContainText('The AI agent is off');
  // A failed redraft loses nothing: the draft is still there.
  await expect(draft.getByText('Waiting for approval')).toBeVisible();
  await draft.getByRole('button', { name: 'Cancel' }).click();

  await draft.getByRole('button', { name: 'Reject' }).click();
  await draft.getByRole('textbox', { name: 'Why it is rejected' }).fill('Pricing is negotiated by sales');
  await draft.getByRole('button', { name: 'Reject' }).click();
  await expect(draft).toBeHidden();
});

test('the composer sends a reply, and Ask AI to draft says the agent is off', async ({ page, seed }) => {
  await page.goto(`/threads/${seed.threads.priya}`);
  const composer = page.getByRole('form', { name: 'Reply' });
  await composer.getByRole('button', { name: 'Ask AI to draft' }).click();
  await composer.getByRole('textbox', { name: 'Guidance for the agent' }).fill('Answer the SSO question first');
  await composer.getByRole('button', { name: 'Draft', exact: true }).click();
  await expect(alertIn(composer)).toContainText('The AI agent is off');

  await page.keyboard.press('Escape');
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await page.keyboard.press('r');
  const reply = composer.getByRole('textbox', { name: 'Your reply' });
  await expect(reply).toBeFocused();
  await reply.fill('Hi Priya, yes to SAML SSO on the Business plan; SCIM comes in Q1 2027.');
  await composer.getByLabel('How to send').selectOption('draft');
  await composer.getByRole('button', { name: 'Save draft' }).click();
  await expect(composer.getByText('Saved as a draft below.')).toBeVisible();
  const saved = page.getByRole('article', { name: /^Draft:/ });
  await expect(saved.getByText('Your draft')).toBeVisible();
  await saved.getByRole('button', { name: 'Approve and send' }).click();
  await expect(saved).toBeHidden();
});

test('taking over pauses the agent; handing back resumes it', async ({ page, seed }) => {
  await page.goto(`/threads/${seed.threads.ken}`);
  await page.getByRole('button', { name: 'Take over (pause AI)' }).click();
  await expect(panel(page, 'Status').getByText('You’re handling')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ask AI to draft' })).toBeHidden();
  await page.getByRole('button', { name: 'Hand back to the agent' }).click();
  await expect(panel(page, 'Status').getByText('You’re handling')).toBeHidden();

  await page.getByRole('button', { name: 'Assign to me' }).click();
  await expect(page.getByRole('button', { name: 'Unassign me' })).toBeVisible();
});

test('E2E-14, in a thread: skip a follow-up, stop follow-ups, resume them', async ({ page, seed }) => {
  await page.goto(`/threads/${seed.threads.ken}`);
  const status = panel(page, 'Status');
  await expect(status).toContainText('Follow-up');
  await expect(status).toContainText('Step 1 next · 0 sent');

  await status.getByRole('button', { name: 'Stop follow-ups' }).click();
  await expect(status).toContainText('Stopped · 0 sent');
  await status.getByRole('button', { name: 'Resume follow-ups' }).click();
  await expect(status).toContainText('Step 1 next');

  await status.getByRole('button', { name: 'Skip' }).click();
  await expect(status).toContainText('Sequence finished');

  await status.getByRole('button', { name: 'Pause thread' }).click();
  await expect(status.getByRole('button', { name: 'Resume thread' })).toBeVisible();
  await expect(status).toContainText('Paused');
  await status.getByRole('button', { name: 'Resume thread' }).click();
  await expect(status.getByRole('button', { name: 'Pause thread' })).toBeVisible();
});

test('marking a goal by hand, and revoking it', async ({ page, seed }) => {
  await page.goto(`/threads/${seed.threads.ken}`);
  const goals = panel(page, 'Goals');
  await goals.locator('li', { hasText: 'Call booked' }).getByRole('button', { name: 'Mark achieved…' }).click();
  await goals.getByRole('textbox', { name: 'Evidence' }).fill('Booked by phone');
  await goals.getByRole('button', { name: 'Mark “Call booked” achieved' }).click();
  await expect(page.getByRole('list', { name: 'Stage' }).getByText('Call booked (reached)')).toBeAttached();

  await goals.getByRole('button', { name: 'Revoke…' }).click();
  await goals.getByRole('textbox', { name: 'Why it was wrong' }).fill('Wrong contact');
  await goals.getByRole('button', { name: 'Revoke', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Stage' }).getByText('Call booked (not yet)')).toBeAttached();
});

test('closing a thread', async ({ page, seed }) => {
  await page.goto(`/threads/${seed.threads.ken}`);
  await page.getByRole('button', { name: 'Close…' }).click();
  await page.getByLabel('Why').selectOption({ label: 'Went quiet' });
  await page.getByRole('textbox', { name: 'Note' }).fill('No answer after the conference');
  await page.getByRole('button', { name: 'Close thread' }).click();
  await expect(page.getByRole('button', { name: 'Close…' })).toBeHidden();
  await expect(panel(page, 'Status')).toContainText('Closed');
});

test('a thread that does not exist says so, with the request ID and Retry', async ({ page }) => {
  await page.goto('/threads/thr_01aaaaaaaaaaaaaaaaaaaaaaaa');
  const alert = alertIn(page);
  await expect(alert).toContainText('The thread was not found in this workspace.');
  await expect(alert).toContainText(/Request \S+/);
  await expect(alert.getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Inbox' }).last()).toBeVisible();
});
