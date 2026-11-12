// Sign-up, sign-in, sign-out and the session (spec §16), served by Better Auth.
import { authHandler } from '@catalyst/server';

export const dynamic = 'force-dynamic';

export const GET = authHandler;
export const POST = authHandler;
