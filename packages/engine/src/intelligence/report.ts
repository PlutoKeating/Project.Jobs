// Experience Intelligence 与报告（§15）：问题清单（主推）、Persona 日记、热力矩阵、校准卡、版本对比、访谈
import { copyFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { dataPath, L, loadConfig, newId, type ActionRequest, type ActionResult, type Lang } from '@pux/core';
import { and, appVersions, apps, desc, eq, events, evidence, evidenceLinks, getDb, hypotheses, inArray, interviews, issues, judgments, ne, observations, reports, reproPaths, scores, sessions, steps, studies, goals, worldTemplates, llmTraces, calibrationResults } from '@pux/db';
import { blobs } from '@pux/storage';
import { checkVendorIsolation } from '@pux/llm';
import { getPersona, segmentLabel } from '../human/persona.ts';
import { calibrationCard } from '../calibration/index.ts';
import { coverageSummary } from '../exploration/coverage.ts';
import { simQuality } from '../evaluation/simquality.ts';
import { studyIssues } from '../evaluation/issues.ts';
import { worldNameOfSession } from '../world/live.ts';

const require = createRequire(import.meta.url);
const SEV_ORDER = { P0: 0, P1: 1, P2: 2, P3: 3 } as Record<string, number>;
const trustBadge = (t: string, lang: Lang) => ({ high: L(lang, '🟢 高可信', '🟢 high'), medium: L(lang, '🟡 中可信', '🟡 medium'), low: L(lang, '🟠 低可信', '🟠 low'), unknown: L(lang, '⚪ 未校准（仅作假设）', '⚪ unknown (hypothesis only)') } as Record<string, string>)[t] ?? t;
const catLabel = (c: string, lang: Lang) => ({ ux: L(lang, '体验', 'UX'), bug: L(lang, '缺陷', 'Bug'), ai_quality: L(lang, 'AI 质量', 'AI quality'), a11y: L(lang, '无障碍', 'Accessibility'), value: L(lang, '价值/暗模式', 'Value / dark pattern'), safety: L(lang, '安全', 'Safety') } as Record<string, string>)[c] ?? c;
const attrLabel = (a: string, lang: Lang) => ({ product: L(lang, '产品问题', 'product'), simulator: L(lang, '模拟器', 'simulator'), environment: L(lang, '环境', 'environment'), uncertain: L(lang, '不确定', 'uncertain') } as Record<string, string>)[a] ?? a;

async function exportEvidence(evId: string | null | undefined, dir: string): Promise<string | undefined> {
  if (!evId) return undefined;
  const ev = (await getDb().select().from(evidence).where(eq(evidence.id, evId)))[0];
  if (!ev?.storage_ref) return undefined;
  const ext = ev.mime === 'image/jpeg' ? '.jpg' : ev.mime === 'image/png' ? '.png' : ev.mime === 'video/mp4' ? '.mp4' : '.json';
  const rel = `assets/${ev.hash.slice(0, 16)}${ext}`;
  const abs = join(dir, rel);
  if (!existsSync(abs)) { mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, await blobs().get(ev.storage_ref)); }
  return rel;
}

export async function collectReportData(studyId: string, dir: string) {
  const db = getDb();
  const study = (await db.select().from(studies).where(eq(studies.id, studyId)))[0];
  const av = (await db.select().from(appVersions).where(eq(appVersions.id, study.app_version_id)))[0];
  const app = (await db.select().from(apps).where(eq(apps.id, av.app_id)))[0];
  const sess = await db.select().from(sessions).where(eq(sessions.study_id, studyId));
  const wts = new Map((await db.select().from(worldTemplates)).map((w) => [w.id, w]));
  const iss = (await studyIssues(studyId)).sort((a, b) => (SEV_ORDER[a.severity] - SEV_ORDER[b.severity]) || (b.session_ids?.length ?? 0) - (a.session_ids?.length ?? 0));
  const issueData = [];
  for (const i of iss) {
    const links = await db.select().from(evidenceLinks).where(and(eq(evidenceLinks.subject_type, 'issue'), eq(evidenceLinks.subject_id, i.id)));
    const evs = links.length ? await db.select().from(evidence).where(inArray(evidence.id, links.map((l) => l.evidence_id))) : [];
    const primary = links.find((l) => l.role === 'primary');
    const shotEv = evs.find((e) => e.id === primary?.evidence_id && e.mime?.startsWith('image/')) ?? evs.find((e) => e.kind === 'screenshot') ?? evs.find((e) => e.mime?.startsWith('image/'));
    const shot = await exportEvidence(shotEv?.id, dir);
    const rp = i.repro_path_id ? (await db.select().from(reproPaths).where(eq(reproPaths.id, i.repro_path_id)))[0] : undefined;
    const repro = rp ? (rp.steps as { verb: string; target_name?: string; args?: { text?: string }; url?: string }[]).map((s) => `${s.verb}${s.target_name ? ` 「${s.target_name}」` : ''}${s.args?.text ? ` "${String(s.args.text).slice(0, 40)}"` : ''}`) : [];
    issueData.push({ ...i, embedding: undefined, screenshot: shot, repro, repro_ok_rate: rp?.replay_ok_rate ?? null, evidence_count: evs.length, evidence_kinds: [...new Set(evs.map((e) => e.kind))] });
  }
  const sessData = [];
  for (const s of sess.sort((a, b) => (a.started_at?.getTime() ?? 0) - (b.started_at?.getTime() ?? 0))) {
    const p = await getPersona(s.persona_id, s.persona_version);
    const goal = s.goal_id ? (await db.select().from(goals).where(eq(goals.id, s.goal_id)))[0] : undefined;
    const st = await db.select().from(steps).where(eq(steps.session_id, s.id)).orderBy(steps.idx);
    const obs = new Map((await db.select().from(observations).where(eq(observations.session_id, s.id))).map((o) => [o.id, o]));
    const evts = await db.select().from(events).where(eq(events.session_id, s.id));
    const timeline = [];
    for (const x of st) {
      const o = x.observation_id ? obs.get(x.observation_id) : undefined;
      const q = x.action_request as ActionRequest | null; const r = x.action_result as ActionResult | null;
      timeline.push({ idx: x.idx, clock: x.sim_clock, url: o?.url, screenshot: await exportEvidence((o?.data as { screenshot_ev?: string } | undefined)?.screenshot_ev, dir), monologue: x.monologue, intent: x.intent, expectation: x.expectation, violated: x.expectation_violated, decision: x.decision, verb: q?.verb, target: r?.resolved_target?.resolved?.a11y_name ?? q?.target?.value, text: q?.args?.text, status: r?.status, error: r?.error ? `${r.error.code} (${r.error.layer})` : undefined, state: x.dynamic_state, events: evts.filter((e) => e.step_idx === x.idx).map((e) => ({ time: e.sim_time, text: e.text, source: e.source, caused_by: e.caused_by_event_id })) });
    }
    const itv = await db.select().from(interviews).where(eq(interviews.session_id, s.id));
    const js = await db.select().from(judgments).where(and(eq(judgments.target_id, s.id), eq(judgments.target, 'session')));
    sessData.push({ id: s.id, persona: p?.spec, mode: s.mode, world: worldNameOfSession(s, wts.get(s.world_template_id)?.name), scenario: wts.get(s.world_template_id)?.scenario_class, goal: goal?.statement_for_persona, outcome: s.outcome, end_reason: s.end_reason, steps: s.steps_count, expert: s.is_expert_baseline, revisit_day: s.revisit_day, tokens: s.tokens, cost: s.cost_usd, objective: (s.summary as { objective?: unknown } | null)?.objective, memory: (s.summary as { memory?: unknown } | null)?.memory, timeline, interview: itv, judgments: js.map((j) => ({ role: j.evaluator_role, model: j.model_alias, phase: j.phase, scores: j.scores, rationale: j.rationale })), video: await exportEvidence(s.video_ev, dir), rrweb: await exportEvidence(s.rrweb_ev, dir) });
  }
  const hyps = await db.select().from(hypotheses).where(eq(hypotheses.app_id, app.id));
  const sc = await db.select().from(scores).where(eq(scores.study_id, studyId));
  const card = await calibrationCard(app.id);
  const confirmed = (await db.execute<{ id: string }>(`select id from features where app_version_id = '${av.id}' and confirmed = true` as never)).rows.map((r) => (r as { id: string }).id);
  const cov = await coverageSummary(av.id, confirmed);
  const simq = await simQuality(studyId);
  const traces = await db.select().from(llmTraces).where(eq(llmTraces.study_id, studyId));
  const byRole: Record<string, { calls: number; tokens: number; cost: number; avg_ms: number; errors: number }> = {};
  for (const t of traces) { const r = byRole[t.role] ??= { calls: 0, tokens: 0, cost: 0, avg_ms: 0, errors: 0 }; r.calls++; r.tokens += t.prompt_tokens + t.completion_tokens; r.cost += t.cost_usd; r.avg_ms += t.latency_ms; if (t.status === 'error') r.errors++; }
  for (const r of Object.values(byRole)) r.avg_ms = Math.round(r.avg_ms / Math.max(1, r.calls));
  // 版本对比：同一 App 的上一份报告（不同 Study）
  const prevReport = (await db.select().from(reports).innerJoin(studies, eq(reports.study_id, studies.id)).innerJoin(appVersions, eq(studies.app_version_id, appVersions.id)).where(and(eq(appVersions.app_id, app.id), ne(reports.study_id, studyId))).orderBy(desc(reports.created_at)))[0];
  let trend: unknown = null;
  if (prevReport) {
    const prevIss = await studyIssues(prevReport.reports.study_id);
    const prevFp = new Set(prevIss.filter((i) => i.attribution === 'product').map((i) => i.fingerprint));
    const curFp = new Set(iss.filter((i) => i.attribution === 'product').map((i) => i.fingerprint));
    const prevScores = await db.select().from(scores).where(eq(scores.study_id, prevReport.reports.study_id));
    const cmp = (dim: string) => ({ dim, prev: prevScores.find((s) => s.segment === '*' && s.scenario_class === '*' && s.dimension === dim)?.mean ?? null, cur: sc.find((s) => s.segment === '*' && s.scenario_class === '*' && s.dimension === dim)?.mean ?? null });
    trend = { prev_study: prevReport.reports.study_id, prev_version: prevReport.app_versions.version, new_issues: [...curFp].filter((f) => !prevFp.has(f)).length, resolved_issues: [...prevFp].filter((f) => !curFp.has(f)).length, persisting: [...curFp].filter((f) => prevFp.has(f)).length, metrics: ['task_completion', 'steps', 'expectation_violations', 'satisfaction', 'sus'].map(cmp) };
  }
  return { study, av, app, sessions: sessData, issues: issueData, hypotheses: hyps, scores: sc, calibration: card, coverage: cov, simq, cost: byRole, trend, isolation: checkVendorIsolation(['judge_0', 'judge_1', 'judge_2'].slice(0, (study.config as { judges?: number }).judges ?? 2)), severityDefs: loadConfig().severity };
}

type RD = Awaited<ReturnType<typeof collectReportData>>;

export function renderMarkdown(d: RD, lang: Lang): string {
  const z = lang === 'zh'; const t = (zh: string, en: string) => L(lang, zh, en);
  // 主清单只有虚拟人亲身遇到的问题；用户看不到的技术信号与专家检查单独放进工程附录
  const mainIss = d.issues.filter((i) => i.status !== 'folded' && i.track !== 'engineering');
  const engIss = d.issues.filter((i) => i.status !== 'folded' && i.track === 'engineering');
  const folded = d.issues.filter((i) => i.status === 'folded');
  const outcomes = d.sessions.reduce((a, s) => { a[s.outcome ?? '?'] = (a[s.outcome ?? '?'] ?? 0) + 1; return a; }, {} as Record<string, number>);
  const tok = d.sessions.reduce((a, s) => a + (s.tokens ?? 0), 0); const cost = Object.values(d.cost).reduce((a, r) => a + r.cost, 0);
  const lines: string[] = [];
  lines.push(`# ${t('AI 产品体验官 · 体验报告', 'AI Product Experience Officer · Report')}：${d.app.name} @ ${d.av.version}`);
  lines.push('', `> ${t('本报告由模拟用户在模拟世界中使用真实产品生成。所有主观指标均为「模拟估计」，不能替代真人用户研究；每条结论都带可信度标签，未经校准的结论默认为「未校准（仅作假设）」。', 'Generated by simulated users operating the real product inside a simulated world. All subjective metrics are simulated estimates and do not replace research with real users. Every conclusion carries a trust label; uncalibrated conclusions default to "unknown (hypothesis only)".')}`);
  if (d.study.isolation_warning) lines.push('', `> ⚠️ ${z ? d.study.isolation_warning : 'Vendor isolation not satisfied: judges and the persona mind share a model vendor; affected conclusions were downgraded one trust level.'}`);
  lines.push('', `## ${t('1. 概览', '1. Overview')}`, '',
    `| ${t('项', 'Item')} | ${t('值', 'Value')} |`, '|---|---|',
    `| Study | \`${d.study.id}\` (${d.study.trigger}) |`, `| ${t('被测地址', 'Target URL')} | ${d.av.env_url} |`,
    `| ${t('Session 数', 'Sessions')} | ${d.sessions.length}（${Object.entries(outcomes).map(([k, v]) => `${k} ${v}`).join('，')}） |`,
    `| ${t('问题', 'Issues')} | ${t('亲历', 'experienced')} ${mainIss.length} · ${t('工程附录', 'engineering appendix')} ${engIss.length} · ${t('折叠', 'folded')} ${folded.length} |`,
    `| ${t('停止原因', 'Stop reason')} | ${d.study.stop_reason ?? '—'} |`,
    `| ${t('模型用量', 'Model usage')} | ${tok.toLocaleString()} tokens · ≈ $${cost.toFixed(2)}（${t('估算', 'estimate')}） |`,
    `| ${t('执行器', 'Executor')} | ${(d.study.config as { executor?: string }).executor} |`);
  // 校准卡
  lines.push('', `## ${t('2. 校准卡（可信度）', '2. Calibration card (trust)')}`, '');
  if (!d.calibration.length) lines.push(t('暂无校准数据：本报告所有结论的可信度均为「未校准」。可对植入缺陷版本运行 Study，或导入真人基准（pux calibrate human）。', 'No calibration data yet: all conclusions are "unknown". Run a study on a seeded-defect version or import a human benchmark (pux calibrate human).'));
  else { lines.push(`| ${t('人群', 'Segment')} | ${t('场景', 'Scenario')} | ${t('维度', 'Dimension')} | ${t('指标', 'Metric')} | ${t('值', 'Value')} | 95% CI | n | ${t('可信度', 'Trust')} |`, '|---|---|---|---|---|---|---|---|'); for (const c of d.calibration) lines.push(`| ${c.segment === '*' ? t('全部', 'all') : segmentLabel(c.segment, lang)} | ${c.scenario === '*' ? t('全部', 'all') : c.scenario} | ${c.dimension === '*' ? t('全部', 'all') : catLabel(c.dimension, lang)} | ${c.metric} | ${c.value === null ? '—' : Number(c.value).toFixed(2)} | ${c.ci[0] === null ? '—' : `[${Number(c.ci[0]).toFixed(2)}, ${Number(c.ci[1]).toFixed(2)}]`} | ${c.n} | ${trustBadge(c.trust, lang)} |`); }
  // 问题清单
  lines.push('', `## ${t('3. 体验问题（虚拟人亲身遇到的）', '3. Experience issues (what the simulated people actually ran into)')}`, '', `${t('这里只列虚拟人自己看到、自己卡住、自己放弃的地方。无障碍扫描、接口与脚本错误、专家启发式检查等用户看不到的信号在「工程附录」。', 'Only what the simulated people saw, got stuck on, or gave up on. Signals a user cannot see (accessibility scans, API and script errors, expert heuristics) are in the engineering appendix.')}`, '', `${t('严重度口径', 'Severity')}：${Object.entries(d.severityDefs).map(([k, v]) => `**${k}** ${v}`).join('；')}`, '');
  mainIss.forEach((i, n) => {
    lines.push(`### ${n + 1}. [${i.severity}] ${z ? i.title : (i.title_en ?? i.title)}`, '',
      `- ${t('类别', 'Category')}：${catLabel(i.category, lang)} · ${t('归因', 'Attribution')}：${attrLabel(i.attribution, lang)} · ${t('可信度', 'Trust')}：${trustBadge(i.trust_level, lang)} · ${t('评审分歧度', 'Judge disagreement')}：${i.disagreement ?? 0}`,
      `- ${t('受影响人群', 'Affected segments')}：${(i.affected_segments ?? []).map((s) => segmentLabel(s, lang)).join('、')}（${i.session_ids?.length ?? 0} ${t('个 Session', 'sessions')}）`,
      `- ${t('启发式', 'Heuristics')}：${(i.heuristics ?? []).join(', ') || '—'}${i.url_pattern ? ` · ${t('位置', 'Where')}：\`${i.url_pattern}\`` : ''}${i.seeded_match ? ` · ${t('命中已知缺陷', 'Seeded defect')} \`${i.seeded_match}\`` : ''}`,
      '', (i.description ?? '').trim(), '');
    if (i.repro.length) lines.push(`**${t('复现步骤', 'Repro steps')}**${i.repro_ok_rate !== null ? `（${t('干净重放成功率', 'clean replay success')} ${Math.round((i.repro_ok_rate ?? 0) * 100)}%）` : ''}：`, '', ...i.repro.map((r, k) => `${k + 1}. ${r}`), '');
    if (i.recommendation) lines.push(`**${t('修复建议', 'Recommendation')}**：${i.recommendation}`, '');
    if (i.screenshot) lines.push(`![${t('证据截图', 'evidence')}](${i.screenshot})`, '');
    lines.push(`<sub>${t('证据', 'Evidence')}：${i.evidence_count} ${t('条', 'items')}（${i.evidence_kinds.join(', ')}）· fingerprint \`${i.fingerprint}\`</sub>`, '');
  });
  if (!mainIss.length) lines.push(t('这一轮虚拟人没有遇到进入主清单的问题。', 'The simulated people did not run into any main-list issue this round.'));
  // 热力矩阵
  lines.push('', `## ${t('4. 人群 × 页面 × 问题热力矩阵', '4. Segment × page × issue heatmap')}`, '');
  const segs = [...new Set(d.sessions.map((s) => s.persona?.segment).filter(Boolean))] as string[];
  const pages = [...new Set(mainIss.map((i) => i.url_pattern || '—'))].slice(0, 12);
  if (pages.length) {
    lines.push(`| ${t('页面', 'Page')} | ${segs.map((s) => segmentLabel(s, lang)).join(' | ')} | ${t('离散度', 'Dispersion')} |`, `|---|${segs.map(() => '---').join('|')}|---|`);
    for (const pg of pages) { const counts = segs.map((s) => mainIss.filter((i) => (i.url_pattern || '—') === pg && (i.affected_segments ?? []).includes(s)).length); const m = counts.reduce((a, b) => a + b, 0) / Math.max(1, counts.length); const sd = Math.sqrt(counts.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, counts.length)); lines.push(`| \`${pg}\` | ${counts.map((c) => (c ? '🟥'.repeat(Math.min(3, c)) + ` ${c}` : '·')).join(' | ')} | ${sd.toFixed(2)} |`); }
  } else lines.push('—');
  // 指标
  lines.push('', `## ${t('5. 指标', '5. Metrics')}`, '', `**${t('客观指标（测得）', 'Objective (measured)')}**`, '');
  const g = (seg: string, dim: string) => d.scores.find((s) => s.segment === seg && s.scenario_class === '*' && s.dimension === dim);
  const fmt = (v: number | null | undefined, pctv = false) => (v === null || v === undefined ? '—' : pctv ? `${Math.round(v * 100)}%` : v.toFixed(2));
  lines.push(`| ${t('人群', 'Segment')} | n | ${t('任务完成率', 'Task completion')} | ${t('自认完成率', 'Self-reported done')} | ${t('平均步数', 'Avg steps')} | ${t('预期落空', 'Expectation violations')} |`, '|---|---|---|---|---|---|');
  for (const s of ['*', ...segs]) lines.push(`| ${s === '*' ? t('全部', 'all') : segmentLabel(s, lang)} | ${g(s, 'steps')?.n ?? 0} | ${fmt(g(s, 'task_completion')?.mean, true)} | ${fmt(g(s, 'persona_claimed_success')?.mean, true)} | ${fmt(g(s, 'steps')?.mean)} | ${fmt(g(s, 'expectation_violations')?.mean)} |`);
  lines.push('', `**${t('主观指标（模拟估计，不是真实测量）', 'Subjective (simulated estimates, not real measurements)')}**`, '');
  lines.push(`| ${t('人群', 'Segment')} | ${t('满意度', 'Satisfaction')} | ${t('信任', 'Trust')} | ${t('感知难度', 'Difficulty')} | ${t('认知负担', 'Cognitive load')} | ${t('放弃意愿', 'Abandon intent')} | SUS | UMUX-Lite | p10–p90 (${t('满意度', 'sat.')}) | ${t('可信度', 'Trust')} |`, '|---|---|---|---|---|---|---|---|---|---|');
  for (const s of ['*', ...segs]) { const sat = g(s, 'satisfaction'); lines.push(`| ${s === '*' ? t('全部', 'all') : segmentLabel(s, lang)} | ${fmt(sat?.mean)} | ${fmt(g(s, 'trust')?.mean)} | ${fmt(g(s, 'perceived_difficulty')?.mean)} | ${fmt(g(s, 'cognitive_load')?.mean)} | ${fmt(g(s, 'abandonment_intent')?.mean)} | ${fmt(g(s, 'sus')?.mean)} | ${fmt(g(s, 'umux_lite')?.mean)} | ${sat ? `${fmt(sat.p10)}–${fmt(sat.p90)}` : '—'} | ${trustBadge(sat?.trust_level ?? 'unknown', lang)} |`); }
  lines.push('', t('注：各评审的原始分与分歧见 HTML 查看器；分数归一化在校准集上验证有效之前不启用（§12.3）。', 'Note: raw per-judge scores and disagreements are in the HTML viewer; score normalization stays disabled until validated on a calibration set (§12.3).'));
  // 假设
  lines.push('', `## ${t('6. 产品假设', '6. Product hypotheses')}`, '');
  if (d.hypotheses.length) { lines.push(`| ${t('假设', 'Hypothesis')} | ${t('状态', 'Status')} | ${t('依据', 'Rationale')} |`, '|---|---|---|'); for (const h of d.hypotheses) lines.push(`| ${h.statement} | ${h.status} | ${(h.rationale ?? '').replace(/\n/g, ' ').slice(0, 200)} |`); } else lines.push('—');
  // 覆盖率
  lines.push('', `## ${t('7. 探索覆盖', '7. Exploration coverage')}`, '', `- ${t('功能覆盖（真正用过 / 已确认功能）', 'Feature coverage (used / confirmed)')}：${d.coverage.features_used}/${d.coverage.features_total}（${Math.round(d.coverage.feature_coverage * 100)}%）`, `- ${t('状态', 'States')}：${d.coverage.states} · ${t('任务路径', 'Task paths')}：${d.coverage.task_paths} · ${t('人群', 'Segments')}：${d.coverage.segments} · ${t('场景', 'Scenarios')}：${d.coverage.scenarios}`);
  // 模拟质量
  lines.push('', `## ${t('8. 模拟质量', '8. Simulation quality')}`, '', `- ${t('模拟器错误率', 'Simulator error rate')}：${(d.simq.simulator_error_rate * 100).toFixed(1)}% · ${t('停滞率', 'Stall rate')}：${(d.simq.loop_stall_rate * 100).toFixed(0)}% · sim_error Session：${d.simq.sim_error_sessions}`, `- ${t('行为差异度（不同 Persona 路径的归一化编辑距离均值）', 'Behavior diversity (mean normalized path edit distance)')}：${d.simq.behavior_diversity}（${t('阈值', 'threshold')} ${loadConfig().thresholds.behavior_diversity_min}）`, ...d.simq.behavior_diversity_pairs.map((p) => `- ${t('对照组', 'Pair')} \`${p.group}\`：${t('路径距离', 'path distance')} ${p.distance}，${t('步数差', 'step diff')} ${p.steps_diff}，${t('结局不同', 'different outcome')} ${p.outcome_diff ? '✓' : '✗'}`), `- ${t('状态与行为一致率', 'State–behavior consistency')}：${d.simq.state_behavior_consistency === null ? '—' : `${Math.round(d.simq.state_behavior_consistency * 100)}%`}`);
  // 版本对比
  if (d.trend) { const tr = d.trend as { prev_version: string; new_issues: number; resolved_issues: number; persisting: number; metrics: { dim: string; prev: number | null; cur: number | null }[] }; lines.push('', `## ${t('9. 版本对比', '9. Version comparison')}`, '', `${t('对比', 'Compared with')} ${tr.prev_version}：${t('新增', 'new')} ${tr.new_issues} · ${t('已解决', 'resolved')} ${tr.resolved_issues} · ${t('仍存在', 'persisting')} ${tr.persisting}`, '', `| ${t('指标', 'Metric')} | ${t('上次', 'Previous')} | ${t('本次', 'Current')} |`, '|---|---|---|', ...tr.metrics.map((m) => `| ${m.dim} | ${fmt(m.prev)} | ${fmt(m.cur)} |`)); }
  // 日记
  lines.push('', `## ${t('10. Persona 第一人称日记（模拟）', '10. Persona diaries (simulated)')}`, '');
  for (const s of d.sessions) {
    const p = s.persona;
    lines.push(`<details><summary><b>${p?.identity.name ?? '?'}</b>（${segmentLabel(p?.segment ?? '', lang)}，${s.mode}${s.expert ? `，${t('专家对照', 'expert')}` : ''}${s.revisit_day ? `，${t('第', 'day ')}${s.revisit_day}${t(' 天回访', ' revisit')}` : ''}）· ${s.world} · ${t('结局', 'outcome')} <b>${s.outcome}</b> · ${s.steps} ${t('步', 'steps')}</summary>`, '', `> ${t('目标', 'Goal')}：${s.goal}`, '');
    for (const x of s.timeline) { lines.push(`- **${x.clock}** ${x.events.map((e) => `🌍 ${e.text}`).join(' ')} ${x.monologue ? `💭 「${x.monologue}」` : ''} → ${x.intent ?? ''}${x.verb ? ` \`${x.verb}${x.status ? `:${x.status}` : ''}\`` : ''}${x.violated ? ' ⚡' : ''}${x.error ? ` ❗${x.error}` : ''}`); }
    lines.push('', `${t('结束原因', 'End reason')}：${s.end_reason ?? ''}`);
    const pi = s.interview.find((i) => i.kind === 'post_session');
    if (pi) { lines.push('', `**${t('事后访谈（模拟）', 'Post-session interview (simulated)')}**`, ...pi.qa.map((q) => `- ${q.q} — ${q.a}`)); const qn = pi.questionnaire as { sus_score_simulated?: number; umux_lite_simulated?: number } | null; if (qn) lines.push(`- SUS ${t('模拟估计', 'simulated')}：${qn.sus_score_simulated} · UMUX-Lite ${t('模拟估计', 'simulated')}：${qn.umux_lite_simulated}`); }
    lines.push('', '</details>', '');
  }
  // 工程附录
  lines.push('', `## ${t('工程附录：用户看不到的技术信号与专家检查', 'Engineering appendix: technical signals and expert checks users cannot see')}`, '', t('给开发者或 coding agent 看。来源：无障碍扫描（axe）、接口与脚本错误、评审模型的启发式检查、AI 回答核查。它们不代表某个虚拟人亲身遇到了问题。', 'For developers or a coding agent. Sources: accessibility scan (axe), API and script errors, heuristic review by judge models, AI answer checks. They do not mean a simulated person ran into the problem.'), '');
  engIss.forEach((i) => {
    lines.push(`- **[${i.severity}] ${z ? i.title : (i.title_en ?? i.title)}** · ${catLabel(i.category, lang)} · ${trustBadge(i.trust_level, lang)}${i.url_pattern ? ` · \`${i.url_pattern}\`` : ''}${i.seeded_match ? ` · ${t('命中已知缺陷', 'Seeded defect')} \`${i.seeded_match}\`` : ''}`);
    const desc = (i.description ?? '').split('\n\n')[0].trim(); if (desc) lines.push(`  ${desc.replace(/\n/g, ' ')}`);
    if (i.recommendation) lines.push(`  ${t('建议', 'Fix')}：${i.recommendation}`);
  });
  if (!engIss.length) lines.push('—');
  // 附录
  lines.push('', `## ${t('附录：折叠的问题（低严重度、归因不确定或模拟器问题）', 'Appendix: folded issues (low severity, uncertain or simulator-attributed)')}`, '');
  for (const i of folded) lines.push(`- [${i.severity}] ${z ? i.title : (i.title_en ?? i.title)} · ${catLabel(i.category, lang)} · ${attrLabel(i.attribution, lang)} · ${trustBadge(i.trust_level, lang)}`);
  if (!folded.length) lines.push('—');
  lines.push('', `## ${t('附录：模型用量', 'Appendix: model usage')}`, '', `| ${t('角色', 'Role')} | ${t('调用', 'Calls')} | Tokens | ${t('均延迟', 'Avg latency')} | ${t('错误', 'Errors')} | ${t('成本估算', 'Est. cost')} |`, '|---|---|---|---|---|---|', ...Object.entries(d.cost).map(([k, r]) => `| ${k} | ${r.calls} | ${r.tokens.toLocaleString()} | ${r.avg_ms}ms | ${r.errors} | $${r.cost.toFixed(3)} |`));
  return lines.join('\n');
}

function renderHtml(d: RD): string {
  const data = JSON.stringify({ ...d, study: { ...d.study }, sessions: d.sessions }).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>体验报告 · ${d.app.name}</title>
<link rel="stylesheet" href="assets/rrweb-player.css">
<style>:root{--bg:#f6f7f9;--fg:#1d2129;--muted:#86909c;--card:#fff;--line:#e5e6eb;--acc:#3b5bdb}@media(prefers-color-scheme:dark){:root{--bg:#141518;--fg:#e6e8eb;--muted:#9aa0a6;--card:#1d1f23;--line:#2c2f34;--acc:#7b93ff}}
body{margin:0;font:14px/1.6 -apple-system,"PingFang SC","Noto Sans CJK SC",sans-serif;background:var(--bg);color:var(--fg)}header{padding:16px 20px;border-bottom:1px solid var(--line);background:var(--card);position:sticky;top:0;z-index:5}
nav button{background:none;border:0;padding:6px 12px;margin-right:4px;border-radius:8px;color:var(--fg);cursor:pointer;font:inherit}nav button.on{background:var(--acc);color:#fff}main{max-width:1200px;margin:0 auto;padding:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;margin-bottom:12px}.sev{display:inline-block;border-radius:6px;padding:0 8px;font-weight:600;color:#fff}.P0{background:#c92a2a}.P1{background:#e8590c}.P2{background:#f59f00}.P3{background:#868e96}
.muted{color:var(--muted)}.tag{display:inline-block;border:1px solid var(--line);border-radius:10px;padding:0 8px;margin:2px;font-size:12px}img.shot{max-width:100%;border-radius:8px;border:1px solid var(--line)}
.tl{display:grid;grid-template-columns:320px 1fr;gap:12px;border-top:1px solid var(--line);padding:10px 0}.tl img{width:100%;border-radius:6px;border:1px solid var(--line);cursor:zoom-in}@media(max-width:800px){.tl{grid-template-columns:1fr}}
.viol{color:#e8590c}.err{color:#c92a2a}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid var(--line);padding:6px;text-align:left;font-size:13px}select{font:inherit;padding:4px}</style></head><body>
<header><b>AI 产品体验官 · ${d.app.name} @ ${d.av.version}</b> <span class="muted">Study ${d.study.id} · 模拟估计，非真人测量</span>
<nav id="nav"></nav></header><main id="main"></main>
<script src="assets/rrweb-player.umd.cjs"></script>
<script>const D=${data};
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]);
const tabs={'问题清单':issues,'Session 回放':sessionsView,'指标与校准':metrics};let cur='问题清单';
function nav(){document.getElementById('nav').innerHTML=Object.keys(tabs).map(k=>'<button class="'+(k===cur?'on':'')+'" onclick="cur=\\''+k+'\\';render()">'+k+'</button>').join('');}
function issues(){D.issues.sort((a,b)=>(a.track==='engineering')-(b.track==='engineering'));const tr={high:'🟢 高可信',medium:'🟡 中可信',low:'🟠 低可信',unknown:'⚪ 未校准'};return D.issues.map(i=>'<div class="card" style="'+(i.status==='folded'?'opacity:.65':'')+'"><span class="sev '+i.severity+'">'+i.severity+'</span> '+(i.track==='engineering'?'<span class="tag">工程附录</span> ':'')+'<b>'+esc(i.title)+'</b> '+(i.status==='folded'?'<span class="tag">附录</span>':'')+'<div class="muted">'+esc(i.category)+' · 归因 '+esc(i.attribution)+' · '+(tr[i.trust_level]||i.trust_level)+' · 人群 '+(i.affected_segments||[]).map(esc).join('、')+' · '+(i.session_ids||[]).length+' 个 Session'+(i.seeded_match?' · 命中缺陷 '+esc(i.seeded_match):'')+'</div><p>'+esc(i.description).replace(/\\n/g,'<br>')+'</p>'+(i.repro.length?'<details><summary>复现步骤'+(i.repro_ok_rate!==null?'（重放成功率 '+Math.round(i.repro_ok_rate*100)+'%）':'')+'</summary><ol>'+i.repro.map(r=>'<li>'+esc(r)+'</li>').join('')+'</ol></details>':'')+(i.recommendation?'<p><b>建议：</b>'+esc(i.recommendation)+'</p>':'')+(i.screenshot?'<img class="shot" loading="lazy" src="'+i.screenshot+'">':'')+'</div>').join('')||'<div class="card">无问题</div>';}
let selS=0;
function sessionsView(){const s=D.sessions[selS];if(!s)return '<div class="card">无 Session</div>';
 const opts=D.sessions.map((x,i)=>'<option value="'+i+'" '+(i===selS?'selected':'')+'>'+esc(x.persona?.identity?.name)+' · '+esc(x.mode)+' · '+esc(x.outcome)+' · '+x.steps+' 步</option>').join('');
 let h='<div class="card"><select onchange="selS=+this.value;render()">'+opts+'</select><p><b>目标：</b>'+esc(s.goal)+'</p><p class="muted">'+esc(s.world)+' · 结束原因：'+esc(s.end_reason)+'</p>'+(s.video?'<video controls src="'+s.video+'" style="max-width:100%;max-height:420px"></video>':'')+(s.rrweb?'<div><button onclick="replay()">▶ rrweb 回放</button><div id="rr"></div></div>':'')+'</div><div class="card">';
 for(const x of s.timeline){h+='<div class="tl"><div>'+(x.screenshot?'<img loading="lazy" src="'+x.screenshot+'" onclick="window.open(this.src)">':'')+'</div><div><b>#'+x.idx+' '+esc(x.clock)+'</b> <span class="muted">'+esc(x.url)+'</span>'+(x.events||[]).map(e=>'<div>🌍 '+esc(e.text)+' <span class="muted">('+esc(e.source)+')</span></div>').join('')+'<div>💭 '+esc(x.monologue)+'</div><div>→ '+esc(x.intent)+(x.text?' 「'+esc(x.text)+'」':'')+'</div><div class="muted">'+esc(x.verb||x.decision)+' '+esc(x.target||'')+' · '+esc(x.status||'')+(x.error?' <span class=err>'+esc(x.error)+'</span>':'')+(x.violated?' <span class=viol>⚡预期落空</span>':'')+'</div><div class="muted">预期：'+esc(x.expectation)+'</div><div class="muted">状态：'+esc(JSON.stringify(x.state))+'</div></div></div>';}
 h+='</div>';const pi=(s.interview||[]);if(pi.length)h+='<div class="card"><b>访谈（模拟）</b>'+pi.flatMap(i=>i.qa).map(q=>'<p><b>Q：</b>'+esc(q.q)+'<br><b>A：</b>'+esc(q.a)+'</p>').join('')+'</div>';
 h+='<div class="card"><b>评审（模拟估计，原始分）</b><table><tr><th>评审</th><th>阶段</th><th>分数</th><th>理由</th></tr>'+(s.judgments||[]).map(j=>'<tr><td>'+esc(j.role)+'<br><span class=muted>'+esc(j.model)+'</span></td><td>'+esc(j.phase)+'</td><td>'+esc(JSON.stringify(j.scores))+'</td><td>'+esc(j.rationale)+'</td></tr>').join('')+'</table></div>';return h;}
async function replay(){const s=D.sessions[selS];const ev=await (await fetch(s.rrweb)).json();document.getElementById('rr').innerHTML='';new rrwebPlayer({target:document.getElementById('rr'),props:{events:ev,width:900,height:560,autoPlay:true}});}
function metrics(){const row=(r)=>'<tr><td>'+esc(r.segment)+'</td><td>'+esc(r.scenario_class)+'</td><td>'+esc(r.dimension)+'</td><td>'+esc(r.eval_class)+'</td><td>'+(r.mean===null?'—':(+r.mean).toFixed(2))+'</td><td>'+(r.p10===null?'—':(+r.p10).toFixed(2)+'–'+(+r.p90).toFixed(2))+'</td><td>'+r.n+'</td><td>'+esc(r.trust_level)+'</td></tr>';
 return '<div class="card"><b>校准卡</b><table><tr><th>人群</th><th>场景</th><th>维度</th><th>指标</th><th>值</th><th>CI</th><th>n</th><th>可信度</th></tr>'+D.calibration.map(c=>'<tr><td>'+esc(c.segment)+'</td><td>'+esc(c.scenario)+'</td><td>'+esc(c.dimension)+'</td><td>'+esc(c.metric)+'</td><td>'+(c.value===null?'—':(+c.value).toFixed(2))+'</td><td>'+(c.ci[0]===null?'—':(+c.ci[0]).toFixed(2)+'–'+(+c.ci[1]).toFixed(2))+'</td><td>'+c.n+'</td><td>'+esc(c.trust)+'</td></tr>').join('')+'</table></div><div class="card"><b>分数（人群 × 场景 × 维度）</b><table><tr><th>人群</th><th>场景</th><th>维度</th><th>类别</th><th>均值</th><th>p10–p90</th><th>n</th><th>可信度</th></tr>'+D.scores.map(row).join('')+'</table></div><div class="card"><b>模拟质量</b><pre>'+esc(JSON.stringify(D.simq,null,2))+'</pre><b>覆盖</b><pre>'+esc(JSON.stringify(D.coverage,null,2))+'</pre></div>';}
function render(){nav();document.getElementById('main').innerHTML=tabs[cur]();}render();</script></body></html>`;
}

export async function generateReport(studyId: string) {
  const dir = dataPath('reports', studyId);
  mkdirSync(join(dir, 'assets'), { recursive: true });
  const d = await collectReportData(studyId, dir);
  try { const pdir = dirname(require.resolve('rrweb-player/package.json')); copyFileSync(join(pdir, 'dist/rrweb-player.umd.cjs'), join(dir, 'assets/rrweb-player.umd.cjs')); copyFileSync(join(pdir, 'dist/style.css'), join(dir, 'assets/rrweb-player.css')); } catch { /* 可选 */ }
  const lang = ((d.study.config as { report_lang?: string }).report_lang ?? 'both');
  const paths: Record<string, string> = {};
  if (lang !== 'en') { paths.md = join(dir, 'report.zh.md'); writeFileSync(paths.md, renderMarkdown(d, 'zh')); }
  if (lang !== 'zh') { paths.md_en = join(dir, 'report.en.md'); writeFileSync(paths.md_en, renderMarkdown(d, 'en')); paths.md ??= paths.md_en; }
  paths.html = join(dir, 'index.html'); writeFileSync(paths.html, renderHtml(d));
  writeFileSync(join(dir, 'data.json'), JSON.stringify({ study: d.study.id, issues: d.issues.map((i) => ({ ...i })), calibration: d.calibration, coverage: d.coverage, simq: d.simq, trend: d.trend }, null, 2));
  const id = newId('rep');
  await getDb().insert(reports).values({ id, study_id: studyId, formats: Object.keys(paths), sections: ['overview', 'calibration_card', 'issues', 'heatmap', 'metrics', 'hypotheses', 'coverage', 'sim_quality', 'trend', 'diaries', 'appendix'], calibration_card: d.calibration, paths, metrics: { simq: d.simq, coverage: d.coverage }, diff_from_report_id: (d.trend as { prev_study?: string } | null)?.prev_study ?? null });
  return { id, paths };
}

export { calibrationResults };
