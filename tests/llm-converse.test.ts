// 对话（Jobs Agent 用）：带工具调用的流式请求在三种协议上的请求体与解析
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { converseUpstream, oaAccumulator, toAnthropic, toOpenAIMessages, type ConvEvent, type ConvMsg } from '../packages/llm/src/converse.ts';
import { defaultUses, useOfRole, type ModelEntry, type ProviderConn } from '../packages/llm/src/config.ts';

let server: Server; let base = '';
let handler: (body: Record<string, unknown>, res: ServerResponse) => void = () => {};
const bodies: Record<string, unknown>[] = [];
beforeAll(async () => {
  server = createServer((req: IncomingMessage, res) => { let s = ''; req.on('data', (c) => { s += c; }); req.on('end', () => { const b = JSON.parse(s) as Record<string, unknown>; bodies.push(b); handler(b, res); }); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); });
beforeEach(() => { bodies.length = 0; });

const sse = (res: ServerResponse, events: unknown[]) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); for (const e of events) res.write(`data: ${JSON.stringify(e)}\n\n`); res.end('data: [DONE]\n\n'); };
const model = (id: string): ModelEntry => ({ id, model: id, kind: 'chat', uses: ['chat'], caps: { vision: true, json: false } }) as ModelEntry;
const prov = (protocol: ProviderConn['protocol'], m: ModelEntry): ProviderConn => ({ id: 'p', name: 'P', protocol, base_url: base, enabled: true, credentials: [], models: [m] });
const tools = [{ name: 'product_status', description: 'status', parameters: { type: 'object', properties: { product: { type: 'string' } }, required: ['product'] } }];

describe('对话模型组', () => {
  it('agent 角色归「对话」组；新勾选的对话模型默认也承担对话', () => {
    expect(useOfRole('agent')).toBe('chat');
    expect(useOfRole('agent_compact')).toBe('think');
    expect(defaultUses('chat', 'gpt-x', { vision: false, json: true })).toContain('chat');
    expect(defaultUses('embed', 'text-embedding', { vision: false, json: false })).toEqual(['embed']);
  });
});

describe('消息格式', () => {
  const convo: ConvMsg[] = [
    { role: 'system', content: '你是 Jobs' },
    { role: 'user', content: 'Quick Notes 怎么样' },
    { role: 'assistant', content: '', tool_calls: [{ id: 'c1', name: 'product_status', arguments: '{"product":"Quick Notes"}', signature: 'sig-1' }] },
    { role: 'tool', tool_call_id: 'c1', name: 'product_status', content: [{ type: 'text', text: '3 人用过' }, { type: 'image', data: 'AAAA', mime: 'image/png' }] },
    { role: 'assistant', content: '有 3 个人用过。' },
  ];

  it('OpenAI 兼容：工具调用带回 Gemini 的签名；工具结果里的图片放进随后的一条用户消息', () => {
    const m = toOpenAIMessages(convo);
    expect(m[2]).toMatchObject({ role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'product_status', arguments: '{"product":"Quick Notes"}' }, extra_content: { google: { thought_signature: 'sig-1' } } }] });
    expect(m[3]).toEqual({ role: 'tool', tool_call_id: 'c1', content: '3 人用过' });
    expect(m[4]).toMatchObject({ role: 'user', content: [{ type: 'text' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }] });
    expect(m[5]).toEqual({ role: 'assistant', content: '有 3 个人用过。' });
  });

  it('Anthropic：system 单独放，工具调用是 tool_use，结果是用户消息里的 tool_result', () => {
    const a = toAnthropic(convo);
    expect(a.system).toBe('你是 Jobs');
    expect(a.messages[1]).toEqual({ role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: 'product_status', input: { product: 'Quick Notes' } }] });
    expect(a.messages[2]).toMatchObject({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: [{ type: 'text', text: '3 人用过' }, { type: 'image' }] }] });
  });
});

describe('流式解析', () => {
  it('OpenAI 兼容：分片的工具参数拼完整；多个工具按 index 分开；思考摘要不进回答', () => {
    const ev: ConvEvent[] = []; const acc = oaAccumulator((e) => ev.push(e));
    acc.push({ choices: [{ delta: { content: '让我看看', extra_content: { google: { thought: true } } } }] });
    acc.push({ choices: [{ delta: { content: '我查一下。' } }] });
    acc.push({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'a', function: { name: 'product_status', arguments: '{"pro' }, extra_content: { google: { thought_signature: 'S' } } }] } }] });
    acc.push({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'duct":"X"}' } }, { index: 1, id: 'b', function: { name: 'list_products', arguments: '{}' } }] } }] });
    acc.push({ choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 5, completion_tokens: 7 } });
    const r = acc.result();
    expect(r.text).toBe('我查一下。');
    expect(r.finish).toBe('tool_calls');
    expect(r.tool_calls).toEqual([{ id: 'a', name: 'product_status', arguments: '{"product":"X"}', signature: 'S' }, { id: 'b', name: 'list_products', arguments: '{}' }]);
    expect(ev.filter((e) => e.type === 'tool_start').map((e) => (e as { name: string }).name)).toEqual(['product_status', 'list_products']);
    expect(ev.some((e) => e.type === 'thinking')).toBe(true);
  });

  it('OpenAI 兼容：真实请求带 tools 与流式选项，Vertex 另带思考摘要配置', async () => {
    handler = (_b, res) => sse(res, [{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'x', function: { name: 'product_status', arguments: '{"product":"Q"}' } }] }, finish_reason: 'tool_calls' }] }]);
    const m = model('c1');
    const r = await converseUpstream(prov('openai', m), m, 'k', { messages: [{ role: 'user', content: 'hi' }], tools }, () => undefined);
    expect(r.tool_calls[0]).toMatchObject({ name: 'product_status', arguments: '{"product":"Q"}' });
    expect(bodies[0]).toMatchObject({ stream: true, tools: [{ type: 'function', function: { name: 'product_status' } }] });
    expect(bodies[0].extra_body).toBeUndefined();
  });

  it('Anthropic：tool_use 块与 input_json_delta 拼成工具调用', async () => {
    handler = (_b, res) => sse(res, [
      { type: 'message_start', message: { usage: { input_tokens: 9, output_tokens: 1 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '好的' } },
      { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tu1', name: 'product_status' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"product":' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '"Q"}' } },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 20 } },
    ]);
    const m = model('c2');
    const r = await converseUpstream(prov('anthropic', m), m, 'k', { messages: [{ role: 'system', content: 'S' }, { role: 'user', content: 'hi' }], tools }, () => undefined);
    expect(r).toMatchObject({ text: '好的', finish: 'tool_calls', tool_calls: [{ id: 'tu1', name: 'product_status', arguments: '{"product":"Q"}' }], usage: { prompt: 9, completion: 20 } });
    expect(bodies[0]).toMatchObject({ system: 'S', tools: [{ name: 'product_status', input_schema: { type: 'object' } }], stream: true });
  });

  it('停止：外部的 signal 能打断进行中的请求', async () => {
    handler = (_b, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '一' } }] })}\n\n`); /* 不结束 */ };
    const m = model('c3'); const ac = new AbortController(); const got: string[] = [];
    const p = converseUpstream(prov('openai', m), m, 'k', { messages: [{ role: 'user', content: 'hi' }], signal: ac.signal }, (e) => { if (e.type === 'text') { got.push(e.delta); ac.abort(); } });
    await expect(p).rejects.toThrow();
    expect(got).toEqual(['一']);
  });
});
