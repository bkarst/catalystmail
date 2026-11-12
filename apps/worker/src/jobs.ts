// What the worker does for each job in the catalog (spec §4.4). Handlers get the payload and the
// worker's dependencies; whatever they throw is retried by the queue with backoff.

import type { Db } from '@catalyst/db';
import type { ClaudeClient, JevClient } from '@catalyst/ai';
import type { BlocklistDns, DomainDns, ImapConnector, MailDns, SmtpTransport, SystemMailer } from '@catalyst/email';
import { JOBS, type JobName, type JobPayload, type JobQueue, type PgBoss } from '@catalyst/jobs';
import type { ObjectStorage } from '@catalyst/storage';
import {
  appendToSent,
  composeWithAgent,
  summarizeThread,
  classifyAfterOutbound,
  reclassifyCampaign,
  classifyForHarness,
  composeCheckIn,
  blocklistCheck,
  dailyDigest,
  dailyDnsCheck,
  deliverWebhook,
  dispatchNotifications,
  dispatchWebhooks,
  dailyCapacityPlan,
  escalationSlaCheck,
  evaluateThread,
  mailboxesToPoll,
  pollMailbox,
  processInboundReply,
  POLL_INTERVAL_MS,
  processImport,
  reconcileUnknownSend,
  schedulerTick,
  sendMessage,
  statsRollup,
  sweepStuckSends,
  verifyContactById,
  type AppConfig,
  type SecretBox,
  type WebhookNet,
  runRetention,
  syncPostmaster,
  fetchPostmasterHttp,
  type OAuthConfig,
  type PostmasterHttp,
} from '@catalyst/server';

export interface WorkerDeps {
  db: Db;
  dns: MailDns;
  /** DNS for the daily domain check and the blocklists (§8.2, §8.10). */
  domainDns: DomainDns;
  blocklistDns: BlocklistDns;
  /** HTTPS to webhook endpoints, refusing private addresses (§13.6). */
  webhookNet: WebhookNet;
  /** The system SMTP for alerts and digests (§11.2); null when SYSTEM_SMTP_URL isn't set. */
  mailer: SystemMailer | null;
  /** The Claude client when AI_ENABLED=true (§10.2); null keeps every reply with a person. */
  claude: ClaudeClient | null;
  /** Google and Microsoft OAuth clients for mailboxes' access tokens (§7.1). */
  oauth: OAuthConfig | null;
  /** Jev, TypeSafe's classifier (§10.4); null leaves Claude classifying alone. */
  jev: JevClient | null;
  /** The Postmaster Tools API; tests swap in a fake. */
  postmasterHttp?: PostmasterHttp;
  storage: ObjectStorage;
  jobs: JobQueue;
  smtp: SmtpTransport;
  imap: ImapConnector;
  secrets: SecretBox;
  config: AppConfig;
  rng: () => number;
  now: () => Date;
  log: (message: string, fields?: Record<string, unknown>) => void;
}

type Handler<N extends JobName> = (data: JobPayload<N>, deps: WorkerDeps) => Promise<unknown>;

export const handlers: { [N in JobName]?: Handler<N> } = {
  'thread.evaluate': async ({ thread_id }, deps) => {
    const result = await evaluateThread(deps.db, thread_id, { now: deps.now() });
    return result ? { changed: result.changed } : { missing: true };
  },
  'contact.verify': async ({ contact_id }, deps) => ({ outcome: await verifyContactById(deps.db, contact_id, deps.dns, deps.now()) }),
  'import.process': async ({ import_id }, deps) => ({ outcome: await processImport(deps.db, import_id, deps, deps.now()) }),
  'scheduler.tick': async (_data, deps) =>
    schedulerTick(deps.db, { jobs: deps.jobs, rng: deps.rng, trackingSecret: deps.config.trackingSecret ?? null, appHost: deps.config.appHost, ai: deps.claude !== null }, deps.now()),
  'outbound.send': async ({ message_id }, deps) => sendMessage(deps.db, message_id, deps),
  'delivery.confirm': async ({ thread_id }, deps) => {
    const result = await evaluateThread(deps.db, thread_id, { now: deps.now() });
    return result ? { changed: result.changed } : { missing: true };
  },
  'outbound.sweep': async (_data, deps) => ({ stuck: await sweepStuckSends(deps.db, deps, deps.now()) }),
  'outbound.append_sent': async ({ message_id }, deps) => ({ outcome: await appendToSent(deps.db, message_id, deps) }),
  'outbound.reconcile': async ({ message_id }, deps) => ({ outcome: await reconcileUnknownSend(deps.db, message_id, deps) }),
  'mail.poll': async ({ mailbox_id, trigger, attempt, chain_started_at }, deps) => {
    const result = await pollMailbox(deps.db, mailbox_id, trigger, { ...deps, now: deps.now, ai: deps.claude !== null }, { attempt: attempt ?? 0, ...(chain_started_at && { chainStartedAt: new Date(chain_started_at) }) });
    return { status: result.status, fetched: result.fetched, matched: result.matched, ignored: result.ignored, retry_at: result.retryAt?.toISOString() ?? null };
  },
  'deliverability.dns_check': async (_data, deps) => dailyDnsCheck(deps.db, { domainDns: deps.domainDns, trackingTarget: deps.config.trackingTarget }, deps.now()),
  'deliverability.blocklist_check': async (_data, deps) => blocklistCheck(deps.db, { dns: deps.blocklistDns, spamhausDqsKey: deps.config.spamhausDqsKey ?? null }, deps.now()),
  'webhook.dispatch': async (_data, deps) => dispatchWebhooks(deps.db, deps),
  'webhook.deliver': async ({ delivery_id }, deps) => {
    const delivery = await deliverWebhook(deps.db, delivery_id, { net: deps.webhookNet, secrets: deps.secrets, jobs: deps.jobs, now: deps.now });
    return delivery ? { status: delivery.status, attempt: delivery.attempt, response_status: delivery.response_status } : { missing: true };
  },
  'notify.dispatch': async (_data, deps) => dispatchNotifications(deps.db, notifyDeps(deps)),
  'notify.digest': async (_data, deps) => dailyDigest(deps.db, notifyDeps(deps)),
  'ai.process_inbound': async ({ message_id }, deps) => (deps.claude ? processInboundReply(deps.db, message_id, agentDeps(deps, deps.claude)) : { outcome: 'skipped', why: 'AI is off' }),
  'ai.compose': async ({ thread_id, step_id, mailbox_id, scheduled_for }, deps) =>
    deps.claude ? composeWithAgent(deps.db, { threadId: thread_id, stepId: step_id, mailboxId: mailbox_id, scheduledFor: new Date(scheduled_for) }, agentDeps(deps, deps.claude)) : { status: 'skipped', why: 'AI is off' },
  'ai.check_in': async ({ thread_id, mailbox_id, scheduled_for }, deps) =>
    deps.claude ? composeCheckIn(deps.db, { threadId: thread_id, mailboxId: mailbox_id, scheduledFor: new Date(scheduled_for) }, agentDeps(deps, deps.claude)) : { status: 'skipped', why: 'AI is off' },
  'ai.classify_inbound': async ({ message_id }, deps) => classifyForHarness(deps.db, message_id, { jev: deps.jev, jevModel: deps.config.jevModel ?? null, jobs: deps.jobs, now: deps.now(), canarySecret: deps.config.canarySecret ?? 'catalyst-canary' }),
  'ai.reclassify_campaign': async ({ campaign_id }, deps) => (deps.claude ? reclassifyCampaign(deps.db, campaign_id, agentDeps(deps, deps.claude)) : { classified: 0, skipped: 0 }),
  'ai.classify_outbound': async ({ message_id }, deps) => (deps.claude ? classifyAfterOutbound(deps.db, message_id, agentDeps(deps, deps.claude)) : { status: 'skipped', why: 'AI is off' }),
  'ai.summarize': async ({ thread_id }, deps) => (deps.claude ? summarizeThread(deps.db, thread_id, agentDeps(deps, deps.claude)) : { status: 'skipped', why: 'AI is off' }),
  'capacity.plan': async (_data, deps) => dailyCapacityPlan(deps.db, deps.now()),
  'mailbox.stats_rollup': async (_data, deps) => statsRollup(deps.db, deps.now()),
  'escalation.sla_check': async (_data, deps) => escalationSlaCheck(deps.db, deps.now()),
  'deliverability.postmaster_sync': async ({ domain_id }, deps) => syncPostmaster(deps.db, { secrets: deps.secrets, oauth: deps.oauth, http: deps.postmasterHttp ?? fetchPostmasterHttp }, deps.now(), domain_id),
  'maintenance.retention': async (_data, deps) => runRetention(deps.db, { storage: deps.storage }, deps.now()),
  'mail.poll.all': async (_data, deps) => ({ queued: await queuePolls(deps, 'schedule') }),
};

const agentDeps = (deps: WorkerDeps, claude: ClaudeClient) => ({
  claude,
  jobs: deps.jobs,
  rng: deps.rng,
  now: deps.now(),
  canarySecret: deps.config.canarySecret ?? 'catalyst-canary',
  trackingSecret: deps.config.trackingSecret ?? null,
  appHost: deps.config.appHost,
  jev: deps.jev,
  jevModel: deps.config.jevModel ?? null,
});

const notifyDeps = (deps: WorkerDeps) => ({ mailer: deps.mailer, net: deps.webhookNet, secrets: deps.secrets, appUrl: deps.config.appUrl ?? null, vapid: deps.config.vapid ?? null, now: deps.now });

/** Up to 2 minutes of random delay per mailbox, so polls don't all start at :00 and :30 (§4.4). */
const POLL_JITTER_MS = 120_000;

/**
 * Queues a poll of every mailbox that is polled (active and paused). With `catch_up`, only those
 * last polled more than 30 minutes ago, with no jitter: run on worker start (§4.4).
 */
export async function queuePolls(deps: WorkerDeps, trigger: 'schedule' | 'catch_up'): Promise<number> {
  const now = deps.now();
  let queued = 0;
  for (const mailbox of await mailboxesToPoll(deps.db)) {
    if (trigger === 'catch_up' && mailbox.lastPollAt && now.getTime() - mailbox.lastPollAt.getTime() <= POLL_INTERVAL_MS) continue;
    const startAfter = trigger === 'schedule' ? new Date(now.getTime() + Math.floor(deps.rng() * POLL_JITTER_MS)) : now;
    if (await deps.jobs.enqueue('mail.poll', { mailbox_id: mailbox.id, trigger }, { startAfter })) queued += 1;
  }
  return queued;
}

/** How many jobs of each kind one worker process runs at once (§4.4). */
const CONCURRENCY: { [N in JobName]?: number } = {
  'thread.evaluate': 8,
  'contact.verify': 4,
  'import.process': 1,
  'scheduler.tick': 1,
  // Per-mailbox serialisation is the pre-send guard's job; this bounds SMTP connections overall.
  'outbound.send': 4,
  'delivery.confirm': 4,
  'outbound.sweep': 1,
  'outbound.append_sent': 2,
  'outbound.reconcile': 2,
  // One IMAP connection per mailbox poll; the queue keeps each mailbox to one at a time.
  'mail.poll': 4,
  'mail.poll.all': 1,
  'escalation.sla_check': 1,
  'deliverability.postmaster_sync': 1,
  'maintenance.retention': 1,
  'capacity.plan': 1,
  'mailbox.stats_rollup': 1,
  'deliverability.dns_check': 1,
  'deliverability.blocklist_check': 1,
  'webhook.dispatch': 1,
  // Per-endpoint order isn't promised (§13.6: at least once), so deliveries run in parallel.
  'webhook.deliver': 8,
  'notify.dispatch': 1,
  'notify.digest': 1,
  // Claude calls take seconds; a few at once keeps up with replies without bursting the API.
  'ai.process_inbound': 4,
  'ai.compose': 4,
  'ai.summarize': 4,
  'ai.classify_outbound': 4,
  'ai.reclassify_campaign': 1,
  'ai.classify_inbound': 4,
  'ai.check_in': 4,
};

/** Cron schedules (§4.4). */
export const SCHEDULES: { name: JobName; cron: string }[] = [
  { name: 'scheduler.tick', cron: '* * * * *' },
  { name: 'outbound.sweep', cron: '*/5 * * * *' },
  { name: 'mail.poll.all', cron: '*/30 * * * *' },
  { name: 'escalation.sla_check', cron: '*/15 * * * *' },
  // Hourly, because each workspace's day starts at its own midnight; the job acts once per day.
  { name: 'capacity.plan', cron: '5 * * * *' },
  { name: 'mailbox.stats_rollup', cron: '20 * * * *' },
  { name: 'deliverability.dns_check', cron: '40 4 * * *' },
  { name: 'deliverability.blocklist_check', cron: '50 */6 * * *' },
  { name: 'webhook.dispatch', cron: '* * * * *' },
  { name: 'notify.dispatch', cron: '* * * * *' },
  { name: 'notify.digest', cron: '10 * * * *' },
  { name: 'maintenance.retention', cron: '30 3 * * *' },
  { name: 'deliverability.postmaster_sync', cron: '15 6 * * *' },
];

export async function registerSchedules(boss: PgBoss): Promise<void> {
  for (const { name, cron } of SCHEDULES) await boss.schedule(name, cron, {});
}

export async function registerHandlers(boss: PgBoss, deps: WorkerDeps): Promise<JobName[]> {
  const registered: JobName[] = [];
  for (const name of Object.keys(handlers) as JobName[]) {
    const handler = handlers[name] as Handler<JobName>;
    await boss.work<JobPayload<JobName>>(name, { localConcurrency: CONCURRENCY[name] ?? 1, pollingIntervalSeconds: 1 }, async ([job]) => {
      const data = JOBS[name].payload.parse(job!.data) as JobPayload<JobName>;
      const started = Date.now();
      try {
        const result = await handler(data, deps);
        deps.log('job done', { job: name, job_id: job!.id, ms: Date.now() - started });
        return result;
      } catch (error) {
        deps.log('job failed', { job: name, job_id: job!.id, error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    });
    registered.push(name);
  }
  return registered;
}
