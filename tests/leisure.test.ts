// 人物第七层「出门与吃喝玩乐」：随包数据与规则一致、依据可追溯、往事钉在记忆树的 past 分支里
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PersonaSpecSchema, Rng, configPath, readYaml, type PersonaSpec } from '@pux/core';
import { BRANCH, MAX_LEAVES, MemoryTree, compact } from '@pux/memory';
import { coreStatements, deriveLeisure, leisureBio, leisureVocab, pastMemories, personaBio } from '@pux/engine';

const residents = readFileSync(configPath('population', 'residents.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { spec: unknown; household: { type: string }; skeleton: { hobbies: string[] } });
const handwritten = ['hero', 'child'].flatMap((d) => readdirSync(configPath('personas', d)).filter((f) => f.endsWith('.yaml')).map((f) => PersonaSpecSchema.parse(readYaml(configPath('personas', d, f)))));
const specs: PersonaSpec[] = [...residents.map((r) => PersonaSpecSchema.parse(r.spec)), ...handwritten];
const vecOf = (seed: number) => { const r = new Rng(seed); return Array.from({ length: 768 }, () => r.normal()); };

// docs/research/README.md 里列出的调研编号（P 帖子、C 评论、N 诉求、R 推荐、W 避雷、H 交接待核线索）
const documented = new Set(readFileSync(configPath('..', 'docs', 'research', 'README.md'), 'utf8').match(/\b[PCNRWH]\d{3,4}\b/g) ?? []);

describe('出门与吃喝玩乐（PersonaSpec.leisure）', () => {
  it('随包居民与手写人物都带着这一层，并通过校验', () => {
    expect(specs.length).toBe(228 + 14);
    for (const s of specs) expect(s.leisure, s.id).toBeDefined();
  });

  it('随包数据就是规则推导的结果（改了规则或词表要重新生成 residents.jsonl）', () => {
    for (const r of residents) {
      const spec = PersonaSpecSchema.parse(r.spec);
      expect(deriveLeisure({ ...spec, leisure: undefined }, { hobbies: r.skeleton.hobbies, householdType: r.household.type }), spec.id).toEqual(spec.leisure);
    }
  });

  it('每条依据都能在 docs/research/README.md 里查到；儿童没有调研依据', () => {
    const V = leisureVocab();
    const vocabIds = [...V.activities.slow, ...V.activities.balanced, ...V.activities.packed, ...V.restrictions, ...V.dislikes, ...V.pet_peeves, ...V.habits, ...V.memories, ...Object.values(V.roles)].flatMap((x) => x.src ?? []);
    for (const id of new Set([...vocabIds, ...specs.flatMap((s) => s.leisure!.sources)])) expect(documented.has(id), id).toBe(true);
    for (const s of specs.filter((x) => x.kind === 'child')) expect(s.leisure!.sources, s.id).toEqual([]);
  });

  it('往事都落到了具体的人和地方上；不出远门的人没有出远门的往事和烦恼', () => {
    const V = leisureVocab();
    const tripPlaces = [...V.places.nearby.zh, ...V.places.domestic.zh, ...V.places.abroad.zh, ...V.places.nearby.en, ...V.places.domestic.en, ...V.places.abroad.en];
    for (const s of specs) {
      const l = s.leisure!;
      for (const m of l.memories) expect(m.text, s.id).not.toMatch(/[{}]/);
      if (l.trips.range === 'none') {
        expect(l.trips.per_year).toBe(0);
        for (const m of l.memories) for (const p of tripPlaces) expect(m.text.includes(p), `${s.id}: ${m.text}`).toBe(false);
        expect(l.pet_peeves.some((x) => /天天绑在一起|together every waking hour/.test(x)), s.id).toBe(false);
      }
    }
  });

  it('同一份性格分布下四种同行角色都有相当比例（不是人人都拿主意）', () => {
    const adults = specs.filter((s) => s.kind !== 'child' && s.identity.age >= 14);
    const share = (role: string) => adults.filter((s) => s.leisure!.group_role === role).length / adults.length;
    for (const r of ['planner', 'co_planner', 'follower', 'solo']) expect(share(r), r).toBeGreaterThan(0.1);
    expect(share('planner')).toBeLessThan(0.45);
  });

  it('进入人物的第一人称描述与钉住的自我', () => {
    const granny = handwritten.find((s) => s.id === 'zh_wangguilan')!;
    expect(personaBio(granny)).toContain(leisureBio(granny));
    expect(leisureBio(granny)).toMatch(/^出门与吃喝：/);
    expect(coreStatements(granny)).toContain('出去玩我习惯跟着别人的安排走');
    const george = handwritten.find((s) => s.id === 'en_george')!;
    expect(leisureBio(george)).toMatch(/^Going out: /);
    expect(personaBio({ ...george, leisure: undefined })).not.toContain('Going out');
  });

  it('往事钉在 past 分支：只读、能被想起、不按上限遗忘、产品清零时不动', () => {
    const granny = handwritten.find((s) => s.id === 'zh_wangguilan')!;
    const past = pastMemories(granny);
    expect(past.length).toBeGreaterThan(0); expect(past.every((m) => m.sim_day < 0)).toBe(true);
    const t = MemoryTree.create('p1');
    t.seedPast(past.map((m, i) => ({ ...m, embedding: vecOf(500 + i) })), 1);
    expect(t.tree.lockMode(t.branch(BRANCH.past).id)).toBe('read_only');
    t.seedPast([{ content: '不会写进去', embedding: vecOf(1), valence: 0, importance: 1, sim_day: -1 }], 2);
    expect(t.list(99).filter((m) => m.kind === 'past')).toHaveLength(past.length);
    for (let i = 0; i < MAX_LEAVES + 5; i++) t.add(BRANCH.life, `琐事 ${i}`, vecOf(1000 + i), { kind: 'life', valence: 0, importance: 0.9, sim_day: 300, created_at: 1 }, { linkSimilar: false });
    expect(t.list(999).filter((m) => m.kind === 'past')).toHaveLength(past.length);
    const r = t.recall(vecOf(500), { simDay: 300, k: 3, weights: { alpha_relevance: 1, beta_recency: 0.6, gamma_importance: 0.8, recency_half_life_h: 168 } });
    expect(r[0].content).toBe(past[0].content);
    t.forgetApp('appA');
    expect(t.list(999).filter((m) => m.kind === 'past')).toHaveLength(past.length);
    expect(compact(vecOf(1))).toHaveLength(256);
  });
});
