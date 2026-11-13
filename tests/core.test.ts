import { describe, expect, it } from 'vitest';
import { Rng, seedFrom, stableStringify, PersonaSpecSchema, readYaml, configPath, listFiles, WorldTemplateSchema, makeError } from '@pux/core';

describe('core', () => {
  it('Rng 可复现', () => {
    const a = new Rng(42); const b = new Rng(42);
    expect([a.next(), a.next(), a.int(1, 6)]).toEqual([b.next(), b.next(), b.int(1, 6)]);
    expect(seedFrom('abc')).toBe(seedFrom('abc'));
  });
  it('stableStringify 键序无关', () => { expect(stableStringify({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(stableStringify({ a: [2, { c: 2, d: 1 }], b: 1 })); });
  it('全部 Persona YAML 通过六层 schema 校验', () => {
    const files = listFiles(configPath('personas'), /\.ya?ml$/);
    expect(files.length).toBeGreaterThanOrEqual(14);
    for (const f of files) expect(() => PersonaSpecSchema.parse(readYaml(f)), f).not.toThrow();
  });
  it('全部世界模板通过校验，且包含 §7.2 因果链', () => {
    const files = listFiles(configPath('worlds'), /\.ya?ml$/);
    const ws = files.map((f) => WorldTemplateSchema.parse(readYaml(f)));
    const commute = ws.find((w) => w.id === 'commute_late_boss')!;
    expect(commute.timeline.filter((t) => t.caused_by).length).toBeGreaterThanOrEqual(6);
  });
  it('错误码映射到 §10.2 的层', () => {
    expect(makeError('PRODUCT_HTTP_5XX', 'x').layer).toBe('product');
    expect(makeError('SIM_LOOP', 'x').layer).toBe('simulator');
    expect(makeError('INJECTED_NETWORK', 'x').layer).toBe('injected');
    expect(makeError('POLICY_BLOCKED', 'x').layer).toBe('policy');
  });
});
