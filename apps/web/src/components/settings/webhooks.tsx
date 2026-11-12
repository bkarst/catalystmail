'use client';

// Settings → Webhooks (spec §15.18, §13.6): endpoints with the events they receive; add one (its
// signing secret is shown once), send a test, turn it off or on, change its events, delete it; and
// each endpoint's delivery log with redelivery.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { api, idempotencyKey, unwrap, type Schemas } from '../../lib/api.ts';
import { cn } from '../../lib/cn.ts';
import { dateTime, words } from '../../lib/format.ts';
import { Button, ErrorText, inputClass, Loading, Pill } from '../ui.tsx';
import { Field, Panel } from './common.tsx';
import { CopyButton } from './integrations.tsx';

type Endpoint = Schemas['WebhookEndpoint'];

/** Every event type, from the OpenAPI document's webhooks (one per event, §13.6). */
function useEventTypes() {
  return useQuery({
    queryKey: ['openapi', 'webhook-events'],
    staleTime: Infinity,
    queryFn: async () => {
      const document = (await unwrap(api.GET('/openapi.json'))) as { webhooks?: Record<string, { post?: { description?: string; summary?: string } }> };
      return Object.entries(document.webhooks ?? {}).map(([type, item]) => ({ type, description: item.post?.summary ?? item.post?.description ?? '' }));
    },
  });
}

function EventPicker({ value, onChange }: { value: string[]; onChange: (events: string[]) => void }) {
  const types = useEventTypes();
  if (types.isPending) return <Loading />;
  return (
    <fieldset className="grid max-h-56 grid-cols-1 gap-x-4 gap-y-1 overflow-y-auto rounded-[var(--radius-card)] border border-zinc-200 p-2 sm:grid-cols-2 dark:border-zinc-800">
      <legend className="px-1 text-zinc-600 dark:text-zinc-400">Events</legend>
      {(types.data ?? []).map((entry) => (
        <label key={entry.type} className="flex items-start gap-1.5" title={entry.description}>
          <input type="checkbox" className="mt-1" checked={value.includes(entry.type)} onChange={(event) => onChange(event.target.checked ? [...value, entry.type] : value.filter((type) => type !== entry.type))} />
          <span>
            <code className="text-xs">{entry.type}</code>
            {entry.description && <span className="block text-xs text-zinc-500 dark:text-zinc-400">{entry.description}</span>}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

export function WebhooksSection() {
  const client = useQueryClient();
  const endpoints = useQuery({ queryKey: ['webhooks'], queryFn: () => unwrap(api.GET('/webhooks', { params: { query: { limit: 100 } } })) });
  const [form, setForm] = useState({ url: '', description: '', events: [] as string[] });
  const [secret, setSecret] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => unwrap(api.POST('/webhooks', { params: { header: idempotencyKey() }, body: { url: form.url.trim(), ...(form.description.trim() && { description: form.description.trim() }), events: form.events as Endpoint['events'] } })),
    onSuccess: (endpoint) => {
      setSecret(endpoint.secret);
      setForm({ url: '', description: '', events: [] });
      void client.invalidateQueries({ queryKey: ['webhooks'] });
    },
  });

  return (
    <div className="space-y-4">
      <Panel title="Add an endpoint" description="Events are POSTed as signed JSON. Check the Catalyst-Signature header with the endpoint’s secret.">
        <form
          className="space-y-2"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <Field label="URL" hint="https, on a public address.">
            <input type="url" required pattern="https://.*" value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} className={inputClass} placeholder="https://hooks.example.com/catalyst" />
          </Field>
          <Field label="What it’s for (optional)">
            <input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} className={inputClass} maxLength={200} />
          </Field>
          <EventPicker value={form.events} onChange={(events) => setForm({ ...form, events })} />
          <Button type="submit" variant="primary" disabled={create.isPending || form.events.length === 0}>
            Add endpoint
          </Button>
        </form>
        <ErrorText error={create.error} />
        {secret && (
          <p role="status" className="flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950">
            Signing secret, shown only now: <code className="break-all font-mono text-xs">{secret}</code> <CopyButton text={secret} />
          </p>
        )}
      </Panel>
      <Panel title="Endpoints">
        {endpoints.isPending && <Loading />}
        <ErrorText error={endpoints.error} onRetry={() => void endpoints.refetch()} />
        {endpoints.data && endpoints.data.data.length === 0 && <p className="text-zinc-500 dark:text-zinc-400">None yet.</p>}
        <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {endpoints.data?.data.map((endpoint) => (
            <EndpointRow key={endpoint.id} endpoint={endpoint} />
          ))}
        </ul>
      </Panel>
    </div>
  );
}

function EndpointRow({ endpoint }: { endpoint: Endpoint }) {
  const client = useQueryClient();
  const [open, setOpen] = useState<'log' | 'events' | 'delete' | null>(null);
  const [events, setEvents] = useState<string[]>(endpoint.events);
  const endpointId = endpoint.id;
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['webhooks'] });
    void client.invalidateQueries({ queryKey: ['webhook-deliveries', endpointId] });
  };
  const update = useMutation({ mutationFn: (body: { active?: boolean; events?: Endpoint['events'] }) => unwrap(api.PATCH('/webhooks/{endpointId}', { params: { path: { endpointId } }, body })), onSuccess: () => (setOpen(null), refresh()) });
  const test = useMutation({ mutationFn: () => unwrap(api.POST('/webhooks/{endpointId}/test', { params: { path: { endpointId } } })), onSuccess: () => (setOpen('log'), refresh()) });
  const remove = useMutation({ mutationFn: () => unwrap(api.DELETE('/webhooks/{endpointId}', { params: { path: { endpointId } } })), onSuccess: refresh });

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 truncate font-mono text-xs">{endpoint.url}</code>
        {endpoint.active ? <Pill tone="emerald">On</Pill> : <Pill tone={endpoint.disabled_at ? 'rose' : 'zinc'}>{endpoint.disabled_at ? 'Turned off after failures' : 'Off'}</Pill>}
        {endpoint.consecutive_failures > 0 && <Pill tone="amber">{endpoint.consecutive_failures} failures</Pill>}
      </div>
      {endpoint.description && <p className="text-zinc-600 dark:text-zinc-400">{endpoint.description}</p>}
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{endpoint.events.join(', ')}</p>
      <div className="flex flex-wrap gap-1">
        <Button size="sm" disabled={test.isPending} onClick={() => test.mutate()}>
          Send a test
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(open === 'log' ? null : 'log')}>
          Deliveries
        </Button>
        <Button size="sm" variant="ghost" onClick={() => (setEvents(endpoint.events), setOpen(open === 'events' ? null : 'events'))}>
          Change events
        </Button>
        <Button size="sm" variant="ghost" disabled={update.isPending} onClick={() => update.mutate({ active: !endpoint.active })}>
          {endpoint.active ? 'Turn off' : 'Turn on'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(open === 'delete' ? null : 'delete')}>
          Delete…
        </Button>
      </div>
      <ErrorText error={update.error ?? test.error ?? remove.error} />
      {open === 'events' && (
        <div className="space-y-2">
          <EventPicker value={events} onChange={setEvents} />
          <Button size="sm" variant="primary" disabled={update.isPending || events.length === 0} onClick={() => update.mutate({ events: events as Endpoint['events'] })}>
            Save events
          </Button>
        </div>
      )}
      {open === 'delete' && (
        <p className="flex flex-wrap items-center gap-2">
          Delete this endpoint and its delivery log?
          <Button size="sm" variant="danger" disabled={remove.isPending} onClick={() => remove.mutate()}>
            Delete
          </Button>
        </p>
      )}
      {open === 'log' && <Deliveries endpointId={endpointId} />}
    </li>
  );
}

function Deliveries({ endpointId }: { endpointId: string }) {
  const client = useQueryClient();
  const deliveries = useQuery({ queryKey: ['webhook-deliveries', endpointId], queryFn: () => unwrap(api.GET('/webhooks/{endpointId}/deliveries', { params: { path: { endpointId }, query: { limit: 50 } } })), refetchInterval: 15_000 });
  const redeliver = useMutation({ mutationFn: (deliveryId: string) => unwrap(api.POST('/webhook-deliveries/{deliveryId}/redeliver', { params: { path: { deliveryId } } })), onSuccess: () => client.invalidateQueries({ queryKey: ['webhook-deliveries', endpointId] }) });
  if (deliveries.isPending) return <Loading />;
  if (deliveries.isError) return <ErrorText error={deliveries.error} onRetry={() => void deliveries.refetch()} />;
  if (deliveries.data.data.length === 0) return <p className="text-zinc-500 dark:text-zinc-400">No deliveries yet.</p>;
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead className="uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          <tr>
            {['Event', 'Status', 'Answer', 'Attempts', 'Queued', ''].map((heading) => (
              <th key={heading} className="py-1 pr-3 font-medium">
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {deliveries.data.data.map((delivery) => (
            <tr key={delivery.id} className="border-t border-zinc-200 dark:border-zinc-800">
              <td className="py-1 pr-3 font-mono">{delivery.event_type}</td>
              <td className="pr-3">
                <Pill tone={delivery.status === 'delivered' ? 'emerald' : delivery.status === 'failed' ? 'rose' : 'zinc'}>{words(delivery.status)}</Pill>
              </td>
              <td className={cn('max-w-64 truncate pr-3', delivery.status === 'failed' && 'text-rose-700 dark:text-rose-300')} title={delivery.response_snippet ?? undefined}>
                {delivery.response_status ?? '–'} {delivery.response_snippet}
              </td>
              <td className="pr-3 tabular-nums">{delivery.attempt}</td>
              <td className="pr-3">{dateTime(delivery.created_at)}</td>
              <td>
                {delivery.status !== 'pending' && (
                  <Button size="sm" variant="ghost" disabled={redeliver.isPending} onClick={() => redeliver.mutate(delivery.id)}>
                    Redeliver
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ErrorText error={redeliver.error} />
    </div>
  );
}
