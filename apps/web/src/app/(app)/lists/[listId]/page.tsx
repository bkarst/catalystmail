'use client';

// A list's page (spec §15.14): its members (remove them from a static list), a segment's filter in
// the FilterBuilder with a live count and sample, renaming, "Enroll list" in a campaign, and delete.

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { contactName, EmailStatus } from '../../../../components/contact-bits.tsx';
import { FilterBuilder, isSimple, type Filter } from '../../../../components/filter-builder.tsx';
import { SegmentPreview } from '../../../../components/segment-preview.tsx';
import { Button, ErrorText, inputClass, Loading, Pill } from '../../../../components/ui.tsx';
import { api, unwrap, type Schemas } from '../../../../lib/api.ts';
import { cn } from '../../../../lib/cn.ts';
import { words } from '../../../../lib/format.ts';
import { usePerson } from '../../../../lib/person.tsx';

export default function ListPage() {
  const { listId } = useParams<{ listId: string }>();
  const list = useQuery({ queryKey: ['list', listId], queryFn: () => unwrap(api.GET('/lists/{listId}', { params: { path: { listId } } })) });
  if (list.isPending) return <Loading />;
  if (list.isError)
    return (
      <div className="space-y-2">
        <BackLink />
        <ErrorText error={list.error} onRetry={() => void list.refetch()} />
      </div>
    );
  return (
    <div className="space-y-4">
      <BackLink />
      <Header list={list.data} />
      {list.data.kind === 'dynamic' && <Segment list={list.data} />}
      <Members list={list.data} />
    </div>
  );
}

const BackLink = () => (
  <Link href="/lists" className="inline-flex items-center gap-1 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100">
    <ArrowLeft aria-hidden className="size-4" /> Lists
  </Link>
);

function Header({ list }: { list: Schemas['List'] }) {
  const person = usePerson();
  const router = useRouter();
  const client = useQueryClient();
  const [name, setName] = useState(list.name);
  const [panel, setPanel] = useState<'enroll' | 'delete' | null>(null);
  const [campaignId, setCampaignId] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const campaigns = useQuery({ queryKey: ['campaigns', 'options'], enabled: panel === 'enroll', queryFn: () => unwrap(api.GET('/campaigns', { params: { query: { limit: 100 } } })) });
  const rename = useMutation({ mutationFn: () => unwrap(api.PATCH('/lists/{listId}', { params: { path: { listId: list.id } }, body: { name: name.trim() } })), onSuccess: (updated) => (client.setQueryData(['list', list.id], updated), void client.invalidateQueries({ queryKey: ['lists'] })) });
  const enroll = useMutation({
    mutationFn: () => unwrap(api.POST('/campaigns/{campaignId}/enrollments', { params: { path: { campaignId } }, body: { list_id: list.id } })),
    onSuccess: (done) => {
      const reasons = [...new Set(done.skipped.map((entry) => words(entry.reason)))];
      setResult(`${done.created.length} enrolled${done.skipped.length ? `; ${done.skipped.length} skipped (${reasons.join(', ')})` : ''}.`);
      setPanel(null);
    },
  });
  const remove = useMutation({ mutationFn: () => unwrap(api.DELETE('/lists/{listId}', { params: { path: { listId: list.id } } })), onSuccess: () => (void client.invalidateQueries({ queryKey: ['lists'] }), router.push('/lists')) });
  const may = person.can('contacts:write');
  return (
    <header className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        {may ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              rename.mutate();
            }}
          >
            <input aria-label="List name" value={name} onChange={(event) => setName(event.target.value)} className={cn(inputClass, 'w-72 py-1 text-lg font-semibold')} maxLength={200} />
            {name.trim() !== list.name && (
              <Button type="submit" size="sm" disabled={rename.isPending || !name.trim()}>
                Rename
              </Button>
            )}
          </form>
        ) : (
          <h1 className="text-xl font-semibold">{list.name}</h1>
        )}
        <Pill>{list.kind === 'static' ? 'Static' : 'Segment'}</Pill>
        <span className="tabular-nums text-zinc-600 dark:text-zinc-400">{list.member_count} contacts</span>
        <div className="ml-auto flex gap-2">
          {person.can('campaigns:write') && <Button onClick={() => setPanel(panel === 'enroll' ? null : 'enroll')}>Enroll list…</Button>}
          {may && (
            <Button variant="ghost" onClick={() => setPanel(panel === 'delete' ? null : 'delete')}>
              Delete…
            </Button>
          )}
        </div>
      </div>
      {panel === 'enroll' && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            enroll.mutate();
          }}
        >
          <select aria-label="Campaign" required value={campaignId} onChange={(event) => setCampaignId(event.target.value)} className={cn(inputClass, 'w-auto py-1')}>
            <option value="">Choose a campaign…</option>
            {(campaigns.data?.data ?? [])
              .filter((campaign) => ['draft', 'active', 'paused'].includes(campaign.status))
              .map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </option>
              ))}
          </select>
          <Button type="submit" variant="primary" disabled={!campaignId || enroll.isPending}>
            Enroll {list.member_count} contacts
          </Button>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">Anyone who mustn’t be emailed is skipped, with the reason.</span>
        </form>
      )}
      {panel === 'delete' && (
        <p className="flex flex-wrap items-center gap-2">
          Delete this list? Its contacts are kept.
          <Button variant="danger" disabled={remove.isPending} onClick={() => remove.mutate()}>
            Delete
          </Button>
        </p>
      )}
      <ErrorText error={rename.error ?? enroll.error ?? remove.error} />
      {result && (
        <p role="status" className="text-emerald-700 dark:text-emerald-400">
          {result}
        </p>
      )}
    </header>
  );
}

function Segment({ list }: { list: Schemas['List'] }) {
  const person = usePerson();
  const client = useQueryClient();
  const tags = useQuery({ queryKey: ['tags'], queryFn: () => unwrap(api.GET('/tags', { params: { query: { limit: 100 } } })), staleTime: 300_000 });
  const simple = isSimple(list.filter);
  const [filter, setFilter] = useState<Filter>(() => (simple ? (list.filter as Filter) : { and: [] }));
  const changed = JSON.stringify(filter) !== JSON.stringify(list.filter);
  const save = useMutation({
    mutationFn: () => unwrap(api.PATCH('/lists/{listId}', { params: { path: { listId: list.id } }, body: { filter: filter as Record<string, unknown> } })),
    onSuccess: (updated) => (client.setQueryData(['list', list.id], updated), void client.invalidateQueries({ queryKey: ['list-members', list.id] }), void client.invalidateQueries({ queryKey: ['lists'] })),
  });
  return (
    <section aria-label="Filter" className="space-y-3 rounded-[var(--radius-card)] border border-zinc-200 p-4 dark:border-zinc-800">
      {simple ? (
        <>
          <FilterBuilder value={filter} onChange={setFilter} tags={tags.data?.data ?? []} disabled={!person.can('contacts:write')} />
          <SegmentPreview filter={filter} />
          {changed && person.can('contacts:write') && (
            <Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>
              Save the filter
            </Button>
          )}
        </>
      ) : (
        <>
          <p className="text-zinc-600 dark:text-zinc-400">This filter has nested groups, which the builder doesn’t show yet. Change it through the API.</p>
          <pre className="relative overflow-x-auto rounded-[var(--radius-card)] bg-zinc-50 p-3 font-mono text-xs dark:bg-zinc-900/50">{JSON.stringify(list.filter, null, 2)}</pre>
        </>
      )}
      <ErrorText error={save.error} />
    </section>
  );
}

function Members({ list }: { list: Schemas['List'] }) {
  const person = usePerson();
  const client = useQueryClient();
  const members = useInfiniteQuery({
    queryKey: ['list-members', list.id],
    queryFn: ({ pageParam }) => unwrap(api.GET('/lists/{listId}/members', { params: { path: { listId: list.id }, query: { limit: 50, ...(pageParam && { cursor: pageParam }) } } })),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.next_cursor,
  });
  const remove = useMutation({
    mutationFn: (contactId: string) => unwrap(api.DELETE('/lists/{listId}/members', { params: { path: { listId: list.id }, query: { contact_ids: contactId } } })),
    onSuccess: () => (void client.invalidateQueries({ queryKey: ['list-members', list.id] }), void client.invalidateQueries({ queryKey: ['list', list.id] })),
  });
  const rows = members.data?.pages.flatMap((page) => page.data) ?? [];
  return (
    <section aria-label="Members" className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Members</h2>
      {members.isPending && <Loading />}
      <ErrorText error={members.error ?? remove.error} />
      {members.data && rows.length === 0 && <p className="text-zinc-500 dark:text-zinc-400">{list.kind === 'static' ? 'Empty. Add contacts from the Contacts list: select them, then “Add to list”.' : 'No contact matches the filter yet.'}</p>}
      {rows.length > 0 && (
        <ul className="divide-y divide-zinc-200 rounded-[var(--radius-card)] border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {rows.map((contact) => (
            <li key={contact.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
              <Link href={`/contacts/${contact.id}`} className="font-medium hover:underline">
                {contactName(contact)}
              </Link>
              <span className="inline-flex items-center gap-1 text-zinc-600 dark:text-zinc-400">
                {contact.email} <EmailStatus contact={contact} />
              </span>
              <span className="ml-auto">{words(contact.lifecycle_stage)}</span>
              {list.kind === 'static' && person.can('contacts:write') && (
                <Button size="sm" variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate(contact.id)}>
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {members.hasNextPage && (
        <Button variant="ghost" onClick={() => members.fetchNextPage()} disabled={members.isFetchingNextPage}>
          Load more
        </Button>
      )}
    </section>
  );
}
