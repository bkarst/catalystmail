// Enqueuing jobs. `PgBossQueue` stores them in PostgreSQL (D7); passing `db` puts the job in the
// caller's transaction, so it exists exactly when the change that caused it does.
// `MemoryQueue` records jobs for tests.

import type { Executor } from '@catalyst/db';
import { sql } from 'drizzle-orm';
import { fromDrizzle, PgBoss } from 'pg-boss';

import { JOB_NAMES, JOBS, type JobName, type JobPayload } from './catalog.ts';

export interface EnqueueOptions {
  /** The transaction (or handle) to enqueue in. */
  db?: Executor;
  /** Run no earlier than this. */
  startAfter?: Date;
}

export interface JobQueue {
  /** Returns the job ID, or null when an identical job was already waiting. */
  enqueue<N extends JobName>(name: N, data: JobPayload<N>, options?: EnqueueOptions): Promise<string | null>;
}

export interface EnqueuedJob {
  name: JobName;
  data: unknown;
  startAfter: Date | null;
}

export class MemoryQueue implements JobQueue {
  readonly jobs: EnqueuedJob[] = [];

  async enqueue<N extends JobName>(name: N, data: JobPayload<N>, options: EnqueueOptions = {}): Promise<string | null> {
    JOBS[name].payload.parse(data);
    this.jobs.push({ name, data, startAfter: options.startAfter ?? null });
    return `job-${this.jobs.length}`;
  }

  /** The payloads enqueued under one name, in order. */
  of<N extends JobName>(name: N): JobPayload<N>[] {
    return this.jobs.filter((job) => job.name === name).map((job) => job.data as JobPayload<N>);
  }

  clear(): void {
    this.jobs.length = 0;
  }
}

export interface PgBossQueueOptions {
  connectionString: string;
  /** Only the worker runs maintenance and cron; the web app just enqueues. */
  role: 'worker' | 'producer';
  max?: number;
}

export class PgBossQueue implements JobQueue {
  readonly boss: PgBoss;
  #started: Promise<void> | null = null;

  constructor(options: PgBossQueueOptions) {
    const worker = options.role === 'worker';
    this.boss = new PgBoss({
      connectionString: options.connectionString,
      max: options.max ?? (worker ? 10 : 2),
      supervise: worker,
      schedule: worker,
      migrate: true,
    });
    this.boss.on('error', (error) => console.error('[jobs]', error));
  }

  /** Starts pg-boss and makes sure every queue in the catalog exists. Safe to call more than once. */
  start(): Promise<void> {
    this.#started ??= (async () => {
      await this.boss.start();
      const existing = new Set((await this.boss.getQueues()).map((queue) => queue.name));
      for (const name of JOB_NAMES) {
        if (existing.has(name)) continue;
        const { policy, retryLimit, retryDelaySeconds, expireInSeconds } = JOBS[name].queue;
        await this.boss.createQueue(name, { policy, retryLimit, retryDelay: retryDelaySeconds, retryBackoff: true, expireInSeconds });
      }
    })();
    return this.#started;
  }

  async stop(options: { graceful?: boolean; timeoutSeconds?: number } = {}): Promise<void> {
    if (!this.#started) return;
    await this.boss.stop({ graceful: options.graceful ?? true, timeout: (options.timeoutSeconds ?? 60) * 1000 });
    this.#started = null;
  }

  async enqueue<N extends JobName>(name: N, data: JobPayload<N>, options: EnqueueOptions = {}): Promise<string | null> {
    await this.start();
    const definition = JOBS[name];
    const payload = definition.payload.parse(data) as object;
    const startAfter = options.startAfter ?? (definition.delaySeconds ? new Date(Date.now() + definition.delaySeconds * 1000) : undefined);
    return this.boss.send(name, payload, {
      ...(definition.singletonKey && { singletonKey: (definition.singletonKey as (value: unknown) => string)(payload) }),
      ...(startAfter && { startAfter }),
      ...(options.db && { db: fromDrizzle(options.db as never, sql as never) }),
    });
  }
}
