// The database handle. PostgreSQL is both the database and, through pg-boss, the job queue (D7).

import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import * as schema from './schema/index.ts';

export function createDb(connectionString: string) {
  const pool = new pg.Pool({ connectionString });
  return { db: drizzle(pool, { schema }), pool };
}

export type Db = ReturnType<typeof createDb>['db'];

/** An open transaction. */
export type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0];

/** A database handle or an open transaction: what every query helper accepts. */
export type Executor = Db | Transaction;
