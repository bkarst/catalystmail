'use client';

// V14 Mailbox setup wizard (spec §15.16): the provider (Google, Microsoft, Other) → OAuth, or a
// password with the hosts → the connection test checklist, each line turning green as it passes →
// limits, with warm-up explained → the signature → done. OAuth leaves for the provider and comes
// back to the mailbox's page; the password path stays here. The mailbox's domain must be added first.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, CircleAlert, CircleMinus, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useState, type FormEvent, type ReactNode } from 'react';

import { Button, ErrorText, inputClass, Loading, textareaClass } from '../../../../../components/ui.tsx';
import { api, unwrap, type Schemas } from '../../../../../lib/api.ts';
import { cn } from '../../../../../lib/cn.ts';

type Provider = 'google' | 'microsoft' | 'other';
type Step = 'provider' | 'credentials' | 'test' | 'limits' | 'done';
const STEPS: { key: Step; label: string }[] = [
  { key: 'provider', label: 'Provider' },
  { key: 'credentials', label: 'Sign-in' },
  { key: 'test', label: 'Connection test' },
  { key: 'limits', label: 'Limits and signature' },
  { key: 'done', label: 'Done' },
];
const PROVIDERS: Record<Provider, { label: string; note: string }> = {
  google: { label: 'Google Workspace', note: 'Sign in with Google, or use an app password.' },
  microsoft: { label: 'Microsoft 365', note: 'Sign in with Microsoft, or use a password.' },
  other: { label: 'Other (SMTP and IMAP)', note: 'Give the hosts and a password.' },
};
const TEST_STEPS: Record<string, string> = {
  smtp_auth: 'SMTP sign-in',
  imap_auth: 'IMAP sign-in',
  folders: 'INBOX, Sent and Junk folders',
  send: 'Test email sent to itself',
  receive: 'Received, with SPF, DKIM and DMARC passing',
  sent_copy: 'Copy found in Sent',
  cleanup: 'Test email deleted',
};

export default function NewMailboxPage() {
  const client = useQueryClient();
  const [step, setStep] = useState<Step>('provider');
  const [provider, setProvider] = useState<Provider>('google');
  const [form, setForm] = useState({ email: '', display_name: '', password: '', smtp_host: '', smtp_port: '465', smtp_secure: 'tls' as 'tls' | 'starttls', imap_host: '', imap_port: '993' });
  const [mailbox, setMailbox] = useState<Schemas['Mailbox'] | null>(null);
  const domains = useQuery({ queryKey: ['domains'], queryFn: () => unwrap(api.GET('/domains', { params: { query: { limit: 100 } } })) });
  const create = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/mailboxes', {
          body: {
            email: form.email.trim(),
            display_name: form.display_name.trim(),
            provider,
            password: form.password,
            ...(provider === 'other' && { smtp_host: form.smtp_host.trim(), smtp_port: Number(form.smtp_port), smtp_secure: form.smtp_secure, imap_host: form.imap_host.trim(), imap_port: Number(form.imap_port) }),
          },
        }),
      ),
    onSuccess: (created) => {
      setMailbox(created);
      setStep('test');
      void client.invalidateQueries({ queryKey: ['mailboxes'] });
      test.mutate(created.id);
    },
  });
  const test = useMutation({ mutationFn: (mailboxId: string) => unwrap(api.POST('/mailboxes/{mailboxId}/test', { params: { path: { mailboxId } } })), onSuccess: (result) => setMailbox(result.mailbox) });
  const domainOf = form.email.split('@')[1]?.toLowerCase();
  const knownDomain = !domainOf || (domains.data?.data ?? []).some((domain) => domain.domain === domainOf);
  const oauthHref = `/api/v1/oauth/${provider}/start?email=${encodeURIComponent(form.email.trim())}&display_name=${encodeURIComponent(form.display_name.trim() || form.email.split('@')[0] || '')}`;

  return (
    <div className="max-w-3xl space-y-4">
      <Link href="/deliverability?tab=mailboxes" className="inline-flex items-center gap-1 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100">
        <ArrowLeft aria-hidden className="size-4" /> Mailboxes
      </Link>
      <h1 className="text-xl font-semibold">Add a mailbox</h1>
      <ol aria-label="Steps" className="flex flex-wrap items-center gap-2 text-xs">
        {STEPS.map((entry, index) => {
          const current = entry.key === step;
          const done = STEPS.findIndex((item) => item.key === step) > index;
          return (
            <li key={entry.key} aria-current={current ? 'step' : undefined} className={cn('rounded-[var(--radius-pill)] px-2 py-1', current ? 'bg-indigo-600 text-white' : done ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400')}>
              {index + 1} {entry.label}
            </li>
          );
        })}
      </ol>

      {step === 'provider' && (
        <Card>
          <fieldset className="space-y-2">
            <legend className="font-medium">Which provider?</legend>
            {(Object.keys(PROVIDERS) as Provider[]).map((key) => (
              <label key={key} className="flex items-start gap-2">
                <input type="radio" name="provider" className="mt-1" checked={provider === key} onChange={() => setProvider(key)} />
                <span>
                  {PROVIDERS[key].label}
                  <span className="block text-xs text-zinc-500 dark:text-zinc-400">{PROVIDERS[key].note}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <Button variant="primary" onClick={() => setStep('credentials')}>
            Continue
          </Button>
        </Card>
      )}

      {step === 'credentials' && (
        <Card>
          <div className="flex flex-wrap gap-3">
            <Input label="Email address" type="email" value={form.email} onChange={(email) => setForm({ ...form, email })} />
            <Input label="Sender name" value={form.display_name} onChange={(display_name) => setForm({ ...form, display_name })} placeholder="Alex Rivera" />
          </div>
          {domainOf && domains.data && !knownDomain && (
            <p role="alert" className="text-amber-700 dark:text-amber-300">
              {domainOf} isn’t a sending domain yet.{' '}
              <Link href="/deliverability?tab=domains" className="underline">
                Add it on the Domains tab
              </Link>{' '}
              first.
            </p>
          )}
          {provider !== 'other' && (
            <div className="space-y-1 rounded-[var(--radius-card)] border border-zinc-200 p-3 dark:border-zinc-800">
              <p>Sign in with {provider === 'google' ? 'Google' : 'Microsoft'}: you’ll consent there and come back to the mailbox.</p>
              <a aria-disabled={!form.email || !knownDomain} href={form.email && knownDomain ? oauthHref : undefined} className={cn('inline-flex items-center rounded-[var(--radius-pill)] bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-700', (!form.email || !knownDomain) && 'pointer-events-none opacity-50')}>
                Sign in with {provider === 'google' ? 'Google' : 'Microsoft'}
              </a>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Or use a password below ({provider === 'google' ? 'a Google app password' : 'with SMTP AUTH enabled for the mailbox'}).</p>
            </div>
          )}
          <form
            className="space-y-3"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              create.mutate();
            }}
          >
            <Input label={provider === 'google' ? 'App password' : 'Password'} type="password" value={form.password} onChange={(password) => setForm({ ...form, password })} autoComplete="new-password" />
            {provider === 'other' && (
              <div className="flex flex-wrap gap-3">
                <Input label="SMTP host" value={form.smtp_host} onChange={(smtp_host) => setForm({ ...form, smtp_host })} placeholder="smtp.example.com" />
                <Input label="SMTP port" value={form.smtp_port} onChange={(smtp_port) => setForm({ ...form, smtp_port, smtp_secure: smtp_port === '587' ? 'starttls' : 'tls' })} width="w-24" />
                <label className="text-xs text-zinc-500 dark:text-zinc-400">
                  Security
                  <select value={form.smtp_secure} onChange={(event) => setForm({ ...form, smtp_secure: event.target.value as 'tls' | 'starttls' })} className={cn(inputClass, 'mt-0.5 w-auto text-sm text-zinc-900 dark:text-zinc-100')}>
                    <option value="tls">TLS (465)</option>
                    <option value="starttls">STARTTLS (587)</option>
                  </select>
                </label>
                <Input label="IMAP host" value={form.imap_host} onChange={(imap_host) => setForm({ ...form, imap_host })} placeholder="imap.example.com" />
                <Input label="IMAP port" value={form.imap_port} onChange={(imap_port) => setForm({ ...form, imap_port })} width="w-24" />
              </div>
            )}
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Stored encrypted and never shown again.</p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setStep('provider')}>
                Back
              </Button>
              <Button type="submit" variant="primary" disabled={create.isPending || !knownDomain}>
                Add and test
              </Button>
            </div>
            <ErrorText error={create.error} />
          </form>
        </Card>
      )}

      {step === 'test' && mailbox && (
        <Card>
          <p className="font-medium">Connection test for {mailbox.email}</p>
          {test.isPending && <Loading label="Signing in, sending a test email to itself and reading it back… This takes up to a minute." />}
          <ErrorText error={test.error} />
          {test.data && (
            <>
              <ol className="space-y-1">
                {test.data.steps.map((entry) => {
                  const Icon = entry.status === 'pass' ? CheckCircle2 : entry.status === 'warn' ? CircleAlert : entry.status === 'fail' ? XCircle : CircleMinus;
                  return (
                    <li key={entry.step} className="flex items-start gap-2">
                      <Icon aria-label={entry.status} className={cn('mt-0.5 size-4 shrink-0', entry.status === 'pass' ? 'text-emerald-600' : entry.status === 'warn' ? 'text-amber-600' : entry.status === 'fail' ? 'text-rose-600' : 'text-zinc-500 dark:text-zinc-400')} />
                      <span>
                        {TEST_STEPS[entry.step] ?? entry.step}
                        {entry.detail && <span className="text-zinc-500 dark:text-zinc-400"> · {entry.detail}</span>}
                      </span>
                    </li>
                  );
                })}
              </ol>
              <p>{test.data.passed ? 'Every required step passed: the mailbox is active.' : 'Fix what failed, then test again. A new password goes in on the mailbox’s page; wrong hosts mean removing the mailbox and adding it again, since hosts can’t change.'}</p>
            </>
          )}
          <div className="flex gap-2">
            <Button disabled={test.isPending} onClick={() => test.mutate(mailbox.id)}>
              Test again
            </Button>
            <Button variant="primary" disabled={!test.data?.passed} onClick={() => setStep('limits')}>
              Continue
            </Button>
            <Link href={`/deliverability/mailboxes/${mailbox.id}`} className="inline-flex items-center px-3 py-1.5 text-zinc-600 hover:underline dark:text-zinc-400">
              Open the mailbox
            </Link>
          </div>
        </Card>
      )}

      {step === 'limits' && mailbox && <LimitsStep mailbox={mailbox} onDone={(updated) => (setMailbox(updated), setStep('done'))} />}

      {step === 'done' && mailbox && (
        <Card>
          <p className="font-medium">{mailbox.email} is ready.</p>
          <p className="text-zinc-600 dark:text-zinc-400">It starts at its warm-up volume and grows each Healthy day. Add it to a campaign’s mailboxes to send from it.</p>
          <Link href={`/deliverability/mailboxes/${mailbox.id}`} className="inline-flex items-center rounded-[var(--radius-pill)] bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-700">
            Open the mailbox
          </Link>
        </Card>
      )}
    </div>
  );
}

function Card({ children }: { children: ReactNode }) {
  return <section className="space-y-3 rounded-[var(--radius-card)] border border-zinc-200 p-4 dark:border-zinc-800">{children}</section>;
}

function Input({ label, value, onChange, type = 'text', placeholder, width = 'w-64', autoComplete }: { label: string; value: string; onChange: (value: string) => void; type?: string; placeholder?: string; width?: string; autoComplete?: string }) {
  return (
    <label className="text-xs text-zinc-500 dark:text-zinc-400">
      {label}
      <input type={type} required value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} autoComplete={autoComplete} className={cn(inputClass, 'mt-0.5 text-sm text-zinc-900 dark:text-zinc-100', width)} />
    </label>
  );
}

function LimitsStep({ mailbox, onDone }: { mailbox: Schemas['Mailbox']; onDone: (mailbox: Schemas['Mailbox']) => void }) {
  const [form, setForm] = useState({ daily_limit: String(mailbox.daily_limit), warmup_enabled: mailbox.warmup_enabled, warmup_start_volume: String(mailbox.warmup_start_volume), warmup_daily_increment: String(mailbox.warmup_daily_increment), signature_text: mailbox.signature_text ?? '' });
  const save = useMutation({
    mutationFn: () =>
      unwrap(
        api.PATCH('/mailboxes/{mailboxId}', {
          params: { path: { mailboxId: mailbox.id } },
          body: { daily_limit: Number(form.daily_limit), warmup_enabled: form.warmup_enabled, warmup_start_volume: Number(form.warmup_start_volume), warmup_daily_increment: Number(form.warmup_daily_increment), signature_text: form.signature_text.trim() || null },
        }),
      ),
    onSuccess: onDone,
  });
  return (
    <Card>
      <form
        className="space-y-3"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <p className="text-zinc-600 dark:text-zinc-400">
          A new mailbox sends a little at first and more each Healthy day (warm-up), up to its daily limit. Sending a lot from a cold mailbox lands mail in spam. Warm-up can’t be turned off in the first 14 days.
        </p>
        <div className="flex flex-wrap gap-3">
          <Input label="Daily limit, once warmed up" value={form.daily_limit} onChange={(daily_limit) => setForm({ ...form, daily_limit })} width="w-28" />
          <Input label="First day" value={form.warmup_start_volume} onChange={(warmup_start_volume) => setForm({ ...form, warmup_start_volume })} width="w-28" />
          <Input label="Added each Healthy day" value={form.warmup_daily_increment} onChange={(warmup_daily_increment) => setForm({ ...form, warmup_daily_increment })} width="w-28" />
        </div>
        <label className="block text-xs text-zinc-500 dark:text-zinc-400">
          Signature (plain text, added to every email)
          <textarea value={form.signature_text} onChange={(event) => setForm({ ...form, signature_text: event.target.value })} className={cn(textareaClass, 'mt-0.5 min-h-20 text-sm text-zinc-900 dark:text-zinc-100')} placeholder={`${mailbox.display_name}\nAcme`} maxLength={2000} />
        </label>
        <Button type="submit" variant="primary" disabled={save.isPending}>
          Save and finish
        </Button>
        <ErrorText error={save.error} />
      </form>
    </Card>
  );
}
