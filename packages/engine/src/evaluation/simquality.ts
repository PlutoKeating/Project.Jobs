// 模拟质量指标（§19）：模拟器错误率、循环/停滞率、行为差异度、状态与行为一致率、覆盖增长
import type { ActionRequest, ActionResult } from '@pux/core';
import { eq, getDb, observations, sessions, steps } from '@pux/db';
import { getPersona } from '../human/persona.ts';

function editDistance(a: string[], b: string[]) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}
const normDist = (a: string[], b: string[]) => (a.length || b.length ? editDistance(a, b) / Math.max(a.length, b.length) : 0);

const NEG = /烦|急|气|慌|累|失望|焦虑|郁闷|无语|崩溃|不耐烦|annoy|frustrat|anxious|tired|angry|upset|stress|confus/i;
const POS = /开心|满意|轻松|不错|好用|高兴|放心|happy|pleased|relieved|good|great|calm/i;

export async function simQuality(studyId: string) {
  const db = getDb();
  const sess = (await db.select().from(sessions).where(eq(sessions.study_id, studyId))).filter((s) => s.outcome);
  let actions = 0; let simErr = 0; let consistent = 0; let judged = 0;
  const seqs: { id: string; persona: string; tags: string[]; task: string; seq: string[]; steps: number; outcome: string }[] = [];
  for (const s of sess) {
    const st = await db.select().from(steps).where(eq(steps.session_id, s.id)).orderBy(steps.idx);
    const obs = await db.select({ state_id: observations.state_id }).from(observations).where(eq(observations.session_id, s.id)).orderBy(observations.step_idx);
    for (const x of st) {
      const q = x.action_request as ActionRequest | null; const r = x.action_result as ActionResult | null;
      if (q?.verb) actions++;
      if (r?.error?.layer === 'simulator') simErr++;
      const ds = x.dynamic_state as { mood?: number; stress?: number; emotion?: string } | null;
      if (ds?.emotion) {
        judged++;
        const neg = NEG.test(ds.emotion); const pos = POS.test(ds.emotion);
        const stateNeg = (ds.mood ?? 0) < -0.15 || (ds.stress ?? 0) > 0.6;
        if ((neg && stateNeg) || (pos && !stateNeg) || (!neg && !pos)) consistent++;
      }
    }
    const p = await getPersona(s.persona_id, s.persona_version);
    seqs.push({ id: s.id, persona: s.persona_id, tags: p?.spec.tags ?? [], task: String(s.goal_id ?? ''), seq: obs.map((o) => o.state_id).filter((v, i, a) => a[i - 1] !== v), steps: st.length, outcome: s.outcome ?? '' });
  }
  // 行为差异度：同一对照组（同画像不同策略）之间，以及全体两两之间的路径归一化编辑距离
  const pairGroups = new Map<string, typeof seqs>();
  for (const q of seqs) for (const t of q.tags.filter((x) => x.startsWith('pair_'))) { const g = pairGroups.get(t) ?? []; g.push(q); pairGroups.set(t, g); }
  const pairDiv: { group: string; distance: number; steps_diff: number; outcome_diff: boolean; n: number }[] = [];
  for (const [g, list] of pairGroups) {
    const byP = new Map<string, typeof seqs>(); for (const q of list) byP.set(q.persona, [...(byP.get(q.persona) ?? []), q]);
    const ps = [...byP.keys()]; if (ps.length < 2) continue;
    const ds: number[] = []; const sd: number[] = []; let od = 0; let n = 0;
    for (const a of byP.get(ps[0])!) for (const b of byP.get(ps[1])!) { ds.push(normDist(a.seq, b.seq)); sd.push(Math.abs(a.steps - b.steps)); if (a.outcome !== b.outcome) od++; n++; }
    pairDiv.push({ group: g, distance: avg(ds), steps_diff: avg(sd), outcome_diff: od > 0, n });
  }
  const all: number[] = [];
  for (let i = 0; i < seqs.length; i++) for (let j = i + 1; j < seqs.length; j++) if (seqs[i].persona !== seqs[j].persona) all.push(normDist(seqs[i].seq, seqs[j].seq));
  return {
    sessions: sess.length, actions,
    simulator_error_rate: actions ? simErr / actions : 0,
    loop_stall_rate: sess.length ? sess.filter((s) => s.outcome === 'stalled').length / sess.length : 0,
    sim_error_sessions: sess.filter((s) => s.outcome === 'sim_error').length,
    behavior_diversity: avg(all), behavior_diversity_pairs: pairDiv,
    state_behavior_consistency: judged ? consistent / judged : null,
  };
}
const avg = (a: number[]) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 1000) / 1000 : 0);
