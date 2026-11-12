// Applies pending migrations to the database in DATABASE_URL. Run it as a one-off before each
// rollout (spec §17): `pnpm --filter @catalyst/db migrate`.

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

import { MIGRATIONS_FOLDER } from './testing.ts';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url });
try {
  await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
  console.log('Migrations are up to date.');
} finally {
  await pool.end();
}
