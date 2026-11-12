'use client';

// A campaign's Overview (spec §15.9): the funnel with step conversion, the emails (opens by people,
// replies, bounces), each step and A/B variant, goals and their value, the Sending pace card, and
// threads by state. The period is the whole campaign or the last 7 or 30 days.

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';

import { api, unwrap, type Schemas } from '../../lib/api.ts';
import { cn } from '../../lib/cn.ts';
import { percent, THREAD_STATE, words } from '../../lib/format.ts';
import { ErrorText, inputClass, Loading } from '../ui.tsx';
import { LIMIT_TEXT } from '../deliverability/bits.tsx';
import { money } from './bits.tsx';


export function Overview({ campaign }: { campaign: Schemas['Campaign'] }) {
  const [days, setDays] = useState<number | null>(null);
  const campaignId = campaign.id;
  const stats = useQuery({
    queryKey: ['campaign', campaignId, 'stats', days],
    queryFn: () => unwrap(api.GET('/campaigns/{campaignId}/stats', { params: { path: { campaignId }, query: days ? { days } : {} } })),
  });
  const capacity = useQuery({ queryKey: ['capacity', campaignId], enabled: campaign.status === 'active', queryFn: () => unwrap(api.GET('/capacity', { params: { query: { campaign_id: campaignId } } })), retry: false });
  const pace = capacity.data?.campaigns.find((entry) => entry.campaign_id === campaignId);
  // Held by the ramp: say so when an admin is holding a ramp this campaign sends through (§8.3.2).
  const domains = useQuery({ queryKey: ['domains'], enabled: pace?.limited_by === 'domain_ramp', queryFn: () => unwrap(api.GET('/domains', { params: { query: { limit: 100 } } })) });
  const feeding = new Set((capacity.data?.mailboxes ?? []).filter((mailbox) => mailbox.campaigns.some((entry) => entry.campaign_id === campaignId)).map((mailbox) => mailbox.domain_id));
  const rampHeld = (domains.data?.data ?? []).some((domain) => feeding.has(domain.id) && domain.ramp.manual_hold);

  if (stats.isPending) return <Loading />;
  if (stats.isError) return <ErrorText error={stats.error} onRetry={() => void stats.refetch()} />;
  const data = stats.data;
  const top = data.funnel[0]?.count ?? 0;

  return (
    <div className="space-y-6">
      <label className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
        Period
        <select value={days ?? ''} onChange={(event) => setDays(event.target.value ? Number(event.target.value) : null)} className={cn(inputClass, 'w-auto py-1')}>
          <option value="">Whole campaign</option>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
        </select>
      </label>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Funnel" className="lg:col-span-2">
          <ol className="space-y-2">
            {data.funnel.map((stage, index) => (
              <li key={stage.key} className="grid grid-cols-[8rem_1fr_6rem] items-center gap-3">
                <span className="truncate">{stage.name}</span>
                <span aria-hidden className="h-3 rounded-sm bg-zinc-100 dark:bg-zinc-900">
                  <span className="block h-3 rounded-sm bg-indigo-500" style={{ width: `${top ? Math.round((stage.count / top) * 100) : 0}%` }} />
                </span>
                <span className="text-right tabular-nums">
                  {stage.count}
                  {index > 0 && <span className="ml-1 text-xs text-zinc-500 dark:text-zinc-400">{percent(stage.conversion)}</span>}
                </span>
              </li>
            ))}
          </ol>
        </Card>

        <Card title="Sending pace">
          {campaign.status !== 'active' ? (
            <p className="text-zinc-500 dark:text-zinc-400">Pace shows while the campaign is active.</p>
          ) : capacity.isPending ? (
            <Loading />
          ) : capacity.isError ? (
            <ErrorText error={capacity.error} onRetry={() => void capacity.refetch()} />
          ) : !pace ? (
            // Only campaigns with threads waiting for their first email are in today's plan (§8.3.3).
            <p className="text-zinc-500 dark:text-zinc-400">Every enrolled contact has had their first email, so this campaign takes no new sends today.</p>
          ) : (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="text-zinc-500 dark:text-zinc-400">Wanted</dt>
              <dd className="tabular-nums">{pace.wants} a day</dd>
              <dt className="text-zinc-500 dark:text-zinc-400">Allocated today</dt>
              <dd className="tabular-nums">{pace.alloc}</dd>
              <dt className="text-zinc-500 dark:text-zinc-400">Sent today</dt>
              <dd className="tabular-nums">{pace.used}</dd>
              <dt className="text-zinc-500 dark:text-zinc-400">Waiting</dt>
              <dd className="tabular-nums">{pace.waiting}</dd>
              <dt className="text-zinc-500 dark:text-zinc-400">Held by</dt>
              <dd>
                {LIMIT_TEXT[pace.limited_by] ?? words(pace.limited_by)}
                {pace.limited_by === 'domain_ramp' && rampHeld && ' (held by an admin)'}
              </dd>
              <dt className="text-zinc-500 dark:text-zinc-400">Finishes</dt>
              <dd>{pace.finishes_on ? new Date(`${pace.finishes_on}T12:00:00`).toLocaleDateString(undefined, { dateStyle: 'medium' }) : 'Not at today’s pace'}</dd>
            </dl>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Emails">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-zinc-500 dark:text-zinc-400">Sent</dt>
            <dd className="tabular-nums">{data.emails.sent}</dd>
            <dt className="text-zinc-500 dark:text-zinc-400">Opened by a person</dt>
            <dd className="tabular-nums">
              {data.emails.opened} <span className="text-zinc-500 dark:text-zinc-400">({percent(data.emails.open_rate, 1)})</span>
            </dd>
            <dt className="text-zinc-500 dark:text-zinc-400">Replied</dt>
            <dd className="tabular-nums">
              {data.emails.replies} <span className="text-zinc-500 dark:text-zinc-400">({percent(data.emails.reply_rate, 1)})</span>
            </dd>
            <dt className="text-zinc-500 dark:text-zinc-400">Bounced</dt>
            <dd className={cn('tabular-nums', data.emails.bounce_rate > 0.03 && 'text-rose-700 dark:text-rose-300')}>
              {data.emails.bounced} <span className="text-zinc-500 dark:text-zinc-400">({percent(data.emails.bounce_rate, 1)})</span>
            </dd>
          </dl>
        </Card>
        <Card title="Goals">
          {data.goals.length === 0 ? (
            <p className="text-zinc-500 dark:text-zinc-400">No goals.</p>
          ) : (
            <dl className="grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-1">
              {data.goals.map((goal) => (
                <div key={goal.goal_id} className="contents">
                  <dt className="truncate">{goal.name}</dt>
                  <dd className="text-right tabular-nums">{goal.achieved}</dd>
                  <dd className="text-right tabular-nums text-zinc-500 dark:text-zinc-400">{goal.value_cents === null ? '' : money(goal.value_cents)}</dd>
                </div>
              ))}
            </dl>
          )}
          {data.value_cents > 0 && <p className="mt-2 font-medium">Attributed value {money(data.value_cents)}</p>}
        </Card>
        <Card title="Threads">
          <p className="mb-1 tabular-nums">{data.threads.total} in all</p>
          <ul>
            {Object.entries(data.threads.by_state)
              .sort((a, b) => b[1] - a[1])
              .map(([state, count]) => (
                <li key={state} className="flex min-h-6 items-center justify-between">
                  {state === 'needs_human' || state === 'pending_approval' ? (
                    <Link href={`/inbox?campaign=${campaign.id}&state=${state}`} className="inline-flex min-h-6 items-center text-indigo-700 hover:underline dark:text-indigo-300">
                      {THREAD_STATE[state] ?? words(state)}
                    </Link>
                  ) : (
                    <span>{THREAD_STATE[state] ?? words(state)}</span>
                  )}
                  <span className="tabular-nums">{count}</span>
                </li>
              ))}
          </ul>
        </Card>
      </div>

      <Card title="Steps and variants">
        {data.steps.length === 0 ? (
          <p className="text-zinc-500 dark:text-zinc-400">Nothing sent yet.</p>
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full text-left">
              <thead className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                <tr>
                  {['Step', 'Sent', 'Opened', 'Replies', 'Reply rate', 'Bounced'].map((heading) => (
                    <th key={heading} scope="col" className="py-1 pr-4 font-medium">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.steps.flatMap((step) => [
                  <tr key={step.step_id} className="border-t border-zinc-200 dark:border-zinc-800">
                    <td className="py-1.5 pr-4 font-medium">{step.label}</td>
                    <td className="pr-4 tabular-nums">{step.sent}</td>
                    <td className="pr-4 tabular-nums">{step.opened}</td>
                    <td className="pr-4 tabular-nums">{step.replies}</td>
                    <td className="pr-4 tabular-nums">{percent(step.reply_rate, 1)}</td>
                    <td className="pr-4 tabular-nums">{step.bounced}</td>
                  </tr>,
                  ...(step.variants.length > 1
                    ? step.variants.map((variant) => (
                        <tr key={variant.variant_id} className="text-zinc-600 dark:text-zinc-400">
                          <td className="py-1 pl-4 pr-4">Variant {variant.label}</td>
                          <td className="pr-4 tabular-nums">{variant.sent}</td>
                          <td className="pr-4 tabular-nums">{variant.opened}</td>
                          <td className="pr-4 tabular-nums">{variant.replies}</td>
                          <td className="pr-4 tabular-nums">{percent(variant.reply_rate, 1)}</td>
                          <td className="pr-4 tabular-nums">{variant.bounced}</td>
                        </tr>
                      ))
                    : []),
                ])}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

export function Card({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={cn('rounded-[var(--radius-card)] border border-zinc-200 p-4 dark:border-zinc-800', className)}>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{title}</h2>
      {children}
    </section>
  );
}
