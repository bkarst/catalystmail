// `getJob` (spec §13.3 "Async operations"): long tasks answer 202 with the ID of the resource that
// tracks them, and this reports on it the same way whatever it is.

import { imports, mailboxes, poll_runs, type Db } from '@catalyst/db';
import { and, eq } from 'drizzle-orm';

import { notFound } from '../api/errors.ts';
import { iso } from '../shared.ts';

type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

const IMPORT_STATUS: Record<string, JobStatus> = { uploaded: 'queued', mapped: 'queued', processing: 'running', done: 'succeeded', failed: 'failed' };
const POLL_STATUS: Record<string, JobStatus> = { running: 'running', ok: 'succeeded', partial: 'succeeded', error: 'failed' };

export async function getJob(db: Db, workspaceId: string, jobId: string) {
  if (jobId.startsWith('imp_')) {
    const [row] = await db.select().from(imports).where(and(eq(imports.id, jobId), eq(imports.workspace_id, workspaceId)));
    if (!row) throw notFound('The job');
    const failed = row.status === 'failed';
    return {
      id: row.id,
      kind: 'import' as const,
      status: IMPORT_STATUS[row.status] ?? 'queued',
      progress: { done: row.processed_rows, total: row.total_rows },
      error: failed ? (((row.errors as { message?: string }[])[0]?.message ?? 'The import failed.') as string) : null,
      created_at: row.created_at.toISOString(),
      finished_at: iso(row.finished_at),
    };
  }
  const [run] = await db
    .select({ run: poll_runs })
    .from(poll_runs)
    .innerJoin(mailboxes, eq(mailboxes.id, poll_runs.mailbox_id))
    .where(and(eq(poll_runs.id, jobId), eq(mailboxes.workspace_id, workspaceId)));
  if (!run) throw notFound('The job');
  return {
    id: run.run.id,
    kind: 'mailbox_poll' as const,
    status: POLL_STATUS[run.run.status] ?? 'running',
    progress: run.run.finished_at ? { done: run.run.fetched_count ?? 0, total: run.run.fetched_count ?? 0 } : null,
    error: run.run.error,
    created_at: run.run.started_at.toISOString(),
    finished_at: iso(run.run.finished_at),
  };
}
