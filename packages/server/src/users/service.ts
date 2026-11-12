// The team (spec §13.4, §15.18). Removing someone deactivates them, because approvals, resolutions
// and the audit log name them; what they were assigned or owned goes back to the workspace.

import { activities, campaigns, escalations, mailboxes, newId, notifications, threads, users, type Db, type Executor } from '@catalyst/db';
import { and, asc, count, eq, inArray, isNull, ne, sql, type SQL } from 'drizzle-orm';

import type { Principal } from '../api/auth.ts';
import { conflict, invalidField, notFound } from '../api/errors.ts';
import { decodeCursor, page } from '../api/pagination.ts';
import { audit, iso } from '../shared.ts';

type UserRow = typeof users.$inferSelect;
type Role = UserRow['role'];

/** Mail preferences, both on unless turned off (§11.2). */
export const mailPrefsOf = (prefs: unknown) => {
  const stored = (prefs ?? {}) as { email?: boolean; digest?: boolean };
  return { email: stored.email !== false, digest: stored.digest !== false };
};

export function serializeUser(row: UserRow) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    timezone: row.timezone,
    notifications: mailPrefsOf(row.notification_prefs),
    last_login_at: iso(row.last_login_at),
    deactivated_at: iso(row.deactivated_at),
    created_at: row.created_at.toISOString(),
  };
}

async function findUser(db: Executor, workspaceId: string, userId: string): Promise<UserRow> {
  const [row] = await db.select().from(users).where(and(eq(users.id, userId), eq(users.workspace_id, workspaceId)));
  if (!row) throw notFound('The person');
  return row;
}

async function otherActiveOwners(db: Executor, workspaceId: string, userId: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(users).where(and(eq(users.workspace_id, workspaceId), eq(users.role, 'owner'), isNull(users.deactivated_at), ne(users.id, userId)));
  return row?.n ?? 0;
}

const SORT = 'name';

export async function listUsers(db: Db, workspaceId: string, query: { limit: number; cursor?: string | undefined; include_removed?: 'true' | 'false' | undefined }) {
  const where: SQL[] = [eq(users.workspace_id, workspaceId)];
  if (query.include_removed !== 'true') where.push(isNull(users.deactivated_at));
  if (query.cursor) where.push(sql`(${users.name}, ${users.id}) > (select name, id from users where id = ${decodeCursor(query.cursor, SORT)})`);
  const rows = await db.select().from(users).where(and(...where)).orderBy(asc(users.name), asc(users.id)).limit(query.limit + 1);
  const { rows: kept, next_cursor } = page(rows, query.limit, SORT);
  return { data: kept.map(serializeUser), next_cursor };
}

/** Adds a person and queues their invitation mail, sent by the notification job (§11.2). */
export async function inviteUser(db: Db, principal: Principal, input: { email: string; name: string; role: Role }, now: Date) {
  const email = input.email.trim().toLowerCase();
  const row = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(users).where(eq(users.email, email));
    if (existing && existing.workspace_id !== principal.workspace.id) throw conflict('That email belongs to someone in another workspace.');
    if (existing && !existing.deactivated_at) throw conflict(`${email} is already on the team.`);
    const [saved] = existing
      ? await tx.update(users).set({ name: input.name, role: input.role, deactivated_at: null, updated_at: now }).where(eq(users.id, existing.id)).returning()
      : await tx.insert(users).values({ id: newId('user'), workspace_id: principal.workspace.id, email, name: input.name, role: input.role, created_at: now, updated_at: now }).returning();
    await tx.insert(notifications).values({
      id: newId('notification'),
      workspace_id: principal.workspace.id,
      user_id: saved!.id,
      activity_id: `invite:${saved!.id}:${now.toISOString()}`,
      channel: 'email',
      kind: 'invite',
      priority: 'high',
      title: `You’re invited to ${principal.workspace.name} on Catalyst`,
      body: `${principal.name} added you to ${principal.workspace.name} as ${input.role}. Sign in with this email address to start.`,
      link: '/sign-in',
      created_at: now,
    });
    await audit(tx, principal, existing ? 'user.reinvited' : 'user.invited', { type: 'user', id: saved!.id }, { email, role: input.role }, now);
    return saved!;
  });
  return serializeUser(row);
}

export async function updateUser(
  db: Db,
  principal: Principal,
  userId: string,
  input: { name?: string | undefined; role?: Role | undefined; timezone?: string | null | undefined; notifications?: { email?: boolean | undefined; digest?: boolean | undefined } | undefined },
  now: Date,
) {
  const row = await db.transaction(async (tx) => {
    const current = await findUser(tx, principal.workspace.id, userId);
    if (current.deactivated_at) throw conflict('This person was removed from the team; invite them again first.');
    if (input.role && input.role !== 'owner' && current.role === 'owner' && (await otherActiveOwners(tx, principal.workspace.id, userId)) === 0) throw conflict('The workspace needs at least one owner. Make someone else an owner first.');
    if (input.timezone) {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: input.timezone });
      } catch {
        throw invalidField('body.timezone', `${input.timezone} is not an IANA timezone.`);
      }
    }
    const patch: Partial<typeof users.$inferInsert> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.role !== undefined) patch.role = input.role;
    if (input.timezone !== undefined) patch.timezone = input.timezone;
    if (input.notifications) patch.notification_prefs = { ...(current.notification_prefs as object), ...Object.fromEntries(Object.entries(input.notifications).filter(([, value]) => value !== undefined)) };
    const [updated] = await tx.update(users).set({ ...patch, updated_at: now }).where(eq(users.id, userId)).returning();
    if (input.role && input.role !== current.role) await audit(tx, principal, 'user.role_changed', { type: 'user', id: userId }, { from: current.role, to: input.role }, now);
    return updated!;
  });
  return serializeUser(row);
}

export async function removeUser(db: Db, principal: Principal, userId: string, now: Date): Promise<void> {
  await db.transaction(async (tx) => {
    const current = await findUser(tx, principal.workspace.id, userId);
    if (current.deactivated_at) return;
    if (current.role === 'owner' && (await otherActiveOwners(tx, principal.workspace.id, userId)) === 0) throw conflict('The workspace needs at least one owner. Make someone else an owner first.');
    await tx.update(users).set({ deactivated_at: now, updated_at: now }).where(eq(users.id, userId));
    // What they were assigned goes back to the workspace; escalations fall back to the owners (§11.1).
    await tx.update(threads).set({ assigned_user_id: null, updated_at: now }).where(eq(threads.assigned_user_id, userId));
    await tx.update(escalations).set({ assigned_user_id: null, updated_at: now }).where(and(eq(escalations.assigned_user_id, userId), inArray(escalations.status, ['open', 'snoozed'])));
    await tx.update(campaigns).set({ owner_user_id: null, updated_at: now }).where(eq(campaigns.owner_user_id, userId));
    await tx.update(mailboxes).set({ owner_user_id: null, updated_at: now }).where(eq(mailboxes.owner_user_id, userId));
    await tx.update(notifications).set({ status: 'skipped', error: 'The person was removed from the team.' }).where(and(eq(notifications.user_id, userId), eq(notifications.status, 'pending')));
    await tx.insert(activities).values({ id: newId('activity'), workspace_id: principal.workspace.id, type: 'user.removed', actor_type: principal.kind, actor_id: principal.id, data: { user_id: userId, email: current.email }, occurred_at: now });
    await audit(tx, principal, 'user.removed', { type: 'user', id: userId }, { email: current.email }, now);
  });
}
