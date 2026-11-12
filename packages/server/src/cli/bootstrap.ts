// Bootstrap from the command line: a first workspace with its owner, and API keys, while there is
// no sign-in yet (session auth comes with the UI). Every change is audited as the system.
//
//   DATABASE_URL=… pnpm --filter @catalyst/server catalyst workspace --name Acme \
//     --address "500 Howard St, San Francisco, CA 94105" --owner-email you@getacme.com --owner-name "Your Name"
//   DATABASE_URL=… pnpm --filter @catalyst/server catalyst api-key --workspace wsp_… --name "Claude Code" --scopes threads:read,threads:write
//   DATABASE_URL=… pnpm --filter @catalyst/server catalyst api-key --workspace wsp_… --name "Admin" --all-scopes
//   DATABASE_URL=… pnpm --filter @catalyst/server catalyst revoke-api-key --key key_…

import { parseArgs } from 'node:util';

import { scopeSchema } from '@catalyst/contract';
import { api_keys, audit_log, createDb, newId, users, workspaces, type Db } from '@catalyst/db';
import { and, eq, isNull } from 'drizzle-orm';

import { insertApiKey } from '../api-keys/service.ts';
import { ApiError } from '../api/errors.ts';
import { generateVapidKeys } from '../notifications/web-push.ts';

export interface CliOutput {
  write(line: string): void;
}

const USAGE = `Usage:
  catalyst workspace --name <name> --address <postal address> --owner-email <email> --owner-name <name> [--timezone <IANA zone>]
  catalyst api-key --workspace <wsp_…> --name <name> (--scopes <a,b,…> | --all-scopes) [--expires-at <ISO time>]
  catalyst revoke-api-key --key <key_…>
  catalyst vapid-keys          (a new key pair for browser push: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)`;

const systemAudit = (db: Db, workspaceId: string, action: string, target: { type: string; id: string }, diff: Record<string, unknown>, now: Date) =>
  db.insert(audit_log).values({ workspace_id: workspaceId, actor_type: 'system', actor_id: 'cli', action, target_type: target.type, target_id: target.id, diff, created_at: now });

/** Runs one command; returns the exit code. */
export async function runCli(db: Db, argv: string[], out: CliOutput, now = new Date()): Promise<number> {
  const [command, ...rest] = argv;
  const { values } = parseArgs({
    args: rest,
    options: {
      name: { type: 'string' },
      address: { type: 'string' },
      timezone: { type: 'string' },
      'owner-email': { type: 'string' },
      'owner-name': { type: 'string' },
      workspace: { type: 'string' },
      scopes: { type: 'string' },
      'all-scopes': { type: 'boolean' },
      'expires-at': { type: 'string' },
      key: { type: 'string' },
    },
    strict: true,
  });
  const fail = (message: string) => {
    out.write(`${message}\n\n${USAGE}`);
    return 2;
  };

  if (command === 'workspace') {
    if (!values.name || !values.address || !values['owner-email'] || !values['owner-name']) return fail('workspace needs --name, --address, --owner-email and --owner-name.');
    const timezone = values.timezone ?? 'UTC';
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    } catch {
      return fail(`${timezone} is not an IANA timezone.`);
    }
    const workspaceId = newId('workspace');
    const userId = newId('user');
    await db.transaction(async (tx) => {
      await tx.insert(workspaces).values({ id: workspaceId, name: values.name!, physical_address: values.address!, default_timezone: timezone, created_at: now, updated_at: now });
      await tx.insert(users).values({ id: userId, workspace_id: workspaceId, email: values['owner-email']!.trim().toLowerCase(), name: values['owner-name']!, role: 'owner', created_at: now, updated_at: now });
      await tx.insert(audit_log).values({ workspace_id: workspaceId, actor_type: 'system', actor_id: 'cli', action: 'workspace.created', target_type: 'workspace', target_id: workspaceId, diff: { owner: userId }, created_at: now });
    });
    out.write(JSON.stringify({ workspace_id: workspaceId, owner_user_id: userId }, null, 2));
    return 0;
  }

  if (command === 'api-key') {
    if (!values.workspace || !values.name || (!values.scopes && !values['all-scopes'])) return fail('api-key needs --workspace, --name and --scopes or --all-scopes.');
    const [workspace] = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, values.workspace));
    if (!workspace) return fail(`No workspace ${values.workspace}.`);
    const scopes = values['all-scopes'] ? [...scopeSchema.options] : values.scopes!.split(',').map((scope) => scope.trim()).filter(Boolean);
    const [owner] = await db.select({ id: users.id }).from(users).where(and(eq(users.workspace_id, workspace.id), eq(users.role, 'owner'), isNull(users.deactivated_at))).limit(1);
    try {
      const { row, secret } = await insertApiKey(db, { workspaceId: workspace.id, name: values.name, scopes, expiresAt: values['expires-at'] ? new Date(values['expires-at']) : null, createdBy: owner?.id ?? null }, now);
      await systemAudit(db, workspace.id, 'api_key.created', { type: 'api_key', id: row.id }, { name: row.name, scopes: row.scopes }, now);
      out.write(JSON.stringify({ id: row.id, prefix: row.prefix, scopes: row.scopes, secret, note: 'The secret is shown only now. Use it as `Authorization: Bearer <secret>`.' }, null, 2));
      return 0;
    } catch (error) {
      if (error instanceof ApiError && error.errors?.length) return fail(error.errors.map((entry) => entry.message).join(' '));
      return fail(error instanceof Error ? error.message : String(error));
    }
  }

  if (command === 'revoke-api-key') {
    if (!values.key) return fail('revoke-api-key needs --key.');
    const [revoked] = await db.update(api_keys).set({ revoked_at: now }).where(and(eq(api_keys.id, values.key), isNull(api_keys.revoked_at))).returning();
    if (!revoked) return fail(`No active key ${values.key}.`);
    await systemAudit(db, revoked.workspace_id, 'api_key.revoked', { type: 'api_key', id: revoked.id }, { name: revoked.name }, now);
    out.write(JSON.stringify({ id: revoked.id, revoked_at: now.toISOString() }, null, 2));
    return 0;
  }

  if (command === 'vapid-keys') {
    const keys = generateVapidKeys();
    out.write(`VAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\nVAPID_SUBJECT=mailto:you@example.com`);
    return 0;
  }

  return fail(command ? `Unknown command ${command}.` : 'Give a command.');
}

if (import.meta.main) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }
  const { db, pool } = createDb(url);
  try {
    process.exitCode = await runCli(db, process.argv.slice(2), { write: (line) => console.log(line) });
  } finally {
    await pool.end();
  }
}
