import { route } from '@catalyst/server';

/** The test waits up to two minutes for its email to arrive (§7.1). */
export const maxDuration = 150;

export const POST = route('testMailboxConnection');
