// 自适应采样（§8.2）：决定「派谁、在什么世界里、带着什么生活目标、用哪种模式」，从不告诉 Persona 去测什么
import { existsSync } from 'node:fs';
import { dataPath, loadConfig, readJson, Rng, type Mode, type PersonaSpec, type StudyInput, type WorldTemplate } from '@pux/core';
import { and, calibrationResults, eq, getDb, hypotheses, inArray, issues, sessions, taskDefs } from '@pux/db';
import { coverageOf } from './coverage.ts';

export interface PlanItem {
  persona: PersonaSpec; persona_version: string; world: WorldTemplate; mode: Mode; task?: { id: string; statement: string; statement_en?: string | null; feature_ids: string[]; requires_login: boolean };
  is_expert_baseline: boolean; priority: number; reason: Record<string, number | string>; revisit_day?: number; hypothesis_ids: string[];
}

export function learningWeights(): Partial<Record<string, number>> {
  const p = dataPath('learning.json');
  try { return existsSync(p) ? (readJson<{ sampler_weights?: Record<string, number> }>(p).sampler_weights ?? {}) : {}; } catch { return {}; }
}

export async function planRound(opts: {
  study: { id: string; config: StudyInput; app_version_id: string; app_id: string; rng_seed: number };
  personas: { spec: PersonaSpec; version: string }[]; worlds: WorldTemplate[]; size: number; round: number;
}): Promise<PlanItem[]> {
  const cfg = loadConfig(); const w = { ...cfg.sampler_weights, ...learningWeights() };
  const db = getDb(); const rng = new Rng(opts.study.rng_seed + opts.round * 7919);
  const sc = opts.study.config;
  const done = await db.select().from(sessions).where(eq(sessions.study_id, opts.study.id));
  const tasks = await db.select().from(taskDefs).where(eq(taskDefs.app_version_id, opts.study.app_version_id));
  const hyps = (await db.select().from(hypotheses).where(eq(hypotheses.app_id, opts.study.app_id))).filter((h) => h.status === 'open' || h.status === 'inconclusive');
  const cov = await coverageOf(opts.study.app_version_id);
  const usedFeatures = new Set(cov.filter((c) => c.dimension === 'feature' && c.used).map((c) => c.key));
  const segCount = new Map<string, number>(); const scenCount = new Map<string, number>(); const modeCount = new Map<string, number>();
  for (const s of done) { const p = opts.personas.find((x) => x.spec.id === s.persona_id); if (p) segCount.set(p.spec.segment, (segCount.get(p.spec.segment) ?? 0) + 1); const wt = opts.worlds.find((x) => x.id === s.world_template_id); if (wt) scenCount.set(wt.scenario_class, (scenCount.get(wt.scenario_class) ?? 0) + 1); modeCount.set(s.mode, (modeCount.get(s.mode) ?? 0) + 1); }
  const calib = await db.select().from(calibrationResults).where(eq(calibrationResults.app_id, opts.study.app_id));
  const recentIssues = await db.select().from(issues).where(and(eq(issues.app_version_id, opts.study.app_version_id), inArray(issues.status, ['open', 'confirmed'])));
  const issueSegs = new Set(recentIssues.flatMap((i) => i.affected_segments ?? []));
  const issueUrls = recentIssues.map((i) => i.url_pattern).filter(Boolean) as string[];
  const totalDone = done.length || 1;
  const mix = sc.mode_mix; const mixTotal = mix.goal + mix.curiosity + mix.stress + mix.adversarial || 1;

  const persPool = opts.personas.filter((p) => (!sc.persona_ids?.length || sc.persona_ids.includes(p.spec.id)));
  const worldsPool = opts.worlds.filter((x) => !sc.world_ids?.length || sc.world_ids.includes(x.id));
  const cands: PlanItem[] = [];
  for (const p of persPool) {
    const en = p.spec.locale === 'en-US';
    const isChild = p.spec.kind === 'child';
    for (const world of worldsPool) {
      if (en && !(world.situation_en || world.id.startsWith('en_'))) continue;
      if (!en && world.id.startsWith('en_')) continue;
      if (isChild !== (world.scenario_class === 'kids_home')) continue;
      for (const mode of world.modes as Mode[]) {
        if ((mix[mode] ?? 0) <= 0) continue;
        if (mode === 'adversarial' && !p.spec.behavior_policy.adversarial_traits?.length) continue;
        const taskOpts = mode === 'goal' || mode === 'stress' ? (tasks.length ? tasks : [undefined]) : [undefined];
        for (const t of taskOpts) {
          const reason: Record<string, number | string> = {};
          let pr = 0;
          const tFeatures = t?.feature_ids ?? [];
          const unc = tFeatures.filter((f) => !usedFeatures.has(f)).length;
          if (tFeatures.length) { reason.uncovered_feature = w.uncovered_feature * (unc / tFeatures.length); pr += reason.uncovered_feature as number; }
          else if (mode === 'curiosity') { const ratio = 1 - (usedFeatures.size / Math.max(1, cov.filter((c) => c.dimension === 'feature').length || 1)); reason.uncovered_feature = w.uncovered_feature * 0.6 * ratio; pr += reason.uncovered_feature as number; }
          const hypIds = hyps.filter((h) => !(h.target_segments ?? []).length || (h.target_segments ?? []).includes(p.spec.segment)).map((h) => h.id);
          if (hypIds.length) { reason.open_hypothesis = w.open_hypothesis * Math.min(1, hypIds.length / 2); pr += reason.open_hypothesis as number; }
          const trust = calib.filter((c) => c.segment === p.spec.segment || c.segment === '*');
          const low = !trust.length ? 1 : trust.some((c) => c.trust_level === 'low') ? 0.8 : trust.every((c) => c.trust_level === 'high') ? 0 : 0.5;
          reason.low_trust = w.low_trust * low; pr += reason.low_trust as number;
          if (issueSegs.has(p.spec.segment) || (t && issueUrls.some((u) => (t.statement ?? '').includes(u)))) { reason.near_new_issue = w.near_new_issue * 0.8; pr += reason.near_new_issue as number; }
          reason.uncovered_segment = w.uncovered_segment / (1 + (segCount.get(p.spec.segment) ?? 0)); pr += reason.uncovered_segment as number;
          reason.uncovered_scenario = w.uncovered_scenario / (1 + (scenCount.get(world.scenario_class) ?? 0)); pr += reason.uncovered_scenario as number;
          const deficit = (mix[mode] / mixTotal) - (modeCount.get(mode) ?? 0) / totalDone;
          reason.mode_deficit = 2 * deficit; pr += reason.mode_deficit as number;
          const rep = done.filter((s) => s.persona_id === p.spec.id && s.mode === mode && (s.world_template_id === world.id)).length + done.filter((s) => s.persona_id === p.spec.id).length * 0.5;
          reason.repeat_penalty = -w.repeat_penalty * rep; pr += reason.repeat_penalty as number;
          if (p.spec.kind === 'expert') { reason.expert = -1; pr -= 1; }
          pr += rng.next() * 0.3;
          cands.push({ persona: p.spec, persona_version: p.version, world, mode, task: t ? { id: t.id, statement: t.statement, statement_en: t.statement_en, feature_ids: t.feature_ids ?? [], requires_login: t.requires_login } : undefined, is_expert_baseline: p.spec.kind === 'expert', priority: Math.round(pr * 1000) / 1000, reason, hypothesis_ids: hypIds });
        }
      }
    }
  }
  // 贪心选择 + 多样性：同一轮里同一 Persona 只出现一次
  cands.sort((a, b) => b.priority - a.priority);
  const picked: PlanItem[] = []; const usedP = new Set<string>();
  // 专家对照：每个尚无专家基线的任务先安排一次
  if (sc.expert_baseline) {
    const expertTasksDone = new Set(done.filter((s) => s.is_expert_baseline).map((s) => (s.plan_reason as { task_id?: string } | null)?.task_id));
    const exp = cands.find((c) => c.is_expert_baseline && c.task && !expertTasksDone.has(c.task.id) && c.mode === 'goal');
    if (exp) { picked.push(exp); usedP.add(exp.persona.id); }
  }
  for (const c of cands) { if (picked.length >= opts.size) break; if (usedP.has(c.persona.id)) continue; if (c.is_expert_baseline) continue; picked.push(c); usedP.add(c.persona.id); }
  for (const c of cands) { if (picked.length >= opts.size) break; if (picked.includes(c)) continue; picked.push(c); }
  return picked.slice(0, opts.size);
}
