// 世界服务与 API 共用的只读查询
import type { PersonaSpec } from '@pux/core';
import { listMemories } from '@pux/memory';
import { and, apps, appVersions, desc, eq, getDb, inArray, interviews, personaGlobalState, personas, sessions, studies } from '@pux/db';

export interface PersonaRow { id: string; version: string; kind: string; locale: string; segment: string; target_user: boolean; source: string; spec: PersonaSpec; frozen: boolean; created_at: Date }

/** 每个人物的最新版本（只取 active） */
export async function latestPersonas(): Promise<PersonaRow[]> {
  const rows = await getDb().select().from(personas).where(eq(personas.active, true)).orderBy(desc(personas.created_at));
  const m = new Map<string, PersonaRow>();
  for (const r of rows) if (!m.has(r.id)) m.set(r.id, { ...r, spec: r.spec as PersonaSpec });
  return [...m.values()];
}

export async function personaById(id: string): Promise<PersonaRow | undefined> {
  const [r] = await getDb().select().from(personas).where(eq(personas.id, id)).orderBy(desc(personas.created_at)).limit(1);
  return r ? { ...r, spec: r.spec as PersonaSpec } : undefined;
}

export interface PersonaSessionRow { id: string; study_id: string; app: string; app_id: string; version: string; mode: string; status: string; outcome: string | null; steps: number; world: string; revisit_day: number; started_at: Date | null; ended_at: Date | null; summary: unknown }

export async function personaSessions(personaId: string, limit = 50): Promise<PersonaSessionRow[]> {
  return getDb().select({ id: sessions.id, study_id: sessions.study_id, app: apps.name, app_id: apps.id, version: appVersions.version, mode: sessions.mode, status: sessions.status, outcome: sessions.outcome, steps: sessions.steps_count, world: sessions.world_template_id, revisit_day: sessions.revisit_day, started_at: sessions.started_at, ended_at: sessions.ended_at, summary: sessions.summary })
    .from(sessions).innerJoin(studies, eq(studies.id, sessions.study_id)).innerJoin(appVersions, eq(appVersions.id, studies.app_version_id)).innerJoin(apps, eq(apps.id, appVersions.app_id))
    .where(eq(sessions.persona_id, personaId)).orderBy(desc(sessions.started_at)).limit(limit);
}

/** 人物的记忆（来自他的 ewave 记忆树），字段与旧表保持一致，另带所在分支 */
export async function personaMemoryList(personaId: string, limit = 60) {
  return (await listMemories(personaId, limit)).map((m) => ({ id: m.id, app_id: m.app_id ?? null, kind: m.kind, content: m.content, valence: m.valence, importance: m.importance, sim_day: m.sim_day, sim_time: m.sim_time ?? null, source_session_id: m.session_id ?? null, created_at: new Date(m.created_at), branch: m.branch }));
}

export async function personaTrust(personaId: string) {
  const [g] = await getDb().select().from(personaGlobalState).where(eq(personaGlobalState.persona_id, personaId));
  return g;
}

/** 最近一次已结束的 Session（用于游戏内「和他聊聊」） */
export async function lastFinishedSession(personaId: string): Promise<string | undefined> {
  const [s] = await getDb().select({ id: sessions.id }).from(sessions).where(and(eq(sessions.persona_id, personaId), inArray(sessions.status, ['finished', 'evaluated']))).orderBy(desc(sessions.ended_at)).limit(1);
  return s?.id;
}

export async function sessionInterviews(sessionId: string) {
  return getDb().select().from(interviews).where(eq(interviews.session_id, sessionId)).orderBy(interviews.created_at);
}
