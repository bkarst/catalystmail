// Mailbox OAuth (spec §13.4 †, session only): redirects to Google or Microsoft.
import { oauthStart } from '@catalyst/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ provider: string }> }) {
  return oauthStart(request, (await context.params).provider);
}
