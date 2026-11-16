// 远程 MCP 的 OAuth 2.1 授权服务（协议层的错误信息用英文：它们会进 WWW-Authenticate 头，头里不能有非 ASCII 字符）（给 coding agent 用）：协议部分（元数据、动态注册、PKCE 校验、令牌接口、限流）用 MCP SDK 的 mcpAuthRouter，
// 这里只实现它要的 provider：客户端与令牌落库（令牌只存哈希）、授权页就是「输入口令」。
// 身份沿用两个口令：管理员口令 → admin（全部工具），访客口令 → viewer（只读工具）。访问令牌 1 小时、刷新令牌 30 天（每次刷新都换新的）；
// 任何一个口令换了，之前发出的令牌全部失效；也可以在网页上逐个撤销。
import type { Response } from 'express';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { OAuthServerProvider, AuthorizationParams } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { OAuthClientInformationFull, OAuthTokenRevocationRequest, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { InvalidGrantError, InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { newId } from '@pux/core';
import { and, desc, eq, getDb, gt, inArray, oauthClients, oauthTokens } from '@pux/db';
import { adminEnabled, authEnabled, passcodeFp, type OAuthRole } from './auth.ts';

export const ACCESS_TTL_S = 3600;
export const REFRESH_TTL_S = 30 * 24 * 3600;
const CODE_TTL_MS = 10 * 60_000;

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const token = (prefix: string) => `${prefix}_${randomBytes(32).toString('base64url')}`;
const secret = () => process.env.JW_SESSION_SECRET ?? `${process.env.JW_PASSCODE ?? ''}|${process.env.JW_ADMIN_PASSCODE ?? ''}|jobsworld-oauth`;

// ---- 授权页带着的参数：签名后放进表单，提交时原样取回，防止被改 ----
interface Pending { client_id: string; redirect_uri: string; challenge: string; state?: string; resource?: string; exp: number }
const sign = (p: Pending) => { const b = Buffer.from(JSON.stringify(p)).toString('base64url'); return `${b}.${createHmac('sha256', secret()).update(b).digest('base64url')}`; };
export function unsign(s: string): Pending | null {
  const [b, mac] = s.split('.'); if (!b || !mac) return null;
  const want = createHmac('sha256', secret()).update(b).digest('base64url');
  if (want.length !== mac.length || !timingSafeEqual(Buffer.from(want), Buffer.from(mac))) return null;
  try { const p = JSON.parse(Buffer.from(b, 'base64url').toString()) as Pending; return p.exp > Date.now() ? p : null; } catch { return null; }
}

// ---- 授权码：只活 10 分钟、只能用一次。放内存（API 是单进程；重启后重新授权即可）----
const codes = new Map<string, Pending & { role: OAuthRole }>();
export function issueCode(p: Pending, role: OAuthRole): string {
  for (const [k, v] of codes) if (v.exp < Date.now()) codes.delete(k);
  const code = token('jwc'); codes.set(code, { ...p, role, exp: Date.now() + CODE_TTL_MS }); return code;
}

// ---- 授权页：输入口令 ----
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function loginPage(o: { client: string; redirect: string; req: string; error?: string; needPasscode: boolean }): string {
  const host = (() => { try { return new URL(o.redirect).host; } catch { return o.redirect; } })();
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>授权 · Jobs</title>
<style>:root{color-scheme:dark light;--bg:#141414;--fg:#e8e6e1;--muted:#9a9790;--line:#2c2c2c;--btn:#e8e6e1;--btnfg:#141414;--danger:#e5806b}@media (prefers-color-scheme:light){:root{--bg:#f7f6f3;--fg:#1c1c1c;--muted:#6b6862;--line:#dedbd4;--btn:#1c1c1c;--btnfg:#f7f6f3;--danger:#b3412b}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:15px/1.6 system-ui,-apple-system,"PingFang SC","Noto Sans SC",sans-serif;padding:16px}
main{width:100%;max-width:360px}h1{font-size:18px;margin:0 0 6px}p{margin:0 0 18px;color:var(--muted);font-size:14px}b{color:var(--fg);font-weight:600}
input{width:100%;padding:10px 12px;border-radius:8px;border:1px solid var(--line);background:transparent;color:var(--fg);font:inherit;letter-spacing:.04em}
.row{display:flex;gap:8px;margin-top:12px}button{flex:1;padding:10px;border-radius:8px;border:1px solid var(--line);background:transparent;color:var(--fg);font:inherit;cursor:pointer}button.go{background:var(--btn);color:var(--btnfg);border-color:var(--btn)}
.err{color:var(--danger);font-size:13px;margin:8px 0 0}</style></head><body><main>
<h1>让 <b>${esc(o.client)}</b> 使用 Jobs</h1>
<p>它将能以你的身份发布产品、请居民试用、取回结论。授权后会跳回 <b>${esc(host)}</b>。</p>
<form method="post" action="/oauth/login">
<input type="hidden" name="req" value="${esc(o.req)}">
${o.needPasscode ? `<input name="passcode" type="password" autocomplete="current-password" placeholder="口令（管理员口令可发布；访客口令只能看）" autofocus>` : ''}
${o.error ? `<p class="err" role="alert">${esc(o.error)}</p>` : ''}
<div class="row"><button type="submit" name="deny" value="1">拒绝</button><button class="go" type="submit">授权</button></div>
</form></main></body></html>`;
}

// ---- 失败次数：同一来源 10 分钟内最多输错 10 次 ----
const fails = new Map<string, { n: number; until: number }>();
export function tooMany(ip: string): boolean { const f = fails.get(ip); return !!f && f.until > Date.now() && f.n >= 10; }
export function noteFail(ip: string) { const f = fails.get(ip); const now = Date.now(); if (!f || f.until < now) fails.set(ip, { n: 1, until: now + CODE_TTL_MS }); else f.n++; }

// ---- 令牌 ----
async function issueTokens(clientId: string, grantId: string, role: OAuthRole, resource: string | undefined): Promise<OAuthTokens> {
  const access = token('jwa'); const refresh = token('jwr'); const now = Date.now(); const fp = passcodeFp();
  await getDb().insert(oauthTokens).values([
    { hash: sha(access), kind: 'access', client_id: clientId, grant_id: grantId, role, fp, resource: resource ?? null, expires_at: new Date(now + ACCESS_TTL_S * 1000) },
    { hash: sha(refresh), kind: 'refresh', client_id: clientId, grant_id: grantId, role, fp, resource: resource ?? null, expires_at: new Date(now + REFRESH_TTL_S * 1000) },
  ]);
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: role };
}

/** 查一个访问令牌：有效就返回身份（也给 REST 用：远程 MCP 的工具在进程内转发到 /api/v1 时带的就是它） */
const touched = new Map<string, number>();
export async function lookupAccess(raw: string): Promise<{ role: OAuthRole; clientId: string; expiresAt: number; resource: string | null } | null> {
  if (!raw.startsWith('jwa_')) return null;
  const h = sha(raw);
  const [t] = await getDb().select().from(oauthTokens).where(and(eq(oauthTokens.hash, h), eq(oauthTokens.kind, 'access'), eq(oauthTokens.revoked, false), gt(oauthTokens.expires_at, new Date())));
  if (!t || t.fp !== passcodeFp()) return null;
  // 最后使用时间：每个令牌一分钟最多写一次
  if ((touched.get(h) ?? 0) < Date.now() - 60_000) { touched.set(h, Date.now()); void getDb().update(oauthTokens).set({ last_used_at: new Date() }).where(eq(oauthTokens.grant_id, t.grant_id)).catch(() => undefined); }
  return { role: t.role as OAuthRole, clientId: t.client_id, expiresAt: Math.floor(t.expires_at.getTime() / 1000), resource: t.resource };
}

export class JobsOAuthProvider implements OAuthServerProvider {
  constructor(private defaultResource: string) {}

  readonly clientsStore: OAuthRegisteredClientsStore = {
    getClient: async (id) => (await getDb().select().from(oauthClients).where(eq(oauthClients.id, id)))[0]?.info as OAuthClientInformationFull | undefined,
    registerClient: async (c) => {
      const info = c as OAuthClientInformationFull;
      await getDb().insert(oauthClients).values({ id: info.client_id, info });
      return info;
    },
  };

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    const req = sign({ client_id: client.client_id, redirect_uri: params.redirectUri, challenge: params.codeChallenge, state: params.state, resource: params.resource?.href, exp: Date.now() + CODE_TTL_MS });
    res.status(200).type('html').set('cache-control', 'no-store').send(loginPage({ client: client.client_name ?? 'coding agent', redirect: params.redirectUri, req, needPasscode: adminEnabled() || authEnabled() }));
  }

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, code: string): Promise<string> {
    const c = codes.get(code);
    if (!c || c.client_id !== client.client_id || c.exp < Date.now()) throw new InvalidGrantError('invalid or expired authorization code');
    return c.challenge;
  }

  async exchangeAuthorizationCode(client: OAuthClientInformationFull, code: string, _verifier?: string, redirectUri?: string): Promise<OAuthTokens> {
    const c = codes.get(code); codes.delete(code);
    if (!c || c.client_id !== client.client_id || c.exp < Date.now()) throw new InvalidGrantError('invalid or expired authorization code');
    if (redirectUri && redirectUri !== c.redirect_uri) throw new InvalidGrantError('redirect_uri does not match the authorization request');
    return issueTokens(client.client_id, newId('grant'), c.role, c.resource ?? this.defaultResource);
  }

  async exchangeRefreshToken(client: OAuthClientInformationFull, refresh: string): Promise<OAuthTokens> {
    const db = getDb(); const h = sha(refresh);
    const [t] = await db.select().from(oauthTokens).where(and(eq(oauthTokens.hash, h), eq(oauthTokens.kind, 'refresh')));
    if (!t || t.client_id !== client.client_id) throw new InvalidGrantError('invalid refresh token');
    if (t.revoked) {
      // 已经用过的刷新令牌又出现了：可能被人拿走了，整组作废
      await db.update(oauthTokens).set({ revoked: true }).where(eq(oauthTokens.grant_id, t.grant_id));
      throw new InvalidGrantError('refresh token already used; the grant was revoked, authorize again');
    }
    if (t.expires_at.getTime() < Date.now() || t.fp !== passcodeFp()) throw new InvalidGrantError('grant expired or passcode changed; authorize again');
    await db.update(oauthTokens).set({ revoked: true }).where(eq(oauthTokens.hash, h));
    return issueTokens(client.client_id, t.grant_id, t.role as OAuthRole, t.resource ?? this.defaultResource);
  }

  async verifyAccessToken(raw: string): Promise<AuthInfo> {
    const t = await lookupAccess(raw);
    if (!t) throw new InvalidTokenError('token invalid, expired or revoked');
    return { token: raw, clientId: t.clientId, scopes: [t.role], expiresAt: t.expiresAt, resource: new URL(t.resource ?? this.defaultResource), extra: { role: t.role } };
  }

  async revokeToken(client: OAuthClientInformationFull, r: OAuthTokenRevocationRequest): Promise<void> {
    const [t] = await getDb().select().from(oauthTokens).where(eq(oauthTokens.hash, sha(r.token)));
    if (t && t.client_id === client.client_id) await getDb().update(oauthTokens).set({ revoked: true }).where(eq(oauthTokens.grant_id, t.grant_id));
  }
}

// ---- 网页上的「已接入的 agent」：一次授权一行，可撤销 ----
export async function listGrants() {
  const db = getDb();
  const rows = await db.select().from(oauthTokens).where(and(eq(oauthTokens.revoked, false), gt(oauthTokens.expires_at, new Date()), eq(oauthTokens.kind, 'refresh'))).orderBy(desc(oauthTokens.created_at));
  const fp = passcodeFp();
  const live = rows.filter((r) => r.fp === fp);
  const grants = new Map<string, (typeof live)[number] & { first: Date }>();
  for (const r of live) if (!grants.has(r.grant_id)) grants.set(r.grant_id, { ...r, first: r.created_at });
  const ids = [...new Set(live.map((r) => r.client_id))];
  const clients = ids.length ? await db.select().from(oauthClients).where(inArray(oauthClients.id, ids)) : [];
  const name = new Map(clients.map((c) => [c.id, (c.info as OAuthClientInformationFull).client_name ?? null]));
  const firsts = live.length ? await db.select({ grant_id: oauthTokens.grant_id, created_at: oauthTokens.created_at }).from(oauthTokens).where(inArray(oauthTokens.grant_id, [...grants.keys()])) : [];
  for (const f of firsts) { const g = grants.get(f.grant_id); if (g && f.created_at < g.first) g.first = f.created_at; }
  return [...grants.values()].map((g) => ({ id: g.grant_id, client: name.get(g.client_id) ?? null, role: g.role, authorized_at: g.first.toISOString(), last_used_at: g.last_used_at?.toISOString() ?? null }));
}

export async function revokeGrant(grantId: string): Promise<boolean> {
  const out = await getDb().update(oauthTokens).set({ revoked: true }).where(eq(oauthTokens.grant_id, grantId)).returning({ h: oauthTokens.hash });
  return out.length > 0;
}
