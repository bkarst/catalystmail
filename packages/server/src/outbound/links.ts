// Click tracking (spec §9.3, off by default): each link in an email points through
// `https://{tracking_host}/t/c/{token}`, which records the click and redirects to the original.
// The visible text and the plain-text part keep the original URL; unsubscribe links are never
// rewritten. Only on the sending domain's own tracking host, as for the pixel (§9.1).

import { newId, tracked_links, type Executor } from '@catalyst/db';

import { clickToken } from '../public/tracking.ts';

const URL_PATTERN = /https?:\/\/[^\s<>()"']+[^\s<>()"'.,;:!?]/g;

export interface LinkPlan {
  href: ((url: string) => string) | null;
  rows: (typeof tracked_links.$inferInsert)[];
}

export function planTrackedLinks(messageId: string, text: string, options: { enabled: boolean; host: string | null; secret: string | null; links: Record<string, string> }): LinkPlan {
  if (!options.enabled || !options.host || !options.secret) return { href: null, rows: [] };
  const host = options.host;
  const urls = [...new Set(text.match(URL_PATTERN) ?? [])].filter((url) => {
    try {
      const parsed = new URL(url);
      // The unsubscribe link and Catalyst's own tracking links stay as they are.
      return parsed.hostname !== host && !/^\/(u|t)\//.test(parsed.pathname);
    } catch {
      return false;
    }
  });
  const keys = Object.entries(options.links);
  const rows = urls.map((url, position) => ({ id: newId('link'), message_id: messageId, position, original_url: url, link_key: keys.find(([, target]) => target === url)?.[0] ?? null }));
  const byUrl = new Map(rows.map((row) => [row.original_url, row.id]));
  return { href: (url) => (byUrl.has(url) ? `https://${host}/t/c/${clickToken(byUrl.get(url)!, options.secret!)}` : url), rows };
}

/** Stores the plan's links once the email row exists. */
export async function saveTrackedLinks(tx: Executor, plan: LinkPlan): Promise<void> {
  if (plan.rows.length > 0) await tx.insert(tracked_links).values(plan.rows);
}
