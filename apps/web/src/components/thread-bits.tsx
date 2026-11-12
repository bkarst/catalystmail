// How a thread's stage, state, opens and temperature look, everywhere they appear (spec §15.2,
// §15.6, §15.7). Each mark pairs its colour with words, an icon or a title.

import { Check, Circle, CircleDot, Eye, EyeOff, Flame, Pause, ShieldQuestion } from 'lucide-react';

import type { Schemas } from '../lib/api.ts';
import { cn } from '../lib/cn.ts';
import { dateTime, TEMPERATURE, THREAD_STATE } from '../lib/format.ts';
import { Pill, type Tone } from './ui.tsx';

type Thread = Schemas['Thread'];

const STAGE_TONE: Record<string, Tone> = { queued: 'zinc', sent: 'sky', received: 'sky', responded: 'indigo', goal_achieved: 'emerald' };

export function StagePill({ thread }: { thread: Pick<Thread, 'stage' | 'stage_label'> }) {
  return (
    <Pill tone={STAGE_TONE[thread.stage] ?? 'zinc'}>
      {thread.stage === 'goal_achieved' ? <Check aria-hidden className="size-3" /> : <CircleDot aria-hidden className="size-3" />}
      {thread.stage_label}
    </Pill>
  );
}

const STATE_TONE: Record<string, Tone> = { needs_human: 'rose', pending_approval: 'amber', paused: 'zinc', active: 'zinc', completed: 'emerald', exhausted: 'zinc', closed_lost: 'zinc', bounced: 'rose', unsubscribed: 'zinc', stopped: 'zinc' };

export function StatePill({ thread }: { thread: Pick<Thread, 'state' | 'state_reason' | 'ai_paused'> }) {
  return (
    <span className="inline-flex gap-1">
      <Pill tone={STATE_TONE[thread.state] ?? 'zinc'} title={thread.state_reason ?? undefined}>
        {thread.state === 'needs_human' && <ShieldQuestion aria-hidden className="size-3" />}
        {thread.state === 'paused' && <Pause aria-hidden className="size-3" />}
        {THREAD_STATE[thread.state] ?? thread.state}
      </Pill>
      {thread.ai_paused && <Pill title="A person took over; the agent writes nothing.">You’re handling</Pill>}
    </span>
  );
}

/** ● 3× opened by a person; ◌ only a proxy or scanner fetched it; ○ no open; – not tracked (§5.8). */
export function OpenMark({ open }: { open: Thread['open'] }) {
  if (open.status === 'opened')
    return (
      <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400" title={open.first_opened_at ? `First opened ${dateTime(open.first_opened_at)}` : 'A reply or click shows it was read'}>
        <Eye aria-hidden className="size-3.5" /> {open.count > 0 ? `${open.count}×` : 'read'}
        {open.clicked && ' · clicked'}
      </span>
    );
  if (open.status === 'machine_only')
    return (
      <span className="inline-flex items-center gap-1 text-zinc-500 dark:text-zinc-400" title="Only a privacy proxy or security scanner fetched it: delivered, maybe not read.">
        <EyeOff aria-hidden className="size-3.5" /> auto
      </span>
    );
  if (open.status === 'unopened')
    return (
      <span className="inline-flex items-center gap-1 text-zinc-500 dark:text-zinc-400" title="No open seen">
        <Circle aria-hidden className="size-3" /> <span className="sr-only">Not opened</span>
      </span>
    );
  return (
    <span className="text-zinc-500 dark:text-zinc-400" title="Opens aren’t tracked">
      –
    </span>
  );
}

/** Cold → ready to buy, as four steps (§15.6). */
export function TemperatureDots({ value }: { value: number | null }) {
  if (value === null) return <span className="text-zinc-500 dark:text-zinc-400">–</span>;
  const step = Math.max(0, Math.min(3, Math.round(value)));
  return (
    <span className="inline-flex items-center gap-1" title={TEMPERATURE[step]}>
      {[0, 1, 2, 3].map((dot) => (
        <span key={dot} aria-hidden className={cn('size-2 rounded-full', dot <= step ? (step >= 2 ? 'bg-amber-500' : 'bg-sky-500') : 'bg-zinc-200 dark:bg-zinc-800')} />
      ))}
      <span className="ml-1 text-xs text-zinc-600 dark:text-zinc-400">{TEMPERATURE[step]}</span>
      {step === 3 && <Flame aria-hidden className="size-3 text-amber-600" />}
    </span>
  );
}

/** Sent ──● Received ──● Responded ──● each goal ──○ (§15.7): the status ladder with where it stands. */
export function StageTrack({ thread, goals }: { thread: Thread; goals: readonly { id: string; name: string; position: number }[] }) {
  const steps = [
    { label: 'Sent', rank: 1 },
    { label: 'Received', rank: 2 },
    { label: 'Responded', rank: 3 },
    ...[...goals].sort((a, b) => a.position - b.position).map((goal) => ({ label: goal.name, rank: 3 + goal.position })),
  ];
  return (
    <ol aria-label="Stage" className="flex flex-wrap items-center gap-x-1 gap-y-1 text-xs">
      {steps.map((step, index) => {
        const reached = thread.stage_rank >= step.rank;
        return (
          <li key={step.label} className="flex items-center gap-1">
            {index > 0 && <span aria-hidden className={cn('h-px w-5', reached ? 'bg-indigo-500' : 'bg-zinc-300 dark:bg-zinc-700')} />}
            <span aria-hidden className={cn('size-2 rounded-full border', reached ? 'border-indigo-600 bg-indigo-600' : 'border-zinc-400')} />
            <span className={cn(reached ? 'font-medium' : 'text-zinc-500 dark:text-zinc-400')}>
              {step.label}
              <span className="sr-only">{reached ? ' (reached)' : ' (not yet)'}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
