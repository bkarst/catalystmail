// The open pixel (spec §9.1): `GET /t/o/{token}.gif`. Answers at once; the open is recorded after.

import { openPixel, publicDeps } from '@catalyst/server';
import { after } from 'next/server';

export const dynamic = 'force-dynamic';

async function handle(request: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  return openPixel(request, (await params).token, await publicDeps((task) => after(task)));
}

export { handle as GET, handle as HEAD };
