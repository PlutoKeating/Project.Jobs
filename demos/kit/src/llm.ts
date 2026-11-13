import OpenAI from 'openai';
import { config } from 'dotenv';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
config({ path: join(dirname(fileURLToPath(import.meta.url)), '../../../.env'), quiet: true });
export const llm = new OpenAI({ baseURL: `${process.env.LITELLM_BASE_URL ?? 'http://127.0.0.1:54000'}/v1`, apiKey: process.env.LITELLM_MASTER_KEY ?? 'sk-pux-local' });
export const DEMO_MODEL = 'demo.assistant';
