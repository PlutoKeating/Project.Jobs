// 设置页与居民邮箱的接口：公网链接、一键开通 / 关闭居民邮箱、自检、无主信；收信入口 /inbound/email（Cloudflare 上的转发 Worker 调用）；收件箱与一封信的详情。
import type { FastifyInstance } from 'fastify';
import type { PersonaSpec } from '@pux/core';
import { and, desc, eq, getDb, inArray, isNull, mailbox, personas } from '@pux/db';
import * as E from '@pux/engine';
import { requireAdmin } from './auth.ts';

type P = { id: string };
const err = (e: unknown) => String((e as Error).message ?? e).slice(0, 500);

/** 列表里的一封信（不带 HTML 正文） */
const brief = (m: typeof mailbox.$inferSelect) => ({ id: m.id, kind: m.kind, address: m.address, sender: m.sender, subject: m.subject, body: m.body.slice(0, 4000), has_html: !!m.html, seen: m.seen, opened_at: m.opened_at, session_id: m.session_id, real: !!m.raw_ev, codes: m.extracted?.codes ?? [], at: m.created_at });

export function mailRoutes(app: FastifyInstance) {
  // ---- 收信入口：不走登录（它在 /api 之外），靠 Worker 的 HMAC 签名 ----
  void app.register(async (sub) => {
    sub.addContentTypeParser(['message/rfc822', 'application/octet-stream'], { parseAs: 'buffer', bodyLimit: 12 * 1024 * 1024 }, (_q, body, done) => done(null, body));
    sub.post('/inbound/email', async (q, r) => {
      const h = q.headers;
      const one = (k: string) => { const v = h[k]; return Array.isArray(v) ? v[0] : v; };
      const raw = Buffer.isBuffer(q.body) ? q.body : Buffer.from(String(q.body ?? ''));
      try {
        const res = await E.receiveInbound(raw, { ts: one('x-jobs-timestamp'), to: one('x-jobs-to'), from: one('x-jobs-from'), sig: one('x-jobs-signature') });
        return r.code(res.status).send(res.body);
      } catch (e) { return r.code(503).send({ error: err(e) }); }
    });
    sub.get('/inbound/ping', async () => ({ jobs: true }));
  });

  // ---- 设置页（仅管理员）----
  app.get('/api/v1/settings', async (q, r) => {
    if (!requireAdmin(q, r)) return;
    const s = await E.siteSettings();
    return { public_url: s.public_url ?? '', public_url_env: process.env.JOBS_PUBLIC_URL?.trim() ?? '', public_url_effective: await E.publicUrl(), mail: await E.mailStatus((q.query as { live?: string }).live === '1') };
  });
  app.put('/api/v1/settings', async (q, r) => {
    if (!requireAdmin(q, r)) return;
    const b = (q.body ?? {}) as { public_url?: string };
    try { return { public_url_effective: await E.savePublicUrl(String(b.public_url ?? '')) }; }
    catch (e) { return r.code(400).send({ error: err(e) }); }
  });
  app.post('/api/v1/settings/mail', async (q, r) => {
    if (!requireAdmin(q, r)) return;
    const b = (q.body ?? {}) as { token?: string };
    try { await E.deployMail(b.token); return await E.mailStatus(true); }
    catch (e) { return r.code(400).send({ error: err(e) }); }
  });
  app.delete('/api/v1/settings/mail', async (q, r) => {
    if (!requireAdmin(q, r)) return;
    try { await E.disableMail(); return await E.mailStatus(); }
    catch (e) { return r.code(400).send({ error: err(e) }); }
  });
  app.post('/api/v1/settings/mail/check', async (q, r) => {
    if (!requireAdmin(q, r)) return;
    try { return await E.startMailCheck(); } catch (e) { return r.code(400).send({ error: err(e) }); }
  });
  app.delete('/api/v1/settings/mail/check', async (q, r) => {
    if (!requireAdmin(q, r)) return;
    await E.endMailCheck(); return { ok: true };
  });
  app.get('/api/v1/settings/mail/unowned', async (q, r) => {
    if (!requireAdmin(q, r)) return;
    return (await getDb().select().from(mailbox).where(isNull(mailbox.persona_id)).orderBy(desc(mailbox.created_at)).limit(50)).map(brief);
  });

  // ---- 能不能收真实邮件（发布对话框据此提醒）----
  app.get('/api/v1/mail/status', async () => ({ real: await E.realMailReady(), domain: await E.mailDomain() }));

  // ---- 收件箱 ----
  app.get('/api/v1/personas/:id/inbox', async (q) => (await E.inbox((q.params as P).id, 50)).map(brief));
  app.get('/api/v1/sessions/:id/mail', async (q) => (await getDb().select().from(mailbox).where(eq(mailbox.session_id, (q.params as P).id)).orderBy(mailbox.created_at)).map(brief));
  app.get('/api/v1/mail/:id', async (q, r) => {
    const [m] = await getDb().select().from(mailbox).where(eq(mailbox.id, (q.params as P).id));
    if (!m) return r.code(404).send({ error: 'not_found' });
    const [p] = m.persona_id ? await getDb().select({ spec: personas.spec }).from(personas).where(and(inArray(personas.id, [m.persona_id]), eq(personas.active, true))) : [];
    return { ...brief(m), body: m.body, html: m.html, links: m.extracted?.links ?? [], raw_ev: m.raw_ev, persona_id: m.persona_id, persona_name: (p?.spec as PersonaSpec | undefined)?.identity.name ?? null };
  });
}
