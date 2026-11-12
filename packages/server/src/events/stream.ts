// `streamEvents` (spec §4.2, §13.4): the workspace's activities as server-sent events, for the UI to
// update live (a thread moving to Responded on the Board, E2E-04). Each event is one activity, in
// its API shape, with the activity's type as the event name and its ID as the event ID, so a
// reconnecting client (`Last-Event-ID`) is first sent what it missed. A comment every 25 s keeps
// proxies from closing a quiet connection.

import { activities, type ActivityFeed, type Db } from '@catalyst/db';
import { and, asc, eq, gt } from 'drizzle-orm';

import { serializeActivity } from '../contacts/timeline.ts';

const HEARTBEAT_MS = 25_000;
/** On reconnect, at most this many missed events are replayed; beyond that the client refetches. */
const REPLAY_LIMIT = 500;
const ACTIVITY_ID = /^act_[0-9a-z]{26}$/;
/** IDs already sent, so an activity both replayed and announced goes out once. */
const REMEMBERED = 2_000;

const encoder = new TextEncoder();
const frame = (row: typeof activities.$inferSelect) => encoder.encode(`id: ${row.id}\nevent: ${row.type}\ndata: ${JSON.stringify(serializeActivity(row))}\n\n`);

export function openEventStream(db: Db, feed: ActivityFeed, workspaceId: string, options: { lastEventId: string | null; heartbeatMs?: number }): ReadableStream<Uint8Array> {
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;
  const stop = () => {
    closed = true;
    unsubscribe?.();
    if (heartbeat) clearInterval(heartbeat);
  };

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const sent = new Set<string>();
      const send = (chunk: Uint8Array) => {
        if (closed) return;
        try {
          controller.enqueue(chunk);
        } catch {
          stop();
        }
      };
      const sendRow = (row: typeof activities.$inferSelect) => {
        if (sent.has(row.id)) return;
        sent.add(row.id);
        if (sent.size > REMEMBERED) sent.delete(sent.values().next().value!);
        send(frame(row));
      };
      // Events go out in the order they arrive; each waits for the one before.
      let queue: Promise<void> = Promise.resolve();
      const then = (work: () => Promise<void>) => {
        queue = queue.then(() => (closed ? undefined : work())).catch(() => {});
      };

      // Listening starts before the replay is queued, and nothing can run in between, so an
      // activity written meanwhile is either replayed or announced, never lost.
      unsubscribe = await feed.subscribe((event) => {
        if (event.workspaceId !== workspaceId || sent.has(event.activityId)) return;
        then(async () => {
          const [row] = await db.select().from(activities).where(and(eq(activities.id, event.activityId), eq(activities.workspace_id, workspaceId)));
          if (row) sendRow(row);
        });
      });
      send(encoder.encode('retry: 5000\n\n'));
      const since = options.lastEventId && ACTIVITY_ID.test(options.lastEventId) ? options.lastEventId : null;
      if (since) {
        then(async () => {
          const missed = await db.select().from(activities).where(and(eq(activities.workspace_id, workspaceId), gt(activities.id, since))).orderBy(asc(activities.id)).limit(REPLAY_LIMIT);
          for (const row of missed) sendRow(row);
        });
      }
      heartbeat = setInterval(() => send(encoder.encode(': keep-alive\n\n')), options.heartbeatMs ?? HEARTBEAT_MS);
    },
    cancel() {
      stop();
    },
  });
}
