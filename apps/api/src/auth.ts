// 局域网访问控制：网页共享口令（JW_PASSCODE）+ 管理员口令（JW_ADMIN_PASSCODE）。未设置时对应限制关闭
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

const secret = () => process.env.JW_SESSION_SECRET ?? `${process.env.JW_PASSCODE ?? ''}|${process.env.JW_ADMIN_PASSCODE ?? ''}|jobsworld`;
const sign = (role: string) => `${role}.${createHmac('sha256', secret()).update(role).digest('base64url')}`;
const eq = (a: string, b: string) => { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

export const authEnabled = () => !!process.env.JW_PASSCODE;
export const adminEnabled = () => !!process.env.JW_ADMIN_PASSCODE;

function cookies(req: FastifyRequest): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? '').split(';')) { const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); }
  return out;
}

/** 远程 MCP 的 OAuth 令牌在 server.ts 的 onRequest 里先查好，挂在请求上（查库是异步的，roleOf 是同步的） */
export type OAuthRole = 'admin' | 'viewer';
const oauthRoles = new WeakMap<object, OAuthRole>();
export const setOAuthRole = (req: FastifyRequest, role: OAuthRole) => { oauthRoles.set(req.raw, role); };
export const bearerOf = (req: FastifyRequest) => /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization ?? ''))?.[1] ?? '';
/** 这串是不是口令本身（是的话不用去查 OAuth 令牌） */
export const isPasscode = (s: string) => (!!process.env.JW_ADMIN_PASSCODE && eq(s, process.env.JW_ADMIN_PASSCODE)) || (!!process.env.JW_PASSCODE && eq(s, process.env.JW_PASSCODE));

/** 在 OAuth 授权页输入的口令对应什么身份；与 roleOf 的规则一致。null = 口令不对 */
export function roleForPasscode(passcode: string): OAuthRole | null {
  if (adminEnabled() && eq(passcode, process.env.JW_ADMIN_PASSCODE!)) return 'admin';
  const viewer = !authEnabled() || eq(passcode, process.env.JW_PASSCODE!);
  if (!viewer) return null;
  return adminEnabled() ? 'viewer' : 'admin';
}
/** 两个口令的指纹：任何一个换了，之前发出的 OAuth 令牌就全部失效 */
export const passcodeFp = () => createHash('sha256').update(`jw-oauth|${process.env.JW_ADMIN_PASSCODE ?? ''}|${process.env.JW_PASSCODE ?? ''}`).digest('hex').slice(0, 32);

export function roleOf(req: FastifyRequest): { viewer: boolean; admin: boolean } {
  const o = oauthRoles.get(req.raw);
  if (o) return { viewer: true, admin: o === 'admin' };
  const c = cookies(req);
  // 命令行、MCP、飞书等非浏览器入口：用口令作为 Bearer 令牌
  const bearer = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization ?? ''))?.[1] ?? '';
  const adminCookie = (!!c.jw_admin && eq(c.jw_admin, sign('admin'))) || (adminEnabled() && !!bearer && eq(bearer, process.env.JW_ADMIN_PASSCODE!));
  const viewer = !authEnabled() || adminCookie || (!!c.jw_auth && eq(c.jw_auth, sign('viewer'))) || (!!bearer && eq(bearer, process.env.JW_PASSCODE!));
  // 未设置管理员口令时：能进来的人都是管理员；设置了则必须用管理员口令登录
  const admin = adminEnabled() ? adminCookie : viewer;
  return { viewer, admin };
}

export function login(passcode: string, reply: FastifyReply): { viewer: boolean; admin: boolean } {
  const opts = 'Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000';
  const set: string[] = [];
  let viewer = !authEnabled(); let admin = !adminEnabled();
  if (adminEnabled() && eq(passcode, process.env.JW_ADMIN_PASSCODE!)) { set.push(`jw_admin=${sign('admin')}; ${opts}`, `jw_auth=${sign('viewer')}; ${opts}`); admin = true; viewer = true; }
  else if (authEnabled() && eq(passcode, process.env.JW_PASSCODE!)) { set.push(`jw_auth=${sign('viewer')}; ${opts}`); viewer = true; }
  if (set.length) reply.header('set-cookie', set);
  return { viewer, admin };
}

/** 一次性签名链接打开后：给这个浏览器一个访客身份（只读，默认 1 天） */
export function grantViewer(reply: FastifyReply, maxAgeSec = 86400) {
  reply.header('set-cookie', [`jw_auth=${sign('viewer')}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}`]);
}

export function logout(reply: FastifyReply) {
  reply.header('set-cookie', ['jw_auth=; Path=/; Max-Age=0', 'jw_admin=; Path=/; Max-Age=0']);
}

export function requireAdmin(req: FastifyRequest, reply: FastifyReply): boolean {
  if (roleOf(req).admin) return true;
  void reply.code(403).send({ error: 'admin_required' });
  return false;
}

/** 游戏内面板加载截图用的令牌（与 tModLoader mod 的 EvidenceKey() 同算法）；只放行 /api/v1/evidence/* */
export const evidenceKey = () => (process.env.JW_PASSCODE ? createHash('sha256').update(`jw-evidence:${process.env.JW_PASSCODE}`).digest('hex').slice(0, 32) : '');
export function evidenceAllowed(req: FastifyRequest): boolean {
  if (!req.url.startsWith('/api/v1/evidence/') && !req.url.startsWith('/evidence/')) return false;
  const u = new URL(req.url, 'http://x');
  // 单个证据的签名（GitHub issue、飞书卡片里的截图链接）：只放行这一个文件
  const s = u.searchParams.get('s'); const id = decodeURIComponent(u.pathname.split('/').pop() ?? '');
  if (s && id && eq(s, evidenceSig(id))) return true;
  const k = evidenceKey(); if (!k) return false;
  return req.url.startsWith('/api/v1/evidence/') && eq(u.searchParams.get('k') ?? '', k);
}

/** 一个证据文件的签名：拿到链接的人只能看这一个文件（截图贴进 GitHub issue、飞书卡片时用） */
export const evidenceSig = (id: string) => createHmac('sha256', secret()).update(`jw-ev:${id}`).digest('base64url').slice(0, 22);
