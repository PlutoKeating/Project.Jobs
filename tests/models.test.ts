// 阶段④「模型接入」：配置的数据规则、候选与跳过原因、错误归类、凭证加密、目录收敛，以及用本地假上游做的故障模拟
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  LlmError, _setMasterKey, _setSnapshot, candidates, classifyError, defaultUses, diffConfig, gateway, health, hintOf, locateFamily, normalizeCatalog, normalizeConfig, open, proxyChat, reaction, seal, solidPng, useOfRole,
  type LlmConfig, type ModelEntry, type ProviderConn,
} from '@pux/llm';

const model = (id: string, over: Partial<ModelEntry> = {}): ModelEntry => ({ id, model: id, kind: 'chat', uses: ['step', 'think'], caps: { vision: true, json: true }, cost: { input: 1, output: 2 }, ...over });
const prov = (id: string, models: ModelEntry[], over: Partial<ProviderConn> = {}): ProviderConn => ({ id, name: id.toUpperCase(), protocol: 'openai', base_url: 'https://example.com/v1', enabled: true, credentials: [{ id: `${id}_k1`, label: '', enabled: true, hint: '…0001', secret_id: `${id}_s1` }], models, ...over });
const ids = (c: LlmConfig, use: Parameters<typeof candidates>[1], needs = {}, h = new Map()) => candidates(c, use, needs, h).eligible.map((t) => t.model.id);

describe('模型配置：数据规则', () => {
  it('顺序只有一套：漏掉的目标补到末尾，不存在的去掉；跨供应商可以交错', () => {
    const c = normalizeConfig({ providers: [prov('a', [model('a1'), model('a2')]), prov('b', [model('b1')])], order: ['a1', 'ghost', 'b1'] });
    expect(c.order).toEqual(['a1', 'b1', 'a2']); expect(ids(c, 'think')).toEqual(['a1', 'b1', 'a2']);
  });
  it('身份重复、地址不合法、协议不支持都会被拒绝', () => {
    expect(() => normalizeConfig({ providers: [prov('a', [model('x')]), prov('b', [model('x')])], order: [] })).toThrow(/重复/);
    expect(() => normalizeConfig({ providers: [prov('a', [model('x')], { base_url: 'ftp://x' })], order: [] })).toThrow(/http/);
    expect(() => normalizeConfig({ providers: [prov('a', [model('x')], { protocol: 'grpc' as never })], order: [] })).toThrow(/协议/);
  });
  it('用途跟着模型类型走：向量模型只能做向量，对话模型不能做向量', () => {
    const c = normalizeConfig({ providers: [prov('a', [model('e', { kind: 'embed', uses: ['embed', 'think'] }), model('c', { uses: ['think', 'embed'] })])], order: [] });
    expect(c.providers[0].models.map((m) => m.uses)).toEqual([['embed'], ['think']]);
  });
  it('勾选模型时的默认用途：能看图的做每一步，认得出定位家族的才做定位', () => {
    expect(defaultUses('chat', 'gemini-4-hydrogen', { vision: true, json: true })).toEqual(['step', 'think', 'locate']);
    expect(defaultUses('chat', 'claude-sonnet-5', { vision: true, json: true })).toEqual(['step', 'think']);
    expect(defaultUses('chat', 'deepseek-chat', { vision: false, json: true })).toEqual(['think']);
    expect(defaultUses('embed', 'text-embedding-3-small', { vision: false, json: false })).toEqual(['embed']);
    expect(locateFamily('qwen3-vl-plus')).toBe('qwen3-vl'); expect(locateFamily('gpt-5-mini')).toBe('gpt-5'); expect(locateFamily('doubao-seed-1-6-vision')).toBe('doubao-seed'); expect(locateFamily('gemini-embedding-2')).toBeUndefined();
  });
  it('角色只是调用点的名字，背后是模型组', () => { expect(useOfRole('mind_fast')).toBe('step'); expect(useOfRole('judge_meta')).toBe('think'); expect(useOfRole('operator_locate')).toBe('locate'); expect(useOfRole('whatever')).toBe('think'); });
});

describe('候选与跳过原因', () => {
  const cfg = normalizeConfig({ providers: [
    prov('a', [model('a_text', { caps: { vision: false, json: true }, uses: ['think'] }), model('a_vis')]),
    prov('b', [model('b_vis')], { enabled: false }),
    prov('c', [model('c_vis')], { credentials: [{ id: 'c_k1', label: '', enabled: false, hint: '', secret_id: 'c_s1' }] }),
    prov('d', [model('d_vis', { uses: ['think'] })]),
  ], order: ['a_text', 'b_vis', 'c_vis', 'a_vis', 'd_vis'] });
  const why = (use: Parameters<typeof candidates>[1], needs = {}, h = new Map()) => Object.fromEntries(candidates(cfg, use, needs, h).skipped.map((s) => [s.target.model.id, s.reason]));
  it('带图片的请求只进入能看图的目标；停用的连接、没有启用凭证的连接被跳过并说明原因', () => {
    expect(ids(cfg, 'think', { vision: true })).toEqual(['a_vis', 'd_vis']);
    expect(why('think', { vision: true })).toEqual({ a_text: 'no_vision', b_vis: 'provider_off', c_vis: 'no_credential' });
    expect(ids(cfg, 'think')).toEqual(['a_text', 'a_vis', 'd_vis']);
  });
  it('没勾选这个用途的目标不参与；每一步一律要求能看图', () => { expect(ids(cfg, 'step')).toEqual(['a_vis']); expect(why('step').d_vis).toBe('not_in_group'); });
  it('暂时不可用的目标保留位置：恢复后回到原来的名次', () => {
    const h = new Map([['t:a_vis', { until: Date.now() + 60_000, reason: 'transient' as const }]]);
    expect(ids(cfg, 'think', { vision: true }, h)).toEqual(['d_vis']); expect(why('think', { vision: true }, h).a_vis).toBe('cooling');
    expect(candidates(cfg, 'think', { vision: true }, h, Date.now() + 120_000).eligible.map((t) => t.model.id)).toEqual(['a_vis', 'd_vis']);
  });
  it('凭证全在冷却时，这个连接下的目标暂时不可用（管理员的启停意图不变）', () => {
    const h = new Map([['c:a_k1', { until: Date.now() + 60_000, reason: 'rate_limit' as const }]]);
    expect(ids(cfg, 'think', {}, h)).toEqual(['d_vis']); expect(cfg.providers[0].credentials[0].enabled).toBe(true);
  });
  it('定位只转发给同一家族的目标', () => {
    const c = normalizeConfig({ providers: [prov('a', [model('gemini-4-hydrogen', { uses: ['locate'] }), model('qwen3-vl-plus', { uses: ['locate'] })])], order: [] });
    expect(ids(c, 'locate', { family: 'gemini' })).toEqual(['gemini-4-hydrogen']); expect(ids(c, 'locate', { family: 'qwen3-vl' })).toEqual(['qwen3-vl-plus']);
  });
  it('发布前能看到差异：加了谁、删了谁、顺序变没变、各用途此刻有几个可用目标', () => {
    const a = normalizeConfig({ providers: [prov('a', [model('a1')])], order: [] });
    const b = normalizeConfig({ providers: [prov('a', [model('a1'), model('a2')]), prov('b', [model('b1', { kind: 'embed', uses: ['embed'] })])], order: ['a2', 'a1'] });
    const d = diffConfig(a, b);
    expect(d.providers_added).toEqual(['B']); expect(d.models_added).toHaveLength(2); expect(d.effective.think).toEqual({ before: 1, after: 2 }); expect(d.effective.embed).toEqual({ before: 0, after: 1 });
    expect(diffConfig(b, a).models_removed).toHaveLength(2);
  });
});

describe('错误归类与处理方向', () => {
  it('按状态码与上游的话归类', () => {
    expect(classifyError(401, 'Invalid API key')).toBe('auth'); expect(classifyError(403, 'permission denied')).toBe('auth');
    expect(classifyError(429, 'Too Many Requests')).toBe('rate_limit'); expect(classifyError(400, 'Insufficient balance')).toBe('rate_limit');
    expect(classifyError(404, 'The model `x` does not exist')).toBe('not_found');
    expect(classifyError(400, "This model's maximum context length is 8192 tokens")).toBe('context');
    expect(classifyError(400, 'image input is not supported by this model')).toBe('capability');
    expect(classifyError(400, 'blocked by content policy')).toBe('content');
    expect(classifyError(503, 'overloaded')).toBe('transient'); expect(classifyError(undefined, 'fetch failed')).toBe('transient');
    expect(classifyError(400, 'messages: field required')).toBe('bad_request');
  });
  it('凭证的问题只拿掉那把凭证；目标不存在拿掉目标；安全拒绝不换供应商', () => {
    expect(reaction('auth')).toMatchObject({ cool: 'credential', retrySame: false }); expect(reaction('rate_limit', 90_000)).toMatchObject({ cool: 'credential', ms: 90_000 });
    expect(reaction('rate_limit', 9e9).ms).toBeLessThanOrEqual(600_000);
    expect(reaction('not_found')).toMatchObject({ cool: 'target' }); expect(reaction('transient')).toMatchObject({ retrySame: true });
    expect(reaction('content').stop).toBe(true); expect(reaction('capability').cool).toBeUndefined();
  });
});

describe('凭证', () => {
  it('密文绑定所属连接：换一个连接解不开；界面只看得到脱敏提示', () => {
    _setMasterKey(randomBytes(32));
    const c = seal('sk-live-abcdef123456', 'prov_a');
    expect(c).not.toContain('abcdef'); expect(open(c, 'prov_a')).toBe('sk-live-abcdef123456'); expect(() => open(c, 'prov_b')).toThrow(/解不开/);
    _setMasterKey(randomBytes(32)); expect(() => open(c, 'prov_a')).toThrow(/解不开/); _setMasterKey(undefined);
    expect(hintOf('sk-live-abcdef123456')).toBe('…3456'); expect(hintOf('{"type":"service_account","client_email":"bot@p.iam.gserviceaccount.com","private_key":"x"}')).toBe('bot@p.iam.gserviceaccount.com');
  });
});

describe('目录', () => {
  const raw = Object.fromEntries(['one', 'two', 'three', 'four', 'five'].map((id) => [id, { id, name: id, npm: '@ai-sdk/openai-compatible', api: `https://${id}.example.com/v1`, models: {
    chat: { id: 'chat-vision', name: 'Chat', structured_output: true, modalities: { input: ['text', 'image'], output: ['text'] }, limit: { context: 1000 }, cost: { input: 0.5, output: 1.5 } },
    emb: { id: 'text-embedding-x', modalities: { input: ['text'], output: ['text'] } }, tts: { id: 'voice-tts', modalities: { input: ['text'], output: ['audio'] } },
  } }]));
  it('收敛成用得上的那几项：协议、地址、能力、价格；没有价格就是未知，不当作免费', () => {
    const c = normalizeCatalog({ ...raw, anthropic: { name: 'Anthropic', npm: '@ai-sdk/anthropic', models: { c: { id: 'claude-x', modalities: { input: ['text', 'image'], output: ['text'] } } } }, nobase: { name: 'X', npm: 'some-sdk', models: { a: { id: 'a' } } } });
    expect(c.providers[0].id).toBe('anthropic'); expect(c.providers[0]).toMatchObject({ protocol: 'anthropic', base_url: 'https://api.anthropic.com/v1' });
    expect(c.providers.find((p) => p.id === 'nobase')).toBeUndefined();
    const one = c.providers.find((p) => p.id === 'one')!;
    expect(one.models.map((m) => [m.id, m.kind])).toEqual([['chat-vision', 'chat'], ['text-embedding-x', 'embed']]);
    expect(one.models[0]).toMatchObject({ caps: { vision: true, json: true, context: 1000 }, cost: { input: 0.5, output: 1.5 } }); expect(one.models[1].cost).toBeNull();
  });
  it('内容不像目录时拒绝，不拿来覆盖旧目录', () => { expect(() => normalizeCatalog({ a: { models: {} } })).toThrow(); expect(() => normalizeCatalog([])).toThrow(); });
});

// ---- 故障模拟：本地假上游（OpenAI 兼容）----
type Reply = { status: number; body: unknown; headers?: Record<string, string> };
const ok = (text: string): Reply => ({ status: 200, body: { choices: [{ message: { content: text } }], usage: { prompt_tokens: 3, completion_tokens: 2 } } });
const fail = (status: number, message: string, headers?: Record<string, string>): Reply => ({ status, body: { error: { message } }, headers });

describe('一次请求怎么走（假上游）', () => {
  let srv: Server; let base = '';
  const calls: { path: string; key: string; body: { model: string; messages: { content: unknown }[]; google?: unknown } }[] = [];
  let script: (c: (typeof calls)[number]) => Reply = () => ok('hi');
  beforeAll(async () => {
    srv = createServer((req, res) => { const chunks: Buffer[] = []; req.on('data', (c: Buffer) => chunks.push(c)); req.on('end', () => {
      const c = { path: req.url ?? '', key: String(req.headers.authorization ?? '').replace('Bearer ', ''), body: JSON.parse(Buffer.concat(chunks).toString() || '{}') };
      calls.push(c); const r = script(c); res.writeHead(r.status, { 'content-type': 'application/json', ...r.headers }).end(JSON.stringify(r.body));
    }); });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  });
  afterAll(() => { srv.close(); });
  const setup = (over: (p: ProviderConn[]) => void = () => {}) => {
    const ps = [prov('a', [model('a1')], { base_url: `${base}/a`, credentials: [{ id: 'a_k1', label: '', enabled: true, hint: '…1', secret_id: 'a_s1' }, { id: 'a_k2', label: '', enabled: true, hint: '…2', secret_id: 'a_s2' }] }), prov('b', [model('b1')], { base_url: `${base}/b` })];
    over(ps);
    _setSnapshot(normalizeConfig({ providers: ps, order: ['a1', 'b1'] }), { a_s1: 'key-a1', a_s2: 'key-a2', b_s1: 'key-b1' }, 7);
  };
  beforeEach(() => { calls.length = 0; script = () => ok('hi'); });
  const ask = (role = 'mind_slow', extra: object = {}) => gateway().chat(role, { messages: [{ role: 'user', content: 'hello' }], ...extra });

  it('走首选目标；结果里带着实际目标与配置版本', async () => {
    setup(); const r = await ask();
    expect(r).toMatchObject({ text: 'hi', model: 'a1', alias: 'think', version: 7 }); expect(calls).toHaveLength(1); expect(calls[0].path).toBe('/a/chat/completions');
  });
  it('一把凭证失效：只隔离这把凭证，同一目标换另一把继续', async () => {
    setup(); const bad = { key: '' };
    script = (c) => { if (!bad.key) bad.key = c.key; return c.key === bad.key ? fail(401, 'Invalid API key') : ok('fine'); };
    const r = await ask();
    expect(r.model).toBe('a1'); expect(calls.map((c) => c.path)).toEqual(['/a/chat/completions', '/a/chat/completions']); expect(calls[0].key).not.toBe(calls[1].key);
    expect([...health.keys()]).toEqual([bad.key === 'key-a1' ? 'c:a_k1' : 'c:a_k2']);
  });
  it('限流：尊重上游给的恢复时间，转到下一个目标；冷却记在真正失败的那一方，接替的目标不受牵连', async () => {
    setup((p) => { p[0].credentials.pop(); });
    script = (c) => (c.path.startsWith('/a/') ? fail(429, 'rate limit', { 'retry-after': '120' }) : ok('from b'));
    const r = await ask();
    expect(r.model).toBe('b1'); expect([...health.keys()]).toEqual(['c:a_k1']); expect(health.get('c:a_k1')!.until - Date.now()).toBeGreaterThan(100_000);
    calls.length = 0; expect((await ask()).model).toBe('b1'); expect(calls.map((c) => c.path)).toEqual(['/b/chat/completions']);        // 冷却期内不再去撞 a
  });
  it('临时故障：同一目标退避后再试一次，还不行才换下一个', async () => {
    setup((p) => { p[0].credentials.pop(); });
    script = (c) => (c.path.startsWith('/a/') ? fail(503, 'overloaded') : ok('from b'));
    const r = await ask();
    expect(r.model).toBe('b1'); expect(calls.map((c) => c.path[1])).toEqual(['a', 'a', 'b']); expect(health.has('t:a1')).toBe(true); expect(health.has('t:b1')).toBe(false);
  });
  it('带图片的请求不会发给不能看图的目标', async () => {
    setup((p) => { p[0].models[0].caps.vision = false; });
    const r = await gateway().chat('mind_slow', { messages: [{ role: 'user', content: [{ type: 'image', data: solidPng(255, 0, 0), mime: 'image/png' }, { type: 'text', text: '?' }] }] });
    expect(r.model).toBe('b1'); expect(calls).toHaveLength(1);
  });
  it('结构化输出不合格：让同一个目标改一次；改对了就用', async () => {
    setup(); let n = 0; script = () => (n++ === 0 ? ok('not json at all') : ok('{"n": 3}'));
    const r = await gateway().chat('mind_slow', { messages: [{ role: 'user', content: 'x' }], schema: z.object({ n: z.number() }) });
    expect(r.data).toEqual({ n: 3 }); expect(calls).toHaveLength(2); expect(JSON.stringify(calls[1].body.messages)).toContain('不符合 JSON Schema');
  });
  it('上游不认某个可选参数：去掉它再发，之后不再带', async () => {
    setup(); script = (c) => ('temperature' in c.body ? fail(400, 'Unsupported parameter: temperature') : ok('ok'));
    expect((await ask('mind_slow', { temperature: 0.9 })).text).toBe('ok'); expect(calls).toHaveLength(2);
    calls.length = 0; await ask('mind_slow', { temperature: 0.9 }); expect(calls).toHaveLength(1);
  });
  it('内容安全拒绝：到此为止，不靠换供应商绕过', async () => {
    setup(); script = () => fail(400, 'Request blocked by content policy');
    await expect(ask()).rejects.toMatchObject({ code: 'content' }); expect(calls).toHaveLength(1);
  });
  it('一次请求的总尝试数有上限', async () => {
    setup(); script = () => fail(503, 'unavailable');
    await expect(ask()).rejects.toBeInstanceOf(LlmError); expect(calls.length).toBeLessThanOrEqual(6);
  });
  it('没有任何可用目标时说清楚缺什么，而不是悄悄用别的', async () => {
    setup((p) => { p[0].enabled = false; p[1].enabled = false; });
    await expect(ask()).rejects.toMatchObject({ code: 'no_model' }); await expect(ask()).rejects.toThrow(/连接已停用/); expect(calls).toHaveLength(0);
  });
  it('兼容入口：把请求转给模型组里的目标，替换成上游模型名，去掉只有 Google 自家入口认识的字段', async () => {
    setup((p) => { p[0].models[0].uses = ['locate']; p[0].models[0].model = 'gemini-4-hydrogen'; p[1].models[0].uses = ['locate']; p[1].models[0].model = 'qwen3-vl-plus'; });
    const r = await proxyChat('locate', { model: 'anything', messages: [{ role: 'user', content: 'where' }], google: { thinking_config: {} } }, { family: 'qwen3-vl' });
    expect(r.status).toBe(200); expect(calls).toHaveLength(1); expect(calls[0].path).toBe('/b/chat/completions'); expect(calls[0].body.model).toBe('qwen3-vl-plus'); expect(calls[0].body.google).toBeUndefined();
    expect((await proxyChat('locate', { messages: [] }, { family: 'gpt-5' })).status).toBe(503);
  });
});
