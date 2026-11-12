'use client';

// A mailbox's page (spec §15.15 "Mailboxes tab"): sends, bounces and replies by day; the health
// score with the points each input cost; warm-up; poll history; the limits editor (within §8.3.4)
// and signature; Catalyst's own DKIM key for "other" providers; and the connection test, Check now,
// pause and resume (a breaker pause needs its cause acknowledged), and removal.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, CircleAlert, CircleMinus, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';

import { BandPill, PointsLost } from '../../../../../components/deliverability/bits.tsx';
import { CopyButton } from '../../../../../components/settings/integrations.tsx';
import { Button, ErrorText, inputClass, Loading, Pill, textareaClass } from '../../../../../components/ui.tsx';
import { api, unwrap, type Schemas } from '../../../../../lib/api.ts';
import { cn } from '../../../../../lib/cn.ts';
import { ago, dateTime, words } from '../../../../../lib/format.ts';
import { usePerson } from '../../../../../lib/person.tsx';

type Mailbox = Schemas['Mailbox'];

export default function MailboxPage() {
  const { mailboxId } = useParams<{ mailboxId: string }>();
  const mailbox = useQuery({ queryKey: ['mailbox', mailboxId], queryFn: () => unwrap(api.GET('/mailboxes/{mailboxId}', { params: { path: { mailboxId } } })) });
  if (mailbox.isPending) return <Loading />;
  if (mailbox.isError)
    return (
      <div className="space-y-2">
        <BackLink />
        <ErrorText error={mailbox.error} onRetry={() => void mailbox.refetch()} />
      </div>
    );
  const data = mailbox.data;
  return (
    <div className="space-y-4">
      <BackLink />
      <Header mailbox={data} />
      <Stats mailboxId={data.id} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Block title="Warm-up">
          <p>
            {data.warmup_enabled ? (
              <>
                Step {data.warmup_step}: starts at {data.warmup_start_volume} a day, +{data.warmup_daily_increment} each Healthy day, up to {data.daily_limit}. Today’s cap is {data.today_cap}.
              </>
            ) : (
              <>Off: the cap is the daily limit ({data.daily_limit}), times the health multiplier. Today’s cap is {data.today_cap}.</>
            )}
          </p>
        </Block>
        <Polls mailbox={data} />
      </div>
      <Limits mailbox={data} />
      {data.provider === 'other' && <Dkim mailbox={data} />}
      <Remove mailbox={data} />
    </div>
  );
}

const BackLink = () => (
  <Link href="/deliverability?tab=mailboxes" className="inline-flex items-center gap-1 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100">
    <ArrowLeft aria-hidden className="size-4" /> Mailboxes
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

function useMailboxRefresh(mailboxId: string) {
  const client = useQueryClient();
  return (updated?: Mailbox) => {
    if (updated) client.setQueryData(['mailbox', mailboxId], updated);
    void client.invalidateQueries({ queryKey: ['mailbox', mailboxId] });
    void client.invalidateQueries({ queryKey: ['deliverability'] });
    void client.invalidateQueries({ queryKey: ['mailboxes'] });
  };
}

const STEP_ICON = { pass: CheckCircle2, warn: CircleAlert, fail: XCircle, skipped: CircleMinus } as const;
const STEP_TONE = { pass: 'text-emerald-600', warn: 'text-amber-600', fail: 'text-rose-600', skipped: 'text-zinc-500 dark:text-zinc-400' } as const;

function Header({ mailbox }: { mailbox: Mailbox }) {
  const person = usePerson();
  const mailboxId = mailbox.id;
  const refresh = useMailboxRefresh(mailboxId);
  const path = { params: { path: { mailboxId } } };
  const [pausing, setPausing] = useState(false);
  const [reason, setReason] = useState('');
  const [ack, setAck] = useState(false);
  const pause = useMutation({ mutationFn: () => unwrap(api.POST('/mailboxes/{mailboxId}/pause', { ...path, body: reason.trim() ? { reason: reason.trim() } : {} })), onSuccess: (updated) => (setPausing(false), refresh(updated)) });
  const resume = useMutation({ mutationFn: () => unwrap(api.POST('/mailboxes/{mailboxId}/resume', { ...path, body: ack ? { acknowledge_cause: true } : {} })), onSuccess: (updated) => refresh(updated) });
  const test = useMutation({ mutationFn: () => unwrap(api.POST('/mailboxes/{mailboxId}/test', path)), onSuccess: (result) => refresh(result.mailbox) });
  const poll = useMutation({ mutationFn: () => unwrap(api.POST('/mailboxes/{mailboxId}/poll', path)), onSuccess: () => refresh() });
  const may = person.can('mailboxes:write');
  // A circuit breaker's pause starts `breaker:` (§8.9); resuming it needs the cause acknowledged.
  const breaker = mailbox.status === 'paused' && (mailbox.status_reason?.startsWith('breaker:') ?? false);

  return (
    <header className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{mailbox.email}</h1>
        <Pill tone={mailbox.status === 'active' ? 'emerald' : mailbox.status === 'error' ? 'rose' : 'amber'}>{words(mailbox.status)}</Pill>
        <BandPill band={mailbox.health_band} score={mailbox.health_score} />
        <span className="text-zinc-500 dark:text-zinc-400">
          {mailbox.display_name} · {words(mailbox.provider)} · {mailbox.auth === 'password' ? 'password' : 'OAuth'}
        </span>
        {may && (
          <div className="ml-auto flex flex-wrap gap-2">
            <Button disabled={test.isPending} onClick={() => test.mutate()}>
              {test.isPending ? 'Testing…' : 'Test connection'}
            </Button>
            <Button disabled={poll.isPending} onClick={() => poll.mutate()}>
              Check for mail now
            </Button>
            {mailbox.status === 'active' && <Button onClick={() => setPausing(!pausing)}>Pause…</Button>}
          </div>
        )}
      </div>
      {mailbox.status_reason && <p className="text-zinc-600 dark:text-zinc-400">{mailbox.status_reason}</p>}
      {pausing && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            pause.mutate();
          }}
        >
          <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why (optional, shown on the mailbox)" aria-label="Why" className={cn(inputClass, 'w-80 py-1')} maxLength={500} />
          <Button type="submit" variant="danger" disabled={pause.isPending}>
            Pause sending
          </Button>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">It is still checked for replies.</span>
        </form>
      )}
      {may && mailbox.status === 'paused' && (
        <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950">
          {breaker && (
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={ack} onChange={(event) => setAck(event.target.checked)} /> I read the cause and dealt with it
            </label>
          )}
          <Button variant="primary" disabled={resume.isPending || (breaker && !ack)} onClick={() => resume.mutate()}>
            Resume sending
          </Button>
        </div>
      )}
      <ErrorText error={pause.error ?? resume.error ?? test.error ?? poll.error} />
      {poll.isSuccess && <p role="status" className="text-emerald-700 dark:text-emerald-400">Checking for new mail now.</p>}
      {test.data && (
        <section aria-label="Connection test" className="space-y-1 rounded-[var(--radius-card)] border border-zinc-200 p-3 dark:border-zinc-800">
          <p className="font-medium">{test.data.passed ? 'Every required step passed.' : 'The connection test failed.'}</p>
          <ol className="space-y-0.5">
            {test.data.steps.map((step) => {
              const Icon = STEP_ICON[step.status];
              return (
                <li key={step.step} className="flex items-start gap-2">
                  <Icon aria-label={step.status} className={cn('mt-0.5 size-4 shrink-0', STEP_TONE[step.status])} />
                  <span>
                    {STEP_TEXT[step.step] ?? words(step.step)}
                    {step.detail && <span className="text-zinc-500 dark:text-zinc-400"> · {step.detail}</span>}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </header>
  );
}

const STEP_TEXT: Record<string, string> = {
  smtp_auth: 'SMTP sign-in',
  imap_auth: 'IMAP sign-in',
  folders: 'INBOX, Sent and Junk found',
  send: 'Test email sent to itself',
  receive: 'Received, with SPF, DKIM and DMARC results',
  sent_copy: 'Copy found in Sent',
  cleanup: 'Test email deleted',
};

function Stats({ mailboxId }: { mailboxId: string }) {
  const stats = useQuery({ queryKey: ['mailbox', mailboxId, 'stats'], queryFn: () => unwrap(api.GET('/mailboxes/{mailboxId}/stats', { params: { path: { mailboxId }, query: { days: 30 } } })) });
  if (stats.isPending) return <Loading />;
  if (stats.isError) return <ErrorText error={stats.error} onRetry={() => void stats.refetch()} />;
  const { days, totals, health_inputs } = stats.data;
  const peak = Math.max(1, ...days.map((day) => day.sent + day.inbound_replies));
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Block title="Last 30 days">
        {days.length === 0 ? (
          <p className="text-zinc-500 dark:text-zinc-400">No activity yet.</p>
        ) : (
          <>
            <div aria-hidden className="flex h-24 items-end gap-0.5">
              {days.map((day) => (
                <span key={day.day} title={`${day.day}: ${day.sent} sent, ${day.bounced_hard} bounced, ${day.inbound_replies} replies`} className="flex w-2.5 flex-col-reverse">
                  <span className="bg-indigo-500" style={{ height: `${Math.round((day.sent / peak) * 96)}px` }} />
                  <span className="bg-emerald-500" style={{ height: `${Math.round((day.inbound_replies / peak) * 96)}px` }} />
                  <span className="bg-rose-500" style={{ height: `${Math.max(day.bounced_hard ? 2 : 0, Math.round((day.bounced_hard / peak) * 96))}px` }} />
                </span>
              ))}
            </div>
            <p className="flex flex-wrap gap-3 text-xs text-zinc-600 dark:text-zinc-400">
              <span>
                <span aria-hidden className="mr-1 inline-block size-2 bg-indigo-500" />
                Sent {totals.sent ?? 0}
              </span>
              <span>
                <span aria-hidden className="mr-1 inline-block size-2 bg-emerald-500" />
                Replies {totals.inbound_replies ?? 0}
              </span>
              <span>
                <span aria-hidden className="mr-1 inline-block size-2 bg-rose-500" />
                Hard bounces {totals.bounced_hard ?? 0}
              </span>
              <span>Complaints {totals.complaints ?? 0}</span>
              <span>Unsubscribes {totals.unsubscribes ?? 0}</span>
            </p>
          </>
        )}
      </Block>
      <Block title="Health: points lost">
        <PointsLost inputs={health_inputs} />
      </Block>
    </div>
  );
}

function Polls({ mailbox }: { mailbox: Mailbox }) {
  const polls = useQuery({ queryKey: ['mailbox', mailbox.id, 'polls'], queryFn: () => unwrap(api.GET('/mailboxes/{mailboxId}/poll-runs', { params: { path: { mailboxId: mailbox.id }, query: { limit: 10 } } })), refetchInterval: 30_000 });
  return (
    <Block title="Polls">
      <p className="text-zinc-600 dark:text-zinc-400">
        {mailbox.last_poll_at ? `Last ${ago(mailbox.last_poll_at)} ago (${mailbox.last_poll_status ?? '–'})` : 'Not polled yet'}
        {mailbox.next_poll_at && ` · next ${dateTime(mailbox.next_poll_at)}`}
      </p>
      <ErrorText error={polls.error} onRetry={() => void polls.refetch()} />
      <ol className="space-y-0.5 text-xs">
        {polls.data?.data.map((run) => (
          <li key={run.id} className="grid grid-cols-[8rem_4rem_1fr] gap-2">
            <span className="text-zinc-500 dark:text-zinc-400">{dateTime(run.started_at)}</span>
            <span className={cn(run.status === 'error' ? 'text-rose-700 dark:text-rose-300' : run.status === 'partial' ? 'text-amber-700 dark:text-amber-300' : '')}>{words(run.status)}</span>
            <span className="text-zinc-600 dark:text-zinc-400">
              {run.fetched_count} fetched · {run.matched_count} matched{run.duration_ms !== null && ` · ${(run.duration_ms / 1000).toFixed(1)}s`} · {words(run.trigger)}
              {run.error && <span className="text-rose-700 dark:text-rose-300"> · {run.error}</span>}
            </span>
          </li>
        ))}
      </ol>
    </Block>
  );
}

function Limits({ mailbox }: { mailbox: Mailbox }) {
  const person = usePerson();
  const refresh = useMailboxRefresh(mailbox.id);
  const draft = () => ({
    display_name: mailbox.display_name,
    daily_limit: String(mailbox.daily_limit),
    hourly_limit: String(mailbox.hourly_limit),
    min_interval_sec: String(mailbox.min_interval_sec),
    max_interval_sec: String(mailbox.max_interval_sec),
    warmup_enabled: mailbox.warmup_enabled,
    warmup_start_volume: String(mailbox.warmup_start_volume),
    warmup_daily_increment: String(mailbox.warmup_daily_increment),
    signature_text: mailbox.signature_text ?? '',
  });
  const [form, setForm] = useState(draft);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setForm(draft()), [mailbox.updated_at]);
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: () =>
      unwrap(
        api.PATCH('/mailboxes/{mailboxId}', {
          params: { path: { mailboxId: mailbox.id } },
          body: {
            display_name: form.display_name.trim(),
            daily_limit: Number(form.daily_limit),
            hourly_limit: Number(form.hourly_limit),
            min_interval_sec: Number(form.min_interval_sec),
            max_interval_sec: Number(form.max_interval_sec),
            warmup_enabled: form.warmup_enabled,
            warmup_start_volume: Number(form.warmup_start_volume),
            warmup_daily_increment: Number(form.warmup_daily_increment),
            signature_text: form.signature_text.trim() || null,
          },
        }),
      ),
    onSuccess: (updated) => (setSaved(true), refresh(updated)),
  });
  const may = person.can('mailboxes:write');
  const number = (key: 'daily_limit' | 'hourly_limit' | 'min_interval_sec' | 'max_interval_sec' | 'warmup_start_volume' | 'warmup_daily_increment', label: string, min: number, max: number, hint?: string) => (
    <label className="text-xs text-zinc-500 dark:text-zinc-400">
      {label}
      <input type="number" min={min} max={max} required disabled={!may} value={form[key]} onChange={(event) => (setForm({ ...form, [key]: event.target.value }), setSaved(false))} className={cn(inputClass, 'mt-0.5 w-28 text-sm text-zinc-900 dark:text-zinc-100')} />
      {hint && <span className="mt-0.5 block">{hint}</span>}
    </label>
  );
  return (
    <Block title="Limits and signature">
      <form
        className="space-y-3"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <div className="flex flex-wrap gap-4">
          <label className="text-xs text-zinc-500 dark:text-zinc-400">
            Sender name
            <input required disabled={!may} value={form.display_name} onChange={(event) => setForm({ ...form, display_name: event.target.value })} className={cn(inputClass, 'mt-0.5 w-56 text-sm text-zinc-900 dark:text-zinc-100')} maxLength={100} />
          </label>
          {number('daily_limit', 'Daily limit', 1, 500, 'Above 150 needs an admin.')}
          {number('hourly_limit', 'Hourly limit', 1, 60)}
          {number('min_interval_sec', 'Min gap (s)', 60, 3600)}
          {number('max_interval_sec', 'Max gap (s)', 60, 7200)}
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" disabled={!may} checked={form.warmup_enabled} onChange={(event) => setForm({ ...form, warmup_enabled: event.target.checked })} /> Warm-up
          </label>
          {form.warmup_enabled && number('warmup_start_volume', 'First day', 1, 100)}
          {form.warmup_enabled && number('warmup_daily_increment', 'Added each Healthy day', 1, 50)}
          <span className="text-xs text-zinc-500 dark:text-zinc-400">Warm-up can’t be turned off in a mailbox’s first 14 days.</span>
        </div>
        <label className="block max-w-xl text-xs text-zinc-500 dark:text-zinc-400">
          Signature (plain text, added to every email)
          <textarea disabled={!may} value={form.signature_text} onChange={(event) => setForm({ ...form, signature_text: event.target.value })} className={cn(textareaClass, 'mt-0.5 min-h-20 text-sm text-zinc-900 dark:text-zinc-100')} maxLength={2000} />
        </label>
        {may && (
          <div className="flex items-center gap-3">
            <Button type="submit" variant="primary" disabled={save.isPending}>
              Save
            </Button>
            {saved && (
              <span role="status" className="text-emerald-700 dark:text-emerald-400">
                Saved.
              </span>
            )}
          </div>
        )}
        <ErrorText error={save.error} />
      </form>
    </Block>
  );
}

function Dkim({ mailbox }: { mailbox: Mailbox }) {
  const person = usePerson();
  const refresh = useMailboxRefresh(mailbox.id);
  const path = { params: { path: { mailboxId: mailbox.id } } };
  const create = useMutation({ mutationFn: () => unwrap(api.POST('/mailboxes/{mailboxId}/dkim', { ...path, body: {} })), onSuccess: (updated) => refresh(updated) });
  const remove = useMutation({ mutationFn: () => unwrap(api.DELETE('/mailboxes/{mailboxId}/dkim', path)), onSuccess: (updated) => refresh(updated) });
  const key = mailbox.catalyst_dkim;
  return (
    <Block title="DKIM signing by Catalyst">
      <p className="text-zinc-600 dark:text-zinc-400">For a host that doesn’t sign mail itself: Catalyst signs each email with its own key, which you publish in DNS.</p>
      {key ? (
        <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-zinc-500 dark:text-zinc-400">Record</dt>
          <dd className="flex items-center gap-1 font-mono">
            {key.record_name} TXT <CopyButton text={key.record_name} />
          </dd>
          <dt className="text-zinc-500 dark:text-zinc-400">Value</dt>
          <dd className="flex items-start gap-1 font-mono">
            <span className="break-all">{key.record_value}</span> <CopyButton text={key.record_value} />
          </dd>
        </dl>
      ) : (
        <p className="text-zinc-500 dark:text-zinc-400">No key yet.</p>
      )}
      {person.can('mailboxes:write') &&
        (key ? (
          <Button size="sm" variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate()}>
            Stop signing and delete the key
          </Button>
        ) : (
          <Button size="sm" disabled={create.isPending} onClick={() => create.mutate()}>
            Make a DKIM key
          </Button>
        ))}
      <ErrorText error={create.error ?? remove.error} />
    </Block>
  );
}

function Remove({ mailbox }: { mailbox: Mailbox }) {
  const person = usePerson();
  const router = useRouter();
  const client = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const remove = useMutation({
    mutationFn: () => unwrap(api.DELETE('/mailboxes/{mailboxId}', { params: { path: { mailboxId: mailbox.id } } })),
    onSuccess: () => (void client.invalidateQueries({ queryKey: ['mailboxes'] }), void client.invalidateQueries({ queryKey: ['deliverability'] }), router.push('/deliverability?tab=mailboxes')),
  });
  if (!person.can('mailboxes:write')) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {confirming ? (
        <>
          <span>Remove {mailbox.email}? It stops sending and being polled.</span>
          <Button variant="danger" disabled={remove.isPending} onClick={() => remove.mutate()}>
            Remove
          </Button>
          <Button variant="ghost" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </>
      ) : (
        <Button variant="ghost" onClick={() => setConfirming(true)}>
          Remove mailbox…
        </Button>
      )}
      <ErrorText error={remove.error} />
    </div>
  );
}
