// The browser side of mailbox OAuth (spec §13.4 † `/oauth/{provider}/start` and `/callback`,
// session only): redirects rather than JSON, so they sit beside the contract's operations rather
// than in it. Start sends the admin to the provider with a signed state and a PKCE challenge
// (its verifier in a short-lived cookie); the callback finishes and returns them to the app.

import { randomUUID } from 'node:crypto';

import { authenticate } from '../api/auth.ts';
import { ApiError, problemResponse } from '../api/errors.ts';
import { authFor, getDb, getDeps } from '../runtime.ts';
import { finishOAuth, isOAuthProvider, PKCE_COOKIE, startMailboxOAuth, startPostmasterOAuth } from './oauth.ts';

const cookieOf = (request: Request, name: string) =>
  request.headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim().split('='))
    .find(([key]) => key === name)?.[1] ?? null;

async function context(request: Request, provider: string) {
  const deps = await getDeps();
  const db = getDb();
  const auth = deps.config.auth;
  const appUrl = deps.config.appUrl;
  if (!auth || !appUrl) throw new ApiError(404, 'not_found', 'Sign-in isn’t configured, so mailbox OAuth isn’t either.');
  if (!isOAuthProvider(provider)) throw new ApiError(404, 'not_found', `There is no OAuth provider ${provider}.`);
  const principal = await authenticate(db, request, new Date(), authFor(db, auth));
  // Session only: a person signs the mailbox in, never an API key.
  if (!principal || principal.kind !== 'user') throw new ApiError(401, 'unauthorized', 'Sign in to connect a mailbox.');
  if (!principal.scopes.includes('mailboxes:write')) throw new ApiError(403, 'forbidden_scope', 'Connecting a mailbox needs an owner or admin.');
  return { db, deps, principal, provider, stateKey: auth.secret, appUrl, secure: appUrl.startsWith('https://'), redirectUri: `${appUrl}/api/v1/oauth/${provider}/callback` };
}

/** GET `/api/v1/oauth/{provider}/start?email=…&display_name=…` */
export async function oauthStart(request: Request, provider: string): Promise<Response> {
  const requestId = `req_${randomUUID()}`;
  try {
    const ctx = await context(request, provider);
    const url = new URL(request.url);
    const email = url.searchParams.get('email');
    if (!email) throw new ApiError(400, 'validation_failed', undefined, [{ path: 'query.email', message: 'The mailbox address to connect.' }]);
    const { location, verifier } = await startMailboxOAuth(ctx.db, ctx.principal, ctx.provider as 'google' | 'microsoft', { email, display_name: url.searchParams.get('display_name') ?? email.split('@')[0]! }, { oauth: ctx.deps.oauth, stateKey: ctx.stateKey, redirectUri: ctx.redirectUri }, new Date());
    const cookie = `${PKCE_COOKIE}=${verifier}; Path=/api/v1/oauth; HttpOnly; SameSite=Lax; Max-Age=600${ctx.secure ? '; Secure' : ''}`;
    return new Response(null, { status: 302, headers: { location, 'set-cookie': cookie, 'x-request-id': requestId } });
  } catch (error) {
    if (error instanceof ApiError) return problemResponse(error, requestId);
    console.error(`[${requestId}] oauth start failed`, error);
    return problemResponse(new ApiError(500, 'internal_error'), requestId);
  }
}

/** GET `/api/v1/domains/{domainId}/postmaster/connect` (§8.10): Google consent for Postmaster Tools. */
export async function postmasterConnect(request: Request, domainId: string): Promise<Response> {
  const requestId = `req_${randomUUID()}`;
  try {
    const ctx = await context(request, 'google');
    const { location, verifier } = await startPostmasterOAuth(ctx.db, ctx.principal, domainId, { oauth: ctx.deps.oauth, stateKey: ctx.stateKey, redirectUri: ctx.redirectUri }, new Date());
    const cookie = `${PKCE_COOKIE}=${verifier}; Path=/api/v1/oauth; HttpOnly; SameSite=Lax; Max-Age=600${ctx.secure ? '; Secure' : ''}`;
    return new Response(null, { status: 302, headers: { location, 'set-cookie': cookie, 'x-request-id': requestId } });
  } catch (error) {
    if (error instanceof ApiError) return problemResponse(error, requestId);
    console.error(`[${requestId}] postmaster connect failed`, error);
    return problemResponse(new ApiError(500, 'internal_error'), requestId);
  }
}

/** GET `/api/v1/oauth/{provider}/callback?code=…&state=…`: back to the app, connected or with why not. */
export async function oauthCallback(request: Request, provider: string): Promise<Response> {
  const requestId = `req_${randomUUID()}`;
  let appUrl: string | null = null;
  const clear = `${PKCE_COOKIE}=; Path=/api/v1/oauth; HttpOnly; SameSite=Lax; Max-Age=0`;
  try {
    const ctx = await context(request, provider);
    appUrl = ctx.appUrl;
    const url = new URL(request.url);
    const result = await finishOAuth(
      ctx.db,
      ctx.principal,
      ctx.provider as 'google' | 'microsoft',
      { code: url.searchParams.get('code'), state: url.searchParams.get('state'), error: url.searchParams.get('error'), verifier: cookieOf(request, PKCE_COOKIE) },
      { oauth: ctx.deps.oauth, stateKey: ctx.stateKey, redirectUri: ctx.redirectUri, secrets: ctx.deps.secrets },
      new Date(),
    );
    // A mailbox stays pending until the connection test passes (§7.1); its page runs it.
    if (result.kind === 'postmaster') await ctx.deps.jobs.enqueue('deliverability.postmaster_sync', { domain_id: result.domainId });
    const location = result.kind === 'mailbox' ? `${ctx.appUrl}/deliverability/mailboxes/${result.mailboxId}?connected=1` : `${ctx.appUrl}/deliverability/domains/${result.domainId}?postmaster=connected`;
    return new Response(null, { status: 302, headers: { location, 'set-cookie': clear, 'x-request-id': requestId } });
  } catch (error) {
    const message = error instanceof ApiError ? error.message : 'Something went wrong connecting the mailbox.';
    if (!(error instanceof ApiError)) console.error(`[${requestId}] oauth callback failed`, error);
    if (!appUrl) return problemResponse(error instanceof ApiError ? error : new ApiError(500, 'internal_error'), requestId);
    return new Response(null, { status: 302, headers: { location: `${appUrl}/deliverability?oauth_error=${encodeURIComponent(message)}`, 'set-cookie': clear, 'x-request-id': requestId } });
  }
}
