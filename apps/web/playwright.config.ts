// The end-to-end suite (spec §19.6): the UI of §15 in Chromium, against the production build and a
// throwaway database on the PostgreSQL server behind TEST_DATABASE_URL. Run it with
// `pnpm --filter @catalyst/web test:e2e` (builds first) or, after a build, `pnpm exec playwright test`.

import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { defineConfig, devices } from '@playwright/test';

const admin = process.env.TEST_DATABASE_URL;
if (!admin) throw new Error('The end-to-end suite needs TEST_DATABASE_URL: a PostgreSQL 15+ server it may create a database on.');

// Chosen once, in the runner process; its workers and the web server inherit them. The tests need
// the database (to seed it), the tracking secret (to sign unsubscribe and open links) and the
// storage directory (to run an import's job in place of the worker).
const run = randomBytes(4).toString('hex');
// A host name, not 127.0.0.1: unsubscribe links point at the app's host, and the content linter
// rightly blocks links to IP addresses (§8.7).
process.env.E2E_APP_URL ??= `http://localhost:${process.env.E2E_PORT ?? 3210}`;
if (!process.env.E2E_DATABASE_URL) {
  const url = new URL(admin);
  url.pathname = `/catalyst_e2e_${run}`;
  process.env.E2E_DATABASE_URL = url.toString();
}
process.env.E2E_TRACKING_SECRET ??= randomBytes(32).toString('base64');
process.env.E2E_STORAGE_DIR ??= join(tmpdir(), `catalyst-e2e-${run}`);
const baseURL = process.env.E2E_APP_URL;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node e2e/support/server.ts',
    url: `${baseURL}/sw.js`,
    timeout: 120_000,
    stdout: 'pipe',
    gracefulShutdown: { signal: 'SIGTERM', timeout: 15_000 },
  },
});
