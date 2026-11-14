import OpenAI from 'openai';
import { z } from 'zod';
import { env, loadConfig, logger, newId, sha256 } from '@pux/core';
import { getDb, llmTraces, studies, sessions, sql, eq } from '@pux/db';

export type RoleKey = keyof ReturnType<typeof loadConfig>['roles'] | string;

export interface Tags { study_id?: string; session_id?: string; step_idx?: number; purpose?: string }

export type ContentPart = { type: 'text'; text: string } | { type: 'image'; data: Buffer | string; mime?: string };
export interface Msg { role: 'system' | 'user' | 'assistant'; content: string | ContentPart[] }

export interface ChatOptions<S extends z.ZodType | undefined> {
  messages: Msg[];
  schema?: S;
  schemaName?: string;
  temperature?: number;
  maxTokens?: number;
  tags?: Tags;
  retries?: number;
  reasoning?: 'low' | 'medium' | 'high';
}

export interface ChatResult<T> { data: T; text: string; usage: { prompt: number; completion: number; reasoning: number }; latency_ms: number; alias: string; family: string }

/** 估算价格（美元 / 百万 token），仅用于预算与报告中的成本估计 */
const PRICE: Record<string, [number, number]> = {
  'gemini-4-hydrogen': [0.3, 2.5], 'gemini-4-argon': [2, 12], 'gemini-4-carbon': [8, 32], 'gemini-embedding-2': [0.15, 0],
};

export class LlmError extends Error { constructor(message: string, public alias: string, public cause?: unknown) { super(message); } }

/** 把 zod schema 转成 Gemini 能接受的 JSON Schema 子集 */
export function toGeminiSchema(schema: z.ZodType): Record<string, unknown> {
  const js = z.toJSONSchema(schema, { unrepresentable: 'any', io: 'output' }) as Record<string, unknown>;
  const clean = (n: unknown): unknown => {
    if (Array.isArray(n)) return n.map(clean);
    if (!n || typeof n !== 'object') return n;
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(n as Record<string, unknown>)) {
      if (['$schema', 'additionalProperties', '$id', 'default', 'exclusiveMinimum', 'exclusiveMaximum', 'pattern', 'format'].includes(k)) continue;
      o[k] = clean(v);
    }
    if (o.anyOf && Array.isArray(o.anyOf)) {
      const nonNull = (o.anyOf as Record<string, unknown>[]).filter((x) => x.type !== 'null');
      if (nonNull.length === 1) { const r = { ...nonNull[0], nullable: true }; delete o.anyOf; Object.assign(o, r); }
    }
    return o;
  };
  return clean(js) as Record<string, unknown>;
}

function extractJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  try { return JSON.parse(t); } catch { /* fallthrough */ }
  const s = t.indexOf('{'); const e = t.lastIndexOf('}');
  if (s >= 0 && e > s) return JSON.parse(t.slice(s, e + 1));
  throw new Error('no json');
}

export class Gateway {
  readonly client: OpenAI;
  constructor() {
    this.client = new OpenAI({ baseURL: `${env.litellmBaseUrl}/v1`, apiKey: env.litellmKey, timeout: 300_000, maxRetries: 0 });
  }

  role(roleKey: RoleKey) {
    const r = loadConfig().roles[roleKey as string];
    if (!r) throw new Error(`未配置的角色：${String(roleKey)}`);
    return r;
  }

  /** 带降级的调用：主角色失败（超时等）时改用备选角色，避免单一模型拖垮整个 Study */
  async chatWithFallback<S extends z.ZodType | undefined = undefined>(roleKeys: RoleKey[], opts: ChatOptions<S>): Promise<ChatResult<S extends z.ZodType ? z.infer<S> : string>> {
    let last: unknown;
    for (const r of roleKeys) { try { return await this.chat(r, { ...opts, retries: opts.retries ?? 1 }); } catch (e) { last = e; logger.warn({ role: r, err: String((e as Error).message).slice(0, 160) }, '角色调用失败，尝试降级'); } }
    throw last;
  }

  async chat<S extends z.ZodType | undefined = undefined>(roleKey: RoleKey, opts: ChatOptions<S>): Promise<ChatResult<S extends z.ZodType ? z.infer<S> : string>> {
    const role = this.role(roleKey);
    const messages = opts.messages.map(toOpenAi);
    const retries = opts.retries ?? 2;
    let lastErr: unknown;
    const convo = [...messages];
    for (let attempt = 0; attempt <= retries; attempt++) {
      const t0 = Date.now();
      try {
        const body: Record<string, unknown> = { model: role.alias, messages: convo, temperature: opts.temperature };
        if (opts.maxTokens) body.max_tokens = opts.maxTokens;
        if (opts.reasoning) body.reasoning_effort = opts.reasoning;
        if (opts.schema) body.response_format = { type: 'json_schema', json_schema: { name: opts.schemaName ?? 'output', schema: toGeminiSchema(opts.schema) } };
        const r = await this.client.chat.completions.create(body as never) as OpenAI.Chat.Completions.ChatCompletion;
        const latency = Date.now() - t0;
        const text = r.choices?.[0]?.message?.content ?? '';
        const usage = { prompt: r.usage?.prompt_tokens ?? 0, completion: r.usage?.completion_tokens ?? 0, reasoning: (r.usage as { completion_tokens_details?: { reasoning_tokens?: number } })?.completion_tokens_details?.reasoning_tokens ?? 0 };
        let data: unknown = text;
        if (opts.schema) {
          try { data = opts.schema.parse(extractJson(text)); }
          catch (e) {
            await this.trace(roleKey as string, role, opts.tags, usage, latency, 'retry', `schema: ${(e as Error).message.slice(0, 300)}`);
            convo.push({ role: 'assistant', content: text });
            convo.push({ role: 'user', content: `上面的输出不符合 JSON Schema（${(e as Error).message.slice(0, 400)}）。请只输出修正后的 JSON。` });
            lastErr = e; continue;
          }
        }
        await this.trace(roleKey as string, role, opts.tags, usage, latency, 'ok');
        return { data: data as never, text, usage, latency_ms: latency, alias: role.alias, family: role.family };
      } catch (e) {
        lastErr = e;
        await this.trace(roleKey as string, role, opts.tags, { prompt: 0, completion: 0, reasoning: 0 }, Date.now() - t0, 'error', String((e as Error).message).slice(0, 500));
        logger.warn({ alias: role.alias, attempt, err: String((e as Error).message).slice(0, 200) }, 'LLM 调用失败，重试');
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
    throw new LlmError(`LLM 调用失败（${role.alias}）：${String((lastErr as Error)?.message ?? lastErr).slice(0, 300)}`, role.alias, lastErr);
  }

  /** 单条 embedding（LiteLLM 的 Vertex gemini-embedding-2 批量请求只返回一条，这里逐条调用） */
  async embed(text: string, tags?: Tags): Promise<number[]> {
    const role = this.role('embed');
    const t0 = Date.now();
    try {
      const r = await this.client.embeddings.create({ model: role.alias, input: text.slice(0, 6000), dimensions: 768 } as never);
      await this.trace('embed', role, tags, { prompt: Math.ceil(text.length / 3), completion: 0, reasoning: 0 }, Date.now() - t0, 'ok');
      return r.data[0].embedding as unknown as number[];
    } catch (e) {
      await this.trace('embed', role, tags, { prompt: 0, completion: 0, reasoning: 0 }, Date.now() - t0, 'error', String((e as Error).message).slice(0, 300));
      logger.warn({ err: String((e as Error).message).slice(0, 200) }, 'embedding 失败，使用本地哈希向量兜底');
      return hashEmbedding(text);
    }
  }

  /** 生成图片（用于相机模态注入素材）。返回 PNG/JPEG Buffer */
  async generateImage(prompt: string, tags?: Tags): Promise<Buffer | null> {
    const role = this.role('image_gen');
    const t0 = Date.now();
    try {
      const r = await this.client.chat.completions.create({ model: role.alias, messages: [{ role: 'user', content: prompt }], modalities: ['image', 'text'] } as never) as unknown as { choices: { message: { images?: { image_url: { url: string } }[] } }[] };
      const url = r.choices?.[0]?.message?.images?.[0]?.image_url?.url;
      await this.trace('image_gen', role, tags, { prompt: 0, completion: 0, reasoning: 0 }, Date.now() - t0, url ? 'ok' : 'error', url ? undefined : 'no image');
      if (!url) return null;
      return Buffer.from(url.split(',')[1], 'base64');
    } catch (e) {
      await this.trace('image_gen', role, tags, { prompt: 0, completion: 0, reasoning: 0 }, Date.now() - t0, 'error', String((e as Error).message).slice(0, 300));
      return null;
    }
  }

  async ping(): Promise<{ ok: boolean; detail: string }> {
    try { const r = await this.chat('mind_fast', { messages: [{ role: 'user', content: '只回复 OK' }], retries: 0 }); return { ok: true, detail: `${r.alias} ${r.latency_ms}ms` }; }
    catch (e) { return { ok: false, detail: String((e as Error).message) }; }
  }

  private async trace(roleKey: string, role: { alias: string; model: string; family: string }, tags: Tags | undefined, usage: { prompt: number; completion: number; reasoning: number }, latency: number, status: string, error?: string) {
    const price = PRICE[role.model] ?? [1, 4];
    const cost = (usage.prompt * price[0] + (usage.completion) * price[1]) / 1e6;
    try {
      const db = getDb();
      await db.insert(llmTraces).values({ id: newId('llm'), role: roleKey, alias: role.alias, model: role.model, family: role.family, study_id: tags?.study_id, session_id: tags?.session_id, step_idx: tags?.step_idx, purpose: tags?.purpose, prompt_tokens: usage.prompt, completion_tokens: usage.completion, reasoning_tokens: usage.reasoning, latency_ms: latency, cost_usd: cost, status, error });
      const tok = usage.prompt + usage.completion;
      if (tok > 0 && tags?.session_id) await db.update(sessions).set({ tokens: sql`${sessions.tokens} + ${tok}`, cost_usd: sql`${sessions.cost_usd} + ${cost}` }).where(eq(sessions.id, tags.session_id));
      if (tok > 0 && tags?.study_id) await db.update(studies).set({ tokens: sql`${studies.tokens} + ${tok}`, cost_usd: sql`${studies.cost_usd} + ${cost}` }).where(eq(studies.id, tags.study_id));
    } catch (e) { logger.debug({ e }, 'trace 写入失败'); }
  }
}

function toOpenAi(m: Msg): OpenAI.Chat.Completions.ChatCompletionMessageParam {
  if (typeof m.content === 'string') return { role: m.role, content: m.content } as OpenAI.Chat.Completions.ChatCompletionMessageParam;
  const parts = m.content.map((p) => p.type === 'text'
    ? { type: 'text' as const, text: p.text }
    : { type: 'image_url' as const, image_url: { url: `data:${p.mime ?? 'image/jpeg'};base64,${typeof p.data === 'string' ? p.data : p.data.toString('base64')}` } });
  return { role: m.role as 'user', content: parts };
}

/** 本地兜底向量：字符 n-gram 哈希（768 维，L2 归一化） */
export function hashEmbedding(text: string, dims = 768): number[] {
  const v = new Array(dims).fill(0);
  const s = text.toLowerCase();
  for (let n = 1; n <= 3; n++) for (let i = 0; i + n <= s.length; i++) { const h = parseInt(sha256(s.slice(i, i + n)).slice(0, 8), 16); v[h % dims] += 1 / n; }
  const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
  return v.map((x) => x / norm);
}

export const cosine = (a: number[], b: number[]) => { let d = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return d / (Math.sqrt(na * nb) || 1); };

let gw: Gateway | undefined;
export const gateway = () => (gw ??= new Gateway());

/** 厂商隔离校验（§12.2、§17）：judge 不得与 mind/operator 同厂商 */
export function checkVendorIsolation(judgeRoles: string[]): { ok: boolean; warnings: string[] } {
  const cfg = loadConfig();
  const mindFamilies = new Set(['mind_fast', 'mind_slow'].map((r) => cfg.roles[r]?.family));
  const opFamilies = new Set(['operator_plan', 'operator_locate'].map((r) => cfg.roles[r]?.family));
  const warnings: string[] = [];
  for (const j of judgeRoles) {
    const f = cfg.roles[j]?.family;
    if (mindFamilies.has(f)) warnings.push(`${j}(${cfg.roles[j].model}) 与 Persona Mind 同属 ${f}`);
  }
  const meta = cfg.roles.judge_meta?.family;
  if (mindFamilies.has(meta) || opFamilies.has(meta)) warnings.push(`judge.meta 与 mind/operator 同属 ${meta}`);
  return { ok: warnings.length === 0, warnings };
}
