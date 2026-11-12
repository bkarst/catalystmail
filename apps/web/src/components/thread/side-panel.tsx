'use client';

// The Thread view's right panel (spec §15.7), in folding sections: Status (the next action and the
// follow-up controls), Contact, Classification (Jev, §10.4), AI summary, Goals (mark achieved and
// revoke), Activity, and AI decisions (each classification run).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';

import { activityText } from '../../lib/activity.ts';
import { api, idempotencyKey, unwrap, type Schemas } from '../../lib/api.ts';
import { cn } from '../../lib/cn.ts';
import { dateTime, fromLocalInput, percent, TEMPERATURE, toLocalInput, words } from '../../lib/format.ts';
import { usePerson } from '../../lib/person.tsx';
import { OpenMark, StatePill, TemperatureDots } from '../thread-bits.tsx';
import { Button, ErrorText, inputClass, Pill, Section } from '../ui.tsx';

type Thread = Schemas['Thread'];
type Goal = Schemas['Goal'];
type Classification = Schemas['Classification'];

/** Every thread action answers with the thread; afterwards everything about it is fetched again. */
function useThreadMutation<T>(thread: Thread, run: (input: T) => Promise<unknown>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['thread', thread.id] });
      void client.invalidateQueries({ queryKey: ['threads'] });
      void client.invalidateQueries({ queryKey: ['work-queue'] });
    },
  });
}

const NEXT_ACTION: Record<string, string> = {
  none: 'Nothing is due',
  send_initial: 'Initial email',
  send_reply: 'Reply',
  send_follow_up: 'Follow-up',
  await_reply: 'Waiting for a reply',
};

export function StatusSection({ thread, mailbox }: { thread: Thread; mailbox: string | null }) {
  const person = usePerson();
  const threadId = thread.id;
  const path = { params: { path: { threadId } } };
  const [rescheduling, setRescheduling] = useState(false);
  const [at, setAt] = useState(() => toLocalInput(thread.next_action.at ?? new Date(Date.now() + 86_400_000)));
  const [checkIn, setCheckIn] = useState('');
  const action = useThreadMutation(thread, async (name: 'send-now' | 'skip' | 'stop' | 'resume-follow-ups' | 'pause' | 'resume' | 'cancel-check-in' | 'reschedule' | 'check-in') => {
    switch (name) {
      case 'send-now':
        return unwrap(api.POST('/threads/{threadId}/next-action/send-now', { params: { path: { threadId }, header: idempotencyKey() } }));
      case 'skip':
        return unwrap(api.POST('/threads/{threadId}/next-action/skip', path));
      case 'stop':
        return unwrap(api.POST('/threads/{threadId}/follow-ups/stop', path));
      case 'resume-follow-ups':
        return unwrap(api.POST('/threads/{threadId}/follow-ups/resume', path));
      case 'pause':
        return unwrap(api.POST('/threads/{threadId}/pause', path));
      case 'resume':
        return unwrap(api.POST('/threads/{threadId}/resume', path));
      case 'cancel-check-in':
        return unwrap(api.DELETE('/threads/{threadId}/check-in', path));
      case 'reschedule':
        return unwrap(api.PATCH('/threads/{threadId}/next-action', { ...path, body: { at: fromLocalInput(at) } })).then(() => setRescheduling(false));
      case 'check-in':
        return unwrap(api.POST('/threads/{threadId}/check-in', { ...path, body: { date: checkIn } })).then(() => setCheckIn(''));
    }
  });
  const may = person.can('threads:write');
  const next = thread.next_action;
  const isEmail = next.type === 'send_initial' || next.type === 'send_follow_up';
  const followUp = thread.follow_up;
  const terminal = ['completed', 'closed_lost', 'bounced', 'unsubscribed', 'stopped'].includes(thread.state);

  return (
    <Section title="Status">
      <StatePill thread={thread} />
      {thread.state_reason && <p className="text-xs text-zinc-500 dark:text-zinc-400">{words(thread.state_reason)}</p>}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-zinc-500 dark:text-zinc-400">Next</dt>
        <dd>
          {NEXT_ACTION[next.type] ?? next.type}
          {next.at && ` · ${dateTime(next.at)}`}
          {next.throttle_reason && <span className="block text-xs text-zinc-500 dark:text-zinc-400">Pushed back by {words(next.throttle_reason)}</span>}
        </dd>
        {followUp.sequence_id && (
          <>
            <dt className="text-zinc-500 dark:text-zinc-400">Follow-ups</dt>
            <dd>
              {followUp.stopped ? 'Stopped' : followUp.step_position ? `Step ${followUp.step_position} next` : 'Sequence finished'} · {followUp.sent} sent
            </dd>
          </>
        )}
        {followUp.check_in_at && (
          <>
            <dt className="text-zinc-500 dark:text-zinc-400">Check-in</dt>
            <dd>{dateTime(followUp.check_in_at)}</dd>
          </>
        )}
        {thread.open.status !== 'not_tracked' && (
          <>
            <dt className="text-zinc-500 dark:text-zinc-400">Opens</dt>
            <dd>
              <OpenMark open={thread.open} />
              {thread.open.status === 'unopened' && <span className="text-zinc-500 dark:text-zinc-400">none yet</span>}
              {thread.open.status === 'machine_only' && <span className="text-zinc-500 dark:text-zinc-400"> (a proxy or scanner, maybe not read)</span>}
            </dd>
          </>
        )}
        {mailbox && (
          <>
            <dt className="text-zinc-500 dark:text-zinc-400">Mailbox</dt>
            <dd className="truncate">{mailbox}</dd>
          </>
        )}
      </dl>
      {may && !terminal && (
        <div className="flex flex-wrap gap-1">
          {isEmail && person.can('messages:send') && (
            <Button size="sm" disabled={action.isPending} onClick={() => action.mutate('send-now')}>
              Send now
            </Button>
          )}
          {next.type === 'send_follow_up' && (
            <Button size="sm" disabled={action.isPending} onClick={() => action.mutate('skip')}>
              Skip
            </Button>
          )}
          {isEmail && (
            <Button size="sm" disabled={action.isPending} onClick={() => setRescheduling(!rescheduling)}>
              Reschedule
            </Button>
          )}
          {followUp.sequence_id &&
            (followUp.stopped ? (
              <Button size="sm" disabled={action.isPending} onClick={() => action.mutate('resume-follow-ups')}>
                Resume follow-ups
              </Button>
            ) : (
              <Button size="sm" disabled={action.isPending} onClick={() => action.mutate('stop')}>
                Stop follow-ups
              </Button>
            ))}
          {thread.manually_paused ? (
            <Button size="sm" disabled={action.isPending} onClick={() => action.mutate('resume')}>
              Resume thread
            </Button>
          ) : (
            <Button size="sm" disabled={action.isPending} onClick={() => action.mutate('pause')}>
              Pause thread
            </Button>
          )}
          {followUp.check_in_at && (
            <Button size="sm" disabled={action.isPending} onClick={() => action.mutate('cancel-check-in')}>
              Cancel check-in
            </Button>
          )}
        </div>
      )}
      {rescheduling && (
        <div className="flex gap-1">
          <input type="datetime-local" aria-label="New time" value={at} onChange={(event) => setAt(event.target.value)} className={cn(inputClass, 'py-1')} />
          <Button size="sm" variant="primary" disabled={action.isPending} onClick={() => action.mutate('reschedule')}>
            Move
          </Button>
        </div>
      )}
      {may && !terminal && thread.responded_at && (
        <label className="flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
          Check in on
          <input type="date" value={checkIn} onChange={(event) => setCheckIn(event.target.value)} className={cn(inputClass, 'w-auto py-0.5')} />
          {checkIn && (
            <Button size="sm" disabled={action.isPending} onClick={() => action.mutate('check-in')}>
              Set
            </Button>
          )}
        </label>
      )}
      <ErrorText error={action.error} />
    </Section>
  );
}

export function ContactSection({ thread }: { thread: Thread }) {
  const contact = useQuery({ queryKey: ['contact', thread.contact.id], queryFn: () => unwrap(api.GET('/contacts/{contactId}', { params: { path: { contactId: thread.contact.id } } })) });
  const tags = useQuery({ queryKey: ['tags'], queryFn: () => unwrap(api.GET('/tags', { params: { query: { limit: 100 } } })), staleTime: 300_000 });
  const data = contact.data;
  const tagNames = data?.tag_ids.map((id) => tags.data?.data.find((tag) => tag.id === id)?.name).filter(Boolean) ?? [];
  return (
    <Section title="Contact">
      <Link href={`/contacts/${thread.contact.id}`} className="font-medium hover:underline">
        {thread.contact.name ?? thread.contact.email}
      </Link>
      <p className="text-zinc-600 dark:text-zinc-400">{[data?.title, thread.contact.company].filter(Boolean).join(' · ') || thread.contact.email}</p>
      {data && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-zinc-500 dark:text-zinc-400">Lifecycle</dt>
          <dd>{words(data.lifecycle_stage)}</dd>
          {data.timezone && (
            <>
              <dt className="text-zinc-500 dark:text-zinc-400">Timezone</dt>
              <dd>
                {data.timezone}
                {data.city && ` (${data.city})`}
              </dd>
            </>
          )}
          {tagNames.length > 0 && (
            <>
              <dt className="text-zinc-500 dark:text-zinc-400">Tags</dt>
              <dd>{tagNames.join(' · ')}</dd>
            </>
          )}
          {data.subscription_status !== 'subscribed' && (
            <>
              <dt className="text-zinc-500 dark:text-zinc-400">Email</dt>
              <dd className="text-rose-700 dark:text-rose-300">{words(data.subscription_status)}</dd>
            </>
          )}
        </dl>
      )}
      <ErrorText error={contact.error} onRetry={() => void contact.refetch()} />
    </Section>
  );
}

type Answer = { type: string; noul?: number; choice?: string; confidence?: number; score?: number };

/** A probability as a bar with its number; highlighted when it sits in an "ask a person" band. */
function Probability({ label, p, ask, history }: { label: ReactNode; p: number; ask: boolean; history: number[] }) {
  return (
    <div className={cn('rounded-[var(--radius-pill)] px-1.5 py-1', ask && 'bg-amber-50 dark:bg-amber-950')} title={ask ? 'In the band where a person is asked' : undefined}>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="truncate">{label}</span>
        <span className="flex items-center gap-2">
          {history.length > 1 && <Sparkline values={history} />}
          <span className="tabular-nums">{percent(p)}</span>
        </span>
      </div>
      <div aria-hidden className="mt-0.5 h-1 rounded-full bg-zinc-200 dark:bg-zinc-800">
        <div className={cn('h-1 rounded-full', ask ? 'bg-amber-500' : 'bg-indigo-500')} style={{ width: `${Math.round(p * 100)}%` }} />
      </div>
    </div>
  );
}

/** How a signal moved, classification by classification, oldest to newest (§15.7). */
function Sparkline({ values }: { values: number[] }) {
  const width = 48;
  const height = 14;
  const points = values.map((value, index) => `${((index / (values.length - 1)) * width).toFixed(1)},${(height - value * height).toFixed(1)}`).join(' ');
  return (
    <svg aria-hidden width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="text-indigo-500">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  );
}

export function ClassificationSection({ thread, goals, history, thresholds, autoConfirm }: { thread: Thread; goals: Goal[]; history: Classification[]; thresholds: Record<string, number> | null; autoConfirm: number | null }) {
  const person = usePerson();
  const reclassify = useThreadMutation(thread, () => unwrap(api.POST('/threads/{threadId}/classify', { params: { path: { threadId: thread.id } } })));
  const jevRuns = history.filter((run) => run.provider === 'typesafe' && run.status === 'ok' && run.output).reverse();
  const latest = jevRuns.at(-1)?.output as Record<string, Answer> | undefined;
  const series = (name: string) => jevRuns.map((run) => (run.output as Record<string, Answer>)[name]?.noul).filter((value): value is number => typeof value === 'number');
  const goalAsk = thresholds?.goalAsk ?? 0.5;
  const flag = thresholds?.escalationFlag ?? 0.3;
  const escalationQuestions = latest ? Object.entries(latest).filter(([name, answer]) => name.startsWith('esc_') && typeof answer.noul === 'number' && answer.noul >= flag) : [];
  const { classification } = thread;

  return (
    <Section
      title={`Classification${jevRuns.length ? ' · Jev' : ''}`}
      action={
        person.can('threads:write') && thread.responded_at ? (
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              reclassify.mutate(undefined);
            }}
            disabled={reclassify.isPending}
            className="flex items-center gap-1 rounded-[var(--radius-pill)] px-1.5 py-0.5 text-xs normal-case tracking-normal text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            <RefreshCw aria-hidden className={cn('size-3', reclassify.isPending && 'animate-spin')} /> Reclassify
          </button>
        ) : undefined
      }
    >
      {classification.intent === null ? (
        <p className="text-zinc-500 dark:text-zinc-400">Not classified yet: the contact hasn’t replied.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1">
            {classification.fallback && <Pill tone="amber">Classified by Claude only</Pill>}
            {classification.sentiment && <Pill tone={classification.sentiment === 'negative' ? 'rose' : classification.sentiment === 'positive' ? 'emerald' : 'zinc'}>{words(classification.sentiment)}</Pill>}
          </div>
          <Probability label={`Intent: ${words(classification.intent)}`} p={classification.intent_p ?? 0} ask={false} history={[]} />
          {classification.temperature !== null && (
            <div className="text-xs">
              <TemperatureDots value={classification.temperature} />
            </div>
          )}
          {goals.map((goal) => {
            const p = latest?.[`goal_${goal.key}`]?.noul;
            if (typeof p !== 'number') return null;
            return <Probability key={goal.id} label={`${goal.name}?`} p={p} ask={p >= goalAsk && p < (autoConfirm ?? 0.85)} history={series(`goal_${goal.key}`)} />;
          })}
          {escalationQuestions.map(([name, answer]) => (
            <Probability key={name} label={`${words(name.slice(4))}?`} p={answer.noul!} ask history={series(name)} />
          ))}
        </>
      )}
      <ErrorText error={reclassify.error} />
    </Section>
  );
}

export function GoalsSection({ thread, goals }: { thread: Thread; goals: Goal[] }) {
  const person = usePerson();
  const [marking, setMarking] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [eventAt, setEventAt] = useState('');
  const [revoking, setRevoking] = useState(false);
  const [reason, setReason] = useState('');
  const mark = useThreadMutation(thread, (goalId: string) =>
    unwrap(api.POST('/threads/{threadId}/goals/{goalId}/achieve', { params: { path: { threadId: thread.id, goalId }, header: idempotencyKey() }, body: { ...(note.trim() && { note: note.trim() }), ...(eventAt && { event_at: fromLocalInput(eventAt) }) } })).then(() => (setMarking(null), setNote(''), setEventAt(''))),
  );
  const revoke = useThreadMutation(thread, (goalId: string) => unwrap(api.DELETE('/threads/{threadId}/goals/{goalId}/achieve', { params: { path: { threadId: thread.id, goalId }, query: { reason: reason.trim() } } })).then(() => (setRevoking(false), setReason(''))));
  const may = person.can('threads:write') && thread.mailbox_id !== null;
  const sorted = [...goals].sort((a, b) => a.position - b.position);

  return (
    <Section title="Goals">
      {sorted.length === 0 && <p className="text-zinc-500 dark:text-zinc-400">This campaign has no goals.</p>}
      <ol className="space-y-1.5">
        {sorted.map((goal) => {
          const reached = thread.stage_rank >= 3 + goal.position;
          const highest = goal.id === thread.achieved_goal_id;
          return (
            <li key={goal.id}>
              <div className="flex items-center gap-2">
                <span aria-hidden className={cn('size-2 rounded-full border', reached ? 'border-emerald-600 bg-emerald-600' : 'border-zinc-400')} />
                <span className={cn('flex-1', reached && 'font-medium')}>
                  {goal.name}
                  <span className="sr-only">{reached ? ' (reached)' : ' (not yet)'}</span>
                </span>
                {may && !reached && (
                  <Button size="sm" variant="ghost" onClick={() => setMarking(marking === goal.id ? null : goal.id)}>
                    Mark achieved…
                  </Button>
                )}
                {may && highest && (
                  <Button size="sm" variant="ghost" onClick={() => setRevoking(!revoking)}>
                    Revoke…
                  </Button>
                )}
              </div>
              {marking === goal.id && (
                <form
                  className="mt-1 space-y-1"
                  onSubmit={(event) => {
                    event.preventDefault();
                    mark.mutate(goal.id);
                  }}
                >
                  <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Evidence: “Booked by phone”" aria-label="Evidence" className={cn(inputClass, 'py-1')} maxLength={1000} />
                  <label className="flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
                    When it happens
                    <input type="datetime-local" value={eventAt} onChange={(event) => setEventAt(event.target.value)} className={cn(inputClass, 'w-auto py-0.5')} />
                  </label>
                  <Button size="sm" variant="primary" type="submit" disabled={mark.isPending}>
                    Mark “{goal.name}” achieved
                  </Button>
                </form>
              )}
              {revoking && highest && (
                <form
                  className="mt-1 flex gap-1"
                  onSubmit={(event) => {
                    event.preventDefault();
                    revoke.mutate(goal.id);
                  }}
                >
                  <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why it was wrong" aria-label="Why it was wrong" className={cn(inputClass, 'py-1')} minLength={3} required />
                  <Button size="sm" variant="danger" type="submit" disabled={revoke.isPending}>
                    Revoke
                  </Button>
                </form>
              )}
            </li>
          );
        })}
      </ol>
      <ErrorText error={mark.error ?? revoke.error} />
    </Section>
  );
}

export function ActivitySection({ activity, goalName }: { activity: Schemas['Activity'][]; goalName: (id: string) => string | undefined }) {
  return (
    <Section title="Activity">
      {activity.length === 0 && <p className="text-zinc-500 dark:text-zinc-400">Nothing yet.</p>}
      <ol className="space-y-1 text-xs">
        {activity.map((entry) => (
          <li key={entry.id} className="flex gap-2">
            <time dateTime={entry.occurred_at} className="w-24 shrink-0 text-zinc-500 dark:text-zinc-400">
              {new Date(entry.occurred_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </time>
            <span>{activityText(entry, goalName)}</span>
          </li>
        ))}
      </ol>
    </Section>
  );
}

export function AiRunsSection({ history }: { history: Classification[] }) {
  return (
    <Section title="AI decisions" open={false}>
      {history.length === 0 && <p className="text-zinc-500 dark:text-zinc-400">No AI runs on this thread.</p>}
      <ol className="space-y-1.5 text-xs">
        {history.map((run) => {
          const output = run.output as Record<string, Answer> | null;
          const intent = output?.intent?.choice ?? (output as { intent?: string } | null)?.intent;
          return (
            <li key={run.id} className="space-y-0.5">
              <p>
                <span className="font-medium">{run.provider === 'typesafe' ? 'Jev' : 'Claude'}</span> · {run.model} · <span className={cn(run.status !== 'ok' && 'text-rose-700 dark:text-rose-300')}>{words(run.status)}</span>
              </p>
              <p className="text-zinc-500 dark:text-zinc-400">
                {dateTime(run.created_at)}
                {typeof intent === 'string' && ` · ${words(intent)}`}
              </p>
            </li>
          );
        })}
      </ol>
    </Section>
  );
}
