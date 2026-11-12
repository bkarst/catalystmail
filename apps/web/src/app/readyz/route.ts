// Readiness: the app can reach its database.
import { sql } from 'drizzle-orm';

import { getDb } from '@catalyst/server';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    await getDb().execute(sql`select 1`);
    return Response.json({ status: 'ready' });
  } catch {
    return Response.json({ status: 'unavailable' }, { status: 503 });
  }
}
