// 发布主线的接口：发布产品、看它在城里过得怎么样、调宣发、把手机递给人、商店与动态、虚拟身份的收件箱
import type { FastifyInstance } from 'fastify';
import type { PersonaSpec } from '@pux/core';
import { and, desc, eq, exposures, getDb, inArray, mailbox, personas, posts, sessions, storeReviews, studies } from '@pux/db';
import * as E from '@pux/engine';
import { SUBJ, type Bus } from '@pux/jobsworld';
import { requireAdmin } from './auth.ts';

type P = { id: string };

export function launchRoutes(app: FastifyInstance, bus: Bus | undefined) {
  const request = async (subject: string, data: unknown, timeout = 120_000) => {
    if (!bus) throw new Error('nats_unavailable');
    const m = await bus.nc.request(subject, new TextEncoder().encode(JSON.stringify(data)), { timeout });
    return JSON.parse(new TextDecoder().decode(m.data)) as Record<string, unknown>;
  };
  const names = async (ids: string[]) => {
    const rows = ids.length ? await getDb().select({ id: personas.id, spec: personas.spec }).from(personas).where(and(inArray(personas.id, [...new Set(ids)]), eq(personas.active, true))) : [];
    return new Map(rows.map((r) => { const s = r.spec as PersonaSpec; return [r.id, { name: s.identity.name, age: s.identity.age, occupation: s.identity.occupation, segment: s.segment, locale: s.locale }]; }));
  };
  const spend = async (studyId: string) => { const [s] = await getDb().select({ cost: studies.cost_usd, tokens: studies.tokens }).from(studies).where(eq(studies.id, studyId)); return { usd: Math.round((s?.cost ?? 0) * 100) / 100, tokens: s?.tokens ?? 0 }; };
  const view = async (l: E.LaunchRow) => ({ id: l.id, app_id: l.app_id, name: l.name, tagline: l.tagline, description: l.description, url: l.url, landing_url: l.landing_url, form: l.form, shots: l.shot_evs ?? [], ad_text: l.ad_text, intensity: l.intensity, audience: l.audience ?? {}, status: l.status, created_at: l.created_at, funnel: await E.launchFunnel(l.id), spend: await spend(l.study_id) });

  /** 最新的版本点和它之后的使用次数；还没标过新版本时为 null */
  const versionView = async (l: E.LaunchRow) => {
    const v = (await E.launchVersionList(l)).at(-1)!; if (v.n === 1) return null;
    const ss = (await getDb().select({ status: sessions.status, started_at: sessions.started_at }).from(sessions).where(eq(sessions.study_id, l.study_id))).filter((s) => s.started_at && s.started_at.getTime() >= Date.parse(v.at));
    return { ...v, sessions: ss.length, finished: ss.filter((s) => !['running', 'planned', 'waiting_human'].includes(s.status)).length };
  };

  app.get('/api/v1/launches', async () => Promise.all((await E.listLaunches()).map(view)));

  app.post('/api/v1/launches', async (q, r) => {
    if (!requireAdmin(q, r)) return;
    const b = (q.body ?? {}) as Partial<E.PublishInput>;
    if (!b.name || !b.tagline || !b.url) return r.code(400).send({ error: 'name, tagline and url are required' });
    try { return await view(await E.publishProduct(b as E.PublishInput)); } catch (e) { return r.code(400).send({ error: String((e as Error).message) }); }
  });

  app.get('/api/v1/launches/:id', async (q, r) => {
    const l = await E.getLaunch((q.params as P).id); if (!l) return r.code(404).send({ error: 'not_found' });
    const db = getDb();
    const ss = await db.select({ id: sessions.id, persona_id: sessions.persona_id, status: sessions.status, outcome: sessions.outcome, end_reason: sessions.end_reason, steps: sessions.steps_count, started_at: sessions.started_at, ctx: sessions.world_context, plan: sessions.plan_reason, summary: sessions.summary }).from(sessions).where(eq(sessions.study_id, l.study_id)).orderBy(desc(sessions.started_at));
    const ex = await db.select().from(exposures).where(eq(exposures.launch_id, l.id)).orderBy(desc(exposures.created_at));
    const rv = await db.select().from(storeReviews).where(eq(storeReviews.launch_id, l.id)).orderBy(desc(storeReviews.created_at));
    const ps = await db.select().from(posts).where(eq(posts.launch_id, l.id)).orderBy(desc(posts.created_at));
    const who = await names([...ss.map((s) => s.persona_id), ...ex.map((e) => e.persona_id), ...rv.map((x) => x.persona_id), ...ps.map((x) => x.persona_id)]);
    const nm = (id: string) => who.get(id) ?? { name: id, age: 0, occupation: '', segment: '', locale: 'zh-CN' };
    return {
      ...(await view(l)),
      versions: await E.launchVersionList(l),
      // 用过的人：每次使用在什么处境下、怎么遇到的、结局如何
      uses: ss.map((s) => { const c = s.ctx as { name?: string; clock?: string; date?: string; device?: string } | null; const p = (s.plan ?? {}) as { channel?: string; invited?: boolean; visit?: number }; const m = (s.summary as { memory?: { come_back?: string; would_return?: boolean } } | null)?.memory;
        return { session_id: s.id, persona_id: s.persona_id, ...nm(s.persona_id), status: s.status, outcome: s.outcome, end_reason: s.end_reason, steps: s.steps, started_at: s.started_at, where: c?.name ?? null, when: c ? `${c.date ?? ''} ${c.clock ?? ''}`.trim() : null, device: c?.device ?? null, channel: p.channel ?? null, invited: !!p.invited, visit: p.visit ?? 1, come_back: m?.come_back ?? null }; }),
      // 路过的人：注意到了但没点开，当时怎么想的
      passersby: ex.filter((e) => e.reaction !== 'unnoticed' && e.reaction !== 'opened').slice(0, 80).map((e) => ({ persona_id: e.persona_id, ...nm(e.persona_id), channel: e.channel, reaction: e.reaction, thought: e.thought, at: e.created_at })),
      reviews: rv.map((x) => ({ id: x.id, persona_id: x.persona_id, name: nm(x.persona_id).name, rating: x.rating, body: x.body, session_id: x.session_id, at: x.created_at })),
      posts: ps.map((x) => ({ id: x.id, persona_id: x.persona_id, name: nm(x.persona_id).name, body: x.body, sentiment: x.sentiment, session_id: x.session_id, at: x.created_at })),
    };
  });

  app.get('/api/v1/launches/:id/report', async (q, r) => {
    const l = await E.getLaunch((q.params as P).id); if (!l) return r.code(404).send({ error: 'not_found' });
    const qq = q.query as { lang?: string; force?: string };
    return E.launchReport(l, qq.lang === 'en' ? 'en' : 'zh', { force: qq.force === '1' });
  });

  app.get('/api/v1/launches/:id/engineering', async (q, r) => {
    const l = await E.getLaunch((q.params as P).id); if (!l) return r.code(404).send({ error: 'not_found' });
    return { version: await versionView(l), experienced: await E.experiencedIssues(l), appendix: await E.engineeringAppendix(l), mail: await E.mailInstrument(l).catch(() => null) };
  });

  // ---- 版本点：开发者改好之后标一下，之后的使用算新版本 ----
  app.get('/api/v1/launches/:id/versions', async (q, r) => {
    const l = await E.getLaunch((q.params as P).id); if (!l) return r.code(404).send({ error: 'not_found' });
    return E.launchVersionList(l);
  });
  app.post('/api/v1/launches/:id/versions', async (q, r) => {
    if (!requireAdmin(q, r)) return;
    const l = await E.getLaunch((q.params as P).id); if (!l) return r.code(404).send({ error: 'not_found' });
    return E.markLaunchVersion(l, (q.body as { note?: string } | undefined)?.note);
  });

  app.post('/api/v1/launches/:id/promotion', async (q, r) => {
    if (!requireAdmin(q, r)) return;
    const l = await E.getLaunch((q.params as P).id); if (!l) return r.code(404).send({ error: 'not_found' });
    const b = (q.body ?? {}) as { intensity?: number; audience?: E.LaunchRow['audience']; status?: 'live' | 'paused' | 'ended'; ad_text?: string; tagline?: string };
    const out = await E.setPromotion(l.id, { intensity: b.intensity, audience: b.audience ?? undefined, status: b.status, ad_text: b.ad_text, tagline: b.tagline });
    return out ? view(out) : r.code(404).send({ error: 'not_found' });
  });

  // ---- 清零与下线：交给世界服务（它先作废进行中的使用再清库）；世界服务没在跑或没开发布引擎时，这里直接清库 ----
  const lifecycle = async (l: E.LaunchRow, action: 'reset' | 'remove', keepHistory = false) => {
    if (bus) {
      try {
        const out = await request(SUBJ.cmdLifecycle, { launch_id: l.id, action, keep_history: keepHistory }, 300_000);
        if (!('error' in out)) return out;
        if (!/runner/.test(String(out.error))) throw new Error(String(out.error));
      } catch (e) { if (!/no responders|503|runner/i.test(String((e as Error).message))) throw e; }
    }
    return action === 'reset' ? E.resetLaunch(l) : E.removeLaunch(l, { keepHistory });
  };
  app.post('/api/v1/launches/:id/reset', async (q, r) => {
    if (!requireAdmin(q, r)) return;
    const l = await E.getLaunch((q.params as P).id); if (!l) return r.code(404).send({ error: 'not_found' });
    try { const cleared = await lifecycle(l, 'reset'); const fresh = await E.getLaunch(l.id); return { ...(fresh ? await view(fresh) : {}), cleared }; }
    catch (e) { return r.code(500).send({ error: String((e as Error).message) }); }
  });
  app.delete('/api/v1/launches/:id', async (q, r) => {
    if (!requireAdmin(q, r)) return;
    const l = await E.getLaunch((q.params as P).id); if (!l) return r.code(404).send({ error: 'not_found' });
    const keep = (q.query as { history?: string }).history !== 'delete';
    try { return { removed: true, ...(await lifecycle(l, 'remove', keep)) }; }
    catch (e) { return r.code(500).send({ error: String((e as Error).message) }); }
  });

  app.post('/api/v1/launches/:id/invite', async (q, r) => {
    if (!requireAdmin(q, r)) return;
    const l = await E.getLaunch((q.params as P).id); if (!l) return r.code(404).send({ error: 'not_found' });
    try { return await request(SUBJ.cmdInvite, { ...(q.body as object), launch_id: l.id }, 180_000); } catch (e) { return r.code(503).send({ error: String((e as Error).message), hint: 'world service not running' }); }
  });

  // ---- 城里的人看到的应用商店与动态 ----
  app.get('/api/v1/store', async () => (await E.storeListing()).map((x) => ({ id: x.launch.id, name: x.launch.name, tagline: x.launch.tagline, description: x.launch.description, shots: x.launch.shot_evs ?? [], rating: x.rating, reviews: x.reviews })));
  app.get('/api/v1/feed', async (q) => {
    const lid = (q.query as { launch_id?: string }).launch_id;
    const rows = (await getDb().select().from(posts).orderBy(desc(posts.created_at)).limit(200)).filter((p) => !lid || p.launch_id === lid);
    const who = await names(rows.map((x) => x.persona_id));
    return rows.map((x) => ({ id: x.id, persona_id: x.persona_id, name: who.get(x.persona_id)?.name ?? x.persona_id, body: x.body, sentiment: x.sentiment, launch_id: x.launch_id, likes: x.likes, at: x.created_at }));
  });

  // ---- 虚拟身份的收件箱：被测产品的测试环境把验证邮件、短信发到这里，对应的人真的会收到 ----
  app.post('/api/v1/inbox/email', async (q, r) => {
    const b = (q.body ?? {}) as { to?: string; from?: string; subject?: string; body?: string; text?: string };
    if (!b.to || !(b.body ?? b.text)) return r.code(400).send({ error: 'to and body are required' });
    return E.deliverMail({ kind: 'email', address: b.to, sender: b.from, subject: b.subject, body: String(b.body ?? b.text) });
  });
  app.post('/api/v1/inbox/sms', async (q, r) => {
    const b = (q.body ?? {}) as { to?: string; from?: string; body?: string; text?: string };
    if (!b.to || !(b.body ?? b.text)) return r.code(400).send({ error: 'to and body are required' });
    return E.deliverMail({ kind: 'sms', address: b.to, sender: b.from, body: String(b.body ?? b.text) });
  });
}
