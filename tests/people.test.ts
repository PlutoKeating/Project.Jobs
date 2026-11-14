// 阶段②「世界和人」：记忆树（ewave）、态度规则、人口、需求与日程、世界合并
import { describe, expect, it } from 'vitest';
import { PersonaSpecSchema, Rng, configPath, readYaml } from '@pux/core';
import { BRANCH, MAX_LEAVES, MEMORY_DIM, MemoryTree, compact } from '@pux/memory';
import { BELIEF_STEP, APP_TRUST_STEP_MAX, updateAttitudes, coreStatements } from '@pux/engine';

const granny = PersonaSpecSchema.parse(readYaml(configPath('personas/hero/zh_wangguilan.yaml')));
const vecOf = (seed: number, mix = 0) => { const r = new Rng(seed); const base = Array.from({ length: 768 }, () => r.normal()); if (!mix) return base; const o = new Rng(mix); return base.map((x) => x + o.normal() * 0.25); };
const meta = (over: Partial<Parameters<MemoryTree['add']>[3]> = {}) => ({ kind: 'episodic' as const, valence: 0.5, importance: 0.5, sim_day: 1, created_at: 1000, ...over });
const W = { alpha_relevance: 1, beta_recency: 0.6, gamma_importance: 0.8, recency_half_life_h: 168 };

describe('记忆树（ewave）', () => {
  it('向量截断归一化；每人一棵树，按分支存放，结构自洽', () => {
    const c = compact(vecOf(1)); expect(c).toHaveLength(MEMORY_DIM); expect(Math.hypot(...c)).toBeCloseTo(1, 2);
    const t = MemoryTree.create('p1');
    t.add(BRANCH.app('appA'), '这个应用写周报挺快', vecOf(2), meta({ app_id: 'appA' }));
    t.add(BRANCH.self, 'AI 写的东西要自己再看一遍', vecOf(3), meta({ kind: 'belief' }));
    expect(t.stats().leaves).toBe(2); expect(t.tree.verify()).toEqual([]);
    const back = MemoryTree.from('p1', JSON.parse(JSON.stringify(t.tree.toJSON())), 1);
    expect(back.list().map((m) => m.branch).sort()).toEqual(['app:appA', 'self']);
  });
  it('只在自己的 core / self / life / people 和当前产品的分支里回忆；想起一件事也会带出相反的经历', () => {
    const t = MemoryTree.create('p1');
    t.add(BRANCH.app('appA'), '导出很好用', vecOf(10), meta({ app_id: 'appA', valence: 0.8 }));
    t.add(BRANCH.app('appA'), '导出把我的格式全弄乱了', vecOf(10, 7), meta({ app_id: 'appA', valence: -0.8 }));
    t.add(BRANCH.app('appB'), '另一个应用的事', vecOf(10, 9), meta({ app_id: 'appB' }));
    expect(t.stats().conflicts).toBe(1);
    const r = t.recall(vecOf(10), { appId: 'appA', simDay: 1, k: 1, weights: W });
    expect(r.map((m) => m.content)).not.toContain('另一个应用的事');
    expect(r).toHaveLength(2); expect(r[1].conflicts_with).toBe(r[0].id);
    expect(t.recall(vecOf(10), { appId: 'appB', simDay: 1, k: 5, weights: W }).map((m) => m.content)).toEqual(['另一个应用的事']);
  });
  it('几乎一样的记忆只想起一条；测试环境重置后只回忆本批次里关于该产品的经历', () => {
    const t = MemoryTree.create('p1');
    for (let i = 0; i < 4; i++) t.add(BRANCH.app('appA'), `白嫖 ${i}`, vecOf(20, 100 + i).map((x, k) => x + (k === 0 ? i * 1e-3 : 0)), meta({ app_id: 'appA', session_id: i < 2 ? 's_old' : 's_new' }), { linkSimilar: false });
    t.add(BRANCH.self, '我不轻易付费', vecOf(21), meta({ kind: 'belief' }));
    const all = t.recall(vecOf(20), { appId: 'appA', simDay: 1, k: 5, weights: W });
    expect(all.length).toBeLessThan(5);
    const scoped = t.recall(vecOf(20), { appId: 'appA', simDay: 1, k: 9, weights: W, onlySessions: new Set(['s_new']) });
    expect(scoped.every((m) => m.content === '我不轻易付费' || /白嫖 [23]/.test(m.content))).toBe(true);
  });
  it('core 分支钉住不可改；超出上限时忘掉最不重要的，core 不会被忘', () => {
    const t = MemoryTree.create('p1');
    t.seedCore(coreStatements(granny).map((content, i) => ({ content, embedding: vecOf(300 + i) })), 1);
    const core = t.branch(BRANCH.core);
    expect(t.tree.lockMode(core.id)).toBe('read_only');
    expect(() => t.tree.add('想改写自我', { parent: core.id, embedding: compact(vecOf(1)) })).toThrow();
    const n = t.stats().leaves;
    for (let i = 0; i < MAX_LEAVES + 12; i++) t.add(BRANCH.life, `琐事 ${i}`, vecOf(1000 + i), meta({ kind: 'life', importance: i < 12 ? 0.01 : 0.5 }), { linkSimilar: false });
    expect(t.stats().leaves).toBe(MAX_LEAVES + n);
    expect(t.list(999).filter((m) => m.kind === 'core')).toHaveLength(n);
    expect(t.list(999).some((m) => m.content === '琐事 0')).toBe(false);
  });
});

describe('态度：海不被一朵浪改变', () => {
  const base = { ai_trust: 0.5, app_trust: {}, evidence: [], changed_day: null };
  it('一次经历只能把对这个产品的态度推动有限的一步，改不了对一类事物的全局信念', () => {
    const r = updateAttitudes(base, 0.5, { app_id: 'a', session_id: 's1', sim_day: 1, app_trust_delta: -0.5, ai_trust_delta: -0.5 });
    expect(r.app_trust.a).toBeCloseTo(0.5 - APP_TRUST_STEP_MAX); expect(r.ai_trust).toBe(0.5); expect(r.moved).toBe(0); expect(r.evidence).toHaveLength(1);
  });
  it('多次独立经历指向同一方向才动一小步，之后进入冷却期', () => {
    let s = { ...base } as Parameters<typeof updateAttitudes>[0];
    const step = (id: string, app: string, day: number, d = -0.4) => { const r = updateAttitudes(s, 0.5, { app_id: app, session_id: id, sim_day: day, app_trust_delta: d, ai_trust_delta: d }); s = { ai_trust: r.ai_trust, app_trust: r.app_trust, evidence: r.evidence, changed_day: r.changed_day }; return r; };
    expect(step('s1', 'a', 1).moved).toBe(0); expect(step('s2', 'a', 1).moved).toBe(0);
    expect(step('s3', 'a', 1).moved).toBe(0);                        // 三次都在同一天同一个产品：不算独立
    expect(step('s4', 'b', 2).moved).toBeCloseTo(-BELIEF_STEP); expect(s.ai_trust).toBeCloseTo(0.45);
    for (const [i, d] of [3, 3, 4].entries()) expect(step(`t${i}`, `c${i}`, d).moved).toBe(0);    // 冷却期内不再动
    expect(step('t9', 'd', 6).moved).toBeCloseTo(-BELIEF_STEP);
    expect(step('s1', 'a', 9).evidence.filter((e) => e.session_id === 's1')).toHaveLength(1);     // 同一次经历不重复计数
  });
});
