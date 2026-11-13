// 问题合成、归因（§12.1）、严重度、假设判定、分数聚合
import { loadConfig, logger, newId, shortHash, z, type Severity } from '@pux/core';
import { and, eq, evidence, getDb, hypotheses, inArray, issueCandidates, issues, judgments, sessions, studies, scores, worldTemplates, interviews, calibrationResults, vec } from '@pux/db';
import { blobs } from '@pux/storage';
import { checkVendorIsolation, gateway, type ContentPart } from '@pux/llm';
import { linkEvidence, urlTemplate } from '@pux/executor';
import { getPersona } from '../human/persona.ts';
import { personaAccount } from '../exploration/goals.ts';
import { touch } from '../exploration/coverage.ts';
import { buildReproPath, cleanReplay } from './replay.ts';

type Cand = typeof issueCandidates.$inferSelect;

const GroupSchema = z.object({ groups: z.array(z.object({
  candidate_ids: z.array(z.string()), key: z.string(), title: z.string(), title_en: z.string(), description: z.string(),
  category: z.enum(['ux', 'bug', 'ai_quality', 'a11y', 'value', 'safety']), heuristics: z.array(z.string()), severity: z.enum(['P0', 'P1', 'P2', 'P3']), recommendation: z.string(), noise: z.boolean(),
})) });

const MetaSchema = z.object({ attribution: z.enum(['product', 'simulator', 'uncertain']), rationale: z.string(), severity: z.enum(['P0', 'P1', 'P2', 'P3']) });

const pathOf = (u?: string | null) => { if (!u) return ''; try { return urlTemplate(u).replace(/^[^/]*/, ''); } catch { return u; } };

/** 把整个 Study 的候选聚合成 Issue，并做归因 */
export async function synthesizeIssues(studyId: string, opts: { cleanReplay: boolean; lang: 'zh' | 'en' }) {
  const db = getDb(); const cfg = loadConfig();
  const study = (await db.select().from(studies).where(eq(studies.id, studyId)))[0];
  const cands = (await db.select().from(issueCandidates).where(eq(issueCandidates.study_id, studyId))).filter((c) => !c.issue_id && !c.attribution);
  if (!cands.length) return [];
  const sess = await db.select().from(sessions).where(eq(sessions.study_id, studyId));
  const sById = new Map(sess.map((s) => [s.id, s]));
  const segOf = new Map<string, string>(); const personaOf = new Map<string, string>();
  for (const s of sess) { const p = await getPersona(s.persona_id, s.persona_version); segOf.set(s.id, p?.spec.segment ?? '?'); personaOf.set(s.id, s.persona_id); }
  // ① 层初判：environment / simulator 层直接排除
  const productish = cands.filter((c) => !(c.error_layer === 'environment' || c.error_layer === 'simulator' || c.error_layer === 'injected'));
  for (const c of cands.filter((x) => !productish.includes(x))) await db.update(issueCandidates).set({ attribution: c.error_layer === 'environment' ? 'environment' : 'simulator' }).where(eq(issueCandidates.id, c.id));
  // 分块聚类（LLM），每块最多 80 条
  const groups: z.infer<typeof GroupSchema>['groups'] = [];
  for (let i = 0; i < productish.length; i += 80) {
    const chunk = productish.slice(i, i + 80);
    const list = chunk.map((c) => `${c.id} | ${c.source} | ${c.category} | ${segOf.get(c.session_id)} | ${pathOf(c.url)} | ${c.error_code ?? ''} | ${c.title} | ${(c.description ?? '').replace(/\s+/g, ' ').slice(0, 220)}`).join('\n');
    const r = await gateway().chat('judge_meta', { messages: [{ role: 'system', content: `你是用户体验研究负责人。把同一个底层产品问题的候选合并为一组（不同人群、不同 Session 遇到同一问题要合并），每组给出：key（稳定的英文短 slug，描述问题本质，例如 export_entry_hidden）、中文 title、英文 title_en、description（问题是什么、在哪里、影响谁）、category、heuristics（Nielsen 编号 H1–H10 或 dark_pattern/wcag/ai_hallucination/child_safety）、severity（${Object.entries(cfg.severity).map(([k, v]) => `${k}：${v}`).join('；')}）、recommendation（具体修复建议）。如果候选只是模拟用户自身的误操作、个人偏好或没有产品层面证据，noise=true。每个候选 id 只能出现在一组中。` }, { role: 'user', content: `候选（id | 来源 | 类别 | 人群 | 页面 | 错误码 | 标题 | 描述）：\n${list}` }], schema: GroupSchema, schemaName: 'issue_groups', tags: { study_id: studyId, purpose: 'issue_synthesis' } });
    groups.push(...r.data.groups);
  }
  const iso = checkVendorIsolation(['judge_0', 'judge_1', 'judge_2'].slice(0, (study.config as { judges?: number }).judges ?? 2));
  const experts = sess.filter((s) => s.is_expert_baseline);
  const created: string[] = [];
  for (const g of groups) {
    const members = productish.filter((c) => g.candidate_ids.includes(c.id));
    if (!members.length) continue;
    const mainUrl = members.find((m) => m.url)?.url;
    const fingerprint = `fp_${shortHash(`${g.category}|${pathOf(mainUrl).replace(/\?.*$/, '')}|${g.key.toLowerCase()}`, 14)}`;
    const sessIds = [...new Set(members.map((m) => m.session_id))];
    const segments = [...new Set(sessIds.map((s) => segOf.get(s)!))];
    // ② 干净重放（选第一个带步骤的候选）
    let replay: { reproduced: boolean; repro_path_id: string; evidence_id: string } | undefined;
    const rc = members.find((m) => m.step_idx !== null && m.step_idx !== undefined && ['uap_error', 'expectation_violation', 'abandon', 'stall'].includes(m.source));
    if (opts.cleanReplay && rc && !g.noise) {
      try {
        const s = sById.get(rc.session_id)!; const p = await getPersona(s.persona_id, s.persona_version);
        const path = await buildReproPath(rc.session_id, rc.step_idx!);
        if (path.steps.length && path.steps.length <= 40) replay = await cleanReplay(path, { candidateId: rc.id, fromSession: rc.session_id, studyId, account: p ? personaAccount(p.spec, (await appIdOf(studyId))) : undefined });
      } catch (e) { logger.warn({ err: String(e).slice(0, 200) }, '干净重放失败'); }
    }
    // ③ 专家对照
    const expertHit = members.some((m) => sById.get(m.session_id)?.is_expert_baseline);
    const expertRan = experts.length > 0;
    // ④ 异厂商复核（本机只有一家，用最高档位 + 独立视角，并在报告中标注）
    const objectiveOnly = members.every((m) => m.source === 'axe');
    let attribution: 'product' | 'simulator' | 'uncertain' = objectiveOnly ? 'product' : 'uncertain';
    let rationale = objectiveOnly ? 'axe-core 客观规则检出' : '';
    let severity = g.severity as Severity;
    if (!objectiveOnly) {
      const frames: ContentPart[] = [];
      for (const eid of members.flatMap((m) => m.evidence_ids ?? []).slice(0, 2)) {
        const ev = (await db.select().from(evidence).where(eq(evidence.id, eid)))[0];
        if (ev?.storage_ref && ev.mime?.startsWith('image/')) frames.push({ type: 'image', data: await blobs().get(ev.storage_ref), mime: ev.mime });
      }
      const meta = await gateway().chat('judge_meta', { messages: [{ role: 'system', content: '你负责归因复核：判断这是真实的产品问题（product），还是模拟用户/执行器自身造成的（simulator），证据不足则 uncertain。采信顺序：客观错误码与干净重放结果 > 专家对照 > 截图 > 模拟用户的主观描述。干净重放能复现说明是产品层面的问题；专家也遇到倾向 bug；只有特定人群遇到倾向 ux（仍是 product）。' }, { role: 'user', content: [{ type: 'text', text: `问题：${g.title}\n${g.description}\n类别：${g.category}，建议严重度：${g.severity}\n受影响人群：${segments.join('、')}（${sessIds.length} 个 Session）\n候选证据：\n${members.slice(0, 8).map((m) => `- [${m.source}] ${m.error_code ?? ''} ${m.title} :: ${(m.description ?? '').slice(0, 200)}`).join('\n')}\n干净重放：${replay ? (replay.reproduced ? '复现成功' : '未复现') : '未执行'}\n专家对照：${expertRan ? (expertHit ? '专家也遇到了' : '专家未遇到') : '无专家 Session'}` }, ...frames] }], schema: MetaSchema, schemaName: 'attribution', tags: { study_id: studyId, purpose: 'attribution_meta' } });
      attribution = meta.data.attribution; rationale = meta.data.rationale; severity = meta.data.severity;
      if (replay?.reproduced && attribution === 'uncertain') attribution = 'product';
      if (g.noise && attribution !== 'product') attribution = 'simulator';
    }
    // 严重度规则修正
    const share = sessIds.length / Math.max(1, sess.length);
    if (g.category === 'safety' && members.some((m) => sById.get(m.session_id) && segOf.get(m.session_id)?.startsWith('child'))) severity = 'P0';
    if (share >= 0.5 && severity === 'P2') severity = 'P1';
    // 可信度（来自校准；无数据则 unknown）
    const calib = await db.select().from(calibrationResults).where(and(eq(calibrationResults.app_id, await appIdOf(studyId)), eq(calibrationResults.dimension, g.category)));
    let trust = calib.find((c) => c.metric === 'issue_recall')?.trust_level ?? 'unknown';
    if (!iso.ok && trust === 'high') trust = 'medium';
    if (objectiveOnly && trust === 'unknown') trust = 'medium';
    const disagreement = await disagreementFor(sessIds);
    const folded = attribution !== 'product' || severity === 'P3' || g.noise;
    const existing = (await db.select().from(issues).where(and(eq(issues.app_version_id, study.app_version_id), eq(issues.fingerprint, fingerprint))))[0];
    const issueId = existing?.id ?? newId('iss');
    const emb = await gateway().embed(`${g.title} ${g.description}`);
    const row = { title: g.title, title_en: g.title_en, description: `${g.description}\n\n归因：${rationale}`, category: g.category, heuristics: g.heuristics, severity, attribution, affected_segments: [...new Set([...(existing?.affected_segments ?? []), ...segments])], affected_personas: [...new Set([...(existing?.affected_personas ?? []), ...sessIds.map((s) => personaOf.get(s)!)])], session_ids: [...new Set([...(existing?.session_ids ?? []), ...sessIds])], fingerprint, disagreement, trust_level: trust, status: folded ? 'folded' : 'open', recommendation: g.recommendation, url_pattern: pathOf(mainUrl), repro_path_id: replay?.repro_path_id ?? existing?.repro_path_id, embedding: emb, study_id: studyId };
    if (existing) await db.update(issues).set(row).where(eq(issues.id, issueId));
    else await db.insert(issues).values({ id: issueId, app_version_id: study.app_version_id, ...row });
    await db.update(issueCandidates).set({ issue_id: issueId, attribution, attribution_detail: { replay: replay?.reproduced ?? null, expert_hit: expertHit, rationale } }).where(inArray(issueCandidates.id, members.map((m) => m.id)));
    const evIds = [...new Set(members.flatMap((m) => m.evidence_ids ?? []))];
    for (const [i, e] of evIds.entries()) await linkEvidence(e, 'issue', issueId, i === 0 ? 'primary' : 'supporting');
    if (replay) await linkEvidence(replay.evidence_id, 'issue', issueId, replay.reproduced ? 'supporting' : 'counter');
    const isNew = !existing;
    await touch(study.app_version_id, 'issue', fingerprint, sessIds[0], { label: g.title, newIssue: isNew });
    created.push(issueId);
  }
  return created;
}

const appIdCache = new Map<string, string>();
async function appIdOf(studyId: string) {
  if (appIdCache.has(studyId)) return appIdCache.get(studyId)!;
  const db = getDb();
  const r = await db.execute<{ app_id: string }>(`select av.app_id from studies s join app_versions av on av.id = s.app_version_id where s.id = '${studyId.replace(/'/g, '')}'` as never);
  const id = (r.rows[0] as { app_id: string }).app_id; appIdCache.set(studyId, id); return id;
}

/** 分歧度：评审之间满意度分数的标准差（未归一化，§12.3） */
async function disagreementFor(sessionIds: string[]) {
  const js = await getDb().select().from(judgments).where(and(inArray(judgments.target_id, sessionIds), eq(judgments.phase, 'objective_only')));
  const vals = js.map((j) => (j.scores as { satisfaction?: number }).satisfaction).filter((v): v is number => typeof v === 'number');
  if (vals.length < 2) return 0;
  const m = vals.reduce((a, b) => a + b, 0) / vals.length;
  return Math.round(Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length) * 100) / 100;
}

// ---------------------------------------------------------------- 假设判定
const HypSchema = z.object({ results: z.array(z.object({ id: z.string(), status: z.enum(['supported', 'refuted', 'inconclusive']), rationale: z.string(), issue_ids: z.array(z.string()) })) });
export async function evaluateHypotheses(studyId: string) {
  const db = getDb();
  const study = (await db.select().from(studies).where(eq(studies.id, studyId)))[0];
  const appId = await appIdOf(studyId);
  const hyps = await db.select().from(hypotheses).where(eq(hypotheses.app_id, appId));
  if (!hyps.length) return [];
  const iss = await db.select().from(issues).where(and(eq(issues.app_version_id, study.app_version_id), eq(issues.study_id, studyId)));
  const sess = await db.select().from(sessions).where(eq(sessions.study_id, studyId));
  const segStats: Record<string, { n: number; success: number; gave_up: number }> = {};
  for (const s of sess) { const p = await getPersona(s.persona_id, s.persona_version); const k = p?.spec.segment ?? '?'; segStats[k] ??= { n: 0, success: 0, gave_up: 0 }; segStats[k].n++; if (s.outcome === 'success') segStats[k].success++; if (s.outcome === 'gave_up') segStats[k].gave_up++; }
  const r = await gateway().chat('judge_meta', { messages: [{ role: 'user', content: `根据本轮模拟结果判断每条产品假设的状态（supported/refuted/inconclusive）。样本量小、证据不足时必须给 inconclusive。\n假设：\n${hyps.map((h) => `${h.id} | ${h.statement} | 目标人群 ${(h.target_segments ?? []).join(',')}`).join('\n')}\n\n各人群结果：${JSON.stringify(segStats)}\n\n发现的问题：\n${iss.map((i) => `${i.id} | ${i.category} | ${i.severity} | ${i.attribution} | 人群 ${(i.affected_segments ?? []).join(',')} | ${i.title}`).join('\n')}` }], schema: HypSchema, schemaName: 'hypotheses', tags: { study_id: studyId, purpose: 'hypotheses' } });
  for (const res of r.data.results) {
    const h = hyps.find((x) => x.id === res.id); if (!h) continue;
    await db.update(hypotheses).set({ status: res.status, rationale: res.rationale, evidence_ids: res.issue_ids }).where(eq(hypotheses.id, h.id));
    await touch(study.app_version_id, 'hypothesis', h.id, sess[0]?.id ?? '', { label: h.statement });
  }
  return r.data.results;
}

// ---------------------------------------------------------------- 分数聚合（人群 × 场景 × 维度）
const pct = (arr: number[], p: number) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))))]; };
export async function aggregateScores(studyId: string) {
  const db = getDb();
  await db.delete(scores).where(eq(scores.study_id, studyId));
  const sess = (await db.select().from(sessions).where(eq(sessions.study_id, studyId))).filter((s) => s.status === 'evaluated' || s.status === 'finished');
  const wts = new Map((await db.select().from(worldTemplates)).map((w) => [w.id, w.scenario_class]));
  const bucket = new Map<string, { segment: string; scenario: string; dim: string; cls: string; vals: number[] }>();
  const add = (segment: string, scenario: string, dim: string, cls: string, v: number | null | undefined) => {
    if (v === null || v === undefined || Number.isNaN(v)) return;
    for (const [sg, sc] of [[segment, scenario], [segment, '*'], ['*', scenario], ['*', '*']]) { const k = `${sg}|${sc}|${dim}|${cls}`; const b = bucket.get(k) ?? { segment: sg, scenario: sc, dim, cls, vals: [] }; b.vals.push(v); bucket.set(k, b); }
  };
  for (const s of sess) {
    const p = await getPersona(s.persona_id, s.persona_version); const seg = p?.spec.segment ?? '?'; const sc = wts.get(s.world_template_id) ?? '?';
    const m = (s.summary as { objective?: { task_completed?: boolean | null; steps?: number; expectation_violations?: number } } | null)?.objective;
    add(seg, sc, 'task_completion', 'objective', m?.task_completed === null || m?.task_completed === undefined ? null : m.task_completed ? 1 : 0);
    add(seg, sc, 'persona_claimed_success', 'objective', s.outcome === 'success' ? 1 : 0);
    add(seg, sc, 'steps', 'objective', m?.steps);
    add(seg, sc, 'expectation_violations', 'objective', m?.expectation_violations);
    const js = await db.select().from(judgments).where(and(eq(judgments.target_id, s.id), eq(judgments.phase, 'with_monologue')));
    for (const dim of ['perceived_difficulty', 'trust', 'satisfaction', 'cognitive_load', 'abandonment_intent', 'value']) for (const j of js) add(seg, sc, dim, 'simulated_subjective', (j.scores as Record<string, number>)[dim]);
    const itv = (await db.select().from(interviews).where(and(eq(interviews.session_id, s.id), eq(interviews.kind, 'post_session'))))[0];
    const q = itv?.questionnaire as { sus_score_simulated?: number; umux_lite_simulated?: number } | undefined;
    add(seg, sc, 'sus', 'simulated_subjective', q?.sus_score_simulated); add(seg, sc, 'umux_lite', 'simulated_subjective', q?.umux_lite_simulated);
  }
  const appId = await appIdOf(studyId);
  const calib = await db.select().from(calibrationResults).where(eq(calibrationResults.app_id, appId));
  for (const b of bucket.values()) {
    const n = b.vals.length; const mean = b.vals.reduce((a, c) => a + c, 0) / n; const sd = Math.sqrt(b.vals.reduce((a, c) => a + (c - mean) ** 2, 0) / n);
    const trust = calib.find((c) => (c.segment === b.segment || c.segment === '*') && c.dimension === b.dim)?.trust_level ?? (b.cls === 'objective' ? 'medium' : 'unknown');
    await db.insert(scores).values({ id: newId('score'), study_id: studyId, segment: b.segment, scenario_class: b.scenario, dimension: b.dim, eval_class: b.cls, mean, p10: pct(b.vals, 10), p90: pct(b.vals, 90), stdev: sd, n, trust_level: trust, method: 'raw' });
  }
  return bucket.size;
}
export { vec };
