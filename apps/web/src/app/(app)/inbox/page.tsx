'use client';

// V3 Inbox (spec §15.6): every conversation, filtered by view and by campaign, stage, state, opens
// and mailbox, with a search over names, emails and subjects. The view and the filters live in the
// URL, so a filtered Inbox can be linked to. A row opens the Thread view (V4) as a page.
// The Unmatched view lists mail from known contacts that matched no thread (§7.4 step 6).

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Flame, Link2, Search } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

import { Button, ErrorText, inputClass, Loading, Pill } from '../../../components/ui.tsx';
import { ThreadTable, type ThreadQuery } from '../../../components/thread-table.tsx';
import { api, unwrap, type Schemas } from '../../../lib/api.ts';
import { cn } from '../../../lib/cn.ts';
import { ago, dateTime, words } from '../../../lib/format.ts';
import { usePerson } from '../../../lib/person.tsx';

const VIEWS = [
  { key: 'all', label: 'All' },
  { key: 'needs', label: 'Needs you' },
  { key: 'hot', label: 'Hot' },
  { key: 'mine', label: 'Assigned to me' },
  { key: 'unmatched', label: 'Unmatched' },
] as const;
type View = (typeof VIEWS)[number]['key'];

const STAGES = ['queued', 'sent', 'received', 'responded', 'goal_achieved'] as const;
const STATES = ['active', 'needs_human', 'pending_approval', 'paused', 'completed', 'exhausted', 'closed_lost', 'bounced', 'unsubscribed', 'stopped'] as const;
const OPENS = ['opened', 'machine_only', 'unopened', 'not_tracked'] as const;


export default function InboxPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Inbox />
    </Suspense>
  );
}

function Inbox() {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const person = usePerson();
  const view = (VIEWS.some((entry) => entry.key === params.get('view')) ? params.get('view') : 'all') as View;
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [classification, setClassification] = useState(false);

  /** Changes one URL parameter, keeping the rest. */
  const set = (name: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    router.replace(`${path}?${next}`, { scroll: false });
  };

  // The search box writes to the URL a moment after typing stops.
  useEffect(() => {
    const timer = setTimeout(() => {
      if ((params.get('q') ?? '') !== search.trim()) set('q', search.trim() || null);
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const campaigns = useQuery({ queryKey: ['campaigns', 'options'], queryFn: () => unwrap(api.GET('/campaigns', { params: { query: { limit: 100 } } })) });
  const mailboxes = useQuery({ queryKey: ['mailboxes', 'options'], queryFn: () => unwrap(api.GET('/mailboxes', { params: { query: { limit: 100 } } })) });
  const unmatchedCount = useQuery({ queryKey: ['unmatched', 'count'], queryFn: () => unwrap(api.GET('/messages/unmatched', { params: { query: { limit: 100 } } })) });

  const query: ThreadQuery = {
    limit: 50,
    ...(params.get('q') && { q: params.get('q')! }),
    ...(params.get('campaign') && { campaign_id: params.get('campaign')! }),
    ...(params.get('stage') && { stage: params.get('stage') as (typeof STAGES)[number] }),
    ...(params.get('state') && { state: params.get('state') as (typeof STATES)[number] }),
    ...(params.get('opened') && { open_status: params.get('opened') as (typeof OPENS)[number] }),
    ...(params.get('mailbox') && { mailbox_id: params.get('mailbox')! }),
    ...(view === 'needs' && { needs_attention: 'true' as const }),
    ...(view === 'hot' && { min_temperature: 2, sort: '-temperature' as const }),
    ...(view === 'mine' && { assigned_to: person.id }),
  };

  const filter = (name: string, label: string, options: readonly { value: string; label: string }[]) => (
    <label className="flex items-center gap-1 text-zinc-500 dark:text-zinc-400">
      <span className="sr-only">{label}</span>
      <select value={params.get(name) ?? ''} onChange={(event) => set(name, event.target.value || null)} className={cn(inputClass, 'w-auto py-1')}>
        <option value="">{label}: any</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <section aria-labelledby="inbox-title" className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <h1 id="inbox-title" className="text-2xl font-semibold">
          Inbox
        </h1>
        <nav aria-label="Inbox views" className="flex flex-wrap gap-1">
          {VIEWS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              aria-current={view === entry.key ? 'page' : undefined}
              onClick={() => set('view', entry.key === 'all' ? null : entry.key)}
              className={cn('flex items-center gap-1 rounded-[var(--radius-pill)] px-2.5 py-1 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900', view === entry.key && 'bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100')}
            >
              {entry.key === 'hot' && <Flame aria-hidden className="size-3.5 text-amber-600" />}
              {entry.label}
              {entry.key === 'unmatched' && unmatchedCount.data && unmatchedCount.data.data.length > 0 && <span className="text-xs text-zinc-600 dark:text-zinc-400">({unmatchedCount.data.data.length}{unmatchedCount.data.next_cursor ? '+' : ''})</span>}
            </button>
          ))}
        </nav>
      </div>

      {view === 'unmatched' ? (
        <Unmatched />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative flex min-w-56 flex-1 items-center">
              <Search aria-hidden className="pointer-events-none absolute left-2.5 size-4 text-zinc-500 dark:text-zinc-400" />
              <span className="sr-only">Search threads</span>
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search names, emails, subjects…" className={cn(inputClass, 'pl-8')} type="search" />
            </label>
            {filter('campaign', 'Campaign', (campaigns.data?.data ?? []).map((campaign) => ({ value: campaign.id, label: campaign.name })))}
            {filter('stage', 'Stage', STAGES.map((stage) => ({ value: stage, label: words(stage) })))}
            {filter('state', 'State', STATES.map((state) => ({ value: state, label: words(state) })))}
            {filter('opened', 'Opened', OPENS.map((open) => ({ value: open, label: words(open) })))}
            {filter('mailbox', 'Mailbox', (mailboxes.data?.data ?? []).map((mailbox) => ({ value: mailbox.id, label: mailbox.email })))}
            <label className="flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400">
              <input type="checkbox" checked={classification} onChange={(event) => setClassification(event.target.checked)} /> Intent and temperature
            </label>
          </div>
          <ThreadTable query={query} classification={classification || view === 'hot'} />
        </>
      )}
    </section>
  );
}

/** Inbox → Unmatched: attach each email to one of the sender's threads, or ignore it. */
function Unmatched() {
  const person = usePerson();
  const client = useQueryClient();
  const messages = useInfiniteQuery({
    queryKey: ['unmatched'],
    queryFn: ({ pageParam }) => unwrap(api.GET('/messages/unmatched', { params: { query: { limit: 50, ...(pageParam && { cursor: pageParam }) } } })),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.next_cursor,
  });
  const [attaching, setAttaching] = useState<string | null>(null);
  const ignore = useMutation({
    mutationFn: (messageId: string) => unwrap(api.POST('/messages/{messageId}/ignore', { params: { path: { messageId } } })),
    onSuccess: () => client.invalidateQueries({ queryKey: ['unmatched'] }),
  });

  if (messages.isPending) return <Loading />;
  if (messages.isError) return <ErrorText error={messages.error} onRetry={() => void messages.refetch()} />;
  const rows = messages.data.pages.flatMap((page) => page.data);
  if (rows.length === 0) return <p className="py-16 text-center text-zinc-500 dark:text-zinc-400">No unmatched mail. Replies from known contacts that match no thread show up here.</p>;
  return (
    <ul className="divide-y divide-zinc-200 rounded-[var(--radius-card)] border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
      {rows.map((message) => (
        <li key={message.id} className="space-y-2 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-medium">
              {message.from_name ? `${message.from_name} <${message.from_email}>` : message.from_email}
              <span className="ml-2 font-normal text-zinc-500 dark:text-zinc-400">{message.subject}</span>
            </p>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">{dateTime(message.received_at)}</span>
          </div>
          <p className="line-clamp-3 whitespace-pre-line text-zinc-600 dark:text-zinc-400">{message.stripped_text ?? message.snippet}</p>
          {message.inbound_kind && <Pill>{words(message.inbound_kind)}</Pill>}
          {person.can('threads:write') && (
            <div className="flex gap-2">
              <Button size="sm" onClick={() => setAttaching(attaching === message.id ? null : message.id)}>
                <Link2 aria-hidden className="size-3.5" /> Attach to thread…
              </Button>
              <Button size="sm" variant="ghost" disabled={ignore.isPending} onClick={() => ignore.mutate(message.id)}>
                Ignore
              </Button>
            </div>
          )}
          {attaching === message.id && <AttachPicker message={message} onDone={() => setAttaching(null)} />}
          {ignore.isError && ignore.variables === message.id && <ErrorText error={ignore.error} />}
        </li>
      ))}
    </ul>
  );
}

/** The sender's threads, newest first; picking one files the email there. */
function AttachPicker({ message, onDone }: { message: Schemas['Message']; onDone: () => void }) {
  const client = useQueryClient();
  const threads = useQuery({ queryKey: ['threads', 'for-sender', message.from_email], queryFn: () => unwrap(api.GET('/threads', { params: { query: { q: message.from_email, limit: 20 } } })) });
  const attach = useMutation({
    mutationFn: (threadId: string) => unwrap(api.POST('/messages/{messageId}/attach', { params: { path: { messageId: message.id } }, body: { thread_id: threadId } })),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['unmatched'] });
      void client.invalidateQueries({ queryKey: ['threads'] });
      onDone();
    },
  });
  if (threads.isPending) return <Loading />;
  if (threads.isError) return <ErrorText error={threads.error} onRetry={() => void threads.refetch()} />;
  if (threads.data.data.length === 0) return <p className="text-zinc-500 dark:text-zinc-400">{message.from_email} has no threads to attach it to.</p>;
  return (
    <div className="rounded-[var(--radius-card)] border border-zinc-200 p-2 dark:border-zinc-800">
      <p className="px-1 pb-1 text-xs text-zinc-500 dark:text-zinc-400">Attach to which conversation?</p>
      <ul>
        {threads.data.data.map((thread) => (
          <li key={thread.id}>
            <button type="button" disabled={attach.isPending} onClick={() => attach.mutate(thread.id)} className="flex w-full items-center justify-between gap-2 rounded-[var(--radius-pill)] px-2 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-900">
              <span className="truncate">
                {thread.subject ?? '(no subject)'} <span className="text-zinc-500 dark:text-zinc-400">· {thread.campaign.name}</span>
              </span>
              <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">{ago(thread.last_message_at)}</span>
            </button>
          </li>
        ))}
      </ul>
      <ErrorText error={attach.error} />
    </div>
  );
}
