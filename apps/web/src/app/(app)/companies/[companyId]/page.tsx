'use client';

// A company's page (spec §15.14): its details and notes, edited in place, custom fields, and the
// contacts at the company with their lifecycle stage. Deleting it unlinks its contacts, who stay.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { contactName, EmailStatus } from '../../../../components/contact-bits.tsx';
import { Button, ErrorText, inputClass, Loading, textareaClass } from '../../../../components/ui.tsx';
import { api, unwrap, type Schemas } from '../../../../lib/api.ts';
import { cn } from '../../../../lib/cn.ts';
import { ago, words } from '../../../../lib/format.ts';
import { usePerson } from '../../../../lib/person.tsx';

type Company = Schemas['Company'];
const FIELDS = [
  ['name', 'Name'],
  ['domain', 'Domain'],
  ['website', 'Website'],
  ['industry', 'Industry'],
  ['employee_range', 'Employees'],
  ['country', 'Country (2 letters)'],
] as const;

export default function CompanyPage() {
  const { companyId } = useParams<{ companyId: string }>();
  const company = useQuery({ queryKey: ['company', companyId], queryFn: () => unwrap(api.GET('/companies/{companyId}', { params: { path: { companyId } } })) });
  const contacts = useQuery({ queryKey: ['contacts', 'company', companyId], queryFn: () => unwrap(api.GET('/contacts', { params: { query: { company_id: companyId, limit: 100 } } })) });
  if (company.isPending) return <Loading />;
  if (company.isError)
    return (
      <div className="space-y-2">
        <BackLink />
        <ErrorText error={company.error} onRetry={() => void company.refetch()} />
      </div>
    );
  return (
    <div className="space-y-4">
      <BackLink />
      <h1 className="text-xl font-semibold">{company.data.name}</h1>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <section aria-label="Contacts" className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Contacts ({company.data.contact_count})</h2>
          {contacts.isPending && <Loading />}
          <ErrorText error={contacts.error} onRetry={() => void contacts.refetch()} />
          {contacts.data && contacts.data.data.length === 0 && <p className="text-zinc-500 dark:text-zinc-400">No contacts at this company yet.</p>}
          <ul className="divide-y divide-zinc-200 rounded-[var(--radius-card)] border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {contacts.data?.data.map((contact) => (
              <li key={contact.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <Link href={`/contacts/${contact.id}`} className="font-medium hover:underline">
                  {contactName(contact)}
                </Link>
                <span className="text-zinc-500 dark:text-zinc-400">{contact.title}</span>
                <span className="inline-flex items-center gap-1 text-zinc-600 dark:text-zinc-400">
                  {contact.email} <EmailStatus contact={contact} />
                </span>
                <span className="ml-auto">{words(contact.lifecycle_stage)}</span>
                {contact.last_replied_at && <span className="text-xs text-zinc-500 dark:text-zinc-400">replied {ago(contact.last_replied_at)}</span>}
              </li>
            ))}
          </ul>
        </section>
        <Details company={company.data} />
      </div>
    </div>
  );
}

const BackLink = () => (
  <Link href="/companies" className="inline-flex items-center gap-1 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100">
    <ArrowLeft aria-hidden className="size-4" /> Companies
  </Link>
);

function Details({ company }: { company: Company }) {
  const person = usePerson();
  const router = useRouter();
  const client = useQueryClient();
  const draft = () => Object.fromEntries([...FIELDS.map(([key]) => [key, (company[key] as string | null) ?? '']), ['notes', company.notes ?? '']]) as Record<string, string>;
  const [form, setForm] = useState(draft);
  const [saved, setSaved] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, string | null> = {};
      for (const [key, value] of Object.entries(form)) {
        const next = value.trim() === '' ? null : value.trim();
        if (next !== ((company as Record<string, unknown>)[key] ?? null)) body[key] = key === 'name' ? (next ?? company.name) : next;
      }
      return unwrap(api.PATCH('/companies/{companyId}', { params: { path: { companyId: company.id } }, body }));
    },
    onSuccess: (updated) => (client.setQueryData(['company', company.id], updated), void client.invalidateQueries({ queryKey: ['companies'] }), setSaved(true)),
  });
  const remove = useMutation({ mutationFn: () => unwrap(api.DELETE('/companies/{companyId}', { params: { path: { companyId: company.id } } })), onSuccess: () => (void client.invalidateQueries({ queryKey: ['companies'] }), router.push('/companies')) });
  const may = person.can('contacts:write');
  const custom = Object.entries(company.custom_fields as Record<string, unknown>);

  return (
    <aside aria-label="Details" className="space-y-3 rounded-[var(--radius-card)] border border-zinc-200 p-4 lg:self-start dark:border-zinc-800">
      <form
        className="space-y-2"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          setSaved(false);
          save.mutate();
        }}
      >
        {FIELDS.map(([key, label]) => (
          <label key={key} className="block text-xs text-zinc-500 dark:text-zinc-400">
            {label}
            <input disabled={!may} required={key === 'name'} value={form[key]} onChange={(event) => (setForm({ ...form, [key]: event.target.value }), setSaved(false))} className={cn(inputClass, 'mt-0.5 py-1 text-sm text-zinc-900 dark:text-zinc-100')} />
          </label>
        ))}
        <label className="block text-xs text-zinc-500 dark:text-zinc-400">
          Notes (the agent may use them)
          <textarea disabled={!may} value={form.notes} onChange={(event) => (setForm({ ...form, notes: event.target.value }), setSaved(false))} className={cn(textareaClass, 'mt-0.5 min-h-20 text-sm text-zinc-900 dark:text-zinc-100')} />
        </label>
        {custom.length > 0 && (
          <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-xs">
            {custom.map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="text-zinc-500 dark:text-zinc-400">{key}</dt>
                <dd>{typeof value === 'string' ? value : JSON.stringify(value)}</dd>
              </div>
            ))}
          </dl>
        )}
        {may && (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" variant="primary" disabled={save.isPending}>
              Save
            </Button>
            {saved && (
              <span role="status" className="text-emerald-700 dark:text-emerald-400">
                Saved.
              </span>
            )}
            {deleting ? (
              <Button variant="danger" disabled={remove.isPending} onClick={() => remove.mutate()}>
                Delete: its contacts are kept, unlinked
              </Button>
            ) : (
              <Button variant="ghost" className="ml-auto" onClick={() => setDeleting(true)}>
                Delete…
              </Button>
            )}
          </div>
        )}
        <ErrorText error={save.error ?? remove.error} />
      </form>
    </aside>
  );
}
