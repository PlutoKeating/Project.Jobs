// Jobs 工具（与 MCP、命令行同一份）→ pi 的 AgentTool。按说话人的角色过滤；执行时用说话人的身份调 REST。
// 另有几个只在对话里才有意义的工具：给用户看一张截图、进入跟某位居民的对话。
import { z } from '@pux/core';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import type { JobsTool, ToolApi } from '@pux/engine/launch/tools';

export type Role = 'admin' | 'viewer';

/** zod 的参数定义 → JSON Schema（各家模型都接受的子集） */
export function paramsOf(input: z.ZodRawShape): Record<string, unknown> {
  const js = z.toJSONSchema(z.object(input), { unrepresentable: 'any', io: 'input' }) as Record<string, unknown>;
  const clean = (n: unknown): unknown => {
    if (Array.isArray(n)) return n.map(clean);
    if (!n || typeof n !== 'object') return n;
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(n as Record<string, unknown>)) { if (['$schema', 'additionalProperties', '$id', 'exclusiveMinimum', 'exclusiveMaximum', 'pattern', 'format'].includes(k)) continue; o[k] = clean(v); }
    return o;
  };
  const out = clean(js) as Record<string, unknown>;
  if (!out.properties) out.properties = {};
  return out;
}

const text = (t: string, details?: unknown): AgentToolResult<unknown> => ({ content: [{ type: 'text', text: t }], details: details ?? null });

/** 一个 Jobs 工具 → AgentTool。overrides 可以替换某个工具的执行（例如 wait_for_people 改成在后台等） */
export function adaptTool(t: JobsTool, api: ToolApi, override?: (args: Record<string, unknown>, signal?: AbortSignal) => Promise<string>): AgentTool<object> {
  return {
    name: t.name, label: t.label ?? t.name, description: t.description, parameters: paramsOf(t.input),
    executionMode: t.admin ? 'sequential' : undefined,
    execute: async (_id, params, signal) => text(override ? await override(params as Record<string, unknown>, signal) : await t.run(params as Record<string, unknown>, { api, signal }), { label: t.label ?? t.name }),
  };
}

/** 这个角色能用的 Jobs 工具 */
export const toolsFor = (tools: JobsTool[], role: Role) => tools.filter((t) => role === 'admin' || !t.admin);

/** 对话里才有的工具，由 hub 注入回调 */
export function conversationTools(h: { showEvidence: (id: string, caption?: string) => void; enterResident: (person: string) => Promise<string> }): AgentTool<object>[] {
  return [
    {
      name: 'show_evidence', label: '给你看截图',
      description: '把一张证据截图直接给用户看（工具结果里出现的 evidence_id / screenshot）。用户在手机上看不到网页时最有用；每次回答最多给 2 张，挑最能说明问题的那一刻。',
      parameters: paramsOf({ evidence_id: z.string(), caption: z.string().optional().describe('一句说明，例如「赵红梅放弃前看到的那一屏」') }),
      execute: async (_id, p) => { const a = p as { evidence_id: string; caption?: string }; h.showEvidence(a.evidence_id, a.caption); return text('已经给用户看了这张截图。'); },
    },
    {
      name: 'talk_to_resident', label: '去跟居民聊',
      description: '让用户直接跟城里的某位居民连续聊天（不是你转述）：之后用户说的话会直接交给这位居民，她带着自己的记忆和此刻的处境回答；用户说「结束」就回到你这里。用户说「让我跟某某聊聊」「我想问问某某」时用。',
      parameters: paramsOf({ person: z.string().describe('名字或 persona_id') }),
      execute: async (_id, p) => text(await h.enterResident((p as { person: string }).person), null),
    },
  ];
}
