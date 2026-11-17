// 对话：带工具调用的流式请求（给 Jobs Agent 用）。
// 和 chat() 的分工：chat() 一次要一个完整的回答（可以要求 JSON）；converse() 一边生成一边交出文字增量与工具调用，
// 由 agent 循环决定执行哪个工具、什么时候再问一轮。协议差异（OpenAI 兼容 / Vertex / Anthropic）都在这里抹平。
import { dataUrl, openaiEndpoint, stream, UpstreamError, type ContentPart } from './adapters.ts';
import type { ModelEntry, ProviderConn } from './config.ts';

export interface ConvToolCall {
  id: string; name: string;
  /** 参数的 JSON 文本（上游分片流出，拼完才是完整的 JSON） */
  arguments: string;
  /** Gemini 的 thought_signature：带着工具调用一起回传，下一轮原样送回，否则上游拒绝 */
  signature?: string;
}
export type ConvMsg =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | ContentPart[] }
  | { role: 'assistant'; content: string; tool_calls?: ConvToolCall[] }
  | { role: 'tool'; tool_call_id: string; name: string; content: string | ContentPart[]; is_error?: boolean };
export interface ToolSpec { name: string; description: string; parameters: Record<string, unknown> }
export type ConvEvent =
  | { type: 'text'; delta: string }
  | { type: 'thinking'; delta: string }
  | { type: 'tool_start'; index: number; id: string; name: string }
  | { type: 'tool_delta'; index: number; delta: string };
export interface ConvReq { messages: ConvMsg[]; tools?: ToolSpec[]; temperature?: number; maxTokens?: number; timeoutMs?: number; signal?: AbortSignal }
export interface ConvRes { text: string; tool_calls: ConvToolCall[]; finish: 'stop' | 'length' | 'tool_calls'; usage: { prompt: number; completion: number; reasoning: number } }

const textOf = (c: string | ContentPart[]) => (typeof c === 'string' ? c : c.filter((x) => x.type === 'text').map((x) => (x as { text: string }).text).join('\n'));
const imagesOf = (c: string | ContentPart[]) => (typeof c === 'string' ? [] : c.filter((x): x is Extract<ContentPart, { type: 'image' }> => x.type === 'image'));
const oaContent = (c: string | ContentPart[]) => (typeof c === 'string' ? c : c.map((x) => (x.type === 'text' ? { type: 'text', text: x.text } : { type: 'image_url', image_url: { url: dataUrl(x) } })));

/** 对话消息 → OpenAI 兼容的 messages。工具结果里的图片：工具消息只能放文字，图片放进紧随其后的一条用户消息 */
export function toOpenAIMessages(msgs: ConvMsg[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []; let pending: ContentPart[] = [];
  const flush = () => { if (pending.length) { out.push({ role: 'user', content: [{ type: 'text', text: '（上面工具返回的图片）' }, ...oaContent(pending) as object[]] }); pending = []; } };
  for (const m of msgs) {
    if (m.role !== 'tool') flush();
    if (m.role === 'system') out.push({ role: 'system', content: m.content });
    else if (m.role === 'user') out.push({ role: 'user', content: oaContent(m.content) });
    else if (m.role === 'assistant') {
      const o: Record<string, unknown> = { role: 'assistant', content: m.content || (m.tool_calls?.length ? null : '') };
      if (m.tool_calls?.length) o.tool_calls = m.tool_calls.map((t) => ({ id: t.id, type: 'function', function: { name: t.name, arguments: t.arguments || '{}' }, ...(t.signature ? { extra_content: { google: { thought_signature: t.signature } } } : {}) }));
      out.push(o);
    } else { out.push({ role: 'tool', tool_call_id: m.tool_call_id, content: (m.is_error ? '错误：' : '') + (textOf(m.content) || '（无文字输出）') }); pending.push(...imagesOf(m.content)); }
  }
  flush();
  return out;
}

interface OADelta { content?: string | null; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string }; extra_content?: { google?: { thought_signature?: string } } }[]; extra_content?: { google?: { thought?: boolean } }; reasoning_content?: string }
interface OAChunk { choices?: { delta?: OADelta; message?: { content?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string }; extra_content?: { google?: { thought_signature?: string } } }[] }; finish_reason?: string | null }[]; usage?: { prompt_tokens?: number; completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } }; error?: { message?: string } }

/** 把一串 OpenAI 兼容的流式块累积成结果（纯函数式的累加器，便于测试） */
export function oaAccumulator(onEvent: (e: ConvEvent) => void) {
  let text = ''; let finish: string | null | undefined; let usage: OAChunk['usage'];
  const calls: (ConvToolCall & { started: boolean })[] = [];
  return {
    push(r: OAChunk) {
      if (r.error?.message) throw new UpstreamError(r.error.message, 400);
      const ch = r.choices?.[0];
      const d = ch?.delta;
      if (d) {
        if (typeof d.content === 'string' && d.content) {
          if (d.extra_content?.google?.thought) onEvent({ type: 'thinking', delta: d.content });      // Vertex 的思考摘要：不算回答
          else { text += d.content; onEvent({ type: 'text', delta: d.content }); }
        }
        if (typeof d.reasoning_content === 'string' && d.reasoning_content) onEvent({ type: 'thinking', delta: d.reasoning_content });
        for (const tc of d.tool_calls ?? []) {
          const i = tc.index ?? calls.length;
          const c = (calls[i] ??= { id: '', name: '', arguments: '', started: false });
          if (tc.id) c.id = tc.id; if (tc.function?.name) c.name += c.started ? '' : tc.function.name;
          if (tc.extra_content?.google?.thought_signature) c.signature = tc.extra_content.google.thought_signature;
          if (!c.started && c.name) { c.started = true; onEvent({ type: 'tool_start', index: i, id: c.id, name: c.name }); }
          if (tc.function?.arguments) { c.arguments += tc.function.arguments; onEvent({ type: 'tool_delta', index: i, delta: tc.function.arguments }); }
        }
      }
      const msg = ch?.message;                                                                // 上游不流式时的整段回答
      if (msg) {
        if (msg.content) { text += msg.content; onEvent({ type: 'text', delta: msg.content }); }
        for (const tc of msg.tool_calls ?? []) { const i = calls.length; calls.push({ id: tc.id, name: tc.function.name, arguments: tc.function.arguments, signature: tc.extra_content?.google?.thought_signature, started: true }); onEvent({ type: 'tool_start', index: i, id: tc.id, name: tc.function.name }); }
      }
      if (ch?.finish_reason) finish = ch.finish_reason;
      if (r.usage) usage = r.usage;
    },
    result(): ConvRes {
      const tool_calls = calls.filter((c) => c.name).map((c, i) => ({ id: c.id || `call_${i}_${Date.now().toString(36)}`, name: c.name, arguments: c.arguments, ...(c.signature ? { signature: c.signature } : {}) }));
      if (!text && !tool_calls.length && finish === 'content_filter') throw new UpstreamError('content filter', 400);
      return { text, tool_calls, finish: tool_calls.length ? 'tool_calls' : finish === 'length' ? 'length' : 'stop', usage: { prompt: usage?.prompt_tokens ?? 0, completion: usage?.completion_tokens ?? 0, reasoning: usage?.completion_tokens_details?.reasoning_tokens ?? 0 } };
    },
  };
}

async function converseOpenAI(p: ProviderConn, m: ModelEntry, secret: string, req: ConvReq, onEvent: (e: ConvEvent) => void): Promise<ConvRes> {
  const ep = await openaiEndpoint(p, m, secret);
  const body: Record<string, unknown> = { model: ep.model, messages: toOpenAIMessages(req.messages), stream: true, stream_options: { include_usage: true } };
  if (req.tools?.length) body.tools = req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (req.maxTokens) body.max_tokens = req.maxTokens;
  // Vertex：要思考摘要流出来，长思考时连接上也一直有数据（与 chat() 同样的理由）
  if (p.protocol === 'vertex') body.extra_body = { google: { thinking_config: { include_thoughts: true } } };
  const acc = oaAccumulator(onEvent);
  for await (const raw of stream(`${ep.base}/chat/completions`, ep.headers, body, req.timeoutMs ?? 180_000, req.signal)) acc.push(raw as OAChunk);
  return acc.result();
}

/** 对话消息 → Anthropic Messages（system 单独放；工具结果放在用户消息里） */
export function toAnthropic(msgs: ConvMsg[]): { system: string; messages: Record<string, unknown>[] } {
  const system = msgs.filter((x) => x.role === 'system').map((x) => x.content as string).join('\n\n');
  const img = (c: Extract<ContentPart, { type: 'image' }>) => ({ type: 'image', source: { type: 'base64', media_type: c.mime ?? 'image/jpeg', data: typeof c.data === 'string' ? c.data : c.data.toString('base64') } });
  const parts = (c: string | ContentPart[]) => (typeof c === 'string' ? [{ type: 'text', text: c || ' ' }] : c.map((x) => (x.type === 'text' ? { type: 'text', text: x.text } : img(x))));
  const out: { role: 'user' | 'assistant'; content: Record<string, unknown>[] }[] = [];
  const push = (role: 'user' | 'assistant', content: Record<string, unknown>[]) => { const last = out[out.length - 1]; if (last?.role === role) last.content.push(...content); else out.push({ role, content }); };
  for (const m of msgs) {
    if (m.role === 'system') continue;
    if (m.role === 'user') push('user', parts(m.content));
    else if (m.role === 'assistant') {
      const c: Record<string, unknown>[] = m.content ? [{ type: 'text', text: m.content }] : [];
      for (const t of m.tool_calls ?? []) { let input: unknown = {}; try { input = JSON.parse(t.arguments || '{}'); } catch { /* 坏参数照原样当空对象 */ } c.push({ type: 'tool_use', id: t.id, name: t.name, input }); }
      push('assistant', c.length ? c : [{ type: 'text', text: ' ' }]);
    } else push('user', [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: parts(m.content), ...(m.is_error ? { is_error: true } : {}) }]);
  }
  return { system, messages: out };
}

async function converseAnthropic(p: ProviderConn, m: ModelEntry, secret: string, req: ConvReq, onEvent: (e: ConvEvent) => void): Promise<ConvRes> {
  const { system, messages } = toAnthropic(req.messages);
  const body: Record<string, unknown> = { model: m.model, max_tokens: req.maxTokens ?? Math.min(m.caps.output ?? 8192, 8192), messages, stream: true };
  if (system) body.system = system;
  if (req.tools?.length) body.tools = req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  if (req.temperature !== undefined) body.temperature = Math.min(1, req.temperature);
  let text = ''; let prompt = 0; let completion = 0; let stop: string | undefined;
  const calls: ConvToolCall[] = []; const blockToCall = new Map<number, number>();
  for await (const e of stream(`${p.base_url}/messages`, { 'x-api-key': secret, 'anthropic-version': '2023-06-01' }, body, req.timeoutMs ?? 180_000, req.signal)) {
    const ev = e as { type?: string; index?: number; content_block?: { type?: string; id?: string; name?: string }; delta?: { type?: string; text?: string; partial_json?: string; thinking?: string; stop_reason?: string }; message?: { usage?: { input_tokens?: number; output_tokens?: number } }; usage?: { output_tokens?: number }; error?: { message?: string } };
    if (ev.type === 'error') throw new UpstreamError(ev.error?.message ?? 'upstream error', 529);
    if (ev.type === 'message_start') { prompt = ev.message?.usage?.input_tokens ?? 0; completion = ev.message?.usage?.output_tokens ?? 0; }
    else if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') { const i = calls.length; calls.push({ id: ev.content_block.id ?? `toolu_${i}`, name: ev.content_block.name ?? '', arguments: '' }); blockToCall.set(ev.index ?? -1, i); onEvent({ type: 'tool_start', index: i, id: calls[i].id, name: calls[i].name }); }
    else if (ev.type === 'content_block_delta') {
      if (ev.delta?.type === 'text_delta' && ev.delta.text) { text += ev.delta.text; onEvent({ type: 'text', delta: ev.delta.text }); }
      else if (ev.delta?.type === 'thinking_delta' && ev.delta.thinking) onEvent({ type: 'thinking', delta: ev.delta.thinking });
      else if (ev.delta?.type === 'input_json_delta') { const i = blockToCall.get(ev.index ?? -1); if (i !== undefined) { calls[i].arguments += ev.delta.partial_json ?? ''; onEvent({ type: 'tool_delta', index: i, delta: ev.delta.partial_json ?? '' }); } }
    } else if (ev.type === 'message_delta') { completion = ev.usage?.output_tokens ?? completion; stop = ev.delta?.stop_reason ?? stop; }
  }
  return { text, tool_calls: calls, finish: calls.length ? 'tool_calls' : stop === 'max_tokens' ? 'length' : 'stop', usage: { prompt, completion, reasoning: 0 } };
}

export const converseUpstream = (p: ProviderConn, m: ModelEntry, secret: string, req: ConvReq, onEvent: (e: ConvEvent) => void) => (p.protocol === 'anthropic' ? converseAnthropic(p, m, secret, req, onEvent) : converseOpenAI(p, m, secret, req, onEvent));
