'use client';

// Deliverability's shared pieces (spec §15.15): reputation and health bands, DNS check marks, the
// points each input cost (§8.10), and the reason dialog every admin change asks for (§8.3.6).

import { CheckCircle2, CircleAlert, CircleHelp, XCircle } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';

import { cn } from '../../lib/cn.ts';
import { percent } from '../../lib/format.ts';
import { Button, ErrorText, inputClass, Pill, type Tone } from '../ui.tsx';

const BAND: Record<string, { label: string; tone: Tone }> = {
  healthy: { label: 'Healthy', tone: 'emerald' },
  at_risk: { label: 'At risk ×0.75', tone: 'amber' },
  critical: { label: 'Critical ×0.5', tone: 'rose' },
  paused: { label: 'Paused', tone: 'rose' },
};

export function BandPill({ band, score }: { band: string; score?: number }) {
  const entry = BAND[band] ?? { label: band, tone: 'zinc' as const };
  return (
    <Pill tone={entry.tone}>
      {score !== undefined && <span className="tabular-nums">{score}</span>}
      {score !== undefined && ' · '}
      {entry.label}
    </Pill>
  );
}

export function CheckMark({ status, label }: { status: string | null | undefined; label: string }) {
  const icon =
    status === 'pass' ? <CheckCircle2 aria-hidden className="size-3.5 text-emerald-600" /> : status === 'warn' ? <CircleAlert aria-hidden className="size-3.5 text-amber-600" /> : status === 'fail' ? <XCircle aria-hidden className="size-3.5 text-rose-600" /> : <CircleHelp aria-hidden className="size-3.5 text-zinc-500 dark:text-zinc-400" />;
  return (
    <span className="inline-flex items-center gap-1" title={`${label}: ${status ?? 'not checked'}`}>
      {icon} {label}
      <span className="sr-only">: {status ?? 'not checked'}</span>
    </span>
  );
}

const POINT_LABEL: Record<string, string> = {
  hardBounces: 'Hard bounces',
  complaints: 'Complaints and Gmail spam rate',
  blocklist: 'Blocklists',
  authentication: 'SPF, DKIM and DMARC',
  junkReplies: 'Replies found in Junk',
  openRate: 'Open rate fell by half',
  providerQuota: 'Provider rate limits',
  recentErrors: 'Send or poll errors',
};

/** "Hard bounces 1.1% (7d) ........ −9" (§15.15). */
export function PointsLost({ inputs }: { inputs: Record<string, unknown> }) {
  const points = (inputs.points ?? {}) as Record<string, number>;
  const entries = Object.entries(points);
  if (entries.length === 0) return <p className="text-zinc-500 dark:text-zinc-400">Not computed yet: the score updates hourly once there is sending.</p>;
  const detail = (key: string) =>
    key === 'hardBounces' && typeof inputs.hard_bounce_rate === 'number' ? ` ${percent(inputs.hard_bounce_rate, 1)} (7d)` : key === 'complaints' && typeof inputs.complaint_rate === 'number' ? ` ${percent(inputs.complaint_rate, 2)}` : key === 'junkReplies' && typeof inputs.junk_replies_7d === 'number' ? ` ${inputs.junk_replies_7d} (2 needed to count)` : '';
  return (
    <dl className="grid max-w-md grid-cols-[1fr_auto] gap-x-4 gap-y-0.5">
      {entries.map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="text-zinc-600 dark:text-zinc-400">
            {POINT_LABEL[key] ?? key}
            {detail(key)}
          </dt>
          <dd className={cn('text-right tabular-nums', value > 0 && 'font-medium text-rose-700 dark:text-rose-300')}>{value > 0 ? `−${value}` : '0'}</dd>
        </div>
      ))}
    </dl>
  );
}

/** An admin change that needs a reason (§8.3.6): opens a small form, then runs. */
export function ReasonAction({ label, variant = 'secondary', children, onRun, pending, error, disabled }: { label: string; variant?: 'secondary' | 'danger' | 'primary'; children?: ReactNode; onRun: (reason: string) => void; pending: boolean; error: unknown; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  return (
    <span className="inline-flex flex-col gap-1">
      <Button size="sm" variant={open ? 'secondary' : 'ghost'} disabled={disabled} onClick={() => setOpen(!open)}>
        {label}
      </Button>
      {open && (
        <form
          className="flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] border border-zinc-200 p-2 dark:border-zinc-800"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            onRun(reason.trim());
          }}
        >
          {children}
          <input value={reason} onChange={(event) => setReason(event.target.value)} required minLength={3} maxLength={500} placeholder="Why (logged on the Events tab)" aria-label="Reason" className={cn(inputClass, 'w-72 py-1')} />
          <Button type="submit" size="sm" variant={variant} disabled={pending}>
            {label.replace('…', '')}
          </Button>
          <ErrorText error={error} />
        </form>
      )}
    </span>
  );
}

export const LIMIT_TEXT: Record<string, string> = {
  domain_ramp: 'the domain’s ramp step',
  domain_reputation: 'the domain’s reputation band',
  domain_auth: 'first emails paused: domain authentication fails',
  mailbox_cap: 'the mailbox’s daily limit or warm-up',
  mailbox_health: 'the mailbox’s health band',
  campaign_share: 'sharing mailboxes with other campaigns',
  campaign_limit: 'the campaign’s own daily limit',
};
