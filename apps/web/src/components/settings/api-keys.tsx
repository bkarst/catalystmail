'use client';

// Settings → API & agents (spec §15.18, §14.2): make a key from a preset (Read-only, Agent: draft
// only, Agent: full, Admin), see its secret once with the command that connects Claude Code over
// MCP, and revoke keys. For owners and admins, signed in; a key can't make another.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { api, unwrap, type Schemas } from '../../lib/api.ts';
import { cn } from '../../lib/cn.ts';
import { ago } from '../../lib/format.ts';
import { Button, ErrorText, inputClass, Loading, Pill } from '../ui.tsx';
import { Field, Panel } from './common.tsx';
import { CopyButton } from './integrations.tsx';

type Scope = Schemas['ApiKey']['scopes'][number];
const ALL: Scope[] = ['contacts:read', 'contacts:write', 'contacts:erase', 'campaigns:read', 'campaigns:write', 'threads:read', 'threads:write', 'messages:send', 'escalations:read', 'escalations:write', 'knowledge:read', 'knowledge:write', 'mailboxes:read', 'mailboxes:write', 'analytics:read', 'webhooks:manage', 'settings:manage'];

/** §14.2's presets. */
const PRESETS = {
  read_only: { label: 'Read-only', name: 'Read-only', scopes: ALL.filter((scope) => scope.endsWith(':read')) },
  draft: { label: 'Agent: draft only', name: 'Claude Code (draft only)', scopes: ALL.filter((scope) => scope !== 'messages:send' && scope !== 'contacts:erase' && scope !== 'settings:manage') },
  full: { label: 'Agent: full', name: 'Claude Code', scopes: ALL.filter((scope) => scope !== 'contacts:erase' && scope !== 'settings:manage') },
  admin: { label: 'Admin', name: 'Admin', scopes: ALL },
} as const;
type Preset = keyof typeof PRESETS;

export function ApiKeysSection() {
  const client = useQueryClient();
  const [preset, setPreset] = useState<Preset>('draft');
  const [name, setName] = useState<string>(PRESETS.draft.name);
  const [created, setCreated] = useState<string | null>(null);
  const [revoked, setRevoked] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const keys = useQuery({ queryKey: ['api-keys', revoked], queryFn: () => unwrap(api.GET('/api-keys', { params: { query: revoked ? { include_revoked: 'true' } : {} } })) });
  const create = useMutation({
    mutationFn: () => unwrap(api.POST('/api-keys', { body: { name: name.trim(), scopes: [...PRESETS[preset].scopes] } })),
    onSuccess: (key) => {
      setCreated(key.secret);
      void client.invalidateQueries({ queryKey: ['api-keys'] });
    },
  });
  const revoke = useMutation({ mutationFn: (keyId: string) => unwrap(api.DELETE('/api-keys/{keyId}', { params: { path: { keyId } } })), onSuccess: () => client.invalidateQueries({ queryKey: ['api-keys'] }) });
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const command = `claude mcp add --transport http catalyst ${origin}/api/mcp \\\n  --header "Authorization: Bearer ${created ?? 'ck_live_…'}"`;

  return (
    <div className="space-y-4">
      <Panel title="Connect Claude Code">
        <ol className="list-decimal space-y-3 pl-5">
          <li>
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(event: FormEvent) => {
                event.preventDefault();
                setCreated(null);
                create.mutate();
              }}
            >
              <Field label="Make a key">
                <select value={preset} onChange={(event) => (setPreset(event.target.value as Preset), setName(PRESETS[event.target.value as Preset].name))} className={cn(inputClass, 'w-auto')}>
                  {Object.entries(PRESETS).map(([key, entry]) => (
                    <option key={key} value={key}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Name">
                <input required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} className={cn(inputClass, 'w-64')} />
              </Field>
              <Button type="submit" variant="primary" disabled={create.isPending}>
                Create key
              </Button>
            </form>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{PRESETS[preset].scopes.join(', ')}</p>
            <ErrorText error={create.error} />
            {created && (
              <p role="status" className="mt-2 flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950">
                The key, shown only now: <code className="break-all font-mono text-xs">{created}</code> <CopyButton text={created} label="Copy the key" />
              </p>
            )}
          </li>
          <li>
            Run in your terminal:
            <div className="mt-1 flex items-start gap-2">
              <pre className="min-w-0 flex-1 relative overflow-x-auto rounded-[var(--radius-card)] bg-zinc-100 p-3 font-mono text-xs dark:bg-zinc-900">{command}</pre>
              <CopyButton text={command.replace('\\\n  ', '')} label="Copy the command" />
            </div>
          </li>
          <li>Try: “What needs my attention in Catalyst?”</li>
        </ol>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          OpenAPI:{' '}
          <a href="/api/v1/openapi.json" className="underline">
            /api/v1/openapi.json
          </a>
        </p>
      </Panel>

      <Panel title="Keys">
        <label className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
          <input type="checkbox" checked={revoked} onChange={(event) => setRevoked(event.target.checked)} /> Show revoked keys
        </label>
        {keys.isPending && <Loading />}
        <ErrorText error={keys.error ?? revoke.error} />
        {keys.data && keys.data.data.length === 0 && <p className="text-zinc-500 dark:text-zinc-400">No keys yet.</p>}
        <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {keys.data?.data.map((key) => (
            <li key={key.id} className="flex flex-wrap items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {key.name} {key.revoked_at && <Pill>Revoked</Pill>}
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400" title={key.scopes.join(', ')}>
                  <code>{key.prefix}…</code> · {key.scopes.length} scopes{key.scopes.includes('messages:send') ? ' (can send)' : ' (can’t send)'} · {key.last_used_at ? `last used ${ago(key.last_used_at)}` : 'never used'}
                  {key.expires_at && ` · expires ${new Date(key.expires_at).toLocaleDateString()}`}
                </p>
              </div>
              {!key.revoked_at &&
                (revoking === key.id ? (
                  <span className="flex items-center gap-1">
                    <Button size="sm" variant="danger" disabled={revoke.isPending} onClick={() => revoke.mutate(key.id)}>
                      Revoke now: it stops working at once
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setRevoking(null)}>
                      Cancel
                    </Button>
                  </span>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => setRevoking(key.id)}>
                    Revoke…
                  </Button>
                ))}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
