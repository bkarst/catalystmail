'use client';

// V8 Contacts list (spec §15.11): search, filters (lifecycle, tag, email status, subscription),
// and a table with each contact's email status, company, lifecycle, last touch and last open.
// Selecting contacts offers the bulk actions: enroll in a campaign, tag, add to a list, verify,
// suppress, export and delete. "Add contact" creates one. Import, saved views, configurable
// columns and the merge view are not built yet.

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, UserPlus, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';

import { contactName, EmailStatus } from '../../../components/contact-bits.tsx';
import { Button, ErrorText, inputClass, Loading } from '../../../components/ui.tsx';
import { api, unwrap, type Schemas } from '../../../lib/api.ts';
import type { paths } from '../../../lib/api-types.ts';
import { cn } from '../../../lib/cn.ts';
import { ago, words } from '../../../lib/format.ts';
import { usePerson } from '../../../lib/person.tsx';

type ContactQuery = NonNullable<paths['/contacts']['get']['parameters']['query']>;
const LIFECYCLE = ['lead', 'prospect', 'engaged', 'opportunity', 'customer', 'churned', 'disqualified'] as const;
const VERIFICATION = ['valid', 'risky', 'catch_all', 'invalid', 'bounced', 'unverified'] as const;
const SUBSCRIPTION = ['subscribed', 'unsubscribed', 'complained'] as const;

export default function ContactsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Contacts />
    </Suspense>
  );
}

function Contacts() {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const person = usePerson();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const set = (name: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    router.replace(`${path}?${next}`, { scroll: false });
    setSelected(new Set());
  };
  useEffect(() => {
    const timer = setTimeout(() => {
      if ((params.get('q') ?? '') !== search.trim()) set('q', search.trim() || null);
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const tags = useQuery({ queryKey: ['tags'], queryFn: () => unwrap(api.GET('/tags', { params: { query: { limit: 100 } } })), staleTime: 300_000 });
  const companies = useQuery({ queryKey: ['companies', 'options'], queryFn: () => unwrap(api.GET('/companies', { params: { query: { limit: 100 } } })), staleTime: 300_000 });
  const query: ContactQuery = {
    limit: 50,
    ...(params.get('q') && { q: params.get('q')! }),
    ...(params.get('lifecycle') && { lifecycle_stage: params.get('lifecycle') as (typeof LIFECYCLE)[number] }),
    ...(params.get('verification') && { email_verification: params.get('verification') as (typeof VERIFICATION)[number] }),
    ...(params.get('subscription') && { subscription_status: params.get('subscription') as (typeof SUBSCRIPTION)[number] }),
    ...(params.get('tag') && { tag_id: params.get('tag')! }),
    ...(params.get('sort') && { sort: params.get('sort') as ContactQuery['sort'] }),
  };
  const contacts = useInfiniteQuery({
    queryKey: ['contacts', 'table', query],
    queryFn: ({ pageParam }) => unwrap(api.GET('/contacts', { params: { query: { ...query, ...(pageParam && { cursor: pageParam }) } } })),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.next_cursor,
  });
  const rows = contacts.data?.pages.flatMap((page) => page.data) ?? [];
  const companyName = (id: string | null) => (id ? companies.data?.data.find((company) => company.id === id)?.name : undefined);

  const filter = (name: string, label: string, options: readonly { value: string; label: string }[]) => (
    <label className="flex items-center gap-1">
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
  const toggle = (id: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  return (
    <section aria-labelledby="contacts-title" className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <h1 id="contacts-title" className="text-2xl font-semibold">
          Contacts
        </h1>
        {person.can('contacts:write') && (
          <Link href="/contacts/import" className="ml-auto inline-flex items-center rounded-[var(--radius-pill)] border border-zinc-200 px-3 py-1.5 font-medium hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900">
            Import
          </Link>
        )}
        {person.can('contacts:write') && (
          <Button variant="primary" onClick={() => setAdding(!adding)}>
            <UserPlus aria-hidden className="size-4" /> Add contact
          </Button>
        )}
      </div>
      {adding && <AddContact onDone={() => setAdding(false)} />}
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex min-w-56 flex-1 items-center">
          <Search aria-hidden className="pointer-events-none absolute left-2.5 size-4 text-zinc-500 dark:text-zinc-400" />
          <span className="sr-only">Search contacts</span>
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search names, emails, titles…" className={cn(inputClass, 'pl-8')} />
        </label>
        {filter('lifecycle', 'Lifecycle', LIFECYCLE.map((value) => ({ value, label: words(value) })))}
        {filter('tag', 'Tag', (tags.data?.data ?? []).map((tag) => ({ value: tag.id, label: tag.name })))}
        {filter('verification', 'Email status', VERIFICATION.map((value) => ({ value, label: words(value) })))}
        {filter('subscription', 'Subscription', SUBSCRIPTION.map((value) => ({ value, label: words(value) })))}
        {filter('sort', 'Sort', [
          { value: '-updated_at', label: 'Recently changed' },
          { value: '-last_contacted_at', label: 'Recently emailed' },
          { value: '-last_replied_at', label: 'Recent replies' },
          { value: 'email', label: 'Email A–Z' },
        ])}
      </div>

      {selected.size > 0 && <BulkBar ids={[...selected]} onDone={() => setSelected(new Set())} tags={tags.data?.data ?? []} />}

      {contacts.isPending && <Loading />}
      <ErrorText error={contacts.error} onRetry={() => void contacts.refetch()} />
      {contacts.data && rows.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-16 text-center text-zinc-500 dark:text-zinc-400">
          <Users aria-hidden className="size-8" />
          <p>No contacts match.</p>
        </div>
      )}
      {rows.length > 0 && (
        <div className="relative overflow-x-auto rounded-[var(--radius-card)] border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left">
            <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400 dark:border-zinc-800">
              <tr>
                <th scope="col" className="w-8 px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label="Select every contact shown"
                    checked={rows.length > 0 && rows.every((row) => selected.has(row.id))}
                    onChange={(event) => setSelected(event.target.checked ? new Set(rows.map((row) => row.id)) : new Set())}
                  />
                </th>
                {['Name', 'Email', 'Company', 'Lifecycle', 'Last touch', 'Opened'].map((heading) => (
                  <th key={heading} scope="col" className="px-3 py-2 font-medium">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {rows.map((contact) => {
                const touch = [contact.last_contacted_at, contact.last_replied_at].filter(Boolean).sort().at(-1);
                return (
                  <tr key={contact.id} className={cn('hover:bg-zinc-50 dark:hover:bg-zinc-900/50', selected.has(contact.id) && 'bg-indigo-50/50 dark:bg-indigo-950/30')}>
                    <td className="px-3 py-2">
                      <input type="checkbox" aria-label={`Select ${contactName(contact)}`} checked={selected.has(contact.id)} onChange={() => toggle(contact.id)} />
                    </td>
                    <td className="max-w-56 px-3 py-2">
                      <Link href={`/contacts/${contact.id}`} className="block truncate font-medium hover:underline">
                        {contactName(contact)}
                      </Link>
                      {contact.title && <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">{contact.title}</span>}
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1">
                        {contact.email} <EmailStatus contact={contact} />
                      </span>
                    </td>
                    <td className="px-3 py-2">{companyName(contact.company_id) ?? <span className="text-zinc-500 dark:text-zinc-400">–</span>}</td>
                    <td className="px-3 py-2">{words(contact.lifecycle_stage)}</td>
                    <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{touch ? ago(touch) : '–'}</td>
                    <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{contact.last_opened_at ? ago(contact.last_opened_at) : '–'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {contacts.hasNextPage && (
            <div className="border-t border-zinc-200 p-2 text-center dark:border-zinc-800">
              <Button variant="ghost" onClick={() => contacts.fetchNextPage()} disabled={contacts.isFetchingNextPage}>
                {contacts.isFetchingNextPage ? 'Loading…' : 'Load more'}
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function AddContact({ onDone }: { onDone: () => void }) {
  const client = useQueryClient();
  const router = useRouter();
  const [form, setForm] = useState({ email: '', first_name: '', last_name: '', title: '' });
  const create = useMutation({
    mutationFn: () => unwrap(api.POST('/contacts', { body: { email: form.email.trim(), ...(form.first_name.trim() && { first_name: form.first_name.trim() }), ...(form.last_name.trim() && { last_name: form.last_name.trim() }), ...(form.title.trim() && { title: form.title.trim() }) } })),
    onSuccess: (contact) => {
      void client.invalidateQueries({ queryKey: ['contacts'] });
      onDone();
      router.push(`/contacts/${contact.id}`);
    },
  });
  const field = (name: keyof typeof form, label: string, type = 'text') => (
    <label className="flex-1 text-xs text-zinc-500 dark:text-zinc-400">
      {label}
      <input type={type} required={name === 'email'} value={form[name]} onChange={(event) => setForm({ ...form, [name]: event.target.value })} className={cn(inputClass, 'mt-1 text-sm text-zinc-900 dark:text-zinc-100')} />
    </label>
  );
  return (
    <form
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        create.mutate();
      }}
      className="space-y-2 rounded-[var(--radius-card)] border border-zinc-200 p-4 dark:border-zinc-800"
    >
      <div className="flex flex-wrap gap-2">
        {field('email', 'Email', 'email')}
        {field('first_name', 'First name')}
        {field('last_name', 'Last name')}
        {field('title', 'Title')}
      </div>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={create.isPending}>
          Add
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">The address is verified in the background, and the company linked by its domain when known.</p>
      <ErrorText error={create.error} />
    </form>
  );
}

type Action = 'enroll' | 'tag' | 'add_to_list' | 'verify' | 'suppress' | 'export' | 'delete';

/** The bulk actions of §15.11 for the selected contacts. */
function BulkBar({ ids, onDone, tags }: { ids: string[]; onDone: () => void; tags: Schemas['Tag'][] }) {
  const person = usePerson();
  const client = useQueryClient();
  const [action, setAction] = useState<Action | null>(null);
  const [choice, setChoice] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const campaigns = useQuery({ queryKey: ['campaigns', 'options'], enabled: action === 'enroll', queryFn: () => unwrap(api.GET('/campaigns', { params: { query: { limit: 100 } } })) });
  const lists = useQuery({ queryKey: ['lists', 'static'], enabled: action === 'add_to_list', queryFn: () => unwrap(api.GET('/lists', { params: { query: { limit: 100, kind: 'static' } } })) });
  const run = useMutation({
    mutationFn: async (): Promise<string> => {
      if (action === 'enroll') {
        const enrolled = await unwrap(api.POST('/campaigns/{campaignId}/enrollments', { params: { path: { campaignId: choice } }, body: { contact_ids: ids } }));
        return `${enrolled.created.length} enrolled${enrolled.skipped.length ? `; ${enrolled.skipped.length} skipped (${[...new Set(enrolled.skipped.map((entry) => words(entry.reason)))].join(', ')})` : ''}.`;
      }
      const body =
        action === 'tag' ? { action, contact_ids: ids, tag_ids: [choice] } : action === 'add_to_list' ? { action, contact_ids: ids, list_id: choice } : action === 'suppress' ? { action, contact_ids: ids, ...(choice.trim() && { note: choice.trim() }) } : { action: action!, contact_ids: ids };
      const done = await unwrap(api.POST('/contacts/bulk-actions', { body: body as Schemas['ContactBulkActionRequest'] }));
      if (action === 'export' && done.csv) {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(new Blob([done.csv], { type: 'text/csv' }));
        link.download = 'contacts.csv';
        link.click();
        URL.revokeObjectURL(link.href);
      }
      return `${done.changed} of ${done.matched} ${action === 'export' ? 'exported' : 'changed'}${done.skipped.length ? `; ${done.skipped.length} skipped` : ''}.`;
    },
    onSuccess: (text) => {
      setResult(text);
      setAction(null);
      setChoice('');
      void client.invalidateQueries({ queryKey: ['contacts'] });
      void client.invalidateQueries({ queryKey: ['threads'] });
    },
  });
  const needsChoice = action === 'enroll' || action === 'tag' || action === 'add_to_list';
  const may = person.can('contacts:write');
  const ACTIONS: { key: Action; label: string; allowed: boolean }[] = [
    { key: 'enroll', label: 'Enroll in campaign', allowed: person.can('campaigns:write') },
    { key: 'tag', label: 'Tag', allowed: may },
    { key: 'add_to_list', label: 'Add to list', allowed: may },
    { key: 'verify', label: 'Verify', allowed: may },
    { key: 'suppress', label: 'Suppress', allowed: may },
    { key: 'export', label: 'Export', allowed: true },
    { key: 'delete', label: 'Delete', allowed: may },
  ];

  return (
    <div role="region" aria-label="Bulk actions" className="space-y-2 rounded-[var(--radius-card)] border border-indigo-200 bg-indigo-50/50 p-3 dark:border-indigo-900 dark:bg-indigo-950/40">
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-2 font-medium">{ids.length} selected</span>
        {ACTIONS.filter((entry) => entry.allowed).map((entry) => (
          <Button key={entry.key} size="sm" variant={action === entry.key ? 'secondary' : 'ghost'} onClick={() => (setAction(action === entry.key ? null : entry.key), setChoice(''), setResult(null))}>
            {entry.label}
          </Button>
        ))}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onDone}>
          Clear
        </Button>
      </div>
      {action && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            run.mutate();
          }}
        >
          {action === 'enroll' && (
            <select aria-label="Campaign" required value={choice} onChange={(event) => setChoice(event.target.value)} className={cn(inputClass, 'w-auto py-1')}>
              <option value="">Choose a campaign…</option>
              {(campaigns.data?.data ?? [])
                .filter((campaign) => campaign.status === 'draft' || campaign.status === 'active' || campaign.status === 'paused')
                .map((campaign) => (
                  <option key={campaign.id} value={campaign.id}>
                    {campaign.name}
                  </option>
                ))}
            </select>
          )}
          {action === 'tag' && (
            <select aria-label="Tag" required value={choice} onChange={(event) => setChoice(event.target.value)} className={cn(inputClass, 'w-auto py-1')}>
              <option value="">Choose a tag…</option>
              {tags.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name}
                </option>
              ))}
            </select>
          )}
          {action === 'add_to_list' && (
            <select aria-label="List" required value={choice} onChange={(event) => setChoice(event.target.value)} className={cn(inputClass, 'w-auto py-1')}>
              <option value="">Choose a static list…</option>
              {(lists.data?.data ?? []).map((list) => (
                <option key={list.id} value={list.id}>
                  {list.name}
                </option>
              ))}
            </select>
          )}
          {action === 'suppress' && <input aria-label="Why" value={choice} onChange={(event) => setChoice(event.target.value)} placeholder="Why (optional)" className={cn(inputClass, 'w-64 py-1')} maxLength={1000} />}
          <span className="text-zinc-600 dark:text-zinc-400">
            {action === 'delete' ? `Delete ${ids.length} contact(s)? Their threads stop.` : action === 'suppress' ? 'They’ll never be emailed again.' : action === 'verify' ? 'Check the addresses again now.' : action === 'export' ? 'Download them as CSV.' : ''}
          </span>
          <Button type="submit" size="sm" variant={action === 'delete' || action === 'suppress' ? 'danger' : 'primary'} disabled={run.isPending || (needsChoice && !choice)}>
            {run.isPending ? 'Working…' : 'Apply'}
          </Button>
        </form>
      )}
      <ErrorText error={run.error} />
      {result && <p role="status" className="text-emerald-700 dark:text-emerald-400">{result}</p>}
    </div>
  );
}
