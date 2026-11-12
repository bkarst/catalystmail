// The worker process (spec D8): starts the queue, runs every job that has a handler, and drains on
// SIGTERM, letting running jobs finish for up to 60 seconds (§17).

import { createDb } from '@catalyst/db';
import { imapflowConnector, nodemailerTransport, systemBlocklistDns, systemDomainDns, systemMailDns, systemMailer } from '@catalyst/email';
import { PgBossQueue } from '@catalyst/jobs';
import { anthropicClaude, typesafeJev } from '@catalyst/ai';
import { configFromEnv, httpsWebhookNet, oauthFromEnv, secretBoxFromEnv } from '@catalyst/server';
import { storageFromEnv } from '@catalyst/storage';

import { queuePolls, registerHandlers, registerSchedules, type WorkerDeps } from './jobs.ts';

const log = (message: string, fields: Record<string, unknown> = {}) =>
  process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), level: 'info', message, ...fields })}\n`);

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const { db, pool } = createDb(url);
  const queue = new PgBossQueue({ connectionString: url, role: 'worker' });
  await queue.start();
  const smtp = nodemailerTransport();
  const config = configFromEnv();
  const deps: WorkerDeps = {
    db,
    dns: await systemMailDns(),
    domainDns: await systemDomainDns(),
    blocklistDns: await systemBlocklistDns(),
    webhookNet: httpsWebhookNet(),
    mailer: process.env.SYSTEM_SMTP_URL ? systemMailer(process.env.SYSTEM_SMTP_URL, process.env.SYSTEM_FROM ?? 'Catalyst <no-reply@localhost>') : null,
    storage: storageFromEnv(),
    jobs: queue,
    smtp,
    imap: imapflowConnector(),
    secrets: secretBoxFromEnv(),
    config,
    // The SDK finds credentials itself (ANTHROPIC_API_KEY or a profile).
    claude: config.aiEnabled ? anthropicClaude() : null,
    // Jev runs only with the agent, and only on a pinned model (§10.4).
    jev: config.aiEnabled && config.jevModel ? typesafeJev() : null,
    oauth: oauthFromEnv(),
    rng: Math.random,
    now: () => new Date(),
    log,
  };
  const registered = await registerHandlers(queue.boss, deps);
  await registerSchedules(queue.boss);
  // Mailboxes not polled for over 30 minutes (the worker was down) are polled now (§4.4).
  const caughtUp = await queuePolls(deps, 'catch_up');
  log('worker started', { jobs: registered, catch_up_polls: caughtUp });

  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log('worker stopping', { signal });
    await queue.stop({ graceful: true, timeoutSeconds: 60 });
    await smtp.close();
    await pool.end();
    log('worker stopped');
    process.exit(0);
  };
  process.on('SIGTERM', () => void stop('SIGTERM'));
  process.on('SIGINT', () => void stop('SIGINT'));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
