// Simulation Runtime：World Simulator → Persona Mind ↔ Operator → UAP(+Policy Gate) → 真实产品（§4、§5）
import { existsSync } from 'node:fs';
import { cityCoords, dataPath, deviceFor, loadConfig, logger, makeError, newId, Rng, shortHash, langOf, type ActionRequest, type ActionResult, type Criterion, type DynamicState, type PersonaSpec, type StudyInput, type WorldTemplate, type Mode } from '@pux/core';
import { and, appVersions, apps, eq, getDb, goals, humanTasks, isNotNull, mailbox, observations, sessions, steps, studies, taskDefs, worldTemplates } from '@pux/db';
import { BrowserSession, policyFor, putEvidence } from '@pux/executor';
import { LlmError } from '@pux/llm';
import { feelings, updateState } from '../human/state.ts';
import { freezePersona, getPersona, initialState, motorProfile } from '../human/persona.ts';
import { perceive, type Rect } from '../human/perception.ts';
import { consolidate, lifeBetween, recall } from '../human/memory.ts';
import { WorldSimulator } from '../world/simulator.ts';
import { contextRecord, nextFreeContext, saveSessionContext, stateFromContext, type ContextRecord } from '../world/live.ts';
import { saveNeeds, tiesOf, toMin as toMinutes } from '@pux/jobsworld';
import { accountHint } from '../exploration/goals.ts';
import { amountIn, identityHint, payFromWallet, unseenMail } from '../launch/identity.ts';
import { taskCompleted } from '../product/intelligence.ts';
import { mailDomain } from '../mail/settings.ts';
import { ensureMailRoute } from '../mail/routes.ts';
import { installWebmail } from '../mail/webmail.ts';
import { normalizeKey, runMind, type MindOut } from './roles.ts';

export type StepOutcome = { done: false; needsHuman?: { reason: string; takeover: string; task_id: string } } | { done: true; outcome: string; end_reason: string };

interface Hist { intent: string; outcome: string; monologue: string }

/** 上一步的结果在人物眼里是什么样：只说看得见的（屏幕变没变、弹没弹窗、有没有点中），不说任何技术原因 */
const describeResult = (r: ActionResult | undefined, zh: boolean, child: boolean): string => {
  if (!r) return '';
  if (r.status === 'blocked_by_policy') return zh ? (child ? '你想起爸爸妈妈说过不能自己乱买东西/加陌生人，就没有真的点下去' : '你犹豫了一下，最后没有真的提交（这一步不会真的发生）') : (child ? 'you remembered your parents said not to buy things or add strangers on your own, so you stopped' : 'you hesitated and did not actually submit (this step will not really happen)');
  if (r.status === 'needs_human') return zh ? '屏幕上要求额外验证' : 'the screen asked for extra verification';
  if (r.error?.code === 'INJECTED_NETWORK' || r.error?.code === 'ENV_NETWORK') return zh ? '网络很卡，没加载出来' : 'the network was too slow, nothing loaded';
  if (r.error?.code === 'PRODUCT_SMALL_TARGET' || r.error?.code === 'SIM_MOTOR_MISS') return zh ? '手一滑好像没点准' : 'your finger slipped and you missed';
  if (r.error?.code === 'EXEC_INTERCEPTED') return zh ? '想点的东西被别的东西挡住了' : 'something was covering what you wanted to tap';
  if (r.error?.code?.startsWith('EXEC_') || r.error?.code === 'SIM_INVALID_INTENT') return zh ? '在屏幕上没找到你想点的那个东西' : "you couldn't find the thing you meant on the screen";
  if (r.status === 'no_effect') return zh ? '屏幕上看不出任何变化' : 'nothing on the screen seemed to change';
  if (r.effects.new_dialog) return zh ? '弹出了一个窗口' : 'a popup appeared';
  if (r.effects.url_changed) return zh ? '换了一个页面' : 'you landed on a different page';
  return zh ? '屏幕有了变化' : 'the screen changed';
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
  cancelled = false;
  private obsLog: { url: string; text: string }[] = [];
  private interruptionNote?: string;
  private loopNote?: string;
  private memories: string[] = [];
  private appName = '';
  private appId = '';
  private startUrl = '';
  private memScope?: Set<string>;
  private goalText = '';
  private signals: { kind: string; value: string }[] = [];
  private cfg = loadConfig();
  private study!: { id: string; config: StudyInput };
  private sess!: typeof sessions.$inferSelect;
  private rng!: Rng;
  private ended?: { outcome: string; end_reason: string };
  private worldTpl!: WorldTemplate;
  private screenOn = true;
  private mobile = false;
  /** 记忆与态度用的日期序号：合并世界里是世界的日子，场景模板里是回访天数 */
  private simDay = 0;
  private live?: ContextRecord;
  /** 上一步「凑近看」的区域，只对下一眼有效 */
  private focus?: Rect;
  private refreshes = 0;
  private foundVia?: string; private visit = 1; private fromLaunch = false;
  private inboxNotes: string[] = [];
  /** 这个设备上的邮箱 App 地址；inMail = 屏幕上现在是邮箱 */
  private mailUrl = ''; private inMail = false; private mailSince = 0;

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
    // 发布主线：这个人是怎么遇到它的（商店、广告、熟人…），以及他从哪个地址进来（有落地页时先到落地页）
    const pr = (this.sess.plan_reason ?? {}) as { entry_url?: string; found?: string; visit?: number; launch_id?: string };
    if (pr.entry_url) this.startUrl = pr.entry_url;
    this.foundVia = pr.found; this.visit = pr.visit ?? 1; this.fromLaunch = !!pr.launch_id;
    const p = await getPersona(this.sess.persona_id, this.sess.persona_version);
    if (!p) throw new Error(`Persona 不存在：${this.sess.persona_id}@${this.sess.persona_version}`);
    this.persona = p.spec; this.personaVersion = p.version; this.lang = langOf(p.spec.locale);
    await freezePersona(p.spec.id, p.version);
    // 合并世界：这次使用发生在这个人此时此地在城里的处境里（规划时已记录；没有记录就现算一份）
    let rec = this.sess.world_context as ContextRecord | null;
    if (this.sess.world_template_id === 'live' && !rec?.template) { const lc = await nextFreeContext(this.persona.id); if (!lc) throw new Error(`无法计算 ${this.persona.id} 的处境`); rec = contextRecord(lc); await saveSessionContext(sessionId, rec); }
    const tpl = rec?.template ?? (await db.select().from(worldTemplates).where(eq(worldTemplates.id, this.sess.world_template_id)))[0]?.spec as WorldTemplate | undefined;
    if (!tpl) throw new Error(`世界不存在：${this.sess.world_template_id}`);
    this.worldTpl = tpl; this.simDay = rec ? rec.day + this.sess.revisit_day : this.sess.revisit_day;
    this.rng = new Rng(this.sess.rng_seed);
    this.world = new WorldSimulator(this.worldTpl, this.rng, this.lang, this.simDay, { study_id: st.id, session_id: sessionId });
    this.state = rec ? stateFromContext(initialState(p.spec), rec) : initialState(p.spec);
    this.live = rec ?? undefined;
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
    if (av.reset_url) this.memScope = new Set((await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.study_id, st.id))).map((x) => x.id));
    const mem = await recall(this.persona.id, this.appId, `${this.appName} ${this.goalText}`, this.simDay, undefined, this.memScope, this.persona).catch(() => []);
    // 想起一件事时，也会想起与之相反的经历（记忆树里的冲突边）
    this.memories.push(...mem.map((m) => (m.conflicts_with ? (this.lang === 'zh' ? `不过你也记得：${m.content}` : `But you also remember: ${m.content}`) : m.content)));
    this.memories.push(this.fromLaunch ? await identityHint(this.persona) : accountHint(this.persona, this.appId));
    // 同一个网页产品，在路上用手机开，在办公桌前用电脑开：设备跟着人此时此地的处境走
    this.mobile = app.form === 'h5' || deviceFor({ device: this.worldTpl.device, scenario_class: this.worldTpl.scenario_class, init: { ...this.worldTpl.init, place: this.world.state.place, motion: this.world.state.motion, channels: this.world.state.channels } }) === 'phone';
    this.browser = await BrowserSession.launch({ sessionId, studyId: st.id, personaId: this.persona.id, executor: 'midscene', headed: opts.headed ?? this.study.config.headed, mobile: this.mobile, locale: this.persona.locale, policy: policyFor(this.persona), rng: this.rng, deviceStateFile: dataPath('runtime', 'devices', st.id, `${this.persona.id}.json`), geolocation: this.persona.psychology.privacy_sensitivity >= 0.75 ? null : (([lat, lng]) => ({ latitude: lat + this.rng.normal(0, 0.02), longitude: lng + this.rng.normal(0, 0.02) }))(cityCoords(this.persona.identity.region)) });
    // 城里给的邮箱：确保他的地址在 Cloudflare 上能收信，并在这个设备上装好邮箱 App
    await ensureMailRoute(this.persona.id).catch((e) => logger.warn({ err: String((e as Error).message).slice(0, 160) }, '开通收信失败'));
    this.mailUrl = await installWebmail(this.browser.ctx, { personaId: this.persona.id, domain: await mailDomain(), zh: this.lang === 'zh', mobile: this.mobile }).catch(() => '');
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
    for (const cue of this.world.takeMemoryCues()) { const m = await recall(this.persona.id, this.appId, cue, this.simDay, 2, this.memScope).catch(() => []); this.memories.push(cue, ...m.map((x) => x.content)); }
    // 虚拟身份：产品发来的邮件和短信，他真的收得到
    const mails = await unseenMail(this.persona.id).catch(() => []);
    // 短信的推送显示全文；邮件的推送只有发件人和标题，正文要自己切到邮箱去看
    const who = (x: string | null) => (x ?? '').replace(/<[^>]*>/g, '').replace(/"/g, '').trim();
    this.inboxNotes = mails.map((m) => m.kind === 'sms'
      ? (zh ? `你的手机收到一条短信${m.sender ? `（${m.sender}）` : ''}：${m.body.slice(0, 300)}` : `You got a text message${m.sender ? ` (${m.sender})` : ''}: ${m.body.slice(0, 300)}`)
      : (zh ? `${this.mobile ? '手机响了一下，屏幕上方弹出新邮件提醒' : '邮箱弹出新邮件提醒'}：${who(m.sender)}${m.subject ? `「${m.subject.slice(0, 80)}」` : ''}` : `${this.mobile ? 'Your phone buzzes with a new-mail notification' : 'A new-mail notification pops up'}: ${who(m.sender)}${m.subject ? ` "${m.subject.slice(0, 80)}"` : ''}`));
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
      void import('../launch/notice.ts').then((m) => m.emitNotice({ kind: 'human', task_id: tid, session_id: this.sess.id, reason: zh ? '页面出现人机验证（验证码）' : 'Captcha detected', ts: Date.now() }));
      await db.update(sessions).set({ status: 'waiting_human' }).where(eq(sessions.id, this.sess.id));
      return { done: false, needsHuman: { reason: 'ENV_CAPTCHA', takeover, task_id: tid } };
    }

    // ---- 3. 感知滤镜：真实截图 → 这个人这一眼看到的画面
    const cons = this.world.constraints();
    const perc = await perceive({ persona: this.persona, elements: obs.elements, screenshotEv: obs.screenshot_ev, eyes: cons.hard.glance ? 'glance' : 'full', attention: this.state.attention, stress: this.state.stress, viewport: { w: obs.viewport.w, h: obs.viewport.h }, focus: this.focus, ctx: { ...tags, persona_id: this.persona.id } });
    this.focus = undefined;

    // ---- 4. Persona Mind
    const modeHint = this.modeHint();
    let mind: MindOut;
    try {
      mind = await runMind({ persona: this.persona, lang: this.lang, device: this.mobile ? 'phone' : 'computer', situation: this.world.situation, worldNow: this.world.describeForPersona(), lifeGoal: this.goalText, modeHint, feelings: feelings(this.state, this.lang), memories: this.memories.slice(-8), priorKnowledge: this.sess.revisit_day > 0 || this.visit > 1 ? 'used_before' : this.persona.prior_knowledge, foundVia: this.foundVia, appName: this.appName, history: this.hist, image: perc.image, zoom: perc.zoom, events: [...events.filter((e) => e.perceived).map((e) => e.perceived_text ?? e.text), ...this.inboxNotes, ...obs.notifications.map((n) => (zh ? `屏幕上方弹出通知：${n}` : `a notification popped up: ${n}`))], interruptionNote: this.interruptionNote, loopNote: this.loopNote, pageUrlHint: obs.url.replace(/^https?:\/\//, '').replace(/[?#].*$/, '').slice(0, 60), step: idx, maxSteps, inMail: this.inMail }, tags);
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
    const baseStep = { id: stepId, session_id: this.sess.id, idx, world_state_id: wsId, observation_id: obs.obs_id, perceived_summary: perc.note, monologue: mind.monologue, expectation: mind.expectation, dynamic_state: { ...this.state, emotion: mind.emotion, perceived_hidden: perc.hidden_count, unreadable: perc.unreadable }, intent: mind.intent, decision: mind.decision, sim_clock: this.world.state.sim_clock, tokens: 0 };

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

    // ---- 7. 想法 → 手上的一个动作（没有中间人：人自己知道要点、要滑还是要打字）
    const motor = motorProfile(this.persona, cons.list.concat(cons.hard.one_handed ? ['one_handed'] : []), this.state);
    let req: ActionRequest;
    const soft = async (verb: string, ok: boolean, outcome: string, err?: ReturnType<typeof makeError>, simSeconds = 4): Promise<StepOutcome> => {
      // 不碰屏幕的一步（凑近看、没刷成）：照常记一步，时间照常流逝
      const fake: ActionResult = { action_id: newId('act'), status: ok ? 'success' : 'failed', matched_criteria: [], error: err, started_at: new Date().toISOString(), ended_at: new Date().toISOString(), duration_ms: 0, executor: { name: 'midscene', version: '-' }, before_obs: obs.obs_id, after_obs: obs.obs_id, effects: { url_changed: false, dom_changed: false, requests: 0, new_dialog: false, visible_change: ok }, evidence_ids: [monoEv] };
      await finishStep({ action_request: { verb, intent_text: mind.intent, target: { by: 'visual', value: mind.target_look, text: mind.target_text } }, action_result: fake } as never);
      this.prevExpectation = mind.expectation; this.prevResult = fake;
      this.hist.push({ intent: mind.intent, outcome, monologue: mind.monologue });
      this.pendingSimSeconds = this.readingSeconds(perc.read_chars) + simSeconds;
      return this.guards(obs.state_id, `${verb}:${mind.target_text || mind.target_look}`.slice(0, 60), !!obs.is_new_state);
    };
    if (mind.decision === 'wait') {
      const secs = Math.min(40, Math.max(3, this.persona.behavior_policy.wait_tolerance_s * 1.5));
      req = { action_id: newId('act'), session_id: this.sess.id, step_idx: idx, verb: 'wait', args: { seconds: secs }, intent_text: mind.intent, expectation: mind.expectation, success: { any_of: [{ kind: 'dom_changed' }], within_ms: 1000 }, motor, timeout_ms: secs * 1000 + 5000 };
    } else {
      if (mind.action === 'look_closer') {
        // 凑近看：把注意力放到屏幕的一块上。下一眼那一块是清楚的，其余照旧
        try {
          const loc = await this.browser.resolveTarget({ by: 'visual', value: mind.target_look, text: mind.target_text }, mind.intent);
          const b = loc.el?.bbox;
          this.focus = b && b[2] < obs.viewport.w * 0.9 && b[3] < obs.viewport.h * 0.6 ? { x: b[0], y: b[1], w: b[2], h: b[3] } : { x: loc.point[0] - 170, y: loc.point[1] - 100, w: 340, h: 200 };
          return soft('look_closer', true, zh ? '你凑近仔细看了看那一块' : 'you looked closely at that part', undefined, 5 + 4 * (1 - this.persona.capability.body.vision));
        } catch (e) { return soft('look_closer', false, zh ? '在屏幕上没找到你想细看的那个东西' : "you couldn't find the thing you wanted to look at", makeError('EXEC_TARGET_NOT_FOUND', String((e as Error).message).slice(0, 160))); }
      }
      if (mind.action === 'check_mail' || mind.action === 'back_to_app') return this.switchApp(mind.action === 'check_mail' ? 'mail' : 'main', soft);
      if (mind.action === 'refresh') {
        // 普通人最多刷一次：刷过没用就不会再刷（禁止技术自救式的反复重试）
        if (this.refreshes >= 1) return soft('reload', false, zh ? '你已经刷新过一次了，还是老样子' : 'you already refreshed once and nothing changed', makeError('SIM_INVALID_INTENT', 'repeat refresh suppressed'), 2);
        this.refreshes++;
      }
      req = this.buildRequest(mind, motor, idx, obs.viewport.h);
    }

    // ---- 8. 执行（UAP + Policy Gate）
    const res = await this.browser.act(req, this.rng);
    if (req.verb === 'wait') this.lastWaitS = res.duration_ms / 1000;
    await finishStep({ action_request: req as never, action_result: res as never });
    this.prevExpectation = mind.expectation; this.prevResult = res;
    this.hist.push({ intent: mind.intent, outcome: describeResult(res, zh, this.persona.kind === 'child'), monologue: mind.monologue });
    if (res.error?.code === 'ENV_BROWSER_CRASH') return this.end('sim_error', 'ENV_BROWSER_CRASH');
    // 沙箱付款成功：从这个人的钱包里扣掉屏幕上写的金额
    if (res.status === 'success' && req.verb === 'click' && /支付|付款|pay|purchase|buy now|checkout/i.test(`${req.target?.text ?? ''} ${res.resolved_target?.resolved?.a11y_name ?? ''}`)) { const amt = amountIn(`${req.target?.text ?? ''} ${res.resolved_target?.resolved?.a11y_name ?? ''} ${mind.intent}`); if (amt && amt < 100_000) await payFromWallet(this.persona.id, amt).catch(() => {}); }
    // 模拟耗时：阅读 + 思考 + 动作 + 打字
    const typed = String(req.args?.text ?? '').length;
    this.pendingSimSeconds = this.readingSeconds(perc.read_chars) + 3 + 5 * (1 - this.persona.capability.digital_literacy) + res.duration_ms / 1000 + (req.verb === 'type' ? (req.args?.paste ? 2 : typed / motor.typing_cps) : 0) + (req.verb === 'speak' ? typed / 4 : 0);
    const target = req.target?.text || res.resolved_target?.resolved?.a11y_name || req.target?.value || '';
    return this.guards(obs.state_id, `${req.verb}:${target}:${String(req.args?.text ?? '').slice(0, 10)}`, !!obs.is_new_state);
  }

  /** 在产品和邮箱之间切换。切过去、找到地方都要花时间（手机、单手、不熟练更慢）；
   *  从邮箱切回来时，工作记忆小、压力大、在邮箱里待得久的人可能记不清刚才看到的验证码，只能再切回去看 */
  private async switchApp(to: 'mail' | 'main', soft: (verb: string, ok: boolean, outcome: string, err?: ReturnType<typeof makeError>, simSeconds?: number) => Promise<StepOutcome>): Promise<StepOutcome> {
    const zh = this.lang === 'zh';
    if (!this.mailUrl) return soft('switch_app', false, zh ? '这台设备上找不到邮箱' : "there's no mail app on this device", makeError('SIM_INVALID_INTENT', 'no mail app'), 2);
    if ((to === 'mail') === this.inMail) return soft('switch_app', false, to === 'mail' ? (zh ? '你已经在邮箱里了' : 'you are already in your email') : (zh ? '你已经在这个应用里了' : 'you are already in the app'), makeError('SIM_INVALID_INTENT', 'already there'), 1);
    const one = this.world.constraints().hard.one_handed;
    const secs = (this.mobile ? this.rng.int(4, 9) : this.rng.int(2, 5)) * (one ? 1.5 : 1) + 6 * (1 - this.persona.capability.digital_literacy);
    await this.browser.showTab(to, to === 'mail' ? this.mailUrl : undefined);
    let forgot = false;
    if (to === 'main') {
      const awayS = (this.world.state.sim_minute - this.mailSince) * 60;
      const codes = await this.codesSeen();
      const wm = this.persona.capability.cognition.working_memory;
      const pForget = Math.min(0.6, 0.04 + (1 - wm) * 0.35 + this.state.stress * 0.15 + (awayS > 90 ? 0.1 : 0) + (one ? 0.05 : 0));
      if (codes.length && this.rng.bool(pForget)) {
        forgot = true;
        const blur = (t: string) => codes.reduce((x, c) => x.split(c).join(zh ? '（记不清了）' : '(can’t recall)'), t);
        this.hist = this.hist.map((h) => ({ ...h, intent: blur(h.intent), monologue: blur(h.monologue) }));
        this.memories = this.memories.map(blur);
        this.interruptionNote = zh ? '切回来以后，刚才在邮件里看到的验证码你一下子记不清了。' : 'Back in the app, you suddenly can’t quite recall the code you just saw in the email.';
      }
    } else this.mailSince = this.world.state.sim_minute;
    this.inMail = to === 'mail';
    const out = await soft('switch_app', true, to === 'mail' ? (zh ? '你切到了邮箱' : 'you switched to your email') : (zh ? `你切回了「${this.appName}」` : `you switched back to "${this.appName}"`), undefined, secs);
    await getDb().update(steps).set({ action_request: { verb: 'switch_app', to, forgot, sim_seconds: Math.round(secs) } as never }).where(and(eq(steps.session_id, this.sess.id), eq(steps.idx, this.stepIdx - 1)));
    return out;
  }

  /** 这次使用里他在邮箱里点开过的信中的验证码（仪器提取的，只用来判断「记不记得住」） */
  private async codesSeen(): Promise<string[]> {
    const rows = await getDb().select({ x: mailbox.extracted }).from(mailbox).where(and(eq(mailbox.persona_id, this.persona.id), isNotNull(mailbox.opened_at), eq(mailbox.session_id, this.sess.id)));
    return [...new Set(rows.flatMap((r) => r.x?.codes ?? []))];
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

  /** 读屏幕花的时间：按这一眼实际读到的字数和这个人的阅读速度结算 */
  private readingSeconds(chars: number) {
    return Math.min(120, (chars / this.persona.capability.cognition.reading_speed_cpm) * 60);
  }

  private modeHint(): string {
    const zh = this.lang === 'zh';
    const m = this.sess.mode as Mode;
    if (m === 'curiosity') return zh ? '（你不赶时间，随便逛逛，看到感兴趣的就点开看看。）' : '(No rush — you wander and open whatever catches your interest.)';
    if (m === 'adversarial') return zh ? '（按你自己的脾气来。）' : '(Do it your own way.)';
    return '';
  }

  private buildRequest(mind: MindOut, motor: ReturnType<typeof motorProfile>, idx: number, viewportH: number): ActionRequest {
    const map = { tap: 'click', type: 'type', scroll: 'scroll', go_back: 'back', press_key: 'key', long_press: 'long_press', hover: this.mobile ? 'click' : 'hover', drag: 'drag', speak: 'speak', show_camera: 'show_camera', refresh: 'reload', none: 'click', look_closer: 'click', check_mail: 'click', back_to_app: 'click' } as const;
    const verb = map[mind.action];
    const described = !!(mind.target_text.trim() || mind.target_look.trim());
    const mustTarget = ['click', 'long_press', 'hover', 'drag'].includes(verb);
    const mayTarget = ['type', 'speak', 'show_camera', 'scroll'].includes(verb) && described;
    const target = mustTarget || mayTarget ? { by: 'visual' as const, value: mind.target_look.trim() || (mind.target_text.trim() ? '' : mind.intent), text: mind.target_text.trim() || undefined } : undefined;
    const args: Record<string, unknown> = {};
    if (verb === 'type' || verb === 'speak') { args.text = mind.input_text; args.submit = mind.submit_with_enter; args.clear = mind.replace_existing; args.paste = mind.paste || /粘贴|paste/i.test(mind.intent); }
    if (verb === 'show_camera') args.prompt = mind.input_text || mind.intent;
    if (verb === 'key') args.key = normalizeKey(mind.key) ?? 'Enter';
    if (verb === 'scroll') { args.direction = mind.scroll_direction === 'up' ? 'up' : 'down'; args.amount = Math.round(viewportH * (this.persona.behavior_policy.reading === 'scan' ? 0.8 : 0.6)); }
    if (verb === 'drag') args.dy = mind.scroll_direction === 'up' ? -200 : 200;
    return { action_id: newId('act'), session_id: this.sess.id, step_idx: idx, verb, target, args, intent_text: mind.intent, expectation: mind.expectation, success: { any_of: [], within_ms: verb === 'type' ? 2000 : 3000 }, motor, timeout_ms: 20000 };
  }

  /** Session 结束：证据入库、记忆写回、结局与路径签名 */
  async finish(): Promise<{ outcome: string; end_reason: string }> {
    const db = getDb();
    const end = this.ended ?? { outcome: 'sim_error', end_reason: 'not ended' };
    // 产品被清零或下线：这次使用连同它的记录一起作废，不整理记忆、不写结局
    if (this.cancelled) { await this.browser.close().catch(() => {}); SessionRunner.registry.delete(this.sess.id); return end; }
    const ev = await this.browser.close().catch(() => ({} as { video_ev?: string; har_ev?: string; rrweb_ev?: string }));
    const st = await db.select().from(steps).where(eq(steps.session_id, this.sess.id)).orderBy(steps.idx);
    const obsRows = await db.select({ state_id: observations.state_id, url: observations.url }).from(observations).where(eq(observations.session_id, this.sess.id)).orderBy(observations.step_idx);
    const pathSig = shortHash(obsRows.map((o) => o.state_id).filter((s, i, a) => a[i - 1] !== s).join('>'), 16);
    let memoryResult: unknown;
    try {
      const diary = st.map((s) => `[${s.sim_clock}] ${s.intent ?? ''} — ${s.monologue ?? ''}`).join('\n').slice(0, 6000);
      memoryResult = await consolidate({ persona: this.persona, appId: this.appId, appName: this.appName, sessionId: this.sess.id, studyId: this.study.id, simDay: this.simDay, simTime: this.world.state.sim_clock, outcome: end.outcome, endReason: end.end_reason, diary, ties: this.fromLaunch ? (await tiesOf(this.persona.id).catch(() => [])).slice(0, 8).map((t) => t.name) : [] });
    } catch (e) { logger.warn({ err: String((e as Error).message).slice(0, 200) }, '记忆整理失败'); }
    await db.update(sessions).set({ status: 'finished', outcome: end.outcome, end_reason: end.end_reason.slice(0, 500), ended_at: new Date(), video_ev: ev.video_ev, har_ev: ev.har_ev, rrweb_ev: ev.rrweb_ev, path_signature: pathSig, summary: { final_state: this.state, world: this.world.state, memory: memoryResult, objective_completion: this.signals.length ? taskCompleted(this.signals, this.obsLog).done : null } }).where(eq(sessions.id, this.sess.id));
    // 用完之后：这次经历留下的心情和压力带回他在城里的生活（世界服务从这里接着往下算）
    if (this.live) {
      const elapsed = Math.max(1, Math.round(this.world.state.sim_minute - toMinutes(this.live.clock)));
      await saveNeeds(this.persona.id, { hunger: this.state.hunger, energy: Math.max(0, Math.min(1, 1 - this.state.fatigue)), social: this.live.needs.social, stress: this.state.stress, mood: this.state.mood, at: this.live.needs.at + elapsed }).catch(() => {});
    }
    SessionRunner.registry.delete(this.sess.id);
    logger.info({ session: this.sess.id, outcome: end.outcome, steps: this.stepIdx }, 'Session 结束');
    return end;
  }

  async abort(reason: string) { this.ended ??= { outcome: 'sim_error', end_reason: reason }; return this.finish(); }
  /** 作废这次使用（产品被清零或下线）：当前这一步做完就停，结束时什么也不留下 */
  cancel() { this.cancelled = true; this.ended ??= { outcome: 'cancelled', end_reason: 'launch reset or removed' }; }
}

/** 人工接管完成后恢复 */
export async function resolveHumanTask(taskId: string, status: 'resolved' | 'timeout' | 'cancelled', note?: string) {
  const db = getDb();
  await db.update(humanTasks).set({ status, resolved_at: new Date(), note }).where(and(eq(humanTasks.id, taskId), eq(humanTasks.status, 'pending')));
  const t = (await db.select().from(humanTasks).where(eq(humanTasks.id, taskId)))[0];
  if (t) await db.update(sessions).set({ status: 'running' }).where(eq(sessions.id, t.session_id));
  return t;
}
