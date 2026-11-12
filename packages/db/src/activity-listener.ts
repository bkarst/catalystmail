// New activities as they happen (spec §4.2 live updates): migration 0010 makes every insert into
// `activities` NOTIFY `catalyst_activity` with "<workspace_id>:<activity_id>". One connection
// LISTENs for the whole process and hands each event to the streams that want it.

import pg from 'pg';

export const ACTIVITY_CHANNEL = 'catalyst_activity';

export type ActivityListener = (event: { workspaceId: string; activityId: string }) => void;

export interface ActivityFeed {
  /** Starts listening (once) and calls `listener` for every new activity; resolves to its unsubscribe. */
  subscribe(listener: ActivityListener): Promise<() => void>;
  close(): Promise<void>;
}

export function parseActivityNotice(payload: string | undefined): { workspaceId: string; activityId: string } | null {
  const at = payload?.indexOf(':') ?? -1;
  if (!payload || at <= 0) return null;
  return { workspaceId: payload.slice(0, at), activityId: payload.slice(at + 1) };
}

/** LISTEN on a dedicated connection; it reconnects after an error the next time someone subscribes. */
export function pgActivityFeed(connectionString: string): ActivityFeed {
  const listeners = new Set<ActivityListener>();
  let client: Promise<pg.Client> | null = null;
  const connect = () => {
    client ??= (async () => {
      const connection = new pg.Client({ connectionString });
      connection.on('notification', (message) => {
        if (message.channel !== ACTIVITY_CHANNEL) return;
        const event = parseActivityNotice(message.payload);
        if (event) for (const listener of listeners) listener(event);
      });
      connection.on('error', () => {
        client = null;
        connection.end().catch(() => {});
      });
      await connection.connect();
      await connection.query(`LISTEN ${ACTIVITY_CHANNEL}`);
      return connection;
    })().catch((error: unknown) => {
      client = null;
      throw error;
    });
    return client;
  };
  return {
    async subscribe(listener) {
      await connect();
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async close() {
      listeners.clear();
      const open = client;
      client = null;
      if (open) await (await open).end();
    },
  };
}
