'use client';

// V4 Thread view (spec §15.7): the conversation with the stage ladder above it, open escalations
// and drafts waiting for approval in line, the composer, and the right panel. Everything is read
// and changed through the public API; another workspace's thread answers 404 like any missing one.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bot, Hand, UserCheck, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { EscalationCard } from '../../../../components/escalation-card.tsx';
import { StageTrack } from '../../../../components/thread-bits.tsx';
import { Composer } from '../../../../components/thread/composer.tsx';
import { Conversation, DraftCard } from '../../../../components/thread/messages.tsx';
import { ActivitySection, AiRunsSection, ClassificationSection, ContactSection, GoalsSection, StatusSection } from '../../../../components/thread/side-panel.tsx';
import { Button, ErrorText, inputClass, Loading, Section } from '../../../../components/ui.tsx';
import { api, unwrap, type Schemas } from '../../../../lib/api.ts';
import { cn } from '../../../../lib/cn.ts';
import { usePerson } from '../../../../lib/person.tsx';

export default function ThreadPage() {
  const { threadId } = useParams<{ threadId: string }>();
  const person = usePerson();
  const composer = useRef<HTMLTextAreaElement>(null);
  const path = { params: { path: { threadId } } };

  const thread = useQuery({ queryKey: ['thread', threadId], queryFn: () => unwrap(api.GET('/threads/{threadId}', path)), refetchInterval: 60_000 });
  const messages = useQuery({ queryKey: ['thread', threadId, 'messages'], queryFn: () => unwrap(api.GET('/threads/{threadId}/messages', { params: { path: { threadId }, query: { limit: 100 } } })), refetchInterval: 60_000 });
  const activity = useQuery({ queryKey: ['thread', threadId, 'activity'], queryFn: () => unwrap(api.GET('/threads/{threadId}/activity', { params: { path: { threadId }, query: { limit: 100 } } })) });
  const classifications = useQuery({ queryKey: ['thread', threadId, 'classifications'], queryFn: () => unwrap(api.GET('/threads/{threadId}/classifications', { params: { path: { threadId }, query: { limit: 50 } } })) });
  const escalations = useQuery({
    queryKey: ['thread', threadId, 'escalations'],
    enabled: person.can('escalations:read'),
    queryFn: () => unwrap(api.GET('/escalations', { params: { query: { thread_id: threadId, status: 'all', limit: 20 } } })),
  });
  const campaignId = thread.data?.campaign.id;
  const goals = useQuery({ queryKey: ['campaign', campaignId, 'goals'], enabled: Boolean(campaignId), queryFn: () => unwrap(api.GET('/campaigns/{campaignId}/goals', { params: { path: { campaignId: campaignId! } } })) });
  const campaign = useQuery({ queryKey: ['campaign', campaignId], enabled: Boolean(campaignId), queryFn: () => unwrap(api.GET('/campaigns/{campaignId}', { params: { path: { campaignId: campaignId! } } })) });
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => unwrap(api.GET('/settings')), staleTime: 300_000, retry: false });
  const mailboxes = useQuery({ queryKey: ['mailboxes', 'options'], queryFn: () => unwrap(api.GET('/mailboxes', { params: { query: { limit: 100 } } })), staleTime: 300_000 });
  const steps = useQuery({ queryKey: ['campaign', campaignId, 'steps'], enabled: Boolean(campaignId), queryFn: () => unwrap(api.GET('/campaigns/{campaignId}/follow-up-sequences', { params: { path: { campaignId: campaignId! } } })), retry: false });

  // §15.3: r goes to the reply box (so does arriving at #composer), e approves the waiting draft.
  const loaded = thread.isSuccess;
  useEffect(() => {
    if (loaded && window.location.hash === '#composer') composer.current?.focus();
  }, [loaded]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.metaKey || event.ctrlKey || event.altKey || target.closest('input, textarea, select, [contenteditable=true], [role=dialog]')) return;
      if (event.key === 'r' && composer.current) composer.current.focus();
      else if (event.key === 'e') document.querySelector<HTMLButtonElement>('[data-shortcut=approve]:not(:disabled)')?.click();
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (thread.isPending) return <Loading />;
  if (thread.isError)
    return (
      <div className="space-y-2">
        <BackLink />
        <ErrorText error={thread.error} onRetry={() => void thread.refetch()} />
      </div>
    );

  const data = thread.data;
  const goalList = goals.data?.data ?? [];
  const goalName = (id: string) => goalList.find((goal) => goal.id === id)?.name;
  const stepLabel = stepLabeller(steps.data);
  const all = messages.data?.data ?? [];
  const drafts = all.filter((message) => message.status === 'draft' || message.status === 'pending_approval');
  const open = (escalations.data?.data ?? []).filter((entry) => entry.status === 'open' || entry.status === 'snoozed');
  const mailbox = mailboxes.data?.data.find((entry) => entry.id === data.mailbox_id)?.email ?? null;
  const thresholds = (settings.data?.ai as { jev?: { thresholds?: Record<string, number> } } | undefined)?.jev?.thresholds ?? null;

  return (
    <div className="space-y-4">
      <ThreadHeader thread={data} />
      <StageTrack thread={data} goals={goalList} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          {open.map((escalation) => (
            <EscalationCard key={escalation.id} escalation={escalation} inThread onWriteMyself={() => composer.current?.focus()} />
          ))}
          {messages.isPending ? <Loading /> : messages.isError ? <ErrorText error={messages.error} onRetry={() => void messages.refetch()} /> : <Conversation messages={all} activity={activity.data?.data ?? []} goalName={goalName} stepLabel={stepLabel} />}
          {drafts.map((draft) => (
            <DraftCard key={draft.id} draft={draft} />
          ))}
          {!['unsubscribed', 'bounced'].includes(data.state) && data.mailbox_id && <Composer ref={composer} thread={data} />}
        </div>
        <aside aria-label="About this thread" className="min-w-0 rounded-[var(--radius-card)] border border-zinc-200 px-4 dark:border-zinc-800 lg:self-start">
          <StatusSection thread={data} mailbox={mailbox} />
          <ContactSection thread={data} />
          <ClassificationSection thread={data} goals={goalList} history={classifications.data?.data ?? []} thresholds={thresholds} autoConfirm={campaign.data ? Number(campaign.data.goal_auto_confirm_threshold) : null} />
          {data.summary && (
            <Section title="AI summary">
              <p className="text-zinc-700 dark:text-zinc-300">{data.summary}</p>
            </Section>
          )}
          <GoalsSection thread={data} goals={goalList} />
          <ActivitySection activity={(activity.data?.data ?? []).slice(0, 30)} goalName={goalName} />
          <AiRunsSection history={classifications.data?.data ?? []} />
        </aside>
      </div>
    </div>
  );
}

const BackLink = () => (
  <Link href="/inbox" className="inline-flex items-center gap-1 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100">
    <ArrowLeft aria-hidden className="size-4" /> Inbox
  </Link>
);

/** "Follow-up 2", "Initial email": the step an email was sent for. A step in no sequence is the initial email. */
function stepLabeller(sequences: { data: Schemas['FollowUpSequence'][] } | undefined): (stepId: string | null) => string | null {
  return (stepId) => {
    if (!stepId) return null;
    for (const sequence of sequences?.data ?? []) {
      const step = sequence.steps.find((entry) => entry.id === stepId);
      if (step) return `Follow-up ${step.position}`;
    }
    return 'Initial email';
  };
}

const CLOSE_REASONS = [
  { value: 'not_interested', label: 'Not interested' },
  { value: 'wrong_person', label: 'Wrong person' },
  { value: 'went_quiet', label: 'Went quiet' },
  { value: 'manual', label: 'Other' },
] as const;

function ThreadHeader({ thread }: { thread: Schemas['Thread'] }) {
  const person = usePerson();
  const client = useQueryClient();
  const [closing, setClosing] = useState(false);
  const [reason, setReason] = useState<(typeof CLOSE_REASONS)[number]['value']>('not_interested');
  const [note, setNote] = useState('');
  const [unsubscribe, setUnsubscribe] = useState(false);
  const path = { params: { path: { threadId: thread.id } } };
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['thread', thread.id] });
    void client.invalidateQueries({ queryKey: ['threads'] });
    void client.invalidateQueries({ queryKey: ['work-queue'] });
  };
  const update = useMutation({ mutationFn: (body: { ai_paused?: boolean; assigned_user_id?: string | null }) => unwrap(api.PATCH('/threads/{threadId}', { ...path, body })), onSuccess: refresh });
  const close = useMutation({
    mutationFn: () => unwrap(api.POST('/threads/{threadId}/close', { ...path, body: { reason, ...(note.trim() && { note: note.trim() }), ...(unsubscribe && { unsubscribe: true }) } })),
    onSuccess: () => (setClosing(false), refresh()),
  });
  const may = person.can('threads:write');
  const closed = ['completed', 'closed_lost', 'bounced', 'unsubscribed', 'stopped'].includes(thread.state);
  const mine = thread.assigned_user_id === person.id;

  return (
    <header className="space-y-2">
      <BackLink />
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold">
            {thread.contact.name ?? thread.contact.email} <span className="text-base font-normal text-zinc-500 dark:text-zinc-400">&lt;{thread.contact.email}&gt;</span>
          </h1>
          <p className="text-zinc-500 dark:text-zinc-400">
            {[thread.contact.company, thread.campaign.name].filter(Boolean).join(' · ')}
            {thread.subject && ` · ${thread.subject}`}
          </p>
        </div>
        {may && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => update.mutate({ assigned_user_id: mine ? null : person.id })} disabled={update.isPending}>
              <UserCheck aria-hidden className="size-4" /> {mine ? 'Unassign me' : 'Assign to me'}
            </Button>
            <Button onClick={() => update.mutate({ ai_paused: !thread.ai_paused })} disabled={update.isPending} title={thread.ai_paused ? 'Let the agent write on this thread again' : 'The agent stops writing on this thread; you handle it'}>
              {thread.ai_paused ? <Bot aria-hidden className="size-4" /> : <Hand aria-hidden className="size-4" />}
              {thread.ai_paused ? 'Hand back to the agent' : 'Take over (pause AI)'}
            </Button>
            {!closed && (
              <Button variant="danger" onClick={() => setClosing(!closing)}>
                <XCircle aria-hidden className="size-4" /> Close…
              </Button>
            )}
          </div>
        )}
      </div>
      {closing && (
        <form
          className="flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] border border-rose-200 p-3 dark:border-rose-900"
          onSubmit={(event) => {
            event.preventDefault();
            close.mutate();
          }}
        >
          <label className="flex items-center gap-1">
            Why
            <select value={reason} onChange={(event) => setReason(event.target.value as typeof reason)} className={cn(inputClass, 'w-auto py-1')}>
              {CLOSE_REASONS.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
          <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Note (optional)" aria-label="Note" className={cn(inputClass, 'w-64 py-1')} maxLength={1000} />
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={unsubscribe} onChange={(event) => setUnsubscribe(event.target.checked)} /> Also unsubscribe them everywhere
          </label>
          <Button type="submit" variant="danger" disabled={close.isPending}>
            Close thread
          </Button>
        </form>
      )}
      <ErrorText error={update.error ?? close.error} />
    </header>
  );
}
