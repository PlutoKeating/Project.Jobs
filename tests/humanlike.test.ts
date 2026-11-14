// 阶段①「像人」：只凭屏幕画面、注意力与阅读预算、禁止技术自救、人类化的手、问题分两路
import { describe, expect, it } from 'vitest';
import { PERSONA_VERBS, PersonaSpecSchema, StudyInputSchema, Rng, configPath, deviceFor, readYaml, type UIElement } from '@pux/core';
import { elementAt, landingPoint, matchVisibleText, mousePath, typingPlan, wheelPlan, swipePath, dialogLayout } from '@pux/executor';
import { HUMAN_KEYS, MindSchema, mindSystemPrompt, normalizeKey, planPerception, readingBudget, trackOf, motorProfile, type MindInput } from '@pux/engine';

const linwei = PersonaSpecSchema.parse(readYaml(configPath('personas/hero/zh_linwei.yaml')));
const granny = PersonaSpecSchema.parse(readYaml(configPath('personas/hero/zh_wangguilan.yaml')));
const child = PersonaSpecSchema.parse(readYaml(configPath('personas/child/zh_child_doudou.yaml')));
const el = (o: Partial<UIElement> & { bbox: [number, number, number, number] }): UIElement => ({ ref: 'e', role: 'button', name: '', tag: 'button', in_viewport: true, occluded: false, selector: `xpath=/${Math.random()}`, kind: 'interactive', ...o });
const mindIn = (over: Partial<MindInput> = {}): MindInput => ({ persona: linwei, lang: 'zh', device: 'phone', situation: '', worldNow: '', lifeGoal: '', modeHint: '', feelings: '', memories: [], priorKnowledge: 'stranger', appName: '某应用', history: [], events: [], pageUrlHint: '', step: 0, maxSteps: 10, ...over });

describe('只凭屏幕画面', () => {
  it('想法的输入里没有任何页面结构字段，输出是手上的动作与对目标的描述', () => {
    const keys = Object.keys(mindIn());
    for (const banned of ['screen', 'elements', 'dom', 'a11y', 'html']) expect(keys).not.toContain(banned);
    const out = Object.keys(MindSchema.shape);
    expect(out).toEqual(expect.arrayContaining(['action', 'target_text', 'target_look', 'input_text']));
    expect(out).not.toContain('ref');
  });
  it('人物不会自己改网址；执行器只有 Midscene（旧数据里的 stagehand 按 midscene 读取）', () => {
    expect(PERSONA_VERBS).not.toContain('navigate');
    expect(StudyInputSchema.parse({ app_version_id: 'av', executor: 'stagehand' }).executor).toBe('midscene');
    expect(StudyInputSchema.parse({ app_version_id: 'av' }).executor).toBe('midscene');
  });
  it('借 DOM 换算落点：照抄的字必须恰好对应唯一一个看得见、没被挡住的可交互元素', () => {
    const els = [el({ vis_text: '登录', bbox: [10, 10, 80, 30] }), el({ vis_text: '注册', bbox: [100, 10, 80, 30] }), el({ vis_text: '删除', bbox: [10, 60, 40, 20] }), el({ vis_text: '删除', bbox: [10, 90, 40, 20] }),
      el({ vis_text: '隐藏按钮', bbox: [10, 900, 40, 20], in_viewport: false }), el({ vis_text: '被挡住', bbox: [10, 120, 40, 20], occluded: true }), el({ name: '只有 aria 的图标', bbox: [200, 10, 20, 20] }), el({ vis_text: '正文里的登录说明文字', kind: 'text', bbox: [10, 200, 300, 20] })];
    expect(matchVisibleText(els, '登录')?.bbox).toEqual([10, 10, 80, 30]);
    expect(matchVisibleText(els, ' 注册 ')).toBeDefined();
    expect(matchVisibleText(els, '删除')).toBeUndefined();          // 有两个：交给看截图定位
    expect(matchVisibleText(els, '隐藏按钮')).toBeUndefined();      // 屏幕外
    expect(matchVisibleText(els, '被挡住')).toBeUndefined();
    expect(matchVisibleText(els, '只有 aria 的图标')).toBeUndefined();   // aria-label 肉眼看不到，不参与匹配
    expect(matchVisibleText(els, '')).toBeUndefined();
    expect(elementAt(els, 20, 20)?.vis_text).toBe('登录');
    expect(elementAt(els, 600, 600)).toBeUndefined();
  });
  it('原生弹窗的按钮画在屏幕内', () => {
    const l = dialogLayout(390, 844, true);
    expect(l.cancel).toBeDefined(); expect(l.ok[0] + l.ok[2]).toBeLessThanOrEqual(390); expect(l.cancel![0]).toBeGreaterThanOrEqual(0); expect(dialogLayout(1280, 800, false).cancel).toBeUndefined();
  });
  it('设备跟着处境走：办公桌前用电脑，路上、沙发上、单手时用手机', () => {
    const w = (place: string, cls: string, motion: 'still' | 'walking' | 'vehicle' = 'still', hands: 'both' | 'one' = 'both') => ({ scenario_class: cls, init: { place, motion, channels: { hands, eyes: 'full' as const, ears: 'free' as const, mouth: 'free' as const } } });
    expect(deviceFor(w('公司工位', 'office'))).toBe('computer');
    expect(deviceFor(w('地铁车厢里站着', 'commute', 'vehicle', 'one'))).toBe('phone');
    expect(deviceFor(w('家里沙发', 'idle_leisure'))).toBe('phone');
    expect(deviceFor(w('公司工位', 'office', 'still', 'one'))).toBe('phone');
    expect(deviceFor({ ...w('家里沙发', 'idle_leisure'), device: 'computer' })).toBe('computer');
  });
});

describe('注意力与阅读预算', () => {
  const page = [
    el({ kind: 'heading', role: 'heading', vis_text: '欢迎使用', font_px: 28, bbox: [20, 20, 300, 40] }),
    el({ vis_text: '立即开始', font_px: 16, bbox: [20, 80, 120, 40] }),
    ...Array.from({ length: 12 }, (_, i) => el({ kind: 'text', role: 'p', vis_text: '这是一段很长很长的说明文字。'.repeat(12), font_px: 14, text_len: 168, bbox: [20, 140 + i * 50, 340, 44] })),
    el({ kind: 'text', role: 'p', vis_text: '自动续费，可随时取消，详见服务条款', font_px: 11, contrast: 2.4, bbox: [20, 760, 300, 14] }),
  ];
  const base = { elements: page, eyes: 'full' as const, attention: 0.7, viewport: { w: 390, h: 844 } };
  it('扫读的人这一眼读得少，认真读的人读得多；瞥一眼更少', () => {
    const scan = { ...linwei, behavior_policy: { ...linwei.behavior_policy, reading: 'scan' as const } };
    const read = { ...linwei, behavior_policy: { ...linwei.behavior_policy, reading: 'read' as const } };
    expect(readingBudget(scan, base)).toBeLessThan(readingBudget(read, base));
    expect(readingBudget(read, { ...base, eyes: 'glance' })).toBeLessThan(readingBudget(read, base));
    const a = planPerception({ ...base, persona: scan }); const b = planPerception({ ...base, persona: read });
    expect(a.hidden).toBeGreaterThan(b.hidden);
    expect(a.read_chars).toBeLessThan(b.read_chars);
    // 标题和主按钮永远先被看到
    for (const r of a.blur) expect(r.rect.y).toBeGreaterThan(100);
  });
  it('视力差的人看不清小字和低对比度的字；凑近看之后看得清', () => {
    const fine = { x: 20, y: 760, w: 300, h: 14 };
    const p1 = planPerception({ ...base, persona: granny });
    expect(p1.blur.some((b) => b.why === 'too_small' && b.rect.y === 760)).toBe(true);
    const p2 = planPerception({ ...base, persona: granny, focus: fine });
    expect(p2.blur.some((b) => b.rect.y === 760)).toBe(false);
    expect(planPerception({ ...base, persona: linwei }).blur.some((b) => b.why === 'too_small')).toBe(false);
  });
  it('识字量不够的孩子读不懂超纲的字', () => {
    const p = planPerception({ ...base, elements: [el({ kind: 'text', role: 'p', vis_text: '请阅读并同意隐私政策与用户协议条款', font_px: 16, bbox: [20, 20, 300, 20] })], persona: child });
    expect(p.unreadable).toBe(1); expect(p.blur[0].why).toBe('cannot_read');
  });
});

describe('禁止技术自救', () => {
  it('规则写进人物的系统提示词，手机与电脑的手上动作不同', () => {
    const zh = mindSystemPrompt(mindIn()); const en = mindSystemPrompt(mindIn({ lang: 'en', device: 'computer' }));
    expect(zh).toMatch(/不会改网址/); expect(zh).toMatch(/开发者工具/); expect(zh).toMatch(/凑近看/); expect(zh).toMatch(/触屏/);
    expect(en).toMatch(/never edit the address/); expect(en).toMatch(/hover/); expect(zh).not.toMatch(/hover：/);
    for (const s of [zh, en]) expect(s).not.toMatch(/DOM|a11y|selector|xpath|元素列表|ref\b/i);
  });
  it('只能按普通人会用的那几个键', () => {
    expect(normalizeKey('回车')).toBe('Enter'); expect(normalizeKey('esc')).toBe('Escape'); expect(normalizeKey('F12')).toBeUndefined(); expect(normalizeKey('Control+Shift+I')).toBeUndefined();
    expect(HUMAN_KEYS).not.toContain('F12');
  });
});

describe('人类化的手', () => {
  it('鼠标轨迹是曲线并且落在目标上', () => {
    const p = mousePath({ x: 100, y: 100 }, { x: 900, y: 500 }, { rng: new Rng(3), precision: 0.7 });
    expect(p.length).toBeGreaterThan(8); expect(p[p.length - 1].x).toBeCloseTo(900, 5); expect(p[p.length - 1].y).toBeCloseTo(500, 5);
    const mid = p[Math.floor(p.length / 2)]; const onLine = 100 + ((mid.x - 100) / 800) * 400;
    expect(Math.abs(mid.y - onLine)).toBeGreaterThan(1);
    expect(mousePath({ x: 5, y: 5 }, { x: 5, y: 6 }, { rng: new Rng(1) })).toHaveLength(1);
  });
  it('打字会按到邻键再回删，最终上屏的内容与想输入的一致', () => {
    const motor = { ...motorProfile(granny), typo_rate: 0.3 };
    const plan = typingPlan('hello world 你好', motor, new Rng(11));
    expect(plan.some((k) => k.kind === 'backspace')).toBe(true);
    const out: string[] = []; for (const k of plan) { if (k.kind === 'backspace') out.pop(); else out.push(k.ch); }
    expect(out.join('')).toBe('hello world 你好');
    expect(typingPlan('abc', { ...motor, typo_rate: 0 }, new Rng(1))).toHaveLength(3);
  });
  it('点偏过的人下一次瞄得更准；触屏有手指容差', () => {
    const motor = { precision: 0.45, typing_cps: 3, typo_rate: 0.05, one_handed: true, double_tap_risk: 0 };
    const box = { x: 100, y: 100, w: 70, h: 18 }; const c = { x: 135, y: 109 };
    const rate = (opts: { attempt?: number; touch?: boolean }) => { const r = new Rng(5); let m = 0; for (let i = 0; i < 400; i++) if (landingPoint(c, box, motor, r, opts).miss) m++; return m / 400; };
    expect(rate({ attempt: 1 })).toBeLessThan(rate({ attempt: 0 }));
    expect(rate({ attempt: 2 })).toBeLessThan(0.15);
    expect(rate({ touch: true })).toBeLessThan(rate({ touch: false }));
    expect(landingPoint(c, undefined, motor, new Rng(1)).miss).toBe(false);
  });
  it('滚轮分成几格，触屏滑动是一条带减速的轨迹', () => {
    const w = wheelPlan(600, new Rng(2)); expect(w.length).toBeGreaterThanOrEqual(2); expect(Math.abs(w.reduce((a, t) => a + t.dy, 0) - 600)).toBeLessThan(120);
    const s = swipePath({ x: 200, y: 600 }, -400, new Rng(2)); expect(s[s.length - 1].y).toBeCloseTo(200, 0); expect(Math.abs(s[1].y - s[0].y)).toBeGreaterThan(Math.abs(s[s.length - 1].y - s[s.length - 2].y));
  });
});

describe('问题分两路', () => {
  it('虚拟人亲历的进体验问题；用户看不到的技术信号与专家检查进工程附录', () => {
    for (const s of ['expectation_violation', 'abandon', 'stall', 'repeat']) expect(trackOf(s)).toBe('experience');
    for (const s of ['axe', 'judge', 'ai_quality', 'policy']) expect(trackOf(s)).toBe('engineering');
    expect(trackOf('uap_error', 'PRODUCT_HTTP_5XX')).toBe('engineering');
    expect(trackOf('uap_error', 'PRODUCT_JS_ERROR')).toBe('engineering');
    expect(trackOf('uap_error', 'PRODUCT_SMALL_TARGET')).toBe('experience');
  });
});
