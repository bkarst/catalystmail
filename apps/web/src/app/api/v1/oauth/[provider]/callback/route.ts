// Mailbox OAuth (spec §13.4 †, session only): the provider sends the person back here.
import { oauthCallback } from '@catalyst/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ provider: string }> }) {
  return oauthCallback(request, (await context.params).provider);
}
