// 软件报告汇总：跨 Study 聚合「谁用过、目标客户是谁、实际谁更适配、典型反馈、问题趋势」
import { newId, z, type PersonaSpec } from '@pux/core';
import { and, apps, appVersions, appVerdicts, calibrationResults, desc, eq, getDb, hypotheses, inArray, interviews, issues, judgments, observations, sessions, steps, studies, worldTemplates } from '@pux/db';
import { latestPersonas } from '@pux/jobsworld';
import { gateway } from '@pux/llm';

type Lang = 'zh' | 'en';
export interface SessionFacts {
  id: string; study_id: string; version: string; persona_id: string; mode: string; world: string; scenario: string; expert: boolean;
  completed: boolean | null; sus: number | null; again: boolean | null; sat: number | null; outcome: string | null; started_at: Date | null;
}

const band = {
  age: (a: number) => (a < 18 ? '<18' : a < 30 ? '18–29' : a < 45 ? '30–44' : a < 60 ? '45–59' : '60+'),
  level: (v: number | undefined) => (v === undefined ? '?' : v < 0.4 ? 'low' : v < 0.7 ? 'mid' : 'high'),
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const rate = (xs: boolean[]) => (xs.length ? xs.filter(Boolean).length / xs.length : null);

export async function appSessions(appId: string) {
  const db = getDb();
  const rows = await db.select({ s: sessions, version: appVersions.version, study_created: studies.created_at })
    .from(sessions).innerJoin(studies, eq(studies.id, sessions.study_id)).innerJoin(appVersions, eq(appVersions.id, studies.app_version_id))
    .where(eq(appVersions.app_id, appId));
  return rows;
}

export async function sessionFacts(appId: string): Promise<SessionFacts[]> {
  const db = getDb();
  const rows = await appSessions(appId);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.s.id);
  const itv = await db.select({ session_id: interviews.session_id, q: interviews.questionnaire }).from(interviews).where(and(inArray(interviews.session_id, ids), eq(interviews.kind, 'post_session')));
  const qs = new Map(itv.map((i) => [i.session_id, i.q as { sus_score_simulated?: number; would_use_again?: boolean } | null]));
  const js = await db.select({ target_id: judgments.target_id, scores: judgments.scores }).from(judgments).where(and(eq(judgments.target, 'session'), inArray(judgments.target_id, ids), eq(judgments.eval_class, 'simulated_subjective')));
  const sat = new Map<string, number[]>();
  for (const j of js) { const v = (j.scores as { satisfaction?: number }).satisfaction; if (typeof v === 'number') sat.set(j.target_id, [...(sat.get(j.target_id) ?? []), v]); }
  const wt = new Map((await db.select({ id: worldTemplates.id, c: worldTemplates.scenario_class }).from(worldTemplates)).map((w) => [w.id, w.c]));
  return rows.map(({ s, version }) => {
    const sum = s.summary as { objective?: { task_completed?: boolean }; memory?: { would_return?: boolean } } | null;
    const q = qs.get(s.id);
    return {
      id: s.id, study_id: s.study_id, version, persona_id: s.persona_id, mode: s.mode, world: s.world_template_id, scenario: wt.get(s.world_template_id) ?? s.world_template_id, expert: s.is_expert_baseline,
      completed: sum?.objective?.task_completed ?? (s.outcome ? s.outcome === 'success' : null),
      sus: typeof q?.sus_score_simulated === 'number' ? q.sus_score_simulated : null,
      again: typeof q?.would_use_again === 'boolean' ? q.would_use_again : (typeof sum?.memory?.would_return === 'boolean' ? sum.memory.would_return : null),
      sat: mean(sat.get(s.id) ?? []), outcome: s.outcome, started_at: s.started_at,
    };
  });
}

export interface GroupStat { dim: string; key: string; n: number; personas: number; completion: number | null; sus: number | null; again: number | null; sat: number | null; fit: number | null; target: boolean }

function fitOf(g: Omit<GroupStat, 'fit' | 'dim' | 'key' | 'target'>): number | null {
  const parts: [number, number][] = [];
  if (g.completion !== null) parts.push([g.completion, 0.3]);
  if (g.sus !== null) parts.push([g.sus / 100, 0.3]);
  if (g.again !== null) parts.push([g.again, 0.25]);
  if (g.sat !== null) parts.push([(g.sat - 1) / 6, 0.15]);
  if (!parts.length) return null;
  const w = parts.reduce((a, [, k]) => a + k, 0);
  return parts.reduce((a, [v, k]) => a + v * k, 0) / w;
}

export function groupStats(facts: SessionFacts[], people: Map<string, PersonaSpec>, targetSegments: Set<string>): GroupStat[] {
  const dims: Record<string, (f: SessionFacts, p?: PersonaSpec) => string> = {
    segment: (_f, p) => p?.segment ?? '?',
    age: (_f, p) => band.age(p?.identity.age ?? 30),
    gender: (_f, p) => p?.identity.gender ?? '?',
    digital_literacy: (_f, p) => band.level(p?.capability.digital_literacy),
    ai_familiarity: (_f, p) => band.level(p?.capability.ai_familiarity),
    scenario: (f) => f.scenario,
    mode: (f) => f.mode,
    target_user: (_f, p) => (p?.target_user ? 'target' : 'general'),
  };
  const out: GroupStat[] = [];
  const subject = facts.filter((f) => !f.expert);
  for (const [dim, keyOf] of Object.entries(dims)) {
    const groups = new Map<string, SessionFacts[]>();
    for (const f of subject) { const k = keyOf(f, people.get(f.persona_id)); groups.set(k, [...(groups.get(k) ?? []), f]); }
    for (const [key, fs] of groups) {
      const g = {
        n: fs.length, personas: new Set(fs.map((f) => f.persona_id)).size,
        completion: rate(fs.map((f) => f.completed).filter((x): x is boolean => x !== null)),
        sus: mean(fs.map((f) => f.sus).filter((x): x is number => x !== null)),
        again: rate(fs.map((f) => f.again).filter((x): x is boolean => x !== null)),
        sat: mean(fs.map((f) => f.sat).filter((x): x is number => x !== null)),
      };
      out.push({ dim, key, ...g, fit: fitOf(g), target: dim === 'segment' ? targetSegments.has(key) : dim === 'target_user' ? key === 'target' : false });
    }
  }
  return out;
}

export async function declaredTargets(appId: string, facts: SessionFacts[], people: Map<string, PersonaSpec>): Promise<{ segments: string[]; source: 'hypotheses' | 'persona_flags' }> {
  const hs = await getDb().select({ t: hypotheses.target_segments }).from(hypotheses).where(eq(hypotheses.app_id, appId));
  const fromH = [...new Set(hs.flatMap((h) => h.t ?? []))];
  if (fromH.length) return { segments: fromH, source: 'hypotheses' };
  const flagged = [...new Set(facts.map((f) => people.get(f.persona_id)).filter((p) => p?.target_user).map((p) => p!.segment))];
  return { segments: flagged, source: 'persona_flags' };
}

export interface Quote { kind: 'rant' | 'praise' | 'interview'; text: string; persona_id: string; session_id: string; step_idx?: number; screenshot_ev?: string; sim_clock?: string; mood?: number; sus?: number | null; q?: string }

export async function feedbackWall(facts: SessionFacts[]): Promise<Quote[]> {
  const db = getDb();
  if (!facts.length) return [];
  const ids = facts.map((f) => f.id);
  const byId = new Map(facts.map((f) => [f.id, f]));
  const rows = await db.select({ session_id: steps.session_id, idx: steps.idx, monologue: steps.monologue, ds: steps.dynamic_state, ev: steps.expectation_violated, sim_clock: steps.sim_clock, obs: steps.observation_id })
    .from(steps).where(inArray(steps.session_id, ids));
  const scored = rows.filter((r) => (r.monologue ?? '').length > 8).map((r) => ({ ...r, mood: (r.ds as { mood?: number } | null)?.mood ?? 0 }));
  const pickDistinct = (xs: typeof scored, n: number) => { const seen = new Set<string>(); const out: typeof scored = []; for (const x of xs) { if (seen.has(x.session_id)) continue; seen.add(x.session_id); out.push(x); if (out.length >= n) break; } return out; };
  const rants = pickDistinct(scored.filter((r) => r.ev || r.mood < -0.25).sort((a, b) => a.mood - b.mood), 8);
  const praise = pickDistinct(scored.filter((r) => r.mood > 0.35).sort((a, b) => b.mood - a.mood), 6);
  const obsIds = [...rants, ...praise].map((r) => r.obs).filter((x): x is string => !!x);
  const shots = new Map((obsIds.length ? await db.select({ id: observations.id, data: observations.data }).from(observations).where(inArray(observations.id, obsIds)) : []).map((o) => [o.id, (o.data as { screenshot_ev?: string }).screenshot_ev]));
  const toQ = (kind: Quote['kind']) => (r: (typeof scored)[number]): Quote => ({ kind, text: r.monologue!, persona_id: byId.get(r.session_id)!.persona_id, session_id: r.session_id, step_idx: r.idx, screenshot_ev: r.obs ? shots.get(r.obs) : undefined, sim_clock: r.sim_clock ?? undefined, mood: r.mood });
  const itv = await db.select({ session_id: interviews.session_id, qa: interviews.qa }).from(interviews).where(and(inArray(interviews.session_id, ids), eq(interviews.kind, 'post_session')));
  const inter = itv.filter((i) => i.qa?.[0]?.a).map((i) => ({ i, sus: byId.get(i.session_id)?.sus ?? null }))
    .sort((a, b) => Math.abs((b.sus ?? 50) - 60) - Math.abs((a.sus ?? 50) - 60)).slice(0, 6)
    .map(({ i, sus }): Quote => ({ kind: 'interview', text: i.qa[0].a, q: i.qa[0].q, persona_id: byId.get(i.session_id)!.persona_id, session_id: i.session_id, sus }));
  return [...rants.map(toQ('rant')), ...praise.map(toQ('praise')), ...inter];
}

export async function appTrust(appId: string): Promise<{ level: string; recall?: number | null; fpr?: number | null; isolation_warning: boolean }> {
  const db = getDb();
  const rs = await db.select().from(calibrationResults).where(eq(calibrationResults.app_id, appId)).orderBy(desc(calibrationResults.computed_at)).limit(20);
  const recall = rs.find((r) => r.metric === 'issue_recall');
  const fpr = rs.find((r) => r.metric === 'false_positive_rate');
  const iso = await db.select({ w: studies.isolation_warning }).from(studies).innerJoin(appVersions, eq(appVersions.id, studies.app_version_id)).where(eq(appVersions.app_id, appId)).limit(50);
  return { level: recall?.trust_level ?? 'unknown', recall: recall?.value, fpr: fpr?.value, isolation_warning: iso.some((x) => !!x.w) };
}

export async function appRollup(appId: string) {
  const db = getDb();
  const [app] = await db.select().from(apps).where(eq(apps.id, appId));
  if (!app) return undefined;
  const versions = await db.select().from(appVersions).where(eq(appVersions.app_id, appId));
  const facts = await sessionFacts(appId);
  const roster = await latestPersonas();
  const people = new Map(roster.map((p) => [p.id, p.spec]));
  const targets = await declaredTargets(appId, facts, people);
  const groups = groupStats(facts, people, new Set(targets.segments));
  const avIds = versions.map((v) => v.id);
  const iss = avIds.length ? await db.select().from(issues).where(inArray(issues.app_version_id, avIds)) : [];
  const live = iss.filter((i) => i.status !== 'rejected' && i.status !== 'folded');
  const studyRows = avIds.length ? await db.select().from(studies).where(inArray(studies.app_version_id, avIds)).orderBy(studies.created_at) : [];
  const verOf = new Map(versions.map((v) => [v.id, v.version]));
  const subj = facts.filter((f) => !f.expert);
  const trend = studyRows.map((s) => {
    const fs = subj.filter((f) => f.study_id === s.id);
    const si = live.filter((i) => i.study_id === s.id);
    return { study_id: s.id, version: verOf.get(s.app_version_id) ?? '', created_at: s.created_at, status: s.status, sessions: fs.length,
      completion: rate(fs.map((f) => f.completed).filter((x): x is boolean => x !== null)), sus: mean(fs.map((f) => f.sus).filter((x): x is number => x !== null)),
      issues: { P0: si.filter((i) => i.severity === 'P0').length, P1: si.filter((i) => i.severity === 'P1').length, P2: si.filter((i) => i.severity === 'P2').length, P3: si.filter((i) => i.severity === 'P3').length } };
  }).filter((t) => t.sessions > 0);
  const usedBy = [...new Set(subj.map((f) => f.persona_id))].map((id) => {
    const fs = subj.filter((f) => f.persona_id === id); const p = people.get(id);
    return { id, name: p?.identity.name ?? id, segment: p?.segment ?? '?', target_user: p?.target_user ?? false, sessions: fs.length,
      completion: rate(fs.map((f) => f.completed).filter((x): x is boolean => x !== null)), sus: mean(fs.map((f) => f.sus).filter((x): x is number => x !== null)), again: rate(fs.map((f) => f.again).filter((x): x is boolean => x !== null)) };
  }).sort((a, b) => b.sessions - a.sessions);
  const sev = (s: string) => ({ P0: 0, P1: 1, P2: 2, P3: 3 } as Record<string, number>)[s] ?? 9;
  return {
    app: { id: app.id, name: app.name, description: app.description, form: app.form, versions: versions.map((v) => ({ id: v.id, version: v.version, url: v.env_url, seeded: Array.isArray(v.seeded_defects) ? v.seeded_defects.length : 0 })) },
    overview: {
      sessions: subj.length, expert_sessions: facts.length - subj.length, personas: usedBy.length, studies: trend.length,
      completion: rate(subj.map((f) => f.completed).filter((x): x is boolean => x !== null)),
      sus: mean(subj.map((f) => f.sus).filter((x): x is number => x !== null)),
      again: rate(subj.map((f) => f.again).filter((x): x is boolean => x !== null)),
      sat: mean(subj.map((f) => f.sat).filter((x): x is number => x !== null)),
      issues: { P0: live.filter((i) => i.severity === 'P0').length, P1: live.filter((i) => i.severity === 'P1').length, P2: live.filter((i) => i.severity === 'P2').length, P3: live.filter((i) => i.severity === 'P3').length, confirmed: live.filter((i) => i.status === 'confirmed').length },
      last_run: facts.reduce<Date | null>((m, f) => (f.started_at && (!m || f.started_at > m) ? f.started_at : m), null),
    },
    targets,
    groups,
    used_by: usedBy,
    issues: live.sort((a, b) => sev(a.severity) - sev(b.severity)).slice(0, 40).map((i) => ({ id: i.id, title: i.title, title_en: i.title_en, severity: i.severity, category: i.category, attribution: i.attribution, trust: i.trust_level, status: i.status, segments: i.affected_segments ?? [], sessions: (i.session_ids ?? []).length, recommendation: i.recommendation, study_id: i.study_id })),
    trend,
    trust: await appTrust(appId),
    quotes: await feedbackWall(subj),
  };
}

const VerdictSchema = z.object({
  headline: z.string(),
  rating: z.enum(['recommend', 'promising', 'mixed', 'not_ready']),
  summary: z.string(),
  best_for: z.array(z.string()).max(4),
  struggles_for: z.array(z.string()).max(4),
  strengths: z.array(z.string()).max(4),
  weaknesses: z.array(z.string()).max(4),
  next_steps: z.array(z.string()).max(4),
});
export type Verdict = z.infer<typeof VerdictSchema>;

export async function cachedVerdict(appId: string, lang: Lang) {
  const [v] = await getDb().select().from(appVerdicts).where(and(eq(appVerdicts.app_id, appId), eq(appVerdicts.lang, lang))).orderBy(desc(appVerdicts.created_at)).limit(1);
  return v;
}

/** judge.meta 生成一句话总评（只基于汇总数据，不新增结论来源） */
export async function generateVerdict(appId: string, lang: Lang) {
  const r = await appRollup(appId);
  if (!r || !r.overview.sessions) throw new Error(lang === 'zh' ? '还没有人用过这个软件' : 'No one has used this app yet');
  const basis = `${r.overview.sessions}:${r.issues.length}:${r.overview.issues.confirmed}`;
  const top = r.groups.filter((g) => g.n >= 2 && g.fit !== null).sort((a, b) => (b.fit ?? 0) - (a.fit ?? 0));
  const brief = {
    app: r.app.name, description: r.app.description,
    overview: { sessions: r.overview.sessions, personas: r.overview.personas, studies: r.overview.studies, completion_rate_0to1: r.overview.completion, sus_simulated_0to100: r.overview.sus, would_use_again_rate_0to1: r.overview.again, satisfaction_1to7: r.overview.sat, issues_by_severity: r.overview.issues }, declared_targets: r.targets,
    best_groups: top.slice(0, 6).map((g) => ({ dim: g.dim, key: g.key, n: g.n, fit_0to1: g.fit, completion_0to1: g.completion, sus_0to100: g.sus })),
    worst_groups: top.slice(-4).map((g) => ({ dim: g.dim, key: g.key, n: g.n, fit_0to1: g.fit, completion_0to1: g.completion, sus_0to100: g.sus })),
    issues: r.issues.slice(0, 12).map((i) => ({ severity: i.severity, title: i.title, segments: i.segments, trust: i.trust })),
    quotes: r.quotes.slice(0, 10).map((q) => ({ kind: q.kind, text: q.text.slice(0, 200) })),
    trust: r.trust,
  };
  const sys = lang === 'zh'
    ? '你是资深用户研究负责人。基于模拟用户评测的汇总数据，给出这个软件「到底怎么样」的结论。只能使用给定数据，不要编造；样本少或可信度低时要在 summary 里直说。注意：sessions 与各分组的 n 是「使用次数」（单位：次），不是人数；人数只看 overview.personas。headline 不超过 30 字。best_for/struggles_for 写具体人群。所有字段用中文。'
    : 'You are a senior UX research lead. From aggregated simulated-user study data, state plainly how good this app really is. Use only the given data; say so in the summary when samples are small or trust is low. Note: sessions and each group n count usage runs, not people; the number of people is overview.personas only. Headline ≤ 14 words. best_for/struggles_for name concrete user groups.';
  const out = await gateway().chat('judge_meta', { messages: [{ role: 'system', content: sys }, { role: 'user', content: JSON.stringify(brief) }], schema: VerdictSchema, schemaName: 'verdict', temperature: 0.3, tags: { purpose: 'app_verdict' } });
  const row = { id: newId('vrd'), app_id: appId, lang, basis, verdict: out.data };
  await getDb().insert(appVerdicts).values(row);
  return { ...row, created_at: new Date() };
}
