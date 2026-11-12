// A campaign's Goals tab (spec §15.9, §5.2): the goals in order, each with its key, success
// criteria, detection methods, playbook, lifecycle effect and value, and how goals map to stages.
// Read-only: editing and reordering come with the builder (V7); the API does both today.

import type { Schemas } from '../../lib/api.ts';
import { words } from '../../lib/format.ts';
import { Pill } from '../ui.tsx';
import { money } from './bits.tsx';

const DETECTION: Record<string, string> = { ai: 'AI reading replies', external_event: 'Integration event', link_click: 'Link click', manual: 'Manual' };

export function GoalsTab({ goals }: { goals: Schemas['Goal'][] }) {
  if (goals.length === 0) return <p className="text-zinc-500 dark:text-zinc-400">This campaign has no goals yet.</p>;
  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-zinc-600 dark:text-zinc-400">
        A thread’s stage is “⟨goal⟩ achieved” for the highest goal it reached. Reaching a goal counts every goal before it too. The last goal is final: reaching it completes the conversation.
      </p>
      <ol className="space-y-3">
        {goals.map((goal, index) => (
          <li key={goal.id} className="space-y-2 rounded-[var(--radius-card)] border border-zinc-200 p-4 dark:border-zinc-800">
            <header className="flex flex-wrap items-center gap-2">
              <span className="text-zinc-500 dark:text-zinc-400">Goal {goal.position}</span>
              <h2 className="font-medium">{goal.name}</h2>
              <code className="rounded-[var(--radius-pill)] bg-zinc-100 px-1.5 text-xs dark:bg-zinc-900">{goal.key}</code>
              {index === goals.length - 1 && <Pill tone="emerald">Final</Pill>}
              {goal.marks_customer && <Pill>Marks customer</Pill>}
              {goal.value_cents !== null && <span className="ml-auto tabular-nums text-zinc-600 dark:text-zinc-400">{money(goal.value_cents)}</span>}
            </header>
            <p>
              <span className="text-zinc-500 dark:text-zinc-400">Achieved when: </span>
              {goal.success_criteria}
            </p>
            <p className="flex flex-wrap items-center gap-1">
              <span className="text-zinc-500 dark:text-zinc-400">Detected by:</span>
              {goal.detection_methods.map((method) => (
                <Pill key={method}>{DETECTION[method] ?? method}</Pill>
              ))}
              {goal.detection_methods.includes('ai') && <span className="text-xs text-zinc-500 dark:text-zinc-400">{goal.auto_confirm ? 'confirms on its own when confident' : 'a person confirms'}</span>}
              {goal.tracked_link_key && (
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  · link “{goal.tracked_link_key}”{goal.click_counts_as_achieved ? ' (a click achieves it)' : ' (a click is a signal)'}
                </span>
              )}
            </p>
            {goal.lifecycle_stage_on_achieve && <p className="text-zinc-600 dark:text-zinc-400">Moves the contact to {words(goal.lifecycle_stage_on_achieve)}.</p>}
            <details>
              <summary className="cursor-pointer text-zinc-500 dark:text-zinc-400">Playbook</summary>
              <p className="mt-1 whitespace-pre-wrap">{goal.playbook}</p>
            </details>
          </li>
        ))}
      </ol>
    </div>
  );
}
