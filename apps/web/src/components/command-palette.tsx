'use client';

// The ⌘K palette (spec §15.3): one box that searches contacts, companies, threads and campaigns
// (`searchAll`) and offers the common commands: go to a view, start a campaign, import contacts.
// ⌘K or Ctrl-K opens it from anywhere; arrows move, Enter opens, Escape closes.

import { useQuery } from '@tanstack/react-query';
import { Building2, CornerDownLeft, Inbox, Megaphone, Search, User } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import { api, unwrap } from '../lib/api.ts';
import { cn } from '../lib/cn.ts';
import { usePerson } from '../lib/person.tsx';

type Entry = { id: string; group: string; title: string; subtitle?: string | null; href: string; icon: typeof Search };

const COMMANDS: (Omit<Entry, 'group' | 'icon'> & { scope?: string })[] = [
  { id: 'go:needs-you', title: 'Go to Needs you', href: '/needs-you' },
  { id: 'go:inbox', title: 'Go to Inbox', href: '/inbox' },
  { id: 'go:hot', title: 'Hot conversations', href: '/inbox?view=hot' },
  { id: 'go:campaigns', title: 'Go to Campaigns', href: '/campaigns' },
  { id: 'go:contacts', title: 'Go to Contacts', href: '/contacts' },
  { id: 'go:deliverability', title: 'Go to Deliverability', href: '/deliverability' },
  { id: 'go:knowledge', title: 'Go to Knowledge', href: '/knowledge' },
  { id: 'go:settings', title: 'Go to Settings', href: '/settings' },
  { id: 'new:campaign', title: 'New campaign', href: '/campaigns/new', scope: 'campaigns:write' },
  { id: 'new:import', title: 'Import contacts', href: '/contacts/import', scope: 'contacts:write' },
  { id: 'new:mailbox', title: 'Add a mailbox', href: '/deliverability/mailboxes/new', scope: 'mailboxes:write' },
];

const KIND = {
  contact: { group: 'Contacts', icon: User, href: (id: string) => `/contacts/${id}` },
  company: { group: 'Companies', icon: Building2, href: (id: string) => `/companies/${id}` },
  thread: { group: 'Threads', icon: Inbox, href: (id: string) => `/threads/${id}` },
  campaign: { group: 'Campaigns', icon: Megaphone, href: (id: string) => `/campaigns/${id}` },
} as const;

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const person = usePerson();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), 200);
    return () => clearTimeout(timer);
  }, [text]);
  // Escape closes it wherever focus is (focus starts in the box: autoFocus).
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    setText('');
    setQ('');
    setActive(0);
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && close.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  const search = useQuery({ queryKey: ['search', q], enabled: open && q.length > 0, queryFn: () => unwrap(api.GET('/search', { params: { query: { q, limit: 12 } } })), placeholderData: (previous) => previous });

  const entries = useMemo<Entry[]>(() => {
    const words = text.trim().toLowerCase();
    const commands = COMMANDS.filter((command) => (!command.scope || person.can(command.scope)) && (!words || command.title.toLowerCase().includes(words))).map((command) => ({ ...command, group: 'Commands', icon: CornerDownLeft }));
    // Only results for what is typed now: the previous query's stay out, so Enter never opens a stale one.
    const results = q && q === text.trim() && !search.isPlaceholderData
      ? (search.data?.data ?? []).map((result) => {
          const kind = KIND[result.kind as keyof typeof KIND];
          return { id: `${result.kind}:${result.id}`, group: kind?.group ?? result.kind, title: result.title, subtitle: result.subtitle, href: kind ? kind.href(result.id) : '/', icon: kind?.icon ?? Search };
        })
      : [];
    return [...results, ...commands.slice(0, words ? 5 : 8)];
  }, [text, q, search.data, search.isPlaceholderData, person]);
  useEffect(() => setActive(0), [entries.length]);

  if (!open) return null;
  const go = (entry: Entry | undefined) => {
    if (!entry) return;
    onClose();
    router.push(entry.href);
  };
  let lastGroup = '';

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-zinc-950/30 p-4 pt-[12vh]" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Search and commands" className="w-full max-w-xl overflow-hidden rounded-[var(--radius-card)] border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
        <label className="flex items-center gap-2 border-b border-zinc-200 px-3 dark:border-zinc-800">
          <Search aria-hidden className="size-4 text-zinc-500 dark:text-zinc-400" />
          <span className="sr-only">Search contacts, companies, threads and campaigns</span>
          <input
            ref={input}
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-results"
            aria-activedescendant={entries[active] ? `palette-${entries[active].id}` : undefined}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') (event.preventDefault(), setActive((index) => Math.min(entries.length - 1, index + 1)));
              else if (event.key === 'ArrowUp') (event.preventDefault(), setActive((index) => Math.max(0, index - 1)));
              else if (event.key === 'Enter') (event.preventDefault(), go(entries[active]));
            }}
            placeholder="Search contacts, companies, threads, campaigns… or type a command"
            className="w-full bg-transparent py-3 outline-none"
          />
          <kbd className="rounded border border-zinc-200 px-1 text-xs text-zinc-500 dark:text-zinc-400 dark:border-zinc-800">esc</kbd>
        </label>
        <ul id="palette-results" role="listbox" aria-label="Results" className="max-h-96 overflow-y-auto py-1">
          {search.isFetching && q && entries.length === 0 && <li className="px-3 py-2 text-zinc-500 dark:text-zinc-400">Searching…</li>}
          {!search.isFetching && q && entries.length === 0 && <li className="px-3 py-2 text-zinc-500 dark:text-zinc-400">Nothing matches “{q}”.</li>}
          {entries.map((entry, index) => {
            const heading = entry.group !== lastGroup ? entry.group : null;
            lastGroup = entry.group;
            return (
              <li key={entry.id} role="presentation">
                {heading && <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{heading}</p>}
                <div
                  id={`palette-${entry.id}`}
                  role="option"
                  aria-selected={index === active}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => go(entry)}
                  className={cn('mx-1 flex cursor-pointer items-center gap-2 rounded-[var(--radius-pill)] px-2 py-1.5', index === active && 'bg-indigo-50 dark:bg-indigo-950/50')}
                >
                  <entry.icon aria-hidden className="size-4 shrink-0 text-zinc-500 dark:text-zinc-400" />
                  <span className="min-w-0 flex-1 truncate">
                    {entry.title}
                    {entry.subtitle && <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-400">{entry.subtitle}</span>}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
