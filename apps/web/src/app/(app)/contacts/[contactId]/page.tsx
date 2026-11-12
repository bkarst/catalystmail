'use client';

// V9 Contact detail (spec §15.12): who the contact is and their email status; lifecycle, tags and
// do-not-contact, changed in place; the timeline across every campaign with a note box; details,
// edited in place; and their conversations. Enroll adds them to a campaign; Export downloads
// everything held about them; Erase removes their personal data for a privacy request.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Download, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { contactName, EmailStatus } from '../../../../components/contact-bits.tsx';
import { StagePill, StatePill } from '../../../../components/thread-bits.tsx';
import { Button, ErrorText, inputClass, Loading, Pill, Section, textareaClass } from '../../../../components/ui.tsx';
import { activityText } from '../../../../lib/activity.ts';
import { api, idempotencyKey, unwrap, type Schemas } from '../../../../lib/api.ts';
import type { paths } from '../../../../lib/api-types.ts';
import { cn } from '../../../../lib/cn.ts';
import { dateTime, words } from '../../../../lib/format.ts';
import { usePerson } from '../../../../lib/person.tsx';

const LIFECYCLE = ['lead', 'prospect', 'engaged', 'opportunity', 'customer', 'churned', 'disqualified'] as const;
const CATEGORIES = ['all', 'emails', 'status', 'notes', 'changes'] as const;
const CONSENT = ['legitimate_interest', 'consent', 'existing_relationship', 'unknown'] as const;
type Contact = Schemas['Contact'];
type Patch = NonNullable<paths['/contacts/{contactId}']['patch']['requestBody']>['content']['application/json'];

export default function ContactPage() {
  const { contactId } = useParams<{ contactId: string }>();
  const person = usePerson();
  const client = useQueryClient();
  const contact = useQuery({ queryKey: ['contact', contactId], queryFn: () => unwrap(api.GET('/contacts/{contactId}', { params: { path: { contactId } } })) });
  const tags = useQuery({ queryKey: ['tags'], queryFn: () => unwrap(api.GET('/tags', { params: { query: { limit: 100 } } })), staleTime: 300_000 });
  const update = useMutation({
    mutationFn: (body: Patch) => unwrap(api.PATCH('/contacts/{contactId}', { params: { path: { contactId } }, body })),
    onSuccess: (updated) => {
      client.setQueryData(['contact', contactId], updated);
      void client.invalidateQueries({ queryKey: ['contact', contactId, 'timeline'] });
      void client.invalidateQueries({ queryKey: ['contacts'] });
    },
  });

  if (contact.isPending) return <Loading />;
  if (contact.isError)
    return (
      <div className="space-y-2">
        <BackLink />
        <ErrorText error={contact.error} onRetry={() => void contact.refetch()} />
      </div>
    );
  const data = contact.data;
  const may = person.can('contacts:write');
  const tagList = tags.data?.data ?? [];

  return (
    <div className="space-y-4">
      <Header contact={data} />
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-1.5">
          <span className="text-zinc-500 dark:text-zinc-400">Lifecycle</span>
          <select disabled={!may || update.isPending} value={data.lifecycle_stage} onChange={(event) => update.mutate({ lifecycle_stage: event.target.value as Contact['lifecycle_stage'] })} className={cn(inputClass, 'w-auto py-1')}>
            {LIFECYCLE.map((stage) => (
              <option key={stage} value={stage}>
                {words(stage)}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-zinc-500 dark:text-zinc-400">Tags</span>
          {data.tag_ids.map((id) => (
            <Pill key={id}>
              {tagList.find((tag) => tag.id === id)?.name ?? id}
              {may && (
                <button type="button" aria-label={`Remove tag ${tagList.find((tag) => tag.id === id)?.name ?? id}`} onClick={() => update.mutate({ tag_ids: data.tag_ids.filter((tag) => tag !== id) })} className="hover:text-rose-600">
                  <X aria-hidden className="size-3" />
                </button>
              )}
            </Pill>
          ))}
          {may && tagList.some((tag) => !data.tag_ids.includes(tag.id)) && (
            <select aria-label="Add a tag" value="" onChange={(event) => event.target.value && update.mutate({ tag_ids: [...data.tag_ids, event.target.value] })} className="rounded-[var(--radius-pill)] bg-transparent px-1 py-0.5 text-xs text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900">
              <option value="">+ Tag</option>
              {tagList
                .filter((tag) => !data.tag_ids.includes(tag.id))
                .map((tag) => (
                  <option key={tag.id} value={tag.id}>
                    {tag.name}
                  </option>
                ))}
            </select>
          )}
        </div>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" disabled={!may || update.isPending} checked={data.do_not_contact} onChange={(event) => update.mutate({ do_not_contact: event.target.checked })} /> Do not contact
        </label>
      </div>
      <ErrorText error={update.error} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Timeline contactId={contactId} />
        <aside aria-label="About this contact" className="min-w-0 rounded-[var(--radius-card)] border border-zinc-200 px-4 lg:self-start dark:border-zinc-800">
          <Details contact={data} onSave={(body) => update.mutateAsync(body)} />
          <Conversations contactId={contactId} />
        </aside>
      </div>
    </div>
  );
}

const BackLink = () => (
  <Link href="/contacts" className="inline-flex items-center gap-1 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100">
    <ArrowLeft aria-hidden className="size-4" /> Contacts
  </Link>
);

function Header({ contact }: { contact: Contact }) {
  const person = usePerson();
  const router = useRouter();
  const client = useQueryClient();
  const [panel, setPanel] = useState<'enroll' | 'erase' | null>(null);
  const [campaignId, setCampaignId] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const company = useQuery({ queryKey: ['company', contact.company_id], enabled: Boolean(contact.company_id), queryFn: () => unwrap(api.GET('/companies/{companyId}', { params: { path: { companyId: contact.company_id! } } })) });
  const users = useQuery({ queryKey: ['users'], enabled: Boolean(contact.owner_user_id), queryFn: () => unwrap(api.GET('/users', { params: { query: { limit: 100 } } })), staleTime: 300_000 });
  const campaigns = useQuery({ queryKey: ['campaigns', 'options'], enabled: panel === 'enroll', queryFn: () => unwrap(api.GET('/campaigns', { params: { query: { limit: 100 } } })) });
  const contactId = contact.id;
  const enroll = useMutation({
    mutationFn: () => unwrap(api.POST('/campaigns/{campaignId}/enrollments', { params: { path: { campaignId } }, body: { contact_ids: [contactId] } })),
    onSuccess: (done) => {
      setResult(done.created.length ? 'Enrolled.' : `Not enrolled: ${words(done.skipped[0]?.reason ?? 'skipped')}.`);
      setPanel(null);
      void client.invalidateQueries({ queryKey: ['threads'] });
    },
  });
  const exportData = useMutation({
    mutationFn: () => unwrap(api.GET('/contacts/{contactId}/export', { params: { path: { contactId } } })),
    onSuccess: (data) => {
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      link.download = `${contact.email}.json`;
      link.click();
      URL.revokeObjectURL(link.href);
    },
  });
  const erase = useMutation({
    mutationFn: () => unwrap(api.POST('/contacts/{contactId}/erase', { params: { path: { contactId }, header: idempotencyKey() } })),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['contacts'] });
      router.push('/contacts');
    },
  });
  const owner = users.data?.data.find((user) => user.id === contact.owner_user_id);

  return (
    <header className="space-y-2">
      <BackLink />
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold">{contactName(contact)}</h1>
          <p className="flex flex-wrap items-center gap-x-1 text-zinc-600 dark:text-zinc-400">
            {[contact.title, company.data?.name].filter(Boolean).join(' · ')}
            {(contact.title || company.data) && ' · '}
            <span className="inline-flex items-center gap-1">
              {contact.email} <EmailStatus contact={contact} />
            </span>
            {contact.timezone && ` · ${contact.timezone}${contact.city ? ` (${contact.city})` : ''}`}
            {owner && ` · Owner: ${owner.name}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {person.can('campaigns:write') && <Button onClick={() => setPanel(panel === 'enroll' ? null : 'enroll')}>Enroll…</Button>}
          <Button onClick={() => exportData.mutate()} disabled={exportData.isPending} title="Everything held about this contact, as JSON">
            <Download aria-hidden className="size-4" /> Export
          </Button>
          {person.can('contacts:erase') && (
            <Button variant="danger" onClick={() => setPanel(panel === 'erase' ? null : 'erase')}>
              <Trash2 aria-hidden className="size-4" /> Erase…
            </Button>
          )}
        </div>
      </div>
      {panel === 'enroll' && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            enroll.mutate();
          }}
        >
          <select aria-label="Campaign" required value={campaignId} onChange={(event) => setCampaignId(event.target.value)} className={cn(inputClass, 'w-auto py-1')}>
            <option value="">Choose a campaign…</option>
            {(campaigns.data?.data ?? [])
              .filter((campaign) => campaign.status === 'draft' || campaign.status === 'active' || campaign.status === 'paused')
              .map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </option>
              ))}
          </select>
          <Button type="submit" variant="primary" disabled={!campaignId || enroll.isPending}>
            Enroll
          </Button>
        </form>
      )}
      {panel === 'erase' && (
        <div role="alertdialog" aria-label="Erase this contact?" className="flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-rose-200 bg-rose-50 p-3 dark:border-rose-900 dark:bg-rose-950">
          <p className="flex-1">Erase {contactName(contact)}? Their fields, notes and the text of every email with them are removed for good; only a hash of the address stays, so they’re never emailed again. This can’t be undone.</p>
          <Button variant="danger" disabled={erase.isPending} onClick={() => erase.mutate()}>
            Erase
          </Button>
          <Button variant="ghost" onClick={() => setPanel(null)}>
            Cancel
          </Button>
        </div>
      )}
      <ErrorText error={enroll.error ?? exportData.error ?? erase.error} />
      {result && <p role="status" className="text-emerald-700 dark:text-emerald-400">{result}</p>}
    </header>
  );
}

function Timeline({ contactId }: { contactId: string }) {
  const person = usePerson();
  const client = useQueryClient();
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('all');
  const [note, setNote] = useState('');
  const timeline = useQuery({ queryKey: ['contact', contactId, 'timeline', category], queryFn: () => unwrap(api.GET('/contacts/{contactId}/timeline', { params: { path: { contactId }, query: { limit: 100, category } } })) });
  const campaigns = useQuery({ queryKey: ['campaigns', 'options'], queryFn: () => unwrap(api.GET('/campaigns', { params: { query: { limit: 100 } } })), staleTime: 300_000 });
  const add = useMutation({
    mutationFn: () => unwrap(api.POST('/contacts/{contactId}/notes', { params: { path: { contactId } }, body: { text: note.trim() } })),
    onSuccess: () => {
      setNote('');
      void client.invalidateQueries({ queryKey: ['contact', contactId, 'timeline'] });
    },
  });
  const campaignName = (id: string | null) => (id ? campaigns.data?.data.find((campaign) => campaign.id === id)?.name : undefined);

  return (
    <section aria-label="Timeline" className="min-w-0 space-y-3">
      <nav aria-label="Timeline filter" className="flex gap-1">
        {CATEGORIES.map((entry) => (
          <button key={entry} type="button" aria-current={category === entry ? 'page' : undefined} onClick={() => setCategory(entry)} className={cn('rounded-[var(--radius-pill)] px-2.5 py-1 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900', category === entry && 'bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100')}>
            {words(entry)}
          </button>
        ))}
      </nav>
      {person.can('contacts:write') && (
        <form
          className="flex gap-2"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            if (note.trim()) add.mutate();
          }}
        >
          <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add a note…" aria-label="Note" className={inputClass} maxLength={10_000} />
          <Button type="submit" disabled={add.isPending || !note.trim()}>
            Add
          </Button>
        </form>
      )}
      <ErrorText error={add.error ?? timeline.error} />
      {timeline.isPending && <Loading />}
      {timeline.data && timeline.data.data.length === 0 && <p className="text-zinc-500 dark:text-zinc-400">Nothing yet.</p>}
      <ol className="space-y-1.5">
        {timeline.data?.data.map((entry) => (
          <li key={entry.id} className="grid grid-cols-[7rem_1fr] gap-3">
            <time dateTime={entry.occurred_at} className="text-xs text-zinc-500 dark:text-zinc-400">
              {dateTime(entry.occurred_at)}
            </time>
            <span>
              {entry.thread_id ? (
                <Link href={`/threads/${entry.thread_id}`} className="hover:underline">
                  {activityText(entry)}
                </Link>
              ) : (
                activityText(entry)
              )}
              {campaignName(entry.campaign_id) && <span className="text-zinc-500 dark:text-zinc-400"> · {campaignName(entry.campaign_id)}</span>}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Details({ contact, onSave }: { contact: Contact; onSave: (body: Patch) => Promise<unknown> }) {
  const person = usePerson();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(() => draftOf(contact));
  const [error, setError] = useState<unknown>(null);
  const custom = Object.entries(contact.custom_fields as Record<string, unknown>);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const body: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(form)) {
      const next = value.trim() === '' ? null : value.trim();
      if (next !== ((contact as Record<string, unknown>)[key] ?? null)) body[key] = next;
    }
    try {
      if (Object.keys(body).length) await onSave(body as Patch);
      setEditing(false);
    } catch (caught) {
      setError(caught);
    }
  };
  const row = (label: string, value: string | null | undefined) => (
    <div key={label} className="contents">
      <dt className="text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="min-w-0 break-words">{value || <span className="text-zinc-500 dark:text-zinc-400">–</span>}</dd>
    </div>
  );

  return (
    <Section
      title="Details"
      action={
        person.can('contacts:write') && !editing ? (
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              setForm(draftOf(contact));
              setEditing(true);
            }}
            className="rounded-[var(--radius-pill)] px-1.5 py-0.5 text-xs normal-case tracking-normal text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            Edit
          </button>
        ) : undefined
      }
    >
      {editing ? (
        <form onSubmit={save} className="space-y-2">
          {(
            [
              ['first_name', 'First name'],
              ['last_name', 'Last name'],
              ['title', 'Title'],
              ['phone', 'Phone'],
              ['linkedin_url', 'LinkedIn URL'],
              ['city', 'City'],
              ['country', 'Country (2 letters)'],
              ['timezone', 'Timezone (IANA)'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="block text-xs text-zinc-500 dark:text-zinc-400">
              {label}
              <input value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} className={cn(inputClass, 'mt-0.5 py-1 text-sm text-zinc-900 dark:text-zinc-100')} />
            </label>
          ))}
          <label className="block text-xs text-zinc-500 dark:text-zinc-400">
            Consent
            <select value={form.consent_basis} onChange={(event) => setForm({ ...form, consent_basis: event.target.value })} className={cn(inputClass, 'mt-0.5 py-1 text-sm text-zinc-900 dark:text-zinc-100')}>
              {CONSENT.map((value) => (
                <option key={value} value={value}>
                  {words(value)}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-zinc-500 dark:text-zinc-400">
            Notes (the agent may use them)
            <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} className={cn(textareaClass, 'mt-0.5 min-h-16 text-sm text-zinc-900 dark:text-zinc-100')} />
          </label>
          <div className="flex gap-2">
            <Button type="submit" size="sm" variant="primary">
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
          <ErrorText error={error} />
        </form>
      ) : (
        <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1">
          {row('Phone', contact.phone)}
          {row('LinkedIn', contact.linkedin_url?.replace(/^https?:\/\/(www\.)?/, ''))}
          {row('Location', [contact.city, contact.country].filter(Boolean).join(', '))}
          {row('Consent', words(contact.consent_basis))}
          {row('Source', contact.source_detail ? `${words(contact.source)} · ${contact.source_detail}` : words(contact.source))}
          {custom.map(([key, value]) => row(`${key} (custom)`, typeof value === 'string' ? value : JSON.stringify(value)))}
          {contact.notes && row('Notes', contact.notes)}
        </dl>
      )}
    </Section>
  );
}

function draftOf(contact: Contact) {
  return {
    first_name: contact.first_name ?? '',
    last_name: contact.last_name ?? '',
    title: contact.title ?? '',
    phone: contact.phone ?? '',
    linkedin_url: contact.linkedin_url ?? '',
    city: contact.city ?? '',
    country: contact.country ?? '',
    timezone: contact.timezone ?? '',
    consent_basis: contact.consent_basis as string,
    notes: contact.notes ?? '',
  };
}

function Conversations({ contactId }: { contactId: string }) {
  const threads = useQuery({ queryKey: ['threads', 'for-contact', contactId], queryFn: () => unwrap(api.GET('/threads', { params: { query: { contact_id: contactId, limit: 50 } } })) });
  return (
    <Section title="Campaigns">
      {threads.isPending && <Loading />}
      <ErrorText error={threads.error} onRetry={() => void threads.refetch()} />
      {threads.data && threads.data.data.length === 0 && <p className="text-zinc-500 dark:text-zinc-400">Not in any campaign.</p>}
      <ul className="space-y-2">
        {threads.data?.data.map((thread) => (
          <li key={thread.id} className="space-y-1">
            <Link href={`/threads/${thread.id}`} className="block truncate font-medium hover:underline">
              {thread.campaign.name}
            </Link>
            <span className="flex flex-wrap gap-1">
              <StagePill thread={thread} />
              <StatePill thread={thread} />
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}
