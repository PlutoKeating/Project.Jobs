// 局域网访问控制：网页共享口令（JW_PASSCODE）+ 管理员口令（JW_ADMIN_PASSCODE）。未设置时对应限制关闭
import { createHmac, timingSafeEqual } from 'node:crypto';
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

export function roleOf(req: FastifyRequest): { viewer: boolean; admin: boolean } {
  const c = cookies(req);
  const admin = !adminEnabled() || (!!c.jw_admin && eq(c.jw_admin, sign('admin')));
  const viewer = admin || !authEnabled() || (!!c.jw_auth && eq(c.jw_auth, sign('viewer')));
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

export function logout(reply: FastifyReply) {
  reply.header('set-cookie', ['jw_auth=; Path=/; Max-Age=0', 'jw_admin=; Path=/; Max-Age=0']);
}

export function requireAdmin(req: FastifyRequest, reply: FastifyReply): boolean {
  if (roleOf(req).admin) return true;
  void reply.code(403).send({ error: 'admin_required' });
  return false;
}
