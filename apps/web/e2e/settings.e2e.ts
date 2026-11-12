// Settings (spec §15.16, §16): every section, the workspace's details, inviting a teammate whose
// role limits what they see, E2E-08 (a draft-only API key, the `claude mcp add` command, an MCP call
// that can't reach the sending tools, the key's "last used"), two-factor sign-in end to end, and the
// workspace rule that makes owners use it.

import type { Page } from '@playwright/test';

import { clientAddress, expect, expectAccessible, test, totp } from './fixtures.ts';

const sections = (page: Page) => page.getByRole('navigation', { name: 'Settings sections' });

test('every section, and the workspace’s details', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  for (const name of ['Workspace', 'Team', 'AI', 'Notifications', 'Security', 'Integrations', 'Webhooks', 'API & agents']) {
    await sections(page).getByRole('button', { name }).click();
    await expect(sections(page).getByRole('button', { name })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByText('Loading…')).toHaveCount(0);
    await expectAccessible(page);
  }

  // The API section has a Name field too: wait for the Workspace panel itself.
  await sections(page).getByRole('button', { name: 'Workspace' }).click();
  const workspace = page.getByRole('region', { name: 'Workspace' });
  await workspace.getByLabel('Name', { exact: true }).fill('Acme Outreach');
  await workspace.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(workspace.getByRole('status')).toHaveText('Saved.');
  await page.reload();
  await expect(workspace.getByLabel('Name', { exact: true })).toHaveValue('Acme Outreach');
  await expect(page.getByRole('navigation', { name: 'Main' }).first()).toContainText('Acme Outreach');
});

test('a viewer invited to the team reads but doesn’t change', async ({ page, seed, browser, baseURL }) => {
  const email = `viewer.${seed.workspaceId.slice(-8)}@getacme.example`;
  await page.goto('/settings?section=team');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Name').fill('Vic Viewer');
  await page.getByRole('combobox', { name: 'Role', exact: true }).selectOption({ label: 'Viewer' });
  await page.getByRole('button', { name: 'Invite' }).click();
  await expect(page.getByRole('combobox', { name: 'Role of Vic Viewer' })).toHaveValue('viewer');

  const context = await browser.newContext({ baseURL, extraHTTPHeaders: { 'x-forwarded-for': clientAddress() } });
  const viewer = await context.newPage();
  await viewer.goto('/sign-in');
  await viewer.getByRole('button', { name: 'First time here? Set your password' }).click();
  await viewer.getByLabel('Email').fill(email);
  await viewer.getByLabel('Password').fill('a viewer’s long password');
  await viewer.getByRole('button', { name: 'Set password and sign in' }).click();
  await expect(viewer.getByText('Vic Viewer · viewer')).toBeVisible();
  await viewer.goto('/contacts');
  await expect(viewer.getByRole('table').getByRole('link', { name: 'Priya Natarajan' })).toBeVisible();
  await expect(viewer.getByRole('link', { name: 'Import' })).toHaveCount(0);
  await expect(viewer.getByRole('button', { name: 'Add contact' })).toHaveCount(0);
  await viewer.goto(`/threads/${seed.threads.dana}`);
  await expect(viewer.getByRole('article', { name: /^Draft:/ })).toBeVisible();
  await expect(viewer.getByRole('button', { name: 'Approve and send' })).toHaveCount(0);
  await expect(viewer.getByRole('form', { name: 'Reply' })).toHaveCount(0);
  await context.close();
});

test.describe('E2E-08', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  test('a draft-only key, the MCP command, an MCP call, and “last used”', async ({ page, baseURL }) => {
    await page.goto('/settings?section=api');
    const connect = page.getByRole('region', { name: 'Connect Claude Code' });
    await expect(connect.getByLabel('Make a key')).toHaveValue('draft');
    await connect.getByRole('button', { name: 'Create key' }).click();
    const secret = (await connect.getByRole('status').locator('code').textContent())!.trim();
    expect(secret).toMatch(/^ck_live_/);

    const command = `claude mcp add --transport http catalyst ${baseURL}/api/mcp \\\n  --header "Authorization: Bearer ${secret}"`;
    await expect(connect.locator('pre')).toHaveText(command);
    await connect.getByRole('button', { name: 'Copy the command' }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(command.replace('\\\n  ', ''));

    const keys = page.getByRole('region', { name: 'Keys' });
    const row = keys.getByRole('listitem').filter({ hasText: 'Claude Code (draft only)' });
    await expect(row).toContainText('(can’t send)');
    await expect(row).toContainText('never used');

    // What `claude mcp add` connects to: the key sees its tools, and none that send.
    const rpc = async (method: string, params: Record<string, unknown>) => {
      const response = await page.request.post('/api/mcp', { headers: { authorization: `Bearer ${secret}`, accept: 'application/json, text/event-stream' }, data: { jsonrpc: '2.0', id: 1, method, params } });
      expect(response.ok(), await response.text()).toBe(true);
      const text = await response.text();
      const json = text.trimStart().startsWith('{') ? text : text.split('\n').find((line) => line.startsWith('data: '))!.slice(6);
      return JSON.parse(json) as { result: Record<string, unknown> };
    };
    const listed = (await rpc('tools/list', {})).result.tools as { name: string }[];
    const names = listed.map((tool) => tool.name);
    expect(names).toContain('get_work_queue');
    expect(names).toContain('create_reply');
    expect(names).not.toContain('approve_draft');
    const called = await rpc('tools/call', { name: 'get_work_queue', arguments: {} });
    expect(called.result.isError ?? false).toBe(false);

    await page.reload();
    await expect(row).toContainText('last used');
    await expect(row).not.toContainText('never used');

    await row.getByRole('button', { name: 'Revoke…' }).click();
    await row.getByRole('button', { name: 'Revoke now: it stops working at once' }).click();
    await expect(keys.getByText('No keys yet.')).toBeVisible();
    const refused = await page.request.post('/api/mcp', { headers: { authorization: `Bearer ${secret}`, accept: 'application/json, text/event-stream' }, data: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} } });
    expect(refused.status()).toBe(401);
  });
});

test('two-factor sign-in: turn it on, sign in with a code, turn it off', async ({ page, seed }) => {
  await page.goto('/settings?section=security');
  const panel = page.getByRole('region', { name: 'Two-factor sign-in' });
  await panel.getByLabel('Your password, to start').fill(seed.owner.password);
  await panel.getByRole('button', { name: 'Set up two-factor sign-in' }).click();
  const uri = (await panel.getByRole('link', { name: /^otpauth:\/\// }).getAttribute('href'))!;
  await panel.getByLabel('The code the app shows now').fill(totp(uri));
  await panel.getByRole('button', { name: 'Confirm and turn on' }).click();
  await expect(panel.getByText('On', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByLabel('Email').fill(seed.owner.email);
  await page.getByLabel('Password').fill(seed.owner.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Enter your code' })).toBeVisible();
  await page.getByLabel('Code').fill(totp(uri));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();

  await page.goto('/settings?section=security');
  await panel.getByRole('button', { name: 'Turn off…' }).click();
  await panel.getByLabel('Your password').fill(seed.owner.password);
  await panel.getByRole('button', { name: 'Turn it off' }).click();
  await expect(panel.getByRole('button', { name: 'Set up two-factor sign-in' })).toBeVisible();
});

test('when owners must use two-factor, nothing else opens until it is set up', async ({ page, seed }) => {
  await page.goto('/settings?section=security');
  // The box follows the saved setting, so it changes once the server has it.
  const rule = page.getByRole('checkbox', { name: 'Owners must sign in with two-factor authentication' });
  await rule.click();
  await expect(page.getByRole('region', { name: 'Workspace rule' }).getByRole('status')).toHaveText('Saved.');
  await expect(rule).toBeChecked();

  await page.goto('/inbox');
  await expect(page).toHaveURL(/\/settings\?section=security/);
  await expect(page.getByRole('alert').filter({ hasText: 'This workspace requires owners' })).toBeVisible();
  const blocked = await page.request.get('/api/v1/threads');
  expect(blocked.status()).toBe(403);

  const panel = page.getByRole('region', { name: 'Two-factor sign-in' });
  await panel.getByLabel('Your password, to start').fill(seed.owner.password);
  await panel.getByRole('button', { name: 'Set up two-factor sign-in' }).click();
  const uri = (await panel.getByRole('link', { name: /^otpauth:\/\// }).getAttribute('href'))!;
  await panel.getByLabel('The code the app shows now').fill(totp(uri));
  await panel.getByRole('button', { name: 'Confirm and turn on' }).click();
  await expect(panel.getByText('On', { exact: true })).toBeVisible();
  await page.goto('/inbox');
  await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
});
