'use client';

// V13 Deliverability (spec §15.15): Overview · Domains · Mailboxes · Capacity · Events, the tab in
// the URL. Viewing needs `mailboxes:read`; changing anything needs an admin, with a reason.
// A domain and a mailbox each have their own page.

import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';

import { BandPill, CheckMark, LIMIT_TEXT } from '../../../components/deliverability/bits.tsx';
import { Button, ErrorText, inputClass, Loading, Pill } from '../../../components/ui.tsx';
import { activityText } from '../../../lib/activity.ts';
import { api, unwrap, type Schemas } from '../../../lib/api.ts';
import { cn } from '../../../lib/cn.ts';
import { ago, dateTime, words } from '../../../lib/format.ts';
import { usePerson } from '../../../lib/person.tsx';

const TABS = ['overview', 'domains', 'mailboxes', 'capacity', 'events'] as const;
type Tab = (typeof TABS)[number];

export default function DeliverabilityPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Deliverability />
    </Suspense>
  );
}

function Deliverability() {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const person = usePerson();
  const tab = (TABS as readonly string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as Tab) : 'overview';
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Deliverability</h1>
        {person.can('mailboxes:write') && (
          <Link href="/deliverability/mailboxes/new" className="ml-auto inline-flex items-center rounded-[var(--radius-pill)] bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-700">
            + Add mailbox
          </Link>
        )}
      </div>
      {params.get('oauth_error') && (
        <p role="alert" className="rounded-[var(--radius-card)] border border-rose-200 bg-rose-50 px-3 py-2 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300">
          Connecting didn’t work: {params.get('oauth_error')}
        </p>
      )}
      <nav aria-label="Deliverability sections" className="flex flex-wrap gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {TABS.map((entry) => (
          <button key={entry} type="button" aria-current={tab === entry ? 'page' : undefined} onClick={() => router.replace(`${path}${entry === 'overview' ? '' : `?tab=${entry}`}`, { scroll: false })} className={cn('-mb-px border-b-2 px-3 py-2 text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100', tab === entry ? 'border-indigo-600 font-medium text-zinc-900 dark:text-zinc-100' : 'border-transparent')}>
            {words(entry)}
          </button>
        ))}
      </nav>
      {tab === 'overview' && <Overview />}
      {tab === 'domains' && <Domains />}
      {tab === 'mailboxes' && <Mailboxes />}
      {tab === 'capacity' && <Capacity />}
      {tab === 'events' && <Events />}
    </div>
  );
}

function Overview() {
  const overview = useQuery({ queryKey: ['deliverability'], queryFn: () => unwrap(api.GET('/deliverability')), refetchInterval: 60_000 });
  if (overview.isPending) return <Loading />;
  if (overview.isError) return <ErrorText error={overview.error} onRetry={() => void overview.refetch()} />;
  const { domains, mailboxes, today, events } = overview.data;
  return (
    <div className="space-y-4">
      {domains.length === 0 && <p className="text-zinc-500 dark:text-zinc-400">No sending domains yet. Add one on the Domains tab.</p>}
      {domains.map((domain) => (
        <section key={domain.domain_id} aria-label={domain.domain} className="space-y-2 rounded-[var(--radius-card)] border border-zinc-200 p-4 dark:border-zinc-800">
          <header className="flex flex-wrap items-center gap-2">
            <Link href={`/deliverability/domains/${domain.domain_id}`} className="font-medium hover:underline">
              {domain.domain}
            </Link>
            <span className="ml-auto text-zinc-500 dark:text-zinc-400">Reputation</span>
            <BandPill band={domain.reputation_band} score={domain.reputation_score} />
          </header>
          <p className="text-zinc-600 dark:text-zinc-400">
            Ramp: {words(domain.ramp.plan)} · step {domain.ramp.step} of {domain.ramp.final_step} · {domain.ramp.today_cap}/day today
            {domain.ramp.status === 'ramping' && `, ${domain.ramp.tomorrow_cap} tomorrow if Healthy`}
            {domain.ramp.status !== 'ramping' && ` · ${words(domain.ramp.status)}`}
            {' · '}
            <Link href={`/deliverability/domains/${domain.domain_id}`} className="text-indigo-700 underline dark:text-indigo-300">
              Manage ramp →
            </Link>
          </p>
          <p className="flex flex-wrap gap-3 text-xs">
            <CheckMark status={domain.dns.spf} label="SPF" />
            <CheckMark status={domain.dns.dkim} label="DKIM" />
            <CheckMark status={domain.dns.dmarc} label={`DMARC${domain.dns.dmarc_policy ? ` p=${domain.dns.dmarc_policy}` : ''}`} />
            <CheckMark status={domain.dns.mx} label="MX" />
            <CheckMark status={domain.dns.tracking} label="Tracking" />
            <span>{domain.blocklisted ? <Pill tone="rose">Blocklisted</Pill> : 'Blocklists clear'}</span>
          </p>
        </section>
      ))}

      <section aria-label="Mailboxes" className="rounded-[var(--radius-card)] border border-zinc-200 dark:border-zinc-800">
        <h2 className="border-b border-zinc-200 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 dark:border-zinc-800">Mailboxes</h2>
        {mailboxes.length === 0 && <p className="px-4 py-3 text-zinc-500 dark:text-zinc-400">No mailboxes yet.</p>}
        <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {mailboxes.map((mailbox) => (
            <li key={mailbox.mailbox_id} className="flex flex-wrap items-center gap-3 px-4 py-2">
              <Link href={`/deliverability/mailboxes/${mailbox.mailbox_id}`} className="min-w-48 font-medium hover:underline">
                {mailbox.email}
              </Link>
              {mailbox.status === 'active' ? <BandPill band={mailbox.health_band} score={mailbox.health_score} /> : <Pill tone={mailbox.status === 'error' ? 'rose' : 'amber'}>{words(mailbox.status)}</Pill>}
              <span className="tabular-nums text-zinc-600 dark:text-zinc-400">
                Today {mailbox.sent_today}/{mailbox.today_cap}
              </span>
              <span className="text-zinc-600 dark:text-zinc-400">{mailbox.status_reason ?? (mailbox.warmup.enabled ? (mailbox.warmup.complete ? 'Warm-up complete' : `Warm-up ${mailbox.warmup.step}/${mailbox.warmup.final_step}`) : 'No warm-up')}</span>
              <span className={cn('ml-auto text-xs', mailbox.last_poll_status === 'error' ? 'text-rose-700 dark:text-rose-300' : 'text-zinc-500 dark:text-zinc-400')}>{mailbox.last_poll_at ? `Polled ${ago(mailbox.last_poll_at)}${mailbox.last_poll_status && mailbox.last_poll_status !== 'ok' ? ` (${mailbox.last_poll_status})` : ''}` : 'Not polled yet'}</span>
            </li>
          ))}
        </ul>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-label="Today's capacity" className="space-y-2 rounded-[var(--radius-card)] border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Today’s capacity</h2>
          <p className="tabular-nums">
            {today.planned} planned · {today.sent} sent · {today.replies} replies
          </p>
          <div aria-hidden className="h-2 rounded-full bg-zinc-200 dark:bg-zinc-800">
            <div className="h-2 rounded-full bg-indigo-500" style={{ width: `${today.planned ? Math.min(100, Math.round((today.sent / today.planned) * 100)) : 0}%` }} />
          </div>
          <p className="text-zinc-600 dark:text-zinc-400">
            {today.main_limit ? `Main limit: ${LIMIT_TEXT[today.main_limit] ?? words(today.main_limit)}` : 'Nothing is holding sending back.'} ·{' '}
            <Link href="/deliverability?tab=capacity" className="text-indigo-700 underline dark:text-indigo-300">
              Details →
            </Link>
          </p>
        </section>
        <section aria-label="Recent events" className="space-y-2 rounded-[var(--radius-card)] border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Recent events</h2>
          {events.length === 0 && <p className="text-zinc-500 dark:text-zinc-400">Nothing yet.</p>}
          <EventList events={events.slice(0, 8)} />
        </section>
      </div>
    </div>
  );
}

/** Each event with who made it and why (§15.15). */
function EventList({ events }: { events: Schemas['Activity'][] }) {
  const users = useQuery({ queryKey: ['users'], enabled: events.some((event) => event.actor_type === 'user'), queryFn: () => unwrap(api.GET('/users', { params: { query: { limit: 100 } } })), staleTime: 300_000, retry: false });
  const who = (event: Schemas['Activity']) => {
    if (event.actor_type === 'user') return users.data?.data.find((user) => user.id === event.actor_id)?.name ?? 'a person';
    if (event.actor_type === 'api_key') return 'an API key';
    return null;
  };
  return (
    <ol className="space-y-1">
      {events.map((event) => (
        <li key={event.id} className="grid grid-cols-[7.5rem_1fr] gap-3">
          <time dateTime={event.occurred_at} className="text-xs text-zinc-500 dark:text-zinc-400">
            {dateTime(event.occurred_at)}
          </time>
          <span>
            {deliverabilityText(event)}
            {who(event) && <span className="text-zinc-500 dark:text-zinc-400"> · by {who(event)}</span>}
            {typeof (event.data as { reason?: unknown }).reason === 'string' && <span className="text-zinc-500 dark:text-zinc-400"> · “{(event.data as { reason: string }).reason}”</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Deliverability events in words, naming the domain or mailbox they concern. */
function deliverabilityText(event: Schemas['Activity']): string {
  const data = event.data as Record<string, unknown>;
  const subject = typeof data.domain === 'string' ? data.domain : typeof data.email === 'string' ? data.email : null;
  const text = activityText(event);
  return subject ? `${subject}: ${text.charAt(0).toLowerCase()}${text.slice(1)}` : text;
}

function Domains() {
  const person = usePerson();
  const client = useQueryClient();
  const domains = useQuery({ queryKey: ['domains'], queryFn: () => unwrap(api.GET('/domains', { params: { query: { limit: 100 } } })) });
  const [form, setForm] = useState({ domain: '', tracking_host: '', ramp_plan: 'new_domain' as 'new_domain' | 'aged_domain' });
  const create = useMutation({
    mutationFn: () => unwrap(api.POST('/domains', { body: { domain: form.domain.trim().toLowerCase(), ramp_plan: form.ramp_plan, ...(form.tracking_host.trim() && { tracking_host: form.tracking_host.trim().toLowerCase() }) } })),
    onSuccess: () => (setForm({ domain: '', tracking_host: '', ramp_plan: 'new_domain' }), void client.invalidateQueries({ queryKey: ['domains'] }), void client.invalidateQueries({ queryKey: ['deliverability'] })),
  });
  return (
    <div className="space-y-4">
      {person.can('mailboxes:write') && (
        <form
          className="flex flex-wrap items-end gap-2 rounded-[var(--radius-card)] border border-zinc-200 p-4 dark:border-zinc-800"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <label className="text-xs text-zinc-500 dark:text-zinc-400">
            Domain to send from
            <input required value={form.domain} onChange={(event) => setForm({ ...form, domain: event.target.value })} placeholder="getacme.com" className={cn(inputClass, 'mt-0.5 w-56 text-sm text-zinc-900 dark:text-zinc-100')} />
          </label>
          <label className="text-xs text-zinc-500 dark:text-zinc-400">
            Tracking host (optional)
            <input value={form.tracking_host} onChange={(event) => setForm({ ...form, tracking_host: event.target.value })} placeholder="go.getacme.com" className={cn(inputClass, 'mt-0.5 w-56 text-sm text-zinc-900 dark:text-zinc-100')} />
          </label>
          <label className="text-xs text-zinc-500 dark:text-zinc-400">
            Ramp plan
            <select value={form.ramp_plan} onChange={(event) => setForm({ ...form, ramp_plan: event.target.value as typeof form.ramp_plan })} className={cn(inputClass, 'mt-0.5 w-auto text-sm text-zinc-900 dark:text-zinc-100')}>
              <option value="new_domain">New domain: 20/day, +15% a sending day</option>
              <option value="aged_domain">Aged domain: 40/day, +20% a sending day</option>
            </select>
          </label>
          <Button type="submit" variant="primary" disabled={create.isPending}>
            + Add domain
          </Button>
          <p className="w-full text-xs text-zinc-500 dark:text-zinc-400">A separate look-alike domain is safer for outreach than your main one (§8.1).</p>
          <ErrorText error={create.error} />
        </form>
      )}
      {domains.isPending && <Loading />}
      <ErrorText error={domains.error} onRetry={() => void domains.refetch()} />
      <ul className="divide-y divide-zinc-200 rounded-[var(--radius-card)] border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {domains.data?.data.map((domain) => (
          <li key={domain.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
            <Link href={`/deliverability/domains/${domain.id}`} className="min-w-48 font-medium hover:underline">
              {domain.domain}
            </Link>
            <BandPill band={domain.reputation_band} score={domain.reputation_score} />
            <span className="text-zinc-600 dark:text-zinc-400">
              {words(domain.ramp.plan)} · step {domain.ramp.step}/{domain.ramp.final_step} · {domain.ramp.today_cap}/day
            </span>
            {domain.first_touches_paused && <Pill tone="rose">First emails paused</Pill>}
            {domain.checks && !domain.checks.ready && <Pill tone="amber">DNS needs work</Pill>}
            <span className="ml-auto text-xs text-zinc-500 dark:text-zinc-400">{domain.mailbox_count} mailboxes</span>
          </li>
        ))}
        {domains.data && domains.data.data.length === 0 && <li className="px-4 py-3 text-zinc-500 dark:text-zinc-400">No domains yet.</li>}
      </ul>
    </div>
  );
}

function Mailboxes() {
  const mailboxes = useQuery({ queryKey: ['mailboxes', 'list'], queryFn: () => unwrap(api.GET('/mailboxes', { params: { query: { limit: 100 } } })) });
  if (mailboxes.isPending) return <Loading />;
  if (mailboxes.isError) return <ErrorText error={mailboxes.error} onRetry={() => void mailboxes.refetch()} />;
  return (
    <div className="relative overflow-x-auto rounded-[var(--radius-card)] border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-left">
        <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400 dark:border-zinc-800">
          <tr>
            {['Mailbox', 'Status', 'Health', 'Cap today', 'Daily limit', 'Warm-up', 'Last poll'].map((heading) => (
              <th key={heading} scope="col" className="px-3 py-2 font-medium">
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {mailboxes.data.data.map((mailbox) => (
            <tr key={mailbox.id}>
              <td className="px-3 py-2">
                <Link href={`/deliverability/mailboxes/${mailbox.id}`} className="font-medium hover:underline">
                  {mailbox.email}
                </Link>
                <span className="block text-xs text-zinc-500 dark:text-zinc-400">{mailbox.display_name}</span>
              </td>
              <td className="px-3 py-2">
                <Pill tone={mailbox.status === 'active' ? 'emerald' : mailbox.status === 'error' ? 'rose' : 'amber'}>{words(mailbox.status)}</Pill>
              </td>
              <td className="px-3 py-2">
                <BandPill band={mailbox.health_band} score={mailbox.health_score} />
              </td>
              <td className="px-3 py-2 tabular-nums">{mailbox.today_cap}</td>
              <td className="px-3 py-2 tabular-nums">{mailbox.daily_limit}</td>
              <td className="px-3 py-2">{mailbox.warmup_enabled ? `step ${mailbox.warmup_step}` : 'off'}</td>
              <td className="px-3 py-2 text-zinc-500 dark:text-zinc-400">{mailbox.last_poll_at ? ago(mailbox.last_poll_at) : '–'}</td>
            </tr>
          ))}
          {mailboxes.data.data.length === 0 && (
            <tr>
              <td colSpan={7} className="px-3 py-3 text-zinc-500 dark:text-zinc-400">
                No mailboxes yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Capacity() {
  const person = usePerson();
  const client = useQueryClient();
  const capacity = useQuery({ queryKey: ['capacity', 'all'], queryFn: () => unwrap(api.GET('/capacity', { params: { query: {} } })) });
  const priority = useMutation({
    mutationFn: ({ campaignId, sending_priority }: { campaignId: string; sending_priority: 'high' | 'normal' | 'low' }) => unwrap(api.PATCH('/campaigns/{campaignId}', { params: { path: { campaignId } }, body: { sending_priority } })),
    onSuccess: () => (void client.invalidateQueries({ queryKey: ['capacity'] }), void client.invalidateQueries({ queryKey: ['campaign'] })),
  });
  if (capacity.isPending) return <Loading />;
  if (capacity.isError) return <ErrorText error={capacity.error} onRetry={() => void capacity.refetch()} />;
  const data = capacity.data;
  return (
    <div className="space-y-4">
      <div className="relative overflow-x-auto rounded-[var(--radius-card)] border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left">
          <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400 dark:border-zinc-800">
            <tr>
              {['Campaign', 'Priority', 'Wants/day', 'Allocated', 'Sent', 'Waiting', 'Limited by', 'Finishes'].map((heading) => (
                <th key={heading} scope="col" className="px-3 py-2 font-medium">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {data.campaigns.map((campaign) => (
              <tr key={campaign.campaign_id}>
                <td className="px-3 py-2">
                  <Link href={`/campaigns/${campaign.campaign_id}`} className="font-medium hover:underline">
                    {campaign.name}
                  </Link>
                </td>
                <td className="px-3 py-2">
                  <select aria-label={`Priority of ${campaign.name}`} value={campaign.priority} disabled={!person.can('campaigns:write') || priority.isPending} onChange={(event) => priority.mutate({ campaignId: campaign.campaign_id, sending_priority: event.target.value as 'high' | 'normal' | 'low' })} className={cn(inputClass, 'w-auto py-1')}>
                    <option value="high">High</option>
                    <option value="normal">Normal</option>
                    <option value="low">Low</option>
                  </select>
                </td>
                <td className="px-3 py-2 tabular-nums">{campaign.wants}</td>
                <td className="px-3 py-2 tabular-nums">{campaign.alloc}</td>
                <td className="px-3 py-2 tabular-nums">{campaign.used}</td>
                <td className="px-3 py-2 tabular-nums">{campaign.waiting}</td>
                <td className="px-3 py-2">{LIMIT_TEXT[campaign.limited_by] ?? words(campaign.limited_by)}</td>
                <td className="px-3 py-2">{campaign.finishes_on ? `~${new Date(`${campaign.finishes_on}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : '–'}</td>
              </tr>
            ))}
            {data.campaigns.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-3 text-zinc-500 dark:text-zinc-400">
                  No campaign has threads waiting for a first email today.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <ErrorText error={priority.error} />
      <section aria-label="Next 7 days" className="space-y-1 rounded-[var(--radius-card)] border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Next 7 days if every band stays Healthy</h2>
        {data.domains.map((domain) => (
          <p key={domain.domain_id} className="tabular-nums">
            <span className="font-medium">{domain.domain}</span>{' '}
            {data.forecast.map((day) => day.domains.find((entry) => entry.domain_id === domain.domain_id)?.cap ?? 0).join(' · ')}
          </p>
        ))}
      </section>
      <section aria-label="Mailboxes today" className="relative overflow-x-auto rounded-[var(--radius-card)] border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left">
          <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400 dark:border-zinc-800">
            <tr>
              {['Mailbox', 'Cap', 'Replies', 'Follow-ups', 'First emails', 'Limited by'].map((heading) => (
                <th key={heading} scope="col" className="px-3 py-2 font-medium">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {data.mailboxes.map((mailbox) => (
              <tr key={mailbox.mailbox_id}>
                <td className="px-3 py-2">{mailbox.email}</td>
                <td className="px-3 py-2 tabular-nums">{mailbox.cap}</td>
                <td className="px-3 py-2 tabular-nums">{mailbox.reply_reserve}</td>
                <td className="px-3 py-2 tabular-nums">{mailbox.follow_ups}</td>
                <td className="px-3 py-2 tabular-nums">{mailbox.first_touch_pool}</td>
                <td className="px-3 py-2">{LIMIT_TEXT[mailbox.limited_by] ?? words(mailbox.limited_by)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

const EVENT_PREFIXES = ['domain.', 'mailbox.', 'deliverability.'] as const;

function Events() {
  const queries = useQueries({ queries: EVENT_PREFIXES.map((type) => ({ queryKey: ['activities', type], queryFn: () => unwrap(api.GET('/activities', { params: { query: { type, limit: 100 } } })) })) });
  const breakers = useQuery({ queryKey: ['activities', 'campaign.breaker_tripped'], queryFn: () => unwrap(api.GET('/activities', { params: { query: { type: 'campaign.breaker_tripped', limit: 50 } } })) });
  if (queries.some((query) => query.isPending)) return <Loading />;
  const failed = queries.find((query) => query.isError);
  if (failed) return <ErrorText error={failed.error} />;
  const events = [...queries.flatMap((query) => query.data?.data ?? []), ...(breakers.data?.data ?? [])].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  return (
    <section aria-label="Events" className="rounded-[var(--radius-card)] border border-zinc-200 p-4 dark:border-zinc-800">
      <p className="mb-2 text-zinc-600 dark:text-zinc-400">Every ramp move, band change, breaker trip, override and limit change, with who made it and why.</p>
      {events.length === 0 ? <p className="text-zinc-500 dark:text-zinc-400">Nothing yet.</p> : <EventList events={events} />}
    </section>
  );
}
