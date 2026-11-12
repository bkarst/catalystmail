import { route } from '@catalyst/server';

// A long-lived stream: never cached or prerendered.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = route('streamEvents');
