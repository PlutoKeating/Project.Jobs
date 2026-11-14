// 供应商与模型目录：只是选择时的辅助（名称、地址、协议、模型能力与价格的默认值），不携带凭证，也不会改动已发布的配置。
// 来源 models.dev（外部输入：限时、限量、校验后才用）；拉不到时用随包的一份快照。
import { existsSync, readFileSync } from 'node:fs';
import { configPath, logger } from '@pux/core';
import { eq, getDb, worldKv } from '@pux/db';
import { locateFamily, type Caps, type ModelKind, type Protocol } from './config.ts';

export interface CatalogModel { id: string; name: string; kind: ModelKind; caps: Caps; cost: { input: number; output: number } | null; locate: boolean; released?: string }
export interface CatalogProvider { id: string; name: string; protocol: Protocol; base_url: string; doc?: string; credential: 'api_key' | 'google_json'; models: CatalogModel[] }
export interface Catalog { source: string; fetched_at: string; providers: CatalogProvider[] }

export const CATALOG_URL = 'https://models.dev/api.json';
const MAX_BYTES = 40 * 1024 * 1024;

/** 目录里没写地址、但地址众所周知的官方入口 */
const KNOWN_BASE: Record<string, { protocol: Protocol; base_url: string }> = {
  '@ai-sdk/openai': { protocol: 'openai', base_url: 'https://api.openai.com/v1' },
  '@ai-sdk/anthropic': { protocol: 'anthropic', base_url: 'https://api.anthropic.com/v1' },
  '@ai-sdk/google': { protocol: 'openai', base_url: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  '@ai-sdk/google-vertex': { protocol: 'vertex', base_url: 'https://aiplatform.googleapis.com/v1/projects/{project}/locations/global' },
  '@ai-sdk/xai': { protocol: 'openai', base_url: 'https://api.x.ai/v1' },
  '@ai-sdk/mistral': { protocol: 'openai', base_url: 'https://api.mistral.ai/v1' },
  '@ai-sdk/groq': { protocol: 'openai', base_url: 'https://api.groq.com/openai/v1' },
  '@ai-sdk/cerebras': { protocol: 'openai', base_url: 'https://api.cerebras.ai/v1' },
  '@ai-sdk/togetherai': { protocol: 'openai', base_url: 'https://api.together.xyz/v1' },
  '@ai-sdk/deepinfra': { protocol: 'openai', base_url: 'https://api.deepinfra.com/v1/openai' },
  '@ai-sdk/perplexity': { protocol: 'openai', base_url: 'https://api.perplexity.ai' },
  '@ai-sdk/cohere': { protocol: 'openai', base_url: 'https://api.cohere.ai/compatibility/v1' },
};
/** 常用的排在前面（其余按名字） */
const POPULAR = ['openai', 'anthropic', 'google', 'google-vertex', 'openrouter', 'deepseek', 'alibaba-cn', 'alibaba', 'volcengine', 'moonshotai-cn', 'moonshotai', 'zhipuai', 'siliconflow-cn', 'siliconflow', 'xai', 'mistral', 'groq'];

type Raw = Record<string, { id?: string; name?: string; npm?: string; api?: string; doc?: string; models?: Record<string, { id?: string; name?: string; attachment?: boolean; structured_output?: boolean; modalities?: { input?: string[]; output?: string[] }; limit?: { context?: number; output?: number }; cost?: { input?: number; output?: number }; release_date?: string }> }>;

/** 把 models.dev 的原始数据收敛成我们用得上的那几项；用不上的供应商（没有可用地址、协议不支持）直接略过 */
export function normalizeCatalog(raw: unknown, fetchedAt = new Date().toISOString()): Catalog {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('目录格式不对');
  const providers: CatalogProvider[] = [];
  for (const [pid, p] of Object.entries(raw as Raw)) {
    if (!p || typeof p !== 'object' || !p.models) continue;
    const known = p.npm ? KNOWN_BASE[p.npm] : undefined;
    let protocol: Protocol | undefined; let base: string | undefined;
    if (p.npm === '@ai-sdk/google-vertex') ({ protocol, base_url: base } = known!);
    else if (typeof p.api === 'string' && /^https?:\/\//.test(p.api) && !p.api.includes('${')) { protocol = p.npm === '@ai-sdk/anthropic' ? 'anthropic' : 'openai'; base = p.api; }
    else if (known) ({ protocol, base_url: base } = known);
    if (!protocol || !base) continue;
    const models: CatalogModel[] = [];
    for (const [mid, m] of Object.entries(p.models)) {
      if (!m || typeof m !== 'object') continue;
      const id = String(m.id ?? mid); const out = m.modalities?.output ?? ['text']; const inp = m.modalities?.input ?? ['text'];
      if (protocol === 'vertex' && /claude|@/.test(id)) continue;                         // Vertex 上的 Claude 不走 OpenAI 兼容入口
      const kind: ModelKind = /embed/i.test(id) ? 'embed' : out.includes('image') ? 'image' : 'chat';
      if (kind === 'chat' && !out.includes('text')) continue;                             // 只出语音、视频的模型用不上
      if (/tts|whisper|transcri|rerank|moderation|guard/i.test(id)) continue;
      const caps: Caps = { vision: kind === 'chat' && inp.includes('image'), json: m.structured_output === true, context: m.limit?.context, output: m.limit?.output };
      const cost = m.cost && typeof m.cost.input === 'number' ? { input: m.cost.input, output: m.cost.output ?? 0 } : null;
      models.push({ id, name: String(m.name ?? id).slice(0, 80), kind, caps, cost, locate: kind === 'chat' && caps.vision && !!locateFamily(id), released: m.release_date });
    }
    if (!models.length) continue;
    models.sort((a, b) => (b.released ?? '').localeCompare(a.released ?? '') || a.name.localeCompare(b.name));
    providers.push({ id: pid, name: String(p.name ?? pid).slice(0, 60), protocol, base_url: base.replace(/\/+$/, ''), doc: typeof p.doc === 'string' ? p.doc : undefined, credential: protocol === 'vertex' ? 'google_json' : 'api_key', models });
  }
  if (providers.length < 5) throw new Error('目录内容太少，不像是完整的目录');
  const rank = (id: string) => { const i = POPULAR.indexOf(id); return i < 0 ? 999 : i; };
  providers.sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name));
  return { source: CATALOG_URL, fetched_at: fetchedAt, providers };
}

let mem: Catalog | undefined;
const bundledFile = () => configPath('models', 'catalog.json');
export function bundledCatalog(): Catalog { return existsSync(bundledFile()) ? (JSON.parse(readFileSync(bundledFile(), 'utf8')) as Catalog) : { source: 'none', fetched_at: new Date(0).toISOString(), providers: [] }; }

/** 当前目录：上次成功拉到的那份；从没拉到过就用随包快照。目录不可用不影响已保存的配置 */
export async function getCatalog(): Promise<Catalog> {
  if (mem) return mem;
  try { const [row] = await getDb().select().from(worldKv).where(eq(worldKv.key, 'llm_catalog')); if (row) { mem = row.value as Catalog; return mem; } } catch (e) { logger.debug({ e }, '读取目录缓存失败'); }
  mem = bundledCatalog();
  return mem;
}

export async function fetchCatalog(url = CATALOG_URL, timeoutMs = 30_000): Promise<Catalog> {
  const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error', headers: { accept: 'application/json', 'user-agent': 'jobs-catalog' } });
  if (!r.ok) throw new Error(`目录返回 ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error('目录太大');
  return normalizeCatalog(JSON.parse(buf.toString('utf8')));
}

/** 重新拉取目录。失败时保留旧目录 */
export async function refreshCatalog(): Promise<Catalog> {
  const c = await fetchCatalog();
  await getDb().insert(worldKv).values({ key: 'llm_catalog', value: c }).onConflictDoUpdate({ target: worldKv.key, set: { value: c, updated_at: new Date() } });
  mem = c;
  return c;
}
