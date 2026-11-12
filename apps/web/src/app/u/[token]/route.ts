// Unsubscribe (spec §8.8, §15.19): `GET /u/{token}` shows a confirmation page; `POST /u/{token}`
// is RFC 8058 one-click, the page's button, or its undo link.

import { publicDeps, unsubscribePage, unsubscribePost } from '@catalyst/server';
import { after } from 'next/server';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ token: string }> };

export async function GET(_request: Request, { params }: Context): Promise<Response> {
  return unsubscribePage((await params).token, await publicDeps((task) => after(task)));
}

export async function POST(request: Request, { params }: Context): Promise<Response> {
  return unsubscribePost(request, (await params).token, await publicDeps((task) => after(task)));
}
