'use client';

// The table of threads (spec §15.6): the Inbox, and a campaign's Threads tab. Each row opens the
// Thread view; ⌘- or Ctrl-click opens it in a new tab. Pages of 50 load on demand.

import { useInfiniteQuery } from '@tanstack/react-query';
import { Inbox as InboxIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { api, unwrap, type Schemas } from '../lib/api.ts';
import type { paths } from '../lib/api-types.ts';
import { ago, dateTime, percent, words } from '../lib/format.ts';
import { OpenMark, StagePill, StatePill, TemperatureDots } from './thread-bits.tsx';
import { Button, ErrorText, Loading } from './ui.tsx';

export type ThreadQuery = NonNullable<paths['/threads']['get']['parameters']['query']>;

export function ThreadTable({ query, classification }: { query: ThreadQuery; classification: boolean }) {
  const router = useRouter();
  const threads = useInfiniteQuery({
    queryKey: ['threads', 'table', query],
    queryFn: ({ pageParam }) => unwrap(api.GET('/threads', { params: { query: { ...query, ...(pageParam && { cursor: pageParam }) } } })),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.next_cursor,
    refetchInterval: 60_000,
  });
  if (threads.isPending) return <Loading />;
  if (threads.isError) return <ErrorText error={threads.error} onRetry={() => void threads.refetch()} />;
  const rows = threads.data.pages.flatMap((page) => page.data);
  if (rows.length === 0)
    return (
      <div className="flex flex-col items-center gap-2 py-16 text-center text-zinc-500 dark:text-zinc-400">
        <InboxIcon aria-hidden className="size-8" />
        <p>No conversations match.</p>
      </div>
    );

  return (
    <div className="relative overflow-x-auto rounded-[var(--radius-card)] border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-left">
        <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400 dark:border-zinc-800">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              Contact
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Last message
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Stage
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              State
            </th>
            {classification && (
              <>
                <th scope="col" className="px-3 py-2 font-medium">
                  Intent
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Temperature
                </th>
              </>
            )}
            <th scope="col" className="px-3 py-2 font-medium">
              Opened
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {rows.map((thread) => (
            <ThreadRow key={thread.id} thread={thread} classification={classification} open={(full) => (full ? window.open(`/threads/${thread.id}`, '_blank') : router.push(`/threads/${thread.id}`))} />
          ))}
        </tbody>
      </table>
      {threads.hasNextPage && (
        <div className="border-t border-zinc-200 p-2 text-center dark:border-zinc-800">
          <Button variant="ghost" onClick={() => threads.fetchNextPage()} disabled={threads.isFetchingNextPage}>
            {threads.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  );
}

function ThreadRow({ thread, classification, open }: { thread: Schemas['Thread']; classification: boolean; open: (newTab: boolean) => void }) {
  const last = thread.last_message_at;
  const ours = last !== null && last === thread.last_outbound_at;
  return (
    <tr onClick={(event) => open(event.metaKey || event.ctrlKey)} className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
      <td className="max-w-56 px-3 py-2">
        <Link href={`/threads/${thread.id}`} onClick={(event) => event.stopPropagation()} className="block truncate font-medium hover:underline">
          {thread.contact.name ?? thread.contact.email}
        </Link>
        <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">{[thread.contact.company, thread.campaign.name].filter(Boolean).join(' · ')}</span>
      </td>
      <td className="max-w-md px-3 py-2">
        <span className="block truncate">
          {ours && <span className="text-zinc-500 dark:text-zinc-400">You: </span>}
          {thread.summary ?? thread.subject ?? '(no subject)'}
        </span>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">{last ? ago(last) : thread.next_action.at ? `Scheduled ${dateTime(thread.next_action.at)}` : 'Nothing sent yet'}</span>
      </td>
      <td className="px-3 py-2">
        <StagePill thread={thread} />
      </td>
      <td className="px-3 py-2">
        <StatePill thread={thread} />
      </td>
      {classification && (
        <>
          <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{thread.classification.intent ? `${words(thread.classification.intent)} ${percent(thread.classification.intent_p)}` : '–'}</td>
          <td className="px-3 py-2">
            <TemperatureDots value={thread.classification.temperature} />
          </td>
        </>
      )}
      <td className="px-3 py-2">
        <OpenMark open={thread.open} />
      </td>
    </tr>
  );
}

