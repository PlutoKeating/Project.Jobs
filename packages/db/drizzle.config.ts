import { defineConfig } from 'drizzle-kit';
export default defineConfig({
  dialect: 'postgresql',
  schema: './packages/db/src/schema.ts',
  out: './packages/db/migrations',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://pux:pux@127.0.0.1:55432/pux' },
});
