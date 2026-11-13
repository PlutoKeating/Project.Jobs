import { config as loadDotenv } from 'dotenv';
import { join } from 'node:path';
import { REPO_ROOT } from './paths.ts';

loadDotenv({ path: join(REPO_ROOT, '.env'), quiet: true });

const v = (k: string, d: string) => process.env[k] ?? d;

export const env = {
  databaseUrl: v('DATABASE_URL', 'postgres://pux:pux@127.0.0.1:55432/pux'),
  s3Endpoint: v('S3_ENDPOINT', 'http://127.0.0.1:59000'),
  s3AccessKey: v('S3_ACCESS_KEY', 'puxadmin'),
  s3SecretKey: v('S3_SECRET_KEY', 'puxadmin-secret'),
  s3Bucket: v('S3_BUCKET', 'pux-evidence'),
  litellmBaseUrl: v('LITELLM_BASE_URL', 'http://127.0.0.1:54000'),
  litellmKey: v('LITELLM_MASTER_KEY', 'sk-pux-local'),
  temporalAddress: v('TEMPORAL_ADDRESS', '127.0.0.1:57233'),
  temporalNamespace: v('TEMPORAL_NAMESPACE', 'default'),
  temporalUiPort: Number(v('TEMPORAL_UI_PORT', '58233')),
  consolePort: Number(v('CONSOLE_PORT', '5300')),
  demoHost: v('DEMO_HOST', '127.0.0.1'),
  logLevel: v('PUX_LOG_LEVEL', 'info'),
};
