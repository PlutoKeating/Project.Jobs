// 合并世界：一个人此时此地在城里的状态，就是他使用产品时的处境。
// 这里把「时钟 + 日程 + 需求 + 身边的人 + 城里正在发生的事」算成一份处境，并写成引擎能直接运行的世界模板
// （起始地点、手眼耳嘴的占用、还有多少时间、网络、接下来会发生的事）。世界服务和引擎用的是同一套计算。
import { WorldTemplateSchema, type PersonaSpec, type WorldTemplate } from '@pux/core';
import { and, eq, getDb, gte, lte, personas, residents, worldEvents, worldKv, type NeedsRow } from '@pux/db';
import { agendaAt, loadAgenda, saveAgenda, skeletonAgenda, toClock, toMin, type Agenda, type AgendaItem } from './agenda.ts';
import { absMinute, actKindOf, EVENT_EFFECT, initialNeeds, OUTDOOR, phoneAffinity, placeContext, tickNeeds, type ActKind, type PlaceContext } from './life.ts';
import type { ClockMsg } from './protocol.ts';
import { allHouseholds, tiesOf, type ResidentRow, type Tie } from './residents.ts';
import { computeLayout, hashNum, loadTown, type TownLayout } from './town.ts';

const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** 世界时钟：世界服务在跑就用它写下的时钟；没在跑（或 1:1 且未暂停）就与现实对齐 */
export async function worldClock(): Promise<{ date: string; minute: number; speed: number; paused: boolean; live: boolean }> {
  const now = new Date(); const real = { date: localDate(now), minute: now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60 };
  const [row] = await getDb().select().from(worldKv).where(eq(worldKv.key, 'clock'));
  const c = row?.value as ClockMsg | undefined;
  const fresh = !!row?.updated_at && Date.now() - row.updated_at.getTime() < 60_000;
  if (!c || (c.speed === 1 && !c.paused) || !fresh) return { ...real, speed: 1, paused: false, live: fresh };
  return { date: c.date, minute: c.minute, speed: c.speed, paused: c.paused, live: true };
}
export async function saveWorldClock(c: ClockMsg) {
  await getDb().insert(worldKv).values({ key: 'clock', value: c }).onConflictDoUpdate({ target: worldKv.key, set: { value: c, updated_at: new Date() } });
}

let layoutCache: TownLayout | undefined;
const layout = () => (layoutCache ??= computeLayout(loadTown()));

/** 某人某天的日程：有就读，没有就按规则生成骨架并保存（世界服务与引擎共用） */
export async function agendaFor(p: PersonaSpec, date: string, r?: ResidentRow, home?: { place_id: string; unit: number }): Promise<Agenda> {
  const have = await loadAgenda(p.id, date);
  if (have) return have;
  let h = home;
  if (!h && r) { const hh = (await allHouseholds()).get(r.household_id); if (hh?.home_place_id && hh.home_unit !== null) h = { place_id: hh.home_place_id, unit: hh.home_unit }; }
  h ??= (() => { const L = layout(); const u = L.homes[hashNum(p.id) % L.homes.length]; return { place_id: u.place_id, unit: u.unit }; })();
  const a = skeletonAgenda(layout(), p, date, h, r ? { work_group: r.work_group, workplace_id: r.workplace_id, role: r.role } : undefined);
  await saveAgenda(a);
  return a;
}

/** 把需求从上次结算的时刻按日程推进到现在（纯计算）。太久没结算（超过一天半）就从今天零点的平常状态算起 */
export function needsAt(p: PersonaSpec, stored: NeedsRow | null | undefined, agenda: Agenda, date: string, minute: number, companionsAt: (it: AgendaItem) => number): NeedsRow {
  const now = absMinute(date, minute); const dayStart = absMinute(date, 0);
  let n = stored && now - stored.at >= 0 && now - stored.at <= 36 * 60 ? { ...stored } : { ...initialNeeds(p, dayStart), energy: 0.35 };
  if (n.at < dayStart) n = tickNeeds(n, dayStart - n.at, 'sleep', p, { companions: 0 });      // 跨夜的部分按睡觉算
  for (const it of agenda.items) {
    const from = dayStart + toMin(it.from); const to = dayStart + toMin(it.to);
    const a = Math.max(from, n.at); const b = Math.min(to, now);
    if (b > a) n = tickNeeds({ ...n, at: a }, b - a, actKindOf(it), p, { companions: companionsAt(it), placeKind: it.place_kind });
  }
  return { ...n, at: now };
}

export interface LiveContext {
  persona_id: string; date: string; minute: number; clock: string;
  place_id: string; place_kind: string; place_name: { zh: string; en: string };
  activity: string; act_kind: ActKind; prev?: AgendaItem; next?: AgendaItem;
  needs: NeedsRow; wallet: number; currency: string; life_event?: string | null;
  companions: Tie[]; ties: Tie[];
  ctx: PlaceContext; phone_affinity: number; time_left_min: number; battery_pct: number;
  events: { kind: string; text: string }[];
  scenario: string; name: string; available: boolean; unavailable_reason?: string;
  template: WorldTemplate;
}

const BINDING: ActKind[] = ['work', 'study', 'commute', 'care', 'sleep'];
const feel = (n: NeedsRow, zh: boolean) => [n.hunger > 0.7 ? (zh ? '很饿' : 'very hungry') : n.hunger > 0.5 ? (zh ? '有点饿' : 'a bit hungry') : '', n.energy < 0.25 ? (zh ? '很累' : 'exhausted') : n.energy < 0.45 ? (zh ? '有点累' : 'a bit tired') : '', n.social < 0.2 ? (zh ? '好久没跟人好好说话了' : "haven't really talked to anyone in a while") : '', n.stress > 0.7 ? (zh ? '压力很大' : 'under a lot of stress') : '', n.mood < -0.3 ? (zh ? '心情不好' : 'in a low mood') : n.mood > 0.4 ? (zh ? '心情不错' : 'in a good mood') : ''].filter(Boolean);

/**
 * 这个人此时此地的处境。at 不传时用世界时钟。
 * available=false 表示他现在根本没法用手机或电脑（睡着了、在开车、是个在上课的孩子……）。
 */
export async function liveContextFor(personaId: string, at?: { date: string; minute: number }): Promise<LiveContext | undefined> {
  const db = getDb();
  const [row] = await db.select().from(personas).where(and(eq(personas.id, personaId), eq(personas.active, true)));
  if (!row) return undefined;
  const p = row.spec as PersonaSpec; const zh = p.locale === 'zh-CN';
  const [r] = await db.select().from(residents).where(eq(residents.persona_id, personaId));
  const clk = at ?? await worldClock();
  const date = clk.date; const minute = clk.minute;
  const agenda = await agendaFor(p, date, r);
  const pos = agendaAt(agenda, minute); const cur = pos.current!;
  const kind = actKindOf(cur);
  const L = layout();
  const place = L.places.find((x) => x.id === cur.place_id);
  const placeName = place?.name ?? (cur.place_kind === 'street' || cur.place_kind === 'road' ? { zh: '路上', en: 'the street' } : { zh: '家里', en: 'home' });
  // 身边的人：此刻和他在同一个地点的家人、同事、朋友
  const ties = r ? await tiesOf(personaId) : [];
  const companions: Tie[] = [];
  for (const t of ties.filter((x) => x.strength >= 0.3).slice(0, 8)) {
    const [tp] = await db.select().from(personas).where(and(eq(personas.id, t.id), eq(personas.active, true)));
    if (!tp) continue;
    const [tr] = await db.select().from(residents).where(eq(residents.persona_id, t.id));
    const ta = await agendaFor(tp.spec as PersonaSpec, date, tr);
    const tc = agendaAt(ta, minute).current;
    if (tc && tc.place_id === cur.place_id && (cur.place_kind !== 'home' || ta.home_unit === agenda.home_unit) && actKindOf(tc) !== 'sleep') companions.push(t);
  }
  const needs = needsAt(p, r?.needs, agenda, date, minute, (it) => (it === cur ? companions.length : it.place_kind === 'home' && (r?.role !== 'head' || ties.some((t) => ['spouse', 'parent_child', 'roommate'].includes(t.kind))) ? 1 : 0));
  const driving = cur.place_kind === 'road' && p.identity.age > 45 && hashNum(`${personaId}:${date}`) % 3 !== 0;     // 自己开车的人
  const ctx = placeContext(kind, driving ? 'road' : cur.place_kind, p, { hashSeed: hashNum(`${personaId}:${date}:${cur.from}`), staff: !!r?.workplace_id && r.workplace_id === cur.place_id && ['retail', 'food', 'service'].includes(r.work_group) });
  if (driving) ctx.channels = { hands: 'none', eyes: 'none', ears: 'busy', mouth: 'free' };
  const affinity = phoneAffinity(kind, cur.place_kind, p, driving);
  // 还能用多久：到下一件不能耽误的事（上班、上课、赶路、接孩子、睡觉）为止
  let end = toMin(cur.to); let i = pos.idx + 1;
  while (i < agenda.items.length && !BINDING.includes(actKindOf(agenda.items[i])) && end - minute < 180) { end = toMin(agenda.items[i].to); i++; }
  const binding = BINDING.includes(kind);
  const time_left = Math.max(3, Math.min(180, Math.round((binding ? Math.min(toMin(cur.to) - minute, kind === 'commute' ? 40 : 12) : end - minute))));
  const nextBinding = agenda.items.slice(pos.idx + 1).find((it) => BINDING.includes(actKindOf(it)));
  // 手机电量：早上满电，白天一路掉；在家或工位上能充
  const wake = agenda.items.find((it) => actKindOf(it) !== 'sleep'); const awakeH = Math.max(0, (minute - toMin(wake?.from ?? '07:00')) / 60);
  let battery = Math.round(100 - awakeH * 5.5 - (hashNum(`${personaId}:${date}`) % 18));
  if (['home', 'office'].includes(cur.place_kind)) battery = Math.max(battery, 42 + (hashNum(personaId) % 40));
  battery = Math.max(6, Math.min(100, battery));
  // 城里正在这个地点发生的事
  const abs = absMinute(date, minute);
  const evRows = await db.select().from(worldEvents).where(and(lte(worldEvents.from_min, abs + time_left), gte(worldEvents.until_min, abs)));
  const here = evRows.filter((e) => (e.place_id === cur.place_id || (e.place_id === 'street' && OUTDOOR.includes(cur.place_kind))) && EVENT_EFFECT[e.kind] && (!EVENT_EFFECT[e.kind].outdoorOnly || OUTDOOR.includes(cur.place_kind)));

  const asleep = kind === 'sleep';
  const unavailable = asleep ? (zh ? '在睡觉' : 'asleep') : driving ? (zh ? '在开车' : 'driving') : affinity < 0.05 ? (zh ? '现在没空看手机' : 'no chance to look at a phone right now') : undefined;
  const moods = feel(needs, zh);
  const who = companions.slice(0, 3).map((c) => c.name);
  const situation = (lang: 'zh' | 'en') => {
    const z = lang === 'zh';
    const parts = z
      ? [`现在是 ${toClock(minute)}，你${ctx.posture.zh}（${placeName.zh}）。`, `你正在：${cur.activity}${cur.intent ? `——${cur.intent}` : ''}。`, pos.prev ? `刚才：${pos.prev.activity}。` : '', nextBinding ? `${nextBinding.from} 还要${nextBinding.activity}。` : pos.next ? `接下来打算：${pos.next.activity}。` : '', who.length ? `${who.join('、')}也在旁边。` : '', feel(needs, true).length ? `你${feel(needs, true).join('，')}。` : '', r?.life_event ? `近况：${r.life_event}。` : '']
      : [`It's ${toClock(minute)}. You are ${ctx.posture.en} (${placeName.en}).`, `Right now: ${cur.activity}${cur.intent ? ` — ${cur.intent}` : ''}.`, pos.prev ? `Just before: ${pos.prev.activity}.` : '', nextBinding ? `At ${nextBinding.from} you still have: ${nextBinding.activity}.` : pos.next ? `Next up: ${pos.next.activity}.` : '', who.length ? `${who.join(', ')} ${who.length > 1 ? 'are' : 'is'} with you.` : '', feel(needs, false).length ? `You are ${feel(needs, false).join(', ')}.` : '', r?.life_event ? `Lately: ${r.life_event}.` : ''];
    return parts.filter(Boolean).join(z ? '' : ' ');
  };
  void moods;
  // 接下来会发生的事（时间线）与可能发生的事（概率规则）
  const timeline: WorldTemplate['timeline'] = [];
  for (const e of here) {
    const ef = EVENT_EFFECT[e.kind]; const startMin = Math.max(minute, minute + (e.from_min - abs));
    timeline.push({ at: toClock(startMin), type: `city_${e.kind}`, text: zh ? ef.text.zh : ef.text.en, perceived: true, effects: { ...(ef.network ? { network: ef.network, constraints_add: ['weak_network'] } : {}), ...(ef.interrupt ? { interrupt: ef.interrupt } : {}), state: { stress: ef.stress, attention: ef.attention } } } as never);
  }
  if (nextBinding && toMin(nextBinding.from) - minute <= time_left + 1 && toMin(nextBinding.from) - minute > 4) timeline.push({ at: toClock(toMin(nextBinding.from) - 4), type: 'next_up_soon', text: zh ? `快到点了，${nextBinding.activity}。` : `Almost time: ${nextBinding.activity}.`, perceived: true, effects: { state: { stress: 0.08 } } } as never);
  const rules: WorldTemplate['event_rules'] = [];
  const rule = (id: string, text: string, prob: number, effects: Record<string, unknown>, when = 'true') => rules.push({ id, type: id, text, when, prob_per_min: prob, once: true, source: 'social', effects } as never);
  const kid = companions.find((c) => c.age < 11); const partner = ties.find((t) => t.kind === 'spouse'); const friend = ties.find((t) => t.kind === 'friend'); const colleague = companions.find((c) => c.kind === 'colleague');
  if (kid) rule('kid_wants_you', zh ? `${kid.name}跑过来拉你，要你陪。` : `${kid.name} runs over and tugs at you to come play.`, 0.05, { interrupt: { kind: 'switch_away', minutes: 2 }, state: { attention: -0.15 } });
  if (colleague && kind === 'work') rule('colleague_asks', zh ? `${colleague.name}过来问你一件工作上的事。` : `${colleague.name} comes over with a work question.`, 0.03, { interrupt: { kind: 'switch_away', minutes: 3 }, state: { stress: 0.05 } });
  if (partner && !companions.includes(partner)) rule('partner_message', zh ? `${partner.name}发来消息：「晚上想吃什么？」` : `${partner.name} texts: "What do you want for dinner?"`, 0.015, { social_request: { from: partner.name, text: zh ? '晚上想吃什么？' : 'What do you want for dinner?', urgency: 0.4 } });
  if (friend) rule('friend_message', zh ? `${friend.name}在群里@了你。` : `${friend.name} tagged you in the group chat.`, 0.01, { state: { attention: -0.1 } });
  if (cur.place_kind === 'subway') rule('train_jolt', zh ? '车厢猛地晃了一下，你差点没站稳。' : 'The train jolts and you almost lose your footing.', 0.06, { state: { stress: 0.04 } }, "motion == 'vehicle'");
  if (kind === 'meal' && cur.place_kind !== 'home') rule('food_arrives', zh ? '你点的东西上来了。' : 'Your food arrives.', 0.08, { interrupt: { kind: 'switch_away', minutes: 1 } });

  const scenario = kind === 'commute' ? 'commute' : cur.place_kind === 'home' ? (kind === 'phone' ? 'home_phone_time' : kind === 'care' ? 'home_with_kids' : 'home') : kind === 'work' || kind === 'study' ? `${kind}_${cur.place_kind}` : kind === 'meal' ? 'meal_out' : cur.place_kind;
  const name = zh ? `${cur.activity}·${placeName.zh}` : `${cur.activity} · ${placeName.en}`;
  const template = WorldTemplateSchema.parse({
    id: 'live', name, name_en: name, scenario_class: scenario, device: ctx.device, modes: ['goal', 'curiosity', 'stress', 'adversarial'], start_clock: toClock(minute),
    init: { place: zh ? ctx.posture.zh : ctx.posture.en, motion: ctx.motion, channels: ctx.channels, time_band: toClock(minute) },
    resources: { time_left_min: time_left, battery_pct: battery, money: Math.round(r?.wallet ?? 300), attention: Math.max(0.15, Math.min(1, 0.45 + needs.energy * 0.5 - needs.stress * 0.25 - (needs.hunger > 0.75 ? 0.1 : 0))), network: ctx.network },
    constraints: [...ctx.constraints, ...(binding || time_left < 20 ? ['deadline'] : [])],
    timeline, event_rules: rules, social: [], situation: situation('zh'), situation_en: situation('en'), llm_events: false, matrix: false,
  });
  return {
    persona_id: personaId, date, minute, clock: toClock(minute), place_id: cur.place_id, place_kind: cur.place_kind, place_name: placeName, activity: cur.activity, act_kind: kind, prev: pos.prev, next: pos.next,
    needs, wallet: r?.wallet ?? 0, currency: r?.currency ?? (zh ? 'CNY' : 'USD'), life_event: r?.life_event, companions, ties, ctx, phone_affinity: affinity, time_left_min: time_left, battery_pct: battery,
    events: here.map((e) => ({ kind: e.kind, text: zh ? EVENT_EFFECT[e.kind].text.zh : EVENT_EFFECT[e.kind].text.en })), scenario, name, available: !unavailable, unavailable_reason: unavailable, template,
  };
}
