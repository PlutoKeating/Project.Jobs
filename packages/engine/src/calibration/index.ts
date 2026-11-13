// Calibration & Learning Loop（§14，核心能力）
// CalibrationResult：在什么人群 × 场景 × 维度上，模拟结论有多可信。没有数据时一律 unknown。
import { readFileSync } from 'node:fs';
import { dataPath, loadConfig, newId, readJson, writeJson, z, type TrustLevel } from '@pux/core';
import { and, appVersions, calibrationResults, calibrationSets, eq, getDb, issueCandidates, issues, scores, sessions, studies, type SeededDefect } from '@pux/db';
import { gateway } from '@pux/llm';
import { existsSync } from 'node:fs';

/** Wilson 置信区间 */
export function wilson(k: number, n: number, z0 = 1.96): [number, number] {
  if (!n) return [0, 1];
  const p = k / n; const d = 1 + z0 * z0 / n; const c = p + z0 * z0 / (2 * n); const m = z0 * Math.sqrt(p * (1 - p) / n + z0 * z0 / (4 * n * n));
  return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)];
}

export function trustLevel(metric: string, value: number | null, ci: [number, number], n: number): TrustLevel {
  const t = loadConfig().thresholds;
  if (value === null || n === 0) return 'unknown';
  const good = metric === 'false_positive_rate' ? 1 - value : value;
  if (n >= t.trust_high.min_n && ci[1] - ci[0] <= t.trust_high.max_ci_width && good >= t.trust_high.min_value) return 'high';
  if (metric === 'issue_recall' && value < t.seeded_recall_min * 0.6 && n >= t.trust_medium.min_n) return 'low';
  if (metric === 'false_positive_rate' && value > t.false_positive_max * 1.5 && n >= t.trust_medium.min_n) return 'low';
  if (metric === 'rank_corr' && value < 0.2 && n >= t.trust_medium.min_n) return 'low';
  if (n >= t.trust_medium.min_n) return 'medium';
  return 'low';
}

const MatchSchema = z.object({ matches: z.array(z.object({ issue_id: z.string(), defect_id: z.string(), confidence: z.number() })) });

/** 已知缺陷注入版本：按问题类型统计检出率、误报率（完全客观的校准源） */
export async function calibrateSeeded(studyId: string) {
  const db = getDb();
  const study = (await db.select().from(studies).where(eq(studies.id, studyId)))[0];
  const av = (await db.select().from(appVersions).where(eq(appVersions.id, study.app_version_id)))[0];
  const defects = (av.seeded_defects ?? []) as SeededDefect[];
  if (!defects.length) return null;
  const iss = (await db.select().from(issues).where(and(eq(issues.app_version_id, av.id), eq(issues.study_id, studyId))));
  for (const i of iss) if (i.seeded_match) await db.update(issues).set({ seeded_match: null }).where(eq(issues.id, i.id));
  const productIssues = iss.filter((i) => i.attribution === 'product');
  // 匹配：LLM 语义匹配 + 关键词兜底
  let matches: { issue_id: string; defect_id: string; confidence: number }[] = [];
  if (productIssues.length) {
    const r = await gateway().chat('judge_meta', { messages: [{ role: 'user', content: `把模拟发现的问题与已知植入缺陷做匹配：一个问题最多匹配一个缺陷；只有当问题确实描述了该缺陷的同一个根因与位置时才匹配（仅仅涉及同一页面或同一人群不算），confidence 0–1。\n已知缺陷：\n${defects.map((d) => `${d.id} | ${d.category} | ${d.location ?? ''} | ${d.title} | ${d.description}`).join('\n')}\n\n发现的问题：\n${productIssues.map((i) => `${i.id} | ${i.category} | ${i.url_pattern ?? ''} | ${i.title} | ${(i.description ?? '').slice(0, 300)}`).join('\n')}` }], schema: MatchSchema, schemaName: 'seeded_match', tags: { study_id: studyId, purpose: 'calibration_match' } });
    matches = r.data.matches.filter((m) => {
      const d = defects.find((x) => x.id === m.defect_id); const i = productIssues.find((x) => x.id === m.issue_id);
      if (!d || !i) return false;
      // 类别不一致时要求更高置信度（例如对比度问题不应匹配到支付保护缺陷）
      return m.confidence >= (d.category === i.category ? 0.5 : 0.75);
    });
  }
  for (const i of productIssues) if (!matches.some((m) => m.issue_id === i.id)) {
    const d = defects.find((x) => x.category === i.category && (x.keywords ?? []).filter((k) => `${i.title}${i.description}`.toLowerCase().includes(k.toLowerCase())).length >= 3);
    if (d) matches.push({ issue_id: i.id, defect_id: d.id, confidence: 0.5 });
  }
  for (const m of matches) await db.update(issues).set({ seeded_match: m.defect_id }).where(eq(issues.id, m.issue_id));
  const setId = newId('cset');
  await db.insert(calibrationSets).values({ id: setId, app_version_id: av.id, app_id: av.app_id, source: 'seeded_defects', name: `${av.version} seeded`, items: defects });
  const cats = [...new Set(defects.map((d) => d.category))];
  const out: Record<string, unknown>[] = [];
  const detected = new Set(matches.map((m) => m.defect_id));
  const save = async (dimension: string, metric: string, k: number, n: number, detail: unknown) => {
    const value = n ? k / n : null; const ci = wilson(k, n);
    const row = { id: newId('cres'), calibration_set_id: setId, study_id: studyId, app_id: av.app_id, segment: '*', scenario_class: '*', dimension, metric, value, ci_low: ci[0], ci_high: ci[1], n, method: 'seeded_match_llm+keywords', detail, trust_level: trustLevel(metric, value, ci, n) };
    await db.insert(calibrationResults).values(row as never); out.push(row);
  };
  for (const c of [...cats, '*']) {
    const ds = defects.filter((d) => c === '*' || d.category === c);
    await save(c, 'issue_recall', ds.filter((d) => detected.has(d.id)).length, ds.length, { detected: ds.filter((d) => detected.has(d.id)).map((d) => d.id), missed: ds.filter((d) => !detected.has(d.id)).map((d) => d.id) });
  }
  // 基线真实问题：axe-core 客观规则检出，或在同一 App 的干净版本上也被发现（相同 fingerprint）——不在植入清单里，但不是误报
  const cleanVersions = (await db.select().from(appVersions).where(eq(appVersions.app_id, av.app_id))).filter((v) => v.id !== av.id && !(v.seeded_defects ?? []).length).map((v) => v.id);
  const cleanFps = new Set<string>();
  for (const v of cleanVersions) for (const i of await db.select().from(issues).where(eq(issues.app_version_id, v))) if (i.attribution === 'product') cleanFps.add(i.fingerprint);
  const cands = await db.select().from(issueCandidates).where(eq(issueCandidates.study_id, studyId));
  const objectiveOnly = (id: string) => { const cs = cands.filter((c) => c.issue_id === id); return cs.length > 0 && cs.every((c) => c.source === 'axe'); };
  const unmatched = productIssues.filter((i) => !matches.some((m) => m.issue_id === i.id));
  // 在干净版本上重放复现路径：能复现说明问题独立于植入缺陷而真实存在（基线问题），不是误报
  const cleanUrl = cleanVersions.length ? (await db.select().from(appVersions).where(eq(appVersions.id, cleanVersions[0])))[0]?.env_url : undefined;
  const replayedOnClean = new Set<string>();
  if (cleanUrl) {
    const { cleanReplay } = await import('../evaluation/replay.ts');
    const { reproPaths } = await import('@pux/db');
    for (const i of unmatched) {
      if (objectiveOnly(i.id) || cleanFps.has(i.fingerprint) || !i.repro_path_id) continue;
      const rp = (await db.select().from(reproPaths).where(eq(reproPaths.id, i.repro_path_id)))[0];
      if (!rp) continue;
      try { const r = await cleanReplay({ start_url: cleanUrl, steps: rp.steps as never }, { issueId: i.id, fromSession: (i.session_ids ?? [])[0] ?? '', studyId }); if (r.reproduced) replayedOnClean.add(i.id); } catch { /* ignore */ }
    }
  }
  const baseline = unmatched.filter((i) => objectiveOnly(i.id) || cleanFps.has(i.fingerprint) || replayedOnClean.has(i.id));
  const fp = unmatched.filter((i) => !baseline.includes(i));
  const denom = productIssues.length - baseline.length;
  await save('*', 'false_positive_rate', fp.length, denom, { unmatched: fp.map((i) => ({ id: i.id, title: i.title })), baseline_real_issues: baseline.map((i) => ({ id: i.id, title: i.title, why: objectiveOnly(i.id) ? 'axe-core' : replayedOnClean.has(i.id) ? 'reproduced on clean version' : 'also found on clean version' })) });
  return { set_id: setId, recall: detected.size / defects.length, false_positive_rate: denom ? fp.length / denom : null, baseline: baseline.length, matches, results: out };
}

// ---------------------------------------------------------------- 真人基准
const HumanBenchSchema = z.object({
  app: z.string(), version: z.string().optional(), note: z.string().optional(),
  participants: z.array(z.object({ id: z.string(), segment: z.string(), task: z.string(), completed: z.boolean(), steps: z.number().optional(), stuck_points: z.array(z.string()).default([]), ratings: z.record(z.string(), z.number()).default({}) })),
});

/** 秩相关（Spearman） */
export function spearman(a: number[], b: number[]) {
  const rank = (x: number[]) => { const idx = x.map((v, i) => [v, i] as const).sort((p, q) => p[0] - q[0]); const r = Array(x.length); for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1; i = j + 1; } return r as number[]; };
  if (a.length < 3) return null;
  const ra = rank(a); const rb = rank(b); const n = a.length; const ma = ra.reduce((x, y) => x + y, 0) / n; const mb = rb.reduce((x, y) => x + y, 0) / n;
  let num = 0, da = 0, db2 = 0; for (let i = 0; i < n; i++) { num += (ra[i] - ma) * (rb[i] - mb); da += (ra[i] - ma) ** 2; db2 += (rb[i] - mb) ** 2; }
  return da && db2 ? num / Math.sqrt(da * db2) : null;
}
/** Fisher z 置信区间 */
const corrCi = (r: number, n: number): [number, number] => { if (n < 4) return [-1, 1]; const z0 = Math.atanh(Math.max(-0.999, Math.min(0.999, r))); const se = 1 / Math.sqrt(n - 3); return [Math.tanh(z0 - 1.96 * se), Math.tanh(z0 + 1.96 * se)]; };

/** 真人基准（每月 5 人）：同一组目标下真人与模拟的完成率、主观评分排序的相关性与偏差方向；并验证分数归一化方法（§12.3） */
export async function calibrateHuman(file: string, studyId: string) {
  const data = HumanBenchSchema.parse(file.endsWith('.json') ? JSON.parse(readFileSync(file, 'utf8')) : (await import('yaml')).parse(readFileSync(file, 'utf8')));
  const db = getDb();
  const study = (await db.select().from(studies).where(eq(studies.id, studyId)))[0];
  const av = (await db.select().from(appVersions).where(eq(appVersions.id, study.app_version_id)))[0];
  const setId = newId('cset');
  await db.insert(calibrationSets).values({ id: setId, app_version_id: av.id, app_id: av.app_id, source: 'human_benchmark', name: data.note ?? file, items: data.participants });
  const sc = await db.select().from(scores).where(eq(scores.study_id, studyId));
  const out: Record<string, unknown>[] = [];
  // 完成率：按人群对比
  const segs = [...new Set(data.participants.map((p) => p.segment))];
  const humanRate: number[] = []; const simRate: number[] = [];
  for (const s of segs) {
    const hp = data.participants.filter((p) => p.segment === s); const h = hp.filter((p) => p.completed).length / hp.length;
    const sim = sc.find((x) => x.segment === s && x.scenario_class === '*' && x.dimension === 'task_completion')?.mean;
    if (sim !== undefined && sim !== null) { humanRate.push(h); simRate.push(sim); }
    if (sim !== undefined && sim !== null) {
      const bias = sim - h; const n = hp.length;
      const row = { id: newId('cres'), calibration_set_id: setId, study_id: studyId, app_id: av.app_id, segment: s, scenario_class: '*', dimension: 'task_completion', metric: 'bias', value: bias, ci_low: bias - 1.96 * Math.sqrt(h * (1 - h) / Math.max(1, n)), ci_high: bias + 1.96 * Math.sqrt(h * (1 - h) / Math.max(1, n)), n, method: 'sim_minus_human', detail: { human: h, sim, direction: bias > 0.1 ? '模拟更乐观（更宽容）' : bias < -0.1 ? '模拟更悲观' : '接近' }, trust_level: Math.abs(bias) > 0.3 && n >= 3 ? 'low' : n >= 5 ? 'medium' : 'low' };
      await db.insert(calibrationResults).values(row as never); out.push(row);
    }
  }
  if (humanRate.length >= 3) { const r = spearman(simRate, humanRate)!; const ci = corrCi(r, humanRate.length); const row = { id: newId('cres'), calibration_set_id: setId, study_id: studyId, app_id: av.app_id, segment: '*', scenario_class: '*', dimension: 'task_completion', metric: 'rank_corr', value: r, ci_low: ci[0], ci_high: ci[1], n: humanRate.length, method: 'spearman', detail: { human: humanRate, sim: simRate }, trust_level: trustLevel('rank_corr', r, ci, humanRate.length) }; await db.insert(calibrationResults).values(row as never); out.push(row); }
  // 主观维度：按人群的评分排序相关，并比较 raw / z-score / rank 三种归一化（只有更好的才启用）
  const dims = [...new Set(data.participants.flatMap((p) => Object.keys(p.ratings)))];
  const norm: Record<string, string> = {};
  for (const d of dims) {
    const hs: number[] = []; const ss: number[] = [];
    for (const s of segs) { const hp = data.participants.filter((p) => p.segment === s && p.ratings[d] !== undefined); const sim = sc.find((x) => x.segment === s && x.scenario_class === '*' && x.dimension === d)?.mean; if (hp.length && sim !== undefined && sim !== null) { hs.push(hp.reduce((a, p) => a + p.ratings[d], 0) / hp.length); ss.push(sim); } }
    if (hs.length < 3) { const row = { id: newId('cres'), calibration_set_id: setId, study_id: studyId, app_id: av.app_id, segment: '*', scenario_class: '*', dimension: d, metric: 'rank_corr', value: null, ci_low: null, ci_high: null, n: hs.length, method: 'insufficient', detail: { note: '样本不足（<3 个人群）' }, trust_level: 'unknown' }; await db.insert(calibrationResults).values(row as never); out.push(row); continue; }
    const z = (x: number[]) => { const m = x.reduce((a, b) => a + b, 0) / x.length; const sd = Math.sqrt(x.reduce((a, b) => a + (b - m) ** 2, 0) / x.length) || 1; return x.map((v) => (v - m) / sd); };
    const pear = (a: number[], b: number[]) => { const n = a.length; const ma = a.reduce((x, y) => x + y, 0) / n; const mb = b.reduce((x, y) => x + y, 0) / n; let num = 0, da = 0, dbb = 0; for (let i = 0; i < n; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; dbb += (b[i] - mb) ** 2; } return da && dbb ? num / Math.sqrt(da * dbb) : 0; };
    const cand = { raw: pear(ss, hs), zscore: pear(z(ss), z(hs)), rank: spearman(ss, hs) ?? 0 };
    const best = (Object.entries(cand) as [string, number][]).sort((a, b) => b[1] - a[1])[0];
    norm[d] = best[1] > cand.raw + 0.05 ? best[0] : 'raw';
    const r = cand.rank; const ci = corrCi(r, hs.length);
    const row = { id: newId('cres'), calibration_set_id: setId, study_id: studyId, app_id: av.app_id, segment: '*', scenario_class: '*', dimension: d, metric: 'rank_corr', value: r, ci_low: ci[0], ci_high: ci[1], n: hs.length, method: `spearman; normalization=${norm[d]}`, detail: { candidates: cand, chosen: norm[d] }, trust_level: trustLevel('rank_corr', r, ci, hs.length) };
    await db.insert(calibrationResults).values(row as never); out.push(row);
  }
  updateLearning({ normalization: norm }, av.app_id);
  return { set_id: setId, results: out };
}

/** 埋点漏斗：真实流失步骤与模拟放弃点的排序相关 */
export async function calibrateFunnel(file: string, studyId: string) {
  const rows = readFileSync(file, 'utf8').trim().split('\n').slice(1).map((l) => l.split(',')).map(([step, url_pattern, dropoff]) => ({ step, url_pattern, dropoff: Number(dropoff) }));
  const db = getDb();
  const study = (await db.select().from(studies).where(eq(studies.id, studyId)))[0];
  const av = (await db.select().from(appVersions).where(eq(appVersions.id, study.app_version_id)))[0];
  const sess = await db.select().from(sessions).where(eq(sessions.study_id, studyId));
  const abandonAt = sess.filter((s) => s.outcome === 'gave_up').map((s) => ((s.summary as { objective?: { abandonment_url?: string } } | null)?.objective?.abandonment_url ?? ''));
  const sim = rows.map((r) => abandonAt.filter((u) => { try { return new RegExp(r.url_pattern).test(new URL(u).pathname); } catch { return false; } }).length);
  const rc = spearman(sim, rows.map((r) => r.dropoff));
  const setId = newId('cset');
  await db.insert(calibrationSets).values({ id: setId, app_version_id: av.id, app_id: av.app_id, source: 'funnel', name: file, items: rows });
  const ci = rc === null ? [-1, 1] as [number, number] : corrCi(rc, rows.length);
  const row = { id: newId('cres'), calibration_set_id: setId, study_id: studyId, app_id: av.app_id, segment: '*', scenario_class: '*', dimension: 'abandonment', metric: 'rank_corr', value: rc, ci_low: ci[0], ci_high: ci[1], n: rows.length, method: 'spearman(sim_abandon_count, real_dropoff)', detail: { steps: rows, sim }, trust_level: trustLevel('rank_corr', rc, ci, rows.length) };
  await db.insert(calibrationResults).values(row as never);
  return row;
}

const ComplaintSchema = z.object({ complaints: z.array(z.object({ text: z.string(), matched_issue_id: z.string() })) });
/** 应用商店 / 社媒评论：真实抱怨被模拟发现的比例，以及模拟独有的发现 */
export async function calibrateReviews(file: string, studyId: string) {
  const text = readFileSync(file, 'utf8').slice(0, 20000);
  const db = getDb();
  const study = (await db.select().from(studies).where(eq(studies.id, studyId)))[0];
  const av = (await db.select().from(appVersions).where(eq(appVersions.id, study.app_version_id)))[0];
  const iss = (await db.select().from(issues).where(eq(issues.app_version_id, av.id))).filter((i) => i.attribution === 'product');
  const r = await gateway().chat('judge_meta', { messages: [{ role: 'user', content: `从下面的用户评论中提取具体的产品抱怨（去重），并为每条抱怨找出描述同一问题的模拟发现（matched_issue_id，没有则空字符串）。\n模拟发现：\n${iss.map((i) => `${i.id} | ${i.title}`).join('\n')}\n\n评论：\n${text}` }], schema: ComplaintSchema, schemaName: 'reviews', tags: { study_id: studyId, purpose: 'calibration_reviews' } });
  const comp = r.data.complaints; const k = comp.filter((c) => c.matched_issue_id).length;
  const setId = newId('cset');
  await db.insert(calibrationSets).values({ id: setId, app_version_id: av.id, app_id: av.app_id, source: 'reviews', name: file, items: comp });
  const ci = wilson(k, comp.length);
  const unique = iss.filter((i) => !comp.some((c) => c.matched_issue_id === i.id)).length;
  const rows = [
    { id: newId('cres'), calibration_set_id: setId, study_id: studyId, app_id: av.app_id, segment: '*', scenario_class: '*', dimension: '*', metric: 'issue_recall', value: comp.length ? k / comp.length : null, ci_low: ci[0], ci_high: ci[1], n: comp.length, method: 'reviews_llm_match', detail: comp, trust_level: trustLevel('issue_recall', comp.length ? k / comp.length : null, ci, comp.length) },
    { id: newId('cres'), calibration_set_id: setId, study_id: studyId, app_id: av.app_id, segment: '*', scenario_class: '*', dimension: '*', metric: 'unique_findings', value: unique, ci_low: null, ci_high: null, n: iss.length, method: 'count', detail: {}, trust_level: 'unknown' },
  ];
  for (const row of rows) await db.insert(calibrationResults).values(row as never);
  return rows;
}

/** Learning：校准结果反过来调整采样权重、评审权重、Persona 批评度（写入 data/learning.json） */
export function updateLearning(patch: Record<string, unknown>, appId?: string) {
  const p = dataPath('learning.json');
  const cur = existsSync(p) ? readJson<{ apps?: Record<string, Record<string, unknown>> } & Record<string, unknown>>(p) : {};
  if (appId) { const apps = cur.apps ?? {}; apps[appId] = { ...(apps[appId] ?? {}), ...patch, updated_at: new Date().toISOString() }; writeJson(p, { ...cur, apps }); }
  else writeJson(p, { ...cur, ...patch, updated_at: new Date().toISOString() });
}

export async function learnFromCalibration(appId: string) {
  const db = getDb();
  const rows = await db.select().from(calibrationResults).where(eq(calibrationResults.app_id, appId));
  const cfg = loadConfig();
  const low = rows.filter((r) => r.trust_level === 'low' || r.trust_level === 'unknown').length;
  const recall = rows.find((r) => r.metric === 'issue_recall' && r.dimension === '*' && r.value !== null);
  const fpr = rows.find((r) => r.metric === 'false_positive_rate' && r.value !== null);
  const sampler_weights: Record<string, number> = { low_trust: cfg.sampler_weights.low_trust * (1 + Math.min(1, low / 10)) };
  const missed = rows.filter((r) => r.metric === 'issue_recall' && r.dimension !== '*' && (r.value ?? 1) < cfg.thresholds.seeded_recall_min).map((r) => r.dimension);
  const bias = rows.filter((r) => r.metric === 'bias' && r.value !== null);
  const persona_criticality = bias.length ? Math.max(-0.3, Math.min(0.3, bias.reduce((a, b) => a + (b.value ?? 0), 0) / bias.length)) : 0;
  updateLearning({ sampler_weights, weak_categories: missed, persona_criticality, last_recall: recall?.value ?? null, last_fpr: fpr?.value ?? null }, appId);
  return { sampler_weights, weak_categories: missed, persona_criticality };
}

/** 校准卡：本次报告涉及的人群 × 场景 × 维度的可信度 */
export async function calibrationCard(appId: string) {
  const rows = await getDb().select().from(calibrationResults).where(eq(calibrationResults.app_id, appId));
  return rows.sort((a, b) => b.computed_at.getTime() - a.computed_at.getTime()).filter((r, i, arr) => arr.findIndex((x) => x.segment === r.segment && x.scenario_class === r.scenario_class && x.dimension === r.dimension && x.metric === r.metric) === i)
    .map((r) => ({ segment: r.segment, scenario: r.scenario_class, dimension: r.dimension, metric: r.metric, value: r.value, ci: [r.ci_low, r.ci_high], n: r.n, trust: r.trust_level, method: r.method }));
}
