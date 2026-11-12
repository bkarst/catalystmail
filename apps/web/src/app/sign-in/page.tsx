'use client';

// Sign-in (spec §16): email and password through Better Auth's routes, then the TOTP code when
// two-factor sign-in is on. Someone invited to a workspace makes their password here the first
// time; anyone else can't make an account.

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

type Mode = 'sign-in' | 'first-time' | 'code';

async function post(path: string, body: Record<string, unknown>): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const response = await fetch(`/api/auth${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: response.ok, data };
}

const messageOf = (data: Record<string, unknown>, fallback: string) => (typeof data.message === 'string' ? data.message : fallback);

export default function SignInPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'code') {
        const { ok, data } = await post('/two-factor/verify-totp', { code });
        if (!ok) return setError(messageOf(data, 'That code didn’t work. Try the next one.'));
        return router.push('/');
      }
      const { ok, data } = mode === 'first-time' ? await post('/sign-up/email', { email, password, name: name || email.split('@')[0] }) : await post('/sign-in/email', { email, password });
      if (!ok) {
        return setError(mode === 'first-time' ? messageOf(data, 'Only someone invited to a workspace can make a password here. Ask an owner or admin.') : messageOf(data, 'The email or password is wrong.'));
      }
      if (data.twoFactorRedirect) return setMode('code');
      router.push('/');
    } finally {
      setBusy(false);
    }
  }

  const field = 'mt-1 block w-full rounded-[var(--radius-card)] border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900';
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-[var(--radius-card)] border border-zinc-200 p-6 dark:border-zinc-800" aria-describedby={error ? 'sign-in-error' : undefined}>
        <div>
          <p className="text-base font-semibold">◆ Catalyst</p>
          <h1 className="mt-4 text-xl font-semibold">{mode === 'code' ? 'Enter your code' : mode === 'first-time' ? 'Set your password' : 'Sign in'}</h1>
          {mode === 'code' && <p className="mt-1 text-zinc-500 dark:text-zinc-400">The six digits from your authenticator app.</p>}
          {mode === 'first-time' && <p className="mt-1 text-zinc-500 dark:text-zinc-400">For the address you were invited with. At least 12 characters.</p>}
        </div>

        {mode === 'code' ? (
          <label className="block">
            Code
            <input className={`${field} font-mono tracking-widest`} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(event) => setCode(event.target.value)} autoFocus />
          </label>
        ) : (
          <>
            <label className="block">
              Email
              <input className={field} type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} autoFocus />
            </label>
            {mode === 'first-time' && (
              <label className="block">
                Your name
                <input className={field} autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} />
              </label>
            )}
            <label className="block">
              Password
              <input className={field} type="password" autoComplete={mode === 'first-time' ? 'new-password' : 'current-password'} minLength={mode === 'first-time' ? 12 : undefined} required value={password} onChange={(event) => setPassword(event.target.value)} />
            </label>
          </>
        )}

        {error && (
          <p id="sign-in-error" role="alert" className="rounded-[var(--radius-pill)] bg-rose-50 px-3 py-2 text-rose-700 dark:bg-rose-950 dark:text-rose-300">
            {error}
          </p>
        )}

        <button type="submit" disabled={busy} className="w-full rounded-[var(--radius-card)] bg-indigo-600 px-3 py-2 font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-60">
          {busy ? 'One moment…' : mode === 'code' ? 'Verify' : mode === 'first-time' ? 'Set password and sign in' : 'Sign in'}
        </button>

        {mode !== 'code' && (
          <button type="button" className="w-full text-zinc-500 dark:text-zinc-400 underline-offset-2 hover:underline" onClick={() => (setMode(mode === 'sign-in' ? 'first-time' : 'sign-in'), setError(null))}>
            {mode === 'sign-in' ? 'First time here? Set your password' : 'Already have a password? Sign in'}
          </button>
        )}
      </form>
    </main>
  );
}
