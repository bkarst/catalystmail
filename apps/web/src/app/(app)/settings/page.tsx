'use client';

// V16 Settings (spec §15.18): Workspace, Team, AI, Notifications, Security, Integrations, Webhooks,
// and API & agents, one section at a time, kept in the URL. Workspace settings need
// `settings:manage` (owners and admins); Security's own two-factor setup is for everyone, and is
// the one section an owner who must set it up can use before anything else.

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

import { ApiKeysSection } from '../../../components/settings/api-keys.tsx';
import { AiSection } from '../../../components/settings/ai.tsx';
import { IntegrationsSection } from '../../../components/settings/integrations.tsx';
import { NotificationsSection } from '../../../components/settings/notifications.tsx';
import { SecuritySection } from '../../../components/settings/security.tsx';
import { TeamSection } from '../../../components/settings/team.tsx';
import { WebhooksSection } from '../../../components/settings/webhooks.tsx';
import { WorkspaceSection } from '../../../components/settings/workspace.tsx';
import { Loading } from '../../../components/ui.tsx';
import { cn } from '../../../lib/cn.ts';
import { usePerson } from '../../../lib/person.tsx';

const SECTIONS = [
  { key: 'workspace', label: 'Workspace', scope: 'settings:manage' },
  { key: 'team', label: 'Team', scope: 'settings:manage' },
  { key: 'ai', label: 'AI', scope: 'settings:manage' },
  { key: 'notifications', label: 'Notifications', scope: null },
  { key: 'security', label: 'Security', scope: null },
  { key: 'integrations', label: 'Integrations', scope: 'settings:manage' },
  { key: 'webhooks', label: 'Webhooks', scope: 'webhooks:manage' },
  { key: 'api', label: 'API & agents', scope: 'owner_admin' },
] as const;
type Key = (typeof SECTIONS)[number]['key'];

export default function SettingsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Settings />
    </Suspense>
  );
}

function Settings() {
  const person = usePerson();
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const allowed = (scope: string | null) => (scope === null ? true : scope === 'owner_admin' ? person.role === 'owner' || person.role === 'admin' : person.can(scope));
  const visible = SECTIONS.filter((section) => !person.twoFactorRequired || section.key === 'security');
  const fallback: Key = person.twoFactorRequired ? 'security' : allowed('settings:manage') ? 'workspace' : 'notifications';
  const requested = visible.find((section) => section.key === params.get('section'));
  const section: Key = requested && allowed(requested.scope) ? requested.key : fallback;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <div className="grid gap-6 md:grid-cols-[12rem_minmax(0,1fr)]">
        <nav aria-label="Settings sections" className="flex flex-wrap gap-1 md:flex-col">
          {visible.map((entry) => {
            const enabled = allowed(entry.scope);
            return (
              <button
                key={entry.key}
                type="button"
                disabled={!enabled}
                title={enabled ? undefined : 'For owners and admins'}
                aria-current={section === entry.key ? 'page' : undefined}
                onClick={() => router.replace(`${path}?section=${entry.key}`, { scroll: false })}
                className={cn('rounded-[var(--radius-pill)] px-2.5 py-1.5 text-left text-zinc-600 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:text-zinc-400 disabled:hover:bg-transparent dark:text-zinc-400 dark:hover:bg-zinc-900', section === entry.key && 'bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100')}
              >
                {entry.label}
              </button>
            );
          })}
        </nav>
        <div className="min-w-0 space-y-4">
          {section === 'workspace' && <WorkspaceSection />}
          {section === 'team' && <TeamSection />}
          {section === 'ai' && <AiSection />}
          {section === 'notifications' && <NotificationsSection />}
          {section === 'security' && <SecuritySection />}
          {section === 'integrations' && <IntegrationsSection />}
          {section === 'webhooks' && <WebhooksSection />}
          {section === 'api' && <ApiKeysSection />}
        </div>
      </div>
    </div>
  );
}
