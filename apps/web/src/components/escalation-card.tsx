'use client';

// One escalation and every way to settle it (spec §11.3, §15.5): why the agent stopped, the
// questions it couldn't answer, "Answer for the agent" (a new draft, with the answer saved to the
// knowledge base), Confirm or Not yet for a goal, take over, snooze, dismiss, or mark it done once
// you replied yourself. Used by Needs you and by the Thread view.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertOctagon, AlertTriangle, Circle, Clock } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { api, unwrap, type Schemas } from '../lib/api.ts';
import { cn } from '../lib/cn.ts';
import { percent, timeLeft, words } from '../lib/format.ts';
import { usePerson } from '../lib/person.tsx';
import { Button, ErrorText, inputClass, Pill, textareaClass } from './ui.tsx';

type Escalation = Schemas['Escalation'];

export const PRIORITY = {
  urgent: { label: 'Urgent', icon: AlertOctagon, tone: 'rose' },
  high: { label: 'High', icon: AlertTriangle, tone: 'amber' },
  normal: { label: 'Normal', icon: Circle, tone: 'zinc' },
} as const;

export function PriorityPill({ priority }: { priority: keyof typeof PRIORITY }) {
  const entry = PRIORITY[priority];
  return (
    <Pill tone={entry.tone}>
      <entry.icon aria-hidden className="size-3" />
      {entry.label}
    </Pill>
  );
}

/** Reasons where the agent was missing an answer a person can give it (§11.3). */
const ANSWERABLE = new Set(['knowledge_gap', 'low_confidence', 'pricing_negotiation', 'meeting_logistics', 'high_value']);

const SNOOZES = [
  { label: '1 hour', at: () => new Date(Date.now() + 3_600_000) },
  { label: 'Tomorrow 9:00', at: () => nextMorning(1) },
  { label: 'Monday 9:00', at: () => nextMorning((8 - new Date().getDay()) % 7 || 7) },
] as const;

function nextMorning(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(9, 0, 0, 0);
  return date;
}

export function EscalationCard({ escalation, inThread = false, onWriteMyself }: { escalation: Escalation; inThread?: boolean; onWriteMyself?: () => void }) {
  const person = usePerson();
  const client = useQueryClient();
  const [answer, setAnswer] = useState('');
  const [save, setSave] = useState(true);
  const [scope, setScope] = useState<'campaign' | 'workspace'>('campaign');
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState('');
  const [answered, setAnswered] = useState<string | null>(null);
  const may = person.can('escalations:write');

  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['work-queue'] });
    void client.invalidateQueries({ queryKey: ['escalations'] });
    if (escalation.thread_id) void client.invalidateQueries({ queryKey: ['thread', escalation.thread_id] });
    void client.invalidateQueries({ queryKey: ['threads'] });
  };
  const path = { params: { path: { escalationId: escalation.id } } };
  const act = useMutation({
    mutationFn: async (action: { kind: 'resolve'; resolution: 'replied' | 'goal_confirmed' | 'goal_rejected' | 'took_over' } | { kind: 'snooze'; until: Date } | { kind: 'dismiss'; reason: string }) => {
      if (action.kind === 'resolve') return unwrap(api.POST('/escalations/{escalationId}/resolve', { ...path, body: { resolution: action.resolution } }));
      if (action.kind === 'snooze') return unwrap(api.POST('/escalations/{escalationId}/snooze', { ...path, body: { until: action.until.toISOString() } }));
      return unwrap(api.POST('/escalations/{escalationId}/dismiss', { ...path, body: { reason: action.reason } }));
    },
    onSuccess: refresh,
  });
  const answerForAgent = useMutation({
    mutationFn: () => unwrap(api.POST('/escalations/{escalationId}/answer', { ...path, body: { answer: answer.trim(), save_to_knowledge: save, knowledge_scope: scope } })),
    onSuccess: (result) => {
      setAnswered(result.draft.id);
      refresh();
    },
  });

  const due = timeLeft(escalation.due_at);
  const settled = escalation.status === 'resolved' || escalation.status === 'dismissed';
  const busy = act.isPending || answerForAgent.isPending;

  return (
    <article aria-label={escalation.title} className={cn('space-y-3 rounded-[var(--radius-card)] border p-4', escalation.priority === 'urgent' ? 'border-rose-200 dark:border-rose-900' : 'border-amber-200 dark:border-amber-900')}>
      <header className="flex flex-wrap items-center gap-2">
        <PriorityPill priority={escalation.priority} />
        <span className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{escalation.reasons.map(words).join(' · ')}</span>
        {!settled && (
          <span className={cn('ml-auto flex items-center gap-1 text-xs', due.overdue ? 'font-medium text-rose-700 dark:text-rose-300' : 'text-zinc-500 dark:text-zinc-400')}>
            <Clock aria-hidden className="size-3" />
            {escalation.status === 'snoozed' ? 'Snoozed' : due.text}
          </span>
        )}
      </header>
      <div>
        <h2 className="font-medium">{escalation.title}</h2>
        <p className="mt-1 text-zinc-600 dark:text-zinc-400">{escalation.explanation}</p>
        {escalation.goal_p !== null && <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Classifier’s confidence: {percent(escalation.goal_p)}</p>}
      </div>
      {escalation.questions.length > 0 && (
        <ul className="list-disc space-y-1 pl-5">
          {escalation.questions.map((question) => (
            <li key={question.text}>
              {question.text} <span className="text-zinc-500 dark:text-zinc-400">({question.why_unanswerable})</span>
            </li>
          ))}
        </ul>
      )}

      {settled ? (
        <p className="text-zinc-500 dark:text-zinc-400">
          {words(escalation.resolution ?? escalation.status)}
          {escalation.resolution_note && `: ${escalation.resolution_note}`}
        </p>
      ) : (
        may && (
          <div className="space-y-3">
            {escalation.reason === 'goal_confirmation' && escalation.goal_id && (
              <div className="flex gap-2">
                <Button variant="primary" disabled={busy} onClick={() => act.mutate({ kind: 'resolve', resolution: 'goal_confirmed' })}>
                  Confirm
                </Button>
                <Button disabled={busy} onClick={() => act.mutate({ kind: 'resolve', resolution: 'goal_rejected' })}>
                  Not yet
                </Button>
              </div>
            )}

            {(ANSWERABLE.has(escalation.reason) || escalation.questions.length > 0) && escalation.thread_id && (
              <form
                className="space-y-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (answer.trim()) answerForAgent.mutate();
                }}
              >
                <label className="block text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Answer for the agent
                  <textarea value={answer} onChange={(event) => setAnswer(event.target.value)} className={cn(textareaClass, 'mt-1 min-h-20 normal-case tracking-normal text-zinc-900 dark:text-zinc-100')} placeholder="SAML SSO: yes, on the Business plan. SCIM: Q1 2027." />
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={save} onChange={(event) => setSave(event.target.checked)} /> Save to the knowledge base
                  </label>
                  {save && (
                    <select aria-label="Applies to" value={scope} onChange={(event) => setScope(event.target.value as 'campaign' | 'workspace')} className={cn(inputClass, 'w-auto py-1')}>
                      <option value="campaign">This campaign</option>
                      <option value="workspace">Every campaign</option>
                    </select>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" variant="primary" disabled={busy || !answer.trim()}>
                    {answerForAgent.isPending ? 'Drafting…' : 'Draft reply with this answer'}
                  </Button>
                  {onWriteMyself ? (
                    <Button variant="ghost" onClick={onWriteMyself}>
                      Write it myself
                    </Button>
                  ) : (
                    <Link href={`/threads/${escalation.thread_id}#composer`} className="inline-flex items-center px-3 py-1.5 text-zinc-600 hover:underline dark:text-zinc-400">
                      Write it myself
                    </Link>
                  )}
                </div>
                <ErrorText error={answerForAgent.error} />
                {answered && (
                  <p className="text-emerald-700 dark:text-emerald-400">
                    The agent drafted a reply with your answer; it waits for your approval{inThread ? ' below.' : '.'}{' '}
                    {!inThread && (
                      <Link className="underline" href={`/threads/${escalation.thread_id}`}>
                        Review it
                      </Link>
                    )}
                  </p>
                )}
              </form>
            )}

            <div className="flex flex-wrap items-center gap-x-1 gap-y-1 text-zinc-600 dark:text-zinc-400">
              {escalation.thread_id && (
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => act.mutate({ kind: 'resolve', resolution: 'replied' })} title="You answered the contact yourself">
                  I replied: done
                </Button>
              )}
              {escalation.thread_id && (
                <Button size="sm" variant="ghost" data-shortcut="take-over" disabled={busy} onClick={() => act.mutate({ kind: 'resolve', resolution: 'took_over' })} title="The agent stops writing on this thread (t)">
                  Take over thread
                </Button>
              )}
              <label className="flex items-center gap-1 text-xs">
                <span className="sr-only">Snooze</span>
                <select
                  value=""
                  disabled={busy}
                  onChange={(event) => {
                    const choice = SNOOZES.find((entry) => entry.label === event.target.value);
                    if (choice) act.mutate({ kind: 'snooze', until: choice.at() });
                  }}
                  className="rounded-[var(--radius-pill)] bg-transparent px-1 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-900"
                >
                  <option value="">Snooze…</option>
                  {SNOOZES.map((entry) => (
                    <option key={entry.label}>{entry.label}</option>
                  ))}
                </select>
              </label>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDismissing(!dismissing)}>
                Dismiss…
              </Button>
              {!inThread && escalation.thread_id && (
                <Link href={`/threads/${escalation.thread_id}`} className="ml-auto text-xs text-indigo-700 hover:underline dark:text-indigo-300">
                  View thread →
                </Link>
              )}
            </div>
            {dismissing && (
              <form
                className="flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (reason.trim().length >= 3) act.mutate({ kind: 'dismiss', reason: reason.trim() });
                }}
              >
                <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why no action is needed" aria-label="Why no action is needed" className={inputClass} minLength={3} required />
                <Button type="submit" disabled={busy}>
                  Dismiss
                </Button>
              </form>
            )}
            <ErrorText error={act.error} />
          </div>
        )
      )}
    </article>
  );
}
