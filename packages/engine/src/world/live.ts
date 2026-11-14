// 合并世界在引擎一侧的入口：一次使用发生在这个人此时此地的处境里（处境由 @pux/jobsworld 计算）。
import type { DynamicState, PersonaSpec, WorldTemplate } from '@pux/core';
import { eq, getDb, residents, sessions, worldTemplates } from '@pux/db';
import { agendaFor, dayIndex, liveContextFor, phoneAffinity, actKindOf, toMin, worldClock, type LiveContext } from '@pux/jobsworld';

export type { LiveContext };

/** 写进 sessions.world_context 的记录：这次使用开始时他在哪、在做什么、身边有谁、状态如何，以及据此生成的世界模板 */
export interface ContextRecord {
  date: string; clock: string; day: number; place_id: string; place_kind: string; place_name: { zh: string; en: string };
  activity: string; act_kind: string; scenario: string; name: string; device: 'phone' | 'computer';
  needs: LiveContext['needs']; wallet: number; currency: string; companions: string[]; time_left_min: number; battery_pct: number; events: string[];
  template: WorldTemplate;
}
export const contextRecord = (c: LiveContext): ContextRecord => ({
  date: c.date, clock: c.clock, day: dayIndex(c.date), place_id: c.place_id, place_kind: c.place_kind, place_name: c.place_name, activity: c.activity, act_kind: c.act_kind, scenario: c.scenario, name: c.name,
  device: c.ctx.device, needs: c.needs, wallet: c.wallet, currency: c.currency, companions: c.companions.map((x) => x.name), time_left_min: c.time_left_min, battery_pct: c.battery_pct, events: c.events.map((e) => e.kind), template: c.template,
});

/**
 * 把手机递给一个人：他此刻有空就是此刻的处境；没空（在睡觉、在开车、在上课）就取他接下来第一个有空的时刻。
 */
export async function nextFreeContext(personaId: string): Promise<LiveContext | undefined> {
  const now = await liveContextFor(personaId);
  if (!now) return undefined;
  if (now.available && now.phone_affinity >= 0.2) return now;
  const [row] = await getDb().select().from(residents).where(eq(residents.persona_id, personaId));
  const clk = await worldClock();
  const nextDate = (d: string) => { const x = new Date(`${d}T12:00:00`); x.setDate(x.getDate() + 1); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  const { personas } = await import('@pux/db');
  const [p] = await getDb().select().from(personas).where(eq(personas.id, personaId));
  const spec = p.spec as PersonaSpec;
  for (const [date, from] of [[clk.date, clk.minute], [nextDate(clk.date), 0]] as [string, number][]) {
    const a = await agendaFor(spec, date, row);
    const slots = a.items.filter((it) => toMin(it.from) >= from).map((it) => ({ it, aff: phoneAffinity(actKindOf(it), it.place_kind, spec) })).filter((x) => x.aff >= 0.25);
    for (const s of slots) { const c = await liveContextFor(personaId, { date, minute: Math.min(toMin(s.it.to) - 1, toMin(s.it.from) + 3) }); if (c?.available) return c; }
  }
  return now.available ? now : undefined;
}

type SessLite = { world_template_id: string; world_context?: unknown };
/** 一次使用所处的世界：合并世界时是当时记录下来的处境模板，否则是场景模板库里的那一份 */
export async function worldOfSession(s: SessLite): Promise<WorldTemplate | undefined> {
  const rec = s.world_context as ContextRecord | null | undefined;
  if (rec?.template) return rec.template;
  return (await getDb().select().from(worldTemplates).where(eq(worldTemplates.id, s.world_template_id)))[0]?.spec as WorldTemplate | undefined;
}
export const scenarioOfSession = (s: SessLite, fallback?: string) => (s.world_context as ContextRecord | null | undefined)?.scenario ?? fallback ?? s.world_template_id;
export const worldNameOfSession = (s: SessLite, fallback?: string) => (s.world_context as ContextRecord | null | undefined)?.name ?? fallback ?? s.world_template_id;

/** 这个人在城里的需求状态 → 使用开始时的身心状态 */
export function stateFromContext(base: DynamicState, rec: ContextRecord): DynamicState {
  const n = rec.needs;
  return { ...base, fatigue: Math.max(0, Math.min(1, 1 - n.energy)), hunger: n.hunger, stress: n.stress, mood: n.mood, attention: rec.template.resources.attention };
}

export async function saveSessionContext(sessionId: string, rec: ContextRecord) { await getDb().update(sessions).set({ world_context: rec }).where(eq(sessions.id, sessionId)); }
