'use client';

// Settings → Team (spec §15.18, §16): who is in the workspace and their roles; invite someone
// (they get an email and set their password at sign-in), change a role, or remove someone. The last
// owner can't be demoted or removed.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { api, unwrap } from '../../lib/api.ts';
import { cn } from '../../lib/cn.ts';
import { ago, words } from '../../lib/format.ts';
import { usePerson } from '../../lib/person.tsx';
import { Button, ErrorText, inputClass, Loading, Pill } from '../ui.tsx';
import { Panel } from './common.tsx';

const ROLES = { owner: 'Everything, including API keys and deleting the workspace.', admin: 'Settings, mailboxes, domains and keys.', member: 'Campaigns, contacts, threads and escalations.', viewer: 'Read-only.' } as const;
type Role = keyof typeof ROLES;

export function TeamSection() {
  const person = usePerson();
  const client = useQueryClient();
  const users = useQuery({ queryKey: ['users'], queryFn: () => unwrap(api.GET('/users', { params: { query: { limit: 100 } } })) });
  const [invite, setInvite] = useState({ email: '', name: '', role: 'member' as Role });
  const [removing, setRemoving] = useState<string | null>(null);
  const refresh = () => client.invalidateQueries({ queryKey: ['users'] });
  const add = useMutation({ mutationFn: () => unwrap(api.POST('/users', { body: { email: invite.email.trim(), name: invite.name.trim(), role: invite.role } })), onSuccess: () => (setInvite({ email: '', name: '', role: 'member' }), refresh()) });
  const change = useMutation({ mutationFn: ({ userId, role }: { userId: string; role: Role }) => unwrap(api.PATCH('/users/{userId}', { params: { path: { userId } }, body: { role } })), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (userId: string) => unwrap(api.DELETE('/users/{userId}', { params: { path: { userId } } })), onSuccess: () => (setRemoving(null), refresh()) });

  return (
    <div className="space-y-4">
      <Panel title="Invite someone" description="They get an email, and set their password the first time they sign in.">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            add.mutate();
          }}
        >
          <label className="text-xs text-zinc-500 dark:text-zinc-400">
            Email
            <input type="email" required value={invite.email} onChange={(event) => setInvite({ ...invite, email: event.target.value })} className={cn(inputClass, 'mt-0.5 w-64 text-sm text-zinc-900 dark:text-zinc-100')} />
          </label>
          <label className="text-xs text-zinc-500 dark:text-zinc-400">
            Name
            <input required value={invite.name} onChange={(event) => setInvite({ ...invite, name: event.target.value })} className={cn(inputClass, 'mt-0.5 w-48 text-sm text-zinc-900 dark:text-zinc-100')} maxLength={100} />
          </label>
          <label className="text-xs text-zinc-500 dark:text-zinc-400">
            Role
            <select aria-label="Role" value={invite.role} onChange={(event) => setInvite({ ...invite, role: event.target.value as Role })} className={cn(inputClass, 'mt-0.5 w-auto text-sm text-zinc-900 dark:text-zinc-100')}>
              {Object.keys(ROLES)
                .filter((role) => role !== 'owner' || person.role === 'owner')
                .map((role) => (
                  <option key={role} value={role}>
                    {words(role)}
                  </option>
                ))}
            </select>
          </label>
          <Button type="submit" variant="primary" disabled={add.isPending}>
            Invite
          </Button>
        </form>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{ROLES[invite.role]}</p>
        <ErrorText error={add.error} />
      </Panel>

      <Panel title="People">
        {users.isPending && <Loading />}
        <ErrorText error={users.error ?? change.error ?? remove.error} />
        <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {users.data?.data
            .filter((user) => !user.deactivated_at)
            .map((user) => (
              <li key={user.id} className="flex flex-wrap items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {user.name} {user.id === person.id && <Pill>You</Pill>}
                  </p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {user.email} · {user.last_login_at ? `last signed in ${ago(user.last_login_at)}` : 'hasn’t signed in yet'}
                  </p>
                </div>
                <select aria-label={`Role of ${user.name}`} value={user.role} disabled={change.isPending || (user.role === 'owner' && person.role !== 'owner')} onChange={(event) => change.mutate({ userId: user.id, role: event.target.value as Role })} className={cn(inputClass, 'w-auto py-1')} title={ROLES[user.role as Role]}>
                  {Object.keys(ROLES)
                    .filter((role) => role !== 'owner' || person.role === 'owner' || user.role === 'owner')
                    .map((role) => (
                      <option key={role} value={role}>
                        {words(role)}
                      </option>
                    ))}
                </select>
                {user.id !== person.id &&
                  (removing === user.id ? (
                    <span className="flex items-center gap-1">
                      <Button size="sm" variant="danger" disabled={remove.isPending} onClick={() => remove.mutate(user.id)}>
                        Remove {user.name}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setRemoving(null)}>
                        Cancel
                      </Button>
                    </span>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => setRemoving(user.id)}>
                      Remove…
                    </Button>
                  ))}
              </li>
            ))}
        </ul>
      </Panel>
    </div>
  );
}
