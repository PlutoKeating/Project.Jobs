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
  it('产品被清零或删除：它的分支、听来的口碑、那几次使用留下的一般感受都忘掉，别的产品和自我不受影响', () => {
    const t = MemoryTree.create('p1');
    t.seedCore([{ content: '我是我', embedding: vecOf(400) }], 1);
    t.add(BRANCH.app('appA'), '导出很好用', vecOf(30), meta({ app_id: 'appA', session_id: 's1' }));
    t.add(BRANCH.people, '老王说 appA 不错', vecOf(31), meta({ kind: 'hearsay', app_id: 'appA' }));
    t.add(BRANCH.self, '用完 appA 觉得 AI 也没那么可怕', vecOf(32), meta({ kind: 'belief', session_id: 's1' }));
    t.add(BRANCH.app('appB'), '另一个应用的事', vecOf(33), meta({ app_id: 'appB', session_id: 's9' }));
    t.add(BRANCH.self, '我不轻易付费', vecOf(34), meta({ kind: 'belief' }));
    expect(t.forgetApp('appA', new Set(['s1']))).toBe(3);
    expect(t.hasBranch(BRANCH.app('appA'))).toBe(false); expect(t.dirty).toBe(true);
    expect(t.list(99).map((m) => m.content).sort()).toEqual(['另一个应用的事', '我不轻易付费', '我是我'].sort());
    expect(t.tree.verify()).toEqual([]);
    const back = MemoryTree.from('p1', JSON.parse(JSON.stringify(t.tree.toJSON())), 1);
    expect(back.forgetApp('appA')).toBe(0); expect(back.dirty).toBe(false);
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

// ---------------------------------------------------------------- 人口：统计骨架 + 规则推导
import { PersonaSpecSchema as Spec } from '@pux/core';
import { buildRelations, deriveTraits, fallbackRowsEn, householdsFromRows, marginals, sampleHouseholdsZh, type Resident } from '@pux/engine';
import { absMinute, actKindOf, computeLayout, dateOfAbs, initialNeeds, inferRole, loadTown, needOverride, needsAt, phoneAffinity, placeContext, skeletonAgenda, tickNeeds, toMin, workplaceFor } from '@pux/jobsworld';

describe('人口合成', () => {
  const zh = sampleHouseholdsZh(new Rng(42), 300); const people = zh.flatMap((h) => h.members);
  it('同一个种子得到同一批人；家庭结构与年龄、学历的边际分布落在合理范围', () => {
    expect(sampleHouseholdsZh(new Rng(42), 300).flatMap((h) => h.members).map((m) => `${m.age}${m.occupation}`)).toEqual(people.map((m) => `${m.age}${m.occupation}`));
    const m = marginals(people);
    expect(m.n).toBeGreaterThanOrEqual(300);
    expect(m.age['60+']).toBeGreaterThan(0.1); expect(m.age['60+']).toBeLessThan(0.35);
    expect(m.education['初中及以下']).toBeGreaterThan(0.2);           // 多数人没上过大学，不能全是白领
    expect(m.education['研究生'] ?? 0).toBeLessThan(0.08);
    expect(zh.filter((h) => h.members.length === 1).length / zh.length).toBeGreaterThan(0.12);
    expect(zh.some((h) => h.type === 'three_generation')).toBe(true);
  });
  it('年龄越大学历越低的趋势存在；老人多数已退休；孩子在上学', () => {
    const low = (xs: typeof people) => xs.filter((p) => p.education === '初中及以下').length / Math.max(1, xs.length);
    expect(low(people.filter((p) => p.age >= 60))).toBeGreaterThan(low(people.filter((p) => p.age >= 18 && p.age < 30)));
    const old = people.filter((p) => p.age >= 65); expect(old.filter((p) => p.work_group === 'retired').length / old.length).toBeGreaterThan(0.6);
    for (const k of people.filter((p) => p.age < 18)) expect(k.work_group).toBe('school_kid');
  });
  it('能力与性格由规则推导：群体内差异很大，年龄和学历的影响方向正确，结果能通过人物 schema', () => {
    const adults = people.filter((p) => p.age >= 18);
    const t = adults.map((p) => ({ p, t: deriveTraits(p, new Rng(p.age * 131 + p.income_month)) }));
    const dl = t.map((x) => x.t.capability.digital_literacy).sort((a, b) => a - b);
    expect(dl[Math.floor(dl.length * 0.9)] - dl[Math.floor(dl.length * 0.1)]).toBeGreaterThan(0.4);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(t.filter((x) => x.p.age < 30).map((x) => x.t.capability.digital_literacy))).toBeGreaterThan(mean(t.filter((x) => x.p.age >= 60).map((x) => x.t.capability.digital_literacy)) + 0.25);
    expect(mean(t.filter((x) => x.p.age >= 65).map((x) => x.t.capability.body.vision))).toBeLessThan(0.8);
    expect(new Set(t.map((x) => x.t.behavior_policy.reading)).size).toBe(2);
    expect(new Set(t.map((x) => x.t.segment)).size).toBeGreaterThanOrEqual(6);
    const { p, t: tr } = t[0]; const { psychology_numbers, ...rest } = tr;
    const spec = Spec.parse({ id: 'zh_r_test', kind: 'synthetic', locale: 'zh-CN', segment: rest.segment, target_user: false, tags: rest.tags, identity: { name: '测试', age: p.age, gender: p.gender, region: p.region, education: p.education, occupation: p.occupation, life_story: 'x' }, capability: rest.capability, psychology: { ...psychology_numbers }, behavior_policy: { ...rest.behavior_policy, abandonment_rules: [] }, state_defaults: rest.state_defaults });
    expect(spec.capability.digital_literacy).toBeGreaterThanOrEqual(0);
    const kid = people.find((x) => x.age < 14)!; const kt = deriveTraits(kid, new Rng(1));
    expect(kt.child_profile?.literacy_chars).toBeGreaterThan(0); expect(kt.segment).toMatch(/^child_/);
  });
  it('英语区：从个人行拼成家庭，已婚者有配偶，孩子并入年龄合适的家庭', () => {
    const hh = householdsFromRows(fallbackRowsEn(new Rng(5), 400), new Rng(6), 120, 'fallback-en');
    const ps = hh.flatMap((h) => h.members);
    expect(ps.length).toBeGreaterThanOrEqual(110);
    expect(hh.some((h) => h.members.some((m) => m.role === 'spouse'))).toBe(true);
    for (const h of hh) for (const c of h.members.filter((m) => m.role === 'child' && m.age < 18)) expect(h.members[0].age - c.age).toBeGreaterThanOrEqual(19);
    expect(new Set(ps.map((p) => p.work_group)).size).toBeGreaterThanOrEqual(6);
  });
  it('关系网：家人关系最强；朋友只在同语言、年龄相近的人之间', () => {
    const res: Resident[] = zh.slice(0, 40).flatMap((h) => h.members.map((m) => ({ id: m.key, household_id: h.id, locale: m.locale, role: m.role, age: m.age, work_group: m.work_group, workplace: ['office', 'tech'].includes(m.work_group) ? 'office' : undefined, home_place: 'home_a', home_unit: 0, segment: 'x' })));
    res.push({ id: 'en_1', household_id: 'h_en', locale: 'en-US', role: 'head', age: 30, work_group: 'office', workplace: 'office', segment: 'x' });
    const rel = buildRelations(res, new Rng(3));
    const couple = zh.slice(0, 40).find((h) => h.members.some((m) => m.role === 'spouse'))!;
    const [a, b] = [couple.members[0].key, couple.members.find((m) => m.role === 'spouse')!.key].sort();
    expect(rel.find((r) => r.a === a && r.b === b)).toMatchObject({ kind: 'spouse', strength: 0.95 });
    const byId = new Map(res.map((r) => [r.id, r]));
    for (const r of rel.filter((x) => x.kind === 'friend')) { expect(byId.get(r.a)!.locale).toBe(byId.get(r.b)!.locale); expect(Math.abs(byId.get(r.a)!.age - byId.get(r.b)!.age)).toBeLessThanOrEqual(9); }
    for (const r of rel) expect(r.a < r.b).toBe(true);
  });
});

describe('需求驱动的生活', () => {
  const linwei = Spec.parse(readYaml(configPath('personas/hero/zh_linwei.yaml')));
  const kid = Spec.parse(readYaml(configPath('personas/child/zh_child_doudou.yaml')));
  it('需求按正在做的事变化：睡觉回血，吃饭解饿，一个人待久了会孤单', () => {
    const n0 = { ...initialNeeds(linwei, 0), hunger: 0.5, energy: 0.4, social: 0.5 };
    expect(tickNeeds(n0, 240, 'sleep', linwei, { companions: 0 }).energy).toBeGreaterThan(0.9);
    expect(tickNeeds(n0, 20, 'meal', linwei, { companions: 1 }).hunger).toBe(0);
    expect(tickNeeds(n0, 240, 'work', linwei, { companions: 0 }).hunger).toBeGreaterThan(0.9);
    expect(tickNeeds(n0, 300, 'leisure', linwei, { companions: 0 }).social).toBeLessThan(0.5);
    expect(tickNeeds(n0, 60, 'leisure', linwei, { companions: 2 }).social).toBeGreaterThan(0.5);
    expect(tickNeeds({ ...n0, hunger: 0.95, energy: 0.1 }, 120, 'work', linwei, { companions: 0 }).mood).toBeLessThan(n0.mood);
  });
  it('需求真的改写行为：饿极了去吃，手头紧就买便宜的，夜里困了提前睡，闷了找人聊', () => {
    const cur = { kind: 'work' as const, place_kind: 'office', minuteOfDay: 15 * 60, minutesToNextMeal: 200 };
    expect(needOverride({ hunger: 0.9, energy: 0.6, social: 0.5, stress: 0.3, mood: 0 }, cur, { wallet: 500, mealCost: 28, tight: false })).toMatchObject({ kind: 'meal', place_kind: 'restaurant', reason: 'hungry' });
    expect(needOverride({ hunger: 0.9, energy: 0.6, social: 0.5, stress: 0.3, mood: 0 }, cur, { wallet: 5, mealCost: 28, tight: true })).toMatchObject({ place_kind: 'shop' });
    expect(needOverride({ hunger: 0.9, energy: 0.6, social: 0.5, stress: 0.3, mood: 0 }, { ...cur, minutesToNextMeal: 20 }, { wallet: 500, mealCost: 28, tight: false })).toBeUndefined();
    expect(needOverride({ hunger: 0.2, energy: 0.05, social: 0.5, stress: 0.3, mood: 0 }, { kind: 'leisure', place_kind: 'home', minuteOfDay: 22 * 60, minutesToNextMeal: 999 }, { wallet: 500, mealCost: 28, tight: false })).toMatchObject({ kind: 'sleep', reason: 'exhausted' });
    expect(needOverride({ hunger: 0.2, energy: 0.6, social: 0.05, stress: 0.3, mood: 0 }, { kind: 'leisure', place_kind: 'home', minuteOfDay: 20 * 60, minutesToNextMeal: 999 }, { wallet: 500, mealCost: 28, tight: false })).toMatchObject({ kind: 'phone', reason: 'lonely' });
    expect(needOverride({ hunger: 0.3, energy: 0.6, social: 0.5, stress: 0.3, mood: 0 }, cur, { wallet: 500, mealCost: 28, tight: false })).toBeUndefined();
  });
  it('手机在不在手边：睡着和开车时不在，地铁上、睡前最常在；上课的孩子基本碰不到', () => {
    expect(phoneAffinity('sleep', 'home', linwei)).toBe(0); expect(phoneAffinity('commute', 'road', linwei, true)).toBe(0);
    expect(phoneAffinity('commute', 'subway', linwei)).toBeGreaterThan(phoneAffinity('work', 'office', linwei));
    expect(phoneAffinity('phone', 'home', linwei)).toBeGreaterThan(0.8);
    expect(phoneAffinity('study', 'school', kid)).toBeLessThan(0.05);
  });
  it('此时此地决定手眼耳嘴、设备和网络', () => {
    const sub = placeContext('commute', 'subway', linwei, { hashSeed: 1 });
    expect(sub).toMatchObject({ motion: 'vehicle', device: 'phone' }); expect(sub.channels.hands).toBe('one'); expect(sub.constraints).toContain('weak_network'); expect(sub.network.down_kbps).toBeLessThan(2000);
    expect(placeContext('work', 'office', linwei)).toMatchObject({ device: 'computer' });
    expect(placeContext('meal', 'restaurant', linwei).channels.mouth).toBe('busy');
    expect(placeContext('care', 'home', linwei).constraints).toContain('one_handed');
  });
  it('日程：按职业大类选角色和工作地点，每段都有活动类别，首尾相接；周末不上班', () => {
    const L = computeLayout(loadTown()); const home = { place_id: 'home_a', unit: 0 };
    expect(L.homes.length).toBeGreaterThanOrEqual(115);
    expect(inferRole(linwei, { work_group: 'delivery' })).toBe('driver'); expect(inferRole(linwei, { work_group: 'retired' })).toBe('senior'); expect(inferRole(kid)).toBe('child');
    expect(workplaceFor(L, 'delivery', 'x')).toBe('street'); expect(workplaceFor(L, 'retired', 'x')).toBeNull(); expect(workplaceFor(L, 'medical', 'x')).toBe('hospital');
    const wd = skeletonAgenda(L, linwei, '2026-11-16', home, { work_group: 'factory', workplace_id: 'factory' });      // 周一
    expect(wd.role).toBe('factory_shift'); expect(wd.items.some((i) => i.place_id === 'factory' && i.kind === 'work')).toBe(true);
    for (const [i, it] of wd.items.entries()) { expect(it.kind).toBeTruthy(); if (i) expect(it.from).toBe(wd.items[i - 1].to); }
    expect(wd.items[0].from).toBe('00:00'); expect(wd.items[wd.items.length - 1].to).toBe('24:00');
    const we = skeletonAgenda(L, linwei, '2026-11-15', home, { work_group: 'office', workplace_id: 'office' });        // 周日
    expect(we.role).toBe('weekend'); expect(we.items.some((i) => i.kind === 'work')).toBe(false);
    expect(actKindOf({ place_kind: 'home', activity: '睡觉' })).toBe('sleep'); expect(actKindOf({ place_kind: 'subway', activity: '通勤上班' })).toBe('commute');
  });
  it('需求可以按日程从上次结算的时刻推进到现在；世界分钟可以还原成日期', () => {
    const L = computeLayout(loadTown()); const a = skeletonAgenda(L, linwei, '2026-11-16', { place_id: 'home_a', unit: 0 }, { work_group: 'office', workplace_id: 'office' });
    const noon = needsAt(linwei, null, a, '2026-11-16', toMin('11:50'), () => 0); const after = needsAt(linwei, noon, a, '2026-11-16', toMin('13:05'), () => 1);
    expect(noon.hunger).toBeGreaterThan(0.6); expect(after.hunger).toBeLessThan(0.2); expect(after.at).toBe(absMinute('2026-11-16', toMin('13:05')));
    expect(dateOfAbs(absMinute('2026-11-16', 600))).toBe('2026-11-16'); expect(absMinute('2026-01-01', 0)).toBe(0);
  });
});
