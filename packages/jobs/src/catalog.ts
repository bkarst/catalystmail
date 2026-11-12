// The job catalog (spec §4.4): every background job, its payload and how its queue behaves. Jobs are
// added here as their handlers are built.

import { z } from 'zod';

const id = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[0-9a-z]{26}$`));

export interface QueueSettings {
  /** pg-boss queue policy: `stately` keeps at most one queued and one running job per key. */
  policy: 'standard' | 'stately' | 'singleton';
  retryLimit: number;
  retryDelaySeconds: number;
  expireInSeconds: number;
}

export interface JobDefinition<Payload extends z.ZodType> {
  payload: Payload;
  queue: QueueSettings;
  /** Jobs with the same key are deduplicated or serialized, depending on the policy. */
  singletonKey?: (data: z.infer<Payload>) => string;
  /** A delay before the job may run, in seconds: the debounce for `thread.evaluate`. */
  delaySeconds?: number;
}

const define = <P extends z.ZodType>(definition: JobDefinition<P>) => definition;

export const JOBS = {
  /** Recomputes a thread's stage, state and next action (§5.6). Singleton per thread, debounced 2 s. */
  'thread.evaluate': define({
    payload: z.object({ thread_id: id('thr') }),
    queue: { policy: 'stately', retryLimit: 5, retryDelaySeconds: 5, expireInSeconds: 60 },
    singletonKey: (data) => data.thread_id,
    delaySeconds: 2,
  }),
  /** Applies a committed import (§12.3). */
  'import.process': define({
    payload: z.object({ import_id: id('imp') }),
    queue: { policy: 'stately', retryLimit: 2, retryDelaySeconds: 30, expireInSeconds: 30 * 60 },
    singletonKey: (data) => data.import_id,
  }),
  /** Verifies one contact's address in the background (§8.5). */
  'contact.verify': define({
    payload: z.object({ contact_id: id('ctc') }),
    queue: { policy: 'stately', retryLimit: 3, retryDelaySeconds: 60, expireInSeconds: 120 },
    singletonKey: (data) => data.contact_id,
  }),
  /** Finds due threads, composes their emails within capacity and windows (§7.2). Every minute. */
  'scheduler.tick': define({
    payload: z.object({ workspace_id: id('wsp').optional() }),
    queue: { policy: 'singleton', retryLimit: 0, retryDelaySeconds: 0, expireInSeconds: 120 },
    singletonKey: () => 'tick',
  }),
  /** The pre-send guard and SMTP submission of one scheduled email (§7.2 steps 5–8). */
  'outbound.send': define({
    payload: z.object({ message_id: id('msg') }),
    queue: { policy: 'stately', retryLimit: 3, retryDelaySeconds: 60, expireInSeconds: 300 },
    singletonKey: (data) => data.message_id,
  }),
  /** Evaluates a thread once the delivery grace has passed after a send, so it can count as received (§5.3). */
  'delivery.confirm': define({
    payload: z.object({ thread_id: id('thr'), message_id: id('msg') }),
    queue: { policy: 'stately', retryLimit: 5, retryDelaySeconds: 60, expireInSeconds: 60 },
    singletonKey: (data) => data.message_id,
  }),
  /** Saves the exact raw message to the mailbox's Sent folder, `\Seen`, when the provider doesn't (§7.2 step 8). */
  'outbound.append_sent': define({
    payload: z.object({ message_id: id('msg') }),
    queue: { policy: 'stately', retryLimit: 5, retryDelaySeconds: 120, expireInSeconds: 300 },
    singletonKey: (data) => data.message_id,
  }),
  /** Looks for a `send_unknown` email in Sent: found means sent; otherwise it is retried once (§7.2 step 7). */
  'outbound.reconcile': define({
    payload: z.object({ message_id: id('msg') }),
    queue: { policy: 'stately', retryLimit: 0, retryDelaySeconds: 0, expireInSeconds: 300 },
    singletonKey: (data) => data.message_id,
  }),
  /** Moves each domain's ramp and each mailbox's warm-up once per workspace day (§8.3.2). Hourly at :05; a moved domain is skipped. */
  'capacity.plan': define({
    payload: z.object({}),
    queue: { policy: 'singleton', retryLimit: 2, retryDelaySeconds: 120, expireInSeconds: 900 },
    singletonKey: () => 'all',
  }),
  /** Recomputes mailbox health and domain reputation, fills today's domain stats and trips breakers (§8.9, §8.10). Hourly. */
  'mailbox.stats_rollup': define({
    payload: z.object({}),
    queue: { policy: 'singleton', retryLimit: 2, retryDelaySeconds: 120, expireInSeconds: 900 },
    singletonKey: () => 'all',
  }),
  /** Every domain's SPF, DKIM, DMARC, MX and tracking CNAME again (§8.2). Daily. */
  'deliverability.dns_check': define({
    payload: z.object({}),
    queue: { policy: 'singleton', retryLimit: 2, retryDelaySeconds: 300, expireInSeconds: 1800 },
    singletonKey: () => 'all',
  }),
  /** Every domain against Spamhaus DBL, SURBL and URIBL (§8.10). Every 6 hours. */
  /** §8.10: Gmail spam and authentication rates and compliance from Postmaster Tools, daily and on connect. */
  'deliverability.postmaster_sync': define({
    payload: z.object({ domain_id: id('dom').optional() }),
    queue: { policy: 'singleton', retryLimit: 1, retryDelaySeconds: 600, expireInSeconds: 1800 },
    singletonKey: (data) => data.domain_id ?? 'all',
  }),
  'deliverability.blocklist_check': define({
    payload: z.object({}),
    queue: { policy: 'singleton', retryLimit: 2, retryDelaySeconds: 300, expireInSeconds: 1800 },
    singletonKey: () => 'all',
  }),
  /** Turns new activities into webhook deliveries for every subscribed endpoint (§13.6). Every minute. */
  'webhook.dispatch': define({
    payload: z.object({}),
    queue: { policy: 'singleton', retryLimit: 0, retryDelaySeconds: 0, expireInSeconds: 120 },
    singletonKey: () => 'all',
  }),
  /** One attempt at one delivery; a failure queues the next attempt itself (§13.6). */
  'webhook.deliver': define({
    payload: z.object({ delivery_id: id('whd') }),
    queue: { policy: 'stately', retryLimit: 0, retryDelaySeconds: 0, expireInSeconds: 60 },
    singletonKey: (data) => data.delivery_id,
  }),
  /** Turns alerting activities into notifications and sends what is due (§11.2). Every minute. */
  'notify.dispatch': define({
    payload: z.object({}),
    queue: { policy: 'singleton', retryLimit: 0, retryDelaySeconds: 0, expireInSeconds: 120 },
    singletonKey: () => 'all',
  }),
  /** The daily digest, once per person per workspace day after 08:00 (§4.4). Hourly. */
  'notify.digest': define({
    payload: z.object({}),
    queue: { policy: 'singleton', retryLimit: 1, retryDelaySeconds: 300, expireInSeconds: 600 },
    singletonKey: () => 'all',
  }),
  /** The agent reads a human reply and answers it: analysis, policy, draft, guardrails, autonomy (§10.4). */
  'ai.process_inbound': define({
    payload: z.object({ message_id: id('msg') }),
    queue: { policy: 'stately', retryLimit: 1, retryDelaySeconds: 60, expireInSeconds: 600 },
    singletonKey: (data) => data.message_id,
  }),
  /** The agent writes the check-in a contact asked for (§5.10 rule 5), then it is stored like a reply. */
  'ai.check_in': define({
    payload: z.object({ thread_id: id('thr'), mailbox_id: id('mbx'), scheduled_for: z.iso.datetime() }),
    queue: { policy: 'stately', retryLimit: 1, retryDelaySeconds: 60, expireInSeconds: 600 },
    singletonKey: (data) => data.thread_id,
  }),
  /** §10.4: a campaign's goals changed, so its open conversations are read again. */
  'ai.reclassify_campaign': define({
    payload: z.object({ campaign_id: id('cmp') }),
    queue: { policy: 'singleton', retryLimit: 1, retryDelaySeconds: 300, expireInSeconds: 3600 },
    singletonKey: (data) => data.campaign_id,
  }),
  /** §10.7: Jev reads a reply on an external-agent campaign, for the harness. */
  'ai.classify_inbound': define({
    payload: z.object({ message_id: id('msg') }),
    queue: { policy: 'stately', retryLimit: 1, retryDelaySeconds: 60, expireInSeconds: 300 },
    singletonKey: (data) => data.message_id,
  }),
  /** Jev after a person's own email (§10.4): only goals act on it. */
  'ai.classify_outbound': define({
    payload: z.object({ message_id: id('msg') }),
    queue: { policy: 'stately', retryLimit: 1, retryDelaySeconds: 60, expireInSeconds: 300 },
    singletonKey: (data) => data.message_id,
  }),
  /** The rolling thread summary, after each inbound the agent read (§10.1). One at a time per thread. */
  'ai.summarize': define({
    payload: z.object({ thread_id: id('thr') }),
    queue: { policy: 'stately', retryLimit: 1, retryDelaySeconds: 60, expireInSeconds: 600 },
    singletonKey: (data) => data.thread_id,
  }),
  /** The agent writes an AI-mode step (opening line, adapted or written follow-up), then it is composed (§10.8). */
  'ai.compose': define({
    payload: z.object({ thread_id: id('thr'), step_id: id('stp'), mailbox_id: id('mbx'), scheduled_for: z.iso.datetime() }),
    queue: { policy: 'stately', retryLimit: 1, retryDelaySeconds: 60, expireInSeconds: 600 },
    singletonKey: (data) => data.thread_id,
  }),
  /** Wakes snoozed escalations and raises the priority of overdue ones (§11.1). Every 15 minutes. */
  /** §6.11 retention, daily: expired raw MIME, attachments, tracking events, AI outputs, idempotency keys. */
  'maintenance.retention': define({
    payload: z.object({}),
    queue: { policy: 'singleton', retryLimit: 1, retryDelaySeconds: 600, expireInSeconds: 3600 },
    singletonKey: () => 'all',
  }),
  'escalation.sla_check': define({
    payload: z.object({}),
    queue: { policy: 'singleton', retryLimit: 1, retryDelaySeconds: 60, expireInSeconds: 300 },
    singletonKey: () => 'all',
  }),
  /** One poll of one mailbox (§7.3); a singleton per mailbox, so a second request waits its turn. */
  'mail.poll': define({
    payload: z.object({
      mailbox_id: id('mbx'),
      trigger: z.enum(['schedule', 'manual', 'api', 'catch_up']),
      /** 0 for the first try; a failed poll is tried twice more (§7.3 step 4). */
      attempt: z.int().min(0).max(2).optional(),
      /** When the first try of this poll started, so its retries count as one run. */
      chain_started_at: z.iso.datetime().optional(),
    }),
    queue: { policy: 'stately', retryLimit: 2, retryDelaySeconds: 60, expireInSeconds: 600 },
    singletonKey: (data) => data.mailbox_id,
  }),
  /** Queues a poll of every mailbox, each with up to 2 minutes of jitter (§4.4). Every 30 minutes. */
  'mail.poll.all': define({
    payload: z.object({}),
    queue: { policy: 'singleton', retryLimit: 0, retryDelaySeconds: 0, expireInSeconds: 120 },
    singletonKey: () => 'all',
  }),
  /** Marks emails stuck in sending for 10 minutes as send_unknown (§7.2 step 7). Every 5 minutes. */
  'outbound.sweep': define({
    payload: z.object({}),
    queue: { policy: 'singleton', retryLimit: 0, retryDelaySeconds: 0, expireInSeconds: 120 },
    singletonKey: () => 'sweep',
  }),
};

export type JobName = keyof typeof JOBS;
export type JobPayload<N extends JobName> = z.infer<(typeof JOBS)[N]['payload']>;
export const JOB_NAMES = Object.keys(JOBS) as JobName[];
