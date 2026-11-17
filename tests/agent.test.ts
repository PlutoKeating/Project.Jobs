// Jobs Agent（packages/agent）：用假的模型与内存存储跑完整的一轮又一轮
import { describe, expect, it } from 'vitest';
import { z } from '../packages/core/src/index.ts';
import { AgentHub, type AgentOut, type HubDeps } from '../packages/agent/src/hub.ts';
import { MemoryStore, compactForStorage } from '../packages/agent/src/store.ts';
import { toConv, type Converse } from '../packages/agent/src/stream.ts';
import { paramsOf } from '../packages/agent/src/tools.ts';
import type { JobsTool, ToolApi } from '../packages/engine/src/launch/tools.ts';
import type { ConvMsg, ConvRes } from '../packages/llm/src/converse.ts';

const res = (text: string, calls: { name: string; args?: object }[] = []): ConvRes => ({ text, tool_calls: calls.map((c, i) => ({ id: `c${i}_${Math.random().toString(36).slice(2, 6)}`, name: c.name, arguments: JSON.stringify(c.args ?? {}) })), finish: calls.length ? 'tool_calls' : 'stop', usage: { prompt: 10, completion: 5, reasoning: 0 } });

/** 按顺序回答的假模型：每一项可以是固定结果，也可以根据收到的消息决定 */
function fakeModel(script: (ConvRes | ((msgs: ConvMsg[]) => ConvRes | Promise<ConvRes>))[]) {
  const seen: { messages: ConvMsg[]; tools: string[] }[] = [];
  const converse: Converse = async (o) => {
    seen.push({ messages: o.messages, tools: o.tools.map((t) => t.name) });
    const step = script.shift(); if (!step) throw new Error('script exhausted');
    const r = typeof step === 'function' ? await step(o.messages) : step;
    for (const ch of r.text) o.onEvent({ type: 'text', delta: ch });
    return { ...r, cost_usd: 0.001 };
  };
  return { converse, seen };
}

const calls: { path: string; body?: unknown; role: string }[] = [];
const people = [{ id: 'p1', name: '赵红梅', age: 67, occupation: '退休教师', segment: 'senior', locale: 'zh-CN', digital_literacy: 0.2, ai_familiarity: 0.1, sessions: 1, apps: [], live: null }];
const apiFor = (role: 'admin' | 'viewer'): ToolApi => (async (path: string, o: { body?: unknown; method?: string } = {}) => {
  calls.push({ path, body: o.body, role });
  if (path === '/launches') return [{ id: 'l1', name: 'Quick Notes', status: 'live', funnel: { opened: 3, using_now: 1 } }];
  if (path === '/personas') return people;
  return { ok: true, path };
}) as ToolApi;

const tool = (name: string, admin: boolean, extra: Partial<JobsTool> = {}): JobsTool => ({ name, admin, label: `做 ${name}`, description: name, input: { product: z.string().optional() }, run: async (a, { api }) => { await api(`/${name}`, { body: a }); return `${name} 完成`; }, ...extra });
let waitRuns = 0;
const TOOLS: JobsTool[] = [
  tool('peek', false), tool('poke', true),
  tool('reset_product', true, { danger: true, run: async (a, { api }) => { await api(`/launches/${a.product}/reset`, { body: {} }); return '已清零'; } }),
  tool('wait_for_people', false, { run: async () => { waitRuns++; return '3 次使用都结束了。'; } }),
];

function setup(script: Parameters<typeof fakeModel>[0], over: Partial<HubDeps> = {}) {
  const m = fakeModel(script); const store = new MemoryStore(); const outs: AgentOut[] = [];
  const hub = new AgentHub({ store, apiFor, base: async () => 'https://jobs.example', converse: m.converse, tools: TOOLS, chatResident: async (_p, msg) => ({ reply: `（赵红梅）你说「${msg}」？我不太懂。`, name: '赵红梅' }), ...over });
  const out = (e: AgentOut) => outs.push(e);
  const admin = { id: 'u1', name: '小王', role: 'admin' as const }; const viewer = { id: 'u2', name: '小李', role: 'viewer' as const };
  return { hub, store, outs, out, m, admin, viewer };
}
const ended = (outs: AgentOut[]) => outs.filter((e) => e.type === 'end') as Extract<AgentOut, { type: 'end' }>[];

describe('一轮对话', () => {
  it('纯文字：流式交出文字，结束时存下对话', async () => {
    const t = setup([res('你好，我是 Jobs。')]);
    expect(await t.hub.send({ session: 's1', channel: 'web', actor: t.admin, input: { text: '你好' }, out: t.out })).toBe('run');
    expect(t.outs[0]).toEqual({ type: 'start' });
    expect(t.outs.filter((e) => e.type === 'text').map((e) => (e as { delta: string }).delta).join('')).toBe('你好，我是 Jobs。');
    expect(ended(t.outs)[0]).toMatchObject({ text: '你好，我是 Jobs。' });
    const row = await t.store.load('s1');
    expect(row?.messages.map((m) => (m as { role: string }).role)).toEqual(['user', 'assistant']);
    expect(row?.title).toBe('你好');
    expect(row?.cost_usd).toBeGreaterThan(0);
    expect(t.m.seen[0].messages[0].role).toBe('system');
    expect(t.m.seen[0].messages[0].content).toContain('Quick Notes（id=l1');
  });

  it('工具调用：用说话人的身份调 REST，结果回给模型，界面上有一步', async () => {
    calls.length = 0;
    const t = setup([res('我看一下。', [{ name: 'peek', args: { product: 'l1' } }]), (msgs) => { expect(msgs.at(-1)).toMatchObject({ role: 'tool', content: [{ type: 'text', text: 'peek 完成' }] }); return res('看完了：一切正常。'); }]);
    await t.hub.send({ session: 's2', channel: 'feishu', actor: t.viewer, input: { text: '看看 Quick Notes' }, out: t.out });
    expect(calls.find((c) => c.path === '/peek')).toMatchObject({ role: 'viewer', body: { product: 'l1' } });
    expect(t.outs.filter((e) => e.type === 'step')).toEqual([expect.objectContaining({ tool: 'peek', label: '做 peek', status: 'running' }), expect.objectContaining({ tool: 'peek', status: 'done' })]);
    expect(ended(t.outs)[0].text).toBe('我看一下。\n\n看完了：一切正常。');
    // 访客看不到管理员工具
    expect(t.m.seen[0].tools).toContain('peek'); expect(t.m.seen[0].tools).not.toContain('poke'); expect(t.m.seen[0].tools).toContain('talk_to_resident');
  });

  it('模型出错：结束时带上原因', async () => {
    const t = setup([() => { throw new Error('没有可用于「对话」的模型'); }]);
    await t.hub.send({ session: 's3', channel: 'web', actor: t.admin, input: { text: 'hi' }, out: t.out });
    expect(ended(t.outs)[0].error).toContain('没有可用于「对话」的模型');
  });
});

describe('确认', () => {
  it('清零先发确认卡片、不执行；点确认后执行一次，再点无效；访客不能确认', async () => {
    calls.length = 0;
    const t = setup([res('', [{ name: 'reset_product', args: { product: 'l1' } }]), res('请在卡片上点确认。')]);
    await t.hub.send({ session: 's4', channel: 'feishu', actor: t.admin, input: { text: '把 Quick Notes 清零' }, out: t.out });
    const c = t.outs.find((e) => e.type === 'confirm') as Extract<AgentOut, { type: 'confirm' }>;
    expect(c).toMatchObject({ tool: 'reset_product', label: '做 reset_product' }); expect(c.text).toContain('清零「l1」');
    expect(calls.some((x) => x.path.endsWith('/reset'))).toBe(false);
    expect((await t.hub.decide(c.action_id, true, t.viewer)).text).toContain('只有管理员');
    const r = await t.hub.decide(c.action_id, true, t.admin);
    expect(r).toMatchObject({ ok: true, status: 'done', text: '已清零' });
    expect(calls.filter((x) => x.path === '/launches/l1/reset')).toHaveLength(1);
    expect((await t.hub.decide(c.action_id, true, t.admin)).ok).toBe(false);
    const row = await t.store.load('s4');
    expect(JSON.stringify(row?.messages)).toContain('在卡片上确认了');
  });
  it('过期的确认不执行', async () => {
    let now = new Date('2026-11-17T12:00:00Z');
    const t = setup([res('', [{ name: 'reset_product', args: { product: 'l1' } }]), res('好')], { now: () => now });
    await t.hub.send({ session: 's5', channel: 'web', actor: t.admin, input: { text: '清零' }, out: t.out });
    const c = t.outs.find((e) => e.type === 'confirm') as Extract<AgentOut, { type: 'confirm' }>;
    now = new Date('2026-11-17T12:31:00Z');
    expect(await t.hub.decide(c.action_id, true, t.admin)).toMatchObject({ ok: false, status: 'expired' });
  });
});

describe('插话、排队、停止', () => {
  it('同一角色干活时又说话：插进这一轮，模型下一次请求里能看到', async () => {
    let release!: () => void; const gate = new Promise<void>((r) => { release = r; });
    const t = setup([async () => { await gate; return res('', [{ name: 'peek' }]); }, (msgs) => { expect(JSON.stringify(msgs)).toContain('只看最近一天'); return res('好，只看最近一天。'); }]);
    const first = t.hub.send({ session: 's6', channel: 'web', actor: t.admin, input: { text: '看看数据' }, out: t.out });
    await new Promise((r) => setTimeout(r, 20));
    expect(await t.hub.send({ session: 's6', channel: 'web', actor: t.admin, input: { text: '只看最近一天' }, out: t.out })).toBe('steered');
    release(); await first;
    expect(ended(t.outs)[0].text).toContain('只看最近一天');
  });
  it('角色不同：排队，前一轮跑完再处理', async () => {
    let release!: () => void; const gate = new Promise<void>((r) => { release = r; });
    const t = setup([async () => { await gate; return res('第一件做完了。'); }, res('第二件。')]);
    const first = t.hub.send({ session: 's7', channel: 'feishu', actor: t.admin, input: { text: '一' }, out: t.out });
    await new Promise((r) => setTimeout(r, 20));
    expect(await t.hub.send({ session: 's7', channel: 'feishu', actor: t.viewer, input: { text: '二' }, out: t.out })).toBe('queued');
    release(); await first; await new Promise((r) => setTimeout(r, 50));
    expect(ended(t.outs).map((e) => e.text)).toEqual(['第一件做完了。', '第二件。']);
    expect(t.m.seen[1].tools).not.toContain('poke');
  });
  it('/stop 停下正在跑的一轮；/new 清空对话', async () => {
    const t = setup([(msgs) => new Promise((_r, rej) => { void msgs; setTimeout(() => rej(new Error('aborted')), 2000); })]);
    const first = t.hub.send({ session: 's8', channel: 'web', actor: t.admin, input: { text: '慢慢想' }, out: t.out });
    await new Promise((r) => setTimeout(r, 20));
    await t.hub.send({ session: 's8', channel: 'web', actor: t.admin, input: { text: '/stop' }, out: t.out });
    await first;
    expect(ended(t.outs)[0].text).toBe('已停止。');
    expect(t.hub.busy('s8')).toBe(false);
    await t.hub.send({ session: 's8', channel: 'web', actor: t.admin, input: { text: '/new' }, out: t.out });
    expect((await t.store.load('s8'))?.messages).toEqual([]);
  });
});

describe('跟居民聊', () => {
  it('进入后用户的话直接交给居民；「结束」回到 Jobs，聊过的内容记进对话', async () => {
    const t = setup([res('', [{ name: 'talk_to_resident', args: { person: '赵红梅' } }]), res('现在可以直接跟赵红梅说话了。')]);
    await t.hub.send({ session: 's9', channel: 'feishu', actor: t.admin, input: { text: '让我跟赵红梅聊聊' }, out: t.out });
    expect(t.outs.find((e) => e.type === 'mode')).toEqual({ type: 'mode', resident: { persona_id: 'p1', name: '赵红梅' } });
    expect(await t.hub.send({ session: 's9', channel: 'feishu', actor: t.admin, input: { text: '你为什么关掉了？' }, out: t.out })).toBe('resident');
    expect(t.outs.find((e) => e.type === 'resident')).toMatchObject({ name: '赵红梅', text: expect.stringContaining('你为什么关掉了') });
    await t.hub.send({ session: 's9', channel: 'feishu', actor: t.admin, input: { text: '结束' }, out: t.out });
    const row = await t.store.load('s9');
    expect(row?.mode).toBeNull();
    expect(JSON.stringify(row?.messages)).toContain('跟赵红梅聊了');
    expect(t.m.seen).toHaveLength(2);
  });
});

describe('后台等人用完', () => {
  it('wait_for_people 立刻返回；等到了用主动消息出口另起一轮', async () => {
    waitRuns = 0; const later: AgentOut[] = [];
    const t = setup([res('', [{ name: 'wait_for_people' }]), res('我在后台等着，用完告诉你。'), (msgs) => { expect(JSON.stringify(msgs.at(-1))).toContain('都结束了'); return res('3 个人都用完了，要看结论吗？'); }],
      { proactive: () => ({ out: (e) => later.push(e), channel: 'feishu', actor: { id: 'u1', role: 'admin' } }) });
    await t.hub.send({ session: 's10', channel: 'feishu', actor: t.admin, input: { text: '等他们用完' }, out: t.out });
    expect(ended(t.outs)[0].text).toContain('后台等着');
    for (let i = 0; i < 50 && !later.some((e) => e.type === 'end'); i++) await new Promise((r) => setTimeout(r, 10));
    expect(waitRuns).toBe(1);
    expect(ended(later)[0].text).toBe('3 个人都用完了，要看结论吗？');
  });
});

describe('压缩与存储', () => {
  it('对话太长：旧的压缩成摘要，从一句用户的话开始保留，摘要进系统提示', async () => {
    const big = 'x'.repeat(400);
    const t = setup([res('a'), res('b'), res('c'), res('d'), (msgs) => { expect(String(msgs[0].content)).toContain('之前对话的摘要'); return res('e'); }], { compactAt: 2000, compact: async (old) => `摘要（${old.length} 字）` });
    for (const q of ['一', '二', '三', '四', '五']) await t.hub.send({ session: 's11', channel: 'web', actor: t.admin, input: { text: q + big }, out: t.out });
    const row = await t.store.load('s11');
    expect(row?.summary).toMatch(/^摘要/);
    expect((row!.messages[0] as { role: string }).role).toBe('user');
    expect(row!.messages.length).toBeLessThan(10);
  });
  it('存之前：只保留最近两张图，旧的长工具结果截短，系统消息不存', () => {
    const img = (n: number) => ({ role: 'user', content: [{ type: 'text', text: `图${n}` }, { type: 'image', data: 'AAA', mimeType: 'image/png' }], timestamp: n });
    const out = compactForStorage([{ role: 'system', content: 's', timestamp: 0 }, img(1), img(2), img(3)] as never);
    expect(out).toHaveLength(3);
    expect(JSON.stringify(out[0])).toContain('[图片]'); expect(JSON.stringify(out[2])).toContain('AAA');
  });
  it('toConv：被停掉的工具调用补上结果；出错的助手消息只留文字', () => {
    const conv = toConv([
      { role: 'user', content: 'hi', timestamp: 1 },
      { role: 'assistant', content: [{ type: 'toolCall', id: 't1', name: 'peek', arguments: {} }], api: 'jobs', provider: 'jobs', model: 'm', usage: {} as never, stopReason: 'toolUse', timestamp: 2 },
      { role: 'assistant', content: [{ type: 'text', text: '说到一半' }], api: 'jobs', provider: 'jobs', model: 'm', usage: {} as never, stopReason: 'aborted', timestamp: 3 },
    ] as never);
    expect(conv.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
    expect(conv[2]).toMatchObject({ tool_call_id: 't1', is_error: true });
  });
  it('参数的 JSON Schema 是对象，没有各家不认的字段', () => {
    const p = paramsOf({ a: z.string(), b: z.number().min(0).max(1).optional() });
    expect(p).toMatchObject({ type: 'object', properties: { a: { type: 'string' }, b: { type: 'number', minimum: 0, maximum: 1 } }, required: ['a'] });
    expect(JSON.stringify(p)).not.toContain('$schema');
  });
});
