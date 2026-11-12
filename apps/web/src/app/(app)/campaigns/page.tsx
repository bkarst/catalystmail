'use client';

// V5 Campaigns list (spec §15.8): each campaign with its status, autonomy, mailboxes, a mini funnel,
// reply rate, goals reached, how many threads need a person, and when it last changed. Archived
// campaigns are behind a toggle. "New campaign" opens the builder (V7).

import { useQueries, useQuery } from '@tanstack/react-query';
import { Megaphone } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { CampaignStatusPill } from '../../../components/campaign/bits.tsx';
import { ErrorText, Loading, Pill } from '../../../components/ui.tsx';
import { api, unwrap, type Schemas } from '../../../lib/api.ts';
import { ago, percent, words } from '../../../lib/format.ts';
import { usePerson } from '../../../lib/person.tsx';

export default function CampaignsPage() {
  const person = usePerson();
  const [archived, setArchived] = useState(false);
  const campaigns = useQuery({ queryKey: ['campaigns', 'list'], queryFn: () => unwrap(api.GET('/campaigns', { params: { query: { limit: 100 } } })) });
  const shown = (campaigns.data?.data ?? []).filter((campaign) => archived || campaign.status !== 'archived');
  const stats = useQueries({
    queries: shown.map((campaign) => ({
      queryKey: ['campaign', campaign.id, 'stats'],
      queryFn: () => unwrap(api.GET('/campaigns/{campaignId}/stats', { params: { path: { campaignId: campaign.id }, query: {} } })),
      enabled: campaign.status !== 'draft',
      staleTime: 60_000,
    })),
  });

  return (
    <section aria-labelledby="campaigns-title" className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <h1 id="campaigns-title" className="text-2xl font-semibold">
          Campaigns
        </h1>
        <label className="flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400">
          <input type="checkbox" checked={archived} onChange={(event) => setArchived(event.target.checked)} /> Show archived
        </label>
        {person.can('campaigns:write') && (
          <Link href="/campaigns/new" className="ml-auto inline-flex items-center rounded-[var(--radius-pill)] bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-700">
            + New campaign
          </Link>
        )}
      </div>
      {campaigns.isPending && <Loading />}
      <ErrorText error={campaigns.error} onRetry={() => void campaigns.refetch()} />
      {campaigns.data && shown.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-16 text-center text-zinc-500 dark:text-zinc-400">
          <Megaphone aria-hidden className="size-8" />
          <p>No campaigns yet.</p>
        </div>
      )}
      {shown.length > 0 && (
        <div className="relative overflow-x-auto rounded-[var(--radius-card)] border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left">
            <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400 dark:border-zinc-800">
              <tr>
                {['Campaign', 'Status', 'Autonomy', 'Mailboxes', 'Funnel', 'Reply rate', 'Goals reached', 'Needs you', 'Changed'].map((heading) => (
                  <th key={heading} scope="col" className="px-3 py-2 font-medium">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {shown.map((campaign, index) => (
                <CampaignRow key={campaign.id} campaign={campaign} stats={stats[index]?.data} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function CampaignRow({ campaign, stats }: { campaign: Schemas['Campaign']; stats: Schemas['CampaignStats'] | undefined }) {
  // Reaching any goal implies goal 1, so goal 1's count is every thread that reached a goal.
  const reached = stats && stats.goals.length > 0 ? Math.max(...stats.goals.map((goal) => goal.achieved)) : null;
  const needs = stats ? (stats.threads.by_state.needs_human ?? 0) + (stats.threads.by_state.pending_approval ?? 0) : null;
  return (
    <tr className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
      <td className="max-w-64 px-3 py-2">
        <Link href={`/campaigns/${campaign.id}`} className="block truncate font-medium hover:underline">
          {campaign.name}
        </Link>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">{campaign.thread_count} enrolled</span>
      </td>
      <td className="px-3 py-2">
        <CampaignStatusPill status={campaign.status} />
      </td>
      <td className="px-3 py-2">{campaign.agent_mode === 'external' ? <Pill>External agent</Pill> : words(campaign.autonomy)}</td>
      <td className="px-3 py-2 tabular-nums">{campaign.mailboxes.length}</td>
      <td className="px-3 py-2">{stats ? <MiniFunnel funnel={stats.funnel} /> : <span className="text-zinc-500 dark:text-zinc-400">–</span>}</td>
      <td className="px-3 py-2 tabular-nums">{stats ? percent(stats.emails.reply_rate, 1) : '–'}</td>
      <td className="px-3 py-2 tabular-nums">{reached ?? '–'}</td>
      <td className="px-3 py-2 tabular-nums">{needs === null ? '–' : needs > 0 ? <Pill tone="rose">{needs}</Pill> : 0}</td>
      <td className="px-3 py-2 text-zinc-500 dark:text-zinc-400">{ago(campaign.updated_at)}</td>
    </tr>
  );
}

/** Sent → … → the final goal as a row of bars, each as tall as its share of Sent. */
function MiniFunnel({ funnel }: { funnel: Schemas['Funnel'] }) {
  const top = funnel[0]?.count ?? 0;
  return (
    <span className="flex h-6 items-end gap-0.5" title={funnel.map((stage) => `${stage.name} ${stage.count}`).join(' → ')}>
      {funnel.map((stage) => (
        <span key={stage.key} aria-hidden className="w-2 rounded-sm bg-indigo-500" style={{ height: `${top ? Math.max(8, Math.round((stage.count / top) * 100)) : 8}%`, opacity: top ? 1 : 0.3 }} />
      ))}
      <span className="sr-only">{funnel.map((stage) => `${stage.name} ${stage.count}`).join(', ')}</span>
    </span>
  );
}
