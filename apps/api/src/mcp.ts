// 远程 MCP：coding agent 只要一个链接 <公网链接>/mcp（公网链接在设置页填，其次是 JOBS_PUBLIC_URL）。Streamable HTTP（无状态：每个请求一个 McpServer），OAuth 2.1 授权。
// 协议实现都用 MCP SDK（mcpAuthRouter、requireBearerAuth、StreamableHTTPServerTransport），它们是 Express 中间件：
// 这里建一个小的 Express 应用，挂在 Fastify 的几个路径上（Fastify 不解析这些请求的正文，原样交给 Express）。
// 工具与本机 stdio 服务是同一份（@pux/engine/launch/tools），执行时在进程内转发到 /api/v1，带着这次授权的令牌，权限检查只在接口那一层。
import express, { type Request, type Response } from 'express';
import type { FastifyInstance } from 'fastify';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { getOAuthProtectedResourceMetadataUrl, mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { jobsVersion, logger } from '@pux/core';
import { JOBS_TOOLS, MCP_INSTRUCTIONS, type ToolApi } from '@pux/engine/launch/tools';
import { publicUrl, publicUrlSet } from '@pux/engine/mail/settings';
import { roleForPasscode, requireAdmin } from './auth.ts';
import { JobsOAuthProvider, issueCode, listGrants, loginPage, noteFail, revokeGrant, tooMany, unsign } from './oauth.ts';

const PATHS = ['/mcp', '/authorize', '/token', '/register', '/revoke', '/oauth/login', '/.well-known/oauth-authorization-server', '/.well-known/oauth-authorization-server/mcp', '/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'];

export async function mcpRoutes(app: FastifyInstance) {
  // 对外地址来自设置页（其次是 JOBS_PUBLIC_URL）；网页上改了之后，下一个请求就按新地址重建授权元数据
  let cur: { base: string; mcpUrl: URL; ex: express.Express | null; why: string } | undefined;
  const ensure = async () => {
    const base = await publicUrl();
    if (cur?.base === base) return cur;
    const mcpUrl = new URL(`${base}/mcp`);
    let ex: express.Express | null = null; let why = '';
    try { ex = buildExpress(app, base, mcpUrl); }
    catch (e) { why = String((e as Error).message); logger.warn({ err: why, public_url: base }, '远程 MCP 未启用：公网链接需要是 https 地址（本机地址除外）'); }
    cur = { base, mcpUrl, ex, why };
    return cur;
  };
  await ensure();

  await app.register(async (sub) => {
    // 这些路径的正文交给 Express 自己读
    sub.removeAllContentTypeParsers();
    sub.addContentTypeParser('*', (_req, _payload, done) => done(null));
    for (const p of PATHS) sub.all(p, async (q, r) => {
      const { ex, why } = await ensure();
      if (!ex) return r.code(503).send({ error: 'remote_mcp_disabled', hint: 'the public URL must be https (or a loopback address)', detail: why });
      r.hijack(); ex(q.raw as never, r.raw as never);
    });
  });

  // ---- 网页上的「接入 coding agent」：链接、各家 agent 的接入命令、已授权的 agent（可撤销）----
  app.get('/api/v1/agents', async (q, r) => {
    if (!requireAdmin(q, r)) return;
    const c = await ensure();
    return { mcp_url: c.mcpUrl.href, enabled: !!c.ex, public_url_set: await publicUrlSet(), grants: await listGrants() };
  });
  app.delete('/api/v1/agents/:id', async (q, r) => {
    if (!requireAdmin(q, r)) return;
    return (await revokeGrant((q.params as { id: string }).id)) ? { ok: true } : r.code(404).send({ error: 'not_found' });
  });
}

function buildExpress(app: FastifyInstance, base: string, mcpUrl: URL): express.Express {
  const provider = new JobsOAuthProvider(mcpUrl.href);
  const ex = express();
  ex.set('trust proxy', true);
  ex.disable('x-powered-by');
  // 元数据（RFC 8414 / 9728）、动态注册（RFC 7591）、/authorize、/token、/revoke；mcpAuthRouter 会检查 issuer 必须是 https（本机地址除外）
  ex.use(mcpAuthRouter({ provider, issuerUrl: new URL(base), resourceServerUrl: mcpUrl, resourceName: 'Jobs', serviceDocumentationUrl: new URL('https://github.com/PlutoKeating/Project.Jobs/blob/main/docs/API.md') }));

  // 授权页提交：口令对了就发授权码并跳回 agent
  ex.post('/oauth/login', express.urlencoded({ extended: false, limit: '16kb' }), async (req: Request, res: Response) => {
    const p = unsign(String(req.body?.req ?? ''));
    if (!p) { res.status(400).type('text').send('授权请求已过期，请回到 coding agent 重新发起。'); return; }
    const back = new URL(p.redirect_uri);
    if (p.state) back.searchParams.set('state', p.state);
    if (req.body?.deny) { back.searchParams.set('error', 'access_denied'); res.redirect(302, back.href); return; }
    const ip = req.ip ?? '';
    const client = await provider.clientsStore.getClient(p.client_id);
    const page = (error: string) => res.status(401).type('html').set('cache-control', 'no-store').send(loginPage({ client: client?.client_name ?? 'coding agent', redirect: p.redirect_uri, req: String(req.body.req), error, needPasscode: true }));
    if (tooMany(ip)) { page('输错太多次了，10 分钟后再试。'); return; }
    const role = roleForPasscode(String(req.body?.passcode ?? ''));
    if (!role) { noteFail(ip); page('口令不对。'); return; }
    back.searchParams.set('code', issueCode(p, role));
    res.redirect(302, back.href);
  });

  const auth = requireBearerAuth({ verifier: provider, resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpUrl), expectedResource: mcpUrl });
  ex.post('/mcp', auth, express.json({ limit: '4mb' }), async (req: Request & { auth?: AuthInfo }, res: Response) => {
    const a = req.auth!; const admin = a.extra?.role === 'admin';
    // 进程内转发到 REST，带上这次的令牌（onRequest 会把它认成对应的身份）
    const api: ToolApi = async <T,>(path: string, o: { method?: string; body?: unknown } = {}) => {
      const r = await app.inject({ method: (o.method ?? (o.body !== undefined ? 'POST' : 'GET')) as 'GET', url: `/api/v1${path}`, headers: { authorization: `Bearer ${a.token}`, ...(o.body !== undefined ? { 'content-type': 'application/json' } : {}) }, payload: o.body !== undefined ? JSON.stringify(o.body) : undefined });
      let data: unknown; try { data = r.body ? JSON.parse(r.body) : {}; } catch { data = { error: r.body.slice(0, 300) }; }
      if (r.statusCode >= 400) throw new Error(r.statusCode === 403 ? '这次授权用的是访客口令，只能看。要发布或请人试用，请用管理员口令重新授权（在 agent 里清除 jobs 的授权后重连）。' : `${r.statusCode} ${(data as { error?: string }).error ?? r.body.slice(0, 200)}`);
      return data as T;
    };
    const server = new McpServer({ name: 'jobs', version: jobsVersion() }, { instructions: MCP_INSTRUCTIONS, capabilities: { logging: {} } });
    for (const t of JOBS_TOOLS) {
      if (t.admin && !admin) continue;
      server.registerTool(t.name, { description: t.description, inputSchema: t.input }, async (args: Record<string, unknown>, extra) => {
        const token = extra._meta?.progressToken;
        const progress = token === undefined ? undefined : (done: number, total: number, message: string) => extra.sendNotification({ method: 'notifications/progress', params: { progressToken: token, progress: done, total, message } });
        // 心跳：等人用完、归纳结论都要几分钟，反向代理（例如 Cloudflare 约 100 秒）会切断长时间没有数据的响应流
        const beat = setInterval(() => { void extra.sendNotification({ method: 'notifications/message', params: { level: 'debug', logger: 'jobs', data: `${t.name}: still working` } }).catch(() => undefined); }, 25_000);
        try { return { content: [{ type: 'text' as const, text: await t.run(args, { api, signal: extra.signal, progress }) }] }; }
        catch (e) { return { content: [{ type: 'text' as const, text: `出错：${String((e as Error).message ?? e)}` }], isError: true }; }
        finally { clearInterval(beat); }
      });
    }
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => { void transport.close(); void server.close(); });
    try { await server.connect(transport); await transport.handleRequest(req, res, req.body); }
    catch (e) { logger.warn({ err: String((e as Error).message) }, '远程 MCP 请求失败'); if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'internal error' }, id: null }); }
  });
  // 无状态：没有会话，也就没有服务端推送流
  ex.all('/mcp', auth, (_req: Request, res: Response) => { res.status(405).set('allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null }); });
  return ex;
}
