// 示例产品里的 AI 功能：走 Jobs 自己的 OpenAI 兼容入口（/api/v1/llm/step/v1），由已发布的模型配置决定实际用哪个模型
import OpenAI from 'openai';
import { config } from 'dotenv';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
config({ path: join(dirname(fileURLToPath(import.meta.url)), '../../../.env'), quiet: true });
const base = process.env.JOBS_API ?? `http://127.0.0.1:${process.env.API_PORT ?? 5320}`;
export const llm = new OpenAI({ baseURL: `${base.replace(/\/$/, '')}/api/v1/llm/step/v1`, apiKey: process.env.JOBS_KEY ?? process.env.JW_ADMIN_PASSCODE ?? process.env.JW_PASSCODE ?? 'jobs-local' });
export const DEMO_MODEL = 'jobs/step';
