'use client';

// V2 Needs you (spec §15.5): everything waiting for a person, most urgent first, from the work
// queue, with the selected item settled on the right: an escalation with the reply that raised it
// and every way to settle it, a draft to approve, edit, regenerate or reject. "Review drafts" shows
// only the drafts. On narrow screens the list and the detail stack.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';

import { EscalationCard, PriorityPill } from '../../../components/escalation-card.tsx';
import { DraftCard } from '../../../components/thread/messages.tsx';
import { ErrorText, Loading } from '../../../components/ui.tsx';
import { api, unwrap, type Schemas } from '../../../lib/api.ts';
import { cn } from '../../../lib/cn.ts';
import { ago, timeLeft } from '../../../lib/format.ts';

type Item = Schemas['WorkItem'];

const KIND: Record<string, string> = {
  escalation: 'Escalation',
  draft: 'To approve',
  unmatched_reply: 'Unmatched',
  mailbox: 'Mailbox',
  reply_needed: 'Reply needed',
  follow_up_needed: 'Follow-up due',
};

const keyOf = (item: Item) => `${item.kind}:${item.id}`;

function tomorrowMorning(): Date {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(9, 0, 0, 0);
  return date;
}

export default function NeedsYouPage() {
  return (
    <Suspense fallback={<Loading />}>
      <NeedsYou />
    </Suspense>
  );
}

function NeedsYou() {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const tab = params.get('tab') === 'drafts' ? 'drafts' : 'all';
  const queue = useQuery({ queryKey: ['work-queue'], queryFn: () => unwrap(api.GET('/work-queue', { params: { query: { limit: 200 } } })), refetchInterval: 60_000 });
  const go = (next: { tab?: string; item?: string | null }) => {
    const search = new URLSearchParams(params);
    for (const [name, value] of Object.entries(next)) {
      if (value && !(name === 'tab' && value === 'all')) search.set(name, value);
      else search.delete(name);
    }
    router.replace(`${path}?${search}`, { scroll: false });
  };

  const items = (queue.data?.items ?? []).filter((item) => tab === 'all' || item.kind === 'draft');
  const selected = items.find((item) => keyOf(item) === params.get('item')) ?? items[0];

  // §15.3 and §15.5: j and k move through the list, e approves the selected draft, s snoozes the
  // selected escalation until tomorrow morning, t takes its thread over, r opens the thread's reply
  // box, Enter opens the thread.
  const client = useQueryClient();
  const snooze = useMutation({
    mutationFn: (id: string) => unwrap(api.POST('/escalations/{escalationId}/snooze', { params: { path: { escalationId: id } }, body: { until: tomorrowMorning().toISOString() } })),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['work-queue'] });
      void client.invalidateQueries({ queryKey: ['escalations'] });
    },
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.metaKey || event.ctrlKey || event.altKey || target.closest('input, textarea, select, [contenteditable=true]')) return;
      const index = selected ? items.findIndex((item) => keyOf(item) === keyOf(selected)) : -1;
      const next = items[index + 1] ?? items[index - 1];
      if (event.key === 'j' && index < items.length - 1) go({ item: keyOf(items[index + 1]!) });
      else if (event.key === 'k' && index > 0) go({ item: keyOf(items[index - 1]!) });
      else if (event.key === 'e') document.querySelector<HTMLButtonElement>('[data-shortcut=approve]:not(:disabled)')?.click();
      else if (event.key === 's' && selected?.kind === 'escalation' && !snooze.isPending) {
        snooze.mutate(selected.id);
        go({ item: next ? keyOf(next) : null });
      } else if (event.key === 't') document.querySelector<HTMLButtonElement>('[data-shortcut=take-over]:not(:disabled)')?.click();
      else if (event.key === 'r' && selected?.thread_id) router.push(`/threads/${selected.thread_id}#composer`);
      else if (event.key === 'Enter' && selected?.thread_id && target === document.body) router.push(`/threads/${selected.thread_id}`);
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const waiting = queue.data ? queue.data.counts.escalation + queue.data.counts.draft : 0;

  return (
    <section aria-labelledby="needs-you-title" className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <h1 id="needs-you-title" className="text-2xl font-semibold">
          Needs you {queue.data && <span className="text-base font-normal text-zinc-500 dark:text-zinc-400">({waiting} open)</span>}
        </h1>
        <p className="hidden text-xs text-zinc-500 dark:text-zinc-400 lg:block">
          <kbd>j</kbd>/<kbd>k</kbd> move · <kbd>e</kbd> approve · <kbd>s</kbd> snooze · <kbd>t</kbd> take over · <kbd>r</kbd> reply · <kbd>Enter</kbd> open
        </p>
        <nav aria-label="Needs you views" className="flex gap-1">
          {[
            { key: 'all', label: 'Everything' },
            { key: 'drafts', label: `Review drafts${queue.data ? ` (${queue.data.counts.draft})` : ''}` },
          ].map((entry) => (
            <button
              key={entry.key}
              type="button"
              aria-current={tab === entry.key ? 'page' : undefined}
              onClick={() => go({ tab: entry.key, item: null })}
              className={cn('rounded-[var(--radius-pill)] px-2.5 py-1 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900', tab === entry.key && 'bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100')}
            >
              {entry.label}
            </button>
          ))}
        </nav>
      </div>
      {queue.isPending && <Loading />}
      <ErrorText error={queue.error} onRetry={() => void queue.refetch()} />
      <ErrorText error={snooze.error} />
      {snooze.isSuccess && (
        <p role="status" className="text-zinc-600 dark:text-zinc-400">
          Snoozed until tomorrow 9:00.
        </p>
      )}
      {queue.data && items.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-16 text-center text-zinc-500 dark:text-zinc-400">
          <CheckCircle2 aria-hidden className="size-8 text-emerald-600" />
          <p>{tab === 'drafts' ? 'No drafts are waiting.' : 'Nothing needs you right now.'}</p>
        </div>
      )}
      {items.length > 0 && (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
          <ul aria-label="Waiting items" className="divide-y divide-zinc-200 self-start rounded-[var(--radius-card)] border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {items.map((item) => {
              const due = item.due_at ? timeLeft(item.due_at) : null;
              const current = selected && keyOf(selected) === keyOf(item);
              return (
                <li key={keyOf(item)}>
                  <button type="button" aria-current={current ? 'true' : undefined} onClick={() => go({ item: keyOf(item) })} className={cn('block w-full space-y-1 px-3 py-2.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900/50', current && 'bg-indigo-50/60 dark:bg-indigo-950/40')}>
                    <span className="flex items-center gap-2">
                      <PriorityPill priority={item.priority} />
                      <span className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{KIND[item.kind] ?? item.kind}</span>
                      <span className={cn('ml-auto flex items-center gap-1 text-xs', due?.overdue ? 'font-medium text-rose-700 dark:text-rose-300' : 'text-zinc-500 dark:text-zinc-400')}>
                        <Clock aria-hidden className="size-3" />
                        {due ? due.text : ago(item.created_at)}
                      </span>
                    </span>
                    <span className="block truncate font-medium">{item.title}</span>
                    <span className="line-clamp-2 block text-xs text-zinc-600 dark:text-zinc-400">{item.why}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {selected && <Detail key={keyOf(selected)} item={selected} />}
        </div>
      )}
    </section>
  );
}

function Detail({ item }: { item: Item }) {
  if (item.kind === 'escalation') return <EscalationDetail id={item.id} />;
  if (item.kind === 'draft') return <DraftDetail id={item.id} />;
  return (
    <div className="space-y-2 rounded-[var(--radius-card)] border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 className="font-medium">{item.title}</h2>
      <p className="text-zinc-600 dark:text-zinc-400">{item.why}</p>
      {item.kind === 'unmatched_reply' && (
        <Link href="/inbox?view=unmatched" className="text-indigo-700 hover:underline dark:text-indigo-300">
          Open Inbox → Unmatched →
        </Link>
      )}
      {(item.kind === 'reply_needed' || item.kind === 'follow_up_needed') && item.thread_id && (
        <Link href={`/threads/${item.thread_id}#composer`} className="text-indigo-700 hover:underline dark:text-indigo-300">
          Open the thread →
        </Link>
      )}
      {item.kind === 'mailbox' && <p className="text-xs text-zinc-500 dark:text-zinc-400">Mailbox settings come with the Deliverability view.</p>}
    </div>
  );
}

function EscalationDetail({ id }: { id: string }) {
  const escalation = useQuery({ queryKey: ['escalations', id], queryFn: () => unwrap(api.GET('/escalations/{escalationId}', { params: { path: { escalationId: id } } })) });
  const triggerId = escalation.data?.trigger_message_id;
  const trigger = useQuery({ queryKey: ['message', triggerId], enabled: Boolean(triggerId), queryFn: () => unwrap(api.GET('/messages/{messageId}', { params: { path: { messageId: triggerId! } } })) });
  const threadId = escalation.data?.thread_id;
  const thread = useQuery({ queryKey: ['thread', threadId], enabled: Boolean(threadId), queryFn: () => unwrap(api.GET('/threads/{threadId}', { params: { path: { threadId: threadId! } } })) });
  if (escalation.isPending) return <Loading />;
  if (escalation.isError) return <ErrorText error={escalation.error} onRetry={() => void escalation.refetch()} />;
  return (
    <div className="space-y-4">
      {thread.data && (
        <p className="text-zinc-600 dark:text-zinc-400">
          <span className="font-medium text-zinc-900 dark:text-zinc-100">{thread.data.contact.name ?? thread.data.contact.email}</span>
          {[thread.data.contact.company, thread.data.campaign.name, thread.data.stage_label].filter(Boolean).map((part) => ` · ${part}`)}
        </p>
      )}
      <EscalationCard escalation={escalation.data} />
      {trigger.data && (
        <figure className="space-y-1">
          <figcaption className="flex items-baseline justify-between text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            {trigger.data.direction === 'inbound' ? 'Their message' : 'The email'}
            {threadId && (
              <Link href={`/threads/${threadId}`} className="normal-case tracking-normal text-indigo-700 hover:underline dark:text-indigo-300">
                View thread →
              </Link>
            )}
          </figcaption>
          <blockquote className="whitespace-pre-wrap break-words rounded-[var(--radius-card)] border border-zinc-200 bg-zinc-50 p-3 leading-relaxed dark:border-zinc-800 dark:bg-zinc-900/40">{trigger.data.stripped_text ?? trigger.data.body_text ?? trigger.data.snippet}</blockquote>
        </figure>
      )}
      {escalation.data.suggested_draft_id && <SuggestedDraft id={escalation.data.suggested_draft_id} />}
    </div>
  );
}

function SuggestedDraft({ id }: { id: string }) {
  const draft = useQuery({ queryKey: ['message', id], queryFn: () => unwrap(api.GET('/messages/{messageId}', { params: { path: { messageId: id } } })) });
  if (!draft.data || (draft.data.status !== 'draft' && draft.data.status !== 'pending_approval')) return null;
  return <DraftCard draft={draft.data} />;
}

function DraftDetail({ id }: { id: string }) {
  const draft = useQuery({ queryKey: ['message', id], queryFn: () => unwrap(api.GET('/messages/{messageId}', { params: { path: { messageId: id } } })) });
  if (draft.isPending) return <Loading />;
  if (draft.isError) return <ErrorText error={draft.error} onRetry={() => void draft.refetch()} />;
  if (draft.data.status !== 'draft' && draft.data.status !== 'pending_approval') return <p className="text-zinc-500 dark:text-zinc-400">This email is {draft.data.status} now.</p>;
  return <DraftCard draft={draft.data} showThreadLink />;
}
