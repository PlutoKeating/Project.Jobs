// 阶段③「发布主线」：曝光与注意、看到的东西、虚拟身份、命令行输出
import { describe, expect, it } from 'vitest';
import { PersonaSpecSchema, Rng, StudyInputSchema, configPath, readYaml } from '@pux/core';
import { NOTICE, RATE_PER_HOUR, amountIn, usingNow, audienceMatch, exposureChance, normFor, notices, whatTheySee, type LaunchRow } from '@pux/engine';
import { funnelLine, reportText } from '../apps/cli/src/client.ts';

const linwei = PersonaSpecSchema.parse(readYaml(configPath('personas/hero/zh_linwei.yaml')));
const granny = PersonaSpecSchema.parse(readYaml(configPath('personas/hero/zh_wangguilan.yaml')));
const launch = { id: 'lch_1', name: '闪念笔记', tagline: '想到什么，马上记下', description: '极简笔记', ad_text: null, intensity: 0.5, audience: {} } as unknown as LaunchRow;
const base = { intensity: 0.5, affinity: 0.6, match: 1, minutes: 60, placeKind: 'home', exploration: 0.5, seenBefore: 0 };

describe('发布：谁会遇到它', () => {
  it('内部容器可以由发布创建', () => { expect(StudyInputSchema.parse({ app_version_id: 'av', trigger: 'launch' }).trigger).toBe('launch'); });
  it('投给谁：不是投放对象的人也可能看到，只是少得多', () => {
    expect(audienceMatch(linwei, {})).toBe(1); expect(audienceMatch(linwei, null)).toBe(1);
    expect(audienceMatch(granny, { age_max: 40 })).toBeLessThan(0.2); expect(audienceMatch(linwei, { age_max: 40, locales: ['zh-CN'] })).toBe(1);
    expect(audienceMatch(linwei, { locales: ['en-US'] })).toBeLessThan(0.2); expect(audienceMatch(granny, { segments: ['senior'] })).toBe(1);
  });
  it('宣发强度越高、手机越在手边，越容易刷到广告；强度为 0 时刷不到', () => {
    expect(exposureChance('ad', { ...base, intensity: 0 })).toBe(0);
    expect(exposureChance('ad', { ...base, intensity: 1 })).toBeGreaterThan(exposureChance('ad', base));
    expect(exposureChance('ad', { ...base, affinity: 0.1 })).toBeLessThan(exposureChance('ad', base));
    expect(exposureChance('ad', { ...base, match: 0.12 })).toBeLessThan(exposureChance('ad', base) / 3);
    expect(exposureChance('ad', { ...base, minutes: 600 })).toBeGreaterThan(exposureChance('ad', base));
  });
  it('看过几次还没点，再出现也越来越无感；广告牌只在路上和公共场所', () => {
    expect(exposureChance('ad', { ...base, seenBefore: 5 })).toBeLessThan(exposureChance('ad', base) / 2);
    expect(exposureChance('billboard', base)).toBe(0); expect(exposureChance('billboard', { ...base, placeKind: 'subway' })).toBeGreaterThan(0);
  });
  it('一个人一天不会被广告淹没：中等强度、普通用机时间下每天刷到几次', () => {
    const perHour = RATE_PER_HOUR.ad * 0.5 * 0.35;                    // 强度 0.5，平均手机在手边程度 0.35
    expect(perHour * 16).toBeGreaterThan(2); expect(perHour * 16).toBeLessThan(12);
  });
  it('出现在眼前不等于注意到：广告多数被忽略，熟人说的话几乎都会听到', () => {
    const rate = (ch: keyof typeof NOTICE) => { const r = new Rng(9); let n = 0; for (let i = 0; i < 2000; i++) if (notices(ch, r, { attention: 0.7 })) n++; return n / 2000; };
    expect(rate('ad')).toBeLessThan(0.3); expect(rate('billboard')).toBeLessThan(rate('ad')); expect(rate('store')).toBeGreaterThan(0.45); expect(rate('word_of_mouth')).toBeGreaterThan(0.85);
  });
  it('每个渠道有自己的常态：广告是硬塞的，商店是自己去逛的，熟人的话最当回事', () => {
    expect(normFor('ad', 'zh')).toContain('硬塞'); expect(normFor('billboard', 'zh')).toBe(normFor('ad', 'zh'));
    expect(normFor('store', 'zh')).toContain('自己打开来逛'); expect(normFor('store', 'en')).toMatch(/opened the app store yourself/);
    expect(normFor('word_of_mouth', 'zh')).toContain('熟人'); expect(new Set(['store', 'ad', 'feed', 'word_of_mouth', 'recall', 'invite'].map((c) => normFor(c as 'ad', 'zh'))).size).toBe(6);
  });
  it('他看到的就是那个渠道里的样子：商店卡片带评分和评论，熟人的话带名字和关系', () => {
    const store = whatTheySee(launch, 'store', 'zh', { rating: 4.2, reviews: [{ rating: 5, body: '挺顺手' }] });
    expect(store).toContain('闪念笔记'); expect(store).toContain('4.2'); expect(store).toContain('挺顺手');
    expect(whatTheySee(launch, 'store', 'zh')).toContain('还没有评分');
    expect(whatTheySee(launch, 'ad', 'en')).toMatch(/an ad slides in/);
    expect(whatTheySee(launch, 'word_of_mouth', 'zh', { from: { name: '陈秋月', kind: '同事', said: '别用，会丢字' } })).toMatch(/陈秋月（你的同事）.*别用，会丢字/);
    for (const ch of ['store', 'ad', 'billboard', 'feed', 'word_of_mouth', 'recall', 'invite'] as const) expect(whatTheySee(launch, ch, 'zh', { post: 'x', from: { name: 'a', kind: 'b', said: 'c' } })).not.toMatch(/测试|评估|体验官/);
  });
});

describe('虚拟身份', () => {
  it('从屏幕上的字里读出付款金额', () => {
    expect(amountIn('确认支付 ¥19.9')).toBe(19.9); expect(amountIn('Pay $4.99 now')).toBe(4.99); expect(amountIn('支付 28 元')).toBe(28); expect(amountIn('登录')).toBeUndefined();
  });
});

describe('命令行与 MCP 的输出', () => {
  const f = { reached: 159, noticed: 27, interested: 3, opened: 3, came_back: 0, using_now: 1, sessions: 3, reviews: 0, rating: null };
  const l = { id: 'lch_1', name: '闪念笔记', tagline: '想到什么，马上记下', url: 'http://x', intensity: 0.9, status: 'live', funnel: f, spend: { usd: 0.33, tokens: 1 } };
  it('漏斗一行说清：看到、注意到、有兴趣、打开过、回来再用', () => { expect(funnelLine(f)).toBe('看到 159 人 → 注意到 27 → 有兴趣 3 → 打开过 3 → 回来再用 0（此刻 1 人在用）'); });
  it('排队的人不算在用：单独给人数', () => {
    expect(funnelLine({ ...f, using_now: 0, queued: 2 })).toBe('看到 159 人 → 注意到 27 → 有兴趣 3 → 打开过 3 → 回来再用 0（此刻 0 人在用，2 人排队）');
    const now = new Date();
    expect(usingNow({ status: 'running', started_at: now })).toBe(true);
    expect(usingNow({ status: 'waiting_human', started_at: now })).toBe(true);
    expect(usingNow({ status: 'planned', started_at: null })).toBe(false);
    expect(usingNow({ status: 'running', started_at: new Date(Date.now() - 4 * 3600_000) })).toBe(false);
    expect(usingNow({ status: 'completed', started_at: now })).toBe(false);
  });
  it('一页结论：每条带当事人的原话；数字标明是模拟；问题清单与工程附录分开', () => {
    const m = { persona: '赵红梅', who: '56 岁女，退休干部', quote: '怎么全空了', session_id: 's', step_idx: 3 };
    const txt = reportText(l, { verdict: 'not_yet', headline: '写好的字全丢了', summary: '只有 3 个人用过。', hurts: [{ text: '写完返回，内容没了', moments: [m], passersby: [] }], delights: [], who_stays: [], who_leaves: [], why_not_opened: [{ text: '自带备忘录就够了', moments: [], passersby: [{ persona: '陈雨', who: '20 岁女，大学生', thought: '下这干嘛' }] }], next: '先让自动保存真的保存', funnel: f, people_used: 3 },
      { experienced: [{ id: 'i1', severity: 'P0', title: '返回后内容丢失', description: 'd', where: '/note/:id', people: 3, reproduced: true, steps: ['click "新建"', 'type "标题"'] }], appendix: [{ id: 'i2', severity: 'P1', category: 'a11y', title: '对比度不足', description: '', recommendation: '加深文字颜色', where: '/login' }] });
    expect(txt).toContain('写好的字全丢了  [多数人用不下去]'); expect(txt).toContain('模拟'); expect(txt).toContain('赵红梅（56 岁女，退休干部）：「怎么全空了」'); expect(txt).toContain('陈雨');
    expect(txt).toContain('如果只改一件事：先让自动保存真的保存'); expect(txt).not.toContain('让人高兴的地方');
    expect(txt.indexOf('虚拟人亲身遇到的问题')).toBeGreaterThan(0); expect(txt.indexOf('工程附录')).toBeGreaterThan(txt.indexOf('虚拟人亲身遇到的问题')); expect(txt).toContain('复现：click "新建" → type "标题"');
  });
});
