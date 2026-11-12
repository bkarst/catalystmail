// Signed-in people (spec §13.2, §16): Better Auth, email and password, sessions in Postgres,
// HTTP-only SameSite=Lax cookies (Secure outside development), login rate limiting. Sign-up is
// only for someone already invited (a `users` row with that email, §15.18 team), so a stranger
// can't make an account. A session maps to that row; its role decides what it may do.

import { scopeSchema, type Scope } from '@catalyst/contract';
import { audit_log, auth_accounts, auth_rate_limits, auth_sessions, auth_two_factors, auth_users, auth_verifications, users, workspaces, type Db } from '@catalyst/db';
import type { SystemMailer } from '@catalyst/email';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { twoFactor } from 'better-auth/plugins/two-factor';
import { and, eq, isNull, sql } from 'drizzle-orm';

import type { Principal } from '../api/auth.ts';

export interface AuthConfig {
  /** BETTER_AUTH_SECRET: signs session cookies. Without it, sign-in is off. */
  secret: string;
  /** The app's origin, from APP_URL; the auth routes live under `/api/auth`. */
  baseURL: string;
  /** Origins whose cookie-authenticated requests are accepted (CSRF, §16). */
  trustedOrigins: string[];
  /** Secure cookies; on unless the app is served over plain http (development). */
  secureCookies: boolean;
  /** The system SMTP (SYSTEM_SMTP_URL, §4.5), for password-reset mail; without it, no reset. */
  mailer?: SystemMailer | null;
}

const SESSION_DAYS = 7;
export const MIN_PASSWORD_LENGTH = 12;

export function createAuth(db: Db, config: AuthConfig) {
  return betterAuth({
    appName: 'Catalyst',
    secret: config.secret,
    baseURL: config.baseURL,
    basePath: '/api/auth',
    trustedOrigins: config.trustedOrigins,
    database: drizzleAdapter(db, { provider: 'pg', schema: { auth_users, auth_sessions, auth_accounts, auth_verifications, auth_rate_limits, auth_two_factors } }),
    // TOTP two-factor sign-in (§16), set up by each person; a workspace can require it of owners.
    plugins: [
      twoFactor({
        issuer: 'Catalyst',
        schema: {
          user: { fields: { twoFactorEnabled: 'two_factor_enabled' } },
          twoFactor: { modelName: 'auth_two_factors', fields: { userId: 'user_id', backupCodes: 'backup_codes', failedVerificationCount: 'failed_verification_count', lockedUntil: 'locked_until' } },
        },
      }),
    ],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      autoSignIn: true,
      resetPasswordTokenExpiresIn: 3600,
      // A reset ends every session, so someone who had the old password is signed out.
      revokeSessionsOnPasswordReset: true,
      ...(config.mailer && {
        sendResetPassword: async ({ user, url }) => {
          await config.mailer!.send({
            to: user.email,
            subject: 'Reset your Catalyst password',
            text: `Someone asked to reset the password for ${user.email}. If it was you, set a new one here (the link works for an hour):\n\n${url}\n\nIf it wasn't you, ignore this email; your password stays as it is.`,
          });
        },
      }),
      onPasswordReset: async ({ user }) => {
        const [person] = await db.select({ id: users.id, workspace_id: users.workspace_id }).from(users).where(eq(users.email, user.email));
        if (person) await db.insert(audit_log).values({ workspace_id: person.workspace_id, actor_type: 'user', actor_id: person.id, action: 'user.password_reset', target_type: 'user', target_id: person.id, diff: {} });
      },
    },
    user: { modelName: 'auth_users', fields: { emailVerified: 'email_verified', createdAt: 'created_at', updatedAt: 'updated_at' } },
    session: {
      modelName: 'auth_sessions',
      fields: { userId: 'user_id', expiresAt: 'expires_at', ipAddress: 'ip_address', userAgent: 'user_agent', createdAt: 'created_at', updatedAt: 'updated_at' },
      expiresIn: SESSION_DAYS * 86_400,
      updateAge: 86_400,
    },
    account: {
      modelName: 'auth_accounts',
      fields: {
        userId: 'user_id',
        accountId: 'account_id',
        providerId: 'provider_id',
        accessToken: 'access_token',
        refreshToken: 'refresh_token',
        idToken: 'id_token',
        accessTokenExpiresAt: 'access_token_expires_at',
        refreshTokenExpiresAt: 'refresh_token_expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    verification: { modelName: 'auth_verifications', fields: { expiresAt: 'expires_at', createdAt: 'created_at', updatedAt: 'updated_at' } },
    // Login throttling (§16): a few attempts a minute per address, shared by every app process.
    rateLimit: {
      enabled: true,
      storage: 'database',
      modelName: 'auth_rate_limits',
      fields: { lastRequest: 'last_request' },
      window: 60,
      max: 100,
      customRules: { '/sign-in/email': { window: 60, max: 5 }, '/sign-up/email': { window: 60, max: 5 } },
    },
    advanced: { useSecureCookies: config.secureCookies, cookiePrefix: 'catalyst' },
    telemetry: { enabled: false },
    databaseHooks: {
      user: {
        create: {
          // Only people invited to a workspace may make an account.
          before: async (user) => {
            const [invited] = await db.select({ id: users.id }).from(users).where(and(eq(users.email, user.email), isNull(users.deactivated_at)));
            return invited ? undefined : false;
          },
        },
      },
      session: {
        create: {
          // §16 audit log: logins.
          after: async (session) => {
            const person = await personFor(db, session.userId);
            if (!person) return;
            await db.update(users).set({ last_login_at: new Date() }).where(eq(users.id, person.id));
            await db.insert(audit_log).values({ workspace_id: person.workspace_id, actor_type: 'user', actor_id: person.id, action: 'user.login', target_type: 'user', target_id: person.id, diff: {}, ...(session.ipAddress && /^[0-9a-f.:]+$/i.test(session.ipAddress) && { ip: session.ipAddress }), user_agent: session.userAgent ?? null });
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

/** The Catalyst person behind an auth user: the active `users` row with the same email. */
async function personFor(db: Db, authUserId: string) {
  const [person] = await db
    .select({ id: users.id, name: users.name, role: users.role, workspace_id: users.workspace_id, workspace_name: workspaces.name, workspace_settings: workspaces.settings, two_factor: auth_users.two_factor_enabled })
    .from(auth_users)
    .innerJoin(users, sql`${users.email} = ${auth_users.email}`)
    .innerJoin(workspaces, eq(workspaces.id, users.workspace_id))
    .where(and(eq(auth_users.id, authUserId), isNull(users.deactivated_at)));
  return person ?? null;
}

/** §16: "required for owners when enabled at workspace level". */
export const requiresOwnerTwoFactor = (settings: unknown): boolean => (settings as { security?: { require_owner_two_factor?: boolean } } | null)?.security?.require_owner_two_factor === true;

const ALL_SCOPES = scopeSchema.options as readonly Scope[];
const MEMBER_EXCLUDED: readonly Scope[] = ['settings:manage', 'webhooks:manage', 'mailboxes:write', 'contacts:erase'];

/**
 * §16 roles as scopes. Owners and admins may do everything; members work campaigns, contacts,
 * threads and escalations (and send) but not settings, webhooks, mailboxes or erasure; viewers read.
 */
export function scopesForRole(role: NonNullable<Principal['role']>): Scope[] {
  if (role === 'owner' || role === 'admin') return [...ALL_SCOPES];
  if (role === 'member') return ALL_SCOPES.filter((scope) => !MEMBER_EXCLUDED.includes(scope));
  return ALL_SCOPES.filter((scope) => scope.endsWith(':read'));
}

/** The person signed in with this request's session cookie, if any. */
export async function sessionPrincipal(db: Db, auth: Auth, headers: Headers): Promise<Principal | null> {
  const session = await auth.api.getSession({ headers });
  if (!session) return null;
  const person = await personFor(db, session.user.id);
  if (!person) return null;
  const needsTwoFactor = person.role === 'owner' && requiresOwnerTwoFactor(person.workspace_settings) && !person.two_factor;
  return { kind: 'user', id: person.id, name: person.name, role: person.role, scopes: scopesForRole(person.role), workspace: { id: person.workspace_id, name: person.workspace_name }, ...(needsTwoFactor && { needsTwoFactor }) };
}

/**
 * CSRF (§16) for the API's cookie-authenticated mutations: the browser must say it came from one
 * of our own origins. SameSite=Lax already keeps the cookie off most cross-site requests.
 */
export function sameOrigin(request: Request, trustedOrigins: readonly string[]): boolean {
  const origin = request.headers.get('origin');
  if (origin) return trustedOrigins.includes(origin);
  return request.headers.get('sec-fetch-site') === 'same-origin';
}
