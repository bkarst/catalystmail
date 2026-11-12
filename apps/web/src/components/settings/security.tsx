'use client';

// Settings → Security (spec §16): your own two-factor sign-in through Better Auth (turn it on with
// your password, add the key to an authenticator app, confirm with a code, keep the backup codes;
// or turn it off), and for owners and admins whether owners must use it. An owner the workspace
// requires it of lands here, and the rest of the app opens once it is on.

import { useMutation, useQuery } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { cn } from '../../lib/cn.ts';
import { usePerson } from '../../lib/person.tsx';
import { Button, ErrorText, inputClass, Loading, Pill } from '../ui.tsx';
import { Field, Panel, Saved, useSettings, useUpdateSettings } from './common.tsx';

async function auth<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  const response = await fetch(`/api/auth${path}`, { method: body ? 'POST' : 'GET', credentials: 'same-origin', ...(body && { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
  const data = (await response.json().catch(() => null)) as (T & { message?: string }) | null;
  if (!response.ok) throw new Error(data?.message ?? 'That didn’t work. Try again.');
  return data as T;
}

export function SecuritySection() {
  const person = usePerson();
  return (
    <div className="space-y-4">
      <TwoFactor />
      {person.can('settings:manage') && !person.twoFactorRequired && <OwnerRule />}
    </div>
  );
}

function TwoFactor() {
  const router = useRouter();
  const person = usePerson();
  const session = useQuery({ queryKey: ['auth', 'session'], queryFn: () => auth<{ user: { twoFactorEnabled?: boolean | null } } | null>('/get-session') });
  const [password, setPassword] = useState('');
  const [setup, setSetup] = useState<{ totpURI: string; backupCodes: string[] } | null>(null);
  const [code, setCode] = useState('');
  const [turningOff, setTurningOff] = useState(false);
  const enable = useMutation({ mutationFn: () => auth<{ totpURI: string; backupCodes: string[] }>('/two-factor/enable', { password }), onSuccess: (result) => (setSetup(result), setPassword('')) });
  const verify = useMutation({
    mutationFn: () => auth('/two-factor/verify-totp', { code: code.trim() }),
    onSuccess: () => {
      setSetup(null);
      setCode('');
      void session.refetch();
      // The signed-in layout reads the session on the server: refresh it so the rest of the app opens.
      router.refresh();
    },
  });
  const disable = useMutation({ mutationFn: () => auth('/two-factor/disable', { password }), onSuccess: () => (setTurningOff(false), setPassword(''), void session.refetch(), router.refresh()) });

  if (session.isPending) return <Loading />;
  const on = Boolean(session.data?.user.twoFactorEnabled);
  const secret = setup ? new URL(setup.totpURI).searchParams.get('secret') : null;

  return (
    <Panel title="Two-factor sign-in" description="A six-digit code from an authenticator app, asked for after your password.">
      <ErrorText error={session.error} onRetry={() => void session.refetch()} />
      {person.twoFactorRequired && (
        <p className="flex items-center gap-2 rounded-[var(--radius-pill)] bg-amber-50 px-3 py-2 text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <ShieldCheck aria-hidden className="size-4" /> This workspace requires owners to use it. Turn it on to use Catalyst.
        </p>
      )}
      {on && !setup ? (
        <div className="space-y-2">
          <p>
            <Pill tone="emerald">On</Pill>
          </p>
          {turningOff ? (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(event: FormEvent) => {
                event.preventDefault();
                disable.mutate();
              }}
            >
              <Field label="Your password">
                <input type="password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className={cn(inputClass, 'w-64')} />
              </Field>
              <Button type="submit" variant="danger" disabled={disable.isPending}>
                Turn it off
              </Button>
              <Button variant="ghost" onClick={() => setTurningOff(false)}>
                Cancel
              </Button>
            </form>
          ) : (
            <Button variant="ghost" onClick={() => setTurningOff(true)}>
              Turn off…
            </Button>
          )}
          <ErrorText error={disable.error} />
        </div>
      ) : !setup ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            enable.mutate();
          }}
        >
          <Field label="Your password, to start">
            <input type="password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className={cn(inputClass, 'w-64')} />
          </Field>
          <Button type="submit" variant="primary" disabled={enable.isPending}>
            Set up two-factor sign-in
          </Button>
          <ErrorText error={enable.error} />
        </form>
      ) : (
        <div className="space-y-3">
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              In your authenticator app, add an account with this key:
              <code className="mt-1 block break-all rounded-[var(--radius-pill)] bg-zinc-100 px-2 py-1 font-mono text-sm dark:bg-zinc-900">{secret}</code>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                Or open this link on the device with the app:{' '}
                <a href={setup.totpURI} className="break-all underline">
                  {setup.totpURI}
                </a>
              </span>
            </li>
            <li>
              Keep these backup codes somewhere safe. Each one signs you in once if you lose the app:
              <code className="mt-1 grid grid-cols-2 gap-x-6 rounded-[var(--radius-pill)] bg-zinc-100 px-2 py-1 font-mono text-sm sm:grid-cols-5 dark:bg-zinc-900">
                {setup.backupCodes.map((backup) => (
                  <span key={backup}>{backup}</span>
                ))}
              </code>
            </li>
            <li>
              <form
                className="flex flex-wrap items-end gap-2"
                onSubmit={(event: FormEvent) => {
                  event.preventDefault();
                  verify.mutate();
                }}
              >
                <Field label="The code the app shows now">
                  <input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(event) => setCode(event.target.value)} className={cn(inputClass, 'w-32 font-mono tracking-widest')} />
                </Field>
                <Button type="submit" variant="primary" disabled={verify.isPending}>
                  Confirm and turn on
                </Button>
              </form>
              <ErrorText error={verify.error} />
            </li>
          </ol>
        </div>
      )}
    </Panel>
  );
}

function OwnerRule() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const [saved, setSaved] = useState(false);
  if (settings.isPending) return <Loading />;
  if (settings.isError) return <ErrorText error={settings.error} />;
  return (
    <Panel title="Workspace rule">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={settings.data.security.require_owner_two_factor}
          disabled={update.isPending}
          onChange={(event) => {
            setSaved(false);
            update.mutate({ security: { require_owner_two_factor: event.target.checked } }, { onSuccess: () => setSaved(true) });
          }}
        />
        Owners must sign in with two-factor authentication
      </label>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">An owner without it can do nothing but set it up.</p>
      <Saved show={saved} />
      <ErrorText error={update.error} />
    </Panel>
  );
}
