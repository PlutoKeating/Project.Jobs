import { describe, expect, it } from 'vitest';
import { PersonaSpecSchema, readYaml, configPath, Rng, WorldTemplateSchema, type ActionRequest } from '@pux/core';
import { urlTemplate, stateIdOf, checkPolicy, defaultCriteria } from '@pux/executor';
import { toGeminiSchema } from '@pux/llm';
import { containsBannedWords, filterByLiteracy, motorProfile, initialState, updateState, taskCompleted, wilson, spearman, trustLevel, WorldSimulator, personaBio, feelings } from '@pux/engine';
import { z } from 'zod';

const linwei = PersonaSpecSchema.parse(readYaml(configPath('personas/hero/zh_linwei.yaml')));
const child = PersonaSpecSchema.parse(readYaml(configPath('personas/child/zh_child_doudou.yaml')));
const baseReq = (over: Partial<ActionRequest>): ActionRequest => ({ action_id: 'a', session_id: 's', step_idx: 0, verb: 'click', intent_text: '', success: { any_of: [], within_ms: 1000 }, motor: motorProfile(linwei), timeout_ms: 1000, ...over });

describe('信息隔离', () => {
  it('Persona 提示词不含测试类词汇', () => { expect(containsBannedWords(personaBio(linwei))).toBe(false); expect(containsBannedWords('帮我测试一下导出')).toBe(true); expect(containsBannedWords('evaluate the usability')).toBe(true); });
});

describe('UAP', () => {
  it('URL 模板与 state_id 抽象', () => {
    expect(urlTemplate('http://a.com/chat/abc123def4567890?x=1&a=2')).toBe('a.com/chat/:id?a&x');
    const s1 = stateIdOf('http://a.com/chat/1', [{ ref: 'e1', role: 'button', name: '发送', tag: 'button', bbox: [0, 0, 1, 1], in_viewport: true, occluded: false, selector: 'x', kind: 'interactive' }], false);
    const s2 = stateIdOf('http://a.com/chat/2', [{ ref: 'e9', role: 'button', name: '发送', tag: 'button', bbox: [5, 5, 1, 1], in_viewport: true, occluded: false, selector: 'y', kind: 'interactive' }], false);
    expect(s1).toBe(s2);
  });
  it('默认成功标准符合 §10.1', () => { expect(defaultCriteria(baseReq({ verb: 'click' })).any_of.map((c) => c.kind)).toEqual(['url_changed', 'dom_changed', 'dialog_opened']); expect(defaultCriteria(baseReq({ verb: 'scroll' })).any_of[0].kind).toBe('viewport_changed'); });
  it('Policy Gate：儿童禁止支付/加陌生人，成人沙箱可支付', () => {
    const kid = { child: true, allow_real_payment: false, sandbox_domains: ['127.0.0.1'] };
    const adult = { child: false, allow_real_payment: false, sandbox_domains: ['127.0.0.1'] };
    expect(checkPolicy(baseReq({ intent_text: '点击立即支付 ¥6' }), kid, undefined, 'http://127.0.0.1/shop').allowed).toBe(false);
    expect(checkPolicy(baseReq({ intent_text: '点击添加好友' }), kid, undefined, 'http://127.0.0.1/').allowed).toBe(false);
    expect(checkPolicy(baseReq({ intent_text: '确认支付' }), adult, undefined, 'http://127.0.0.1/pay').allowed).toBe(true);
    expect(checkPolicy(baseReq({ intent_text: '确认支付' }), adult, undefined, 'https://real-shop.com/pay').allowed).toBe(false);
  });
});

describe('Human', () => {
  it('单手与颠簸降低动作精度和打字速度', () => {
    const a = motorProfile(linwei); const b = motorProfile(linwei, ['one_handed', 'bumpy_ride']);
    expect(b.precision).toBeLessThan(a.precision); expect(b.typing_cps).toBeLessThan(a.typing_cps); expect(b.typo_rate).toBeGreaterThan(a.typo_rate);
  });
  it('预期违背消耗耐心；模拟器错误不消耗', () => {
    const s0 = initialState(linwei);
    const s1 = updateState(linwei, s0, { expectation_violated: true, new_state: false, waited_s: 0, goal_progress: false, sim_minutes: 1 }, 2);
    expect(s1.patience).toBeLessThan(s0.patience - 5);
    const simErr = { status: 'failed', error: { code: 'SIM_INVALID_INTENT', layer: 'simulator', retryable: false, message: '' } } as never;
    const s2 = updateState(linwei, s0, { result: simErr, expectation_violated: false, new_state: true, waited_s: 0, goal_progress: false, sim_minutes: 0 }, 0);
    expect(s2.patience).toBeGreaterThan(s0.patience - 2);
    expect(feelings({ ...s0, stress: 0.9 }, 'zh')).toContain('焦虑');
  });
  it('识字量过滤', () => { const r = filterByLiteracy('请输入支付密码', child.capability.cognition.literacy_chars); expect(r.text).toContain('□'); expect(filterByLiteracy('你好', 3000).text).toBe('你好'); });
});

describe('World', () => {
  it('§7.2 因果链按时间触发并结算资源', async () => {
    const tpl = WorldTemplateSchema.parse(readYaml(configPath('worlds/commute_late_boss.yaml')));
    const w = new WorldSimulator(tpl, new Rng(1), 'zh');
    const evs = [...await w.advance(0, { step: 0, stress: 0.3, screenOn: true }), ...await w.advance(40 * 60, { step: 1, stress: 0.3, screenOn: true })];
    const types = evs.map((e) => e.type);
    expect(types).toContain('boss_message'); expect(types).toContain('traffic_jam');
    const jam = evs.find((e) => e.type === 'traffic_jam')!; const taxi = evs.find((e) => e.type === 'take_taxi')!;
    expect(jam.caused_by_event_id).toBe(taxi.id);
    expect(w.state.resources.time_left_min).toBeLessThan(80 - 40 - 19);
    expect(w.constraints().hard.one_handed).toBe(true);
    expect(w.takeNetworkChange()).toMatchObject({ down_kbps: 400 });
    expect(w.state.social_pending[0]?.from).toBe('老板');
  });
  it('时间耗尽触发硬约束', async () => {
    const tpl = WorldTemplateSchema.parse(readYaml(configPath('worlds/lunch_break.yaml')));
    const w = new WorldSimulator(tpl, new Rng(2), 'zh');
    await w.advance(31 * 60, { step: 0, stress: 0, screenOn: true });
    expect(w.hardStop()).toBeTruthy();
  });
});

describe('Evaluation / Calibration', () => {
  it('任务成功信号判定', () => {
    expect(taskCompleted([{ kind: 'url_matches', value: '^/orders' }, { kind: 'text_visible', value: '支付成功' }], [{ url: 'http://x/cart', text: '' }, { url: 'http://x/orders?paid=1', text: '支付成功，商家正在备餐' }])).toEqual({ done: true, at: 1 });
    expect(taskCompleted([], [{ url: 'http://x/', text: '' }]).done).toBe(false);
  });
  it('Wilson 区间与秩相关', () => {
    const [lo, hi] = wilson(6, 10); expect(lo).toBeGreaterThan(0.25); expect(hi).toBeLessThan(0.9);
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1); expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1);
  });
  it('可信度分级：无数据 unknown，样本少不会 high', () => {
    expect(trustLevel('issue_recall', null, [0, 1], 0)).toBe('unknown');
    expect(trustLevel('issue_recall', 0.9, wilson(9, 10), 10)).not.toBe('high');
    expect(trustLevel('issue_recall', 0.9, wilson(27, 30), 30)).toBe('high');
  });
});

describe('LLM gateway', () => {
  it('zod → Gemini JSON Schema 去掉不支持的关键字', () => {
    const js = toGeminiSchema(z.object({ a: z.string().regex(/x/), b: z.number().default(1), c: z.string().nullable() }));
    expect(JSON.stringify(js)).not.toMatch(/additionalProperties|\$schema|pattern|default/);
  });
});
