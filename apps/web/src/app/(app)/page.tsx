'use client';

// V1 Dashboard (spec §15.4): what needs you, today's sends against the plan, the reply rate,
// goals reached, live campaigns' funnels and deliverability at a glance, for the last 7 days.

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';

import { api, problemText } from '../../lib/api.ts';
import { cn } from '../../lib/cn.ts';

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const BAND = { healthy: 'text-emerald-700 dark:text-emerald-300', at_risk: 'text-amber-700 dark:text-amber-300', critical: 'text-rose-700 dark:text-rose-300', paused: 'text-zinc-500 dark:text-zinc-400' } as const;

function Tile({ title, children, href }: { title: string; children: React.ReactNode; href?: string }) {
  const body = (
    <div className="h-full rounded-[var(--radius-card)] border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{title}</h2>
      <div className="mt-2">{children}</div>
    </div>
  );
  return href ? (
    <Link href={href} className="block transition-colors hover:opacity-90">
      {body}
    </Link>
  ) : (
    body
  );
}

export default function DashboardPage() {
  const overview = useQuery({
    queryKey: ['overview', 7],
    queryFn: async () => {
      const { data, error } = await api.GET('/analytics/overview', { params: { query: { days: 7 } } });
      if (error) throw new Error(problemText(error));
      return data;
    },
  });
  if (overview.isPending) return <p className="text-zinc-500 dark:text-zinc-400">Loading…</p>;
  if (overview.isError) return <p role="alert" className="text-rose-700 dark:text-rose-300">{overview.error.message}</p>;
  const data = overview.data;
  return (
    <section aria-labelledby="dashboard-title" className="space-y-6">
      <h1 id="dashboard-title" className="text-2xl font-semibold">
        Dashboard
      </h1>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile title="Needs you" href="/needs-you">
          <p className={cn('text-3xl font-semibold', data.needs_you.urgent > 0 && 'text-rose-700 dark:text-rose-300')}>{data.needs_you.open + data.needs_you.pending_approval}</p>
          <p className="text-zinc-500 dark:text-zinc-400">
            {data.needs_you.open} open · {data.needs_you.urgent} urgent · {data.needs_you.pending_approval} to approve
          </p>
        </Tile>
        <Tile title="Sent today">
          <p className="text-3xl font-semibold">{data.sent_today.sent}</p>
          <p className="text-zinc-500 dark:text-zinc-400">of {data.sent_today.planned} planned</p>
        </Tile>
        <Tile title="Reply rate, 7 days">
          <p className="text-3xl font-semibold">{percent(data.reply_rate.rate)}</p>
          <p className="text-zinc-500 dark:text-zinc-400">
            {data.reply_rate.change_points >= 0 ? '+' : ''}
            {data.reply_rate.change_points.toFixed(1)} points on the week before
          </p>
        </Tile>
        <Tile title="Goals reached">
          <p className="text-3xl font-semibold">{data.goals.reached.reduce((sum, goal) => sum + goal.count, 0)}</p>
          <p className="text-zinc-500 dark:text-zinc-400">{data.goals.reached.map((goal) => `${goal.count} ${goal.name}`).join(' · ') || 'None yet'}</p>
        </Tile>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Tile title="Campaigns">
          {data.campaigns.length === 0 ? (
            <p className="text-zinc-500 dark:text-zinc-400">No live campaigns.</p>
          ) : (
            <ul className="space-y-3">
              {data.campaigns.map((campaign) => (
                <li key={campaign.campaign_id}>
                  <p className="font-medium">
                    {campaign.name} <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400">{campaign.status}</span>
                  </p>
                  <p className="text-zinc-500 dark:text-zinc-400">{campaign.funnel.map((stage) => `${stage.name} ${stage.count}`).join(' → ')}</p>
                </li>
              ))}
            </ul>
          )}
        </Tile>
        <Tile title="Deliverability">
          <p className="text-zinc-500 dark:text-zinc-400">
            Bounces {percent(data.deliverability.bounce_rate_7d)} · complaints {percent(data.deliverability.complaint_rate_7d)} · {data.deliverability.domains_passing_dns} domains passing DNS
            {data.deliverability.domains_blocklisted > 0 && <span className="text-rose-700 dark:text-rose-300"> · {data.deliverability.domains_blocklisted} blocklisted</span>}
          </p>
          <ul className="mt-2 space-y-1">
            {data.deliverability.domains.map((domain) => (
              <li key={domain.domain_id} className="flex justify-between">
                <span className="font-mono">{domain.domain}</span>
                <span className={BAND[domain.reputation_band]}>
                  {domain.reputation_band.replace('_', ' ')} · ramp {domain.ramp_step}/{domain.ramp_final_step}
                </span>
              </li>
            ))}
          </ul>
        </Tile>
      </div>
    </section>
  );
}
