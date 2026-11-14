// REST /api/v1
import type { FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import { dataPath } from '@pux/core';
import { and, apps, appVersions, count, desc, eq, events, evidence, getDb, humanTasks, inArray, interviews, issues, judgments, observations, personaMemories, sessions, steps, studies, worldStates } from '@pux/db';
import { blobs } from '@pux/storage';
import * as E from '@pux/engine';
import { computeLayout, kvGetJson, latestPersonas, loadAgenda, personaById, personaMemoryList, personaSessions, personaTrust, SUBJ, type Snapshot } from '@pux/jobsworld';
import { login, logout, requireAdmin, roleOf, authEnabled } from './auth.ts';
import { avatarFor } from './avatars.ts';
import { autoProject, createAndRun, running } from './jobs.ts';
import { appRollup, cachedVerdict, generateVerdict, sessionFacts } from './rollup.ts';
import type { Bus } from '@pux/jobsworld';

type P = { id: string };
const layout = computeLayout();

export function routes(app: FastifyInstance, bus: Bus | undefined) {
  const snapshot = async () => (bus ? await kvGetJson<Snapshot>(bus.kv, 'snapshot').catch(() => undefined) : undefined);
  const request = async (subject: string, data: unknown, timeout = 120_000) => {
    if (!bus) throw new Error('nats_unavailable');
    const m = await bus.nc.request(subject, new TextEncoder().encode(JSON.stringify(data)), { timeout });
    return JSON.parse(new TextDecoder().decode(m.data)) as Record<string, unknown>;
  };

  // ---- 身份 ----
  app.get('/api/v1/me', async (q) => ({ ...roleOf(q), auth_required: authEnabled(), game_port: Number(process.env.JW_PORT ?? 7777) }));
  app.post('/api/v1/auth/login', async (q, r) => { const res = login(String((q.body as { passcode?: string })?.passcode ?? ''), r); return res.viewer ? res : r.code(401).send({ error: 'bad_passcode' }); });
  app.post('/api/v1/auth/logout', async (_q, r) => { logout(r); return { ok: true }; });

  // ---- 总览 ----
  app.get('/api/v1/overview', async () => {
    const db = getDb();
    const [sc] = await db.select({ n: count() }).from(sessions);
    const [ic] = await db.select({ n: count() }).from(issues);
    const live = await db.select({ id: sessions.id }).from(sessions).where(inArray(sessions.status, ['running', 'waiting_human']));
    const tested = await db.selectDistinct({ app: appVersions.app_id }).from(studies).innerJoin(appVersions, eq(appVersions.id, studies.app_version_id));
    const pending = await db.select({ id: humanTasks.id }).from(humanTasks).where(eq(humanTasks.status, 'pending'));
    return { personas: (await latestPersonas()).length, sessions: sc.n, issues: ic.n, live: live.length, apps_tested: tested.length, human_pending: pending.length, snapshot: await snapshot() };
  });

  // ---- 人物 ----
  app.get('/api/v1/personas', async () => {
    const db = getDb();
    const roster = await latestPersonas();
    const ss = await db.select({ persona_id: sessions.persona_id, app: apps.name, started_at: sessions.started_at }).from(sessions).innerJoin(studies, eq(studies.id, sessions.study_id)).innerJoin(appVersions, eq(appVersions.id, studies.app_version_id)).innerJoin(apps, eq(apps.id, appVersions.app_id));
    const mem = await db.select({ persona_id: personaMemories.persona_id, n: count() }).from(personaMemories).groupBy(personaMemories.persona_id);
    const snap = await snapshot();
    return roster.map((r) => {
      const mine = ss.filter((s) => s.persona_id === r.id);
      const live = snap?.personas.find((p) => p.id === r.id);
      return {
        id: r.id, kind: r.kind, locale: r.locale, segment: r.segment, target_user: r.target_user, source: r.source, frozen: r.frozen,
        name: r.spec.identity.name, age: r.spec.identity.age, gender: r.spec.identity.gender, occupation: r.spec.identity.occupation, region: r.spec.identity.region,
        digital_literacy: r.spec.capability.digital_literacy, ai_familiarity: r.spec.capability.ai_familiarity,
        sessions: mine.length, apps: [...new Set(mine.map((s) => s.app))], last_seen: mine.reduce<Date | null>((m, s) => (s.started_at && (!m || s.started_at > m) ? s.started_at : m), null),
        memories: mem.find((m) => m.persona_id === r.id)?.n ?? 0,
        live: live ? { place_id: live.place_id, activity: live.activity, mode: live.mode, app: live.session?.app } : null,
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
      spec: p.spec, agenda: await loadAgenda(id, date), memories: await personaMemoryList(id, 120), sessions: await personaSessions(id, 80), trust: await personaTrust(id),
      live: snap?.personas.find((x) => x.id === id) ?? null, clock: snap?.clock ?? null,
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
    const b = (q.body ?? {}) as { n?: number; locale?: 'zh-CN' | 'en-US' };
    const n = Math.max(1, Math.min(12, Number(b.n ?? 4)));
    const out = await E.generatePersonas({ n, locale: b.locale === 'en-US' ? 'en-US' : 'zh-CN' });
    return { ok: true, result: out };
  });

  // ---- 世界 ----
  app.get('/api/v1/world/town', async (_q, r) => r.header('cache-control', 'public, max-age=60').send(layout));
  app.get('/api/v1/world/snapshot', async () => (await snapshot()) ?? null);
  app.post('/api/v1/world/clock', async (q, r) => { if (!requireAdmin(q, r)) return; return request(SUBJ.cmdClock, q.body ?? {}, 5000); });
  app.post('/api/v1/world/events', async (q, r) => { if (!requireAdmin(q, r)) return; return request(SUBJ.cmdEvent, { ...(q.body as object), by: 'web' }, 5000); });
  app.post('/api/v1/world/replay', async (q) => request(SUBJ.cmdReplay, q.body ?? {}, 10_000));
  app.post('/api/v1/world/ask', async (q) => request(SUBJ.ask, q.body ?? {}));

  // ---- 软件 ----
  app.get('/api/v1/apps', async () => {
    const db = getDb();
    const list = await db.select().from(apps).orderBy(apps.name);
    const out = [];
    for (const a of list) {
      const facts = (await sessionFacts(a.id)).filter((f) => !f.expert);
      const vs = await db.select({ id: appVersions.id }).from(appVersions).where(eq(appVersions.app_id, a.id));
      const iss = vs.length ? await db.select({ severity: issues.severity, status: issues.status }).from(issues).where(inArray(issues.app_version_id, vs.map((v) => v.id))) : [];
      const live = iss.filter((i) => i.status !== 'rejected' && i.status !== 'folded');
      const sus = facts.map((f) => f.sus).filter((x): x is number => x !== null);
      const comp = facts.map((f) => f.completed).filter((x): x is boolean => x !== null);
      out.push({ id: a.id, name: a.name, description: a.description, form: a.form, versions: vs.length, sessions: facts.length, personas: new Set(facts.map((f) => f.persona_id)).size,
        completion: comp.length ? comp.filter(Boolean).length / comp.length : null, sus: sus.length ? sus.reduce((x, y) => x + y, 0) / sus.length : null,
        issues: { P0: live.filter((i) => i.severity === 'P0').length, P1: live.filter((i) => i.severity === 'P1').length, total: live.length },
        last_run: facts.reduce<Date | null>((m, f) => (f.started_at && (!m || f.started_at > m) ? f.started_at : m), null) });
    }
    return out;
  });
  app.get('/api/v1/apps/:id/report', async (q, r) => (await appRollup((q.params as P).id)) ?? r.code(404).send({ error: 'not_found' }));
  app.get('/api/v1/apps/:id/verdict', async (q) => {
    const lang = (q.query as { lang?: string }).lang === 'en' ? 'en' : 'zh';
    return (await cachedVerdict((q.params as P).id, lang)) ?? null;
  });
  app.post('/api/v1/apps/:id/verdict', async (q, r) => {
    if (!requireAdmin(q, r)) return;
    const lang = (q.body as { lang?: string } | undefined)?.lang === 'en' ? 'en' : 'zh';
    try { return await generateVerdict((q.params as P).id, lang); } catch (e) { return r.code(422).send({ error: String((e as Error).message) }); }
  });
  app.get('/api/v1/app-versions', async () => getDb().select({ id: appVersions.id, app_id: apps.id, app: apps.name, version: appVersions.version, url: appVersions.env_url, seeded: appVersions.seeded_defects, spec: appVersions.product_spec_path }).from(appVersions).innerJoin(apps, eq(apps.id, appVersions.app_id)).orderBy(apps.name, appVersions.version));

  // ---- Study ----
  app.get('/api/v1/studies', async () => {
    const db = getDb();
    const rows = await db.select({ s: studies, app: apps.name, app_id: apps.id, version: appVersions.version }).from(studies).innerJoin(appVersions, eq(appVersions.id, studies.app_version_id)).innerJoin(apps, eq(apps.id, appVersions.app_id)).orderBy(desc(studies.created_at)).limit(200);
    const counts = await db.select({ study_id: sessions.study_id, n: count() }).from(sessions).groupBy(sessions.study_id);
    return rows.map(({ s, app, app_id, version }) => ({ id: s.id, name: s.name, status: s.status, app, app_id, version, created_at: s.created_at, finished_at: s.finished_at, tokens: s.tokens, cost_usd: s.cost_usd, stop_reason: s.stop_reason, sessions: counts.find((c) => c.study_id === s.id)?.n ?? 0, report: existsSync(dataPath('reports', s.id, 'index.html')), job: running.has(s.id) && !running.get(s.id)!.done }));
  });
  app.get('/api/v1/studies/:id', async (q, r) => {
    const id = (q.params as P).id; const db = getDb();
    const [row] = await db.select({ s: studies, app: apps.name, app_id: apps.id, version: appVersions.version }).from(studies).innerJoin(appVersions, eq(appVersions.id, studies.app_version_id)).innerJoin(apps, eq(apps.id, appVersions.app_id)).where(eq(studies.id, id));
    if (!row) return r.code(404).send({ error: 'not_found' });
    const roster = new Map((await latestPersonas()).map((p) => [p.id, p.spec.identity.name]));
    const ss = (await db.select().from(sessions).where(eq(sessions.study_id, id)).orderBy(sessions.round, sessions.started_at)).map((s) => ({ ...s, persona_name: roster.get(s.persona_id) ?? s.persona_id }));
    const iss = await E.studyIssues(id);
    const job = running.get(id);
    return { study: row.s, app: row.app, app_id: row.app_id, version: row.version, sessions: ss, issues: iss.map((i) => ({ id: i.id, title: i.title, severity: i.severity, category: i.category, attribution: i.attribution, trust: i.trust_level, status: i.status, segments: i.affected_segments ?? [], seeded_match: i.seeded_match, sessions: (i.session_ids ?? []).length, recommendation: i.recommendation })), job: job ? { log: job.log.slice(-200), done: !!job.done, error: job.error } : null, report: existsSync(dataPath('reports', id, 'index.html')) };
  });
  app.post('/api/v1/studies', async (q, r) => { if (!requireAdmin(q, r)) return; return createAndRun(q.body as Record<string, unknown>, q.headers['idempotency-key'] as string | undefined); });
  // 兼容旧 console 的 CI 入口
  app.post('/api/studies', async (q, r) => { if (!requireAdmin(q, r)) return; return createAndRun(q.body as Record<string, unknown>, q.headers['idempotency-key'] as string | undefined); });
  app.get('/api/studies/:id', async (q, r) => r.redirect(`/api/v1/studies/${(q.params as P).id}`, 307));
  app.post('/api/v1/projects', async (q, r) => {
    if (!requireAdmin(q, r)) return;
    const b = q.body as Record<string, string | number | boolean>;
    const id = await autoProject({ name: String(b.name), url: String(b.url), version: String(b.version || 'v1'), form: (b.form as 'web') || 'web', prd: (b.prd as string) || undefined, sessions: Number(b.sessions || 6), steps: Number(b.steps || 30), user: (b.user as string) || undefined, password: (b.password as string) || undefined, temporal: !!b.temporal, executor: (b.executor as 'stagehand') || 'stagehand' });
    return { study_id: id };
  });

  // ---- Session ----
  app.get('/api/v1/sessions/:id', async (q, r) => {
    const id = (q.params as P).id; const db = getDb();
    const [s] = await db.select().from(sessions).where(eq(sessions.id, id));
    if (!s) return r.code(404).send({ error: 'not_found' });
    const [meta] = await db.select({ app: apps.name, app_id: apps.id, version: appVersions.version }).from(studies).innerJoin(appVersions, eq(appVersions.id, studies.app_version_id)).innerJoin(apps, eq(apps.id, appVersions.app_id)).where(eq(studies.id, s.study_id));
    const st = await db.select().from(steps).where(eq(steps.session_id, id)).orderBy(steps.idx);
    const obs = new Map((await db.select({ id: observations.id, url: observations.url, title: observations.title, data: observations.data }).from(observations).where(eq(observations.session_id, id))).map((o) => [o.id, o]));
    const ws = new Map((await db.select({ step_idx: worldStates.step_idx, state: worldStates.state }).from(worldStates).where(eq(worldStates.session_id, id))).map((w) => [w.step_idx, w.state as Record<string, unknown>]));
    const p = await personaById(s.persona_id);
    return {
      session: s, app: meta, persona: p ? { id: p.id, name: p.spec.identity.name, occupation: p.spec.identity.occupation, age: p.spec.identity.age, segment: p.segment, locale: p.locale } : null,
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
    try { const { signalHuman } = await import('@pux/worker/client'); await signalHuman(id); } catch { /* inline 模式 */ }
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
