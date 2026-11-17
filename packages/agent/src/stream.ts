// pi 的 agent 循环 → 我们自己的模型路由。pi 只管循环（工具调用、插话、停止、事件）；模型调用一律走 @pux/llm 的 converse()，
// 所以「设置 › 模型」里配置的对话组、失败接替、花费记录都照旧。这里把 pi 的消息格式和我们的对话格式互相翻译。
import { createAssistantMessageEventStream, getCurrentSystemPrompt, getCurrentTools, type AssistantMessage, type Message, type Model, type TextContent, type ToolCall, type TranscriptContext } from '@earendil-works/pi-ai';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import type { ContentPart, ConvEvent, ConvMsg, ConvRes, ToolSpec } from '@pux/llm';

/** pi 需要一个模型对象；真正用哪个模型由路由决定，这里只是占位 */
export const JOBS_MODEL = { id: 'jobs-chat', name: 'Jobs', api: 'jobs', provider: 'jobs', baseUrl: '', reasoning: false, input: ['text', 'image'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200_000, maxTokens: 8192 } as unknown as Model<'jobs'>;

export type Converse = (o: { messages: ConvMsg[]; tools: ToolSpec[]; signal?: AbortSignal; onEvent: (e: ConvEvent) => void }) => Promise<ConvRes & { model?: string; cost_usd?: number }>;

/** pi 的消息 → 我们的对话消息（系统提示单独给；出错或被停掉的助手消息不送回模型） */
export function toConv(messages: Message[]): ConvMsg[] {
  const out: ConvMsg[] = [];
  const sys = getCurrentSystemPrompt(messages);
  if (sys) out.push({ role: 'system', content: sys });
  const part = (c: { type: string; text?: string; data?: string; mimeType?: string }): ContentPart => (c.type === 'image' ? { type: 'image', data: c.data ?? '', mime: c.mimeType } : { type: 'text', text: c.text ?? '' });
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'user') out.push({ role: 'user', content: typeof m.content === 'string' ? m.content : m.content.map(part) });
    else if (m.role === 'assistant') {
      if (m.stopReason === 'error' || m.stopReason === 'aborted') { const t = m.content.filter((c): c is TextContent => c.type === 'text').map((c) => c.text).join(''); if (t.trim()) out.push({ role: 'assistant', content: t }); continue; }
      const text = m.content.filter((c): c is TextContent => c.type === 'text').map((c) => c.text).join('');
      const calls = m.content.filter((c): c is ToolCall => c.type === 'toolCall').map((c) => ({ id: c.id, name: c.name, arguments: JSON.stringify(c.arguments ?? {}), ...(c.thoughtSignature ? { signature: c.thoughtSignature } : {}) }));
      out.push({ role: 'assistant', content: text, ...(calls.length ? { tool_calls: calls } : {}) });
    } else if (m.role === 'toolResult') out.push({ role: 'tool', tool_call_id: m.toolCallId, name: m.toolName, content: m.content.map(part), is_error: m.isError });
  }
  // 被停掉的工具调用后面没有结果：补一个，否则上游会拒绝（每个工具调用都要有对应的结果）
  const answered = new Set(out.filter((m) => m.role === 'tool').map((m) => (m as { tool_call_id: string }).tool_call_id));
  const fixed: ConvMsg[] = [];
  for (const m of out) {
    fixed.push(m);
    if (m.role === 'assistant' && m.tool_calls) for (const c of m.tool_calls) if (!answered.has(c.id)) { const i = out.indexOf(m); const next = out.slice(i + 1).some((x) => x.role === 'tool' && x.tool_call_id === c.id); if (!next) fixed.push({ role: 'tool', tool_call_id: c.id, name: c.name, content: '（这一步被停止了，没有结果）', is_error: true }); }
  }
  return fixed;
}

const usage0 = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });

/** 用给定的 converse（默认是路由的 gateway().converse('agent', …)）做 pi 的 streamFn */
export function makeStreamFn(converse: Converse, onCost?: (usd: number, tokens: number) => void): StreamFn {
  return (_model, context: TranscriptContext, options) => {
    const stream = createAssistantMessageEventStream();
    const tools: ToolSpec[] = getCurrentTools(context.messages).map((t) => ({ name: t.name, description: t.description, parameters: t.parameters as Record<string, unknown> }));
    const msg: AssistantMessage = { role: 'assistant', content: [], api: 'jobs', provider: 'jobs', model: 'jobs-chat', usage: usage0(), stopReason: 'pending', timestamp: Date.now() };
    const snap = (): AssistantMessage => ({ ...msg, content: msg.content.map((c) => ({ ...c })) as AssistantMessage['content'] });
    let textIdx = -1; const toolIdx = new Map<number, number>(); const toolArgs = new Map<number, string>();
    void (async () => {
      stream.push({ type: 'start', partial: snap() });
      try {
        const r = await converse({
          messages: toConv(context.messages), tools, signal: options?.signal,
          onEvent: (e) => {
            if (e.type === 'text') {
              if (textIdx < 0 || msg.content[textIdx]?.type !== 'text') { msg.content.push({ type: 'text', text: '' }); textIdx = msg.content.length - 1; stream.push({ type: 'text_start', contentIndex: textIdx, partial: snap() }); }
              (msg.content[textIdx] as TextContent).text += e.delta;
              stream.push({ type: 'text_delta', contentIndex: textIdx, delta: e.delta, partial: snap() });
            } else if (e.type === 'tool_start') {
              msg.content.push({ type: 'toolCall', id: e.id, name: e.name, arguments: {} }); const k = msg.content.length - 1; toolIdx.set(e.index, k); toolArgs.set(e.index, ''); textIdx = -1;
              stream.push({ type: 'toolcall_start', contentIndex: k, partial: snap() });
            } else if (e.type === 'tool_delta') {
              const k = toolIdx.get(e.index); if (k === undefined) return; toolArgs.set(e.index, (toolArgs.get(e.index) ?? '') + e.delta);
              stream.push({ type: 'toolcall_delta', contentIndex: k, delta: e.delta, partial: snap() });
            }
          },
        });
        // 以最终结果为准重建内容：工具调用的完整参数、Gemini 的签名、上游给的 id
        msg.content = [];
        if (r.text) msg.content.push({ type: 'text', text: r.text });
        for (const c of r.tool_calls) {
          let args: Record<string, unknown> = {}; let bad: string | undefined;
          try { args = c.arguments.trim() ? JSON.parse(c.arguments) as Record<string, unknown> : {}; } catch { bad = `参数不是合法的 JSON：${c.arguments.slice(0, 200)}`; }
          msg.content.push({ type: 'toolCall', id: c.id, name: c.name, arguments: args as ToolCall['arguments'], ...(c.signature ? { thoughtSignature: c.signature } : {}), ...(bad ? { argumentsError: bad } : {}) });
        }
        msg.usage = { ...usage0(), input: r.usage.prompt, output: r.usage.completion, reasoning: r.usage.reasoning, totalTokens: r.usage.prompt + r.usage.completion, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: r.cost_usd ?? 0 } };
        if (r.model) msg.responseModel = r.model;
        onCost?.(r.cost_usd ?? 0, r.usage.prompt + r.usage.completion);
        msg.content.forEach((c, i) => { if (c.type === 'toolCall') stream.push({ type: 'toolcall_end', contentIndex: i, toolCall: c, partial: snap() }); else if (c.type === 'text') stream.push({ type: 'text_end', contentIndex: i, content: c.text, partial: snap() }); });
        msg.stopReason = r.tool_calls.length ? 'toolUse' : r.finish === 'length' ? 'length' : 'stop';
        const final = snap();
        stream.push({ type: 'done', reason: msg.stopReason as 'stop' | 'length' | 'toolUse', message: final });
        stream.end(final);
      } catch (e) {
        const aborted = !!options?.signal?.aborted;
        msg.stopReason = aborted ? 'aborted' : 'error'; msg.errorMessage = aborted ? '已停止' : String((e as Error).message ?? e).slice(0, 400);
        const final = snap();
        stream.push({ type: 'error', reason: aborted ? 'aborted' : 'error', error: final });
        stream.end(final);
      }
    })();
    return stream;
  };
}
