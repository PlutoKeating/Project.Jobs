// 人物日程：规则骨架（config/jobsworld/agenda.yaml）+ mind.slow 补全意图与因果
import { configPath, logger, readYaml, z, type PersonaSpec } from '@pux/core';
import { getDb, personaAgendas, eq, and, type AgendaItemRow } from '@pux/db';
import { gateway } from '@pux/llm';
import { hashNum, placeForKind, type PlaceKindT, type TownLayout } from './town.ts';

const AgendaConfigSchema = z.object({
  roles: z.record(z.string(), z.array(z.object({
    from: z.string(), to: z.string(), place: z.string(),
    act: z.object({ zh: z.string(), en: z.string() }),
    k: z.string().optional(),
    if: z.string().optional(),
  }))),
  weekend_roles: z.array(z.string()).default([]),
  workplaces: z.array(z.object({ place: z.string(), words: z.array(z.string()) })),
});
type AgendaConfig = z.infer<typeof AgendaConfigSchema>;
let cfg: AgendaConfig | undefined;
export const agendaConfig = () => (cfg ??= AgendaConfigSchema.parse(readYaml(configPath('jobsworld', 'agenda.yaml'))));

export type AgendaItem = AgendaItemRow;
export interface Agenda { persona_id: string; sim_date: string; home_place_id: string; home_unit: number; role: string; items: AgendaItem[]; source: 'skeleton' | 'llm' }

const has = (list: string[] | undefined, re: RegExp) => (list ?? []).some((s) => re.test(s));

/** 世界侧的居民信息（来自 residents 表）；没有时按人物描述推断 */
export interface ResidentHint { work_group?: string | null; workplace_id?: string | null; role?: string | null }

export function inferRole(p: PersonaSpec, r?: ResidentHint): string {
  const id = p.identity; const occ = `${id.occupation ?? ''}`; const age = id.age ?? 30;
  if (p.kind === 'child' || age < 13) return 'child';
  if (age < 18) return 'teen';
  const kidAtHome = has(id.family, /儿子|女儿|孩子|son|daughter|kid|child/i) && age < 55;
  switch (r?.work_group) {
    case 'retired': return 'senior';
    case 'student': return 'student';
    case 'school_kid': return age < 13 ? 'child' : 'teen';
    case 'home': return 'homemaker';
    case 'none': return age >= 60 ? 'senior' : 'job_seeker';
    case 'freelance': return 'freelancer';
    case 'delivery': return 'driver';
    case 'factory': case 'outdoor': return /夜班|night/i.test(occ) ? 'night_shift' : 'factory_shift';
    case 'retail': case 'food': case 'service': return 'service_shift';
    case 'medical': return 'medical_shift';
    case 'education': return 'teacher';
    case 'office': case 'tech': return kidAtHome ? 'parent' : 'office_worker';
    default: break;
  }
  if (p.segment === 'senior' || age >= 60 || /退休|retired/i.test(occ)) return 'senior';
  if (/夜班|night/i.test(occ)) return 'night_shift';
  if (p.segment === 'student' || /大学生|研究生|student/i.test(occ)) return 'student';
  if (/自由|freelanc/i.test(occ)) return 'freelancer';
  if (kidAtHome) return 'parent';
  return 'office_worker';
}

const isWeekend = (date: string) => { const d = new Date(`${date}T12:00:00`).getDay(); return d === 0 || d === 6; };

function conditions(p: PersonaSpec, date: string): Record<string, boolean> {
  const fam = p.identity.family ?? [];
  const schoolKid = fam.some((f) => { const m = f.match(/(\d+)\s*岁/); if (m) return Number(m[1]) >= 5 && Number(m[1]) <= 13; return /小学|上学|school/i.test(f) && /儿子|女儿|孩子|son|daughter|kid/i.test(f); });
  return {
    has_household: fam.length > 0 && !fam.every((f) => /老家|hometown/i.test(f)),
    has_school_kid: schoolKid,
    has_grandkid: has(fam, /外孙|孙子|孙女|grandkid|grandchild|grandson|granddaughter/i),
    weekday_odd: Number(date.slice(-2)) % 2 === 1,
  };
}

export function workplaceKind(p: PersonaSpec): PlaceKindT {
  const occ = `${p.identity.occupation ?? ''}`;
  for (const w of agendaConfig().workplaces) if (w.words.some((k) => occ.toLowerCase().includes(k.toLowerCase()))) return w.place as PlaceKindT;
  return 'office';
}

export function commuteKind(p: PersonaSpec): PlaceKindT {
  const inc = `${p.identity.income_band ?? ''}`;
  const rich = /([3-9]|\d{2})\s*万|\$\s*\d{3}k|high/i.test(inc);
  return rich || (p.identity.age ?? 30) > 45 ? 'road' : 'subway';
}

/** 给人物分配住宅单元（哈希 + 线性探测，避开已占用的单元） */
export function assignHome(layout: TownLayout, personaId: string, taken: Set<number>): { place_id: string; unit: number } {
  const n = layout.homes.length;
  let i = hashNum(personaId) % n;
  for (let k = 0; k < n && taken.has(i); k++) i = (i + 1) % n;
  return { place_id: layout.homes[i].place_id, unit: i };
}

export function skeletonAgenda(layout: TownLayout, p: PersonaSpec, date: string, home: { place_id: string; unit: number }, r?: ResidentHint): Agenda {
  const base = inferRole(p, r); const c = agendaConfig();
  const role = isWeekend(date) && c.weekend_roles.includes(base) ? (c.roles[`${base}_weekend`] ? `${base}_weekend` : 'weekend') : base;
  const rules = c.roles[role] ?? c.roles.office_worker;
  const cond = conditions(p, date);
  const lang = p.locale === 'en-US' ? 'en' : 'zh';
  const items: AgendaItem[] = [];
  for (const rule of rules) {
    if (rule.if && !cond[rule.if]) continue;
    let kind: PlaceKindT; let place_id: string | undefined;
    if (rule.place === 'home') kind = 'home';
    else if (rule.place === 'work') {
      const wp = r?.workplace_id ? layout.places.find((x) => x.id === r.workplace_id) : undefined;
      if (wp) { kind = wp.kind; place_id = wp.id; }
      else if (r && !r.workplace_id && ['home', 'freelance'].includes(r.work_group ?? '')) kind = 'home';
      else if (r?.workplace_id === 'street') { kind = 'street'; place_id = 'street'; }
      else kind = workplaceKind(p);
    } else if (rule.place === 'commute') kind = commuteKind(p);
    else kind = rule.place as PlaceKindT;
    place_id ??= kind === 'home' ? home.place_id : placeForKind(layout, kind, `${p.id}:${rule.from}`);
    items.push({ from: rule.from, to: rule.to, place_id, place_kind: kind, activity: rule.act[lang], kind: rule.k });
  }
  // 被跳过的条件段会留下时间空洞：把空洞并入前一段
  for (let i = 1; i < items.length; i++) if (items[i].from !== items[i - 1].to) items[i - 1].to = items[i].from;
  return { persona_id: p.id, sim_date: date, home_place_id: home.place_id, home_unit: home.unit, role, items, source: 'skeleton' };
}

const Completion = z.object({ items: z.array(z.object({ i: z.number().int(), activity: z.string(), intent: z.string(), with: z.string().optional() })) });

/** mind.slow 补全：只改写活动描述、补意图与同行人，不改地点和时间 */
export async function completeAgenda(p: PersonaSpec, a: Agenda): Promise<Agenda> {
  const en = p.locale === 'en-US';
  const id = p.identity;
  const who = en
    ? `${id.name}, ${id.age}, ${id.gender}, ${id.occupation}, lives in ${id.region}. Family: ${(id.family ?? []).join(', ') || 'none'}. Story: ${id.life_story ?? ''}`
    : `${id.name}，${id.age} 岁，${id.gender}，${id.occupation}，住在${id.region}。家人：${(id.family ?? []).join('、') || '无'}。经历：${id.life_story ?? ''}`;
  const lines = a.items.map((it, i) => `${i}. ${it.from}-${it.to} @${it.place_kind}: ${it.activity}`).join('\n');
  const sys = en
    ? 'You plan one ordinary day for a real person. Keep every time slot and place exactly; rewrite each activity as a short concrete phrase (≤ 12 words) and add an intent: what they are thinking about / planning next, linking consecutive slots causally (e.g. "has to leave by 5 to pick up her son"). Mention people from their family when natural. Never mention software testing, products under test, or evaluation.'
    : '你在为一个普通人安排平常的一天。严格保持每个时间段和地点不变；把每段活动改写成具体的短语（不超过 16 字），再补一句意图：他此刻惦记着什么、接下来打算干什么，并让相邻时间段有前因后果（例如「五点前得走，要去接儿子」）。自然地提到家人。不要提及测试、被测产品或评估。';
  try {
    const r = await gateway().chat('world_sim', {
      messages: [{ role: 'system', content: sys }, { role: 'user', content: `${who}\n${en ? 'Date' : '日期'}：${a.sim_date}\n${lines}` }],
      schema: Completion, schemaName: 'agenda', temperature: 0.8, retries: 1, tags: { purpose: 'jobsworld_agenda' },
    });
    const items = a.items.map((it, i) => { const c = r.data.items.find((x) => x.i === i); return c ? { ...it, activity: c.activity.slice(0, 40), intent: c.intent.slice(0, 120), with: c.with?.slice(0, 30) } : it; });
    return { ...a, items, source: 'llm' };
  } catch (e) {
    logger.warn({ persona: p.id, err: String((e as Error).message).slice(0, 160) }, '日程补全失败，保留骨架');
    return a;
  }
}

export async function loadAgenda(personaId: string, date: string): Promise<Agenda | undefined> {
  const [row] = await getDb().select().from(personaAgendas).where(and(eq(personaAgendas.persona_id, personaId), eq(personaAgendas.sim_date, date)));
  return row ? { ...row, source: row.source as Agenda['source'] } : undefined;
}

export async function saveAgenda(a: Agenda) {
  await getDb().insert(personaAgendas).values(a).onConflictDoUpdate({ target: [personaAgendas.persona_id, personaAgendas.sim_date], set: { items: a.items, source: a.source, role: a.role, home_place_id: a.home_place_id, home_unit: a.home_unit } });
}

/** 已有的住宅分配（跨天保持同一个家） */
export async function knownHomes(): Promise<Map<string, { place_id: string; unit: number }>> {
  const rows = await getDb().select({ persona_id: personaAgendas.persona_id, place_id: personaAgendas.home_place_id, unit: personaAgendas.home_unit }).from(personaAgendas);
  const m = new Map<string, { place_id: string; unit: number }>();
  for (const r of rows) m.set(r.persona_id, { place_id: r.place_id, unit: r.unit });
  return m;
}

export const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + (m || 0); };
export const toClock = (min: number) => { const m = ((Math.floor(min) % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

/** 当前时刻所在的日程段，以及前后各一段 */
export function agendaAt(a: Agenda, minute: number): { idx: number; current?: AgendaItem; prev?: AgendaItem; next?: AgendaItem } {
  const idx = a.items.findIndex((it) => minute >= toMin(it.from) && minute < toMin(it.to === '24:00' ? '24:00' : it.to));
  const i = idx < 0 ? a.items.length - 1 : idx;
  return { idx: i, current: a.items[i], prev: a.items[i - 1], next: a.items[i + 1] };
}
