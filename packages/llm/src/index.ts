// 模型网关：应用内的多供应商、多凭证、多模型路由。
// 调用方只说「我是哪个角色」；网关在这次请求开头固定一份配置快照，按全局顺序找出能干这件事的目标，逐个尝试并记录每一次尝试。
import { deflateSync } from 'node:zlib';
import { z } from 'zod';
import { logger, newId, sha256 } from '@pux/core';
import { getDb, llmTests, llmTraces, studies, sessions, sql, eq } from '@pux/db';
import { chat as upstreamChat, embed as upstreamEmbed, googleToken, image as upstreamImage, UpstreamError, vertexBase, type ChatReq, type ContentPart, type Msg } from './adapters.ts';
import { allModels, candidates, classifyError, reaction, usableCredentials, useOfRole, type CredentialRef, type ErrorClass, type SkipReason, type Target, type Use } from './config.ts';
import { health, secretOf, snapshot, tracing, type Snapshot } from './store.ts';

export * from './config.ts';
export * from './store.ts';
export * from './catalog.ts';
export { proxyChat, startLocalEndpoint, handleProxy } from './endpoint.ts';
export { UpstreamError, googleProject } from './adapters.ts';
export { seal, open, _setMasterKey } from './secrets.ts';
export type { ContentPart, Msg } from './adapters.ts';

export type RoleKey = string;
export interface Tags { study_id?: string; session_id?: string; step_idx?: number; purpose?: string }

export interface ChatOptions<S extends z.ZodType | undefined> {
  messages: Msg[];
  schema?: S;
  schemaName?: string;
  temperature?: number;
  maxTokens?: number;
  tags?: Tags;
  /** 0 = 只试一次（探测用）；不填 = 在总预算内重试与换目标 */
  retries?: number;
  reasoning?: 'low' | 'medium' | 'high';
}

/** alias：模型组；family：实际目标所属的厂商；model：实际调用的上游模型 */
export interface ChatResult<T> { data: T; text: string; usage: { prompt: number; completion: number; reasoning: number }; latency_ms: number; alias: string; family: string; model: string; version: number }

export class LlmError extends Error { constructor(message: string, public alias: string, public cause?: unknown, public code?: 'no_model' | ErrorClass) { super(message); } }

/** 一次业务请求最多发起多少次上游调用（含重试、换凭证、换目标、修正格式） */
export const MAX_ATTEMPTS = 6;

/** 把 zod schema 转成各家都能接受的 JSON Schema 子集 */
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

const USE_NAME: Record<Use, string> = { step: '每一步（看图）', think: '归纳与判断', locate: '在截图上定位', embed: '向量', image: '画图' };
const REASON: Record<SkipReason, string> = { provider_off: '连接已停用', no_credential: '没有启用的凭证', not_in_group: '没有勾选这个用途', no_vision: '不能看图', cooling: '暂时不可用', wrong_family: '定位方式不同', wrong_kind: '类型不符' };
export function noModelMessage(use: Use, skipped: { target: Target; reason: SkipReason }[]): string {
  const near = skipped.filter((s) => s.reason !== 'wrong_kind' && s.reason !== 'not_in_group').slice(0, 4).map((s) => `${s.target.provider.name} / ${s.target.model.model}（${REASON[s.reason]}）`);
  return `没有可用于「${USE_NAME[use]}」的模型${near.length ? `：${near.join('；')}` : '。请在网页的「模型」里接入一家供应商并勾选模型'}`;
}

const hasImage = (m: Msg) => typeof m.content !== 'string' && m.content.some((c) => c.type === 'image');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const vendorOf = (t: Target) => (/^[a-z0-9-]+\//i.test(t.model.model) && t.provider.protocol !== 'vertex' ? t.model.model.split('/')[0].toLowerCase() : (t.provider.catalog_id ?? t.provider.name).replace(/-(cn|vertex|coding-plan)$/, '').toLowerCase());
export const targetName = (t: Target) => `${t.provider.name} / ${t.model.model}`;

/** 一次失败之后把谁暂时拿掉。冷却记在真正失败的那一次尝试的目标和凭证上 */
export function noteFailure(t: Target, cred: CredentialRef | undefined, cls: ErrorClass, retryAfterMs?: number) {
  const re = reaction(cls, retryAfterMs);
  if (re.cool === 'credential' && cred) health.set(`c:${cred.id}`, { until: Date.now() + (re.ms ?? 30_000), reason: cls });
  if (re.cool === 'target') health.set(`t:${t.model.id}`, { until: Date.now() + (re.ms ?? 20_000), reason: cls });
  return re;
}

export class Gateway {
  /** 带降级的调用：按顺序换角色（不同角色可能属于不同的模型组） */
  async chatWithFallback<S extends z.ZodType | undefined = undefined>(roleKeys: RoleKey[], opts: ChatOptions<S>): Promise<ChatResult<S extends z.ZodType ? z.infer<S> : string>> {
    let last: unknown;
    const seen = new Set<Use>();
    for (const r of roleKeys) {
      if (seen.has(useOfRole(r))) continue; seen.add(useOfRole(r));           // 同一个模型组已经把所有目标试过了，不重复
      try { return await this.chat(r, opts); } catch (e) { last = e; logger.warn({ role: r, err: String((e as Error).message).slice(0, 160) }, '角色调用失败，尝试降级'); }
    }
    throw last;
  }

  async chat<S extends z.ZodType | undefined = undefined>(roleKey: RoleKey, opts: ChatOptions<S>): Promise<ChatResult<S extends z.ZodType ? z.infer<S> : string>> {
    const use = useOfRole(roleKey);
    const snap = await snapshot();                                              // 这次请求从头到尾用这一版配置
    const { eligible, skipped } = candidates(snap.config, use, { vision: opts.messages.some(hasImage) }, health);
    if (!eligible.length) throw new LlmError(noModelMessage(use, skipped), use, undefined, 'no_model');
    const json = opts.schema ? { name: opts.schemaName ?? 'output', schema: toGeminiSchema(opts.schema) } : undefined;
    const max = opts.retries === 0 ? 1 : MAX_ATTEMPTS;
    let attempt = 0; let lastErr: unknown; let lastCls: ErrorClass | undefined;
    for (const t of eligible) {
      const convo = [...opts.messages]; const tried = new Set<string>();
      let transient = 0; let repairs = 0; let cred: CredentialRef | undefined;
      while (attempt < max) {
        if (!cred) { const pool = usableCredentials(t.provider, health, Date.now()).filter((c) => !tried.has(c.id)); if (!pool.length) break; cred = pool[Math.floor(Math.random() * pool.length)]; }
        attempt++; const t0 = Date.now();
        try {
          const secret = await secretOf(t.provider.id, cred.secret_id);
          const req: ChatReq = { messages: convo, temperature: opts.temperature, maxTokens: opts.maxTokens, reasoning: opts.reasoning ?? (use === 'step' ? 'low' : undefined), json };
          const r = await upstreamChat(t.provider, t.model, secret, req);
          const latency = Date.now() - t0;
          let data: unknown = r.text;
          if (opts.schema) {
            try { data = opts.schema.parse(extractJson(r.text)); }
            catch (e) {
              await this.trace(roleKey, use, snap, t, cred, opts.tags, r.usage, latency, 'retry', attempt, `schema: ${(e as Error).message.slice(0, 300)}`, 'capability');
              lastErr = e; lastCls = 'capability';
              if (repairs++ >= 2) break;                                          // 这个目标两次都给不出合格的结构，换下一个
              convo.push({ role: 'assistant', content: r.text }, { role: 'user', content: `上面的输出不符合 JSON Schema（${(e as Error).message.slice(0, 400)}）。请只输出修正后的 JSON。` });
              continue;
            }
          }
          if (!opts.schema && !r.text.trim()) throw new UpstreamError('上游返回了空内容');
          await this.trace(roleKey, use, snap, t, cred, opts.tags, r.usage, latency, 'ok', attempt);
          return { data: data as never, text: r.text, usage: r.usage, latency_ms: latency, alias: use, family: vendorOf(t), model: t.model.model, version: snap.version };
        } catch (e) {
          const up = e instanceof UpstreamError ? e : undefined;
          const cls = classifyError(up?.status ?? (e as { status?: number }).status, String((e as Error).message ?? e));
          await this.trace(roleKey, use, snap, t, cred, opts.tags, { prompt: 0, completion: 0, reasoning: 0 }, Date.now() - t0, 'error', attempt, String((e as Error).message).slice(0, 500), cls);
          lastErr = e; lastCls = cls;
          logger.warn({ target: targetName(t), attempt, cls, err: String((e as Error).message).slice(0, 200) }, '模型调用失败');
          const re = reaction(cls, up?.retryAfterMs);
          if (re.stop) throw new LlmError(`模型调用被终止（${targetName(t)}）：${String((e as Error).message).slice(0, 300)}`, use, e, cls);
          if (re.retrySame && transient++ < 1 && attempt < max) { await sleep(600 + Math.random() * 900); continue; }   // 退避 + 随机间隔后在同一目标上再试一次
          noteFailure(t, cred, cls, up?.retryAfterMs);
          if (re.cool === 'credential') { tried.add(cred.id); cred = undefined; continue; }                               // 换一把凭证；没有了就换下一个目标
          break;
        }
      }
      if (attempt >= max) break;
    }
    throw new LlmError(`模型调用失败（${USE_NAME[use]}，试了 ${attempt} 次）：${String((lastErr as Error)?.message ?? lastErr).slice(0, 300)}`, use, lastErr, lastCls);
  }

  /** 单条向量。没有接入向量模型、或调用失败时，用本地的字符哈希向量兜底（界面会说明） */
  async embed(text: string, tags?: Tags): Promise<number[]> {
    const snap = await snapshot();
    for (const t of candidates(snap.config, 'embed', {}, health).eligible.slice(0, 2)) {
      const cred = usableCredentials(t.provider, health, Date.now())[0]; if (!cred) continue;
      const t0 = Date.now();
      try {
        const v = await upstreamEmbed(t.provider, t.model, await secretOf(t.provider.id, cred.secret_id), text.slice(0, 6000), 768);
        await this.trace('embed', 'embed', snap, t, cred, tags, { prompt: Math.ceil(text.length / 3), completion: 0, reasoning: 0 }, Date.now() - t0, 'ok', 1);
        return v;
      } catch (e) {
        const up = e instanceof UpstreamError ? e : undefined; const cls = classifyError(up?.status, String((e as Error).message));
        await this.trace('embed', 'embed', snap, t, cred, tags, { prompt: 0, completion: 0, reasoning: 0 }, Date.now() - t0, 'error', 1, String((e as Error).message).slice(0, 300), cls);
        noteFailure(t, cred, cls, up?.retryAfterMs);
      }
    }
    return hashEmbedding(text);
  }

  /** 生成图片（头像、相机素材）。没有接入画图模型时返回 null，调用方各有不依赖它的做法 */
  async generateImage(prompt: string, tags?: Tags): Promise<Buffer | null> {
    const snap = await snapshot();
    for (const t of candidates(snap.config, 'image', {}, health).eligible.slice(0, 2)) {
      const cred = usableCredentials(t.provider, health, Date.now())[0]; if (!cred) continue;
      const t0 = Date.now();
      try {
        const buf = await upstreamImage(t.provider, t.model, await secretOf(t.provider.id, cred.secret_id), prompt);
        await this.trace('image_gen', 'image', snap, t, cred, tags, { prompt: 0, completion: 0, reasoning: 0 }, Date.now() - t0, 'ok', 1);
        return buf;
      } catch (e) {
        const up = e instanceof UpstreamError ? e : undefined; const cls = classifyError(up?.status, String((e as Error).message));
        await this.trace('image_gen', 'image', snap, t, cred, tags, { prompt: 0, completion: 0, reasoning: 0 }, Date.now() - t0, 'error', 1, String((e as Error).message).slice(0, 300), cls);
        noteFailure(t, cred, cls, up?.retryAfterMs);
      }
    }
    return null;
  }

  async ping(): Promise<{ ok: boolean; detail: string }> {
    try { const r = await this.chat('mind_fast', { messages: [{ role: 'user', content: '只回复 OK' }], retries: 0 }); return { ok: true, detail: `${r.model} ${r.latency_ms}ms（配置第 ${r.version} 版）` }; }
    catch (e) { return { ok: false, detail: String((e as Error).message) }; }
  }

  /** 每一次尝试记一行：用的是哪一版配置、哪个目标、哪把凭证、第几次、错在哪一类 */
  async trace(roleKey: string, use: Use, snap: Snapshot, t: Target, cred: CredentialRef | undefined, tags: Tags | undefined, usage: { prompt: number; completion: number; reasoning: number }, latency: number, status: string, attempt: number, error?: string, cls?: ErrorClass) {
    if (!tracing.on) return;
    const cost = t.model.cost ? (usage.prompt * t.model.cost.input + usage.completion * t.model.cost.output) / 1e6 : 0;
    try {
      const db = getDb();
      await db.insert(llmTraces).values({ id: newId('llm'), role: roleKey, alias: use, model: t.model.model, family: vendorOf(t), study_id: tags?.study_id, session_id: tags?.session_id, step_idx: tags?.step_idx, purpose: tags?.purpose, prompt_tokens: usage.prompt, completion_tokens: usage.completion, reasoning_tokens: usage.reasoning, latency_ms: latency, cost_usd: cost, status, error, config_version: snap.version, target: targetName(t), cred: cred?.hint, attempt, error_class: cls });
      const tok = usage.prompt + usage.completion;
      if (tok > 0 && tags?.session_id) await db.update(sessions).set({ tokens: sql`${sessions.tokens} + ${tok}`, cost_usd: sql`${sessions.cost_usd} + ${cost}` }).where(eq(sessions.id, tags.session_id));
      if (tok > 0 && tags?.study_id) await db.update(studies).set({ tokens: sql`${studies.tokens} + ${tok}`, cost_usd: sql`${studies.cost_usd} + ${cost}` }).where(eq(studies.id, tags.study_id));
    } catch (e) { logger.debug({ e }, 'trace 写入失败'); }
  }
}

// ---- 单目标测试：证明的只是「这一版配置里，这个目标用这把凭证，此刻能做这一件事」----
export type TestCapability = 'text' | 'vision' | 'json' | 'embed' | 'image';

/** 一张 32×32 的纯色 PNG（测试看图能力用） */
export function solidPng(r: number, g: number, b: number, size = 32): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf: Buffer) => { let c = 0xffffffff; for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(body)); return Buffer.concat([len, body, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3).map((_, i) => [r, g, b][i % 3])]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: size }, () => row)))), chunk('IEND', Buffer.alloc(0))]);
}

export async function testTarget(targetId: string, o: { credential_id?: string; capability?: TestCapability } = {}) {
  const snap = await snapshot(true);
  const t = allModels(snap.config).find((x) => x.model.id === targetId);
  if (!t) throw new Error('已发布的配置里没有这个模型（先发布，再测试）');
  const cred = o.credential_id ? t.provider.credentials.find((c) => c.id === o.credential_id) : t.provider.credentials.find((c) => c.enabled);
  if (!cred) throw new Error('这个连接没有启用的凭证');
  const capability: TestCapability = o.capability ?? (t.model.kind === 'embed' ? 'embed' : t.model.kind === 'image' ? 'image' : 'text');
  const t0 = Date.now(); let ok = false; let detail = ''; let cls: ErrorClass | undefined;
  try {
    const secret = await secretOf(t.provider.id, cred.secret_id);
    if (capability === 'embed') { const v = await upstreamEmbed(t.provider, t.model, secret, 'hello', 768); ok = v.length > 0; detail = `${v.length} 维`; }
    else if (capability === 'image') { const b = await upstreamImage(t.provider, t.model, secret, 'A plain red circle on a white background'); ok = b.length > 100; detail = `${Math.round(b.length / 1024)} KB`; }
    else if (capability === 'vision') {
      const r = await upstreamChat(t.provider, t.model, secret, { messages: [{ role: 'user', content: [{ type: 'image', data: solidPng(220, 30, 30), mime: 'image/png' }, { type: 'text', text: 'What is the main color of this image? Answer with one word.' }] }], maxTokens: 200, timeoutMs: 45_000 });
      ok = /red|红/i.test(r.text); detail = r.text.trim().slice(0, 60) || '（空）';
    } else if (capability === 'json') {
      const schema = z.object({ ok: z.boolean(), n: z.number() });
      const r = await upstreamChat(t.provider, t.model, secret, { messages: [{ role: 'user', content: 'Return ok=true and n=7.' }], json: { name: 'probe', schema: toGeminiSchema(schema) }, maxTokens: 300, timeoutMs: 45_000 });
      const d = schema.parse(extractJson(r.text)); ok = d.ok === true && d.n === 7; detail = JSON.stringify(d);
    } else {
      const r = await upstreamChat(t.provider, t.model, secret, { messages: [{ role: 'user', content: '只回复 OK' }], maxTokens: 200, timeoutMs: 45_000 });
      ok = r.text.trim().length > 0; detail = r.text.trim().slice(0, 60) || '（空）';
    }
  } catch (e) { const up = e instanceof UpstreamError ? e : undefined; cls = classifyError(up?.status, String((e as Error).message)); detail = String((e as Error).message).slice(0, 240); }
  const row = { id: newId('llt'), version: snap.version, target_id: targetId, credential_id: cred.id, cred: cred.hint, capability, ok, latency_ms: Date.now() - t0, error_class: cls ?? null, detail };
  await getDb().insert(llmTests).values(row).catch((e) => logger.debug({ e }, '测试结果写入失败'));
  return { ...row, at: new Date().toISOString() };
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

/** 已接入的 Vertex 连接（语音合成这类只有 Google 原生接口才有的能力借用它）；没接入时返回 undefined */
export async function vertexAccess(): Promise<{ base: string; token: string } | undefined> {
  const snap = await snapshot();
  for (const p of snap.config.providers) {
    if (p.protocol !== 'vertex' || !p.enabled) continue;
    const c = usableCredentials(p, health, Date.now())[0]; if (!c) continue;
    const secret = await secretOf(p.id, c.secret_id);
    return { base: vertexBase(p, secret), token: await googleToken(secret) };
  }
  return undefined;
}

/** 发布主线跑得起来需要：每一步、归纳、定位各至少有一个此刻可用的目标 */
export async function modelsReady(): Promise<{ ready: boolean; missing: Use[] }> {
  const { config } = await snapshot();
  const missing = (['step', 'think', 'locate'] as Use[]).filter((u) => !candidates(config, u).eligible.length);
  return { ready: !missing.length, missing };
}

let gw: Gateway | undefined;
export const gateway = () => (gw ??= new Gateway());

/** 评审与被评审的想法是不是出自同一家厂商（同一家时结论要标注并降一级可信度） */
export async function checkVendorIsolation(): Promise<{ ok: boolean; warnings: string[] }> {
  const { config } = await snapshot();
  const first = (u: Use) => candidates(config, u).eligible[0];
  const step = first('step'); const think = first('think');
  if (!step || !think) return { ok: true, warnings: [] };
  return vendorOf(step) === vendorOf(think) ? { ok: false, warnings: [`评审（${think.model.model}）与人物的想法（${step.model.model}）出自同一家厂商：${vendorOf(step)}`] } : { ok: true, warnings: [] };
}
