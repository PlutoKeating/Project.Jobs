// JobsWorld 世界服务：时钟、日程、位置、Session 直播与回放 → NATS
import { logger, newId, type PersonaSpec } from '@pux/core';
import { closeDb, getDb, worldEvents, type NeedsRow } from '@pux/db';
import {
  absMinute, actKindOf, agendaAt, agendaFor, allResidents, appearanceFor, completeAgenda, computeLayout, connectBus, decode, EVENT_EFFECT, kvPutJson, lastFinishedSession, latestPersonas,
  loadTown, needOverride, needsAt, OUTDOOR, personaMemoryList, personaSessions, phoneAffinity, placeForKind, residentOf, saveAgenda, saveNeeds, saveWorldClock, SUBJ, tickNeeds, tiesOf, toClock, toMin,
  type InviteCmd, type LaunchLive, type LaunchesMsg, type PromoteCmd, type PublishCmd, type ResidentRow,
  type Agenda, type ClockCmd, type EventCmd, type PersonaLive, type PersonaRow, type ReplayCmd, type SessionLive, type Snapshot, type WorldEvent,
} from '@pux/jobsworld';
import { modelsReady, setInstanceKind } from '@pux/llm';
import { WorldClock } from './clock.ts';
import { loadSessionSteps, SessionTracker, stepToLive } from './tracker.ts';
import { Placement, REACTIONS, shorten, toneOf } from './sim.ts';

const MAX_VISIBLE = Number(process.env.JW_MAX_VISIBLE ?? 60);
const AGENDA_LLM = process.env.JW_AGENDA_LLM !== '0';
const WALK_TILES_PER_S = 8;

const town = loadTown();
const layout = computeLayout(town);
const placement = new Placement(layout, town);
const bus = await connectBus('jobsworld-world');
const clock = new WorldClock();
await clock.restore(bus.kv);
await kvPutJson(bus.kv, 'town', layout);

let roster: PersonaRow[] = [];
const agendas = new Map<string, Agenda>();
const live = new Map<string, PersonaLive>();
const replays = new Map<string, { session: SessionLive; steps: Awaited<ReturnType<typeof loadSessionSteps>>; i: number; next: number; speed: number }>();
const events: WorldEvent[] = [];
const tracker = new SessionTracker();
const llmQueue: string[] = [];
// 世界里的人：居民信息、需求、钱包（需求由规则推进，并且真的改写日程）
const residents = new Map<string, ResidentRow>();
const needs = new Map<string, NeedsRow>();
const wallets = new Map<string, number>();
const dirty = new Set<string>();
const drivenBy = new Map<string, { reason: string; until: number }>();
const lastIdx = new Map<string, string>();
const wasInSession = new Set<string>();
const MEAL_COST = { 'zh-CN': 28, 'en-US': 14 } as const;

async function loadRoster() {
  roster = await latestPersonas();
  const res = await allResidents();
  for (const p of roster) {
    const r = res.get(p.id); if (r) residents.set(p.id, r);
    if (agendas.get(p.id)?.sim_date === clock.date) continue;
    const a = await agendaFor(p.spec, clock.date, r);
    agendas.set(p.id, a);
    if (!needs.has(p.id)) needs.set(p.id, needsAt(p.spec, r?.needs, a, clock.date, clock.minute, () => 0));
    if (!wallets.has(p.id)) wallets.set(p.id, r?.wallet ?? 300);
  }
}

/** 日程的意图补全只在需要时做（有人点开这个人，或他开始使用产品）：模型只用在决策点上，不为 200 个人每天各调一次 */
function wantAgendaDetail(id: string) {
  const a = agendas.get(id); if (!AGENDA_LLM || !a || a.source !== 'skeleton') return;
  const key = `${id}@${clock.date}`; if (!llmQueue.includes(key)) { llmQueue.push(key); void drainLlm(); }
}
let draining = false;
async function drainLlm() {
  if (draining) return; draining = true;
  try {
    for (;;) {
      const key = llmQueue.shift(); if (!key) return;
      const [id, date] = key.split('@');
      const p = roster.find((r) => r.id === id); const a = agendas.get(id);
      if (!p || !a || a.sim_date !== date || a.source !== 'skeleton') continue;
      const done = await completeAgenda(p.spec, a);
      if (done.source === 'llm' && agendas.get(id)?.sim_date === date) { const cur = agendas.get(id)!; const merged = { ...cur, source: 'llm' as const, items: cur.items.map((it) => { const d = done.items.find((x) => x.from === it.from && x.to === it.to); return d && !it.override ? { ...it, activity: d.activity, intent: d.intent, with: d.with } : it; }) }; await saveAgenda(merged); agendas.set(id, merged); logger.info({ persona: id }, '日程已补全'); }
    }
  } finally { draining = false; }
}

/** 需求临时改写日程：从现在起插入一段（饿了去吃、困了早睡、闷了找人聊），后面的安排顺延截断 */
function applyOverride(a: Agenda, minute: number, ov: NonNullable<ReturnType<typeof needOverride>>, spec: PersonaSpec): Agenda {
  const start = Math.floor(minute); const end = Math.min(1440, start + ov.minutes);
  const cur = agendaAt(a, minute).current!;
  const kind = ov.place_kind === 'here' ? cur.place_kind : ov.place_kind;
  const place_id = ov.place_kind === 'here' ? cur.place_id : kind === 'home' ? a.home_place_id : placeForKind(layout, kind as never, `${a.persona_id}:${start}`);
  const items: Agenda['items'] = [];
  for (const it of a.items) {
    const f = toMin(it.from); const t = toMin(it.to);
    if (t <= start || f >= end) { items.push(it); continue; }
    if (f < start) items.push({ ...it, to: toClock(start) });
    if (t > end) items.push({ ...it, from: toClock(end) });
  }
  items.push({ from: toClock(start), to: end >= 1440 ? '24:00' : toClock(end), place_id, place_kind: kind, activity: spec.locale === 'en-US' ? ov.activity.en : ov.activity.zh, kind: ov.kind, override: ov.reason });
  items.sort((x, y) => toMin(x.from) - toMin(y.from));
  return { ...a, items };
}

function newDay(date: string) {
  const dom = Number(date.slice(8, 10));
  for (const p of roster) {
    const r = residents.get(p.id); if (!r) continue;
    let w = wallets.get(p.id) ?? 0;
    w -= (r.income_month * 0.55) / 30;                                      // 房租水电等日常开销
    if (r.currency === 'CNY' ? dom === 10 : dom === 1 || dom === 15) w += r.currency === 'CNY' ? r.income_month : r.income_month / 2;   // 发工资
    wallets.set(p.id, Math.round(Math.max(0, w))); dirty.add(p.id);
  }
}

clock.onNewDay = (date) => { newDay(date); void loadRoster(); };

function say(p: PersonaLive, text: string, tone: NonNullable<PersonaLive['say']>['tone']) {
  p.say = { text, tone, at: Date.now() };
  bus.publish(SUBJ.say(p.id), { persona_id: p.id, name: p.name, text, tone, ts: Date.now() });
}

function onStep(personaId: string, s: SessionLive) {
  const p = live.get(personaId);
  bus.publish(SUBJ.live(personaId), { persona_id: personaId, session: s, ts: Date.now() });
  if (p) { p.session = s; if (s.monologue) say(p, shorten(s.monologue), toneOf(s)); }
}

function step() {
  clock.tick(tracker.running() > 0 ? 4 : undefined);
  const minute = clock.minute;
  const abs = absMinute(clock.date, minute);
  const byPersona = tracker.byPersona();
  const now = Date.now();
  // 上一拍每个地点里有谁（用来算「身边有没有人」）
  const crowd = new Map<string, number>();
  for (const p of live.values()) { const k = p.place_kind === 'home' ? `home:${agendas.get(p.id)?.home_unit}` : p.place_id; crowd.set(k, (crowd.get(k) ?? 0) + 1); }
  for (const r of roster) {
    let a = agendas.get(r.id); if (!a) continue;
    const prev = live.get(r.id);
    const tracked = byPersona.get(r.id);
    const rp = replays.get(r.id);
    const sess = rp?.session ?? tracked?.live;
    const inSession = !!sess && !rp;
    // 需求推进：饿、累、孤单、压力按正在做的事变化；正在使用产品时由那次使用自己结算
    let n = needs.get(r.id);
    const cur0 = agendaAt(a, minute).current;
    if (inSession) { if (!wasInSession.has(r.id)) { wasInSession.add(r.id); wantAgendaDetail(r.id); } }
    else if (wasInSession.has(r.id)) { wasInSession.delete(r.id); void residentOf(r.id).then((x) => { if (x?.needs) needs.set(r.id, { ...x.needs, at: Math.max(x.needs.at, absMinute(clock.date, clock.minute)) }); }); }
    else if (n && cur0 && abs - n.at >= 1) {
      const key = cur0.place_kind === 'home' ? `home:${a.home_unit}` : cur0.place_id;
      const kind = actKindOf(cur0);
      n = tickNeeds(n, Math.min(abs - n.at, 180), kind, r.spec, { companions: Math.max(0, (crowd.get(key) ?? 1) - 1), placeKind: cur0.place_kind });
      n.at = abs; needs.set(r.id, n); dirty.add(r.id);
      // 进入一段新的安排：在外面吃饭要花钱
      const idxKey = `${clock.date}:${cur0.from}`;
      if (lastIdx.get(r.id) !== idxKey) { lastIdx.set(r.id, idxKey); if (kind === 'meal' && !cur0.override) wallets.set(r.id, Math.max(0, (wallets.get(r.id) ?? 0) - MEAL_COST[r.spec.locale] * (cur0.place_kind === 'home' ? 0.3 : 1))); }
      // 需求驱动的行为
      const d = drivenBy.get(r.id);
      if (!d || d.until <= abs) {
        if (d) drivenBy.delete(r.id);
        const nextMeal = a.items.find((it) => actKindOf(it) === 'meal' && toMin(it.from) > minute);
        const res = residents.get(r.id); const w = wallets.get(r.id) ?? 0; const cost = MEAL_COST[r.spec.locale];
        const ov = needOverride(n, { kind, place_kind: cur0.place_kind, minuteOfDay: minute, minutesToNextMeal: nextMeal ? toMin(nextMeal.from) - minute : 999 }, { wallet: w, mealCost: cost, tight: !!res && w < res.income_month * 0.05 });
        if (ov) {
          a = applyOverride(a, minute, ov, r.spec); agendas.set(r.id, a); void saveAgenda(a);
          drivenBy.set(r.id, { reason: ov.reason, until: abs + Math.min(ov.minutes, 240) });
          if (ov.cost) wallets.set(r.id, Math.max(0, w - ov.cost));
          if (prev) say(prev, r.spec.locale === 'en-US' ? ov.activity.en : ov.activity.zh, ov.reason === 'lonely' ? 'neutral' : 'confused');
        }
      }
    }
    const tgt = sess ? (tracked?.place_id && !rp ? placement.forPlace(r.spec, a, tracked.place_id, tracked.place_kind ?? 'home', sess.id) : placement.forSession(r.spec, a, sess)) : placement.forAgenda(r.spec, a, minute);
    const at = agendaAt(a, minute);
    // 平滑移动：同一楼层沿 x 走过去；跨楼层/地下直接到位
    let x = tgt.x; let facing: 1 | -1 = prev?.facing ?? 1;
    if (prev && prev.y === tgt.y && prev.place_id === tgt.place_id && Math.abs(prev.x - tgt.x) > WALK_TILES_PER_S) { const d = Math.sign(tgt.x - prev.x); x = prev.x + d * WALK_TILES_PER_S; facing = d > 0 ? 1 : -1; }
    else if (prev && tgt.x !== prev.x) facing = tgt.x > prev.x ? 1 : -1;
    const id = r.spec.identity; const nn = needs.get(r.id);
    const pl: PersonaLive = {
      id: r.id, name: id.name, locale: r.spec.locale, segment: r.segment, kind: r.kind, target_user: r.target_user,
      occupation: id.occupation, age: id.age, gender: id.gender,
      x, y: tgt.y, floor: tgt.floor, facing, pose: x !== tgt.x ? 'walk' : tgt.pose,
      place_id: tgt.place_id, place_kind: tgt.place_kind, mode: tgt.mode,
      activity: at.current?.activity ?? '', intent: at.current?.intent,
      prev: at.prev ? { from: at.prev.from, to: at.prev.to, activity: at.prev.activity, place_id: at.prev.place_id } : undefined,
      next: at.next ? { from: at.next.from, to: at.next.to, activity: at.next.activity, place_id: at.next.place_id, intent: at.next.intent } : undefined,
      session: sess, say: prev?.say && now - prev.say.at < 12_000 ? prev.say : undefined,
      appearance: prev?.appearance ?? appearanceFor(r.spec), visible: true,
      needs: nn ? { hunger: r3(nn.hunger), energy: r3(nn.energy), social: r3(nn.social), stress: r3(nn.stress), mood: r3(nn.mood) } : undefined,
      wallet: wallets.get(r.id), currency: residents.get(r.id)?.currency, household_id: residents.get(r.id)?.household_id,
      phone: at.current ? r3(phoneAffinity(actKindOf(at.current), at.current.place_kind, r.spec)) : 0,
      driven_by: at.current?.override,
    };
    // 城里的事件：地点里的人做出反应并受到影响（每个事件每人一次）
    for (const e of events) if ((e.place_id === pl.place_id || (e.place_id === 'street' && OUTDOOR.includes(pl.place_kind))) && !reacted.has(`${e.id}:${r.id}`)) {
      reacted.add(`${e.id}:${r.id}`);
      const ef = EVENT_EFFECT[e.kind]; const cn = needs.get(r.id);
      if (ef && cn && !inSession) { needs.set(r.id, { ...cn, stress: Math.min(1, cn.stress + ef.stress) }); dirty.add(r.id); }
      const lines = REACTIONS[e.kind]?.[r.spec.locale === 'en-US' ? 'en' : 'zh'] ?? [];
      if (lines.length) { pl.say = { text: lines[(r.id.length + e.id.length) % lines.length], tone: 'confused', at: now }; bus.publish(SUBJ.say(r.id), { persona_id: r.id, name: pl.name, text: pl.say.text, tone: 'confused', ts: now }); }
    }
    live.set(r.id, pl);
  }
  // 同屏上限：正在使用软件的人优先
  const all = [...live.values()].sort((a, b) => Number(!!b.session) - Number(!!a.session));
  all.forEach((p, i) => { p.visible = i < MAX_VISIBLE; });
  for (let i = events.length - 1; i >= 0; i--) if (events[i].date !== clock.date || events[i].until < minute) events.splice(i, 1);
  // 回放推进
  for (const [pid, rp] of replays) {
    if (now < rp.next) continue;
    const rows = rp.steps!.steps;
    if (rp.i >= rows.length) { replays.delete(pid); continue; }
    const row = rows[rp.i++];
    rp.next = now + 2500 / rp.speed;
    void stepToLive({ id: rp.steps!.session.id, study_id: rp.steps!.session.study_id, status: 'replay', world_place: rp.steps!.world_place }, row, rows.length, true).then((s) => { rp.session = s; onStep(pid, s); });
  }
  const snap: Snapshot = { clock: clock.msg(), personas: [...live.values()], events: [...events], town_version: layout.version, ts: now };
  bus.publish(SUBJ.snapshot, snap);
  bus.publish(SUBJ.clock, snap.clock);
  if (now - lastKv > 5000) { lastKv = now; void kvPutJson(bus.kv, 'snapshot', snap); void kvPutJson(bus.kv, 'clock', snap.clock); void saveWorldClock(snap.clock).catch(() => {}); }
  // 需求与钱包每半分钟落一次库（引擎算处境时从这里接着算）
  if (now - lastPersist > 30_000) { lastPersist = now; const ids = [...dirty]; dirty.clear(); void (async () => { for (const id of ids) { const n = needs.get(id); if (n) await saveNeeds(id, n, wallets.get(id)).catch(() => {}); } })(); }
}
const r3 = (v: number) => Math.round(v * 1000) / 1000;
let lastPersist = 0;
const reacted = new Set<string>();
let lastKv = 0;

async function pollSessions() {
  try {
    for (const { sess, step: s } of await tracker.poll()) {
      const l = await stepToLive(sess, s);
      sess.live = l;
      if (!replays.has(sess.persona_id)) onStep(sess.persona_id, l);
    }
  } catch (e) { logger.warn({ err: String((e as Error).message).slice(0, 200) }, 'Session 跟踪失败'); }
}

// ---- 命令与请求/应答 ----
const sub = (subject: string, fn: (data: unknown, reply?: string) => Promise<unknown> | unknown) => {
  void (async () => {
    for await (const m of bus.nc.subscribe(subject)) {
      try {
        const data = m.data?.length ? decode<unknown>(m.data) : {};
        const out = await fn(data, m.reply);
        if (m.reply) m.respond(new TextEncoder().encode(JSON.stringify(out ?? { ok: true })));
      } catch (e) { if (m.reply) m.respond(new TextEncoder().encode(JSON.stringify({ error: String((e as Error).message) }))); }
    }
  })();
};

sub(SUBJ.town, () => layout);
sub(SUBJ.cmdClock, (d) => { clock.set(d as ClockCmd); return clock.msg(); });
sub(SUBJ.cmdEvent, (d) => {
  const c = d as EventCmd;
  if (!layout.places.some((p) => p.id === c.place_id) && c.place_id !== 'street') throw new Error('未知地点');
  const e: WorldEvent = { id: newId('wev'), place_id: c.place_id, kind: c.kind, until: clock.minute + (c.minutes ?? 20), date: clock.date, by: c.by };
  events.push(e);
  // 落库：合并世界后，正在这个地点使用产品的人会真的受到影响（断网、被打断、分心）
  const from = absMinute(clock.date, clock.minute);
  void getDb().insert(worldEvents).values({ id: e.id, place_id: e.place_id, kind: e.kind, from_min: from, until_min: from + (c.minutes ?? 20), by: c.by }).catch(() => {});
  return e;
});
sub(SUBJ.cmdReplay, async (d) => {
  const c = d as ReplayCmd;
  const s = await loadSessionSteps(c.session_id);
  if (!s || !s.steps.length) throw new Error('Session 不存在或没有步骤');
  replays.set(s.session.persona_id, { session: await stepToLive({ id: s.session.id, study_id: s.session.study_id, status: 'replay', world_place: s.world_place }, s.steps[0], s.steps.length, true), steps: s, i: 0, next: 0, speed: c.speed ?? 1 });
  return { persona_id: s.session.persona_id, steps: s.steps.length };
});
sub(SUBJ.detail, async (d) => {
  const id = (d as { persona_id: string }).persona_id;
  const p = live.get(id);
  wantAgendaDetail(id);
  return { live: p, agenda: agendas.get(id), ties: (await tiesOf(id)).slice(0, 12), memories: (await personaMemoryList(id, 8)).map((m) => ({ kind: m.kind, content: m.content, valence: m.valence })), sessions: (await personaSessions(id, 6)).map((s) => ({ id: s.id, app: s.app, outcome: s.outcome, steps: s.steps, ended_at: s.ended_at })) };
});
sub(SUBJ.ask, async (d) => {
  const { persona_id, question } = d as { persona_id: string; question: string };
  if (tracker.byPersona().get(persona_id)?.status === 'running') return { answer: null, busy: true };
  const sid = await lastFinishedSession(persona_id);
  if (!sid) return { answer: null, none: true };
  const { askPersona } = await import('@pux/engine');
  return { answer: await askPersona(sid, String(question).slice(0, 500)), session_id: sid };
});

setInstanceKind('world');
await loadRoster();

// ---- 发布引擎：已发布的产品出现在人们面前 → 注意到的人自己决定 → 点开的人排队使用 → 用完留下评论与口碑 ----
const RUNNER = process.env.JW_RUNNER !== '0';
const Engine = RUNNER ? await import('@pux/engine') : undefined;
// 居民邮箱：旧的编号式地址换成像真人的，域名跟着设置页里部署好的邮件域名走（幂等）
if (Engine) await Engine.assignMailAddresses().catch((e) => logger.warn({ err: String((e as Error).message).slice(0, 160) }, '居民邮箱地址更新失败'));
const engine = Engine ? new Engine.LaunchEngine({ concurrency: Number(process.env.JW_CONCURRENCY ?? 3), say: (id, text, tone) => { const p = live.get(id); if (p) say(p, shorten(text), tone); }, log: (m) => logger.info(m) }) : undefined;
/** 此刻已发布的产品与各自的漏斗人数 */
async function launchesNow(): Promise<LaunchLive[]> {
  if (!Engine) return [];
  const ls = await Engine.listLaunches();
  const out: LaunchLive[] = [];
  for (const l of ls.slice(0, 20)) { const f = await Engine.launchFunnel(l.id); out.push({ id: l.id, name: l.name, tagline: l.tagline, intensity: l.intensity, status: l.status, reached: f.reached, noticed: f.noticed, interested: f.interested, opened: f.opened, came_back: f.came_back, using_now: f.using_now, rating: f.rating, reviews: f.reviews, queued: engine?.busy.queued }); }
  return out;
}
let lastLaunchAbs = absMinute(clock.date, clock.minute);
let launchBusy = false;
let modelsWarned = false;
async function launchTick() {
  if (!engine || !Engine || launchBusy || clock.paused) return;
  // 还没接入模型时世界照常运转，只是没有人能做决定、也没有人能用产品；接入并发布后几秒内自动开始
  const m = await modelsReady().catch(() => ({ ready: false, missing: [] as string[] }));
  if (!m.ready) { if (!modelsWarned) { modelsWarned = true; logger.warn({ missing: m.missing }, '还没有接入可用的模型：发布引擎暂不运行（到网页的「模型」里接入）'); } lastLaunchAbs = absMinute(clock.date, clock.minute); return; }
  if (modelsWarned) { modelsWarned = false; logger.info('模型已就绪，发布引擎开始运行'); }
  const abs = absMinute(clock.date, clock.minute); const minutes = abs - lastLaunchAbs;
  if (minutes < 1) return;
  launchBusy = true; lastLaunchAbs = abs;
  try {
    const citizens = roster.map((r) => { const p = live.get(r.id); const a = agendas.get(r.id); const cur = a ? agendaAt(a, clock.minute).current : undefined; const n = needs.get(r.id);
      return { id: r.id, spec: r.spec, place_id: p?.place_id ?? '', place_kind: p?.place_kind ?? 'home', phone: p?.phone ?? 0, in_session: !!p?.session, asleep: !cur || actKindOf(cur) === 'sleep', attention: n ? Math.max(0.15, Math.min(1, 0.45 + n.energy * 0.5 - n.stress * 0.25)) : 0.7 }; });
    await engine.tick({ abs, date: clock.date, minutes, citizens });
    const out = await launchesNow();
    bus.publish(SUBJ.launches, { launches: out, ts: Date.now() } satisfies LaunchesMsg);
    void kvPutJson(bus.kv, 'launches', { launches: out, ts: Date.now() });
  } catch (e) { logger.warn({ err: String((e as Error).message).slice(0, 200) }, '发布引擎出错'); }
  finally { launchBusy = false; }
}
sub(SUBJ.launchesGet, async () => ({ launches: await launchesNow() }));
sub(SUBJ.cmdPublish, async (d) => {
  if (!Engine) throw new Error('runner 未启用');
  const c = d as PublishCmd; if (!c.url || !c.name || !c.tagline) throw new Error('需要网址、名字和一句话');
  const l = await Engine.publishProduct({ url: /^https?:\/\//i.test(c.url) ? c.url : `http://${c.url}`, name: c.name, tagline: c.tagline });
  return { id: l.id, name: l.name, intensity: l.intensity, status: l.status };
});
sub(SUBJ.cmdPromote, async (d) => {
  if (!Engine) throw new Error('runner 未启用');
  const c = d as PromoteCmd; const l = await Engine.getLaunch(c.launch_id); if (!l) throw new Error('没有这个发布');
  const out = await Engine.setPromotion(l.id, { intensity: c.intensity, status: c.status });
  return out ? { id: out.id, name: out.name, intensity: out.intensity, status: out.status } : { error: 'not_found' };
});
sub(SUBJ.cmdInvite, async (d) => {
  if (!Engine || !engine) throw new Error('runner 未启用');
  const c = d as InviteCmd; const l = await Engine.getLaunch(c.launch_id); if (!l) throw new Error('没有这个发布');
  // 把手机递给谁：指定的人，或者按人群/语言随机挑几位还没用过的
  let pool = roster.filter((r) => r.spec.kind !== 'expert' && (c.persona_ids?.length ? c.persona_ids.includes(r.id) : (!c.segment || r.segment === c.segment) && (!c.locale || r.spec.locale === c.locale) && (r.spec.kind !== 'child')));
  if (!c.persona_ids?.length) pool = pool.sort(() => Math.random() - 0.5).slice(0, Math.max(1, Math.min(20, c.n ?? 3)));
  const ids = await Engine.inviteToLaunch(l, pool.map((r) => ({ id: r.id, spec: r.spec })), { want: c.want });
  engine.enqueue(ids, l);
  return { invited: ids.length, session_ids: ids };
});

setInterval(() => void launchTick(), 10_000);
setInterval(step, 1000);
setInterval(() => void pollSessions(), 1500);
setInterval(() => void loadRoster(), 60_000);
logger.info({ personas: roster.length, places: layout.places.length, town: layout.version, clock: clock.msg().clock }, '🌆 JobsWorld 世界服务已启动');

const stop = async () => { await bus.close(); await closeDb().catch(() => {}); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
