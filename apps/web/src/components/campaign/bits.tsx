// How a campaign's status, autonomy and waits read (spec §15.8, §15.9, §10.7).

import { CheckCircle2, Circle, Pause } from 'lucide-react';

import type { Schemas } from '../../lib/api.ts';
import { Pill, type Tone } from '../ui.tsx';

const STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'zinc' },
  active: { label: 'Active', tone: 'emerald' },
  paused: { label: 'Paused', tone: 'amber' },
  completed: { label: 'Completed', tone: 'sky' },
  archived: { label: 'Archived', tone: 'zinc' },
};

export function CampaignStatusPill({ status }: { status: string }) {
  const entry = STATUS[status] ?? { label: status, tone: 'zinc' as const };
  return (
    <Pill tone={entry.tone}>
      {status === 'active' ? <CheckCircle2 aria-hidden className="size-3" /> : status === 'paused' ? <Pause aria-hidden className="size-3" /> : <Circle aria-hidden className="size-3" />}
      {entry.label}
    </Pill>
  );
}

/** §10.7, in plain words. */
export const AUTONOMY: Record<string, string> = {
  manual: 'Every AI-written email waits for your approval.',
  assisted: 'Confident, safe replies send on their own; everything else waits for approval or comes to you.',
  autonomous: 'AI replies send whenever the guardrails pass and the agent is confident enough.',
};

export const MODE: Record<string, string> = {
  template: 'Template',
  ai_opening_line: 'AI opening line',
  ai_adapt: 'AI adapts',
  ai_write: 'AI writes',
};

export const FINISH: Record<string, string> = {
  exhaust: 'mark Exhausted',
  notify_owner: 'notify the owner',
  close_lost: 'close as lost',
  keep_waiting: 'keep waiting',
};

export function waitText(wait: Schemas['Wait'], from?: string): string {
  const unit = wait.unit === 'business_days' ? 'business day' : wait.unit === 'days' ? 'day' : 'hour';
  const amount = `${wait.amount} ${unit}${wait.amount === 1 ? '' : 's'}`;
  return from === 'goal_event' ? `${amount} after the goal’s event` : `after ${amount}`;
}

/** "sent", "goal:call" → "Sent", "Call booked". */
export function stageName(stage: string, goals: readonly Schemas['Goal'][]): string {
  if (stage.startsWith('goal:')) return goals.find((goal) => goal.key === stage.slice(5))?.name ?? stage.slice(5);
  return stage.charAt(0).toUpperCase() + stage.slice(1);
}

export const money = (cents: number | null | undefined) => (cents === null || cents === undefined ? '–' : new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cents / 100));
