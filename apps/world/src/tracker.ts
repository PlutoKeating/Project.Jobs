// Session 跟踪：只读轮询 Postgres，把正在运行的 Session 的新步骤变成实时事件（不修改任何引擎数据）
import { and, apps, appVersions, desc, eq, evidence, getDb, gt, inArray, observations, sessions, steps, studies, worldStates, isNotNull } from '@pux/db';
import type { SessionLive } from '@pux/jobsworld';

type StepRow = typeof steps.$inferSelect;
export interface TrackedSession { id: string; study_id: string; persona_id: string; status: string; lastIdx: number; world_place?: string; ended_at?: Date | null; live?: SessionLive }

const appCache = new Map<string, { app: string; app_id: string; version: string }>();

export async function appForStudy(studyId: string) {
  if (appCache.has(studyId)) return appCache.get(studyId)!;
  const [r] = await getDb().select({ app: apps.name, app_id: apps.id, version: appVersions.version }).from(studies).innerJoin(appVersions, eq(appVersions.id, studies.app_version_id)).innerJoin(apps, eq(apps.id, appVersions.app_id)).where(eq(studies.id, studyId));
  const v = r ?? { app: '?', app_id: '', version: '' };
  appCache.set(studyId, v);
  return v;
}

export function actionText(s: StepRow): string | undefined {
  const a = s.action_request as { verb?: string; operator?: { target_description?: string; text?: string } } | null;
  if (!a?.verb) return undefined;
  const t = a.operator?.target_description || '';
  const typed = a.operator?.text ? `「${a.operator.text.slice(0, 40)}」` : '';
  return `${a.verb}${t ? ` · ${t}` : ''}${typed ? ` ${typed}` : ''}`;
}

export async function stepToLive(sess: { id: string; study_id: string; status: string; world_place?: string }, s: StepRow, total?: number, replay = false): Promise<SessionLive> {
  const db = getDb();
  const app = await appForStudy(sess.study_id);
  const [shot] = await db.select({ id: evidence.id }).from(evidence).where(and(eq(evidence.session_id, sess.id), eq(evidence.step_idx, s.idx), eq(evidence.kind, 'screenshot'))).limit(1);
  const [obs] = s.observation_id ? await db.select({ url: observations.url, title: observations.title }).from(observations).where(eq(observations.id, s.observation_id)) : [];
  const ds = (s.dynamic_state ?? {}) as { mood?: number; stress?: number };
  return {
    id: sess.id, study_id: sess.study_id, app: app.app, app_id: app.app_id, app_version: app.version,
    step_idx: s.idx, steps_total: total, sim_clock: s.sim_clock ?? undefined,
    monologue: s.monologue ?? undefined, intent: s.intent || undefined, action: actionText(s), decision: s.decision ?? undefined,
    expectation_violated: s.expectation_violated ?? undefined, screenshot_ev: shot?.id, url: obs?.url, title: obs?.title ?? undefined,
    mood: ds.mood, stress: ds.stress, world_place: sess.world_place, replay, status: sess.status,
  };
}

export async function worldPlace(sessionId: string): Promise<string | undefined> {
  const [w] = await getDb().select({ state: worldStates.state }).from(worldStates).where(eq(worldStates.session_id, sessionId)).orderBy(desc(worldStates.step_idx)).limit(1);
  return (w?.state as { place?: string } | undefined)?.place;
}

export class SessionTracker {
  readonly tracked = new Map<string, TrackedSession>();

  /** 一次轮询：返回新步骤（每个 Session 首次被发现时只取最新一步，避免刷屏） */
  async poll(): Promise<{ sess: TrackedSession; step: StepRow }[]> {
    const db = getDb();
    const recent = new Date(Date.now() - 90_000);
    const act = await db.select({ id: sessions.id, study_id: sessions.study_id, persona_id: sessions.persona_id, status: sessions.status, ended_at: sessions.ended_at }).from(sessions)
      .where(inArray(sessions.status, ['running', 'waiting_human']));
    const ended = await db.select({ id: sessions.id, study_id: sessions.study_id, persona_id: sessions.persona_id, status: sessions.status, ended_at: sessions.ended_at }).from(sessions)
      .where(and(isNotNull(sessions.ended_at), gt(sessions.ended_at, recent)));
    const seen = new Set<string>();
    const out: { sess: TrackedSession; step: StepRow }[] = [];
    for (const r of [...act, ...ended]) {
      if (seen.has(r.id)) continue; seen.add(r.id);
      let t = this.tracked.get(r.id);
      const fresh = !t;
      if (!t) { t = { ...r, lastIdx: -1 }; this.tracked.set(r.id, t); }
      t.status = r.status; t.ended_at = r.ended_at;
      const rows = fresh
        ? await db.select().from(steps).where(eq(steps.session_id, r.id)).orderBy(desc(steps.idx)).limit(1)
        : await db.select().from(steps).where(and(eq(steps.session_id, r.id), gt(steps.idx, t.lastIdx))).orderBy(steps.idx);
      if (rows.length) t.world_place = await worldPlace(r.id) ?? t.world_place;
      for (const s of rows) { out.push({ sess: t, step: s }); t.lastIdx = Math.max(t.lastIdx, s.idx); }
    }
    for (const [id] of this.tracked) if (!seen.has(id)) this.tracked.delete(id);
    return out;
  }

  /** 每个人物当前对应的 Session（同一人多个时取最近活跃的） */
  byPersona(): Map<string, TrackedSession> {
    const m = new Map<string, TrackedSession>();
    for (const t of this.tracked.values()) { const cur = m.get(t.persona_id); if (!cur || (t.status === 'running' && cur.status !== 'running')) m.set(t.persona_id, t); }
    return m;
  }
}

export async function loadSessionSteps(sessionId: string) {
  const db = getDb();
  const [s] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
  if (!s) return undefined;
  const rows = await db.select().from(steps).where(eq(steps.session_id, sessionId)).orderBy(steps.idx);
  return { session: s, steps: rows, world_place: await worldPlace(sessionId) };
}
