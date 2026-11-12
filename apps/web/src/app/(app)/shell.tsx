'use client';

// The shell (spec §15.3, §15.20): the sidebar with the views and the Needs-you count (rose when
// anything is urgent), and the header with the ⌘K palette and the person's menu. Below the md
// breakpoint the sidebar is a drawer behind a menu button. Live updates (§4.2) keep every view
// current, and new replies and escalations are announced.

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, BookOpen, Building2, Gauge, Inbox, LayoutDashboard, List, LogOut, Megaphone, Menu, Search, Settings, ShieldCheck, Users, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

import { CommandPalette } from '../../components/command-palette.tsx';
import { api } from '../../lib/api.ts';
import { cn } from '../../lib/cn.ts';
import { LiveNotices, useLiveUpdates } from '../../lib/live.tsx';
import { usePerson } from '../../lib/person.tsx';

const NAV = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/needs-you', label: 'Needs you', icon: AlertTriangle, badge: true },
  { href: '/inbox', label: 'Inbox', icon: Inbox },
  { href: '/campaigns', label: 'Campaigns', icon: Megaphone },
  { href: '/contacts', label: 'Contacts', icon: Users },
  { href: '/companies', label: 'Companies', icon: Building2 },
  { href: '/lists', label: 'Lists', icon: List },
  { href: '/knowledge', label: 'Knowledge', icon: BookOpen },
  { href: '/deliverability', label: 'Deliverability', icon: Gauge },
] as const;

/** `g` then a letter (§15.3). */
const GO_TO: Record<string, string> = { d: '/', n: '/needs-you', i: '/inbox', c: '/campaigns', o: '/contacts' };

const SHORTCUTS = [
  { keys: ['⌘K'], what: 'Search and commands' },
  { keys: ['g', 'd'], what: 'Go to Dashboard' },
  { keys: ['g', 'n'], what: 'Go to Needs you' },
  { keys: ['g', 'i'], what: 'Go to Inbox' },
  { keys: ['g', 'c'], what: 'Go to Campaigns' },
  { keys: ['g', 'o'], what: 'Go to Contacts' },
  { keys: ['j', 'k'], what: 'Needs you: next and previous item' },
  { keys: ['Enter'], what: 'Needs you: open the thread' },
  { keys: ['e'], what: 'Approve and send the draft' },
  { keys: ['s'], what: 'Needs you: snooze until tomorrow 9:00' },
  { keys: ['t'], what: 'Needs you: take the thread over' },
  { keys: ['r'], what: 'Reply on the thread' },
  { keys: ['?'], what: 'This list' },
] as const;

function CheatSheet({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-zinc-950/30 p-4 pt-[12vh]" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="shortcuts-title" className="w-full max-w-md rounded-[var(--radius-card)] border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-800 dark:bg-zinc-950" onKeyDown={(event) => event.key === 'Escape' && onClose()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 id="shortcuts-title" className="font-semibold">
            Keyboard shortcuts
          </h2>
          <button type="button" autoFocus aria-label="Close" onClick={onClose} className="rounded-[var(--radius-pill)] p-1 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900">
            <X aria-hidden className="size-4" />
          </button>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
          {SHORTCUTS.map((entry) => (
            <div key={entry.what} className="contents">
              <dt className="flex gap-1">
                {entry.keys.map((key) => (
                  <kbd key={key} className="rounded border border-zinc-200 px-1.5 text-xs dark:border-zinc-800">
                    {key}
                  </kbd>
                ))}
              </dt>
              <dd>{entry.what}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

const linkClass = (active: boolean) => cn('flex items-center gap-2 rounded-[var(--radius-pill)] px-2 py-1.5 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-900', active && 'bg-zinc-100 font-medium dark:bg-zinc-900');

export function Shell({ children }: { children: ReactNode }) {
  const person = usePerson();
  const path = usePathname();
  const router = useRouter();
  const [drawer, setDrawer] = useState(false);
  // The badge counts open escalations plus emails waiting for approval (§15.3).
  const queue = useQuery({ queryKey: ['work-queue', 'counts'], queryFn: async () => (await api.GET('/work-queue', { params: { query: { limit: 1 } } })).data ?? null, refetchInterval: 60_000, enabled: !person.twoFactorRequired });
  const waiting = queue.data ? queue.data.counts.escalation + queue.data.counts.draft : 0;
  const urgent = queue.data?.items.some((item) => item.priority === 'urgent') ?? false;
  const notices = useLiveUpdates(!person.twoFactorRequired && person.can('threads:read'));

  // §15.3: ⌘K or Ctrl-K opens the palette from anywhere; g then d, n, i, c or o goes to a view;
  // ? shows every shortcut.
  const [palette, setPalette] = useState(false);
  const [cheatSheet, setCheatSheet] = useState(false);
  useEffect(() => {
    let chord = 0;
    const onKey = (event: KeyboardEvent) => {
      if (person.twoFactorRequired) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPalette((open) => !open);
        return;
      }
      const target = event.target as HTMLElement;
      if (event.metaKey || event.ctrlKey || event.altKey || target.closest('input, textarea, select, [contenteditable=true], [role=dialog]')) return;
      const go = GO_TO[event.key];
      if (chord > Date.now() && go) {
        chord = 0;
        event.preventDefault();
        router.push(go);
      } else if (event.key === 'g') {
        chord = Date.now() + 1500;
      } else if (event.key === '?') {
        event.preventDefault();
        setCheatSheet(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [person.twoFactorRequired, router]);

  // §16: an owner the workspace requires two-factor of can do nothing but set it up.
  useEffect(() => {
    if (person.twoFactorRequired && path !== '/settings') router.replace('/settings?section=security');
  }, [person.twoFactorRequired, path, router]);
  // The drawer closes when a view opens.
  useEffect(() => setDrawer(false), [path]);

  async function signOut() {
    await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{}' });
    router.push('/sign-in');
  }

  const sidebar = (
    <>
      <div className="flex items-center justify-between">
        <p className="px-2 py-1 text-base font-semibold">◆ Catalyst</p>
        <button type="button" aria-label="Close the menu" onClick={() => setDrawer(false)} className="rounded-[var(--radius-pill)] p-1 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 md:hidden dark:hover:bg-zinc-900">
          <X aria-hidden className="size-4" />
        </button>
      </div>
      <p className="truncate px-2 text-xs text-zinc-500 dark:text-zinc-400">{person.workspace}</p>
      <ul className="mt-4 space-y-0.5">
        {NAV.map(({ href, label, icon: Icon, ...rest }) => {
          const active = href === '/' ? path === '/' : path.startsWith(href) || (href === '/inbox' && path.startsWith('/threads/'));
          return (
            <li key={href}>
              <Link href={href} aria-current={active ? 'page' : undefined} className={linkClass(active)}>
                <Icon aria-hidden className="size-4" />
                <span className="flex-1">{label}</span>
                {'badge' in rest && waiting > 0 && (
                  <span className={cn('rounded-[var(--radius-pill)] px-1.5 text-xs font-medium text-white', urgent ? 'bg-rose-600' : 'bg-zinc-500')}>
                    {waiting}
                    <span className="sr-only">{urgent ? ' waiting, some urgent' : ' waiting'}</span>
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="mt-auto space-y-0.5 pt-4">
        <Link href="/settings" aria-current={path.startsWith('/settings') ? 'page' : undefined} className={linkClass(path.startsWith('/settings'))}>
          <Settings aria-hidden className="size-4" /> Settings
        </Link>
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-[var(--radius-pill)] focus:bg-white focus:px-3 focus:py-1.5 dark:focus:bg-zinc-950">
        Skip to content
      </a>
      <nav aria-label="Main" className="hidden w-56 shrink-0 flex-col border-r border-zinc-200 p-3 md:flex dark:border-zinc-800">
        {sidebar}
      </nav>
      {drawer && (
        <div className="fixed inset-0 z-40 flex md:hidden" onMouseDown={(event) => event.target === event.currentTarget && setDrawer(false)}>
          <nav aria-label="Main" className="flex w-64 flex-col border-r border-zinc-200 bg-white p-3 shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
            {sidebar}
          </nav>
          <div aria-hidden className="flex-1 bg-zinc-950/30" />
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3 sm:gap-4 md:px-6 dark:border-zinc-800">
          <button type="button" aria-label="Open the menu" onClick={() => setDrawer(true)} className="rounded-[var(--radius-pill)] p-1.5 text-zinc-600 hover:bg-zinc-100 md:hidden dark:text-zinc-400 dark:hover:bg-zinc-900">
            <Menu aria-hidden className="size-5" />
          </button>
          <button type="button" onClick={() => setPalette(true)} className="flex max-w-md flex-1 items-center gap-2 rounded-[var(--radius-pill)] px-2 py-1 text-left text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900">
            <Search aria-hidden className="size-4" />
            <span className="flex-1 truncate">Search contacts, threads, campaigns…</span>
            <kbd className="hidden rounded border border-zinc-200 px-1 text-xs sm:inline dark:border-zinc-800">⌘K</kbd>
          </button>
          <CommandPalette open={palette} onClose={() => setPalette(false)} />
          {cheatSheet && <CheatSheet onClose={() => setCheatSheet(false)} />}
          <span className="hidden text-zinc-500 dark:text-zinc-400 sm:inline">
            {person.name} · {person.role}
          </span>
          <button type="button" onClick={signOut} className="flex items-center gap-1 rounded-[var(--radius-pill)] px-2 py-1 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900">
            <LogOut aria-hidden className="size-4" /> <span className="hidden sm:inline">Sign out</span>
            <span className="sr-only sm:hidden">Sign out</span>
          </button>
        </header>
        {person.twoFactorRequired && (
          <p role="alert" className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-6 py-2 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            <ShieldCheck aria-hidden className="size-4" /> This workspace requires owners to sign in with two-factor authentication. Nothing else works until you{' '}
            <Link href="/settings?section=security" className="font-medium underline">
              set it up
            </Link>
            .
          </p>
        )}
        <main id="main" className="min-w-0 flex-1 p-4 md:p-6">
          {children}
        </main>
      </div>
      <LiveNotices notices={notices} />
    </div>
  );
}
