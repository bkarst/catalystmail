'use client';

// Builder step 6, Sending (spec §15.10, §15.9 "Settings"): the mailboxes and their weights, the
// sending window and blackout dates, the daily limit and priority, tracking (with the
// deliverability note), compliance, and delivery grace.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';

import { api, unwrap, type Schemas } from '../../lib/api.ts';
import { cn } from '../../lib/cn.ts';
import { Button, ErrorText, inputClass, Pill } from '../ui.tsx';
import { Card, fieldClass, Labeled, useUpdateCampaign } from './common.tsx';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function SendingStep({ campaign }: { campaign: Schemas['Campaign'] }) {
  return (
    <div className="space-y-4">
      <Mailboxes campaign={campaign} />
      <Window campaign={campaign} />
    </div>
  );
}

function Mailboxes({ campaign }: { campaign: Schemas['Campaign'] }) {
  const client = useQueryClient();
  const mailboxes = useQuery({ queryKey: ['mailboxes', 'options'], queryFn: () => unwrap(api.GET('/mailboxes', { params: { query: { limit: 100 } } })) });
  const [chosen, setChosen] = useState<Record<string, number>>(() => Object.fromEntries(campaign.mailboxes.map((entry) => [entry.mailbox_id, entry.weight])));
  const save = useMutation({
    mutationFn: () => unwrap(api.PUT('/campaigns/{campaignId}/mailboxes', { params: { path: { campaignId: campaign.id } }, body: { mailboxes: Object.entries(chosen).map(([mailbox_id, weight]) => ({ mailbox_id, weight })) } })),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['campaign', campaign.id] }),
  });
  return (
    <Card title="6 · Sending: mailboxes" description="New conversations are spread across these by weight; a conversation stays on the mailbox it started on.">
      {mailboxes.data && mailboxes.data.data.length === 0 && (
        <p className="text-zinc-500 dark:text-zinc-400">
          No mailboxes yet.{' '}
          <Link href="/deliverability/mailboxes/new" className="underline">
            Add one
          </Link>
          .
        </p>
      )}
      <ul className="space-y-1">
        {mailboxes.data?.data.map((mailbox) => (
          <li key={mailbox.id} className="flex flex-wrap items-center gap-2">
            <label className="flex min-w-64 items-center gap-2">
              <input type="checkbox" checked={mailbox.id in chosen} onChange={(event) => setChosen(event.target.checked ? { ...chosen, [mailbox.id]: 1 } : Object.fromEntries(Object.entries(chosen).filter(([id]) => id !== mailbox.id)))} /> {mailbox.email}
            </label>
            {mailbox.status !== 'active' && <Pill tone="amber">{mailbox.status}</Pill>}
            {mailbox.id in chosen && (
              <label className="flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
                Weight
                <input type="number" min={1} max={100} value={chosen[mailbox.id]} onChange={(event) => setChosen({ ...chosen, [mailbox.id]: Number(event.target.value) })} className={cn(inputClass, 'w-16 py-0.5')} />
              </label>
            )}
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-3">
        <Button disabled={save.isPending || Object.keys(chosen).length === 0} onClick={() => save.mutate()}>
          Save mailboxes
        </Button>
        {save.isSuccess && (
          <span role="status" className="text-emerald-700 dark:text-emerald-400">
            Saved.
          </span>
        )}
      </div>
      <ErrorText error={save.error} />
    </Card>
  );
}

function Window({ campaign }: { campaign: Schemas['Campaign'] }) {
  const update = useUpdateCampaign(campaign.id);
  const window = campaign.sending_window as { days: number[]; start: string; end: string; fallback_tz?: string };
  const [form, setForm] = useState({
    days: window.days,
    start: window.start,
    end: window.end,
    blackout: campaign.blackout_dates.join(', '),
    daily: String(campaign.daily_new_threads_limit),
    priority: campaign.sending_priority,
    open_tracking: campaign.open_tracking,
    track_first_touch: campaign.track_first_touch,
    click_tracking: campaign.click_tracking,
    list_unsubscribe_header: campaign.list_unsubscribe_header,
    unsubscribe_footer: campaign.unsubscribe_footer,
    grace: String(campaign.delivery_grace_minutes),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    update.mutate({
      sending_window: { days: [...form.days].sort(), start: form.start, end: form.end, fallback_tz: window.fallback_tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone },
      blackout_dates: form.blackout.split(',').map((day) => day.trim()).filter(Boolean),
      daily_new_threads_limit: Number(form.daily),
      sending_priority: form.priority,
      open_tracking: form.open_tracking,
      track_first_touch: form.track_first_touch,
      click_tracking: form.click_tracking,
      list_unsubscribe_header: form.list_unsubscribe_header,
      unsubscribe_footer: form.unsubscribe_footer,
      delivery_grace_minutes: Number(form.grace),
    });
  };
  const box = (key: 'open_tracking' | 'track_first_touch' | 'click_tracking' | 'list_unsubscribe_header' | 'unsubscribe_footer', label: string) => (
    <label className="flex items-center gap-2">
      <input type="checkbox" checked={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.checked })} /> {label}
    </label>
  );
  return (
    <Card title="Window, volume, tracking and compliance">
      <form onSubmit={submit} className="space-y-4">
        <fieldset className="space-y-1">
          <legend className="text-xs text-zinc-500 dark:text-zinc-400">Sending window, in each contact’s own timezone</legend>
          <div className="flex flex-wrap items-center gap-2">
            {DAYS.map((day, index) => (
              <label key={day} className="flex items-center gap-1">
                <input type="checkbox" checked={form.days.includes(index + 1)} onChange={(event) => setForm({ ...form, days: event.target.checked ? [...form.days, index + 1] : form.days.filter((value) => value !== index + 1) })} /> {day}
              </label>
            ))}
            <input type="time" aria-label="From" value={form.start} onChange={(event) => setForm({ ...form, start: event.target.value })} className={cn(inputClass, 'w-auto py-1')} />
            to
            <input type="time" aria-label="Until" value={form.end} onChange={(event) => setForm({ ...form, end: event.target.value })} className={cn(inputClass, 'w-auto py-1')} />
          </div>
        </fieldset>
        <div className="flex flex-wrap gap-3">
          <Labeled label="Blackout dates (YYYY-MM-DD, comma-separated)" className="block">
            <input value={form.blackout} onChange={(event) => setForm({ ...form, blackout: event.target.value })} placeholder="2026-12-24, 2026-12-25" className={cn(inputClass, fieldClass, 'w-72')} />
          </Labeled>
          <Labeled label="New conversations a day" hint="All mailboxes together; the ramp and warm-up may allow fewer." className="block">
            <input type="number" min={1} max={500} value={form.daily} onChange={(event) => setForm({ ...form, daily: event.target.value })} className={cn(inputClass, fieldClass, 'w-24')} />
          </Labeled>
          <Labeled label="Priority when sharing mailboxes" className="block">
            <select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value as typeof form.priority })} className={cn(inputClass, fieldClass, 'w-auto')}>
              <option value="high">High</option>
              <option value="normal">Normal</option>
              <option value="low">Low</option>
            </select>
          </Labeled>
        </div>
        <fieldset className="space-y-1">
          <legend className="text-xs text-zinc-500 dark:text-zinc-400">Tracking</legend>
          {box('open_tracking', 'Track opens')}
          {form.open_tracking && box('track_first_touch', 'Track opens on the first email too')}
          {box('click_tracking', 'Track clicks')}
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Tracking pixels and rewritten links can hurt deliverability; click tracking is off by default.</p>
        </fieldset>
        <fieldset className="space-y-1">
          <legend className="text-xs text-zinc-500 dark:text-zinc-400">Compliance</legend>
          {box('list_unsubscribe_header', 'One-click unsubscribe headers')}
          {box('unsubscribe_footer', 'The footer with an unsubscribe link and the postal address')}
        </fieldset>
        <Labeled label="Delivery grace, minutes" hint="With no bounce after this long, an email counts as received." className="block">
          <input type="number" min={30} max={1440} value={form.grace} onChange={(event) => setForm({ ...form, grace: event.target.value })} className={cn(inputClass, fieldClass, 'w-24')} />
        </Labeled>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={update.isPending || form.days.length === 0}>
            Save
          </Button>
          {update.isSuccess && (
            <span role="status" className="text-emerald-700 dark:text-emerald-400">
              Saved.
            </span>
          )}
        </div>
        <ErrorText error={update.error} />
      </form>
    </Card>
  );
}
