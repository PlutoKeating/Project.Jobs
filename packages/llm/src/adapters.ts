// 上游协议适配：OpenAI 兼容（绝大多数供应商）、Anthropic Messages、Vertex AI（Google 凭证 JSON 或凭证文件的引用换访问令牌后走 OpenAI 兼容入口）。
// 这一层只管「把一次请求发给一个目标」，不做重试与换目标（那是路由的事）。
import { createSign } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { gcloudDirs, readGcloud } from './gcloud.ts';
import type { ModelEntry, ProviderConn } from './config.ts';

export type ContentPart = { type: 'text'; text: string } | { type: 'image'; data: Buffer | string; mime?: string };
export interface Msg { role: 'system' | 'user' | 'assistant'; content: string | ContentPart[] }
export interface ChatReq { messages: Msg[]; temperature?: number; maxTokens?: number; reasoning?: 'low' | 'medium' | 'high'; json?: { name: string; schema: Record<string, unknown> }; timeoutMs?: number }
export interface ChatRes { text: string; usage: { prompt: number; completion: number; reasoning: number } }

export class UpstreamError extends Error {
  constructor(message: string, public status?: number, public retryAfterMs?: number) { super(message); }
}

// ---- 出站地址检查：凭证只发往管理员保存的地址；不跟随跳转；不碰云主机的元数据地址 ----
const META = /^(169\.254\.|fd00:ec2:|fe80:)/i;
const checked = new Map<string, number>();
export async function assertAllowed(url: string) {
  const u = new URL(url);
  if (!['http:', 'https:'].includes(u.protocol)) throw new UpstreamError('地址必须是 http 或 https');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if ((checked.get(host) ?? 0) > Date.now()) return;
  if (/^metadata\.|\.internal$/i.test(host) || META.test(host)) throw new UpstreamError('不允许访问这个地址（云主机的元数据服务）');
  try { for (const a of await lookup(host, { all: true })) if (META.test(a.address)) throw new UpstreamError('不允许访问这个地址（解析到了元数据服务）'); }
  catch (e) { if (e instanceof UpstreamError) throw e; /* 解析失败交给后面的请求去报错 */ }
  checked.set(host, Date.now() + 60_000);
}

/** 网络层报错：fetch 只说 fetch failed，真正的原因（对方断开、超时、DNS…）在 cause 里，一起带上 */
const netError = (e: unknown) => {
  const err = e as Error & { cause?: { code?: string; message?: string } };
  const c = err.cause; const why = c ? [c.code, c.message].filter(Boolean).join(' ') : '';
  return new UpstreamError(`${String(err?.message ?? e)}${why && !String(err?.message).includes(why) ? `（${why}）` : ''}`);
};

async function send(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number, signal?: AbortSignal): Promise<Response> {
  await assertAllowed(url);
  const sig = signal ? AbortSignal.any([AbortSignal.timeout(timeoutMs), signal]) : AbortSignal.timeout(timeoutMs);
  try { return await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), redirect: 'error', signal: sig }); }
  catch (e) { throw netError(e); }
}

async function post(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number): Promise<unknown> {
  const r = await send(url, headers, body, timeoutMs);
  let text: string; try { text = await r.text(); } catch (e) { throw netError(e); }
  if (!r.ok) throw httpError(r, text);
  try { return JSON.parse(text); } catch { throw new UpstreamError('上游返回的不是 JSON'); }
}

/**
 * 流式请求：逐个交出 SSE 的 data（已解析成对象）。
 * 为什么要流式：模型想得久时，非流式请求在拿到整段回答之前连接上一个字节都没有，
 * 中间的代理或网关会把这种「空闲」连接在一两分钟后掐断（fetch failed）。流式时数据一直在流动。
 * 上游不按 SSE 回（返回了普通 JSON）时，把那个 JSON 当成唯一的一条交出
 */
export async function* stream(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number, signal?: AbortSignal): AsyncGenerator<Record<string, unknown>> {
  const r = await send(url, headers, body, timeoutMs, signal);
  if (!r.ok) { let text = ''; try { text = await r.text(); } catch { /* */ } throw httpError(r, text); }
  if (!(r.headers.get('content-type') ?? '').includes('event-stream')) {
    let text: string; try { text = await r.text(); } catch (e) { throw netError(e); }
    try { yield JSON.parse(text) as Record<string, unknown>; return; } catch { throw new UpstreamError('上游返回的不是 JSON'); }
  }
  const rd = r.body!.getReader(); const dec = new TextDecoder(); let buf = '';
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try { chunk = await rd.read(); } catch (e) { throw netError(e); }
    if (chunk.done) break;
    buf += dec.decode(chunk.value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      const d = line.slice(5).trim(); if (!d || d === '[DONE]') continue;
      let o: Record<string, unknown>; try { o = JSON.parse(d) as Record<string, unknown>; } catch { continue; }
      yield o;
    }
  }
}

function httpError(r: Response, text: string): UpstreamError {
  let msg = text.slice(0, 600);
  try { const j = JSON.parse(text) as { error?: { message?: string } | string; message?: string } | { error?: { message?: string } }[]; const o = Array.isArray(j) ? j[0] : j; msg = (typeof o?.error === 'string' ? o.error : o?.error?.message) ?? (o as { message?: string })?.message ?? msg; } catch { /* 不是 JSON */ }
  const ra = Number(r.headers.get('retry-after')); const ms = Number.isFinite(ra) && ra > 0 ? ra * 1000 : undefined;
  return new UpstreamError(String(msg).slice(0, 600), r.status, ms);
}

// ---- Google 凭证 JSON → 访问令牌（服务账号或 gcloud 的 application default credentials）----
// 也可以只保存一个引用，每次换令牌前现读，宿主机上重新登录之后不用回到「模型」页重新粘贴：
//   { "gcloud": "auto" | "<gcloud 配置目录>", "project_id"?: "<项目>" }：这台机器的 gcloud 登录（gcloud auth login），见 gcloud.ts
//   { "file": "<凭证文件的绝对路径>", "project_id"?: "<项目>" }：一个 Google 凭证文件
interface GoogleCred { type?: string; client_id?: string; client_secret?: string; refresh_token?: string; client_email?: string; private_key?: string; token_uri?: string; project_id?: string; quota_project_id?: string }
const tokens = new Map<string, { token: string; exp: number }>();
const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');

/** 保存的凭证 → 实际的 Google 凭证（文件引用时现读文件；引用里写的项目优先于文件里的） */
export function googleCred(secret: string): GoogleCred {
  let j: GoogleCred & { file?: unknown; gcloud?: unknown };
  try { j = JSON.parse(secret) as typeof j; } catch { throw new UpstreamError('这里需要粘贴 Google 凭证的 JSON（服务账号密钥，gcloud auth application-default login 生成的文件内容，或 {"gcloud": "auto"} 使用这台机器的 gcloud 登录）', 401); }
  if (typeof j.gcloud === 'string') {
    const dirs = j.gcloud === 'auto' ? gcloudDirs() : [j.gcloud];
    if (!dirs.length) throw new UpstreamError('没有找到 gcloud 的配置目录：确认它挂进了容器（见安装文档「用这台机器的 gcloud 登录」）', 401);
    let last: Error | undefined;
    for (const d of dirs) {
      try { const l = readGcloud(d); const project = j.project_id ?? j.quota_project_id ?? l.project; return project ? { ...(l.cred as GoogleCred), quota_project_id: project } : (l.cred as GoogleCred); }
      catch (e) { last ??= e as Error; }
    }
    throw new UpstreamError(last?.message ?? 'gcloud 没有登录', 401);
  }
  if (typeof j.file !== 'string') return j;
  if (!isAbsolute(j.file)) throw new UpstreamError('凭证文件的路径要写成绝对路径', 401);
  let text: string;
  try { text = readFileSync(j.file, 'utf8'); } catch (e) { throw new UpstreamError(`读不到凭证文件 ${j.file}（${(e as NodeJS.ErrnoException).code ?? 'error'}）：确认它挂进了容器`, 401); }
  let f: GoogleCred; try { f = JSON.parse(text) as GoogleCred; } catch { throw new UpstreamError(`凭证文件 ${j.file} 不是 JSON`, 401); }
  const project = j.project_id ?? j.quota_project_id;
  return project ? { ...f, quota_project_id: project } : f;
}
export function googleProject(secret: string): string | undefined { try { const j = googleCred(secret); return j.quota_project_id ?? j.project_id; } catch { return undefined; } }

export async function googleToken(secret: string): Promise<string> {
  const j = googleCred(secret);
  const key = JSON.stringify(j);                                                     // 文件内容换了（重新登录）就是新的缓存键
  const hit = tokens.get(key); if (hit && hit.exp > Date.now() + 60_000) return hit.token;
  const tokenUri = 'https://oauth2.googleapis.com/token';
  let form: URLSearchParams;
  if (j.type === 'authorized_user' && j.refresh_token) form = new URLSearchParams({ grant_type: 'refresh_token', client_id: j.client_id ?? '', client_secret: j.client_secret ?? '', refresh_token: j.refresh_token });
  else if (j.client_email && j.private_key) {
    const now = Math.floor(Date.now() / 1000);
    const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' })); const claim = b64u(JSON.stringify({ iss: j.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: tokenUri, iat: now, exp: now + 3600 }));
    const sig = createSign('RSA-SHA256').update(`${head}.${claim}`).sign(j.private_key);
    form = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claim}.${b64u(sig)}` });
  } else throw new UpstreamError('认不出这份 Google 凭证的类型', 401);
  let r: Response;
  try { r = await fetch(tokenUri, { method: 'POST', body: form, signal: AbortSignal.timeout(20_000) }); } catch (e) { throw new UpstreamError(String((e as Error).message)); }
  const t = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!r.ok || !t.access_token) throw new UpstreamError(`Google 凭证换不到访问令牌：${t.error_description ?? t.error ?? r.status}`, r.status === 400 ? 401 : r.status);
  if (tokens.size > 50) tokens.clear();
  tokens.set(key, { token: t.access_token, exp: Date.now() + (t.expires_in ?? 3000) * 1000 });
  return t.access_token;
}

export function vertexBase(p: ProviderConn, secret: string): string {
  const project = googleProject(secret);
  if (p.base_url.includes('{project}') && !project) throw new UpstreamError('这份 Google 凭证里没有项目 ID（quota_project_id / project_id）', 401);
  return p.base_url.replace('{project}', project ?? '');
}

/** 一个目标的请求地址、请求头、上游模型名（OpenAI 兼容的两种协议共用） */
export async function openaiEndpoint(p: ProviderConn, m: ModelEntry, secret: string): Promise<{ base: string; headers: Record<string, string>; model: string }> {
  if (p.protocol === 'vertex') return { base: `${vertexBase(p, secret)}/endpoints/openapi`, headers: { authorization: `Bearer ${await googleToken(secret)}` }, model: m.model.includes('/') ? m.model : `google/${m.model}` };
  return { base: p.base_url, headers: { authorization: `Bearer ${secret}` }, model: m.model };
}

export const dataUrl = (p: Extract<ContentPart, { type: 'image' }>) => `data:${p.mime ?? 'image/jpeg'};base64,${typeof p.data === 'string' ? p.data : p.data.toString('base64')}`;
const jsonHint = (j: NonNullable<ChatReq['json']>) => `\n\n只输出一个 JSON 对象（不要解释、不要代码块），符合这个 JSON Schema：\n${JSON.stringify(j.schema)}`;
function withJsonHint(msgs: Msg[], j: NonNullable<ChatReq['json']>): Msg[] {
  const out = msgs.map((m) => ({ ...m })); const i = out.map((m) => m.role).lastIndexOf('user');
  if (i < 0) return [...out, { role: 'user', content: jsonHint(j).trim() }];
  const c = out[i].content;
  out[i].content = typeof c === 'string' ? c + jsonHint(j) : [...c, { type: 'text', text: jsonHint(j).trim() }];
  return out;
}

/** 某个目标不接受的可选参数（记在内存里，下次不再带上） */
const dropped = new Map<string, Set<string>>();
const OPTIONAL = ['temperature', 'reasoning_effort', 'response_format', 'max_tokens', 'stream'] as const;
/** Vertex 的推理强度用 thinking_config 给（和 reasoning_effort 二选一），同时要它把思考摘要流出来：连接上一直有数据，不会被当成空闲连接掐断 */
const VERTEX_LEVEL = { low: 'low', medium: 'medium', high: 'high' } as const;

interface OAChunk { choices?: { delta?: { content?: string | null; extra_content?: { google?: { thought?: boolean } } }; message?: { content?: string | { type?: string; text?: string }[] | null }; finish_reason?: string | null }[]; usage?: { prompt_tokens?: number; completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } }; error?: { message?: string } }

async function chatOpenAI(p: ProviderConn, m: ModelEntry, secret: string, req: ChatReq): Promise<ChatRes> {
  const ep = await openaiEndpoint(p, m, secret);
  const skip = dropped.get(m.id) ?? new Set<string>();
  for (let round = 0; ; round++) {
    const native = req.json && m.caps.json && !skip.has('response_format');
    const msgs = req.json && !native ? withJsonHint(req.messages, req.json) : req.messages;
    const body: Record<string, unknown> = { model: ep.model, messages: msgs.map((x) => (typeof x.content === 'string' ? { role: x.role, content: x.content } : { role: x.role, content: x.content.map((c) => (c.type === 'text' ? { type: 'text', text: c.text } : { type: 'image_url', image_url: { url: dataUrl(c) } })) })) };
    if (req.temperature !== undefined && !skip.has('temperature')) body.temperature = req.temperature;
    if (req.maxTokens) body[skip.has('max_tokens') ? 'max_completion_tokens' : 'max_tokens'] = req.maxTokens;
    const vertexThinking = p.protocol === 'vertex' && !skip.has('reasoning_effort');
    if (vertexThinking) body.extra_body = { google: { thinking_config: { include_thoughts: true, ...(req.reasoning ? { thinking_level: VERTEX_LEVEL[req.reasoning] } : {}) } } };
    else if (req.reasoning && !skip.has('reasoning_effort')) body.reasoning_effort = req.reasoning;
    if (native) body.response_format = { type: 'json_schema', json_schema: { name: req.json!.name, schema: req.json!.schema } };
    if (!skip.has('stream')) { body.stream = true; body.stream_options = { include_usage: true }; }
    try {
      let text = ''; let finish: string | null | undefined; let usage: OAChunk['usage'];
      for await (const raw of stream(`${ep.base}/chat/completions`, ep.headers, body, req.timeoutMs ?? 180_000)) {
        const r = raw as OAChunk;
        if (r.error?.message) throw new UpstreamError(r.error.message, 400);                 // 有的上游把错误放在 200 的正文里
        const ch = r.choices?.[0];
        // 思考摘要（Vertex 标 thought）只用来让连接保持有数据，不算回答
        if (ch?.delta && !ch.delta.extra_content?.google?.thought && typeof ch.delta.content === 'string') text += ch.delta.content;
        const c = ch?.message?.content;                                                        // 非流式回答
        if (c) text += typeof c === 'string' ? c : c.map((x) => x.text ?? '').join('');
        if (ch?.finish_reason) finish = ch.finish_reason;
        if (r.usage) usage = r.usage;
      }
      if (!text && finish === 'content_filter') throw new UpstreamError('content filter', 400);
      return { text, usage: { prompt: usage?.prompt_tokens ?? 0, completion: usage?.completion_tokens ?? 0, reasoning: usage?.completion_tokens_details?.reasoning_tokens ?? 0 } };
    } catch (e) {
      // 可选参数被拒：去掉它再试（温度、推理强度是提示性的；结构化输出改成在提示里给 schema，结果仍由调用方校验）
      const msg = e instanceof UpstreamError && e.status === 400 ? e.message.toLowerCase() : '';
      const has = (k: string) => k in body || (k === 'max_tokens' && 'max_completion_tokens' in body) || (k === 'reasoning_effort' && 'extra_body' in body);
      const bad = round < 4 ? OPTIONAL.find((k) => !skip.has(k) && has(k) && (msg.includes(k) || (k === 'response_format' && /json_schema|structured|response format/.test(msg)) || (k === 'reasoning_effort' && /reasoning|thinking|extra_body/.test(msg)) || (k === 'max_tokens' && msg.includes('max_completion_tokens')) || (k === 'stream' && /stream/.test(msg)))) : undefined;
      if (!bad) throw e;
      skip.add(bad); dropped.set(m.id, skip);
    }
  }
}

async function chatAnthropic(p: ProviderConn, m: ModelEntry, secret: string, req: ChatReq): Promise<ChatRes> {
  const msgs = req.json ? withJsonHint(req.messages, req.json) : req.messages;
  const system = msgs.filter((x) => x.role === 'system').map((x) => (typeof x.content === 'string' ? x.content : x.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n'))).join('\n\n');
  const messages = msgs.filter((x) => x.role !== 'system').map((x) => ({ role: x.role, content: typeof x.content === 'string' ? x.content : x.content.map((c) => (c.type === 'text' ? { type: 'text', text: c.text } : { type: 'image', source: { type: 'base64', media_type: c.mime ?? 'image/jpeg', data: typeof c.data === 'string' ? c.data : c.data.toString('base64') } })) }));
  const body: Record<string, unknown> = { model: m.model, max_tokens: req.maxTokens ?? Math.min(m.caps.output ?? 8192, 8192), messages };
  if (system) body.system = system;
  if (req.temperature !== undefined) body.temperature = Math.min(1, req.temperature);
  body.stream = true;   // 流式：模型想得久时连接上也一直有数据（Anthropic 还会定时发 ping），不会被中间的代理当成空闲连接掐断
  let text = ''; let prompt = 0; let completion = 0;
  for await (const e of stream(`${p.base_url}/messages`, { 'x-api-key': secret, 'anthropic-version': '2023-06-01' }, body, req.timeoutMs ?? 180_000)) {
    const ev = e as { type?: string; delta?: { type?: string; text?: string }; message?: { usage?: { input_tokens?: number; output_tokens?: number } }; usage?: { output_tokens?: number }; error?: { message?: string }; content?: { type: string; text?: string }[] };
    if (ev.type === 'error') throw new UpstreamError(ev.error?.message ?? 'upstream error', 529);
    if (ev.type === 'message_start') { prompt = ev.message?.usage?.input_tokens ?? 0; completion = ev.message?.usage?.output_tokens ?? 0; }
    else if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') text += ev.delta.text ?? '';
    else if (ev.type === 'message_delta') completion = ev.usage?.output_tokens ?? completion;
    else if (ev.content) { text += ev.content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join(''); prompt = (ev as { usage?: { input_tokens?: number } }).usage?.input_tokens ?? prompt; completion = ev.usage?.output_tokens ?? completion; }   // 上游不流式时的整段回答
  }
  return { text, usage: { prompt, completion, reasoning: 0 } };
}

export const chat = (p: ProviderConn, m: ModelEntry, secret: string, req: ChatReq) => (p.protocol === 'anthropic' ? chatAnthropic(p, m, secret, req) : chatOpenAI(p, m, secret, req));

export async function embed(p: ProviderConn, m: ModelEntry, secret: string, text: string, dims: number): Promise<number[]> {
  if (p.protocol === 'anthropic') throw new UpstreamError('这个协议没有向量接口', 400);
  if (p.protocol === 'vertex') {
    const base = `${vertexBase(p, secret)}/publishers/google/models/${m.model}`; const headers = { authorization: `Bearer ${await googleToken(secret)}` };
    try { const r = (await post(`${base}:embedContent`, headers, { content: { parts: [{ text }] }, outputDimensionality: dims }, 60_000)) as { embedding?: { values?: number[] } }; if (r.embedding?.values?.length) return r.embedding.values; }
    catch (e) { if (!(e instanceof UpstreamError) || (e.status !== 404 && e.status !== 400)) throw e; }
    const r = (await post(`${base}:predict`, headers, { instances: [{ content: text }], parameters: { outputDimensionality: dims } }, 60_000)) as { predictions?: { embeddings?: { values?: number[] } }[] };
    const v = r.predictions?.[0]?.embeddings?.values; if (!v?.length) throw new UpstreamError('上游没有返回向量');
    return v;
  }
  const r = (await post(`${p.base_url}/embeddings`, { authorization: `Bearer ${secret}` }, { model: m.model, input: text, dimensions: dims }, 60_000)) as { data?: { embedding?: number[] }[] };
  const v = r.data?.[0]?.embedding; if (!v?.length) throw new UpstreamError('上游没有返回向量');
  return v;
}

export async function image(p: ProviderConn, m: ModelEntry, secret: string, prompt: string): Promise<Buffer> {
  if (p.protocol === 'vertex') {
    const r = (await post(`${vertexBase(p, secret)}/publishers/google/models/${m.model}:generateContent`, { authorization: `Bearer ${await googleToken(secret)}` }, { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } }, 120_000)) as { candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[] };
    const d = r.candidates?.[0]?.content?.parts?.find((x) => x.inlineData?.data)?.inlineData?.data;
    if (!d) throw new UpstreamError('上游没有返回图片'); return Buffer.from(d, 'base64');
  }
  if (p.protocol === 'anthropic') throw new UpstreamError('这个协议没有画图接口', 400);
  const r = (await post(`${p.base_url}/images/generations`, { authorization: `Bearer ${secret}` }, { model: m.model, prompt, n: 1, response_format: 'b64_json' }, 120_000)) as { data?: { b64_json?: string; url?: string }[] };
  const x = r.data?.[0];
  if (x?.b64_json) return Buffer.from(x.b64_json, 'base64');
  if (x?.url) { await assertAllowed(x.url); return Buffer.from(await (await fetch(x.url, { signal: AbortSignal.timeout(60_000) })).arrayBuffer()); }
  throw new UpstreamError('上游没有返回图片');
}
