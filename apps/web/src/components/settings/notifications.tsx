'use client';

// Settings → Notifications (spec §15.18, §11.2): browser alerts for this person (the service
// worker in /sw.js shows them), their email preferences, and for owners and admins the workspace's
// Slack webhook and quiet hours.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { api, unwrap } from '../../lib/api.ts';
import { cn } from '../../lib/cn.ts';
import { ago } from '../../lib/format.ts';
import { usePerson } from '../../lib/person.tsx';
import { Button, ErrorText, inputClass, Loading } from '../ui.tsx';
import { Field, Panel, Saved, useSettings, useUpdateSettings } from './common.tsx';

/** The VAPID key as `pushManager.subscribe` wants it. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

export function NotificationsSection() {
  const person = usePerson();
  return (
    <div className="space-y-4">
      <BrowserAlerts />
      <EmailPreferences />
      {person.can('settings:manage') && <WorkspaceAlerts />}
    </div>
  );
}

function BrowserAlerts() {
  const client = useQueryClient();
  const push = useQuery({ queryKey: ['me', 'push'], queryFn: () => unwrap(api.GET('/me/push')) });
  const supported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const [permission, setPermission] = useState<string>(() => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission));
  const subscribe = useMutation({
    mutationFn: async () => {
      const key = push.data?.vapid_public_key;
      if (!key) throw new Error('Push isn’t set up on this server.');
      const granted = await Notification.requestPermission();
      setPermission(granted);
      if (granted !== 'granted') throw new Error('The browser didn’t allow notifications. Allow them for this site in its settings, then try again.');
      const registration = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      const subscription = existing ?? (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }));
      const json = subscription.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      return unwrap(api.POST('/me/push/subscriptions', { body: { endpoint: json.endpoint, keys: json.keys } }));
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['me', 'push'] }),
  });
  const remove = useMutation({
    mutationFn: (subscriptionId: string) => unwrap(api.DELETE('/me/push/subscriptions/{subscriptionId}', { params: { path: { subscriptionId } } })),
    onSuccess: () => client.invalidateQueries({ queryKey: ['me', 'push'] }),
  });

  return (
    <Panel title="Browser alerts" description="Urgent and high alerts (escalations, breaker trips, failing polls) appear as notifications in the browsers you turn them on in. High ones wait out quiet hours.">
      {push.isPending && <Loading />}
      <ErrorText error={push.error} onRetry={() => void push.refetch()} />
      {push.data && !push.data.vapid_public_key && <p className="text-zinc-500 dark:text-zinc-400">Push isn’t set up on this server: it needs VAPID keys (`catalyst vapid-keys`).</p>}
      {push.data?.vapid_public_key &&
        (supported ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" disabled={subscribe.isPending || permission === 'denied'} onClick={() => subscribe.mutate()}>
              <BellRing aria-hidden className="size-4" /> Turn on alerts in this browser
            </Button>
            {permission === 'denied' && <span className="text-zinc-500 dark:text-zinc-400">Notifications are blocked for this site in the browser’s settings.</span>}
          </div>
        ) : (
          <p className="text-zinc-500 dark:text-zinc-400">This browser can’t show push notifications.</p>
        ))}
      <ErrorText error={subscribe.error ?? remove.error} />
      {push.data && push.data.subscriptions.length > 0 && (
        <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {push.data.subscriptions.map((subscription) => (
            <li key={subscription.id} className="flex items-center gap-3 py-2">
              <span className="min-w-0 flex-1 truncate" title={subscription.user_agent ?? undefined}>
                {subscription.user_agent ?? subscription.endpoint_host}
                <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                  Since {ago(subscription.created_at)} · {subscription.last_sent_at ? `last alert ${ago(subscription.last_sent_at)}` : 'no alerts yet'}
                </span>
              </span>
              <Button size="sm" variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate(subscription.id)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function EmailPreferences() {
  const person = usePerson();
  const client = useQueryClient();
  const may = person.can('settings:manage');
  const users = useQuery({ queryKey: ['users'], enabled: may, queryFn: () => unwrap(api.GET('/users', { params: { query: { limit: 100 } } })) });
  const me = users.data?.data.find((user) => user.id === person.id);
  const change = useMutation({
    mutationFn: (notifications: { email?: boolean; digest?: boolean }) => unwrap(api.PATCH('/users/{userId}', { params: { path: { userId: person.id } }, body: { notifications } })),
    onSuccess: () => client.invalidateQueries({ queryKey: ['users'] }),
  });
  return (
    <Panel title="Email" description="Alerts go to the person an escalation is assigned to, or else to the owners and admins.">
      {!may ? (
        <p className="text-zinc-500 dark:text-zinc-400">An owner or admin can change which mail you get (Settings → Team).</p>
      ) : !me ? (
        <Loading />
      ) : (
        <div className="space-y-1">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={me.notifications.email} disabled={change.isPending} onChange={(event) => change.mutate({ email: event.target.checked })} /> Alerts by email
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={me.notifications.digest} disabled={change.isPending} onChange={(event) => change.mutate({ digest: event.target.checked })} /> The daily digest
          </label>
        </div>
      )}
      <ErrorText error={change.error} />
    </Panel>
  );
}

function WorkspaceAlerts() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const [slack, setSlack] = useState('');
  // Starts from the settings once, so a refetch never overwrites what is being typed.
  const quietFrom = (hours: { start: string; end: string } | null | undefined) => (hours ? { on: true, start: hours.start, end: hours.end } : { on: false, start: '20:00', end: '07:00' });
  const [quiet, setQuiet] = useState<{ on: boolean; start: string; end: string }>(() => quietFrom(settings.data?.notifications.quiet_hours));
  const [saved, setSaved] = useState<string | null>(null);
  const filled = useRef(Boolean(settings.data));
  useEffect(() => {
    if (!settings.data || filled.current) return;
    filled.current = true;
    setQuiet(quietFrom(settings.data.notifications.quiet_hours));
  }, [settings.data]);
  if (settings.isPending) return <Loading />;
  if (settings.isError) return <ErrorText error={settings.error} />;
  const configured = settings.data.notifications.slack_configured;
  const save = (notifications: { slack_webhook_url?: string | null; quiet_hours?: { start: string; end: string } | null }, what: string) => {
    setSaved(null);
    update.mutate({ notifications }, { onSuccess: () => (setSaved(what), setSlack('')) });
  };

  return (
    <Panel title="Workspace alerts">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          save({ slack_webhook_url: slack.trim() }, 'slack');
        }}
      >
        <Field label={`Slack incoming webhook${configured ? ' (set)' : ''}`} hint="Alerts are posted there too. The URL is stored encrypted and never shown again.">
          <input type="url" required pattern="https://.*" value={slack} onChange={(event) => setSlack(event.target.value)} placeholder={configured ? 'Paste a new URL to replace it' : 'https://hooks.slack.com/services/…'} className={cn(inputClass, 'w-96')} />
        </Field>
        <Button type="submit" disabled={update.isPending}>
          Save
        </Button>
        {configured && (
          <Button variant="ghost" disabled={update.isPending} onClick={() => save({ slack_webhook_url: null }, 'slack')}>
            Stop posting to Slack
          </Button>
        )}
        <Saved show={saved === 'slack'} />
      </form>
      <form
        className="space-y-2"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          save({ quiet_hours: quiet.on ? { start: quiet.start, end: quiet.end } : null }, 'quiet');
        }}
      >
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={quiet.on} onChange={(event) => setQuiet({ ...quiet, on: event.target.checked })} /> Quiet hours: high alerts wait until they end; urgent ones still go
        </label>
        {quiet.on && (
          <div className="flex items-center gap-2">
            <input type="time" aria-label="Quiet from" value={quiet.start} onChange={(event) => setQuiet({ ...quiet, start: event.target.value })} className={cn(inputClass, 'w-auto')} />
            to
            <input type="time" aria-label="Quiet until" value={quiet.end} onChange={(event) => setQuiet({ ...quiet, end: event.target.value })} className={cn(inputClass, 'w-auto')} />
            <span className="text-xs text-zinc-500 dark:text-zinc-400">workspace time</span>
          </div>
        )}
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={update.isPending}>
            Save quiet hours
          </Button>
          <Saved show={saved === 'quiet'} />
        </div>
      </form>
      <ErrorText error={update.error} />
    </Panel>
  );
}
