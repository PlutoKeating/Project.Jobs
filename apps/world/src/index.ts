// JobsWorld 世界服务：时钟、日程、位置、Session 直播与回放 → NATS
import { logger, newId } from '@pux/core';
import { closeDb } from '@pux/db';
import {
  agendaAt, appearanceFor, assignHome, completeAgenda, computeLayout, connectBus, decode, knownHomes, kvPutJson, lastFinishedSession, latestPersonas, loadAgenda,
  loadTown, personaMemoryList, personaSessions, saveAgenda, skeletonAgenda, SUBJ,
  type Agenda, type ClockCmd, type EventCmd, type PersonaLive, type PersonaRow, type ReplayCmd, type SessionLive, type Snapshot, type WorldEvent,
} from '@pux/jobsworld';
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

async function loadRoster() {
  roster = await latestPersonas();
  const homes = await knownHomes();
  const taken = new Set([...homes.values()].map((h) => h.unit));
  for (const p of roster) {
    const key = `${p.id}@${clock.date}`;
    if (agendas.get(p.id)?.sim_date === clock.date) continue;
    let a = await loadAgenda(p.id, clock.date);
    if (!a) {
      const home = homes.get(p.id) ?? assignHome(layout, p.id, taken);
      taken.add(home.unit);
      a = skeletonAgenda(layout, p.spec, clock.date, home);
      await saveAgenda(a);
    }
    agendas.set(p.id, a);
    if (AGENDA_LLM && a.source === 'skeleton' && !llmQueue.includes(key)) llmQueue.push(key);
  }
}

/** 后台逐个补全日程（并发 2） */
async function drainLlm() {
  const work = async () => {
    for (;;) {
      const key = llmQueue.shift(); if (!key) return;
      const [id, date] = key.split('@');
      const p = roster.find((r) => r.id === id); const a = agendas.get(id);
      if (!p || !a || a.sim_date !== date || a.source !== 'skeleton') continue;
      const done = await completeAgenda(p.spec, a);
      if (done.source === 'llm') { await saveAgenda(done); agendas.set(id, done); logger.info({ persona: id }, '日程已补全'); }
    }
  };
  await Promise.all([work(), work()]);
}

clock.onNewDay = () => { void loadRoster().then(drainLlm); };

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
  clock.tick();
  const minute = clock.minute;
  const byPersona = tracker.byPersona();
  const now = Date.now();
  for (const r of roster) {
    const a = agendas.get(r.id); if (!a) continue;
    const prev = live.get(r.id);
    const tracked = byPersona.get(r.id);
    const rp = replays.get(r.id);
    const sess = rp?.session ?? tracked?.live;
    const tgt = sess ? placement.forSession(r.spec, a, sess) : placement.forAgenda(r.spec, a, minute);
    const at = agendaAt(a, minute);
    // 平滑移动：同一楼层沿 x 走过去；跨楼层/地下直接到位
    let x = tgt.x; let facing: 1 | -1 = prev?.facing ?? 1;
    if (prev && prev.y === tgt.y && prev.place_id === tgt.place_id && Math.abs(prev.x - tgt.x) > WALK_TILES_PER_S) { const d = Math.sign(tgt.x - prev.x); x = prev.x + d * WALK_TILES_PER_S; facing = d > 0 ? 1 : -1; }
    else if (prev && tgt.x !== prev.x) facing = tgt.x > prev.x ? 1 : -1;
    const id = r.spec.identity;
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
    };
    // 世界事件：地点里的人做出反应（每个事件每人一次）
    for (const e of events) if (e.place_id === pl.place_id && !reacted.has(`${e.id}:${r.id}`)) {
      reacted.add(`${e.id}:${r.id}`);
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
  if (now - lastKv > 5000) { lastKv = now; void kvPutJson(bus.kv, 'snapshot', snap); void kvPutJson(bus.kv, 'clock', snap.clock); }
}
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
  return { live: p, agenda: agendas.get(id), memories: (await personaMemoryList(id, 8)).map((m) => ({ kind: m.kind, content: m.content, valence: m.valence })), sessions: (await personaSessions(id, 6)).map((s) => ({ id: s.id, app: s.app, outcome: s.outcome, steps: s.steps, ended_at: s.ended_at })) };
});
sub(SUBJ.ask, async (d) => {
  const { persona_id, question } = d as { persona_id: string; question: string };
  if (tracker.byPersona().get(persona_id)?.status === 'running') return { answer: null, busy: true };
  const sid = await lastFinishedSession(persona_id);
  if (!sid) return { answer: null, none: true };
  const { askPersona } = await import('@pux/engine');
  return { answer: await askPersona(sid, String(question).slice(0, 500)), session_id: sid };
});

await loadRoster();
void drainLlm();
setInterval(step, 1000);
setInterval(() => void pollSessions(), 1500);
setInterval(() => void loadRoster(), 60_000);
logger.info({ personas: roster.length, places: layout.places.length, town: layout.version, clock: clock.msg().clock }, '🌆 JobsWorld 世界服务已启动');

const stop = async () => { await bus.close(); await closeDb().catch(() => {}); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
