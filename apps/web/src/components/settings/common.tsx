'use client';

// Shared pieces of Settings (spec §15.18): the workspace settings query and its update, which
// replaces the cached settings with the answer, and the form layout.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { api, unwrap } from '../../lib/api.ts';
import type { paths } from '../../lib/api-types.ts';

export type SettingsPatch = NonNullable<paths['/settings']['patch']['requestBody']>['content']['application/json'];

export function useSettings(enabled = true) {
  return useQuery({ queryKey: ['settings'], enabled, queryFn: () => unwrap(api.GET('/settings')), retry: false });
}

export function useUpdateSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: SettingsPatch) => unwrap(api.PATCH('/settings', { body })),
    onSuccess: (settings) => client.setQueryData(['settings'], settings),
  });
}

export function Panel({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
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

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block max-w-xl space-y-1">
      <span className="text-zinc-600 dark:text-zinc-400">{label}</span>
      {children}
      {hint && <span className="block text-xs text-zinc-500 dark:text-zinc-400">{hint}</span>}
    </label>
  );
}

export const Saved = ({ show }: { show: boolean }) =>
  show ? (
    <span role="status" className="text-emerald-700 dark:text-emerald-400">
      Saved.
    </span>
  ) : null;
