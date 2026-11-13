import type { ActionResult, DynamicState, PersonaSpec } from '@pux/core';

const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));

export interface StepFeedback {
  result?: ActionResult;
  expectation_violated: boolean;
  new_state: boolean;
  waited_s: number;                    // 本步等待时长（模拟）
  goal_progress: boolean;              // 本步是否推进了目标（Mind 自评 + 客观信号）
  world_state_delta?: Record<string, number>;
  sim_minutes: number;
}

/**
 * Dynamic State 规则引擎：状态变化由「世界事件 + 产品体验」驱动，而不是让 LLM 自说自话（§6、§22）。
 * Mind 只能感受到状态（描述词），不能直接改写数值。
 */
export function updateState(p: PersonaSpec, s: DynamicState, f: StepFeedback, consecutiveViolations: number): DynamicState {
  const n = { ...s };
  const N = p.psychology.ocean.N; const C = p.psychology.ocean.C;
  // 世界事件带来的状态增量
  for (const [k, v] of Object.entries(f.world_state_delta ?? {})) {
    if (k in n) (n as Record<string, number>)[k] = k === 'mood' ? clamp((n as Record<string, number>)[k] + v, -1, 1) : clamp((n as Record<string, number>)[k] + v);
  }
  // 时间流逝：疲劳、饥饿缓慢上升
  n.fatigue = clamp(n.fatigue + f.sim_minutes * 0.004);
  n.hunger = clamp(n.hunger + f.sim_minutes * 0.003);
  // 产品体验
  if (f.expectation_violated) {
    const cost = 4 + 3 * consecutiveViolations + 6 * N;
    n.patience -= cost; n.stress = clamp(n.stress + 0.05 + 0.05 * N); n.mood = clamp(n.mood - 0.08 - 0.05 * N, -1, 1);
  }
  if (f.result && (f.result.status === 'failed' || f.result.status === 'no_effect') && !['simulator', 'executor'].includes(f.result.error?.layer ?? '')) { n.patience -= 3; n.stress = clamp(n.stress + 0.03); }
  if (f.waited_s > p.behavior_policy.wait_tolerance_s) { const over = f.waited_s / p.behavior_policy.wait_tolerance_s; n.patience -= Math.min(15, 3 * over); n.mood = clamp(n.mood - 0.05 * over, -1, 1); }
  if (f.goal_progress) { n.patience = Math.min(p.behavior_policy.patience_base * 1.2, n.patience + 3); n.mood = clamp(n.mood + 0.06, -1, 1); n.stress = clamp(n.stress - 0.03); }
  if (!f.new_state && !f.goal_progress) n.patience -= 1.5;
  // 压力、疲劳侵蚀注意力；尽责性高的人更能坚持
  n.attention = clamp(n.attention - 0.01 - n.stress * 0.02 - n.fatigue * 0.01 + (f.goal_progress ? 0.02 : 0));
  n.patience = Math.round((n.patience - (n.stress > 0.8 ? 1.5 : 0) + (C - 0.5) * 0.5) * 10) / 10;
  return n;
}

/** 把数值状态翻译成 Persona 能「感受到」的描述 */
export function feelings(s: DynamicState, lang: 'zh' | 'en'): string {
  const z = lang === 'zh';
  const parts: string[] = [];
  if (s.fatigue > 0.7) parts.push(z ? '很累' : 'exhausted'); else if (s.fatigue > 0.45) parts.push(z ? '有点累' : 'a bit tired');
  if (s.hunger > 0.7) parts.push(z ? '很饿' : 'very hungry');
  if (s.stress > 0.75) parts.push(z ? '非常焦虑紧张' : 'very stressed'); else if (s.stress > 0.5) parts.push(z ? '有些着急' : 'somewhat stressed');
  if (s.mood < -0.5) parts.push(z ? '心情很糟、很烦' : 'really annoyed'); else if (s.mood < -0.15) parts.push(z ? '有点烦躁' : 'a little irritated'); else if (s.mood > 0.4) parts.push(z ? '心情不错' : 'in a good mood');
  if (s.attention < 0.3) parts.push(z ? '注意力很难集中' : 'struggling to focus');
  if (s.patience < 10) parts.push(z ? '耐心快耗尽了' : 'almost out of patience'); else if (s.patience < 25) parts.push(z ? '开始不耐烦' : 'getting impatient');
  return parts.length ? parts.join(z ? '，' : ', ') : (z ? '状态平稳' : 'feeling okay');
}
