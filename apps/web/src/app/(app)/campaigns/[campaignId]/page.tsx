'use client';

// V6 Campaign detail (spec §15.9): the header with status, autonomy and mailboxes, Preflight,
// Launch, Pause or Resume, and Archive; then the tabs Overview · Board · Threads · Emails · Goals ·
// Agent · Settings. The tab lives in the URL. "Edit" opens the builder (V7) on the campaign.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, CircleAlert, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

import { AgentTab, SettingsTab } from '../../../../components/campaign/agent-settings.tsx';
import { CampaignStatusPill } from '../../../../components/campaign/bits.tsx';
import { Board } from '../../../../components/campaign/board.tsx';
import { EmailsTab } from '../../../../components/campaign/emails.tsx';
import { GoalsTab } from '../../../../components/campaign/goals.tsx';
import { Overview } from '../../../../components/campaign/overview.tsx';
import { ThreadTable } from '../../../../components/thread-table.tsx';
import { Button, ErrorText, Loading, Pill } from '../../../../components/ui.tsx';
import { api, idempotencyKey, unwrap, type Schemas } from '../../../../lib/api.ts';
import { cn } from '../../../../lib/cn.ts';
import { words } from '../../../../lib/format.ts';
import { usePerson } from '../../../../lib/person.tsx';

const TABS = ['overview', 'board', 'threads', 'emails', 'goals', 'agent', 'settings'] as const;
type Tab = (typeof TABS)[number];

export default function CampaignPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Campaign />
    </Suspense>
  );
}

function Campaign() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const tab = (TABS as readonly string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as Tab) : 'overview';
  const campaign = useQuery({ queryKey: ['campaign', campaignId], queryFn: () => unwrap(api.GET('/campaigns/{campaignId}', { params: { path: { campaignId } } })) });
  const goals = useQuery({ queryKey: ['campaign', campaignId, 'goals'], queryFn: () => unwrap(api.GET('/campaigns/{campaignId}/goals', { params: { path: { campaignId } } })) });

  if (campaign.isPending) return <Loading />;
  if (campaign.isError)
    return (
      <div className="space-y-2">
        <BackLink />
        <ErrorText error={campaign.error} onRetry={() => void campaign.refetch()} />
      </div>
    );
  const data = campaign.data;
  const goalList = [...(goals.data?.data ?? [])].sort((a, b) => a.position - b.position);

  return (
    <div className="space-y-4">
      <Header campaign={data} />
      <nav aria-label="Campaign sections" className="flex flex-wrap gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {TABS.map((entry) => (
          <button
            key={entry}
            type="button"
            aria-current={tab === entry ? 'page' : undefined}
            onClick={() => router.replace(`${path}${entry === 'overview' ? '' : `?tab=${entry}`}`, { scroll: false })}
            className={cn('-mb-px border-b-2 px-3 py-2 text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100', tab === entry ? 'border-indigo-600 font-medium text-zinc-900 dark:text-zinc-100' : 'border-transparent')}
          >
            {words(entry)}
          </button>
        ))}
      </nav>
      {tab === 'overview' && <Overview campaign={data} />}
      {tab === 'board' && <Board campaign={data} goals={goalList} />}
      {tab === 'threads' && <ThreadTable query={{ limit: 50, campaign_id: data.id }} classification />}
      {tab === 'emails' && <EmailsTab campaign={data} goals={goalList} />}
      {tab === 'goals' && <GoalsTab goals={goalList} />}
      {tab === 'agent' && <AgentTab campaign={data} />}
      {tab === 'settings' && <SettingsTab campaign={data} />}
    </div>
  );
}

const BackLink = () => (
  <Link href="/campaigns" className="inline-flex items-center gap-1 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100">
    <ArrowLeft aria-hidden className="size-4" /> Campaigns
  </Link>
);

function Header({ campaign }: { campaign: Schemas['Campaign'] }) {
  const person = usePerson();
  const client = useQueryClient();
  const [checking, setChecking] = useState(false);
  const [confirming, setConfirming] = useState<'launch' | 'archive' | null>(null);
  const campaignId = campaign.id;
  const preflight = useQuery({ queryKey: ['campaign', campaignId, 'preflight'], enabled: checking || confirming === 'launch', queryFn: () => unwrap(api.GET('/campaigns/{campaignId}/preflight', { params: { path: { campaignId } } })) });
  const act = useMutation({
    mutationFn: (action: 'launch' | 'pause' | 'resume' | 'archive') => {
      const params = { params: { path: { campaignId }, header: idempotencyKey() } };
      if (action === 'launch') return unwrap(api.POST('/campaigns/{campaignId}/launch', params));
      if (action === 'pause') return unwrap(api.POST('/campaigns/{campaignId}/pause', params));
      if (action === 'resume') return unwrap(api.POST('/campaigns/{campaignId}/resume', params));
      return unwrap(api.POST('/campaigns/{campaignId}/archive', params));
    },
    onSuccess: () => {
      setConfirming(null);
      void client.invalidateQueries({ queryKey: ['campaign', campaignId] });
      void client.invalidateQueries({ queryKey: ['campaigns'] });
    },
  });
  const may = person.can('campaigns:write');

  return (
    <header className="space-y-3">
      <BackLink />
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{campaign.name}</h1>
        <CampaignStatusPill status={campaign.status} />
        <Pill>{campaign.agent_mode === 'external' ? 'External agent' : words(campaign.autonomy)}</Pill>
        <span className="text-zinc-500 dark:text-zinc-400">
          {campaign.mailboxes.length} mailbox{campaign.mailboxes.length === 1 ? '' : 'es'} · {campaign.thread_count} enrolled
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          {may && campaign.status !== 'archived' && (
            <Link href={`/campaigns/${campaign.id}/build`} className="inline-flex items-center rounded-[var(--radius-pill)] border border-zinc-200 px-3 py-1.5 font-medium hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900">
              {campaign.status === 'draft' ? 'Continue setup' : 'Edit'}
            </Link>
          )}
          <Button onClick={() => setChecking(!checking)}>Preflight</Button>
          {may && campaign.status === 'draft' && person.can('messages:send') && (
            <Button variant="primary" onClick={() => setConfirming('launch')}>
              Launch…
            </Button>
          )}
          {may && campaign.status === 'active' && (
            <Button disabled={act.isPending} onClick={() => act.mutate('pause')}>
              Pause
            </Button>
          )}
          {may && campaign.status === 'paused' && (
            <Button variant="primary" disabled={act.isPending} onClick={() => act.mutate('resume')}>
              Resume
            </Button>
          )}
          {may && campaign.status !== 'archived' && campaign.status !== 'draft' && (
            <Button variant="danger" onClick={() => setConfirming('archive')}>
              Archive…
            </Button>
          )}
        </div>
      </div>
      {campaign.objective && <p className="max-w-3xl text-zinc-600 dark:text-zinc-400">{campaign.objective}</p>}

      {(checking || confirming === 'launch') && (
        <div className="space-y-2 rounded-[var(--radius-card)] border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="font-medium">Preflight</h2>
          {preflight.isPending && <Loading label="Checking…" />}
          <ErrorText error={preflight.error} onRetry={() => void preflight.refetch()} />
          {preflight.data && (
            <>
              <ul className="space-y-1">
                {preflight.data.items.map((item) => (
                  <li key={item.id} className="flex gap-2">
                    {item.status === 'pass' ? <CheckCircle2 aria-label="Pass" className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : item.status === 'warn' ? <CircleAlert aria-label="Warning" className="mt-0.5 size-4 shrink-0 text-amber-600" /> : <XCircle aria-label="Fails" className="mt-0.5 size-4 shrink-0 text-rose-600" />}
                    <span>
                      <span className="font-medium">{item.title}</span>
                      {item.detail && <span className="text-zinc-600 dark:text-zinc-400"> · {item.detail}</span>}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-zinc-500 dark:text-zinc-400">
                Audience: {preflight.data.audience.enrolled} enrolled, {preflight.data.audience.enrollable} can be emailed.
              </p>
            </>
          )}
        </div>
      )}

      {confirming && (
        <div role="alertdialog" aria-label={confirming === 'launch' ? 'Launch the campaign?' : 'Archive the campaign?'} className="flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950">
          <p className="flex-1">
            {confirming === 'launch'
              ? `Launch now? ${preflight.data ? preflight.data.audience.enrollable : '…'} contacts start getting their first email, within the caps and sending windows.`
              : 'Archive it? Its remaining threads stop and it becomes read-only. Its history is kept. This can’t be undone.'}
          </p>
          <Button variant={confirming === 'launch' ? 'primary' : 'danger'} disabled={act.isPending || (confirming === 'launch' && !preflight.data?.passed)} onClick={() => act.mutate(confirming)}>
            {confirming === 'launch' ? 'Launch' : 'Archive'}
          </Button>
          <Button variant="ghost" onClick={() => setConfirming(null)}>
            Cancel
          </Button>
        </div>
      )}
      <ErrorText error={act.error} />
    </header>
  );
}
