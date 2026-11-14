import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '@pux/core';
import * as schema from './schema.ts';

export * as t from './schema.ts';
export * from './schema.ts';
export { sql, eq, and, or, desc, asc, inArray, isNull, isNotNull, gt, lt, gte, lte, ne, count } from 'drizzle-orm';

export type DB = NodePgDatabase<typeof schema>;
let pool: pg.Pool | undefined;
let instance: DB | undefined;

export function getDb(): DB {
  if (!instance) {
    pool = new pg.Pool({ connectionString: env.databaseUrl, max: 12 });
    instance = drizzle(pool, { schema });
  }
  return instance;
}

export async function closeDb() { await pool?.end(); pool = undefined; instance = undefined; }

export async function runMigrations() {
  const folder = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
  await migrate(getDb(), { migrationsFolder: folder });
}

/** pgvector 字面量 */
export const vec = (v: number[]) => `[${v.join(',')}]`;
