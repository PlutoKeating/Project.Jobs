// 世界里的人：家庭、住处、工作地点、钱包、关系网（residents / households / relations 表）
import { shortHash, type PersonaSpec } from '@pux/core';
import { mailHandle } from './mailhandle.ts';
import { and, eq, getDb, households, inArray, or, personas, relations, residents, sql, type NeedsRow } from '@pux/db';
import { hashNum, placeForKind, type PlaceKindT, type TownLayout } from './town.ts';

export type ResidentRow = typeof residents.$inferSelect;
export type HouseholdRow = typeof households.$inferSelect;

const WORK_PLACE: Record<string, PlaceKindT[] | null> = {
  office: ['office'], tech: ['office'], factory: ['factory'], outdoor: ['factory'], medical: ['hospital'], education: ['school'], school_kid: ['school'], student: ['library'],
  retail: ['shop'], food: ['restaurant', 'cafe'], service: ['office', 'hospital', 'shop'], delivery: null, freelance: null, home: null, retired: null, none: null,
};

/** 这个职业大类的人在城里哪个地点工作（跑单的人在街上，在家的人和没工作的人没有工作地点） */
export function workplaceFor(layout: TownLayout, workGroup: string, seed: string): string | null {
  if (workGroup === 'delivery') return 'street';
  const kinds = WORK_PLACE[workGroup]; if (!kinds) return null;
  return placeForKind(layout, kinds[hashNum(seed) % kinds.length], seed);
}

export async function allResidents(): Promise<Map<string, ResidentRow>> {
  return new Map((await getDb().select().from(residents)).map((r) => [r.persona_id, r]));
}
export async function residentOf(personaId: string): Promise<ResidentRow | undefined> {
  return (await getDb().select().from(residents).where(eq(residents.persona_id, personaId)))[0];
}
export async function allHouseholds(): Promise<Map<string, HouseholdRow>> {
  return new Map((await getDb().select().from(households)).map((h) => [h.id, h]));
}

export interface SettleInput { persona_id: string; spec: PersonaSpec; household: { id: string; locale: string; type: string; region: string }; role: string; work_group: string; income_month: number; life_event?: string; skeleton?: unknown }

/**
 * 让一批人住进城里：每个家庭分一套房，每个人按职业分配工作地点，发钱包、虚拟手机号和邮箱（用户名像真人自己起的，见 mailhandle.ts）。
 * 已经住下的人保持不变（跨次运行稳定）。
 */
export async function settleResidents(layout: TownLayout, people: SettleInput[], mailDomain = 'jobsworld.test'): Promise<{ households: number; residents: number }> {
  const db = getDb();
  const hhs = await allHouseholds();
  const taken = new Set([...hhs.values()].map((h) => h.home_unit).filter((u): u is number => u !== null));
  const have = await allResidents();
  const handles = new Set([...have.values()].map((r) => r.email?.split('@')[0]?.toLowerCase()).filter((x): x is string => !!x));
  let nh = 0; let nr = 0;
  for (const p of people) {
    let hh = hhs.get(p.household.id);
    if (!hh) {
      const n = layout.homes.length; let i = hashNum(p.household.id) % n;
      for (let k = 0; k < n && taken.has(i); k++) i = (i + 1) % n;
      taken.add(i);
      hh = { id: p.household.id, locale: p.household.locale, type: p.household.type, region: p.household.region, home_place_id: layout.homes[i].place_id, home_unit: i, created_at: new Date() };
      await db.insert(households).values(hh).onConflictDoNothing(); hhs.set(hh.id, hh); nh++;
    }
    if (have.has(p.persona_id)) continue;
    const zh = p.spec.locale === 'zh-CN'; const h = shortHash(p.persona_id, 8);
    const digits = String(parseInt(h, 16) % 100_000_000).padStart(8, '0');
    await db.insert(residents).values({
      persona_id: p.persona_id, household_id: hh.id, role: p.role, work_group: p.work_group, workplace_id: workplaceFor(layout, p.work_group, p.persona_id),
      income_month: p.income_month, currency: zh ? 'CNY' : 'USD', wallet: Math.round(p.income_month * (0.25 + (hashNum(p.persona_id) % 100) / 100)),
      life_event: p.life_event || null, phone: zh ? `199${digits}` : `+1555${digits.slice(0, 7)}`, email: `${mailHandle({ id: p.persona_id, name: p.spec.identity.name, locale: p.spec.locale, age: p.spec.identity.age, gender: p.spec.identity.gender }, handles)}@${mailDomain}`, skeleton: p.skeleton as never,
    }).onConflictDoNothing();
    nr++;
  }
  return { households: nh, residents: nr };
}

export async function saveRelations(rels: { a: string; b: string; kind: string; strength: number }[]) {
  const db = getDb();
  for (let i = 0; i < rels.length; i += 200) await db.insert(relations).values(rels.slice(i, i + 200)).onConflictDoUpdate({ target: [relations.a, relations.b], set: { kind: sql`excluded.kind`, strength: sql`excluded.strength` } });
}

export interface Tie { id: string; name: string; kind: string; strength: number; age: number; occupation: string }
/** 一个人的关系网（按亲疏排序） */
export async function tiesOf(personaId: string): Promise<Tie[]> {
  const db = getDb();
  const rows = await db.select().from(relations).where(or(eq(relations.a, personaId), eq(relations.b, personaId)));
  if (!rows.length) return [];
  const ids = rows.map((r) => (r.a === personaId ? r.b : r.a));
  const ps = await db.select({ id: personas.id, spec: personas.spec }).from(personas).where(and(inArray(personas.id, ids), eq(personas.active, true)));
  const byId = new Map(ps.map((p) => [p.id, p.spec as PersonaSpec]));
  return rows.map((r) => { const id = r.a === personaId ? r.b : r.a; const s = byId.get(id); return { id, name: s?.identity.name ?? id, kind: r.kind, strength: r.strength, age: s?.identity.age ?? 0, occupation: s?.identity.occupation ?? '' }; })
    .filter((t) => byId.has(t.id)).sort((x, y) => y.strength - x.strength);
}

export async function allRelations() { return getDb().select().from(relations); }

export async function saveNeeds(personaId: string, needs: NeedsRow, wallet?: number) {
  await getDb().update(residents).set({ needs, ...(wallet !== undefined ? { wallet } : {}), updated_at: sql`now()` }).where(eq(residents.persona_id, personaId));
}
