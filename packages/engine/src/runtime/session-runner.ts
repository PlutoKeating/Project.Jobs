// Simulation Runtime：World Simulator → Persona Mind ↔ Operator → UAP(+Policy Gate) → 真实产品（§4、§5）
import { existsSync } from 'node:fs';
import { cityCoords, loadConfig, logger, makeError, newId, Rng, shortHash, langOf, type ActionRequest, type ActionResult, type Criterion, type DynamicState, type PersonaSpec, type StudyInput, type WorldTemplate, type Mode } from '@pux/core';
import { and, appVersions, apps, eq, getDb, goals, humanTasks, observations, sessions, steps, studies, taskDefs, worldTemplates } from '@pux/db';
import { BrowserSession, policyFor, putEvidence } from '@pux/executor';
import { LlmError } from '@pux/llm';
import { feelings, updateState } from '../human/state.ts';
import { freezePersona, getPersona, initialState, motorProfile } from '../human/persona.ts';
import { perceive, type PerceivedElement } from '../human/perception.ts';
import { consolidate, lifeBetween, recall } from '../human/memory.ts';
import { WorldSimulator } from '../world/simulator.ts';
import { accountHint } from '../exploration/goals.ts';
import { taskCompleted } from '../product/intelligence.ts';
import { runMind, runOperator, type MindOut } from './roles.ts';

export type StepOutcome = { done: false; needsHuman?: { reason: string; takeover: string; task_id: string } } | { done: true; outcome: string; end_reason: string };

interface Hist { intent: string; outcome: string; monologue: string }

const describeResult = (r: ActionResult | undefined, zh: boolean, child: boolean): string => {
  if (!r) return '';
  if (r.status === 'blocked_by_policy') return zh ? (child ? '你想起爸爸妈妈说过不能自己乱买东西/加陌生人，就没有真的点下去' : '你犹豫了一下，最后没有真的提交（这一步不会真的发生）') : (child ? 'you remembered your parents said not to buy things or add strangers on your own, so you stopped' : 'you hesitated and did not actually submit (this step will not really happen)');
  if (r.status === 'needs_human') return zh ? '页面需要额外验证' : 'the page asked for extra verification';
  if (r.error?.code === 'PRODUCT_HTTP_5XX' || r.error?.code === 'PRODUCT_JS_ERROR') return zh ? '页面好像出错了' : 'something seemed to break';
  if (r.error?.code === 'INJECTED_NETWORK' || r.error?.code === 'ENV_NETWORK') return zh ? '网络很卡，没加载出来' : 'the network was too slow, nothing loaded';
  if (r.error?.code === 'PRODUCT_SMALL_TARGET' || r.error?.code === 'SIM_MOTOR_MISS') return zh ? '手一滑好像没点准' : 'your finger slipped and you missed';
  if (r.error?.code === 'EXEC_INTERCEPTED') return zh ? '想点的东西被别的东西挡住了' : 'something was covering what you wanted to tap';
  if (r.error?.code?.startsWith('EXEC_') || r.error?.code === 'SIM_INVALID_INTENT') return zh ? '没找到你想点的东西' : "couldn't find what you were looking for";
  if (r.status === 'no_effect') return zh ? '好像没有任何反应' : 'nothing seemed to happen';
  if (r.effects.url_changed) return zh ? '页面跳转了' : 'the page changed';
  if (r.effects.new_dialog) return zh ? '弹出了一个窗口' : 'a popup appeared';
  return zh ? '页面有了变化' : 'the screen updated';
};

export class SessionRunner {
  static registry = new Map<string, SessionRunner>();
  browser!: BrowserSession;
  world!: WorldSimulator;
  persona!: PersonaSpec;
  personaVersion!: string;
  state!: DynamicState;
  lang: 'zh' | 'en' = 'zh';
  stepIdx = 0;
  private hist: Hist[] = [];
  private prevExpectation = '';
  private prevResult?: ActionResult;
  private prevStepId?: string;
  private consecutiveViolations = 0;
  private noNewState = 0;
  private loopTracker = new Map<string, number>();
  private loopHits = 0;
  private llmErrors = 0;
  private pendingSimSeconds = 0;
  private lastWaitS = 0;
  private obsLog: { url: string; text: string }[] = [];
  private interruptionNote?: string;
  private loopNote?: string;
  private memories: string[] = [];
  private appName = '';
  private appId = '';
  private startUrl = '';
  private goalText = '';
  private signals: { kind: string; value: string }[] = [];
  private cfg = loadConfig();
  private study!: { id: string; config: StudyInput };
  private sess!: typeof sessions.$inferSelect;
  private rng!: Rng;
  private ended?: { outcome: string; end_reason: string };
  private worldTpl!: WorldTemplate;
  private screenOn = true;

  static async start(sessionId: string, opts: { headed?: boolean } = {}): Promise<SessionRunner> {
    const r = new SessionRunner(); await r.init(sessionId, opts); SessionRunner.registry.set(sessionId, r); return r;
  }
  static get(sessionId: string) { return SessionRunner.registry.get(sessionId); }

  private async init(sessionId: string, opts: { headed?: boolean }) {
    const db = getDb();
    this.sess = (await db.select().from(sessions).where(eq(sessions.id, sessionId)))[0];
    if (!this.sess) throw new Error(`Session 不存在：${sessionId}`);
    const st = (await db.select().from(studies).where(eq(studies.id, this.sess.study_id)))[0];
    this.study = { id: st.id, config: st.config as StudyInput };
    const av = (await db.select().from(appVersions).where(eq(appVersions.id, st.app_version_id)))[0];
    const app = (await db.select().from(apps).where(eq(apps.id, av.app_id)))[0];
    this.appName = app.name; this.appId = app.id; this.startUrl = av.env_url;
    const p = await getPersona(this.sess.persona_id, this.sess.persona_version);
    if (!p) throw new Error(`Persona 不存在：${this.sess.persona_id}@${this.sess.persona_version}`);
    this.persona = p.spec; this.personaVersion = p.version; this.lang = langOf(p.spec.locale);
    await freezePersona(p.spec.id, p.version);
    this.worldTpl = (await db.select().from(worldTemplates).where(eq(worldTemplates.id, this.sess.world_template_id)))[0].spec as WorldTemplate;
    this.rng = new Rng(this.sess.rng_seed);
    this.world = new WorldSimulator(this.worldTpl, this.rng, this.lang, this.sess.revisit_day, { study_id: st.id, session_id: sessionId });
    this.state = initialState(p.spec);
    const goal = this.sess.goal_id ? (await db.select().from(goals).where(eq(goals.id, this.sess.goal_id)))[0] : undefined;
    this.goalText = goal?.statement_for_persona ?? '';
    const tid = (goal?.linked_task_ids ?? [])[0];
    if (tid) this.signals = ((await db.select().from(taskDefs).where(eq(taskDefs.id, tid)))[0]?.success_signals ?? []) as never;
    const spec = av.product_spec_path && existsSync(av.product_spec_path) ? undefined : undefined; void spec;
    // 回访：先补齐两次使用之间的生活
    if (this.sess.revisit_day > 0) {
      const life = await lifeBetween(this.persona, this.appName, 0, this.sess.revisit_day, { study_id: st.id, session_id: sessionId }).catch(() => '');
      if (life) this.memories.push(life);
    }
    const mem = await recall(this.persona.id, this.appId, `${this.appName} ${this.goalText}`, this.sess.revisit_day).catch(() => []);
    this.memories.push(...mem.map((m) => m.content));
    this.memories.push(accountHint(this.persona, this.appId));
    const form = app.form;
    this.browser = await BrowserSession.launch({ sessionId, studyId: st.id, personaId: this.persona.id, executor: this.sess.executor as 'stagehand' | 'midscene', headed: opts.headed ?? this.study.config.headed, mobile: form === 'h5', locale: this.persona.locale, policy: policyFor(this.persona), rng: this.rng, geolocation: this.persona.psychology.privacy_sensitivity >= 0.75 ? null : (([lat, lng]) => ({ latitude: lat + this.rng.normal(0, 0.02), longitude: lng + this.rng.normal(0, 0.02) }))(cityCoords(this.persona.identity.region)) });
    await this.browser.page.goto(this.startUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch((e) => logger.warn({ e: String(e) }, '起始页打开失败'));
    const net = this.world.takeNetworkChange(); if (net !== undefined) await this.browser.setNetwork(net);
    await db.update(sessions).set({ status: 'running', started_at: new Date() }).where(eq(sessions.id, sessionId));
    logger.info({ session: sessionId, persona: this.persona.id, world: this.worldTpl.id, mode: this.sess.mode }, 'Session 开始');
  }

  private async end(outcome: string, end_reason: string): Promise<StepOutcome> { this.ended = { outcome, end_reason }; return { done: true, outcome, end_reason }; }

  /** 执行一步。Temporal 模式下每一步就是一个 Activity。 */
  async step(): Promise<StepOutcome> {
    if (this.ended) return { done: true, ...this.ended };
    const db = getDb(); const idx = this.stepIdx; const zh = this.lang === 'zh';
    const tags = { study_id: this.study.id, session_id: this.sess.id, step_idx: idx };
    const t0 = Date.now();
    const maxSteps = this.study.config.budget.max_steps_per_session;
    if (idx >= maxSteps) return this.end('resource_exhausted', zh ? `达到步数上限 ${maxSteps}` : `step budget ${maxSteps} reached`);
    const tokUsed = (await db.select({ t: sessions.tokens }).from(sessions).where(eq(sessions.id, this.sess.id)))[0]?.t ?? 0;
    if (tokUsed > this.study.config.budget.max_tokens_per_session) return this.end('resource_exhausted', `token budget (${tokUsed})`);

    // ---- 1. World Simulator：推进时钟、触发事件、结算资源
    const events = await this.world.advance(this.pendingSimSeconds, { step: idx, stress: this.state.stress, screenOn: this.screenOn });
    const stateDelta = this.world.takeStateDelta();
    for (const it of this.world.takeInterrupts()) {
      const ctxAct = (verb: 'switch_away' | 'return' | 'close_tab' | 'lock'): ActionRequest => ({ action_id: newId('act'), session_id: this.sess.id, step_idx: idx, verb, intent_text: `[world] ${it.text}`, success: { any_of: [{ kind: 'network_settled', max_ms: 500 }], within_ms: 500 }, motor: motorProfile(this.persona), timeout_ms: 5000, injected: true });
      await this.browser.act(ctxAct(it.kind === 'close_tab' ? 'close_tab' : 'switch_away'));
      const awayEvents = await this.world.advance(it.minutes * 60, { step: idx, stress: this.state.stress, screenOn: false });
      events.push(...awayEvents);
      if (it.kind === 'close_tab') await this.browser.reopenLast(); else await this.browser.act(ctxAct('return'));
      const wm = this.persona.capability.cognition.working_memory;
      const forget = it.minutes > 1 + wm * 4;
      if (forget) this.hist = this.hist.slice(-1);
      this.interruptionNote = zh ? `刚才「${it.text}」，你离开了大约 ${it.minutes} 分钟${forget ? '，回来时有点想不起刚才做到哪一步了' : ''}。` : `"${it.text}" — you were away for about ${it.minutes} min${forget ? ' and on return you are fuzzy about where you left off' : ''}.`;
      await putEvidence('world_event', { ...tags, persona_id: this.persona.id }, { inline: { interrupt: it, injected: true } });
    }
    const net = this.world.takeNetworkChange(); if (net !== undefined) await this.browser.setNetwork(net);
    for (const cue of this.world.takeMemoryCues()) { const m = await recall(this.persona.id, this.appId, cue, this.sess.revisit_day, 2).catch(() => []); this.memories.push(cue, ...m.map((x) => x.content)); }
    const wsId = await this.world.persist(this.sess.id, idx, events);
    for (const e of events) await putEvidence('world_event', { ...tags, persona_id: this.persona.id }, { inline: e });
    const stop = this.world.hardStop();
    if (stop) return this.end('resource_exhausted', stop);

    // ---- 2. 观察
    const obs = await this.browser.observe(this.sess.id, idx);
    await db.insert(observations).values({ id: obs.obs_id, session_id: this.sess.id, step_idx: idx, url: obs.url, title: obs.title, state_id: obs.state_id, data: { ...obs, elements: obs.elements.slice(0, 250) } });
    this.obsLog.push({ url: obs.url, text: `${obs.title}\n${obs.text}` });
    if (obs.captcha) {
      const takeover = await this.browser.takeoverUrl();
      const tid = newId('human');
      await db.insert(humanTasks).values({ id: tid, session_id: this.sess.id, study_id: this.study.id, reason: zh ? '页面出现人机验证（验证码）' : 'Captcha detected', url: obs.url, cdp_url: takeover });
      await db.update(sessions).set({ status: 'waiting_human' }).where(eq(sessions.id, this.sess.id));
      return { done: false, needsHuman: { reason: 'ENV_CAPTCHA', takeover, task_id: tid } };
    }

    // ---- 3. 感知过滤
    const cons = this.world.constraints();
    const perc = await perceive({ persona: this.persona, elements: obs.elements, screenshotEv: obs.screenshot_ev, eyes: cons.hard.glance ? 'glance' : 'full', attention: this.state.attention, viewportH: obs.viewport.h, ctx: { ...tags, persona_id: this.persona.id }, lang: this.lang });

    // ---- 4. Persona Mind
    const modeHint = this.modeHint();
    let mind: MindOut;
    try {
      mind = await runMind({ persona: this.persona, lang: this.lang, situation: this.world.situation, worldNow: this.world.describeForPersona(), lifeGoal: this.goalText, modeHint, feelings: feelings(this.state, this.lang), memories: this.memories.slice(-8), priorKnowledge: this.sess.revisit_day > 0 ? 'used_before' : this.persona.prior_knowledge, appName: this.appName, history: this.hist, screen: perc.summary + (obs.dialogs.length ? `\n${zh ? '【弹窗】' : '[popup] '}${obs.dialogs.join(' / ')}` : '') + (obs.notifications.length ? `\n${zh ? '【通知】' : '[notification] '}${obs.notifications.join(' / ')}` : ''), image: perc.image, events: events.filter((e) => e.perceived).map((e) => e.perceived_text ?? e.text), interruptionNote: this.interruptionNote, loopNote: this.loopNote, pageUrlHint: obs.url.replace(/^https?:\/\//, '').slice(0, 60), step: idx, maxSteps }, tags);
      this.llmErrors = 0;
    } catch (e) {
      this.llmErrors++;
      logger.warn({ err: String((e as Error).message).slice(0, 200) }, 'Mind 调用失败');
      if (this.llmErrors >= 3 || e instanceof LlmError && this.llmErrors >= 2) return this.end('sim_error', `SIM_LLM_ERROR: ${String((e as Error).message).slice(0, 150)}`);
      this.pendingSimSeconds = 5; return { done: false };
    }
    this.interruptionNote = undefined; this.loopNote = undefined;
    const monoEv = await putEvidence('monologue', { ...tags, persona_id: this.persona.id }, { inline: mind });

    // ---- 5. 预期违背检测（客观 + Persona 自述）
    let violated = false;
    if (this.prevExpectation && this.prevResult) {
      const simSide = ['simulator', 'executor'].includes(this.prevResult.error?.layer ?? '');
      // 模拟器/执行器自身的失败不计入 Persona 的预期违背（避免把模拟器错误转化为放弃）
      violated = !simSide && (mind.previous_met_expectation === 'no' || ['failed', 'no_effect'].includes(this.prevResult.status));
      if (this.prevStepId) await db.update(steps).set({ expectation_violated: violated }).where(eq(steps.id, this.prevStepId));
      this.consecutiveViolations = violated ? this.consecutiveViolations + 1 : 0;
    }
    this.state = updateState(this.persona, this.state, { result: this.prevResult, expectation_violated: violated, new_state: !!obs.is_new_state, waited_s: this.lastWaitS, goal_progress: mind.goal_progress, world_state_delta: stateDelta, sim_minutes: this.pendingSimSeconds / 60 }, this.consecutiveViolations);
    this.lastWaitS = 0;

    const stepId = newId('step');
    const baseStep = { id: stepId, session_id: this.sess.id, idx, world_state_id: wsId, observation_id: obs.obs_id, perceived_summary: perc.summary.slice(0, 4000), monologue: mind.monologue, expectation: mind.expectation, dynamic_state: { ...this.state, emotion: mind.emotion, perceived_hidden: perc.hidden_count, unreadable: perc.unreadable }, intent: mind.intent, decision: mind.decision, sim_clock: this.world.state.sim_clock, tokens: 0 };

    // ---- 6. 结束条件
    const finishStep = async (extra: Partial<typeof baseStep> & { action_request?: unknown; action_result?: unknown } = {}) => {
      await db.insert(steps).values({ ...baseStep, ...extra, real_ms: Date.now() - t0 } as never).onConflictDoNothing();
      this.prevStepId = stepId; this.stepIdx++;
      await db.update(sessions).set({ steps_count: this.stepIdx }).where(eq(sessions.id, this.sess.id));
    };
    if (mind.decision === 'done') {
      await finishStep();
      const tc = taskCompleted(this.signals, this.obsLog);
      return this.end('success', this.signals.length && !tc.done ? (zh ? `Persona 认为已完成（客观成功信号未满足）：${mind.end_reason}` : `persona believed done (objective signals not met): ${mind.end_reason}`) : mind.end_reason || 'done');
    }
    if (mind.decision === 'give_up') { await finishStep(); return this.end('gave_up', mind.end_reason || mind.monologue); }
    if (this.state.patience <= 0) { await finishStep(); return this.end('gave_up', zh ? `耐心耗尽：${mind.monologue}` : `patience exhausted: ${mind.monologue}`); }
    if (this.consecutiveViolations >= this.cfg.guards.max_consecutive_violations) { await finishStep(); return this.end('gave_up', zh ? `连续 ${this.consecutiveViolations} 次预期落空` : `${this.consecutiveViolations} consecutive expectation violations`); }
    if (mind.decision === 'step_away') {
      const sp = this.world.state.social_pending[0]; if (sp) this.world.resolveSocial(sp.event_id);
      await this.browser.switchAway(); const away = this.rng.int(2, 6);
      await this.world.advance(away * 60, { step: idx, stress: this.state.stress, screenOn: false });
      const pNoReturn = 0.15 + this.state.stress * 0.25 + Math.max(0, 1 - this.state.patience / this.persona.behavior_policy.patience_base) * 0.3;
      await finishStep({ action_request: { verb: 'switch_away', injected: false, minutes: away } } as never);
      if (this.rng.bool(pNoReturn)) return this.end('gave_up', zh ? `离开去处理别的事后没有再回来（${mind.end_reason || mind.monologue}）` : `stepped away and never came back (${mind.end_reason || mind.monologue})`);
      await this.browser.returnBack();
      this.interruptionNote = zh ? `你刚才离开了 ${away} 分钟去处理别的事，现在回来了。` : `You stepped away for ${away} minutes and are now back.`;
      this.pendingSimSeconds = 5; return { done: false };
    }

    // ---- 7. Operator：意图 → UAP 动作
    const motor = motorProfile(this.persona, cons.list.concat(cons.hard.one_handed ? ['one_handed'] : []), this.state);
    let req: ActionRequest; let opInfo: Record<string, unknown> = {};
    if (mind.decision === 'wait') {
      const secs = Math.min(40, Math.max(3, this.persona.behavior_policy.wait_tolerance_s * 1.5));
      req = { action_id: newId('act'), session_id: this.sess.id, step_idx: idx, verb: 'wait', args: { seconds: secs }, intent_text: mind.intent, expectation: mind.expectation, success: { any_of: [{ kind: 'dom_changed' }], within_ms: 1000 }, motor, timeout_ms: secs * 1000 + 5000 };
    } else {
      let op;
      try { op = await runOperator({ intent: mind.intent, inputText: mind.input_text, expectation: mind.expectation, elements: perc.elements, image: perc.image, motor, url: obs.url, lang: this.lang, inputPreference: this.persona.behavior_policy.input_preference, quiet: cons.hard.quiet, executor: this.sess.executor }, tags); }
      catch (e) { this.llmErrors++; await finishStep(); if (this.llmErrors >= 3) return this.end('sim_error', 'SIM_LLM_ERROR operator'); this.pendingSimSeconds = 5; return { done: false }; }
      opInfo = op as never;
      if (!op.feasible && op.infeasible_reason !== 'needs_scroll') {
        const hiddenTarget = this.targetHiddenByPerception(mind.intent, obs.elements, perc.elements);
        const err = hiddenTarget ? makeError('EXEC_TARGET_NOT_FOUND', `${zh ? '目标在页面上存在但 Persona 没有感知到（可能是可发现性问题）' : 'target exists but was not perceived (possible discoverability issue)'}：${hiddenTarget}`) : makeError('SIM_INVALID_INTENT', `${zh ? '意图引用了屏幕上不存在的目标' : 'intent references a target not on screen'}：${op.infeasible_reason}`);
        const fake: ActionResult = { action_id: newId('act'), status: 'failed', matched_criteria: [], error: err, started_at: new Date().toISOString(), ended_at: new Date().toISOString(), duration_ms: 0, executor: { name: this.sess.executor, version: '-' }, before_obs: obs.obs_id, after_obs: obs.obs_id, effects: { url_changed: false, dom_changed: false, requests: 0, new_dialog: false }, evidence_ids: [monoEv] };
        await finishStep({ action_request: { operator: op }, action_result: fake } as never);
        this.prevExpectation = mind.expectation; this.prevResult = fake;
        this.hist.push({ intent: mind.intent, outcome: describeResult(fake, zh, this.persona.kind === 'child'), monologue: mind.monologue });
        this.pendingSimSeconds = this.readingSeconds(perc.summary) + 4;
        return this.guards(obs.state_id, `infeasible:${mind.intent.slice(0, 20)}`, !!obs.is_new_state);
      }
      req = this.buildRequest(op, mind, motor, idx, perc.elements);
    }

    // ---- 8. 执行（UAP + Policy Gate）
    const res = await this.browser.act(req, this.rng);
    if (req.verb === 'wait') this.lastWaitS = res.duration_ms / 1000;
    await finishStep({ action_request: { ...req, operator: opInfo } as never, action_result: res as never });
    this.prevExpectation = mind.expectation; this.prevResult = res;
    this.hist.push({ intent: mind.intent, outcome: describeResult(res, zh, this.persona.kind === 'child'), monologue: mind.monologue });
    if (res.error?.code === 'ENV_BROWSER_CRASH') return this.end('sim_error', 'ENV_BROWSER_CRASH');
    // 模拟耗时：阅读 + 思考 + 动作 + 打字
    const typed = String(req.args?.text ?? '').length;
    this.pendingSimSeconds = this.readingSeconds(perc.summary) + 3 + 5 * (1 - this.persona.capability.digital_literacy) + res.duration_ms / 1000 + (req.verb === 'type' ? typed / motor.typing_cps : 0) + (req.verb === 'speak' ? typed / 4 : 0);
    const target = req.target?.resolved?.a11y_name ?? req.target?.value ?? '';
    return this.guards(obs.state_id, `${req.verb}:${target}:${String(req.args?.text ?? '').slice(0, 10)}`, !!obs.is_new_state);
  }

  /** 防噪声护栏：循环检测、新颖度预算（§8.2） */
  private async guards(stateId: string, actKey: string, isNew: boolean): Promise<StepOutcome> {
    const zh = this.lang === 'zh';
    const key = `${stateId}|${actKey}`; const n = (this.loopTracker.get(key) ?? 0) + 1; this.loopTracker.set(key, n);
    if (n >= this.cfg.guards.loop_repeat_n) {
      this.loopHits++; this.loopTracker.set(key, 0);
      await putEvidence('action', { study_id: this.study.id, session_id: this.sess.id, step_idx: this.stepIdx - 1 }, { inline: { error: makeError('SIM_LOOP', `同一状态同一动作重复 ${n} 次：${actKey}`) } });
      if (this.loopHits >= 2) return this.end('stalled', `SIM_LOOP: ${actKey}`);
      this.loopNote = zh ? '你发现自己一直在重复同一个操作，但什么都没改变。' : 'You notice you keep doing the same thing and nothing changes.';
    }
    this.noNewState = isNew ? 0 : this.noNewState + 1;
    if (this.noNewState >= this.cfg.guards.novelty_budget_k) return this.end('stalled', zh ? `连续 ${this.noNewState} 步没有进入新状态` : `${this.noNewState} steps without a new state`);
    return { done: false };
  }

  private readingSeconds(summary: string) {
    const chars = summary.length * (this.persona.behavior_policy.reading === 'scan' ? 0.35 : 1);
    return Math.min(120, (chars / this.persona.capability.cognition.reading_speed_cpm) * 60);
  }

  private targetHiddenByPerception(intent: string, raw: { ref: string; name: string; kind: string; in_viewport: boolean }[], perceived: PerceivedElement[]) {
    const seen = new Set(perceived.map((p) => p.ref));
    const hit = raw.find((e) => e.kind === 'interactive' && e.name && e.name.length >= 2 && intent.includes(e.name.slice(0, 12)) && !seen.has(e.ref));
    return hit?.name;
  }

  private modeHint(): string {
    const zh = this.lang === 'zh';
    const m = this.sess.mode as Mode;
    if (m === 'curiosity') return zh ? '（你不赶时间，随便逛逛，看到感兴趣的就点开看看。）' : '(No rush — you wander and open whatever catches your interest.)';
    if (m === 'adversarial') return zh ? '（按你自己的脾气来。）' : '(Do it your own way.)';
    return '';
  }

  private buildRequest(op: Awaited<ReturnType<typeof runOperator>>, mind: MindOut, motor: ReturnType<typeof motorProfile>, idx: number, perceived: PerceivedElement[]): ActionRequest {
    const verb = op.feasible ? op.verb : 'scroll';
    const ref = op.ref && perceived.some((p) => p.ref === op.ref) ? op.ref : '';
    const needsTarget = ['click', 'type', 'select', 'hover', 'long_press', 'upload', 'speak', 'show_camera', 'drag'].includes(verb);
    const target = needsTarget ? (ref ? { by: 'ref' as const, value: ref } : { by: 'visual' as const, value: op.target_description || mind.intent }) : undefined;
    const any_of: Criterion[] = [];
    if (op.expect_url_change) any_of.push({ kind: 'url_changed' });
    if (op.expect_text) any_of.push({ kind: 'content_appeared', text: op.expect_text.slice(0, 40) });
    const args: Record<string, unknown> = {};
    if (verb === 'type' || verb === 'speak') { args.text = op.text || mind.input_text; args.submit = op.submit_after_typing; args.clear = op.clear_first; }
    if (verb === 'show_camera') args.prompt = op.text || mind.input_text || mind.intent;
    if (verb === 'key') args.key = op.key || 'Enter';
    if (verb === 'scroll') { args.direction = op.direction === 'up' ? 'up' : 'down'; args.amount = 600; }
    if (verb === 'navigate') args.url = op.url;
    if (verb === 'select') args.value = op.option_value || op.text;
    if (verb === 'wait') args.seconds = 8;
    if (verb === 'upload') args.file = op.text;
    const base: ActionRequest = { action_id: newId('act'), session_id: this.sess.id, step_idx: idx, verb, target, args, intent_text: mind.intent, expectation: mind.expectation, success: { any_of: [], within_ms: 3000 }, motor, timeout_ms: 20000, risk_tags: op.risk_tags };
    if (any_of.length) base.success = { any_of: [...any_of, { kind: 'dom_changed' }], within_ms: verb === 'type' ? 2000 : 4000 };
    if (verb === 'type' && !op.submit_after_typing) base.success = { any_of: [], within_ms: 2000 };
    return base;
  }

  /** Session 结束：证据入库、记忆写回、结局与路径签名 */
  async finish(): Promise<{ outcome: string; end_reason: string }> {
    const db = getDb();
    const end = this.ended ?? { outcome: 'sim_error', end_reason: 'not ended' };
    const ev = await this.browser.close().catch(() => ({} as { video_ev?: string; har_ev?: string; rrweb_ev?: string }));
    const st = await db.select().from(steps).where(eq(steps.session_id, this.sess.id)).orderBy(steps.idx);
    const obsRows = await db.select({ state_id: observations.state_id, url: observations.url }).from(observations).where(eq(observations.session_id, this.sess.id)).orderBy(observations.step_idx);
    const pathSig = shortHash(obsRows.map((o) => o.state_id).filter((s, i, a) => a[i - 1] !== s).join('>'), 16);
    let memoryResult: unknown;
    try {
      const diary = st.map((s) => `[${s.sim_clock}] ${s.intent ?? ''} — ${s.monologue ?? ''}`).join('\n').slice(0, 6000);
      memoryResult = await consolidate({ persona: this.persona, appId: this.appId, appName: this.appName, sessionId: this.sess.id, studyId: this.study.id, simDay: this.sess.revisit_day, simTime: this.world.state.sim_clock, outcome: end.outcome, endReason: end.end_reason, diary });
    } catch (e) { logger.warn({ err: String((e as Error).message).slice(0, 200) }, '记忆整理失败'); }
    await db.update(sessions).set({ status: 'finished', outcome: end.outcome, end_reason: end.end_reason.slice(0, 500), ended_at: new Date(), video_ev: ev.video_ev, har_ev: ev.har_ev, rrweb_ev: ev.rrweb_ev, path_signature: pathSig, summary: { final_state: this.state, world: this.world.state, memory: memoryResult, objective_completion: this.signals.length ? taskCompleted(this.signals, this.obsLog).done : null } }).where(eq(sessions.id, this.sess.id));
    SessionRunner.registry.delete(this.sess.id);
    logger.info({ session: this.sess.id, outcome: end.outcome, steps: this.stepIdx }, 'Session 结束');
    return end;
  }

  async abort(reason: string) { this.ended ??= { outcome: 'sim_error', end_reason: reason }; return this.finish(); }
}

/** 人工接管完成后恢复 */
export async function resolveHumanTask(taskId: string, status: 'resolved' | 'timeout' | 'cancelled', note?: string) {
  const db = getDb();
  await db.update(humanTasks).set({ status, resolved_at: new Date(), note }).where(and(eq(humanTasks.id, taskId), eq(humanTasks.status, 'pending')));
  const t = (await db.select().from(humanTasks).where(eq(humanTasks.id, taskId)))[0];
  if (t) await db.update(sessions).set({ status: 'running' }).where(eq(sessions.id, t.session_id));
  return t;
}
