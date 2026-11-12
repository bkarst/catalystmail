// The builder's seven steps (spec §15.10), as a bar: done steps link back, the current one is marked.

import Link from 'next/link';

import { cn } from '../../lib/cn.ts';

export const STEPS = [
  { key: 'basics', label: 'Basics' },
  { key: 'goals', label: 'Goals' },
  { key: 'audience', label: 'Audience' },
  { key: 'emails', label: 'Emails' },
  { key: 'agent', label: 'Agent' },
  { key: 'sending', label: 'Sending' },
  { key: 'review', label: 'Review' },
] as const;
export type StepKey = (typeof STEPS)[number]['key'];

export function BuilderSteps({ current, campaignId }: { current: StepKey; campaignId?: string }) {
  return (
    <ol aria-label="Steps" className="flex flex-wrap items-center gap-1 text-xs">
      {STEPS.map((step, index) => {
        const active = step.key === current;
        const content = (
          <>
            {index + 1} {step.label}
          </>
        );
        return (
          <li key={step.key} aria-current={active ? 'step' : undefined}>
            {campaignId && !active ? (
              <Link href={`/campaigns/${campaignId}/build?step=${step.key}`} className="block rounded-[var(--radius-pill)] bg-zinc-100 px-2 py-1 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800">
                {content}
              </Link>
            ) : (
              <span className={cn('block rounded-[var(--radius-pill)] px-2 py-1', active ? 'bg-indigo-600 text-white' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400')}>{content}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
