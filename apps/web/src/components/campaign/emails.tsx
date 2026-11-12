'use client';

// A campaign's Emails tab (spec §15.9, §5.10): the initial email with its A/B variants, then one
// card per follow-up sequence in stage order, with each step's wait, subject, mode and preview,
// and what happens after the last step. A stage with no sequence shows as an empty card; the final
// goal ends the conversation. A sketch shows a typical cadence. Read-only: editing comes with the
// builder (V7), and the API edits it today.

import { useQuery } from '@tanstack/react-query';

import { api, unwrap, type Schemas } from '../../lib/api.ts';
import { ErrorText, Loading, Pill } from '../ui.tsx';
import { FINISH, MODE, stageName, waitText } from './bits.tsx';

export function EmailsTab({ campaign, goals }: { campaign: Schemas['Campaign']; goals: Schemas['Goal'][] }) {
  const campaignId = campaign.id;
  const initial = useQuery({ queryKey: ['campaign', campaignId, 'initial-email'], queryFn: () => unwrap(api.GET('/campaigns/{campaignId}/initial-email', { params: { path: { campaignId } } })), retry: false });
  const sequences = useQuery({ queryKey: ['campaign', campaignId, 'steps'], queryFn: () => unwrap(api.GET('/campaigns/{campaignId}/follow-up-sequences', { params: { path: { campaignId } } })) });
  if (sequences.isPending) return <Loading />;
  if (sequences.isError) return <ErrorText error={sequences.error} onRetry={() => void sequences.refetch()} />;

  const stageOrder = ['sent', 'received', 'responded', ...goals.slice(0, -1).map((goal) => `goal:${goal.key}`)];
  const ordered = [...sequences.data.data].sort((a, b) => Math.min(...a.stages.map((stage) => stageOrder.indexOf(stage))) - Math.min(...b.stages.map((stage) => stageOrder.indexOf(stage))));
  const covered = new Set(sequences.data.data.filter((sequence) => sequence.active).flatMap((sequence) => sequence.stages));
  const uncovered = stageOrder.filter((stage) => !covered.has(stage));
  const finalGoal = goals.at(-1);
  const firstSequence = ordered.find((sequence) => sequence.active && sequence.stages.includes('sent'));

  return (
    <div className="space-y-4">
      <section aria-label="Initial email" className="rounded-[var(--radius-card)] border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="mb-2 font-medium">Initial email</h2>
        {initial.isPending ? <Loading /> : initial.isError ? <p className="text-zinc-500 dark:text-zinc-400">Not written yet.</p> : <StepVariants step={initial.data} />}
      </section>

      {firstSequence && <Cadence sequence={firstSequence} />}

      <h2 className="pt-2 font-medium">
        Follow-ups by stage <span className="font-normal text-zinc-500 dark:text-zinc-400">· sent when the contact hasn’t replied</span>
      </h2>
      {ordered.map((sequence) => (
        <section key={sequence.id} aria-label={sequence.name} className="rounded-[var(--radius-card)] border border-zinc-200 dark:border-zinc-800">
          <header className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
            <span className="font-medium">{sequence.stages.map((stage) => stageName(stage, goals)).join(' · ')}</span>
            <span className="text-zinc-500 dark:text-zinc-400">{sequence.name}</span>
            {!sequence.active && <Pill tone="amber">Paused</Pill>}
          </header>
          <ol className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {[...sequence.steps]
              .sort((a, b) => a.position - b.position)
              .map((step) => (
                <li key={step.id} className="grid gap-1 px-4 py-2 md:grid-cols-[3rem_14rem_1fr_auto]">
                  <span className="font-medium tabular-nums">{step.position}</span>
                  <span className="text-zinc-600 dark:text-zinc-400">{waitText(step.wait, step.wait_from)}</span>
                  <span className="min-w-0 truncate" title={step.variants[0]?.body_template}>
                    {step.send_as_reply ? <span className="text-zinc-500 dark:text-zinc-400">Re: … </span> : step.variants[0]?.subject_template && `“${step.variants[0].subject_template}” `}
                    <span className="text-zinc-600 dark:text-zinc-400">{(step.mode === 'template' ? step.variants[0]?.body_template : (step.ai_guidance ?? step.variants[0]?.body_template))?.split('\n')[0]}</span>
                  </span>
                  <span className="flex gap-1">
                    <Pill tone={step.mode === 'template' ? 'zinc' : 'indigo'}>{MODE[step.mode] ?? step.mode}</Pill>
                    {step.variants.length > 1 && <Pill>A/B · {step.variants.length}</Pill>}
                  </span>
                </li>
              ))}
          </ol>
          <p className="border-t border-zinc-200 px-4 py-2 text-zinc-500 dark:text-zinc-400 dark:border-zinc-800">
            Then wait {waitText(sequence.final_wait).replace('after ', '')} → {FINISH[sequence.finish] ?? sequence.finish}
          </p>
        </section>
      ))}
      {uncovered.map((stage) => (
        <section key={stage} aria-label={stageName(stage, goals)} className="rounded-[var(--radius-card)] border border-dashed border-zinc-300 px-4 py-3 text-zinc-500 dark:text-zinc-400 dark:border-zinc-700">
          <span className="font-medium text-zinc-700 dark:text-zinc-300">{stageName(stage, goals)}</span> · No follow-ups at this stage. The thread waits {campaign.final_wait_business_days} business days, then is marked Exhausted.
        </section>
      ))}
      {finalGoal && <p className="text-zinc-500 dark:text-zinc-400">{finalGoal.name} · final goal: the conversation is complete, so no follow-ups.</p>}
    </div>
  );
}

function StepVariants({ step }: { step: Schemas['Step'] }) {
  return (
    <div className="space-y-3">
      {step.variants.map((variant) => (
        <div key={variant.id} className="space-y-1">
          <p className="flex flex-wrap items-center gap-2">
            {step.variants.length > 1 && <Pill>Variant {variant.label}</Pill>}
            {!variant.active && <Pill tone="amber">Inactive</Pill>}
            <span className="font-medium">{variant.subject_template ?? '(no subject)'}</span>
            <Pill tone={step.mode === 'template' ? 'zinc' : 'indigo'}>{MODE[step.mode] ?? step.mode}</Pill>
          </p>
          <pre className="whitespace-pre-wrap rounded-[var(--radius-card)] bg-zinc-50 p-3 font-sans leading-relaxed dark:bg-zinc-900/50">{variant.body_template}</pre>
          {variant.issues.length > 0 && (
            <ul className="text-xs text-rose-700 dark:text-rose-300">
              {variant.issues.map((issue) => (
                <li key={issue.code + issue.message}>{issue.message}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

/** "Day 0 initial · Day 3 · Day 7 · Day 14 exhausted" for a thread that never replies (§15.9). */
function Cadence({ sequence }: { sequence: Schemas['FollowUpSequence'] }) {
  const toBusinessDays = (wait: Schemas['Wait']) => (wait.unit === 'business_days' ? wait.amount : wait.unit === 'days' ? Math.round((wait.amount * 5) / 7) : Math.ceil(wait.amount / 24));
  let day = 0;
  const marks = ['Day 0 initial'];
  for (const step of [...sequence.steps].sort((a, b) => a.position - b.position)) {
    day += toBusinessDays(step.wait);
    marks.push(`Day ${day}`);
  }
  day += toBusinessDays(sequence.final_wait);
  marks.push(`Day ${day} ${FINISH[sequence.finish] ?? sequence.finish}`);
  return (
    <p className="text-zinc-500 dark:text-zinc-400">
      A thread that never replies: {marks.join(' · ')} <span className="text-xs">(business days)</span>
    </p>
  );
}
