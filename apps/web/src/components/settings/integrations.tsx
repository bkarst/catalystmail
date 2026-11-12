'use client';

// Settings → Integrations (spec §15.18, §13.7): Stripe, Cal.com, Calendly and generic events that
// report bookings and payments as goals. Connect one with the provider's signing secret (generic:
// Catalyst makes the secret and shows it once), give the provider the webhook address, and file
// events that matched no thread by hand.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { api, unwrap } from '../../lib/api.ts';
import { cn } from '../../lib/cn.ts';
import { dateTime, words } from '../../lib/format.ts';
import { Button, ErrorText, inputClass, Loading, Pill } from '../ui.tsx';
import { Field, Panel } from './common.tsx';

const KINDS = { stripe: 'Stripe (checkout.session.completed, invoice.paid)', calcom: 'Cal.com (BOOKING_CREATED)', calendly: 'Calendly (invitee.created)', generic: 'Anything else (a signed POST)' } as const;
type Kind = keyof typeof KINDS;

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button size="sm" variant="ghost" onClick={() => void navigator.clipboard.writeText(text).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)))}>
      <Copy aria-hidden className="size-3.5" /> {copied ? 'Copied' : label}
    </Button>
  );
}

export function IntegrationsSection() {
  const client = useQueryClient();
  const integrations = useQuery({ queryKey: ['integrations'], queryFn: () => unwrap(api.GET('/integrations')) });
  const [kind, setKind] = useState<Kind>('stripe');
  const [secret, setSecret] = useState('');
  const [created, setCreated] = useState<{ secret: string | null; webhook_path: string } | null>(null);
  const connect = useMutation({
    mutationFn: () => unwrap(api.POST('/integrations', { body: { kind, ...(kind !== 'generic' && { signing_secret: secret.trim() }) } })),
    onSuccess: (result) => {
      setCreated({ secret: result.secret, webhook_path: result.webhook_path });
      setSecret('');
      void client.invalidateQueries({ queryKey: ['integrations'] });
    },
  });
  const disconnect = useMutation({ mutationFn: (integrationId: string) => unwrap(api.DELETE('/integrations/{integrationId}', { params: { path: { integrationId } } })), onSuccess: () => client.invalidateQueries({ queryKey: ['integrations'] }) });
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const list = integrations.data?.data ?? [];

  return (
    <div className="space-y-4">
      <Panel title="Connect" description="Bookings and payments become goal achievements on the contact’s thread, for goals that detect integration events.">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            connect.mutate();
          }}
        >
          <Field label="Source">
            <select value={kind} onChange={(event) => setKind(event.target.value as Kind)} className={cn(inputClass, 'w-auto')}>
              {Object.entries(KINDS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          {kind !== 'generic' && (
            <Field label="The provider’s webhook signing secret">
              <input required minLength={8} value={secret} onChange={(event) => setSecret(event.target.value)} className={cn(inputClass, 'w-80 font-mono text-xs')} />
            </Field>
          )}
          <Button type="submit" variant="primary" disabled={connect.isPending}>
            Connect
          </Button>
        </form>
        <ErrorText error={connect.error} />
        {created && (
          <div role="status" className="space-y-1 rounded-[var(--radius-card)] border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950">
            <p>Give the provider this webhook address:</p>
            <p className="flex items-center gap-2">
              <code className="break-all font-mono text-xs">{origin + created.webhook_path}</code> <CopyButton text={origin + created.webhook_path} />
            </p>
            {created.secret && (
              <p className="flex flex-wrap items-center gap-2">
                Signing secret, shown only now: <code className="break-all font-mono text-xs">{created.secret}</code> <CopyButton text={created.secret} />
              </p>
            )}
          </div>
        )}
      </Panel>

      <Panel title="Connected">
        {integrations.isPending && <Loading />}
        <ErrorText error={integrations.error ?? disconnect.error} />
        {integrations.data && list.length === 0 && <p className="text-zinc-500 dark:text-zinc-400">None yet.</p>}
        <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {list.map((integration) => (
            <li key={integration.id} className="flex flex-wrap items-center gap-3 py-2">
              <span className="font-medium">{words(integration.kind)}</span>
              {!integration.active && <Pill>Off</Pill>}
              <code className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-500 dark:text-zinc-400">{origin + integration.webhook_path}</code>
              <CopyButton text={origin + integration.webhook_path} label="Copy address" />
              {integration.active && (
                <Button size="sm" variant="ghost" disabled={disconnect.isPending} onClick={() => disconnect.mutate(integration.id)}>
                  Disconnect
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Panel>
      <UnmatchedEvents />
    </div>
  );
}

function UnmatchedEvents() {
  const client = useQueryClient();
  const events = useQuery({ queryKey: ['integration-events'], queryFn: () => unwrap(api.GET('/integration-events', { params: { query: { limit: 50 } } })) });
  const [attaching, setAttaching] = useState<string | null>(null);
  const [threadId, setThreadId] = useState('');
  const [goalId, setGoalId] = useState('');
  const contactEmail = events.data?.data.find((event) => event.id === attaching)?.contact_email ?? null;
  const threads = useQuery({ queryKey: ['threads', 'for-sender', contactEmail], enabled: Boolean(contactEmail), queryFn: () => unwrap(api.GET('/threads', { params: { query: { q: contactEmail!, limit: 20 } } })) });
  const campaignId = threads.data?.data.find((thread) => thread.id === threadId)?.campaign.id;
  const goals = useQuery({ queryKey: ['campaign', campaignId, 'goals'], enabled: Boolean(campaignId), queryFn: () => unwrap(api.GET('/campaigns/{campaignId}/goals', { params: { path: { campaignId: campaignId! } } })) });
  const attach = useMutation({
    mutationFn: (eventId: string) => unwrap(api.POST('/integration-events/{eventId}/attach', { params: { path: { eventId } }, body: { thread_id: threadId, goal_id: goalId } })),
    onSuccess: () => {
      setAttaching(null);
      void client.invalidateQueries({ queryKey: ['integration-events'] });
      void client.invalidateQueries({ queryKey: ['threads'] });
    },
  });
  const UNMATCHED = new Set(['no_contact', 'no_goal', 'not_sent']);

  return (
    <Panel title="Recent events" description="Events that matched no thread can be filed under one by hand.">
      {events.isPending && <Loading />}
      <ErrorText error={events.error ?? attach.error} />
      {events.data && events.data.data.length === 0 && <p className="text-zinc-500 dark:text-zinc-400">No events received yet.</p>}
      <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
        {events.data?.data.map((event) => (
          <li key={event.id} className="space-y-2 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{event.source}</span>
              <span className="text-zinc-600 dark:text-zinc-400">{event.type}</span>
              <span>{event.contact_email ?? '–'}</span>
              {event.outcome && <Pill tone={event.outcome === 'matched' ? 'emerald' : UNMATCHED.has(event.outcome) ? 'amber' : 'zinc'}>{words(event.outcome)}</Pill>}
              <span className="ml-auto text-xs text-zinc-500 dark:text-zinc-400">{dateTime(event.received_at)}</span>
              {event.outcome && UNMATCHED.has(event.outcome) && event.contact_email && (
                <Button size="sm" variant="ghost" onClick={() => (setAttaching(attaching === event.id ? null : event.id), setThreadId(''), setGoalId(''))}>
                  Attach…
                </Button>
              )}
            </div>
            {attaching === event.id && (
              <form
                className="flex flex-wrap items-center gap-2"
                onSubmit={(submitted) => {
                  submitted.preventDefault();
                  attach.mutate(event.id);
                }}
              >
                <select aria-label="Thread" required value={threadId} onChange={(change) => (setThreadId(change.target.value), setGoalId(''))} className={cn(inputClass, 'w-auto py-1')}>
                  <option value="">The contact’s thread…</option>
                  {threads.data?.data.map((thread) => (
                    <option key={thread.id} value={thread.id}>
                      {thread.campaign.name} · {thread.stage_label}
                    </option>
                  ))}
                </select>
                <select aria-label="Goal" required value={goalId} onChange={(change) => setGoalId(change.target.value)} className={cn(inputClass, 'w-auto py-1')} disabled={!campaignId}>
                  <option value="">The goal it reached…</option>
                  {goals.data?.data.map((goal) => (
                    <option key={goal.id} value={goal.id}>
                      {goal.name}
                    </option>
                  ))}
                </select>
                <Button type="submit" size="sm" variant="primary" disabled={attach.isPending || !threadId || !goalId}>
                  Attach
                </Button>
                {threads.data && threads.data.data.length === 0 && <span className="text-zinc-500 dark:text-zinc-400">{event.contact_email} has no threads.</span>}
              </form>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
