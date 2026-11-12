'use client';

// V11 Companies (spec §15.14): the table of companies with their domain, industry, size and
// contacts, a search, and "Add company". A company opens its own page.

import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Building2, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

import { Button, ErrorText, inputClass, Loading } from '../../../components/ui.tsx';
import { api, unwrap } from '../../../lib/api.ts';
import { cn } from '../../../lib/cn.ts';
import { usePerson } from '../../../lib/person.tsx';

export default function CompaniesPage() {
  const person = usePerson();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const companies = useInfiniteQuery({
    queryKey: ['companies', 'table', q],
    queryFn: ({ pageParam }) => unwrap(api.GET('/companies', { params: { query: { limit: 50, ...(q && { q }), ...(pageParam && { cursor: pageParam }) } } })),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.next_cursor,
  });
  const rows = companies.data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <section aria-labelledby="companies-title" className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 id="companies-title" className="text-2xl font-semibold">
          Companies
        </h1>
        {person.can('contacts:write') && (
          <Button variant="primary" className="ml-auto" onClick={() => setAdding(!adding)}>
            <Plus aria-hidden className="size-4" /> Add company
          </Button>
        )}
      </div>
      {adding && <AddCompany onDone={() => setAdding(false)} />}
      <label className="relative flex max-w-md items-center">
        <Search aria-hidden className="pointer-events-none absolute left-2.5 size-4 text-zinc-500 dark:text-zinc-400" />
        <span className="sr-only">Search companies</span>
        <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search names and domains…" className={cn(inputClass, 'pl-8')} />
      </label>
      {companies.isPending && <Loading />}
      <ErrorText error={companies.error} onRetry={() => void companies.refetch()} />
      {companies.data && rows.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-16 text-center text-zinc-500 dark:text-zinc-400">
          <Building2 aria-hidden className="size-8" />
          <p>No companies yet. Contacts are linked to a company by their email domain.</p>
        </div>
      )}
      {rows.length > 0 && (
        <div className="relative overflow-x-auto rounded-[var(--radius-card)] border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left">
            <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400 dark:border-zinc-800">
              <tr>
                {['Company', 'Domain', 'Industry', 'Employees', 'Country', 'Contacts'].map((heading) => (
                  <th key={heading} scope="col" className="px-3 py-2 font-medium">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {rows.map((company) => (
                <tr key={company.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                  <td className="px-3 py-2">
                    <Link href={`/companies/${company.id}`} className="font-medium hover:underline">
                      {company.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{company.domain ?? '–'}</td>
                  <td className="px-3 py-2">{company.industry ?? '–'}</td>
                  <td className="px-3 py-2">{company.employee_range ?? '–'}</td>
                  <td className="px-3 py-2">{company.country ?? '–'}</td>
                  <td className="px-3 py-2 tabular-nums">{company.contact_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {companies.hasNextPage && (
            <div className="border-t border-zinc-200 p-2 text-center dark:border-zinc-800">
              <Button variant="ghost" onClick={() => companies.fetchNextPage()} disabled={companies.isFetchingNextPage}>
                Load more
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function AddCompany({ onDone }: { onDone: () => void }) {
  const client = useQueryClient();
  const router = useRouter();
  const [form, setForm] = useState({ name: '', domain: '' });
  const create = useMutation({
    mutationFn: () => unwrap(api.POST('/companies', { body: { name: form.name.trim(), ...(form.domain.trim() && { domain: form.domain.trim().toLowerCase() }) } })),
    onSuccess: (company) => (void client.invalidateQueries({ queryKey: ['companies'] }), onDone(), router.push(`/companies/${company.id}`)),
  });
  return (
    <form
      className="flex flex-wrap items-end gap-2 rounded-[var(--radius-card)] border border-zinc-200 p-4 dark:border-zinc-800"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        create.mutate();
      }}
    >
      <label className="text-xs text-zinc-500 dark:text-zinc-400">
        Name
        <input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className={cn(inputClass, 'mt-0.5 w-56 text-sm text-zinc-900 dark:text-zinc-100')} maxLength={200} />
      </label>
      <label className="text-xs text-zinc-500 dark:text-zinc-400">
        Domain
        <input value={form.domain} onChange={(event) => setForm({ ...form, domain: event.target.value })} placeholder="globex.com" className={cn(inputClass, 'mt-0.5 w-56 text-sm text-zinc-900 dark:text-zinc-100')} />
      </label>
      <Button type="submit" variant="primary" disabled={create.isPending}>
        Add
      </Button>
      <Button variant="ghost" onClick={onDone}>
        Cancel
      </Button>
      <p className="w-full text-xs text-zinc-500 dark:text-zinc-400">Contacts with addresses at the domain are linked to the company automatically; free-mail domains never are.</p>
      <ErrorText error={create.error} />
    </form>
  );
}
