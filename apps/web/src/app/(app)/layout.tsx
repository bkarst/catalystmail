// Every signed-in view (spec §15.3). The session is checked here, on the server; without one, the
// person goes to sign in. Data comes from the public API in the browser (D10).

import { signedInPerson } from '@catalyst/server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { PersonProvider } from '../../lib/person.tsx';
import { Providers } from '../providers.tsx';
import { Shell } from './shell.tsx';

export const dynamic = 'force-dynamic';

export default async function SignedInLayout({ children }: { children: ReactNode }) {
  const person = await signedInPerson(await headers());
  if (!person) redirect('/sign-in');
  return (
    <Providers>
      <PersonProvider person={{ id: person.id, name: person.name, role: person.role ?? 'member', workspace: person.workspace.name, scopes: person.scopes, twoFactorRequired: person.needsTwoFactor === true }}>
        <Shell>{children}</Shell>
      </PersonProvider>
    </Providers>
  );
}
