// Mailbox OAuth (spec §7.1, §13.4 `/oauth/{provider}/start` · `/callback`, session only): Google
// Workspace and Microsoft 365 mailboxes sign in to SMTP and IMAP with XOAUTH2. A signed-in admin
// starts the flow for an address; the provider asks the mailbox's owner to allow it; the callback
// checks the account is that address, keeps the refresh token sealed like a password (§16), and
// adds or updates the mailbox, pending its connection test. Access tokens are refreshed just
// before SMTP or IMAP needs one.

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { emailDomain, mailboxes, newId, normalizeEmail, sending_domains, type Db, type Executor } from '@catalyst/db';
import { and, eq } from 'drizzle-orm';

import type { Principal } from '../api/auth.ts';
import { ApiError, conflict } from '../api/errors.ts';
import type { SecretBox } from '../secrets.ts';
import { audit } from '../shared.ts';
import { MAILBOX_DEFAULTS, PRESETS } from './mailboxes.ts';

export type OAuthProvider = 'google' | 'microsoft';
type MailboxRow = typeof mailboxes.$inferSelect;

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
}

/** Form POSTs to a provider's token endpoint; injectable, so tests never reach Google or Microsoft. */
export interface OAuthHttp {
  postForm(url: string, form: Record<string, string>): Promise<{ status: number; body: Record<string, unknown> }>;
}

export interface OAuthConfig {
  google?: OAuthClient | null;
  microsoft?: OAuthClient | null;
  http: OAuthHttp;
}

const PROVIDERS: Record<OAuthProvider, { authorize: string; token: string; scopes: string[]; extra: Record<string, string>; auth: MailboxRow['auth'] }> = {
  google: {
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    scopes: ['https://mail.google.com/', 'openid', 'email'],
    // A refresh token comes only with offline access, and again only on consent.
    extra: { access_type: 'offline', prompt: 'consent' },
    auth: 'oauth2_google',
  },
  microsoft: {
    authorize: 'https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize',
    token: 'https://login.microsoftonline.com/organizations/oauth2/v2.0/token',
    scopes: ['https://outlook.office.com/SMTP.Send', 'https://outlook.office.com/IMAP.AccessAsUser.All', 'offline_access', 'openid', 'email'],
    extra: { prompt: 'select_account' },
    auth: 'oauth2_microsoft',
  },
};

export const isOAuthProvider = (value: string): value is OAuthProvider => value === 'google' || value === 'microsoft';
const providerOfAuth = (auth: MailboxRow['auth']): OAuthProvider | null => (auth === 'oauth2_google' ? 'google' : auth === 'oauth2_microsoft' ? 'microsoft' : null);

/** The default HTTP: `fetch`, form-encoded. */
export const fetchOAuthHttp: OAuthHttp = {
  async postForm(url, form) {
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: new URLSearchParams(form), signal: AbortSignal.timeout(15_000) });
    return { status: response.status, body: ((await response.json().catch(() => ({}))) ?? {}) as Record<string, unknown> };
  },
};

// ── State: who asked, for which address, signed so the callback can trust it ────────────────────

interface State {
  /** A mailbox's SMTP and IMAP, or a domain's Postmaster Tools data (§8.10). */
  purpose: 'mailbox' | 'postmaster';
  provider: OAuthProvider;
  domainId?: string;
  workspaceId: string;
  userId: string;
  email: string;
  displayName: string;
  expiresAt: number;
}

const STATE_TTL_MS = 10 * 60_000;
const sign = (payload: string, key: string) => createHmac('sha256', key).update(payload).digest('base64url');

function sealState(state: State, key: string): string {
  const payload = Buffer.from(JSON.stringify(state)).toString('base64url');
  return `${payload}.${sign(payload, key)}`;
}

function openState(token: string, key: string, now: Date): State | null {
  const [payload, mac] = token.split('.');
  if (!payload || !mac) return null;
  const expected = Buffer.from(sign(payload, key));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const state = JSON.parse(Buffer.from(payload, 'base64url').toString()) as State;
  return state.expiresAt > now.getTime() ? state : null;
}

export const PKCE_COOKIE = 'catalyst_oauth_pkce';

function client(config: OAuthConfig | null | undefined, provider: OAuthProvider): OAuthClient {
  const found = config?.[provider];
  if (!found) throw conflict(`${provider === 'google' ? 'Google' : 'Microsoft'} sign-in isn’t set up on this server (${provider.toUpperCase()}_OAUTH_CLIENT_ID and _SECRET).`);
  return found;
}

/** The provider's consent page for this address, and the PKCE verifier to keep in a cookie. */
export async function startMailboxOAuth(
  db: Db,
  principal: Principal,
  provider: OAuthProvider,
  input: { email: string; display_name: string },
  deps: { oauth: OAuthConfig | null | undefined; stateKey: string; redirectUri: string },
  now: Date,
): Promise<{ location: string; verifier: string }> {
  const { clientId } = client(deps.oauth, provider);
  const email = normalizeEmail(input.email);
  const [domain] = await db.select({ id: sending_domains.id }).from(sending_domains).where(and(eq(sending_domains.workspace_id, principal.workspace.id), eq(sending_domains.domain, emailDomain(email))));
  if (!domain) throw new ApiError(400, 'validation_failed', undefined, [{ path: 'query.email', message: `Add the domain ${emailDomain(email)} with createDomain first.` }]);

  const verifier = randomBytes(32).toString('base64url');
  const state = sealState({ purpose: 'mailbox', provider, workspaceId: principal.workspace.id, userId: principal.id, email, displayName: input.display_name, expiresAt: now.getTime() + STATE_TTL_MS }, deps.stateKey);
  return { location: consentUrl(PROVIDERS[provider].authorize, { client_id: clientId, redirect_uri: deps.redirectUri, scope: PROVIDERS[provider].scopes.join(' '), state, login_hint: email, ...PROVIDERS[provider].extra }, verifier), verifier };
}

function consentUrl(authorize: string, params: Record<string, string>, verifier: string): string {
  const url = new URL(authorize);
  for (const [name, value] of Object.entries({ ...params, response_type: 'code', code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' })) url.searchParams.set(name, value);
  return url.toString();
}

/** §8.10: Google Postmaster Tools, read-only, connected per domain from its page (session only). */
export const POSTMASTER_SCOPE = 'https://www.googleapis.com/auth/postmaster.traffic.readonly';

export async function startPostmasterOAuth(db: Db, principal: Principal, domainId: string, deps: { oauth: OAuthConfig | null | undefined; stateKey: string; redirectUri: string }, now: Date): Promise<{ location: string; verifier: string }> {
  const { clientId } = client(deps.oauth, 'google');
  const [domain] = await db.select({ id: sending_domains.id }).from(sending_domains).where(and(eq(sending_domains.id, domainId), eq(sending_domains.workspace_id, principal.workspace.id)));
  if (!domain) throw new ApiError(404, 'not_found', 'The domain was not found in this workspace.');
  const verifier = randomBytes(32).toString('base64url');
  const state = sealState({ purpose: 'postmaster', provider: 'google', domainId, workspaceId: principal.workspace.id, userId: principal.id, email: '', displayName: '', expiresAt: now.getTime() + STATE_TTL_MS }, deps.stateKey);
  return { location: consentUrl(PROVIDERS.google.authorize, { client_id: clientId, redirect_uri: deps.redirectUri, scope: POSTMASTER_SCOPE, state, access_type: 'offline', prompt: 'consent' }, verifier), verifier };
}

/** The email the provider says signed in, from the ID token it just gave over TLS. */
function emailOf(idToken: unknown): string | null {
  if (typeof idToken !== 'string') return null;
  try {
    const claims = JSON.parse(Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString()) as { email?: string; preferred_username?: string; upn?: string };
    const email = claims.email ?? claims.preferred_username ?? claims.upn;
    return email ? normalizeEmail(email) : null;
  } catch {
    return null;
  }
}

interface Credentials {
  refresh_token: string;
  access_token: string;
  expires_at: string;
}

export type OAuthResult = { kind: 'mailbox'; mailboxId: string; created: boolean } | { kind: 'postmaster'; domainId: string };

/** The callback: checks who asked and who signed in, then adds or updates the mailbox, or connects Postmaster Tools. */
export async function finishOAuth(
  db: Db,
  principal: Principal,
  provider: OAuthProvider,
  input: { code: string | null; state: string | null; error: string | null; verifier: string | null },
  deps: { oauth: OAuthConfig | null | undefined; stateKey: string; redirectUri: string; secrets: SecretBox },
  now: Date,
): Promise<OAuthResult> {
  if (input.error) throw conflict(`The provider didn’t allow access (${input.error}).`);
  const state = input.state ? openState(input.state, deps.stateKey, now) : null;
  if (!state || state.provider !== provider) throw conflict('This sign-in link is invalid or expired; start again.');
  if (state.userId !== principal.id || state.workspaceId !== principal.workspace.id) throw conflict('This sign-in was started by someone else.');
  if (!input.code || !input.verifier) throw conflict('The provider’s answer is incomplete; start again.');

  const { clientId, clientSecret } = client(deps.oauth, provider);
  const token = await deps.oauth!.http.postForm(PROVIDERS[provider].token, { grant_type: 'authorization_code', code: input.code, redirect_uri: deps.redirectUri, client_id: clientId, client_secret: clientSecret, code_verifier: input.verifier });
  if (token.status !== 200 || typeof token.body.access_token !== 'string') throw conflict(`The provider refused the sign-in (${String(token.body.error ?? token.status)}).`);
  if (typeof token.body.refresh_token !== 'string') throw conflict('The provider gave no refresh token, so Catalyst couldn’t keep access. Remove Catalyst’s access in the account’s security settings and connect again.');
  const expiresAt = new Date(now.getTime() + Number(token.body.expires_in ?? 3600) * 1000).toISOString();

  if (state.purpose === 'postmaster') {
    const sealedToken = deps.secrets.seal(JSON.stringify({ refresh_token: token.body.refresh_token, access_token: token.body.access_token, expires_at: expiresAt }));
    const [domain] = await db
      .update(sending_domains)
      .set({ postmaster_connected: true, postmaster_credentials_enc: sealedToken, postmaster_credentials_key_version: deps.secrets.activeVersion })
      .where(and(eq(sending_domains.id, state.domainId!), eq(sending_domains.workspace_id, principal.workspace.id)))
      .returning({ id: sending_domains.id });
    if (!domain) throw conflict('The domain was removed meanwhile.');
    await audit(db, principal, 'domain.postmaster_connected', { type: 'domain', id: domain.id }, {}, now);
    return { kind: 'postmaster', domainId: domain.id };
  }

  const signedIn = emailOf(token.body.id_token);
  if (signedIn !== state.email) throw conflict(`You signed in as ${signedIn ?? 'an unknown account'}, not ${state.email}. Sign in with the mailbox’s own account.`);

  const credentials: Credentials = { refresh_token: token.body.refresh_token, access_token: token.body.access_token, expires_at: expiresAt };
  const sealed = deps.secrets.seal(JSON.stringify(credentials));
  const preset = PRESETS[provider];
  const connection = { auth: PROVIDERS[provider].auth, smtp_host: preset.smtp_host, smtp_port: preset.smtp_port, smtp_secure: preset.smtp_secure, smtp_username: state.email, imap_host: preset.imap_host, imap_port: 993, imap_username: state.email, credentials_enc: sealed, credentials_key_version: deps.secrets.activeVersion, status: 'pending' as const, status_reason: null, updated_at: now };

  return db.transaction(async (tx) => {
    const [domain] = await tx.select({ id: sending_domains.id }).from(sending_domains).where(and(eq(sending_domains.workspace_id, principal.workspace.id), eq(sending_domains.domain, emailDomain(state.email))));
    if (!domain) throw conflict(`The domain ${emailDomain(state.email)} was removed meanwhile.`);
    const [existing] = await tx.select({ id: mailboxes.id }).from(mailboxes).where(and(eq(mailboxes.workspace_id, principal.workspace.id), eq(mailboxes.email, state.email)));
    let mailboxId: string;
    if (existing) {
      await tx.update(mailboxes).set(connection).where(eq(mailboxes.id, existing.id));
      mailboxId = existing.id;
    } else {
      mailboxId = newId('mailbox');
      await tx.insert(mailboxes).values({ id: mailboxId, workspace_id: principal.workspace.id, sending_domain_id: domain.id, email: state.email, display_name: state.displayName, folders: preset.folders, ...MAILBOX_DEFAULTS, warmup_started_at: now.toISOString().slice(0, 10), created_at: now, ...connection });
    }
    await audit(tx, principal, existing ? 'mailbox.credentials_changed' : 'mailbox.connected', { type: 'mailbox', id: mailboxId }, { email: state.email, provider, auth: 'oauth2' }, now);
    return { kind: 'mailbox' as const, mailboxId, created: !existing };
  });
}

// ── Access tokens, kept fresh for SMTP and IMAP ──────────────────────────────────────────────────

const REFRESH_MARGIN_MS = 60_000;

/**
 * A usable access token for an OAuth mailbox: the stored one while it has a minute left, else a
 * new one from the refresh token (kept, with any rotated refresh token). A refused refresh puts
 * the mailbox in error, so a person reconnects it, and throws.
 */
export async function freshAccessToken(db: Executor, mailbox: MailboxRow, secrets: SecretBox, oauth: OAuthConfig | null | undefined, now: Date): Promise<string> {
  const provider = providerOfAuth(mailbox.auth);
  if (!provider) throw new Error('Not an OAuth mailbox.');
  const fresh = await renewIfDue(provider, mailbox.credentials_enc, secrets, oauth, now);
  if (fresh.kind === 'refused') {
    if (fresh.reason === 'invalid_grant') {
      await db.update(mailboxes).set({ status: 'error', status_reason: `${provider === 'google' ? 'Google' : 'Microsoft'} no longer accepts Catalyst’s access (invalid_grant). Connect the mailbox again.`, updated_at: now }).where(eq(mailboxes.id, mailbox.id));
    }
    throw new Error(`Refreshing the OAuth token failed: ${fresh.reason}`);
  }
  if (fresh.sealed) await db.update(mailboxes).set({ credentials_enc: fresh.sealed, credentials_key_version: secrets.activeVersion }).where(eq(mailboxes.id, mailbox.id));
  return fresh.accessToken;
}

/**
 * The stored access token while it has a minute left; otherwise a new one from the refresh token,
 * sealed again (with any rotated refresh token) for the caller to keep.
 */
export async function renewIfDue(provider: OAuthProvider, sealedCredentials: Buffer, secrets: SecretBox, oauth: OAuthConfig | null | undefined, now: Date): Promise<{ kind: 'ok'; accessToken: string; sealed: Buffer | null } | { kind: 'refused'; reason: string }> {
  const credentials = JSON.parse(secrets.open(sealedCredentials)) as Partial<Credentials>;
  if (credentials.access_token && credentials.expires_at && Date.parse(credentials.expires_at) - now.getTime() > REFRESH_MARGIN_MS) return { kind: 'ok', accessToken: credentials.access_token, sealed: null };
  const { clientId, clientSecret } = client(oauth, provider);
  const answer = await oauth!.http.postForm(PROVIDERS[provider].token, {
    grant_type: 'refresh_token',
    refresh_token: credentials.refresh_token ?? '',
    client_id: clientId,
    client_secret: clientSecret,
    ...(provider === 'microsoft' && { scope: PROVIDERS.microsoft.scopes.join(' ') }),
  });
  if (answer.status !== 200 || typeof answer.body.access_token !== 'string') return { kind: 'refused', reason: String(answer.body.error ?? answer.status) };
  const renewed: Credentials = { refresh_token: typeof answer.body.refresh_token === 'string' ? answer.body.refresh_token : credentials.refresh_token!, access_token: answer.body.access_token, expires_at: new Date(now.getTime() + Number(answer.body.expires_in ?? 3600) * 1000).toISOString() };
  return { kind: 'ok', accessToken: renewed.access_token, sealed: secrets.seal(JSON.stringify(renewed)) };
}

/** OAuth clients from GOOGLE_OAUTH_CLIENT_ID/SECRET and MICROSOFT_OAUTH_CLIENT_ID/SECRET (§4.5). */
export function oauthFromEnv(env: NodeJS.ProcessEnv = process.env): OAuthConfig | null {
  const pair = (id?: string, secret?: string) => (id && secret ? { clientId: id, clientSecret: secret } : null);
  const google = pair(env.GOOGLE_OAUTH_CLIENT_ID, env.GOOGLE_OAUTH_CLIENT_SECRET);
  const microsoft = pair(env.MICROSOFT_OAUTH_CLIENT_ID, env.MICROSOFT_OAUTH_CLIENT_SECRET);
  return google || microsoft ? { google, microsoft, http: fetchOAuthHttp } : null;
}
