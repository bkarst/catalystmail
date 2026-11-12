// How times, people and labels read in the UI (spec §15.2: plain words, the viewer's locale and
// timezone).

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "now", "5m", "2h", "3d", then the date: how long ago, compactly, for lists. */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const ms = now - new Date(iso).getTime();
  if (ms < MINUTE) return 'now';
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)}m`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h`;
  if (ms < 7 * DAY) return `${Math.floor(ms / DAY)}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** "in 3h", "2h overdue": time left until a deadline. */
export function timeLeft(iso: string, now = Date.now()): { text: string; overdue: boolean } {
  const ms = new Date(iso).getTime() - now;
  const span = Math.abs(ms);
  const words = span < HOUR ? `${Math.max(1, Math.round(span / MINUTE))}m` : span < DAY ? `${Math.round(span / HOUR)}h` : `${Math.round(span / DAY)}d`;
  return ms < 0 ? { text: `${words} overdue`, overdue: true } : { text: `${words} left`, overdue: false };
}

export const dateTime = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');

/** A local `datetime-local` input value for an ISO time, and back. */
export function toLocalInput(iso: string | Date): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
export const fromLocalInput = (value: string) => new Date(value).toISOString();

export const percent = (p: number | null | undefined, digits = 0) => (p === null || p === undefined ? '–' : `${(p * 100).toFixed(digits)}%`);

/** "priya_natarajan" → "Priya natarajan": an enum value as words. */
export const words = (value: string) => {
  const text = value.replaceAll('_', ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
};

export const TEMPERATURE = ['Cold', 'Curious', 'Evaluating', 'Ready to buy'] as const;

export const THREAD_STATE: Record<string, string> = {
  active: 'Active',
  needs_human: 'Needs you',
  pending_approval: 'To approve',
  paused: 'Paused',
  completed: 'Completed',
  exhausted: 'Follow-ups done',
  closed_lost: 'Closed',
  unsubscribed: 'Unsubscribed',
  bounced: 'Bounced',
  stopped: 'Stopped',
};

export const AUTHOR: Record<string, string> = {
  template: 'Template',
  ai: 'AI',
  human_app: 'You',
  human_external: 'You (outside Catalyst)',
  contact: 'Contact',
  third_party: 'Someone else',
  system: 'System',
};
