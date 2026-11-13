// Experience Control Plane：Study 生命周期、规划、编排（§3、§5、§18）
import { execFile } from 'node:child_process';
import { loadConfig, logger, newId, seedFrom, StudyInputSchema, langOf, type StudyInput, type Mode, type ActionRequest } from '@pux/core';
import { and, appVersions, apps, eq, features, getDb, humanTasks, inArray, observations, sessions, steps, studies, desc, issues } from '@pux/db';
import { checkVendorIsolation } from '@pux/llm';
import { activePersonas, getPersona } from '../human/persona.ts';
import { allWorldTemplates } from '../world/simulator.ts';
import { planRound } from '../exploration/sampler.ts';
import { makeLifeGoal } from '../exploration/goals.ts';
import { touch } from '../exploration/coverage.ts';
import { SessionRunner, resolveHumanTask } from '../runtime/session-runner.ts';
import { extractCandidates, objectiveMetrics } from '../evaluation/objective.ts';
import { evaluateAiQuality, judgeSession } from '../evaluation/judges.ts';
import { postSessionInterview } from '../evaluation/interview.ts';
import { aggregateScores, evaluateHypotheses, synthesizeIssues } from '../evaluation/issues.ts';
import { calibrateSeeded, learnFromCalibration } from '../calibration/index.ts';
import { generateReport } from '../intelligence/report.ts';

export type Progress = (msg: string, data?: Record<string, unknown>) => void;

/** POST /studies 的统一实现：所有入口（CLI / 控制台 / API）都调用它，用幂等键防止重复运行 */
export async function createStudy(raw: Partial<StudyInput> & { app_version_id: string }): Promise<{ id: string; existing: boolean; isolation_warning?: string }> {
  const input = StudyInputSchema.parse(raw);
  const db = getDb();
  if (input.idempotency_key) {
    const ex = (await db.select().from(studies).where(eq(studies.idempotency_key, input.idempotency_key)))[0];
    if (ex) return { id: ex.id, existing: true, isolation_warning: ex.isolation_warning ?? undefined };
  }
  const cfg = loadConfig();
  const iso = checkVendorIsolation(['judge_0', 'judge_1', 'judge_2'].slice(0, input.judges));
  if (!iso.ok && cfg.vendor_isolation === 'strict') throw new Error(`厂商隔离校验未通过（strict）：${iso.warnings.join('；')}`);
  const id = newId('std');
  const warning = iso.ok ? undefined : `未做到厂商隔离：${iso.warnings.join('；')}。评审与 Persona Mind 可能共享偏见，相关结论可信度已自动降一级。`;
  await db.insert(studies).values({ id, app_version_id: input.app_version_id, name: input.name, trigger: input.trigger, config: input, idempotency_key: input.idempotency_key, rng_seed: seedFrom(id) % 1_000_000, isolation_warning: warning });
  return { id, existing: false, isolation_warning: warning };
}

async function studyCtx(studyId: string) {
  const db = getDb();
  const study = (await db.select().from(studies).where(eq(studies.id, studyId)))[0];
  if (!study) throw new Error(`Study 不存在：${studyId}`);
  const av = (await db.select().from(appVersions).where(eq(appVersions.id, study.app_version_id)))[0];
  const app = (await db.select().from(apps).where(eq(apps.id, av.app_id)))[0];
  return { study, av, app, config: study.config as StudyInput };
}

/** 规划一轮：自适应采样 → 生活目标 → Session 计划 */
export async function planNextRound(studyId: string, round: number, size: number, opts: { revisitDay?: number; revisitOf?: string[] } = {}): Promise<string[]> {
  const db = getDb(); const { study, av, app, config } = await studyCtx(studyId);
  const personas = await activePersonas({ includeChildren: config.include_children, locale: config.locale });
  if (!personas.length) throw new Error('没有可用的 Persona（先 pux persona import）');
  const worlds = await allWorldTemplates();
  if (!worlds.length) throw new Error('没有世界模板（先 pux world import）');
  let plan;
  if (opts.revisitDay) {
    const prev = await db.select().from(sessions).where(and(eq(sessions.study_id, studyId), eq(sessions.revisit_day, 0)));
    const ids = [...new Set(prev.filter((s) => s.outcome && s.outcome !== 'sim_error').map((s) => s.persona_id))].slice(0, size);
    plan = [];
    for (const pid of ids) {
      const p = personas.find((x) => x.spec.id === pid); if (!p) continue;
      const last = prev.filter((s) => s.persona_id === pid).sort((a, b) => (b.started_at?.getTime() ?? 0) - (a.started_at?.getTime() ?? 0))[0];
      const world = worlds.find((w) => w.id === last.world_template_id) ?? worlds[0];
      plan.push({ persona: p.spec, persona_version: p.version, world, mode: last.mode as Mode, task: undefined, is_expert_baseline: false, priority: 0, reason: { revisit_day: opts.revisitDay, after_session: last.id }, hypothesis_ids: [] });
    }
  } else {
    plan = await planRound({ study: { id: studyId, config, app_version_id: av.id, app_id: app.id, rng_seed: study.rng_seed }, personas, worlds, size, round });
  }
  const ids: string[] = [];
  for (const it of plan) {
    const goal = await makeLifeGoal({ persona: it.persona, world: it.world, mode: it.mode, task: it.task, appName: app.name.replace(/^demo-/, ''), appDesc: av.prd ?? app.description ?? '', studyId, hypothesisIds: it.hypothesis_ids });
    const id = newId('ses');
    await db.insert(sessions).values({ id, study_id: studyId, round, persona_id: it.persona.id, persona_version: it.persona_version, world_template_id: it.world.id, goal_id: goal.id, mode: it.mode, is_expert_baseline: it.is_expert_baseline, revisit_day: opts.revisitDay ?? 0, plan_priority: it.priority, plan_reason: { ...it.reason, task_id: it.task?.id }, rng_seed: seedFrom(id) % 1_000_000, executor: config.executor });
    ids.push(id);
  }
  return ids;
}

/** 人工接管：通知并等待（轮询数据库），超时记为 blocked */
async function waitForHuman(taskId: string, takeover: string, progress: Progress): Promise<boolean> {
  const cfg = loadConfig().human_takeover;
  progress(`⚠️ 需要人工接管：请在浏览器打开 ${takeover} 完成验证，然后执行 pux human resolve ${taskId}（或在控制台点击「已处理」）。${cfg.timeout_min} 分钟后超时。`, { task_id: taskId, takeover });
  execFile('notify-send', ['AI 产品体验官：需要人工接管', `打开 ${takeover} 完成验证`], () => {});
  const deadline = Date.now() + cfg.timeout_min * 60_000;
  while (Date.now() < deadline) {
    const t = (await getDb().select().from(humanTasks).where(eq(humanTasks.id, taskId)))[0];
    if (t?.status === 'resolved') return true;
    if (t?.status === 'cancelled') return false;
    await new Promise((r) => setTimeout(r, 3000));
  }
  await resolveHumanTask(taskId, 'timeout');
  return false;
}

/** 运行单个 Session（inline 模式；Temporal 模式由 worker 按步调用同样的方法） */
export async function runSessionInline(sessionId: string, progress: Progress, opts: { headed?: boolean } = {}) {
  let runner: SessionRunner | undefined;
  try {
    runner = await SessionRunner.start(sessionId, opts);
    for (;;) {
      const r = await runner.step();
      progress(`  · ${sessionId} step ${runner.stepIdx}`, { session: sessionId, step: runner.stepIdx });
      if (r.done) break;
      if (r.needsHuman) {
        const ok = await waitForHuman(r.needsHuman.task_id, r.needsHuman.takeover, progress);
        if (!ok) { await runner.abort('blocked'); await getDb().update(sessions).set({ outcome: 'blocked', end_reason: 'needs_human 超时（人工接管未完成）' }).where(eq(sessions.id, sessionId)); return 'blocked'; }
      }
    }
    const end = await runner.finish();
    return end.outcome;
  } catch (e) {
    logger.error({ err: String((e as Error).stack ?? e).slice(0, 800), sessionId }, 'Session 运行失败');
    if (runner) await runner.abort(`sim_error: ${String((e as Error).message).slice(0, 200)}`).catch(() => {});
    await getDb().update(sessions).set({ status: 'failed', outcome: 'sim_error', end_reason: String((e as Error).message).slice(0, 400), ended_at: new Date() }).where(eq(sessions.id, sessionId));
    return 'sim_error';
  }
}

/** Session 结束后的评估（执行与评估隔离） */
export async function evaluateSessionPost(sessionId: string, progress: Progress = () => {}) {
  const db = getDb();
  const s = (await db.select().from(sessions).where(eq(sessions.id, sessionId)))[0];
  const { study, av, config } = await studyCtx(s.study_id);
  const p = await getPersona(s.persona_id, s.persona_version);
  const lang = langOf(p?.spec.locale ?? 'zh-CN');
  const metrics = await objectiveMetrics(sessionId);
  await db.update(sessions).set({ summary: { ...(s.summary as object ?? {}), objective: metrics } }).where(eq(sessions.id, sessionId));
  if (s.outcome === 'sim_error' && metrics.steps < 2) { await db.update(sessions).set({ status: 'evaluated' }).where(eq(sessions.id, sessionId)); return metrics; }
  await extractCandidates(sessionId, study.id, metrics, lang);
  progress(`  ⚖️ 评审 ${sessionId}`);
  await judgeSession(sessionId, study.id, metrics, config.judges).catch((e) => logger.warn({ err: String(e).slice(0, 200) }, '评审失败'));
  await evaluateAiQuality(sessionId, study.id).catch((e) => logger.warn({ err: String(e).slice(0, 200) }, 'AI 质量评估失败'));
  if (config.interview) await postSessionInterview(sessionId).catch((e) => logger.warn({ err: String(e).slice(0, 200) }, '访谈失败'));
  // 覆盖率回写
  let newCov = 0;
  const obs = await db.select().from(observations).where(eq(observations.session_id, sessionId)).orderBy(observations.step_idx);
  const st = await db.select().from(steps).where(eq(steps.session_id, sessionId));
  const acted = new Set(st.filter((x) => { const q = x.action_request as ActionRequest | null; return q?.verb && !['scroll', 'wait', 'back'].includes(q.verb) && (x.action_result as { status?: string } | null)?.status === 'success'; }).map((x) => x.idx));
  for (const o of obs) newCov += (await touch(av.id, 'state', o.state_id, sessionId, { label: o.url })) ? 1 : 0;
  const fs = await db.select().from(features).where(eq(features.app_version_id, av.id));
  for (const f of fs) {
    const pats = (f.url_patterns ?? []).map((x) => { try { return new RegExp(x); } catch { return null; } }).filter(Boolean) as RegExp[];
    const hits = obs.filter((o) => { try { return pats.some((re) => re.test(new URL(o.url).pathname)); } catch { return false; } });
    if (hits.length) newCov += (await touch(av.id, 'feature', f.id, sessionId, { label: f.name, used: hits.some((h) => acted.has(h.step_idx)) })) ? 1 : 0;
  }
  if (metrics.task_completed) newCov += (await touch(av.id, 'path', `${(s.plan_reason as { task_id?: string })?.task_id}|${s.path_signature}`, sessionId)) ? 1 : 0;
  if (p) newCov += (await touch(av.id, 'segment', p.spec.segment, sessionId)) ? 1 : 0;
  newCov += (await touch(av.id, 'scenario', s.world_template_id, sessionId)) ? 1 : 0;
  newCov += (await touch(av.id, 'mode', s.mode, sessionId)) ? 1 : 0;
  await db.update(sessions).set({ status: 'evaluated', summary: { ...(((await db.select().from(sessions).where(eq(sessions.id, sessionId)))[0].summary) as object ?? {}), objective: metrics, new_coverage: newCov } }).where(eq(sessions.id, sessionId));
  return metrics;
}

/** 饱和停止：连续 M 个 Session 没有新的 Issue fingerprint、也没有新的覆盖 */
export async function saturated(studyId: string, m: number, newIssuesThisRound: number) {
  if (newIssuesThisRound > 0) return false;
  const rows = (await getDb().select().from(sessions).where(and(eq(sessions.study_id, studyId), eq(sessions.status, 'evaluated'))).orderBy(desc(sessions.ended_at))).slice(0, m);
  if (rows.length < m) return false;
  return rows.every((r) => ((r.summary as { new_coverage?: number } | null)?.new_coverage ?? 1) === 0);
}

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<unknown>) {
  const q = [...items]; await Promise.all(Array.from({ length: Math.min(n, q.length) }, async () => { while (q.length) await fn(q.shift()!); }));
}

/** 全自动运行一个 Study（inline 编排）：多轮「规划 → 执行 → 评估 → 覆盖率 → 饱和判断」，最后合成问题、校准、出报告 */
export async function runStudyInline(studyId: string, progress: Progress = (m) => logger.info(m), opts: { headed?: boolean } = {}) {
  const db = getDb(); const { config, av } = await studyCtx(studyId);
  await db.update(studies).set({ status: 'running', started_at: new Date() }).where(eq(studies.id, studyId));
  const b = config.budget;
  let round = 0; let total = (await db.select().from(sessions).where(eq(sessions.study_id, studyId))).length; let stop = '';
  try {
    while (total < b.max_sessions) {
      const tok = (await db.select({ t: studies.tokens }).from(studies).where(eq(studies.id, studyId)))[0].t;
      if (tok > b.max_tokens) { stop = `token 预算耗尽（${tok}）`; break; }
      const size = Math.min(b.round_size, b.max_sessions - total);
      progress(`🧭 第 ${round + 1} 轮规划（${size} 个 Session）`);
      const ids = await planNextRound(studyId, round, size);
      for (const id of ids) { const s = (await db.select().from(sessions).where(eq(sessions.id, id)))[0]; progress(`  ▶ ${id} persona=${s.persona_id} world=${s.world_template_id} mode=${s.mode}${s.is_expert_baseline ? ' [专家对照]' : ''}`); }
      await pool(ids, b.concurrency, async (id) => { const o = await runSessionInline(id, progress, opts); progress(`  ■ ${id} 结局：${o}`); await evaluateSessionPost(id, progress).catch((e) => logger.warn({ err: String(e).slice(0, 300) }, '评估失败')); });
      total += ids.length; round++;
      const before = (await db.select().from(issues).where(eq(issues.app_version_id, av.id))).length;
      await synthesizeIssues(studyId, { cleanReplay: config.clean_replay, lang: config.locale === 'en-US' ? 'en' : 'zh' });
      const after = (await db.select().from(issues).where(eq(issues.app_version_id, av.id))).length;
      progress(`🧩 第 ${round} 轮新增问题 ${after - before} 个`);
      if (await saturated(studyId, config.saturation_m, after - before)) { stop = `探索饱和（连续 ${config.saturation_m} 个 Session 无新发现、无新覆盖）`; break; }
    }
    if (!stop) stop = `达到 Session 预算 ${b.max_sessions}`;
    for (const day of config.revisits) {
      progress(`📅 留存回访：第 ${day} 天`);
      const ids = await planNextRound(studyId, round++, Math.min(3, b.round_size), { revisitDay: day });
      await pool(ids, b.concurrency, async (id) => { await runSessionInline(id, progress, opts); await evaluateSessionPost(id, progress).catch(() => {}); });
      await synthesizeIssues(studyId, { cleanReplay: config.clean_replay, lang: 'zh' });
    }
    await finalizeStudy(studyId, progress, stop);
  } catch (e) {
    await db.update(studies).set({ status: 'failed', status_detail: String((e as Error).message).slice(0, 500), finished_at: new Date() }).where(eq(studies.id, studyId));
    throw e;
  }
}

export async function finalizeStudy(studyId: string, progress: Progress = () => {}, stopReason = '') {
  const db = getDb(); const { config, app } = await studyCtx(studyId);
  await db.update(studies).set({ status: 'evaluating' }).where(eq(studies.id, studyId));
  progress('🧩 合成问题与归因');
  await synthesizeIssues(studyId, { cleanReplay: config.clean_replay, lang: 'zh' });
  progress('🧪 判定产品假设');
  await evaluateHypotheses(studyId).catch((e) => logger.warn({ err: String(e).slice(0, 200) }, '假设判定失败'));
  progress('📐 校准（已知缺陷注入版本）');
  const seeded = await calibrateSeeded(studyId).catch((e) => { logger.warn({ err: String(e).slice(0, 200) }, '校准失败'); return null; });
  if (seeded) progress(`   检出率 ${(seeded.recall * 100).toFixed(0)}%，误报率 ${seeded.false_positive_rate === null ? '—' : (seeded.false_positive_rate * 100).toFixed(0) + '%'}`);
  await learnFromCalibration(app.id).catch(() => {});
  await aggregateScores(studyId);
  progress('📝 生成报告');
  const rep = await generateReport(studyId);
  await db.update(studies).set({ status: 'done', finished_at: new Date(), stop_reason: stopReason }).where(eq(studies.id, studyId));
  progress(`✅ 完成：${rep.paths.md}`);
  return rep;
}

export async function studySessions(studyId: string) { return getDb().select().from(sessions).where(eq(sessions.study_id, studyId)); }
export { inArray };
