'use client';

// Builder step 7, Review (spec §15.10, §8.11): the full preflight with a link to the step that
// fixes each failing item, the initial email rendered for three enrolled contacts, a rough send
// forecast, and Launch behind a confirmation that says how many contacts start and when.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CircleAlert, XCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { api, idempotencyKey, unwrap, type Schemas } from '../../lib/api.ts';
import { usePerson } from '../../lib/person.tsx';
import { Button, ErrorText, Loading, Pill } from '../ui.tsx';
import { Card } from './common.tsx';
import type { StepKey } from './steps.tsx';

/** Which step (or page) fixes each preflight item; the IDs are runPreflight's. */
const FIX: Record<string, StepKey | string> = { goals: 'goals', audience: 'audience', initial_email: 'emails', follow_up_emails: 'emails', sequences: 'emails', mailboxes: 'sending', compliance: 'sending', links: 'agent', knowledge: 'agent', domains: '/deliverability?tab=domains' };

export function ReviewStep({ campaign, onFix }: { campaign: Schemas['Campaign']; onFix: (step: StepKey) => void }) {
  const person = usePerson();
  const router = useRouter();
  const client = useQueryClient();
  const campaignId = campaign.id;
  const preflight = useQuery({ queryKey: ['campaign', campaignId, 'preflight'], queryFn: () => unwrap(api.GET('/campaigns/{campaignId}/preflight', { params: { path: { campaignId } } })) });
  const initial = useQuery({ queryKey: ['campaign', campaignId, 'initial-email'], queryFn: () => unwrap(api.GET('/campaigns/{campaignId}/initial-email', { params: { path: { campaignId } } })), retry: false });
  const threads = useQuery({ queryKey: ['threads', 'sample', campaignId], queryFn: () => unwrap(api.GET('/threads', { params: { query: { campaign_id: campaignId, limit: 3 } } })) });
  const [confirming, setConfirming] = useState(false);
  const launch = useMutation({
    mutationFn: () => unwrap(api.POST('/campaigns/{campaignId}/launch', { params: { path: { campaignId }, header: idempotencyKey() } })),
    onSuccess: () => (void client.invalidateQueries({ queryKey: ['campaign', campaignId] }), void client.invalidateQueries({ queryKey: ['campaigns'] }), router.push(`/campaigns/${campaignId}`)),
  });
  const enrollable = preflight.data?.audience.enrollable ?? 0;
  const perDay = Math.max(1, campaign.daily_new_threads_limit);
  const days = Math.ceil(enrollable / perDay);

  return (
    <div className="space-y-4">
      <Card title="7 · Review">
        {preflight.isPending && <Loading label="Running every launch check…" />}
        <ErrorText error={preflight.error} onRetry={() => void preflight.refetch()} />
        {preflight.data && (
          <ul className="space-y-1">
            {preflight.data.items.map((item) => (
              <li key={item.id} className="flex items-start gap-2">
                {item.status === 'pass' ? <CheckCircle2 aria-label="Pass" className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : item.status === 'warn' ? <CircleAlert aria-label="Warning" className="mt-0.5 size-4 shrink-0 text-amber-600" /> : <XCircle aria-label="Fails" className="mt-0.5 size-4 shrink-0 text-rose-600" />}
                <span className="flex-1">
                  <span className="font-medium">{item.title}</span>
                  {item.detail && <span className="text-zinc-600 dark:text-zinc-400"> · {item.detail}</span>}
                </span>
                {item.status !== 'pass' && FIX[item.id] && (
                  <Button size="sm" variant="ghost" onClick={() => (FIX[item.id]!.startsWith('/') ? router.push(FIX[item.id]!) : onFix(FIX[item.id] as StepKey))}>
                    Fix →
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Three sample emails" description="The initial email as each of the first enrolled contacts would get it.">
        {threads.data && threads.data.data.length === 0 && <p className="text-zinc-500 dark:text-zinc-400">Enroll contacts to see the email rendered for them.</p>}
        <div className="grid gap-3 lg:grid-cols-3">
          {initial.data &&
            threads.data?.data.map((thread) => (
              <Sample key={thread.id} campaignId={campaignId} stepId={initial.data.id} contactId={thread.contact.id} name={thread.contact.name ?? thread.contact.email} />
            ))}
        </div>
      </Card>

      <Card title="Forecast">
        <p>
          {enrollable} contact{enrollable === 1 ? '' : 's'} can be emailed. At up to {perDay} new conversations a day, first emails take about {days} sending day{days === 1 ? '' : 's'}, fewer if the domain ramp or mailbox warm-up allow less. Follow-ups come on top, as each sequence says.
        </p>
      </Card>

      {campaign.status === 'draft' && person.can('campaigns:write') && person.can('messages:send') && (
        <Card title="Launch">
          {confirming ? (
            <div role="alertdialog" aria-label="Launch the campaign?" className="flex flex-wrap items-center gap-3">
              <p className="flex-1">
                Launch now? {enrollable} contact{enrollable === 1 ? '' : 's'} start getting their first email from now on, within the sending window in each one’s timezone.
              </p>
              <Button variant="primary" disabled={launch.isPending} onClick={() => launch.mutate()}>
                Launch
              </Button>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button variant="primary" disabled={!preflight.data?.passed} onClick={() => setConfirming(true)} title={preflight.data?.passed ? undefined : 'Fix what fails first'}>
              Launch…
            </Button>
          )}
          <ErrorText error={launch.error} />
        </Card>
      )}
    </div>
  );
}

function Sample({ campaignId, stepId, contactId, name }: { campaignId: string; stepId: string; contactId: string; name: string }) {
  const preview = useQuery({ queryKey: ['campaign', campaignId, 'preview', stepId, contactId], queryFn: () => unwrap(api.POST('/campaigns/{campaignId}/steps/{stepId}/preview', { params: { path: { campaignId, stepId } }, body: { contact_id: contactId } })) });
  return (
    <figure className="space-y-1 rounded-[var(--radius-card)] border border-zinc-200 p-3 dark:border-zinc-800">
      <figcaption className="text-xs text-zinc-500 dark:text-zinc-400">To {name}</figcaption>
      {preview.isPending && <Loading />}
      <ErrorText error={preview.error} onRetry={() => void preview.refetch()} />
      {preview.data && (
        <>
          <p className="font-medium">{preview.data.subject}</p>
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{preview.data.body_text}</pre>
          {!preview.data.sendable && <Pill tone="rose">{preview.data.template_issues[0]?.message ?? preview.data.lint.find((finding) => finding.severity === 'blocker')?.message ?? 'Blocked'}</Pill>}
        </>
      )}
    </figure>
  );
}
