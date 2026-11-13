// 客观评估（§12）：任务完成、操作次数、错误类型、耗时、入口可发现性、无障碍、AI 回复延迟 —— 可以直接说「测得」
import { newId, ERROR_LAYER, type ActionRequest, type ActionResult } from '@pux/core';
import { and, eq, evidence, getDb, goals, issueCandidates, observations, sessions, steps, taskDefs, features, inArray } from '@pux/db';
import { taskCompleted } from '../product/intelligence.ts';

export interface ObjectiveMetrics {
  steps: number; actions: number; errors_by_layer: Record<string, number>; errors_by_code: Record<string, number>;
  sim_errors: number; expectation_violations: number; sim_minutes: number; real_seconds: number;
  task_completed: boolean | null; completion_step: number | null; persona_claimed_done: boolean;
  discoverability: Record<string, number | null>; states_visited: number; new_states: number;
  ai_wait_seconds: number[]; a11y_violations: number; a11y_rules: string[]; policy_blocks: number;
  outcome: string; abandonment_state?: string; abandonment_url?: string;
}

const hhmm = (s?: string | null) => { if (!s) return 0; const [h, m] = s.split(':').map(Number); return h * 60 + m; };

export async function objectiveMetrics(sessionId: string): Promise<ObjectiveMetrics> {
  const db = getDb();
  const s = (await db.select().from(sessions).where(eq(sessions.id, sessionId)))[0];
  const st = await db.select().from(steps).where(eq(steps.session_id, sessionId)).orderBy(steps.idx);
  const obs = await db.select().from(observations).where(eq(observations.session_id, sessionId)).orderBy(observations.step_idx);
  const errors_by_layer: Record<string, number> = {}; const errors_by_code: Record<string, number> = {};
  let actions = 0; let violations = 0; let policy = 0; const waits: number[] = [];
  for (const x of st) {
    const r = x.action_result as ActionResult | null; const q = x.action_request as ActionRequest | null;
    if (q?.verb) actions++;
    if (x.expectation_violated) violations++;
    if (r?.status === 'blocked_by_policy') policy++;
    if (r?.error) { errors_by_layer[r.error.layer] = (errors_by_layer[r.error.layer] ?? 0) + 1; errors_by_code[r.error.code] = (errors_by_code[r.error.code] ?? 0) + 1; }
    if (q?.verb === 'wait' && r) waits.push(Math.round(r.duration_ms / 100) / 10);
  }
  const goal = s.goal_id ? (await db.select().from(goals).where(eq(goals.id, s.goal_id)))[0] : undefined;
  const task = goal?.linked_task_ids?.[0] ? (await db.select().from(taskDefs).where(eq(taskDefs.id, goal.linked_task_ids[0])))[0] : undefined;
  const tc = task ? taskCompleted((task.success_signals ?? []) as never, obs.map((o) => ({ url: o.url, text: `${o.title}\n${(o.data as { visible_text_digest?: string; text?: string }).text ?? (o.data as { visible_text_digest?: string }).visible_text_digest ?? ''}` }))) : undefined;
  // 入口可发现性：首次进入每个功能页面前走了几步
  const discover: Record<string, number | null> = {};
  if (task?.feature_ids?.length) {
    const fs = await db.select().from(features).where(inArray(features.id, task.feature_ids));
    for (const f of fs) {
      const pats = (f.url_patterns ?? []).map((p) => { try { return new RegExp(p); } catch { return null; } }).filter(Boolean) as RegExp[];
      const i = obs.findIndex((o) => pats.some((re) => { try { return re.test(new URL(o.url).pathname); } catch { return false; } }));
      discover[f.name] = i >= 0 ? obs[i].step_idx : null;
    }
  }
  const axe = await db.select().from(evidence).where(and(eq(evidence.session_id, sessionId), eq(evidence.kind, 'axe')));
  const rules = new Set<string>(); let a11yCount = 0;
  for (const a of axe) for (const v of ((a.inline as { violations?: { id: string; impact: string }[] })?.violations ?? [])) { if (v.impact === 'serious' || v.impact === 'critical') { rules.add(v.id); a11yCount++; } }
  const states = new Set(obs.map((o) => o.state_id));
  const last = obs[obs.length - 1];
  return {
    steps: st.length, actions, errors_by_layer, errors_by_code, sim_errors: errors_by_layer.simulator ?? 0, expectation_violations: violations,
    sim_minutes: st.length ? Math.max(0, hhmm(st[st.length - 1].sim_clock) - hhmm(st[0].sim_clock)) : 0,
    real_seconds: s.started_at && s.ended_at ? Math.round((s.ended_at.getTime() - s.started_at.getTime()) / 1000) : 0,
    task_completed: tc ? tc.done : null, completion_step: tc?.done ? (obs[tc.at!]?.step_idx ?? null) : null, persona_claimed_done: s.outcome === 'success',
    discoverability: discover, states_visited: states.size, new_states: obs.filter((o) => (o.data as { is_new_state?: boolean }).is_new_state).length,
    ai_wait_seconds: waits, a11y_violations: a11yCount, a11y_rules: [...rules], policy_blocks: policy, outcome: s.outcome ?? 'unknown',
    abandonment_state: s.outcome !== 'success' ? last?.state_id : undefined, abandonment_url: s.outcome !== 'success' ? last?.url : undefined,
  };
}

/** 从 UAP 结果、预期违背、放弃点、Policy、无障碍规则中提取问题候选（尚未归因） */
export async function extractCandidates(sessionId: string, studyId: string, metrics: ObjectiveMetrics, lang: 'zh' | 'en') {
  const db = getDb(); const zh = lang === 'zh';
  const st = await db.select().from(steps).where(eq(steps.session_id, sessionId)).orderBy(steps.idx);
  const obs = await db.select().from(observations).where(eq(observations.session_id, sessionId));
  const obsById = new Map(obs.map((o) => [o.id, o]));
  const out: (typeof issueCandidates.$inferInsert)[] = [];
  const push = (c: Omit<typeof issueCandidates.$inferInsert, 'id' | 'study_id' | 'session_id'>) => out.push({ id: newId('cand'), study_id: studyId, session_id: sessionId, ...c });
  for (const x of st) {
    const r = x.action_result as ActionResult | null; const o = x.observation_id ? obsById.get(x.observation_id) : undefined;
    const ev = [o ? (o.data as { screenshot_ev?: string }).screenshot_ev : undefined, ...(r?.evidence_ids ?? [])].filter(Boolean) as string[];
    if (r?.error) {
      const layer = r.error.layer ?? ERROR_LAYER[r.error.code];
      if (layer === 'product') push({ step_idx: x.idx, source: 'uap_error', title: r.error.message.slice(0, 120), description: `${zh ? '意图' : 'Intent'}：${x.intent}\n${r.error.code}: ${r.error.message}`, category: r.error.code === 'PRODUCT_SMALL_TARGET' ? 'a11y' : r.error.code === 'PRODUCT_NO_FEEDBACK' ? 'ux' : 'bug', state_id: o?.state_id, url: o?.url, error_code: r.error.code, error_layer: layer, evidence_ids: ev });
      else if (r.error.code === 'EXEC_TARGET_NOT_FOUND' && /感知|perceived/.test(r.error.message)) push({ step_idx: x.idx, source: 'uap_error', title: zh ? `找不到想要的入口：${x.intent?.slice(0, 40)}` : `Could not find intended entry: ${x.intent?.slice(0, 40)}`, description: r.error.message, category: 'ux', state_id: o?.state_id, url: o?.url, error_code: r.error.code, error_layer: 'executor', evidence_ids: ev });
      else if (layer === 'policy') push({ step_idx: x.idx, source: 'policy', title: zh ? `高风险动作被拦截：${r.error.message.slice(0, 60)}` : `High-risk action blocked: ${r.error.message.slice(0, 60)}`, description: `${x.intent}\n${r.error.message}\n${zh ? '需检查产品自身是否有家长确认/二次确认等保护机制' : 'Check whether the product itself has parental gate / confirmation'}`, category: 'safety', state_id: o?.state_id, url: o?.url, error_code: r.error.code, error_layer: layer, evidence_ids: ev });
    }
  }
  // 预期违背（看下一步的独白中的意外）
  for (let i = 0; i < st.length; i++) {
    const x = st[i]; if (!x.expectation_violated) continue;
    const nextMono = st[i + 1]?.monologue ?? '';
    const r = x.action_result as ActionResult | null;
    if (r?.error && (r.error.layer === 'simulator' || r.error.layer === 'environment')) continue;
    const o = x.observation_id ? obsById.get(x.observation_id) : undefined;
    push({ step_idx: x.idx, source: 'expectation_violation', title: zh ? `预期落空：${x.intent?.slice(0, 50)}` : `Expectation violated: ${x.intent?.slice(0, 50)}`, description: `${zh ? '预期' : 'Expected'}：${x.expectation}\n${zh ? '之后的反应' : 'Reaction'}：${nextMono}`, category: 'ux', state_id: o?.state_id, url: o?.url, error_code: r?.error?.code, error_layer: r?.error?.layer, evidence_ids: [(o?.data as { screenshot_ev?: string } | undefined)?.screenshot_ev, ...(r?.evidence_ids ?? [])].filter(Boolean) as string[] });
  }
  // 放弃 / 停滞
  if (['gave_up', 'stalled'].includes(metrics.outcome)) {
    const s = (await db.select().from(sessions).where(eq(sessions.id, sessionId)))[0];
    const last = st[st.length - 1];
    push({ step_idx: last?.idx, source: metrics.outcome === 'stalled' ? 'stall' : 'abandon', title: zh ? `在此放弃：${(s.end_reason ?? '').slice(0, 60)}` : `Abandoned here: ${(s.end_reason ?? '').slice(0, 60)}`, description: `${s.end_reason}\n${zh ? '最后的独白' : 'Last monologue'}：${last?.monologue ?? ''}`, category: 'ux', state_id: metrics.abandonment_state, url: metrics.abandonment_url, evidence_ids: [] });
  }
  // 无障碍（axe-core，客观规则）
  const axe = await db.select().from(evidence).where(and(eq(evidence.session_id, sessionId), eq(evidence.kind, 'axe')));
  for (const a of axe) {
    const inl = a.inline as { state_id: string; url: string; violations: { id: string; impact: string; help: string; count: number }[] };
    for (const v of inl.violations ?? []) if (v.impact === 'serious' || v.impact === 'critical') push({ source: 'axe', title: `[axe] ${v.help}`, description: `${v.id} (${v.impact}) × ${v.count}`, category: 'a11y', heuristics: [`axe:${v.id}`], state_id: inl.state_id, url: inl.url, error_code: `AXE_${v.id}`, error_layer: 'product', evidence_ids: [a.id] });
  }
  if (out.length) await db.insert(issueCandidates).values(out);
  return out.length;
}
