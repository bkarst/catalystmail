'use client';

// The campaign builder's shared pieces (spec §15.10): the campaign query and its update, which
// saves at once (the wizard saves the draft on every step), and the form layout.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { api, unwrap } from '../../lib/api.ts';
import type { paths } from '../../lib/api-types.ts';

export type CampaignPatch = NonNullable<paths['/campaigns/{campaignId}']['patch']['requestBody']>['content']['application/json'];

export function useCampaign(campaignId: string) {
  return useQuery({ queryKey: ['campaign', campaignId], queryFn: () => unwrap(api.GET('/campaigns/{campaignId}', { params: { path: { campaignId } } })) });
}

export function useUpdateCampaign(campaignId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CampaignPatch) => unwrap(api.PATCH('/campaigns/{campaignId}', { params: { path: { campaignId } }, body })),
    onSuccess: (campaign) => {
      client.setQueryData(['campaign', campaignId], campaign);
      void client.invalidateQueries({ queryKey: ['campaigns'] });
      void client.invalidateQueries({ queryKey: ['campaign', campaignId, 'preflight'] });
    },
  });
}

export function Card({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="space-y-3 rounded-[var(--radius-card)] border border-zinc-200 p-4 dark:border-zinc-800">
      <header>
        <h2 className="font-medium">{title}</h2>
        {description && <p className="text-zinc-600 dark:text-zinc-400">{description}</p>}
      </header>
      {children}
    </section>
  );
}

export function Labeled({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={className ?? 'block max-w-2xl'}>
      <span className="text-xs text-zinc-500 dark:text-zinc-400">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-400">{hint}</span>}
    </label>
  );
}

export const fieldClass = 'mt-0.5 text-sm text-zinc-900 dark:text-zinc-100';
