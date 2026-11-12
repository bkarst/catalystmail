'use client';

// Who is signed in, for every view: their user ID (the Inbox's "Mine") and the scopes their role
// grants (§16), so actions they may not take are not offered. The API checks again either way.

import { createContext, useContext, type ReactNode } from 'react';

export type Person = { id: string; name: string; role: string; workspace: string; scopes: readonly string[]; twoFactorRequired: boolean };

const PersonContext = createContext<Person | null>(null);

export function PersonProvider({ person, children }: { person: Person; children: ReactNode }) {
  return <PersonContext.Provider value={person}>{children}</PersonContext.Provider>;
}

export function usePerson(): Person & { can: (scope: string) => boolean } {
  const person = useContext(PersonContext);
  if (!person) throw new Error('usePerson outside the signed-in layout');
  return { ...person, can: (scope) => person.scopes.includes(scope) };
}
