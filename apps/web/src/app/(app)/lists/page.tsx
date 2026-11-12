'use client';

// V12 Lists & segments (spec §15.14): static and dynamic lists in two tabs, with their member
// counts. A new static list starts empty (add contacts from the Contacts list's bulk bar); a new
// dynamic list is a filter, built with a live count and sample. A list opens its own page.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { List as ListIcon, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { FilterBuilder, type Filter } from '../../../components/filter-builder.tsx';
import { SegmentPreview } from '../../../components/segment-preview.tsx';
import { Button, ErrorText, inputClass, Loading } from '../../../components/ui.tsx';
import { api, unwrap } from '../../../lib/api.ts';
import { cn } from '../../../lib/cn.ts';
import { ago } from '../../../lib/format.ts';
import { usePerson } from '../../../lib/person.tsx';

export default function ListsPage() {
  const person = usePerson();
  const [kind, setKind] = useState<'static' | 'dynamic'>('static');
  const [adding, setAdding] = useState(false);
  const lists = useQuery({ queryKey: ['lists', kind], queryFn: () => unwrap(api.GET('/lists', { params: { query: { limit: 100, kind } } })) });
  return (
    <section aria-labelledby="lists-title" className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 id="lists-title" className="text-2xl font-semibold">
          Lists
        </h1>
        <nav aria-label="List kinds" className="flex gap-1">
          {(['static', 'dynamic'] as const).map((entry) => (
            <button key={entry} type="button" aria-current={kind === entry ? 'page' : undefined} onClick={() => setKind(entry)} className={cn('rounded-[var(--radius-pill)] px-2.5 py-1 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900', kind === entry && 'bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100')}>
              {entry === 'static' ? 'Static lists' : 'Segments (dynamic)'}
            </button>
          ))}
        </nav>
        {person.can('contacts:write') && (
          <Button variant="primary" className="ml-auto" onClick={() => setAdding(!adding)}>
            <Plus aria-hidden className="size-4" /> New {kind === 'static' ? 'list' : 'segment'}
          </Button>
        )}
      </div>
      {adding && <NewList kind={kind} onDone={() => setAdding(false)} />}
      {lists.isPending && <Loading />}
      <ErrorText error={lists.error} onRetry={() => void lists.refetch()} />
      {lists.data && lists.data.data.length === 0 && !adding && (
        <div className="flex flex-col items-center gap-2 py-16 text-center text-zinc-500 dark:text-zinc-400">
          <ListIcon aria-hidden className="size-8" />
          <p>{kind === 'static' ? 'No static lists yet. A static list holds the contacts you put in it.' : 'No segments yet. A segment holds whoever matches its filter, now and later.'}</p>
        </div>
      )}
      {lists.data && lists.data.data.length > 0 && (
        <ul className="divide-y divide-zinc-200 rounded-[var(--radius-card)] border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {lists.data.data.map((list) => (
            <li key={list.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
              <Link href={`/lists/${list.id}`} className="font-medium hover:underline">
                {list.name}
              </Link>
              <span className="tabular-nums text-zinc-600 dark:text-zinc-400">{list.member_count} contacts</span>
              <span className="ml-auto text-xs text-zinc-500 dark:text-zinc-400">changed {ago(list.updated_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function NewList({ kind, onDone }: { kind: 'static' | 'dynamic'; onDone: () => void }) {
  const client = useQueryClient();
  const router = useRouter();
  const [name, setName] = useState('');
  const [filter, setFilter] = useState<Filter>({ and: [{ field: 'lifecycle_stage', op: 'eq', value: 'lead' }] });
  const tags = useQuery({ queryKey: ['tags'], queryFn: () => unwrap(api.GET('/tags', { params: { query: { limit: 100 } } })), staleTime: 300_000 });
  const create = useMutation({
    mutationFn: () => unwrap(api.POST('/lists', { body: { name: name.trim(), kind, ...(kind === 'dynamic' && { filter: filter as Record<string, unknown> }) } })),
    onSuccess: (list) => (void client.invalidateQueries({ queryKey: ['lists'] }), onDone(), router.push(`/lists/${list.id}`)),
  });
  return (
    <form
      className="space-y-3 rounded-[var(--radius-card)] border border-zinc-200 p-4 dark:border-zinc-800"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        create.mutate();
      }}
    >
      <label className="block max-w-md text-xs text-zinc-500 dark:text-zinc-400">
        Name
        <input required value={name} onChange={(event) => setName(event.target.value)} className={cn(inputClass, 'mt-0.5 text-sm text-zinc-900 dark:text-zinc-100')} maxLength={200} />
      </label>
      {kind === 'dynamic' && (
        <>
          <FilterBuilder value={filter} onChange={setFilter} tags={tags.data?.data ?? []} />
          <SegmentPreview filter={filter} />
        </>
      )}
      {kind === 'static' && <p className="text-xs text-zinc-500 dark:text-zinc-400">Add contacts from the Contacts list: select them, then “Add to list”.</p>}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={create.isPending}>
          Create
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
      <ErrorText error={create.error} />
    </form>
  );
}
