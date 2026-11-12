// A fresh, migrated database for integration tests. Each call creates its own database on the
// server behind TEST_DATABASE_URL and `drop()` removes it, so nothing else on the server is touched.

import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

import type { Db } from './client.ts';
import * as schema from './schema/index.ts';

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../migrations', import.meta.url));

export async function createTestDatabase(adminUrl: string): Promise<{ db: Db; pool: pg.Pool; url: string; drop: () => Promise<void> }> {
  const name = `catalyst_test_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
  const asAdmin = async (statement: string) => {
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await admin.query(statement);
    } finally {
      await admin.end();
    }
  };
  await asAdmin(`create database ${name}`);

  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const pool = new pg.Pool({ connectionString: url.toString() });
  const db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

  return {
    db,
    pool,
    url: url.toString(),
    drop: async () => {
      await pool.end();
      // Other clients (such as a job queue under test) may still hold connections.
      await asAdmin(`drop database if exists ${name} with (force)`);
    },
  };
}
