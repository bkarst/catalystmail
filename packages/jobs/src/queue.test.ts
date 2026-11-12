import assert from 'node:assert/strict';

import { contacts, newId, workspaces, type Db } from '@catalyst/db';
import { createTestDatabase } from '@catalyst/db/testing';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { MemoryQueue, PgBossQueue } from './queue.ts';

// Needs a PostgreSQL server: set TEST_DATABASE_URL to any database on it.
const adminUrl = process.env.TEST_DATABASE_URL;

describe('MemoryQueue', () => {
  it('records jobs and checks their payloads', async () => {
    const queue = new MemoryQueue();
    await queue.enqueue('thread.evaluate', { thread_id: 'thr_01jd3x5k8qf7tb9w2m4n6p8r0s' });
    assert.deepEqual(queue.of('thread.evaluate'), [{ thread_id: 'thr_01jd3x5k8qf7tb9w2m4n6p8r0s' }]);
    await assert.rejects(queue.enqueue('thread.evaluate', { thread_id: 'ctc_nope' }));
  });
});

describe.skipIf(!adminUrl)('PgBossQueue against PostgreSQL (D7)', () => {
  let db: Db;
  let drop: () => Promise<void>;
  let queue: PgBossQueue;

  beforeAll(async () => {
    const database = await createTestDatabase(adminUrl!);
    ({ db, drop } = database);
    queue = new PgBossQueue({ connectionString: database.url, role: 'worker' });
    await queue.start();
  });
  afterAll(async () => {
    await queue?.stop({ graceful: false });
    await drop?.();
  });

  it('keeps one waiting evaluation per thread, so a burst of events is debounced', async () => {
    const threadId = newId('thread');
    const first = await queue.enqueue('thread.evaluate', { thread_id: threadId });
    assert.ok(first);
    assert.equal(await queue.enqueue('thread.evaluate', { thread_id: threadId }), null);
    assert.ok(await queue.enqueue('thread.evaluate', { thread_id: newId('thread') }), 'another thread has its own slot');
    const job = await queue.boss.getJobById<{ thread_id: string }>('thread.evaluate', first!);
    assert.equal(job!.data.thread_id, threadId);
    assert.ok(job!.startAfter.getTime() > Date.now(), 'evaluation waits for the debounce window');
  });

  it('enqueues inside a transaction, so a rolled-back change leaves no job behind', async () => {
    const workspaceId = newId('workspace');
    await db.insert(workspaces).values({ id: workspaceId, name: 'Acme', physical_address: 'x' });
    const contactId = newId('contact');
    await assert.rejects(
      db.transaction(async (tx) => {
        await tx.insert(contacts).values({ id: contactId, workspace_id: workspaceId, email: 'rollback@example.com' });
        await queue.enqueue('contact.verify', { contact_id: contactId }, { db: tx });
        throw new Error('roll back');
      }),
    );
    assert.deepEqual(await queue.boss.findJobs('contact.verify', { key: contactId }), []);

    await db.transaction(async (tx) => {
      await tx.insert(contacts).values({ id: contactId, workspace_id: workspaceId, email: 'commit@example.com' });
      await queue.enqueue('contact.verify', { contact_id: contactId }, { db: tx });
    });
    assert.equal((await queue.boss.findJobs('contact.verify', { key: contactId })).length, 1);
  });

  it('hands jobs to a worker', async () => {
    const importId = newId('import');
    const seen = new Promise<string>((resolve) => {
      void queue.boss.work<{ import_id: string }>('import.process', { pollingIntervalSeconds: 0.5 }, async ([job]) => resolve(job!.data.import_id));
    });
    await queue.enqueue('import.process', { import_id: importId });
    assert.equal(await seen, importId);
  });
});
