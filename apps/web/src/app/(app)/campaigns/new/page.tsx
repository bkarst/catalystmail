'use client';

// V7 Campaign builder, step 1 (spec §15.10): the name, the objective (with an example) and the
// owner. Continuing creates the draft (with the default follow-up sequences, §5.10) and opens the
// rest of the builder; the draft is saved on every step after that.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Card, fieldClass, Labeled } from '../../../../components/builder/common.tsx';
import { BuilderSteps } from '../../../../components/builder/steps.tsx';
import { Button, ErrorText, inputClass, textareaClass } from '../../../../components/ui.tsx';
import { api, idempotencyKey, unwrap } from '../../../../lib/api.ts';
import { cn } from '../../../../lib/cn.ts';
import { usePerson } from '../../../../lib/person.tsx';

export default function NewCampaignPage() {
  const person = usePerson();
  const router = useRouter();
  const client = useQueryClient();
  const [form, setForm] = useState({ name: '', objective: '', owner_user_id: person.id });
  const users = useQuery({ queryKey: ['users'], queryFn: () => unwrap(api.GET('/users', { params: { query: { limit: 100 } } })), retry: false });
  const create = useMutation({
    mutationFn: async () => {
      const campaign = await unwrap(api.POST('/campaigns', { params: { header: idempotencyKey() }, body: { name: form.name.trim(), objective: form.objective.trim() } }));
      if (form.owner_user_id) await unwrap(api.PATCH('/campaigns/{campaignId}', { params: { path: { campaignId: campaign.id } }, body: { owner_user_id: form.owner_user_id } }));
      return campaign;
    },
    onSuccess: (campaign) => {
      void client.invalidateQueries({ queryKey: ['campaigns'] });
      router.push(`/campaigns/${campaign.id}/build?step=goals`);
    },
  });

  return (
    <div className="max-w-4xl space-y-4">
      <Link href="/campaigns" className="inline-flex items-center gap-1 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100">
        <ArrowLeft aria-hidden className="size-4" /> Campaigns
      </Link>
      <h1 className="text-xl font-semibold">New campaign</h1>
      <BuilderSteps current="basics" />
      <Card title="1 · Basics">
        <form
          className="space-y-3"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <Labeled label="Name">
            <input required maxLength={200} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Agency outreach Q4" className={cn(inputClass, fieldClass)} />
          </Labeled>
          <Labeled label="Objective" hint="In plain words, what the campaign is for. The agent works toward it in every reply.">
            <textarea required maxLength={4000} value={form.objective} onChange={(event) => setForm({ ...form, objective: event.target.value })} placeholder="Book discovery calls with heads of operations at 50–500 person SaaS companies, then convert them to the Business plan." className={cn(textareaClass, fieldClass, 'min-h-24')} />
          </Labeled>
          {users.data && (
            <Labeled label="Owner" hint="Gets the campaign’s escalations by default.">
              <select value={form.owner_user_id} onChange={(event) => setForm({ ...form, owner_user_id: event.target.value })} className={cn(inputClass, fieldClass, 'w-auto')}>
                <option value="">Nobody (the workspace owners)</option>
                {users.data.data
                  .filter((user) => !user.deactivated_at)
                  .map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
              </select>
            </Labeled>
          )}
          <Button type="submit" variant="primary" disabled={create.isPending}>
            Create the draft and continue →
          </Button>
          <ErrorText error={create.error} />
        </form>
      </Card>
    </div>
  );
}
