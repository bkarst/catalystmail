// Tracked links (spec §9.3): `GET /t/c/{token}` redirects to the original URL.

import { publicDeps, trackedClick } from '@catalyst/server';
import { after } from 'next/server';

export const dynamic = 'force-dynamic';

async function handle(request: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const fallbackUrl = process.env.APP_URL ?? new URL('/', request.url).toString();
  return trackedClick(request, (await params).token, { ...(await publicDeps((task) => after(task))), fallbackUrl });
}

export { handle as GET, handle as HEAD };
