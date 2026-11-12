'use client';

// A domain's page (spec §15.15): its reputation with the score history and the points each input
// cost; its ramp with the plan, step, planned against sent, every move, and the admin controls of
// §8.3.6 (hold, resume, step back, override the cap, change the plan, each with a reason); today's
// capacity by mailbox and campaign; and folding sections for DNS (expected against found, copyable),
// blocklists, and Google Postmaster Tools.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, type ReactNode } from 'react';

import { BandPill, CheckMark, LIMIT_TEXT, PointsLost, ReasonAction } from '../../../../../components/deliverability/bits.tsx';
import { CopyButton } from '../../../../../components/settings/integrations.tsx';
import { Button, ErrorText, inputClass, Loading, Pill, Section } from '../../../../../components/ui.tsx';
import { api, unwrap, type Schemas } from '../../../../../lib/api.ts';
import { cn } from '../../../../../lib/cn.ts';
import { dateTime, percent, words } from '../../../../../lib/format.ts';
import { usePerson } from '../../../../../lib/person.tsx';

type Domain = Schemas['Domain'];
type Ramp = Schemas['DomainRamp'];

export default function DomainPage() {
  const { domainId } = useParams<{ domainId: string }>();
  const path = { params: { path: { domainId } } };
  const domain = useQuery({ queryKey: ['domain', domainId], queryFn: () => unwrap(api.GET('/domains/{domainId}', path)) });
  const reputation = useQuery({ queryKey: ['domain', domainId, 'reputation'], queryFn: () => unwrap(api.GET('/domains/{domainId}/reputation', path)) });
  const ramp = useQuery({ queryKey: ['domain', domainId, 'ramp'], queryFn: () => unwrap(api.GET('/domains/{domainId}/ramp', path)) });

  if (domain.isPending) return <Loading />;
  if (domain.isError)
    return (
      <div className="space-y-2">
        <BackLink />
        <ErrorText error={domain.error} onRetry={() => void domain.refetch()} />
      </div>
    );
  const data = domain.data;

  return (
    <div className="space-y-4">
      <BackLink />
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{data.domain}</h1>
        <span className="ml-auto text-zinc-500 dark:text-zinc-400">Reputation</span>
        <BandPill band={data.reputation_band} score={data.reputation_score} />
      </header>
      {data.first_touches_paused && <FirstTouchesPaused domain={data} />}

      <Block title="Reputation">
        {reputation.isPending ? (
          <Loading />
        ) : reputation.isError ? (
          <ErrorText error={reputation.error} onRetry={() => void reputation.refetch()} />
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-1">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Score, last 30 days</p>
              <Bars values={reputation.data.history.map((day) => ({ label: day.day, value: day.score ?? 0, tone: day.band ?? 'healthy' }))} max={100} />
              {reputation.data.band_changed_at && <p className="text-xs text-zinc-500 dark:text-zinc-400">Band since {dateTime(reputation.data.band_changed_at)}</p>}
            </div>
            <div className="space-y-1">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Points lost</p>
              <PointsLost inputs={reputation.data.inputs} />
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Gmail spam rate: {data.postmaster.connected ? (data.postmaster.spam_rate === null ? 'no data' : percent(data.postmaster.spam_rate, 2)) : 'Postmaster Tools not connected'} · {data.blocklisted ? 'on a blocklist' : 'blocklists clear'}
              </p>
            </div>
          </div>
        )}
      </Block>

      <Block title="Ramp">{ramp.isPending ? <Loading /> : ramp.isError ? <ErrorText error={ramp.error} onRetry={() => void ramp.refetch()} /> : <RampPanel domain={data} ramp={ramp.data} />}</Block>
      <CapacityToday domainId={data.id} />

      <div className="rounded-[var(--radius-card)] border border-zinc-200 px-4 dark:border-zinc-800">
        <Section title="Authentication & DNS" open={Boolean(data.checks && !data.checks.ready)}>
          <Dns domain={data} />
        </Section>
        <Section title="Blocklists" open={data.blocklisted}>
          <p>{data.blocklisted ? 'The domain or its sending IP is on a major blocklist (Spamhaus DBL, SURBL or URIBL). Every mailbox on it is paused until it is delisted; checks run every 6 hours.' : 'Clear on Spamhaus DBL, SURBL and URIBL, checked every 6 hours.'}</p>
        </Section>
        <Section title="Google Postmaster Tools" open={false}>
          <Postmaster domain={data} />
        </Section>
      </div>
    </div>
  );
}

const BackLink = () => (
  <Link href="/deliverability?tab=domains" className="inline-flex items-center gap-1 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100">
    <ArrowLeft aria-hidden className="size-4" /> Domains
  </Link>
);

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="space-y-3 rounded-[var(--radius-card)] border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{title}</h2>
      {children}
    </section>
  );
}

const BAR_TONE: Record<string, string> = { healthy: 'bg-emerald-500', at_risk: 'bg-amber-500', critical: 'bg-rose-500', paused: 'bg-rose-700', planned: 'bg-zinc-300 dark:bg-zinc-700', sent: 'bg-indigo-500' };

/** A row of bars, one per day, with each value as a title and a hidden table for screen readers. */
function Bars({ values, max }: { values: { label: string; value: number; tone: string }[]; max: number }) {
  if (values.length === 0) return <p className="text-zinc-500 dark:text-zinc-400">No history yet.</p>;
  const top = Math.max(1, max);
  return (
    <>
      <div aria-hidden className="flex h-20 items-end gap-0.5">
        {values.map((entry) => (
          <span key={entry.label} title={`${entry.label}: ${entry.value}`} className={cn('w-2.5 rounded-t-sm', BAR_TONE[entry.tone] ?? 'bg-indigo-500')} style={{ height: `${Math.max(2, Math.round((entry.value / top) * 100))}%` }} />
        ))}
      </div>
      <table className="sr-only">
        <tbody>
          {values.map((entry) => (
            <tr key={entry.label}>
              <td>{entry.label}</td>
              <td>{entry.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function useRampChange(domainId: string) {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: ['domain', domainId] });
    void client.invalidateQueries({ queryKey: ['deliverability'] });
    void client.invalidateQueries({ queryKey: ['capacity'] });
  };
}

function RampPanel({ domain, ramp }: { domain: Domain; ramp: Ramp }) {
  const person = usePerson();
  const domainId = domain.id;
  const refresh = useRampChange(domainId);
  const path = { params: { path: { domainId } } };
  const hold = useMutation({ mutationFn: (reason: string) => unwrap(api.POST('/domains/{domainId}/ramp/hold', { ...path, body: { reason } })), onSuccess: refresh });
  const resume = useMutation({ mutationFn: (reason: string) => unwrap(api.POST('/domains/{domainId}/ramp/resume', { ...path, body: { reason } })), onSuccess: refresh });
  const [steps, setSteps] = useState(1);
  const stepBack = useMutation({ mutationFn: (reason: string) => unwrap(api.POST('/domains/{domainId}/ramp/step-back', { ...path, body: { steps, reason } })), onSuccess: refresh });
  const [override, setOverride] = useState({ cap: String(ramp.today_cap), until: '' });
  const setCap = useMutation({ mutationFn: (reason: string) => unwrap(api.PUT('/domains/{domainId}/cap-override', { ...path, body: { cap: Number(override.cap), until: override.until, reason } })), onSuccess: refresh });
  const clearCap = useMutation({ mutationFn: () => unwrap(api.DELETE('/domains/{domainId}/cap-override', path)), onSuccess: refresh });
  const [plan, setPlan] = useState<Ramp['plan']>(ramp.plan);
  const changePlan = useMutation({ mutationFn: (reason: string) => unwrap(api.PATCH('/domains/{domainId}/ramp', { ...path, body: { plan, reason } })), onSuccess: refresh });
  const admin = person.can('settings:manage');
  const may = person.can('mailboxes:write');
  const maxUntil = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
  const moves = ramp.history.filter((day) => day.ramp_action && day.ramp_action !== 'none');

  return (
    <div className="space-y-4">
      <dl className="flex flex-wrap gap-x-8 gap-y-1">
        <div>
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">Plan</dt>
          <dd>{words(ramp.plan)}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">Step</dt>
          <dd className="tabular-nums">
            {ramp.step} of {ramp.final_step}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">Today</dt>
          <dd className="tabular-nums">{ramp.today_cap}/day</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">Tomorrow</dt>
          <dd className="tabular-nums">{ramp.tomorrow_cap} (if still Healthy)</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">Status</dt>
          <dd>
            {words(ramp.status)}
            {ramp.manual_hold && ' · held by an admin'}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">Target</dt>
          <dd className="tabular-nums">{ramp.mailbox_cap_total}/day (the mailboxes’ limits)</dd>
        </div>
      </dl>
      {ramp.status_reason && <p className="text-zinc-600 dark:text-zinc-400">{ramp.status_reason}</p>}
      {ramp.cap_override && (
        <p className="flex flex-wrap items-center gap-2">
          <Pill tone="amber">
            Cap overridden: {ramp.cap_override.cap}/day until {ramp.cap_override.until}
          </Pill>
          {ramp.cap_override.reason && <span className="text-zinc-500 dark:text-zinc-400">{ramp.cap_override.reason}</span>}
          {may && (
            <Button size="sm" variant="ghost" disabled={clearCap.isPending} onClick={() => clearCap.mutate()}>
              Remove override
            </Button>
          )}
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Planned, last 30 days</p>
          <Bars values={ramp.history.map((day) => ({ label: day.day, value: day.planned_cap, tone: 'planned' }))} max={Math.max(...ramp.history.map((day) => day.planned_cap), 1)} />
        </div>
        <div className="space-y-1">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Sent, last 30 days</p>
          <Bars values={ramp.history.map((day) => ({ label: day.day, value: day.sent, tone: 'sent' }))} max={Math.max(...ramp.history.map((day) => day.planned_cap), 1)} />
        </div>
      </div>
      <details>
        <summary className="cursor-pointer text-zinc-600 dark:text-zinc-400">The plan, step by step</summary>
        <p className="mt-1 tabular-nums text-zinc-600 dark:text-zinc-400">{ramp.schedule.map((entry) => `${entry.step}: ${entry.cap}`).join(' · ')}</p>
      </details>
      {moves.length > 0 && (
        <ol className="space-y-0.5 text-zinc-600 dark:text-zinc-400">
          {moves
            .slice(-10)
            .reverse()
            .map((day) => (
              <li key={day.day}>
                {day.day} · {words(day.ramp_action!)} to step {day.ramp_step}
                {day.reputation_band && ` · ${words(day.reputation_band)}`}
              </li>
            ))}
        </ol>
      )}
      <ErrorText error={clearCap.error} />
      {may && (
        <div className="flex flex-wrap items-start gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          {ramp.manual_hold ? (
            <ReasonAction label="Resume ramp…" onRun={(reason) => resume.mutate(reason)} pending={resume.isPending} error={resume.error} />
          ) : (
            <ReasonAction label="Hold ramp…" onRun={(reason) => hold.mutate(reason)} pending={hold.isPending} error={hold.error} />
          )}
          <ReasonAction label="Step back…" variant="danger" onRun={(reason) => stepBack.mutate(reason)} pending={stepBack.isPending} error={stepBack.error} disabled={ramp.step === 0}>
            <label className="flex items-center gap-1">
              Steps
              <input type="number" min={1} max={Math.max(1, ramp.step)} value={steps} onChange={(event) => setSteps(Number(event.target.value))} className={cn(inputClass, 'w-16 py-1')} />
            </label>
          </ReasonAction>
          <ReasonAction label="Override cap…" onRun={(reason) => setCap.mutate(reason)} pending={setCap.isPending} error={setCap.error}>
            <label className="flex items-center gap-1">
              Cap
              <input type="number" min={0} max={10_000} required value={override.cap} onChange={(event) => setOverride({ ...override, cap: event.target.value })} className={cn(inputClass, 'w-20 py-1')} />
            </label>
            <label className="flex items-center gap-1">
              until
              <input type="date" required max={maxUntil} value={override.until} onChange={(event) => setOverride({ ...override, until: event.target.value })} className={cn(inputClass, 'w-auto py-1')} />
            </label>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">At most 14 days; at most 50% above the current step.</span>
          </ReasonAction>
          <ReasonAction label="Change plan…" onRun={(reason) => changePlan.mutate(reason)} pending={changePlan.isPending} error={changePlan.error}>
            <select aria-label="Plan" value={plan} onChange={(event) => setPlan(event.target.value as Ramp['plan'])} className={cn(inputClass, 'w-auto py-1')}>
              <option value="new_domain">New domain</option>
              <option value="aged_domain">Aged domain</option>
              {admin && <option value="established">Established (no ramp)</option>}
            </select>
          </ReasonAction>
          <span className="self-center text-xs text-zinc-500 dark:text-zinc-400">Each change asks for a reason and appears on the Events tab.</span>
        </div>
      )}
    </div>
  );
}

function CapacityToday({ domainId }: { domainId: string }) {
  const capacity = useQuery({ queryKey: ['capacity', 'domain', domainId], queryFn: () => unwrap(api.GET('/capacity', { params: { query: { domain_id: domainId } } })) });
  if (capacity.isPending) return <Loading />;
  if (capacity.isError) return <ErrorText error={capacity.error} onRetry={() => void capacity.refetch()} />;
  const { mailboxes, campaigns } = capacity.data;
  return (
    <Block title="Capacity today">
      {mailboxes.length === 0 ? (
        <p className="text-zinc-500 dark:text-zinc-400">No active mailboxes on this domain.</p>
      ) : (
        <div className="relative overflow-x-auto">
          <table className="w-full text-left">
            <thead className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              <tr>
                <th className="py-1 pr-3 font-medium">Mailbox</th>
                <th className="py-1 pr-3 font-medium">Allocation</th>
                <th className="py-1 pr-3 font-medium">Replies</th>
                <th className="py-1 pr-3 font-medium">Follow-ups</th>
                {campaigns.map((campaign) => (
                  <th key={campaign.campaign_id} className="py-1 pr-3 font-medium">
                    {campaign.name} ({campaign.priority})
                  </th>
                ))}
                <th className="py-1 pr-3 font-medium">Limited by</th>
              </tr>
            </thead>
            <tbody>
              {mailboxes.map((mailbox) => (
                <tr key={mailbox.mailbox_id} className="border-t border-zinc-200 dark:border-zinc-800">
                  <td className="py-1.5 pr-3">{mailbox.email}</td>
                  <td className="pr-3 tabular-nums">{mailbox.alloc}</td>
                  <td className="pr-3 tabular-nums">{mailbox.reply_reserve}</td>
                  <td className="pr-3 tabular-nums">{mailbox.follow_ups}</td>
                  {campaigns.map((campaign) => (
                    <td key={campaign.campaign_id} className="pr-3 tabular-nums">
                      {mailbox.campaigns.find((entry) => entry.campaign_id === campaign.campaign_id)?.alloc ?? 0}
                    </td>
                  ))}
                  <td className="pr-3">{LIMIT_TEXT[mailbox.limited_by] ?? words(mailbox.limited_by)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Block>
  );
}

function Dns({ domain }: { domain: Domain }) {
  const person = usePerson();
  const client = useQueryClient();
  const check = useMutation({ mutationFn: () => unwrap(api.POST('/domains/{domainId}/check', { params: { path: { domainId: domain.id } } })), onSuccess: (updated) => (client.setQueryData(['domain', domain.id], updated), void client.invalidateQueries({ queryKey: ['deliverability'] })) });
  const checks = domain.checks;
  return (
    <div className="space-y-3">
      <p className="flex flex-wrap items-center gap-3 text-zinc-600 dark:text-zinc-400">
        {domain.last_checked_at ? `Checked ${dateTime(domain.last_checked_at)}` : 'Not checked yet.'}
        {checks && (checks.ready ? <Pill tone="emerald">Ready to send</Pill> : <Pill tone="rose">Blocks launch</Pill>)}
        {domain.alignment_status && <span>DKIM alignment: {words(domain.alignment_status)}</span>}
        {person.can('mailboxes:write') && (
          <Button size="sm" disabled={check.isPending} onClick={() => check.mutate()}>
            {check.isPending ? 'Checking…' : 'Check DNS now'}
          </Button>
        )}
      </p>
      <ErrorText error={check.error} />
      {checks &&
        (['spf', 'dkim', 'dmarc', 'mx', 'tracking'] as const).map((record) => {
          const entry = checks[record];
          return (
            <details key={record} open={entry.status !== 'pass'} className="rounded-[var(--radius-card)] border border-zinc-200 p-2 dark:border-zinc-800">
              <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                <CheckMark status={entry.status} label={record.toUpperCase()} />
                <span className="text-zinc-600 dark:text-zinc-400">{entry.message}</span>
              </summary>
              <dl className="mt-2 grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 text-xs">
                <dt className="text-zinc-500 dark:text-zinc-400">Record</dt>
                <dd className="font-mono">{entry.name}</dd>
                <dt className="text-zinc-500 dark:text-zinc-400">Expected</dt>
                <dd className="flex items-start gap-1 font-mono">
                  <span className="break-all">{entry.expected}</span> <CopyButton text={entry.expected} />
                </dd>
                <dt className="text-zinc-500 dark:text-zinc-400">Found</dt>
                <dd className="break-all font-mono">{entry.found.length ? entry.found.join('\n') : 'nothing'}</dd>
              </dl>
            </details>
          );
        })}
    </div>
  );
}

function Postmaster({ domain }: { domain: Domain }) {
  const person = usePerson();
  const postmaster = domain.postmaster;
  return (
    <div className="space-y-2">
      {postmaster.connected ? (
        <dl className="grid max-w-xl grid-cols-[12rem_1fr] gap-y-1">
          <dt className="text-zinc-500 dark:text-zinc-400">Last sync</dt>
          <dd>{postmaster.synced_at ? dateTime(postmaster.synced_at) : 'Not yet'}</dd>
          <dt className="text-zinc-500 dark:text-zinc-400">Gmail spam rate</dt>
          <dd>{postmaster.no_data ? 'No data (too little mail to Gmail)' : postmaster.spam_rate === null ? '–' : percent(postmaster.spam_rate, 2)}</dd>
          <dt className="text-zinc-500 dark:text-zinc-400">Authentication at Gmail</dt>
          <dd>{(['spf', 'dkim', 'dmarc'] as const).map((key) => `${key.toUpperCase()} ${postmaster.auth[key] === null ? '–' : percent(postmaster.auth[key], 0)}`).join(' · ')}</dd>
          <dt className="text-zinc-500 dark:text-zinc-400">Sender requirements</dt>
          <dd>
            {words(postmaster.compliance)}
            {postmaster.needs_work.length > 0 && `: ${postmaster.needs_work.join(', ')}`}
          </dd>
          {postmaster.error && (
            <>
              <dt className="text-zinc-500 dark:text-zinc-400">Last error</dt>
              <dd className="text-rose-700 dark:text-rose-300">{postmaster.error}</dd>
            </>
          )}
        </dl>
      ) : (
        <p className="text-zinc-600 dark:text-zinc-400">Not connected. Connecting adds Gmail’s spam rate and its view of your authentication to the reputation score.</p>
      )}
      {person.can('mailboxes:write') && (
        <a href={`/api/v1/domains/${domain.id}/postmaster/connect`} className="inline-flex items-center rounded-[var(--radius-pill)] border border-zinc-200 px-3 py-1.5 font-medium hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900">
          {postmaster.connected ? 'Reconnect' : 'Connect'} Google Postmaster Tools
        </a>
      )}
    </div>
  );
}

function FirstTouchesPaused({ domain }: { domain: Domain }) {
  const person = usePerson();
  const client = useQueryClient();
  const [ack, setAck] = useState(false);
  const resume = useMutation({ mutationFn: () => unwrap(api.POST('/domains/{domainId}/first-touches/resume', { params: { path: { domainId: domain.id } }, body: { acknowledge_cause: true } })), onSuccess: (updated) => (client.setQueryData(['domain', domain.id], updated), void client.invalidateQueries({ queryKey: ['deliverability'] })) });
  const paused = domain.first_touches_paused!;
  return (
    <div role="alert" className="space-y-2 rounded-[var(--radius-card)] border border-rose-200 bg-rose-50 p-3 dark:border-rose-900 dark:bg-rose-950">
      <p>
        <span className="font-medium">First emails are paused</span> since {dateTime(paused.since)}: {paused.reason.toUpperCase()} started failing. Follow-ups and replies still go. Fix the records, check DNS, then resume.
      </p>
      {person.can('mailboxes:write') && (
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={ack} onChange={(event) => setAck(event.target.checked)} /> I fixed the cause
          </label>
          <Button variant="primary" disabled={!ack || resume.isPending} onClick={() => resume.mutate()}>
            Resume first emails
          </Button>
        </div>
      )}
      <ErrorText error={resume.error} />
    </div>
  );
}
