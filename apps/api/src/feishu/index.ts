// 飞书：渠道（channel.ts）+ 推送（notify.ts）+ 云文档（docs.ts）接到同一个 Jobs Agent 上，并提供网页「设置 › 飞书」用的接口。
import type { FastifyInstance } from 'fastify';
import { feishuTargets, getDb } from '@pux/db';
import type { Bus } from '@pux/jobsworld';
import { agentHub, registerProactive } from '../agent.ts';
import { requireAdmin } from '../auth.ts';
import { signLink, signLinksIn } from '../signed.ts';
import { listUsers, setUser } from './access.ts';
import { alertCard } from './cards.ts';
import { FeishuChannel } from './channel.ts';
import { docsTools } from './docs.ts';
import { Notifier } from './notify.ts';
import { prefsOf, type Prefs } from './rules.ts';

export function feishuRoutes(app: FastifyInstance, bus: Bus | undefined) {
  const hub = agentHub(app);
  const fs = new FeishuChannel(app, hub);
  const notifier = new Notifier(fs, signLink);
  fs.links = signLinksIn;
  fs.extraTools = (session, actor) => [...notifier.tools(session, actor), ...docsTools(fs, session, actor, signLink)];
  registerProactive('feishu:', (session) => fs.proactive(session));
  notifier.start(bus);
  void fs.resume();

  app.get('/api/v1/feishu', async (q, r) => { if (!requireAdmin(q, r)) return; return fs.state; });
  app.post('/api/v1/feishu/connect', async (q, r) => {
    if (!requireAdmin(q, r)) return;
    const origin = String(q.headers.origin ?? `${q.protocol}://${q.headers.host ?? ''}`).replace(/\/$/, '');
    const upgrade = !!(q.body as { upgrade?: boolean } | undefined)?.upgrade && !!fs.saved;
    try { await fs.connect(origin, upgrade); return fs.state; } catch (e) { return r.code(502).send({ error: String((e as Error).message).slice(0, 200) }); }
  });
  app.post('/api/v1/feishu/disconnect', async (q, r) => { if (!requireAdmin(q, r)) return; await fs.disconnect(); return fs.state; });
  app.post('/api/v1/feishu/test', async (q, r) => {
    if (!requireAdmin(q, r)) return;
    if (!fs.saved?.owner) return r.code(409).send({ error: 'no_owner' });
    try { await fs.sendCard({ open_id: fs.saved.owner }, alertCard({ title: '测试消息', text: '这是 Jobs 发来的一条测试消息。直接回我一句话试试。', tone: 'grey' })); return { ok: true }; } catch (e) { return r.code(502).send({ error: String((e as Error).message).slice(0, 200) }); }
  });

  // ---- 谁能用：飞书里跟机器人说过话的人（角色、怎么得来的），改角色与撤销 ----
  app.get('/api/v1/feishu/users', async (q, r) => { if (!requireAdmin(q, r)) return; return (await listUsers()).map((u) => ({ ...u, owner: u.open_id === fs.saved?.owner })); });
  app.patch('/api/v1/feishu/users/:id', async (q, r) => {
    if (!requireAdmin(q, r)) return;
    const b = (q.body ?? {}) as { role?: 'admin' | 'viewer'; revoked?: boolean };
    if ((q.params as { id: string }).id === fs.saved?.owner) return r.code(409).send({ error: 'owner' });
    await setUser((q.params as { id: string }).id, { role: b.role === 'admin' || b.role === 'viewer' ? b.role : undefined, revoked: typeof b.revoked === 'boolean' ? b.revoked : undefined });
    return { ok: true };
  });

  // ---- 推送去处与偏好 ----
  app.get('/api/v1/feishu/targets', async (q, r) => { if (!requireAdmin(q, r)) return; return (await getDb().select().from(feishuTargets)).map((t) => ({ chat_id: t.chat_id, kind: t.kind, name: t.name, enabled: t.enabled, prefs: prefsOf(t.prefs as Partial<Prefs>), boards: Object.keys(t.boards ?? {}).length, pending: (t.pending as unknown[] ?? []).length })); });
  app.put('/api/v1/feishu/targets/:id', async (q, r) => {
    if (!requireAdmin(q, r)) return;
    const b = (q.body ?? {}) as { enabled?: boolean; prefs?: Partial<Prefs> };
    await notifier.setTarget((q.params as { id: string }).id, { enabled: b.enabled, prefs: b.prefs ? prefsOf(b.prefs) : undefined });
    return { ok: true };
  });
  app.post('/api/v1/feishu/targets/:id/digest', async (q, r) => {
    if (!requireAdmin(q, r)) return;
    const t = (await notifier.targets()).find((x) => x.chat_id === (q.params as { id: string }).id); if (!t) return r.code(404).send({ error: 'not_found' });
    try { await notifier.digest(t, new Date().getHours() < 14 ? 'morning' : 'evening', prefsOf(t.prefs as Partial<Prefs>)); return { ok: true }; } catch (e) { return r.code(502).send({ error: String((e as Error).message).slice(0, 200) }); }
  });
}
