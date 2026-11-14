import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { sql } from 'drizzle-orm';
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
  // 标准的 pgvector 镜像不带我们的初始化脚本：需要的扩展在这里建（已存在则跳过）
  await getDb().execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);
  await getDb().execute(sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
  await migrate(getDb(), { migrationsFolder: folder });
}

/** pgvector 字面量 */
export const vec = (v: number[]) => `[${v.join(',')}]`;
