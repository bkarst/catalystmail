'use client';

// Live views (spec §4.2, §15.20): the shell follows `/events/stream` (server-sent events named by
// activity type, §22.C) and refreshes the queries each event touches, batched, so pages update as
// replies arrive and things change. New replies and escalations are announced in a polite live
// region with a link. EventSource reconnects on its own, resuming from the last event ID.

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import type { Schemas } from './api.ts';

const TYPES = [
  'thread.enrolled', 'thread.paused', 'thread.resumed', 'thread.closed', 'thread.stage_floor_set', 'thread.stage_changed', 'thread.state_changed', 'thread.classified', 'thread.classification_fallback', 'thread.assigned', 'thread.ai_paused', 'thread.ai_resumed',
  'message.composed', 'message.pending_approval', 'message.approved', 'message.rejected', 'message.scheduled', 'message.sent', 'message.failed', 'message.bounced', 'message.received', 'message.opened', 'message.clicked', 'message.edited', 'message.cancelled', 'message.attached', 'message.ignored', 'message.send_retried',
  'goal.achieved', 'goal.revoked',
  'escalation.created', 'escalation.resolved', 'escalation.sla_breached', 'escalation.snoozed', 'escalation.assigned',
  'follow_up.scheduled', 'follow_up.cancelled', 'follow_up.skipped', 'follow_up.sequence_switched', 'follow_up.sequence_finished', 'follow_up.stopped', 'follow_up.resumed', 'follow_up.check_in_scheduled', 'follow_up.check_in_cancelled',
  'contact.created', 'contact.unsubscribe_undone', 'contact.updated', 'contact.deleted', 'contact.merged', 'contact.unsubscribed', 'contact.erased', 'contact.note_added',
  'campaign.created', 'campaign.launched', 'campaign.paused', 'campaign.resumed', 'campaign.archived', 'campaign.breaker_tripped', 'campaign.priority_changed',
  'mailbox.paused', 'mailbox.resumed', 'mailbox.warmup_held', 'mailbox.connection_tested', 'mailbox.poll_failed', 'mailbox.health_changed',
  'domain.delisted', 'domain.dns_changed', 'domain.reputation_changed', 'domain.ramp_advanced', 'domain.ramp_held', 'domain.ramp_resumed', 'domain.ramp_stepped_back', 'domain.ramp_plan_changed', 'domain.cap_overridden', 'domain.first_touches_resumed', 'domain.postmaster_disconnected',
  'deliverability.junk_reply', 'deliverability.breaker_tripped', 'knowledge.created_from_escalation', 'ai.budget_warning', 'ai.budget_exhausted',
];

type Notice = { id: string; text: string; href: string };

/** The query keys an activity touches. */
function keysFor(activity: Schemas['Activity']): unknown[][] {
  const [area] = activity.type.split('.');
  const keys: unknown[][] = [];
  if (activity.thread_id) keys.push(['thread', activity.thread_id], ['threads']);
  if (activity.contact_id) keys.push(['contact', activity.contact_id], ['contacts']);
  if (activity.campaign_id) keys.push(['campaign', activity.campaign_id], ['campaigns']);
  if (area === 'thread' || area === 'message' || area === 'goal' || area === 'follow_up') keys.push(['threads'], ['work-queue']);
  if (area === 'escalation') keys.push(['escalations'], ['work-queue']);
  if (area === 'message' && activity.thread_id === null) keys.push(['unmatched'], ['work-queue']);
  if (area === 'domain' || area === 'mailbox' || area === 'deliverability' || activity.type === 'campaign.breaker_tripped') keys.push(['deliverability'], ['domain'], ['mailbox'], ['capacity'], ['activities'], ['work-queue']);
  if (area === 'knowledge') keys.push(['knowledge']);
  if (area === 'ai') keys.push(['settings']);
  keys.push(['analytics']);
  return keys;
}

export function useLiveUpdates(enabled: boolean): Notice[] {
  const client = useQueryClient();
  const [notices, setNotices] = useState<Notice[]>([]);
  const pending = useRef(new Map<string, unknown[]>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return;
    const source = new EventSource('/api/v1/events/stream', { withCredentials: true });
    const flush = () => {
      timer.current = null;
      for (const key of pending.current.values()) void client.invalidateQueries({ queryKey: key });
      pending.current.clear();
    };
    const onEvent = (event: MessageEvent<string>) => {
      let activity: Schemas['Activity'];
      try {
        activity = JSON.parse(event.data) as Schemas['Activity'];
      } catch {
        return;
      }
      for (const key of keysFor(activity)) pending.current.set(JSON.stringify(key), key);
      timer.current ??= setTimeout(flush, 500);
      if (activity.type === 'message.received' && activity.thread_id) {
        setNotices((list) => [...list.slice(-2), { id: activity.id, text: 'A new reply arrived', href: `/threads/${activity.thread_id}` }]);
      } else if (activity.type === 'escalation.created') {
        setNotices((list) => [...list.slice(-2), { id: activity.id, text: 'Something new needs you', href: activity.thread_id ? `/threads/${activity.thread_id}` : '/needs-you' }]);
      }
    };
    for (const type of TYPES) source.addEventListener(type, onEvent);
    return () => {
      for (const type of TYPES) source.removeEventListener(type, onEvent);
      source.close();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [enabled, client]);

  // Each notice goes after 8 seconds.
  useEffect(() => {
    if (notices.length === 0) return;
    const timeout = setTimeout(() => setNotices((list) => list.slice(1)), 8000);
    return () => clearTimeout(timeout);
  }, [notices]);
  return notices;
}

export function LiveNotices({ notices }: { notices: Notice[] }) {
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-40 flex flex-col gap-2">
      {notices.map((notice) => (
        <Link key={notice.id} href={notice.href} className="pointer-events-auto rounded-[var(--radius-card)] border border-indigo-200 bg-white px-3 py-2 shadow-md hover:bg-indigo-50 dark:border-indigo-900 dark:bg-zinc-950 dark:hover:bg-indigo-950">
          {notice.text} →
        </Link>
      ))}
    </div>
  );
}
