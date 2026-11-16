// REST /api/v1
import type { FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import { dataPath, jobsVersion } from '@pux/core';
import { memoryCounts } from '@pux/memory';
import { and, apps, appVersions, count, desc, eq, events, evidence, getDb, humanTasks, inArray, interviews, issues, judgments, launches, llmTraces, observations, sessions, steps, studies, worldStates, sql } from '@pux/db';
import { blobs } from '@pux/storage';
import * as E from '@pux/engine';
import { computeLayout, kvGetJson, latestPersonas, liveContextFor, loadAgenda, personaById, personaMemoryList, personaSessions, personaTrust, residentOf, tiesOf, SUBJ, type Snapshot } from '@pux/jobsworld';
import { login, logout, requireAdmin, roleOf, authEnabled } from './auth.ts';
import { avatarFor } from './avatars.ts';
import type { Bus } from '@pux/jobsworld';
import { launchRoutes } from './launches.ts';
import { mailRoutes } from './mail.ts';
import { modelRoutes, modelsReady } from './models.ts';
import { gameRoutes } from './game.ts';
import { updateRoutes } from './update.ts';
import { feishuRoutes } from './feishu.ts';

type P = { id: string };
const layout = computeLayout();

export function routes(app: FastifyInstance, bus: Bus | undefined) {
  launchRoutes(app, bus);
  mailRoutes(app);
  modelRoutes(app);
  gameRoutes(app);
  updateRoutes(app);
  feishuRoutes(app, bus);
  const snapshot = async () => (bus ? await kvGetJson<Snapshot>(bus.kv, 'snapshot').catch(() => undefined) : undefined);
  const request = async (subject: string, data: unknown, timeout = 120_000) => {
    if (!bus) throw new Error('nats_unavailable');
    const m = await bus.nc.request(subject, new TextEncoder().encode(JSON.stringify(data)), { timeout });
    return JSON.parse(new TextDecoder().decode(m.data)) as Record<string, unknown>;
  };

  // ---- 身份 ----
  app.get('/api/v1/me', async (q) => ({ ...roleOf(q), auth_required: authEnabled(), version: roleOf(q).viewer ? jobsVersion() : undefined, game_port: Number(process.env.JW_PORT ?? 7777), models_ready: await modelsReady().then((m) => m.ready).catch(() => false) }));
  app.post('/api/v1/auth/login', async (q, r) => { const res = login(String((q.body as { passcode?: string })?.passcode ?? ''), r); return res.viewer ? res : r.code(401).send({ error: 'bad_passcode' }); });
  app.post('/api/v1/auth/logout', async (_q, r) => { logout(r); return { ok: true }; });

  // ---- 总览 ----
  app.get('/api/v1/overview', async () => {
    const db = getDb();
    const [sc] = await db.select({ n: count() }).from(sessions);
    const [ic] = await db.select({ n: count() }).from(issues);
    const live = await db.select({ id: sessions.id }).from(sessions).where(inArray(sessions.status, ['running', 'waiting_human']));
    const [lc] = await db.select({ n: count() }).from(launches);
    // 到目前为止模型调用一共花了多少（估算；价格未知的模型按 0 计）。不设上限，所以界面上一直显示
    const [sp] = await db.select({ usd: sql<number>`coalesce(sum(${llmTraces.cost_usd}), 0)` }).from(llmTraces);
    const pending = await db.select({ id: humanTasks.id }).from(humanTasks).where(eq(humanTasks.status, 'pending'));
    return { personas: (await latestPersonas()).length, sessions: sc.n, issues: ic.n, live: live.length, launches: lc.n, spend_usd: Math.round(Number(sp?.usd ?? 0) * 100) / 100, human_pending: pending.length, snapshot: await snapshot() };
  });

  // ---- 人物 ----
  app.get('/api/v1/personas', async () => {
    const db = getDb();
    const roster = await latestPersonas();
    const ss = await db.select({ persona_id: sessions.persona_id, app: apps.name, started_at: sessions.started_at }).from(sessions).innerJoin(studies, eq(studies.id, sessions.study_id)).innerJoin(appVersions, eq(appVersions.id, studies.app_version_id)).innerJoin(apps, eq(apps.id, appVersions.app_id));
    const memN = await memoryCounts();
    const snap = await snapshot();
    return roster.map((r) => {
      const mine = ss.filter((s) => s.persona_id === r.id);
      const live = snap?.personas.find((p) => p.id === r.id);
      return {
        id: r.id, kind: r.kind, locale: r.locale, segment: r.segment, target_user: r.target_user, source: r.source, frozen: r.frozen,
        name: r.spec.identity.name, age: r.spec.identity.age, gender: r.spec.identity.gender, occupation: r.spec.identity.occupation, region: r.spec.identity.region,
        digital_literacy: r.spec.capability.digital_literacy, ai_familiarity: r.spec.capability.ai_familiarity,
        sessions: mine.length, apps: [...new Set(mine.map((s) => s.app))], last_seen: mine.reduce<Date | null>((m, s) => (s.started_at && (!m || s.started_at > m) ? s.started_at : m), null),
        memories: memN.get(r.id) ?? 0,
        live: live ? { place_id: live.place_id, activity: live.activity, mode: live.mode, app: live.session?.app, needs: live.needs ?? null, phone: live.phone ?? null } : null,
        household_id: live?.household_id ?? null,
      };
    });
  });

  app.get('/api/v1/personas/:id', async (q, r) => {
    const id = (q.params as P).id;
    const p = await personaById(id);
    if (!p) return r.code(404).send({ error: 'not_found' });
    const snap = await snapshot();
    const date = snap?.clock.date ?? new Date().toISOString().slice(0, 10);
    return {
      id: p.id, version: p.version, kind: p.kind, locale: p.locale, segment: p.segment, target_user: p.target_user, source: p.source, frozen: p.frozen, created_at: p.created_at,
      spec: p.spec, agenda: await loadAgenda(id, date), memories: await personaMemoryList(id, 120), sessions: await personaSessions(id, 80), launch_of: Object.fromEntries((await getDb().select({ id: launches.id, app_id: launches.app_id }).from(launches)).map((l) => [l.app_id, l.id])), trust: await personaTrust(id),
      live: snap?.personas.find((x) => x.id === id) ?? null, clock: snap?.clock ?? null,
      // 世界里的人：家庭、工作地点、钱包、关系网，以及此时此地的处境（合并世界：这就是他使用产品时的上下文）
      resident: await residentOf(id).then((x) => (x ? { household_id: x.household_id, role: x.role, work_group: x.work_group, workplace_id: x.workplace_id, income_month: x.income_month, currency: x.currency, wallet: x.wallet, life_event: x.life_event, email: x.email, phone: x.phone } : null)),
      ties: (await tiesOf(id)).slice(0, 24),
      here: await liveContextFor(id).then((c) => (c ? { clock: c.clock, name: c.name, scenario: c.scenario, place_id: c.place_id, device: c.ctx.device, posture: c.ctx.posture, needs: c.needs, phone_affinity: c.phone_affinity, available: c.available, unavailable_reason: c.unavailable_reason ?? null, time_left_min: c.time_left_min, companions: c.companions.map((t) => ({ id: t.id, name: t.name, kind: t.kind })) } : null)).catch(() => null),
    };
  });

  app.get('/api/v1/personas/:id/avatar', async (q, r) => {
    const p = await personaById((q.params as P).id);
    if (!p) return r.code(404).send();
    const a = await avatarFor(p.spec);
    return r.header('cache-control', a.mime === 'image/svg+xml' ? 'no-cache' : 'public, max-age=86400').type(a.mime).send(a.body);
  });

  app.post('/api/v1/personas/generate', async (q, r) => {
    if (!requireAdmin(q, r)) return;
    const b = (q.body ?? {}) as { n?: number; locale?: 'zh-CN' | 'en-US' | 'mixed' };
    const n = Math.max(1, Math.min(12, Number(b.n ?? 4)));
    // 新居民：统计骨架 + 规则推导 + 模型写叙事，并住进城里（locale 决定这批人来自中国还是英语区）
    const out = await E.generatePopulation({ n, zhShare: b.locale === 'en-US' ? 0 : b.locale === 'mixed' ? 0.5 : 1, seed: Date.now() % 1_000_000 });
    return { ok: true, result: out };
  });

  // ---- 世界 ----
  app.get('/api/v1/world/town', async (_q, r) => r.header('cache-control', 'public, max-age=60').send(layout));
  app.get('/api/v1/world/snapshot', async () => (await snapshot()) ?? null);
  app.post('/api/v1/world/clock', async (q, r) => { if (!requireAdmin(q, r)) return; return request(SUBJ.cmdClock, q.body ?? {}, 5000); });
  app.post('/api/v1/world/events', async (q, r) => { if (!requireAdmin(q, r)) return; return request(SUBJ.cmdEvent, { ...(q.body as object), by: 'web' }, 5000); });
  app.post('/api/v1/world/replay', async (q) => request(SUBJ.cmdReplay, q.body ?? {}, 10_000));
  app.post('/api/v1/world/ask', async (q) => request(SUBJ.ask, q.body ?? {}));

  // ---- 使用过程 ----
  app.get('/api/v1/sessions/:id', async (q, r) => {
    const id = (q.params as P).id; const db = getDb();
    const [s] = await db.select().from(sessions).where(eq(sessions.id, id));
    if (!s) return r.code(404).send({ error: 'not_found' });
    const [meta] = await db.select({ app: apps.name, app_id: apps.id, version: appVersions.version }).from(studies).innerJoin(appVersions, eq(appVersions.id, studies.app_version_id)).innerJoin(apps, eq(apps.id, appVersions.app_id)).where(eq(studies.id, s.study_id));
    const st = await db.select().from(steps).where(eq(steps.session_id, id)).orderBy(steps.idx);
    const obs = new Map((await db.select({ id: observations.id, url: observations.url, title: observations.title, data: observations.data }).from(observations).where(eq(observations.session_id, id))).map((o) => [o.id, o]));
    const ws = new Map((await db.select({ step_idx: worldStates.step_idx, state: worldStates.state }).from(worldStates).where(eq(worldStates.session_id, id))).map((w) => [w.step_idx, w.state as Record<string, unknown>]));
    const p = await personaById(s.persona_id);
    const [lch] = await db.select({ id: launches.id, name: launches.name }).from(launches).where(eq(launches.study_id, s.study_id));
    return {
      session: s, app: meta, launch: lch ?? null, persona: p ? { id: p.id, name: p.spec.identity.name, occupation: p.spec.identity.occupation, age: p.spec.identity.age, segment: p.segment, locale: p.locale } : null,
      steps: st.map((x) => { const o = x.observation_id ? obs.get(x.observation_id) : undefined; const w = ws.get(x.idx); return {
        idx: x.idx, sim_clock: x.sim_clock, monologue: x.monologue, intent: x.intent, decision: x.decision, expectation: x.expectation, expectation_violated: x.expectation_violated,
        dynamic_state: x.dynamic_state, action: x.action_request, result: x.action_result, url: o?.url, title: o?.title, screenshot_ev: (o?.data as { screenshot_ev?: string } | undefined)?.screenshot_ev,
        place: w?.place, resources: w?.resources }; }),
      events: await db.select().from(events).where(eq(events.session_id, id)).orderBy(events.step_idx),
      interviews: await db.select().from(interviews).where(eq(interviews.session_id, id)).orderBy(interviews.created_at),
      judgments: await db.select().from(judgments).where(and(eq(judgments.target_id, id), eq(judgments.target, 'session'))),
    };
  });
  app.post('/api/v1/sessions/:id/ask', async (q, r) => {
    const id = (q.params as P).id;
    const question = String((q.body as { q?: string })?.q ?? '').slice(0, 500);
    if (!question) return r.code(400).send({ error: 'empty' });
    return { answer: await E.askPersona(id, question) };
  });

  // ---- 问题、人工接管、证据 ----
  app.post('/api/v1/issues/:id/triage', async (q, r) => {
    if (!requireAdmin(q, r)) return;
    const status = String((q.body as { status?: string })?.status);
    if (!['confirmed', 'rejected', 'open'].includes(status)) return r.code(400).send({ error: 'bad_status' });
    await getDb().update(issues).set({ status }).where(eq(issues.id, (q.params as P).id));
    return { ok: true };
  });
  app.get('/api/v1/human', async () => getDb().select().from(humanTasks).orderBy(desc(humanTasks.created_at)).limit(50));
  app.post('/api/v1/human/:id/resolve', async (q, r) => {
    if (!requireAdmin(q, r)) return;
    const id = (q.params as P).id;
    await E.resolveHumanTask(id, 'resolved', 'web');
    return { ok: true };
  });
  const evidenceHandler = async (q: { params: unknown }, r: import('fastify').FastifyReply) => {
    const [ev] = await getDb().select().from(evidence).where(eq(evidence.id, (q.params as P).id));
    if (!ev) return r.code(404).send({ error: 'not_found' });
    if (ev.storage_ref) return r.header('cache-control', 'public, max-age=31536000, immutable').type(ev.mime ?? 'application/octet-stream').send(await blobs().get(ev.storage_ref));
    return ev.inline;
  };
  app.get('/api/v1/evidence/:id', evidenceHandler);
  app.get('/evidence/:id', evidenceHandler);
}
