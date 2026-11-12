// Process-wide resources for the web app. The database handle is created on first use from
// DATABASE_URL and kept on `globalThis`, so development reloads don't open a new pool each time.
// Services that reach outside the process (DNS, …) are collected in `AppDeps`, so tests can swap
// them for fakes.

import { anthropicClaude, typesafeJev, type ClaudeClient, type JevClient } from '@catalyst/ai';
import { createDb, pgActivityFeed, type ActivityFeed, type Db } from '@catalyst/db';

import type { RateLimits } from './api/rate-limit.ts';
import { createAuth, type Auth, type AuthConfig } from './auth/session.ts';
import { checkVapidKeys, type VapidKeys } from './notifications/web-push.ts';
import { oauthFromEnv, type OAuthConfig } from './sending/oauth.ts';
import { pinnedJevModel } from './agent/jev.ts';
import { imapflowConnector, nodemailerTransport, systemDomainDns, systemMailDns, systemMailer, type DomainDns, type ImapConnector, type MailDns, type SmtpTransport } from '@catalyst/email';
import { PgBossQueue, type JobQueue } from '@catalyst/jobs';
import { storageFromEnv, type ObjectStorage } from '@catalyst/storage';

import { secretBoxFromEnv, type SecretBox } from './secrets.ts';
import { httpsWebhookNet, type WebhookNet } from './webhooks/net.ts';

export interface AppDeps {
  /** DNS for address verification (§8.5). */
  dns: MailDns;
  /** The job queue the API enqueues into (D7). */
  jobs: JobQueue;
  /** Object storage for imports, raw email and attachments. */
  storage: ObjectStorage;
  /** DNS for domain checks (§8.2). */
  domainDns: DomainDns;
  /** Encrypts credentials and other secrets at rest (§16). */
  secrets: SecretBox;
  /** SMTP, for the connection test's self-addressed message (§7.1). */
  smtp: SmtpTransport;
  /** IMAP, for the connection test (§7.1). */
  imap: ImapConnector;
  /** Outbound HTTPS to webhook endpoints, refusing private addresses (§13.6). */
  webhookNet: WebhookNet;
  /** The Claude client when AI_ENABLED=true (§10.2); null keeps the agent off. */
  claude: ClaudeClient | null;
  /** New activities as they are written, for the SSE stream (LISTEN/NOTIFY, §4.2). */
  activityFeed: ActivityFeed;
  /** Google and Microsoft OAuth clients for mailboxes (§7.1); null when neither is set up. */
  oauth: OAuthConfig | null;
  /** Jev, TypeSafe's classifier (§10.4); null when it isn't set up. */
  jev: JevClient | null;
  config: AppConfig;
}

export interface AppConfig {
  /** §13.3: requests per key per minute; the default is 600, and 60 for sending operations. */
  rateLimits?: RateLimits;
  /** Sign-in (§16), from BETTER_AUTH_SECRET and APP_URL; null leaves only API keys. */
  auth?: AuthConfig | null;
  /** Browser push (§11.2), from VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT. */
  vapid?: VapidKeys | null;
  /** Jev's pinned model (§10.4), from TYPESAFE_MODEL, e.g. jev-1.13.0; null leaves Jev off. */
  jevModel?: string | null;
  /** The host a sending domain's tracking CNAME must point at. */
  trackingTarget: string | null;
  /** The app's own host, from APP_URL: links fall back to it when a domain has no tracking host. */
  appHost: string | null;
  /** APP_URL itself, for links in notification mail. */
  appUrl?: string | null;
  /** AI_ENABLED=true: the agent answers human replies through the Claude API (§10). */
  aiEnabled?: boolean;
  /** The key per-campaign canary tokens come from (§10.3): AI_CANARY_SECRET, else the tracking secret. */
  canarySecret?: string | null;
  /** TRACKING_SIGNING_SECRET: the HMAC key of open, click and unsubscribe tokens (§9.1). */
  trackingSecret?: string | null;
  /** SPAMHAUS_DQS_KEY: Spamhaus Data Query Service key, needed for commercial blocklist lookups (§8.10). */
  spamhausDqsKey?: string | null;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): AppConfig {
  let appHost: string | null = null;
  try {
    appHost = env.APP_URL ? new URL(env.APP_URL).hostname : null;
  } catch {
    appHost = null;
  }
  const appUrl = env.APP_URL?.replace(/\/$/, '') ?? null;
  const mailer = env.SYSTEM_SMTP_URL && env.SYSTEM_FROM ? systemMailer(env.SYSTEM_SMTP_URL, env.SYSTEM_FROM) : null;
  const auth: AuthConfig | null = env.BETTER_AUTH_SECRET && appUrl ? { secret: env.BETTER_AUTH_SECRET, baseURL: appUrl, trustedOrigins: [new URL(appUrl).origin], secureCookies: appUrl.startsWith('https://'), mailer } : null;
  const vapid: VapidKeys | null = env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY ? { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT ?? appUrl ?? 'mailto:postmaster@localhost' } : null;
  if (vapid) checkVapidKeys(vapid);
  const jevModel = env.TYPESAFE_API_KEY ? pinnedJevModel(env.TYPESAFE_MODEL) : null;
  if (env.TYPESAFE_API_KEY && !jevModel) console.warn('[catalyst] TYPESAFE_API_KEY is set but TYPESAFE_MODEL is not a pinned version such as jev-1.13.0, so Jev stays off (§10.4).');
  return { auth, vapid, jevModel, trackingTarget: env.TRACKING_CNAME_TARGET ?? appHost, appHost, trackingSecret: env.TRACKING_SIGNING_SECRET ?? null, spamhausDqsKey: env.SPAMHAUS_DQS_KEY ?? null, appUrl: env.APP_URL?.replace(/\/$/, '') ?? null, aiEnabled: env.AI_ENABLED === 'true', canarySecret: env.AI_CANARY_SECRET ?? env.TRACKING_SIGNING_SECRET ?? null };
}

/** Reads ENCRYPTION_KEYS on first use, so the app starts (and serves everything else) without it. */
function lazySecretBox(): SecretBox {
  let box: SecretBox | undefined;
  const get = () => (box ??= secretBoxFromEnv());
  return {
    get activeVersion() {
      return get().activeVersion;
    },
    seal: (plaintext) => get().seal(plaintext),
    open: (sealed) => get().open(sealed),
  };
}

/** Connects to LISTEN only when the first stream opens. */
function lazyActivityFeed(): ActivityFeed {
  let feed: ActivityFeed | undefined;
  const get = () => {
    if (!feed) {
      const url = process.env.DATABASE_URL;
      if (!url) throw new Error('DATABASE_URL is not set');
      feed = pgActivityFeed(url);
    }
    return feed;
  };
  return { subscribe: (listener) => get().subscribe(listener), close: async () => feed?.close() };
}

const holder = globalThis as typeof globalThis & { __catalystDb?: Db; __catalystDeps?: Partial<AppDeps> };

export function getDb(): Db {
  if (!holder.__catalystDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    holder.__catalystDb = createDb(url).db;
  }
  return holder.__catalystDb;
}

const auths = new WeakMap<Db, { config: AuthConfig; auth: Auth }>();

/** Better Auth for this database, or null when sign-in isn't configured. */
export function authFor(db: Db, config: AuthConfig | null | undefined): Auth | null {
  if (!config) return null;
  const cached = auths.get(db);
  if (cached && cached.config === config) return cached.auth;
  const auth = createAuth(db, config);
  auths.set(db, { config, auth });
  return auth;
}

/** The `/api/auth/*` routes (sign-up, sign-in, sign-out, session); 404 while sign-in is off. */
export async function authHandler(request: Request): Promise<Response> {
  const auth = authFor(getDb(), (await getDeps()).config.auth);
  if (!auth) return new Response('Sign-in is not configured (BETTER_AUTH_SECRET, APP_URL).', { status: 404 });
  return auth.handler(request);
}

/** Points the app at a specific database. Tests use this with a freshly migrated one. */
export function setDb(db: Db | undefined): void {
  holder.__catalystDb = db;
}

export async function getDeps(): Promise<AppDeps> {
  const deps = (holder.__catalystDeps ??= {});
  deps.dns ??= await systemMailDns();
  deps.storage ??= storageFromEnv();
  deps.domainDns ??= await systemDomainDns();
  deps.secrets ??= lazySecretBox();
  deps.config ??= configFromEnv();
  deps.smtp ??= nodemailerTransport();
  deps.imap ??= imapflowConnector();
  deps.webhookNet ??= httpsWebhookNet();
  if (deps.claude === undefined) deps.claude = deps.config.aiEnabled ? anthropicClaude() : null;
  deps.activityFeed ??= lazyActivityFeed();
  if (deps.oauth === undefined) deps.oauth = oauthFromEnv();
  if (deps.jev === undefined) deps.jev = deps.config.jevModel ? typesafeJev() : null;
  if (!deps.jobs) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    deps.jobs = new PgBossQueue({ connectionString: url, role: 'producer' });
  }
  return deps as AppDeps;
}

/** Replaces some dependencies, e.g. with fakes in tests. */
export function setDeps(deps: Partial<AppDeps> | undefined): void {
  holder.__catalystDeps = deps ? { ...holder.__catalystDeps, ...deps } : undefined;
}

/** The person signed in with these request headers (a page's cookies), or null: for the UI's server components. */
export async function signedInPerson(headers: Headers): Promise<import('./api/auth.ts').Principal | null> {
  const db = getDb();
  const auth = authFor(db, (await getDeps()).config.auth);
  if (!auth) return null;
  const { sessionPrincipal } = await import('./auth/session.ts');
  return sessionPrincipal(db, auth, headers);
}
