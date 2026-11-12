'use client';

// A campaign's Agent and Settings tabs (spec §15.9), read-only for now: editing comes with the
// builder (V7); updateCampaign changes them through the API today.

import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { api, unwrap, type Schemas } from '../../lib/api.ts';
import { percent, words } from '../../lib/format.ts';
import { Pill } from '../ui.tsx';
import { AUTONOMY } from './bits.tsx';

function Rows({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid max-w-3xl grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-[14rem_1fr]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-zinc-500 dark:text-zinc-400">{label}</dt>
          <dd>{value ?? <span className="text-zinc-500 dark:text-zinc-400">–</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

const NOT_INTERESTED: Record<string, string> = { close_silently: 'Close the thread without replying', send_polite_close: 'Send a short polite reply, then close' };
const DAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function AgentTab({ campaign }: { campaign: Schemas['Campaign'] }) {
  const persona = campaign.persona as Record<string, string | null>;
  const links = Object.entries(campaign.links as Record<string, string>);
  if (campaign.agent_mode === 'external')
    return <p className="max-w-3xl text-zinc-600 dark:text-zinc-400">This campaign uses its own agent through the API or MCP (§10.7): the built-in agent writes nothing. Replies and due follow-ups appear in Needs you for it, and Jev still classifies each reply.</p>;
  return (
    <Rows
      rows={[
        [
          'Autonomy',
          <>
            <span className="font-medium">{words(campaign.autonomy)}</span>
            <span className="block text-zinc-600 dark:text-zinc-400">{AUTONOMY[campaign.autonomy]}</span>
          </>,
        ],
        ['Sends on its own from', percent(campaign.auto_send_min_confidence) + ' confidence'],
        ['Confirms goals on its own from', percent(campaign.goal_auto_confirm_threshold) + ' probability'],
        ['Sender', persona.sender_role ?? null],
        ['Tone', persona.tone ?? null],
        ['Language', persona.language ?? null],
        ['Sign-off', persona.sign_off ?? null],
        ['Style notes', persona.style_notes ?? null],
        ['Instructions', campaign.agent_instructions ? <span className="whitespace-pre-wrap">{campaign.agent_instructions}</span> : null],
        [
          'Allowed links',
          links.length ? (
            <ul>
              {links.map(([key, url]) => (
                <li key={key}>
                  <code className="text-xs">{key}</code> {url}
                </li>
              ))}
            </ul>
          ) : null,
        ],
        ['Reply delay', `${campaign.reply_delay_min_minutes}–${campaign.reply_delay_max_minutes} minutes`],
        ['AI replies per thread', `at most ${campaign.max_ai_replies_per_thread}`],
        ['When you reply yourself', campaign.pause_on_manual_reply ? 'The agent stands back on that thread' : 'The agent carries on'],
        ['“Not interested”', NOT_INTERESTED[campaign.on_not_interested] ?? words(campaign.on_not_interested)],
        ['Review first personalized emails', campaign.review_first_n_personalized > 0 ? `the first ${campaign.review_first_n_personalized}` : 'none'],
      ]}
    />
  );
}

export function SettingsTab({ campaign }: { campaign: Schemas['Campaign'] }) {
  const mailboxes = useQuery({ queryKey: ['mailboxes', 'options'], queryFn: () => unwrap(api.GET('/mailboxes', { params: { query: { limit: 100 } } })), staleTime: 300_000 });
  const window = campaign.sending_window as { days: number[]; start: string; end: string; fallback_tz?: string };
  const rules = campaign.enrollment_rules as { skip_active_elsewhere?: boolean; cooldown_days?: number; allow_role_accounts?: boolean; allow_risky?: boolean };
  const on = (value: boolean | undefined) => (value ? 'On' : 'Off');
  return (
    <Rows
      rows={[
        [
          'Mailboxes',
          campaign.mailboxes.length ? (
            <ul>
              {campaign.mailboxes.map((entry) => (
                <li key={entry.mailbox_id}>
                  {mailboxes.data?.data.find((mailbox) => mailbox.id === entry.mailbox_id)?.email ?? entry.mailbox_id} <span className="text-zinc-500 dark:text-zinc-400">· weight {entry.weight}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Pill tone="rose">None</Pill>
          ),
        ],
        ['Sending priority', words(campaign.sending_priority)],
        ['Sending window', `${window.days.map((day) => DAYS[day]).join(', ')} · ${window.start}–${window.end} in the contact’s timezone${window.fallback_tz ? ` (else ${window.fallback_tz})` : ''}`],
        ['Blackout dates', campaign.blackout_dates.length ? campaign.blackout_dates.join(', ') : 'none'],
        ['New threads a day', campaign.daily_new_threads_limit],
        ['Open tracking', `${on(campaign.open_tracking)}${campaign.open_tracking && !campaign.track_first_touch ? ', except the first email' : ''}`],
        ['Click tracking', on(campaign.click_tracking)],
        ['List-Unsubscribe header', on(campaign.list_unsubscribe_header)],
        ['Compliance footer', on(campaign.unsubscribe_footer)],
        ['Skip contacts active elsewhere', on(rules.skip_active_elsewhere)],
        ['Cooldown after another campaign', rules.cooldown_days !== undefined ? `${rules.cooldown_days} days` : null],
        ['Role accounts (info@, sales@)', rules.allow_role_accounts ? 'Allowed' : 'Skipped'],
        ['Risky addresses', rules.allow_risky ? 'Allowed' : 'Skipped'],
        ['Delivery grace', `${campaign.delivery_grace_minutes} minutes without a bounce counts as received`],
        ['Wait when a stage has no follow-ups', `${campaign.final_wait_business_days} business days`],
      ]}
    />
  );
}
