// Google Postmaster Tools for a domain (spec §8.10, §13.4 †, session only): redirects to Google.
import { postmasterConnect } from '@catalyst/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ domainId: string }> }) {
  return postmasterConnect(request, (await context.params).domainId);
}
