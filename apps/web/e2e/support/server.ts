// Starts the app for the end-to-end suite; Playwright runs it as its webServer. It creates the
// database named in E2E_DATABASE_URL on the server behind TEST_DATABASE_URL, migrates it, runs
// `next start` on the production build in .next, and drops the database again when Playwright stops
// it (SIGTERM) or the app exits.
//
// Everything that would reach a billed or outside service stays off: no Claude (AI_ENABLED=false,
// no ANTHROPIC_API_KEY), no Jev, no push, no OAuth, no system mail, no S3. Each is set to an empty
// string rather than left out, so a developer's .env.local can't switch it back on (Next keeps
// values already in the environment, empty or not).

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDb } from '@catalyst/db';
import { MIGRATIONS_FOLDER } from '@catalyst/db/testing';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

const webDir = fileURLToPath(new URL('../..', import.meta.url));
const adminUrl = process.env.TEST_DATABASE_URL;
const target = process.env.E2E_DATABASE_URL;
const appUrl = process.env.E2E_APP_URL;
if (!adminUrl || !target || !appUrl) throw new Error('TEST_DATABASE_URL, E2E_DATABASE_URL and E2E_APP_URL must be set (playwright.config.ts sets the last two).');
const name = new URL(target).pathname.slice(1);
if (!/^catalyst_e2e_[a-z0-9_]+$/.test(name)) throw new Error(`Refusing to manage database ${name}: end-to-end databases are named catalyst_e2e_….`);
if (!existsSync(join(webDir, '.next', 'BUILD_ID'))) throw new Error('No production build in apps/web/.next: run `pnpm --filter @catalyst/web build` first (test:e2e does).');

const admin = createDb(adminUrl).pool;
await admin.query(`create database ${name}`);
const { db, pool } = createDb(target);
await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
await pool.end();

const storageDir = process.env.E2E_STORAGE_DIR ?? mkdtempSync(join(tmpdir(), 'catalyst-e2e-'));
mkdirSync(storageDir, { recursive: true });
const secret = () => randomBytes(32).toString('base64');
const OFF = ['ANTHROPIC_API_KEY', 'AI_CANARY_SECRET', 'TYPESAFE_API_KEY', 'TYPESAFE_MODEL', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT', 'GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'MICROSOFT_OAUTH_CLIENT_ID', 'MICROSOFT_OAUTH_CLIENT_SECRET', 'SYSTEM_SMTP_URL', 'SYSTEM_FROM', 'SPAMHAUS_DQS_KEY', 'S3_BUCKET', 'S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'TRACKING_CNAME_TARGET'];
const env: NodeJS.ProcessEnv = {
  ...process.env,
  ...Object.fromEntries(OFF.map((key) => [key, ''])),
  AI_ENABLED: 'false',
  DATABASE_URL: target,
  APP_URL: appUrl,
  BETTER_AUTH_SECRET: secret(),
  ENCRYPTION_KEYS: `1:${secret()}`,
  TRACKING_SIGNING_SECRET: process.env.E2E_TRACKING_SECRET ?? secret(),
  STORAGE_DIR: storageDir,
};

// Bound to 127.0.0.1 whatever APP_URL's host is called; browsers fall back to it for localhost.
const { port } = new URL(appUrl);
const next = spawn(join(webDir, 'node_modules', '.bin', 'next'), ['start', '--hostname', '127.0.0.1', '--port', port], { cwd: webDir, env, stdio: 'inherit' });

let stopping: Promise<void> | undefined;
function stop(code: number): Promise<void> {
  stopping ??= (async () => {
    if (next.exitCode === null && next.signalCode === null) {
      next.kill('SIGTERM');
      await new Promise((resolve) => next.once('exit', resolve));
    }
    await admin.query(`drop database if exists ${name} with (force)`).catch((error: unknown) => console.error(`[e2e] Couldn't drop ${name}:`, error));
    await admin.end();
    rmSync(storageDir, { recursive: true, force: true });
    process.exit(code);
  })();
  return stopping;
}
process.on('SIGTERM', () => void stop(0));
process.on('SIGINT', () => void stop(0));
next.on('exit', (code, signal) => void stop(signal ? 0 : (code ?? 1)));
