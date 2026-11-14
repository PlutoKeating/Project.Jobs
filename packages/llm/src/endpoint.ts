// OpenAI 兼容的本地入口：给自己发 HTTP 请求的组件用（Midscene 在截图上定位、示例产品里的 AI 功能）。
// 请求按模型组路由到已发布配置里的目标；失败时按全局顺序换下一个。只转发到 OpenAI 兼容协议的目标。
import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { logger } from '@pux/core';
import { assertAllowed, openaiEndpoint, UpstreamError } from './adapters.ts';
import { candidates, classifyError, usableCredentials, USES, type Use } from './config.ts';
import { health, secretOf, snapshot } from './store.ts';
import { gateway, noteFailure, noModelMessage, targetName, type Tags } from './index.ts';

const errorBody = (message: string, type = 'jobs_router') => JSON.stringify({ error: { message, type } });

/** 把一个 chat/completions 请求体转发给第一个能用的目标，返回上游的响应（流式原样透传） */
export async function proxyChat(use: Use, body: Record<string, unknown>, o: { family?: string; tags?: Tags } = {}): Promise<Response> {
  const snap = await snapshot();
  const { eligible, skipped } = candidates(snap.config, use, { family: o.family }, health);
  const usable = eligible.filter((t) => t.provider.protocol !== 'anthropic');
  if (!usable.length) return new Response(errorBody(noModelMessage(use, skipped)), { status: 503, headers: { 'content-type': 'application/json' } });
  let last = '';
  for (const [i, t] of usable.slice(0, 3).entries()) {
    const cred = usableCredentials(t.provider, health, Date.now())[0]; if (!cred) continue;
    const t0 = Date.now();
    try {
      const ep = await openaiEndpoint(t.provider, t.model, await secretOf(t.provider.id, cred.secret_id));
      const out: Record<string, unknown> = { ...body, model: ep.model };
      if (!/generativelanguage\.googleapis\.com/.test(ep.base)) delete out.google;       // 只有 Google 自家入口认识这个扩展字段
      await assertAllowed(ep.base);
      const r = await fetch(`${ep.base}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', ...ep.headers }, body: JSON.stringify(out), redirect: 'error', signal: AbortSignal.timeout(180_000) });
      if (!r.ok) { const text = (await r.text()).slice(0, 600); const ra = Number(r.headers.get('retry-after')); throw new UpstreamError(text, r.status, ra > 0 ? ra * 1000 : undefined); }
      if (body.stream) { void gateway().trace(`proxy_${use}`, use, snap, t, cred, o.tags, { prompt: 0, completion: 0, reasoning: 0 }, Date.now() - t0, 'ok', i + 1); return new Response(r.body, { status: 200, headers: { 'content-type': r.headers.get('content-type') ?? 'text/event-stream', 'cache-control': 'no-cache' } }); }
      const text = await r.text();
      let usage = { prompt: 0, completion: 0, reasoning: 0 };
      try { const u = (JSON.parse(text) as { usage?: { prompt_tokens?: number; completion_tokens?: number } }).usage; usage = { prompt: u?.prompt_tokens ?? 0, completion: u?.completion_tokens ?? 0, reasoning: 0 }; } catch { /* 不是 JSON 就不记用量 */ }
      void gateway().trace(`proxy_${use}`, use, snap, t, cred, o.tags, usage, Date.now() - t0, 'ok', i + 1);
      return new Response(text, { status: 200, headers: { 'content-type': 'application/json' } });
    } catch (e) {
      const up = e instanceof UpstreamError ? e : undefined; const cls = classifyError(up?.status, String((e as Error).message));
      last = `${targetName(t)}：${String((e as Error).message).slice(0, 200)}`;
      void gateway().trace(`proxy_${use}`, use, snap, t, cred, o.tags, { prompt: 0, completion: 0, reasoning: 0 }, Date.now() - t0, 'error', i + 1, last, cls);
      noteFailure(t, cred, cls, up?.retryAfterMs);
      logger.warn({ target: targetName(t), cls }, '转发失败，换下一个目标');
    }
  }
  return new Response(errorBody(`所有目标都失败了。${last}`), { status: 502, headers: { 'content-type': 'application/json' } });
}

/** 处理 POST /<模型组>[/<定位家族>]/v1/chat/completions（Node 原生 http 的形态，API 与本地入口共用） */
export async function handleProxy(path: string, bodyText: string, tags?: Tags): Promise<Response> {
  const m = /^\/?(step|think|locate)(?:\/([a-z0-9.-]+))?\/v1\/chat\/completions\/?$/.exec(path);
  if (!m || !USES.includes(m[1] as Use)) return new Response(errorBody('not found'), { status: 404, headers: { 'content-type': 'application/json' } });
  let body: Record<string, unknown>;
  try { body = JSON.parse(bodyText) as Record<string, unknown>; } catch { return new Response(errorBody('请求体不是 JSON'), { status: 400, headers: { 'content-type': 'application/json' } }); }
  return proxyChat(m[1] as Use, body, { family: m[2], tags });
}

let local: Promise<{ url: (use: Use, family?: string) => string; key: string }> | undefined;
/** 在本机回环地址上起一个只有本进程知道口令的入口（给同进程里的 Midscene 用） */
export function startLocalEndpoint() {
  local ??= new Promise((resolve, reject) => {
    const key = `jobs-${randomBytes(18).toString('base64url')}`;
    const srv = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'POST' || req.headers.authorization !== `Bearer ${key}`) { res.writeHead(401, { 'content-type': 'application/json' }).end(errorBody('unauthorized')); return; }
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        void handleProxy((req.url ?? '').split('?')[0], Buffer.concat(chunks).toString('utf8')).then(async (r) => {
          res.writeHead(r.status, Object.fromEntries(r.headers));
          if (r.body) { const reader = r.body.getReader(); for (;;) { const { done, value } = await reader.read(); if (done) break; res.write(value); } }
          res.end();
        }).catch((e) => { res.writeHead(500, { 'content-type': 'application/json' }).end(errorBody(String((e as Error).message))); });
      });
    });
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => { srv.unref(); const port = (srv.address() as AddressInfo).port; resolve({ key, url: (use, family) => `http://127.0.0.1:${port}/${use}${family ? `/${family}` : ''}/v1` }); });
  });
  return local;
}
