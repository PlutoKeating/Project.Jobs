// JobsWorld API：REST /api/v1 + WebSocket /api/v1/stream（转发 NATS）+ 托管网页构建产物
import Fastify from 'fastify';
import fstatic from '@fastify/static';
import websocket from '@fastify/websocket';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataPath, jobsVersion, logger, REPO_ROOT } from '@pux/core';
import { connectBus, SUBJ, type Bus } from '@pux/jobsworld';
import { bearerOf, evidenceAllowed, isPasscode, roleOf, setOAuthRole } from './auth.ts';
import { lookupAccess } from './oauth.ts';
import { internalRole } from './internal.ts';
import { mcpRoutes } from './mcp.ts';
import { routes } from './routes.ts';
import { warmAvatars } from './avatars.ts';

const PORT = Number(process.env.API_PORT ?? 5320);
const HOST = process.env.API_HOST ?? '127.0.0.1';
const WEB_DIST = join(REPO_ROOT, 'apps', 'web', 'dist');

const app = Fastify({ logger: false, bodyLimit: 10 * 1024 * 1024, trustProxy: true });
await app.register(websocket);
await app.register(fstatic, { root: dataPath('reports'), prefix: '/reports/', decorateReply: false });
mkdirSync(WEB_DIST, { recursive: true });
await app.register(fstatic, { root: WEB_DIST, prefix: '/', wildcard: true, index: false });

// 收件箱接口对被测产品的测试环境开放（它只能往里投信，读不到任何东西）
const OPEN = new Set(['/api/v1/me', '/api/v1/auth/login', '/api/v1/auth/logout', '/healthz', '/api/v1/inbox/email', '/api/v1/inbox/sms']);
app.addHook('onRequest', async (q, r) => {
  const path = q.url.split('?')[0];
  // 远程 MCP 授权出去的令牌（不是口令本身时才查库）
  const inner = internalRole(q); if (inner) setOAuthRole(q, inner);
  const bearer = bearerOf(q);
  if (!inner && bearer && path.startsWith('/api/') && !isPasscode(bearer)) { const t = await lookupAccess(bearer).catch(() => null); if (t) setOAuthRole(q, t.role); }
  const guarded = path.startsWith('/api/') || path.startsWith('/reports/') || path.startsWith('/evidence/');
  if (guarded && !OPEN.has(path) && !roleOf(q).viewer && !evidenceAllowed(q)) return r.code(401).send({ error: 'auth_required' });
});

let bus: Bus | undefined;
try { bus = await connectBus('jobsworld-api'); } catch (e) { logger.warn({ err: String((e as Error).message) }, 'NATS 不可用：世界相关接口与实时推送关闭'); }

// ---- 实时推送：每个浏览器一个 WebSocket，服务端统一订阅 NATS 后扇出 ----
const clients = new Set<{ send: (s: string) => void; readyState: number }>();
if (bus) {
  for (const subject of [SUBJ.snapshot, SUBJ.liveAll, SUBJ.sayAll, SUBJ.launches]) {
    void (async () => {
      for await (const m of bus!.nc.subscribe(subject)) {
        if (!clients.size) continue;
        const kind = m.subject === SUBJ.snapshot ? 'snapshot' : m.subject === SUBJ.launches ? 'launches' : m.subject.endsWith('.live') ? 'live' : 'say';
        const frame = `{"type":"${kind}","data":${new TextDecoder().decode(m.data)}}`;
        for (const c of clients) if (c.readyState === 1) c.send(frame);
      }
    })();
  }
}
app.get('/api/v1/stream', { websocket: true }, (socket, req) => {
  if (!roleOf(req).viewer) { socket.close(4401, 'auth_required'); return; }
  clients.add(socket);
  socket.on('close', () => clients.delete(socket));
});

routes(app, bus);
await mcpRoutes(app);
app.get('/healthz', async () => ({ ok: true, version: jobsVersion(), nats: !!bus }));

// SPA 回退：非 API 的 GET 都返回 index.html
const indexHtml = () => (existsSync(join(WEB_DIST, 'index.html')) ? readFileSync(join(WEB_DIST, 'index.html'), 'utf8') : '<!doctype html><meta charset="utf-8"><title>JobsWorld</title><p>pnpm web:build</p>');
app.get('/', (_q, r) => r.type('text/html; charset=utf-8').header('cache-control', 'no-cache').send(indexHtml()));
app.setNotFoundHandler((q, r) => {
  if (q.method === 'GET' && !q.url.startsWith('/api/')) return r.type('text/html; charset=utf-8').header('cache-control', 'no-cache').send(indexHtml());
  return r.code(404).send({ error: 'not_found' });
});

await app.listen({ port: PORT, host: HOST });
logger.info(`JobsWorld API：http://${HOST}:${PORT}/`);
void warmAvatars();

const stop = async () => { await app.close(); await bus?.close(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
