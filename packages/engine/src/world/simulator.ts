import { configPath, listFiles, newId, readYaml, Rng, WorldTemplateSchema, z, type WorldTemplate } from '@pux/core';
import { getDb, worldTemplates, events as eventsT, worldStates } from '@pux/db';
import { gateway } from '@pux/llm';

export interface NetworkProfile { down_kbps: number; up_kbps: number; rtt_ms: number; loss: number; offline: boolean }
export interface WorldStateData {
  sim_clock: string; sim_minute: number; sim_day: number;
  place: string; motion: 'still' | 'walking' | 'vehicle';
  channels: { hands: 'both' | 'one' | 'none'; eyes: 'full' | 'glance' | 'none'; ears: 'free' | 'busy' | 'noisy'; mouth: 'free' | 'busy' | 'quiet_required' };
  resources: { time_left_min: number; battery_pct: number; money: number; attention: number; network: NetworkProfile };
  social_pending: { from: string; text: string; urgency: number; event_id: string }[];
  active_constraints: string[];
}
export interface SimEvent { id: string; sim_time: string; type: string; source: string; caused_by_event_id?: string; text: string; effects: Record<string, unknown>; perceived: boolean; perceived_text?: string }
export interface Interrupt { kind: 'switch_away' | 'lock' | 'close_tab'; minutes: number; event_id: string; text: string }

const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const toClock = (min: number) => { const m = ((Math.floor(min) % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

export async function importWorldTemplates(dir = configPath('worlds')) {
  const out: string[] = [];
  for (const f of listFiles(dir, /\.ya?ml$/)) {
    const t = WorldTemplateSchema.parse(readYaml(f));
    await getDb().insert(worldTemplates).values({ id: t.id, name: t.name, scenario_class: t.scenario_class, spec: t }).onConflictDoUpdate({ target: worldTemplates.id, set: { name: t.name, scenario_class: t.scenario_class, spec: t } });
    out.push(t.id);
  }
  // 合并世界用的占位行：真正的处境记录在每次使用的 sessions.world_context 里
  const live = WorldTemplateSchema.parse({ id: 'live', name: '此时此地', name_en: 'Here and now', scenario_class: 'live', init: { place: '城里' }, situation: '（每个人此时此地在城里的处境）' });
  await getDb().insert(worldTemplates).values({ id: live.id, name: live.name, scenario_class: live.scenario_class, spec: live }).onConflictDoUpdate({ target: worldTemplates.id, set: { name: live.name, scenario_class: live.scenario_class, spec: live } });
  return out;
}
/** 场景模板库（不含合并世界的占位行）。合并世界是默认方式；模板只在显式指定时用于可复现的校准 */
export async function allWorldTemplates(): Promise<WorldTemplate[]> { return (await getDb().select().from(worldTemplates)).map((r) => r.spec as WorldTemplate).filter((t) => t.id !== 'live'); }

/** 矩阵初始化器：Human I/O 四通道 × 时间 × 地点 × 情绪 × 经济（只用于生成初始 WorldState） */
const MATRIX = {
  place: [{ place: '地铁车厢里站着', motion: 'vehicle', hands: 'one', eyes: 'glance', ears: 'noisy', mouth: 'quiet_required' }, { place: '路上边走边看', motion: 'walking', hands: 'one', eyes: 'glance', ears: 'noisy', mouth: 'free' }, { place: '家里餐桌', motion: 'still', hands: 'both', eyes: 'full', ears: 'free', mouth: 'free' }, { place: '医院排队', motion: 'still', hands: 'one', eyes: 'full', ears: 'noisy', mouth: 'quiet_required' }, { place: '咖啡店', motion: 'still', hands: 'both', eyes: 'full', ears: 'noisy', mouth: 'free' }],
  time: [['07:50', '早高峰'], ['12:30', '午休'], ['18:40', '下班路上'], ['22:30', '深夜']],
  emotion: [['平静', 0], ['焦虑', 0.3], ['烦躁', 0.2], ['开心', -0.1]],
  economy: [['月底手头紧', 80], ['刚发工资', 2000], ['普通', 400]],
} as const;

export class WorldSimulator {
  state!: WorldStateData;
  events: SimEvent[] = [];
  private firedTimeline = new Set<number>();
  private firedRules = new Set<string>();
  private lastByType = new Map<string, string>();
  private pendingInterrupts: Interrupt[] = [];
  private pendingStateDelta: Record<string, number> = {};
  private networkChanged = false;
  private memoryCues: string[] = [];
  readonly situation: string;
  private lastLlmMinute = 0;

  constructor(readonly tpl: WorldTemplate, readonly rng: Rng, readonly lang: 'zh' | 'en', simDay = 0, private tags: { study_id?: string; session_id?: string } = {}) {
    const t = tpl;
    let situation = lang === 'en' ? (t.situation_en ?? t.situation) : t.situation;
    let start = t.start_clock; let ch = { ...t.init.channels }; let place = t.init.place; let motion = t.init.motion; let money = t.resources.money; let extraStress = 0;
    if (t.matrix) {
      const p = rng.pick(MATRIX.place); const tm = rng.pick(MATRIX.time); const em = rng.pick(MATRIX.emotion); const ec = rng.pick(MATRIX.economy);
      place = p.place; motion = p.motion as never; ch = { hands: p.hands, eyes: p.eyes, ears: p.ears, mouth: p.mouth } as never; start = tm[0]; money = ec[1]; extraStress = em[1];
      situation = lang === 'en' ? `It's ${tm[0]} (${tm[1]}). You are at: ${place}. You feel ${em[0]}. Money: ${ec[0]}.` : `现在是 ${tm[0]}（${tm[1]}），你在${place}，心情${em[0]}，${ec[0]}。`;
      this.pendingStateDelta.stress = extraStress;
    }
    this.situation = situation;
    const constraints = [...t.constraints];
    if (ch.hands === 'one' && !constraints.includes('one_handed')) constraints.push('one_handed');
    if (ch.eyes === 'glance' && !constraints.includes('glance')) constraints.push('glance');
    if (motion === 'vehicle' && !constraints.includes('bumpy_ride')) constraints.push('bumpy_ride');
    this.state = {
      sim_clock: start, sim_minute: toMin(start), sim_day: simDay, place, motion, channels: ch,
      resources: { time_left_min: t.resources.time_left_min, battery_pct: t.resources.battery_pct, money, attention: t.resources.attention, network: { ...t.resources.network, offline: t.resources.network.offline ?? false } as NetworkProfile },
      social_pending: [], active_constraints: constraints,
    };
    if (t.resources.network.down_kbps < 2000) this.networkChanged = true;
  }

  /** 推进模拟时钟，触发事件，结算资源（§5 每一步的第一件事） */
  async advance(simSeconds: number, ctx: { step: number; stress: number; screenOn: boolean }): Promise<SimEvent[]> {
    const before = this.state.sim_minute;
    const after = before + simSeconds / 60;
    const fired: SimEvent[] = [];
    // 资源结算
    const mins = after - before;
    this.state.resources.time_left_min = Math.round((this.state.resources.time_left_min - mins) * 10) / 10;
    this.state.resources.battery_pct = Math.round((this.state.resources.battery_pct - mins * (ctx.screenOn ? 0.35 : 0.05)) * 10) / 10;
    this.state.sim_minute = after; this.state.sim_clock = toClock(after);
    // 时间线
    this.tpl.timeline.forEach((e, i) => {
      if (this.firedTimeline.has(i)) return;
      if (toMin(e.at) <= after + 0.001 && toMin(e.at) >= toMin(this.tpl.start_clock) - 1) { this.firedTimeline.add(i); fired.push(this.fire(e.type, 'timeline', e.text, e.effects as Record<string, unknown>, e.caused_by, e.perceived)); }
    });
    // 社会关系：定时请求
    for (const actor of this.tpl.social) for (const [i, rq] of actor.requests.entries()) {
      const key = `${actor.id}#${i}`; if (this.firedRules.has(key)) continue;
      if (toMin(rq.at) <= after) { this.firedRules.add(key); fired.push(this.fire(`social_${actor.id}`, 'social', `${actor.name}：${rq.text}`, { ...rq.effects, social_request: { from: actor.name, text: rq.text, urgency: rq.urgency } }, rq.caused_by, true)); }
    }
    // 概率规则（逐分钟）
    const whole = Math.max(1, Math.round(mins));
    for (const r of this.tpl.event_rules) {
      if (r.once && this.firedRules.has(r.id)) continue;
      if (!this.evalWhen(r.when, ctx)) continue;
      const p = 1 - Math.pow(1 - r.prob_per_min, whole);
      if (this.rng.bool(p)) { this.firedRules.add(r.id); fired.push(this.fire(r.type, r.source, r.text, r.effects as Record<string, unknown>, r.caused_by, true)); }
    }
    // 硬约束事件
    if (this.state.resources.battery_pct <= 20 && !this.firedRules.has('__battery20')) { this.firedRules.add('__battery20'); fired.push(this.fire('battery_low', 'rule', this.lang === 'en' ? 'Your phone warns: battery below 20%.' : '手机提示：电量低于 20%。', { state: { stress: 0.05 } }, undefined, true)); }
    // LLM 补充小事件（规则优先，LLM 只做补充）
    if (this.tpl.llm_events && after - this.lastLlmMinute >= 6 && this.rng.bool(0.35)) { this.lastLlmMinute = after; const e = await this.llmEvent().catch(() => undefined); if (e) fired.push(e); }
    return fired;
  }

  private evalWhen(expr: string, ctx: { step: number; stress: number }) {
    try {
      // 本地可信配置中的简单表达式
      const fn = new Function('clock', 'motion', 'place', 'battery', 'time_left', 'step', 'stress', `return (${expr});`);
      return !!fn(this.state.sim_clock, this.state.motion, this.state.place, this.state.resources.battery_pct, this.state.resources.time_left_min, ctx.step, ctx.stress);
    } catch { return false; }
  }

  private fire(type: string, source: string, text: string, effects: Record<string, unknown>, causedByType?: string, perceived = true): SimEvent {
    const ev: SimEvent = { id: newId('evt'), sim_time: this.state.sim_clock, type, source, text, effects, perceived, caused_by_event_id: causedByType ? this.lastByType.get(causedByType) : undefined };
    if (causedByType && !ev.caused_by_event_id) ev.effects = { ...effects, caused_by_type: causedByType };   // 起因在 Session 之前（例如前一晚）
    this.lastByType.set(type, ev.id);
    this.apply(effects as never, ev);
    ev.perceived_text = this.perceivedText(ev);
    this.events.push(ev);
    return ev;
  }

  private apply(e: { world?: Record<string, unknown>; resources?: Record<string, number>; network?: Partial<NetworkProfile>; state?: Record<string, number>; constraints_add?: string[]; constraints_remove?: string[]; social_request?: { from: string; text: string; urgency: number }; interrupt?: { kind: Interrupt['kind']; minutes: number }; memory_cue?: string }, ev: SimEvent) {
    for (const [k, v] of Object.entries(e.world ?? {})) {
      if (k.startsWith('channels.')) (this.state.channels as Record<string, unknown>)[k.slice(9)] = v;
      else (this.state as unknown as Record<string, unknown>)[k] = v;
    }
    for (const [k, v] of Object.entries(e.resources ?? {})) (this.state.resources as unknown as Record<string, number>)[k] = Math.round(((this.state.resources as unknown as Record<string, number>)[k] + v) * 10) / 10;
    if (e.network) { this.state.resources.network = { ...this.state.resources.network, ...e.network }; this.networkChanged = true; }
    for (const [k, v] of Object.entries(e.state ?? {})) this.pendingStateDelta[k] = (this.pendingStateDelta[k] ?? 0) + v;
    for (const c of e.constraints_add ?? []) if (!this.state.active_constraints.includes(c)) this.state.active_constraints.push(c);
    this.state.active_constraints = this.state.active_constraints.filter((c) => !(e.constraints_remove ?? []).includes(c));
    if (this.state.channels.hands === 'one' && !this.state.active_constraints.includes('one_handed')) this.state.active_constraints.push('one_handed');
    if (this.state.channels.hands === 'both') this.state.active_constraints = this.state.active_constraints.filter((c) => c !== 'one_handed');
    if (e.social_request) this.state.social_pending.push({ ...e.social_request, event_id: ev.id });
    if (e.interrupt) this.pendingInterrupts.push({ ...e.interrupt, event_id: ev.id, text: ev.text });
    if (e.memory_cue) this.memoryCues.push(e.memory_cue);
  }

  private perceivedText(ev: SimEvent) { return ev.perceived ? ev.text : undefined; }

  private async llmEvent(): Promise<SimEvent | undefined> {
    const S = z.object({ happens: z.boolean(), type: z.string(), text: z.string(), stress_delta: z.number(), interrupt_minutes: z.number() });
    const r = await gateway().chat('world_sim', { messages: [{ role: 'user', content: `${this.lang === 'en' ? 'World state' : '世界状态'}：${JSON.stringify({ clock: this.state.sim_clock, place: this.state.place, motion: this.state.motion, recent: this.events.slice(-3).map((e) => e.text) })}\n${this.lang === 'en' ? 'Propose ONE small, realistic, everyday event that could plausibly happen in the next few minutes (or happens=false). Keep it mundane and consistent with the state. text is what the person notices.' : '提出一个接下来几分钟内可能自然发生的、平常的小事件（或 happens=false）。必须与当前状态一致，不要戏剧化。text 写成当事人察觉到的样子。'}` }], schema: S, schemaName: 'world_event', tags: { ...this.tags, purpose: 'world_llm_event' } });
    if (!r.data.happens) return undefined;
    const eff: Record<string, unknown> = { state: { stress: Math.max(-0.2, Math.min(0.2, r.data.stress_delta)) } };
    if (r.data.interrupt_minutes > 0) eff.interrupt = { kind: 'switch_away', minutes: Math.min(5, r.data.interrupt_minutes) };
    return this.fire(r.data.type, 'llm', r.data.text, eff, undefined, true);
  }

  takeInterrupts() { const x = this.pendingInterrupts; this.pendingInterrupts = []; return x; }
  takeStateDelta() { const x = this.pendingStateDelta; this.pendingStateDelta = {}; return x; }
  takeNetworkChange(): NetworkProfile | null | undefined { if (!this.networkChanged) return undefined; this.networkChanged = false; const n = this.state.resources.network; return n.down_kbps >= 10000 && n.rtt_ms < 100 ? null : n; }
  takeMemoryCues() { const x = this.memoryCues; this.memoryCues = []; return x; }
  resolveSocial(eventId: string) { this.state.social_pending = this.state.social_pending.filter((s) => s.event_id !== eventId); }

  /** Constraint Engine：把世界状态变成硬约束 / 软约束（§7.1） */
  constraints() {
    const c = this.state.active_constraints;
    return {
      hard: { one_handed: c.includes('one_handed') || this.state.channels.hands === 'one', glance: this.state.channels.eyes === 'glance' || c.includes('glance'), bumpy: c.includes('bumpy_ride'), weak_network: c.includes('weak_network'), quiet: this.state.channels.mouth !== 'free' || c.includes('quiet_office'), deadline: this.tpl.timeline.length > 0 },
      soft: { social_pressure: this.state.social_pending.reduce((a, s) => Math.max(a, s.urgency), 0) },
      list: c,
    };
  }

  /** 硬约束：时间预算耗尽 / 电量归零 → 强制结束 */
  hardStop(): string | undefined {
    if (this.state.resources.time_left_min <= 0) return this.lang === 'en' ? 'time budget exhausted' : '时间耗尽';
    if (this.state.resources.battery_pct <= 0) return this.lang === 'en' ? 'phone battery died' : '手机没电关机';
    return undefined;
  }

  /** 给 Persona 的处境描述（只含能感知到的世界信息） */
  describeForPersona(): string {
    const s = this.state; const en = this.lang === 'en';
    const lines = [en ? `Time: ${s.sim_clock}. Place: ${s.place}.` : `现在 ${s.sim_clock}，你在${s.place}。`];
    if (s.channels.hands === 'one') lines.push(en ? 'You only have one hand free for the phone.' : '你只有一只手能操作手机。');
    if (s.channels.eyes === 'glance') lines.push(en ? 'You can only glance at the screen in short bursts.' : '你只能时不时瞄一眼屏幕。');
    if (s.channels.mouth !== 'free') lines.push(en ? 'You can\'t speak out loud right now.' : '现在不方便出声说话。');
    if (s.channels.ears === 'noisy') lines.push(en ? 'It\'s noisy around you.' : '周围很吵。');
    if (s.resources.battery_pct < 25) lines.push(en ? `Phone battery: ${Math.max(0, Math.round(s.resources.battery_pct))}%.` : `手机电量 ${Math.max(0, Math.round(s.resources.battery_pct))}%。`);
    if (this.tpl.timeline.length || this.tpl.constraints.some((c) => c.startsWith('deadline'))) lines.push(en ? `You have about ${Math.max(0, Math.round(s.resources.time_left_min))} minutes.` : `你大概还有 ${Math.max(0, Math.round(s.resources.time_left_min))} 分钟。`);
    for (const sp of s.social_pending) lines.push(en ? `Unanswered: ${sp.from} — "${sp.text}"` : `还没回复：${sp.from}说「${sp.text}」`);
    return lines.join(en ? ' ' : '');
  }

  async persist(sessionId: string, stepIdx: number, newEvents: SimEvent[]) {
    const db = getDb();
    const wsId = newId('ws');
    await db.insert(worldStates).values({ id: wsId, session_id: sessionId, step_idx: stepIdx, sim_clock: this.state.sim_clock, state: this.state }).onConflictDoNothing();
    for (const e of newEvents) await db.insert(eventsT).values({ id: e.id, session_id: sessionId, step_idx: stepIdx, sim_time: e.sim_time, type: e.type, source: e.source, caused_by_event_id: e.caused_by_event_id, text: e.text, effects: e.effects, perceived: e.perceived, perceived_text: e.perceived_text }).onConflictDoNothing();
    return wsId;
  }
}
