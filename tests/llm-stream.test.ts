// 模型调用走流式：想得久时连接上一直有数据，不会被中间的代理当成空闲连接掐断（生产上 fetch failed 的根因）
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { chat } from '../packages/llm/src/adapters.ts';
import type { ModelEntry, ProviderConn } from '../packages/llm/src/config.ts';

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
const model = (id: string): ModelEntry => ({ id, model: id, kind: 'chat', uses: ['think'], caps: { vision: false, json: false } }) as ModelEntry;
const prov = (protocol: ProviderConn['protocol'], m: ModelEntry): ProviderConn => ({ id: 'p', name: 'P', protocol, base_url: base, enabled: true, credentials: [], models: [m] });

describe('流式调用', () => {
  it('OpenAI 兼容：拼起回答，思考摘要（thought）不算回答，用量取最后一块', async () => {
    handler = (_b, res) => sse(res, [
      { choices: [{ delta: { content: '**想一想**', extra_content: { google: { thought: true } } } }] },
      { choices: [{ delta: { content: '{"n":' } }] },
      { choices: [{ delta: { content: ' 15}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 4, completion_tokens_details: { reasoning_tokens: 30 } } },
    ]);
    const m = model('a1');
    const r = await chat(prov('openai', m), m, 'k', { messages: [{ role: 'user', content: 'hi' }], reasoning: 'medium' });
    expect(r.text).toBe('{"n": 15}');
    expect(r.usage).toEqual({ prompt: 10, completion: 4, reasoning: 30 });
    expect(bodies[0]).toMatchObject({ stream: true, stream_options: { include_usage: true }, reasoning_effort: 'medium' });
  });

  it('上游不认 stream：去掉再试，按普通 JSON 读回答', async () => {
    handler = (b, res) => {
      if (b.stream) { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'stream is not supported' } })); return; }
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    };
    const m = model('a2');
    const r = await chat(prov('openai', m), m, 'k', { messages: [{ role: 'user', content: 'hi' }] });
    expect(r.text).toBe('ok');
    expect(bodies.map((b) => !!b.stream)).toEqual([true, false]);
  });

  it('流里带错误：报出来，不当成空回答', async () => {
    handler = (_b, res) => sse(res, [{ error: { message: 'quota exceeded' } }]);
    const m = model('a3');
    await expect(chat(prov('openai', m), m, 'k', { messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow('quota exceeded');
  });

  it('Anthropic：按事件拼起回答与用量', async () => {
    handler = (_b, res) => sse(res, [
      { type: 'message_start', message: { usage: { input_tokens: 12, output_tokens: 1 } } },
      { type: 'ping' },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hel' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'lo' } },
      { type: 'message_delta', usage: { output_tokens: 5 } },
    ]);
    const m = model('c1');
    const r = await chat(prov('anthropic', m), m, 'k', { messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'hi' }] });
    expect(r.text).toBe('Hello');
    expect(r.usage).toEqual({ prompt: 12, completion: 5, reasoning: 0 });
    expect(bodies[0]).toMatchObject({ stream: true, system: 's' });
  });
});
