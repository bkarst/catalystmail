'use client';

// Builder step 3, Audience (spec §15.10, §8.5): enroll a list or segment, with how many were added
// and why the rest were skipped (suppressed, invalid, active elsewhere, cooldown…); single
// contacts are enrolled from the Contacts list. The enrollment rules decide who is skipped.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';

import { api, unwrap, type Schemas } from '../../lib/api.ts';
import { cn } from '../../lib/cn.ts';
import { words } from '../../lib/format.ts';
import { Button, ErrorText, inputClass } from '../ui.tsx';
import { Card, fieldClass, Labeled, useUpdateCampaign } from './common.tsx';

export function AudienceStep({ campaign }: { campaign: Schemas['Campaign'] }) {
  const client = useQueryClient();
  const campaignId = campaign.id;
  const lists = useQuery({ queryKey: ['lists', 'all'], queryFn: () => unwrap(api.GET('/lists', { params: { query: { limit: 100 } } })) });
  const [listId, setListId] = useState('');
  const [result, setResult] = useState<Schemas['EnrollmentResult'] | null>(null);
  const enroll = useMutation({
    mutationFn: () => unwrap(api.POST('/campaigns/{campaignId}/enrollments', { params: { path: { campaignId } }, body: { list_id: listId } })),
    onSuccess: (done) => (setResult(done), void client.invalidateQueries({ queryKey: ['campaign', campaignId] })),
  });
  const rules = campaign.enrollment_rules as { skip_active_elsewhere?: boolean; cooldown_days?: number; allow_role_accounts?: boolean; allow_risky?: boolean };
  const update = useUpdateCampaign(campaignId);
  const [cooldown, setCooldown] = useState(String(rules.cooldown_days ?? 30));
  const skipped = result ? Object.entries(result.skipped.reduce<Record<string, number>>((counts, entry) => ({ ...counts, [entry.reason]: (counts[entry.reason] ?? 0) + 1 }), {})) : [];

  return (
    <div className="space-y-4">
      <Card title="3 · Audience" description={`${campaign.thread_count} contact${campaign.thread_count === 1 ? '' : 's'} enrolled so far.`}>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            setResult(null);
            enroll.mutate();
          }}
        >
          <Labeled label="Enroll a list or segment" className="block">
            <select required value={listId} onChange={(event) => setListId(event.target.value)} className={cn(inputClass, fieldClass, 'w-auto')}>
              <option value="">Choose…</option>
              {lists.data?.data.map((list) => (
                <option key={list.id} value={list.id}>
                  {list.name} ({list.kind === 'dynamic' ? 'segment, ' : ''}
                  {list.member_count})
                </option>
              ))}
            </select>
          </Labeled>
          <Button type="submit" variant="primary" disabled={!listId || enroll.isPending}>
            Enroll
          </Button>
        </form>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Or pick contacts in{' '}
          <Link href="/contacts" className="underline">
            Contacts
          </Link>{' '}
          and use “Enroll in campaign”. Build a segment in{' '}
          <Link href="/lists" className="underline">
            Lists
          </Link>
          .
        </p>
        <ErrorText error={enroll.error} />
        {result && (
          <div role="status" className="space-y-1">
            <p className="font-medium">
              {result.created.length} enrolled{result.skipped.length > 0 && `, ${result.skipped.length} skipped`}.
            </p>
            {skipped.length > 0 && <p className="text-zinc-600 dark:text-zinc-400">{skipped.map(([reason, count]) => `${count} ${words(reason).toLowerCase()}`).join(' · ')}</p>}
          </div>
        )}
      </Card>
      <Card title="Who is skipped" description="Applied whenever contacts are enrolled.">
        <div className="space-y-2">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={rules.skip_active_elsewhere ?? true} disabled={update.isPending} onChange={(event) => update.mutate({ enrollment_rules: { ...rules, skip_active_elsewhere: event.target.checked } })} /> Skip contacts with an active conversation in another campaign
          </label>
          <label className="flex items-center gap-2">
            Skip contacts emailed by any campaign in the last
            <input type="number" min={0} max={365} value={cooldown} onChange={(event) => setCooldown(event.target.value)} onBlur={() => Number(cooldown) !== rules.cooldown_days && update.mutate({ enrollment_rules: { ...rules, cooldown_days: Number(cooldown) } })} className={cn(inputClass, 'w-20 py-1')} /> days
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={rules.allow_role_accounts ?? false} disabled={update.isPending} onChange={(event) => update.mutate({ enrollment_rules: { ...rules, allow_role_accounts: event.target.checked } })} /> Allow role accounts such as info@ and sales@
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={rules.allow_risky ?? false} disabled={update.isPending} onChange={(event) => update.mutate({ enrollment_rules: { ...rules, allow_risky: event.target.checked } })} /> Allow addresses verification marked risky or catch-all
          </label>
        </div>
        <ErrorText error={update.error} />
      </Card>
    </div>
  );
}
