'use client';

// Builder step 1 for an existing campaign (spec §15.10): name, objective, description and owner.

import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { api, unwrap, type Schemas } from '../../lib/api.ts';
import { cn } from '../../lib/cn.ts';
import { Button, ErrorText, inputClass, textareaClass } from '../ui.tsx';
import { Card, fieldClass, Labeled, useUpdateCampaign } from './common.tsx';

export function BasicsStep({ campaign }: { campaign: Schemas['Campaign'] }) {
  const update = useUpdateCampaign(campaign.id);
  const users = useQuery({ queryKey: ['users'], queryFn: () => unwrap(api.GET('/users', { params: { query: { limit: 100 } } })), retry: false });
  const [form, setForm] = useState({ name: campaign.name, objective: campaign.objective, description: campaign.description ?? '', owner_user_id: campaign.owner_user_id ?? '' });
  return (
    <Card title="1 · Basics">
      <form
        className="space-y-3"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          update.mutate({ name: form.name.trim(), objective: form.objective.trim(), description: form.description.trim() || null, owner_user_id: form.owner_user_id || null });
        }}
      >
        <Labeled label="Name">
          <input required maxLength={200} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className={cn(inputClass, fieldClass)} />
        </Labeled>
        <Labeled label="Objective" hint="In plain words, what the campaign is for. The agent works toward it in every reply.">
          <textarea required maxLength={4000} value={form.objective} onChange={(event) => setForm({ ...form, objective: event.target.value })} className={cn(textareaClass, fieldClass, 'min-h-24')} />
        </Labeled>
        <Labeled label="Notes for people (optional)">
          <textarea maxLength={2000} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} className={cn(textareaClass, fieldClass, 'min-h-16')} />
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
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={update.isPending}>
            Save
          </Button>
          {update.isSuccess && (
            <span role="status" className="text-emerald-700 dark:text-emerald-400">
              Saved.
            </span>
          )}
        </div>
        <ErrorText error={update.error} />
      </form>
    </Card>
  );
}
