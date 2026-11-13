// Demo 被测应用的共享框架：Fastify + 服务端渲染 + Cookie 会话 + 内存存储 + 缺陷开关。
// 每个 App 运行两个实例：干净版（clean）与植入已知缺陷版（seeded），用于客观校准（§14）。
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import formbody from '@fastify/formbody';
import cookie from '@fastify/cookie';
import { randomBytes } from 'node:crypto';

export interface Defect {
  id: string;
  category: 'ux' | 'bug' | 'a11y' | 'ai_quality' | 'value' | 'safety';
  severity: 'P0' | 'P1' | 'P2' | 'P3';
  title: string;
  description: string;
  location: string;          // 路径或功能
  keywords: string[];        // 用于校准匹配
}

export interface User { id: string; username: string; password: string; nickname: string; created: number; [k: string]: unknown }

export interface Ctx {
  seeded: boolean;
  defect(id: string): boolean;
  users: Map<string, User>;
  store: Record<string, unknown>;
  page(req: FastifyRequest, opts: PageOpts): string;
  user(req: FastifyRequest): User | undefined;
  requireUser(req: FastifyRequest, reply: FastifyReply): User | undefined;
  appDef: DemoAppDef;
  port: number;
}

export interface PageOpts { title: string; body: string; nav?: boolean; head?: string; script?: string; bodyClass?: string }

export interface DemoAppDef {
  id: string;
  name: string;
  name_en: string;
  category: string;
  tagline: string;
  description: string;       // 作为 PRD 输入给 Product Intelligence
  theme: string;             // 主色
  nav: { href: string; label: string; icon?: string }[];
  defects: Defect[];
  form?: 'web' | 'h5';
  authDefects?: { hidePasswordRule?: string; loseFormOnError?: string };
  setup(app: FastifyInstance, ctx: Ctx): void;
}

export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const uid = () => randomBytes(6).toString('hex');

const BASE_CSS = `
*{box-sizing:border-box}body{margin:0;font:15px/1.55 -apple-system,"PingFang SC","Noto Sans CJK SC","Microsoft YaHei",sans-serif;color:#1f2329;background:#f5f6f8}
a{color:var(--c)}header.top{background:var(--c);color:#fff;padding:10px 16px;display:flex;align-items:center;gap:12px;position:sticky;top:0;z-index:20}
header.top .brand{font-weight:700;font-size:17px;color:#fff;text-decoration:none}header.top nav{display:flex;gap:4px;flex-wrap:wrap;flex:1}
header.top nav a{color:#fff;text-decoration:none;padding:6px 10px;border-radius:8px;opacity:.92}header.top nav a.on,header.top nav a:hover{background:rgba(255,255,255,.18)}
header.top .me{font-size:13px;opacity:.95}header.top .me a{color:#fff}
main{max-width:920px;margin:18px auto;padding:0 14px}.card{background:#fff;border-radius:12px;padding:16px;margin-bottom:14px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
h1{font-size:22px;margin:4px 0 14px}h2{font-size:18px;margin:4px 0 10px}label{display:block;margin:10px 0 4px;font-size:14px;color:#4e5969}
input,select,textarea{width:100%;padding:10px 12px;border:1px solid #d0d3d9;border-radius:8px;font:inherit;background:#fff}textarea{min-height:90px}
button,.btn{display:inline-block;background:var(--c);color:#fff;border:0;border-radius:8px;padding:10px 16px;font:inherit;cursor:pointer;text-decoration:none}
button.ghost,.btn.ghost{background:#eef0f3;color:#1f2329}button.danger{background:#e5484d}button:disabled{opacity:.5;cursor:not-allowed}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.grow{flex:1}.muted{color:#86909c;font-size:13px}.err{color:#d93026;background:#fff1f0;border:1px solid #ffccc7;padding:8px 12px;border-radius:8px;margin:8px 0}
.ok{color:#0b7a3e;background:#effaf3;border:1px solid #b7ebc6;padding:8px 12px;border-radius:8px;margin:8px 0}.list{list-style:none;padding:0;margin:0}.list li{padding:10px 4px;border-bottom:1px solid #f0f1f3}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px}.tag{display:inline-block;font-size:12px;padding:2px 8px;border-radius:10px;background:#eef0f3;margin-right:4px}
.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:50}.modal{background:#fff;border-radius:14px;padding:20px;max-width:420px;width:92%}
.badge{background:#e5484d;color:#fff;border-radius:9px;font-size:11px;padding:1px 6px;margin-left:4px}.hidden{display:none}
.toast{position:fixed;left:50%;top:70px;transform:translateX(-50%);background:#1f2329;color:#fff;padding:8px 16px;border-radius:8px;z-index:60}
@media(max-width:600px){header.top{flex-wrap:wrap}main{margin:10px auto}}
`;

export function createDemoApp(def: DemoAppDef, opts: { port: number; seeded: boolean; host: string }) {
  const app = Fastify({ logger: false });
  app.register(formbody);
  app.register(cookie);
  const sessions = new Map<string, string>();
  const users = new Map<string, User>();
  const ctx: Ctx = {
    seeded: opts.seeded,
    defect: (id) => opts.seeded && def.defects.some((d) => d.id === id),
    users, store: {}, appDef: def, port: opts.port,
    user: (req) => { const sid = req.cookies?.sid; const u = sid ? sessions.get(sid) : undefined; return u ? users.get(u) : undefined; },
    requireUser: (req, reply) => { const u = ctx.user(req); if (!u) { reply.redirect(`/login?next=${encodeURIComponent(req.url)}`); return undefined; } return u; },
    page: (req, p) => {
      const u = ctx.user(req);
      const path = req.url.split('?')[0];
      const nav = p.nav === false ? '' : def.nav.map((n) => `<a href="${n.href}" class="${path === n.href || (n.href !== '/' && path.startsWith(n.href)) ? 'on' : ''}">${n.icon ? `${n.icon} ` : ''}${esc(n.label)}</a>`).join('');
      return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(p.title)} · ${esc(def.name)}</title>
<style>:root{--c:${def.theme}}${BASE_CSS}</style>${p.head ?? ''}</head><body class="${p.bodyClass ?? ''}">
<header class="top"><a class="brand" href="/">${esc(def.name)}</a><nav>${nav}</nav><span class="me">${u ? `${esc(u.nickname || u.username)} · <a href="/logout">退出</a>` : `<a href="/login">登录</a> · <a href="/signup">注册</a>`}</span></header>
<main>${p.body}</main>${p.script ? `<script>${p.script}</script>` : ''}</body></html>`;
    },
  };

  // ---- 注册 / 登录（Persona 自己完成，属于体验的一部分）----
  const authForm = (req: FastifyRequest, kind: 'login' | 'signup', err = '', vals: Record<string, string> = {}) => {
    const isSignup = kind === 'signup';
    const hideRule = def.authDefects?.hidePasswordRule && ctx.defect(def.authDefects.hidePasswordRule);
    const keep = !(def.authDefects?.loseFormOnError && ctx.defect(def.authDefects.loseFormOnError));
    const next = (req.query as Record<string, string>)?.next ?? vals.next ?? '';
    return ctx.page(req, { title: isSignup ? '注册' : '登录', nav: false, body: `<div class="card" style="max-width:420px;margin:30px auto">
<h1>${isSignup ? `注册 ${esc(def.name)}` : `登录 ${esc(def.name)}`}</h1><p class="muted">${esc(def.tagline)}</p>${err ? `<div class="err" role="alert">${esc(err)}</div>` : ''}
<form method="post" action="/${kind}"><input type="hidden" name="next" value="${esc(next)}">
<label for="username">用户名</label><input id="username" name="username" autocomplete="username" value="${keep ? esc(vals.username ?? '') : ''}">
${isSignup ? `<label for="nickname">昵称（选填）</label><input id="nickname" name="nickname" value="${keep ? esc(vals.nickname ?? '') : ''}">` : ''}
<label for="password">密码</label><input id="password" type="password" name="password" autocomplete="${isSignup ? 'new-password' : 'current-password'}">
${isSignup && !hideRule ? '<p class="muted">密码至少 6 位，需同时包含字母和数字</p>' : ''}
<div class="row" style="margin-top:14px"><button type="submit">${isSignup ? '注册并登录' : '登录'}</button>
<a href="/${isSignup ? 'login' : 'signup'}${next ? `?next=${encodeURIComponent(next)}` : ''}">${isSignup ? '已有账号？去登录' : '没有账号？注册一个'}</a></div></form></div>` });
  };
  const login = (reply: FastifyReply, u: User, next?: string) => {
    const sid = uid(); sessions.set(sid, u.id);
    reply.setCookie('sid', sid, { path: '/', httpOnly: true, sameSite: 'lax' }).redirect(next && next.startsWith('/') ? next : '/');
  };
  app.get('/login', (req, reply) => reply.type('text/html').send(authForm(req, 'login')));
  app.get('/signup', (req, reply) => reply.type('text/html').send(authForm(req, 'signup')));
  app.post('/signup', (req, reply) => {
    const b = req.body as Record<string, string>;
    const username = (b.username ?? '').trim();
    if (!username) return reply.type('text/html').send(authForm(req, 'signup', '请输入用户名', b));
    if ([...users.values()].some((u) => u.username === username)) return reply.type('text/html').send(authForm(req, 'signup', '该用户名已被注册', b));
    if (!/^(?=.*[A-Za-z])(?=.*\d).{6,}$/.test(b.password ?? '')) return reply.type('text/html').send(authForm(req, 'signup', def.authDefects?.hidePasswordRule && ctx.defect(def.authDefects.hidePasswordRule) ? '注册失败' : '密码至少 6 位，需同时包含字母和数字', b));
    const u: User = { id: uid(), username, password: b.password, nickname: (b.nickname ?? '').trim() || username, created: Date.now() };
    users.set(u.id, u); login(reply, u, b.next);
  });
  app.post('/login', (req, reply) => {
    const b = req.body as Record<string, string>;
    const u = [...users.values()].find((x) => x.username === (b.username ?? '').trim() && x.password === b.password);
    if (!u) return reply.type('text/html').send(authForm(req, 'login', '用户名或密码错误', b));
    login(reply, u, b.next);
  });
  app.get('/logout', (req, reply) => { const sid = req.cookies?.sid; if (sid) sessions.delete(sid); reply.clearCookie('sid', { path: '/' }).redirect('/'); });

  // ---- 元信息（仅供体验官注册与校准使用；Persona 看不到）----
  app.get('/__pux/manifest.json', () => ({ id: def.id, name: def.name, name_en: def.name_en, category: def.category, seeded: opts.seeded, description: def.description, defects: opts.seeded ? def.defects : [] }));
  app.get('/__pux/reset', () => { users.clear(); sessions.clear(); for (const k of Object.keys(ctx.store)) delete ctx.store[k]; return { ok: true }; });

  def.setup(app, ctx);
  return { app, ctx, listen: () => app.listen({ port: opts.port, host: opts.host }) };
}

/** 读取 per-user 数据桶 */
export function bucket<T>(ctx: Ctx, name: string, userId: string, init: () => T): T {
  const all = (ctx.store[name] ??= {}) as Record<string, T>;
  return (all[userId] ??= init());
}
