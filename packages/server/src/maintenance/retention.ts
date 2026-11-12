// `maintenance.retention` (spec §6.11), daily: what Catalyst keeps for a limited time is removed
// once its time is up. Raw MIME and attachments after 18 months (the parsed text stays), tracking
// events after 13 months (their counts live on in the daily stats and the messages), `ai_runs.output`
// after 6 months (the run's metrics stay), stored idempotent responses after 24 hours (§13.3), and
// rate-limit windows after an hour. Each kind goes in batches, so a backlog never makes one huge
// transaction; what doesn't fit in one run is picked up by the next.

import { ai_runs, attachments, idempotency_keys, messages, tracking_events, type Db } from '@catalyst/db';
import type { ObjectStorage } from '@catalyst/storage';
import { and, inArray, isNotNull, lt, sql } from 'drizzle-orm';

import { purgeRateLimitWindows } from '../api/rate-limit.ts';

const BATCH = 1000;
const MAX_BATCHES = 50;

const monthsBefore = (now: Date, months: number) => {
  const date = new Date(now);
  date.setUTCMonth(date.getUTCMonth() - months);
  return date;
};

export interface RetentionResult {
  rawMessages: number;
  attachments: number;
  trackingEvents: number;
  aiOutputs: number;
  idempotencyKeys: number;
  rateLimitWindows: number;
}

/** Runs `step` until it handles less than a full batch, or the run's share is used up. */
async function inBatches(step: () => Promise<number>): Promise<number> {
  let total = 0;
  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const done = await step();
    total += done;
    if (done < BATCH) break;
  }
  return total;
}

export async function runRetention(db: Db, deps: { storage: ObjectStorage }, now: Date): Promise<RetentionResult> {
  const mimeCutoff = monthsBefore(now, 18);

  // Raw MIME: the object goes, then the key. A failed delete leaves the key, to be tried again.
  const rawMessages = await inBatches(async () => {
    const due = await db.select({ id: messages.id, key: messages.raw_storage_key }).from(messages).where(and(isNotNull(messages.raw_storage_key), lt(messages.created_at, mimeCutoff))).limit(BATCH);
    const cleared: string[] = [];
    for (const row of due) {
      try {
        await deps.storage.delete(row.key!);
        cleared.push(row.id);
      } catch (error) {
        console.error(`[retention] could not delete ${row.key}`, error);
      }
    }
    if (cleared.length) await db.update(messages).set({ raw_storage_key: null }).where(inArray(messages.id, cleared));
    return due.length === BATCH && cleared.length === 0 ? 0 : due.length;
  });

  // Attachments of messages older than 18 months: the stored file and its row.
  const attachmentCount = await inBatches(async () => {
    const due = await db
      .select({ id: attachments.id, key: attachments.storage_key })
      .from(attachments)
      .where(sql`${attachments.message_id} in (select id from messages where created_at < ${mimeCutoff})`)
      .limit(BATCH);
    const removed: string[] = [];
    for (const row of due) {
      try {
        await deps.storage.delete(row.key);
        removed.push(row.id);
      } catch (error) {
        console.error(`[retention] could not delete ${row.key}`, error);
      }
    }
    if (removed.length) await db.delete(attachments).where(inArray(attachments.id, removed));
    return due.length === BATCH && removed.length === 0 ? 0 : due.length;
  });

  const trackingEvents = await inBatches(async () => {
    const removed = await db.execute(sql`delete from ${tracking_events} where id in (select id from ${tracking_events} where occurred_at < ${monthsBefore(now, 13)} limit ${BATCH})`);
    return removed.rowCount ?? 0;
  });

  const aiOutputs = await inBatches(async () => {
    const cleared = await db.execute(sql`update ${ai_runs} set output = null where id in (select id from ${ai_runs} where output is not null and created_at < ${monthsBefore(now, 6)} limit ${BATCH})`);
    return cleared.rowCount ?? 0;
  });

  const idempotencyKeys = (await db.delete(idempotency_keys).where(lt(idempotency_keys.created_at, new Date(now.getTime() - 86_400_000))).returning({ key: idempotency_keys.key })).length;
  const rateLimitWindows = await purgeRateLimitWindows(db, now);

  return { rawMessages, attachments: attachmentCount, trackingEvents, aiOutputs, idempotencyKeys, rateLimitWindows };
}
