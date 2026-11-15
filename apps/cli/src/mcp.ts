// jobsworld mcp —— 给 coding agent（Claude Code、Codex、opencode…）用的 MCP 服务（stdio）。
// 写完代码就能把产品发布到 JobsWorld、看城里的人怎么对待它、取回结论和可据此修改的问题清单，然后继续改。
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { api, funnelLine, reportText, type EngineeringView, type LaunchView, type ReportView } from './client.ts';

const text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] });
const fail = (e: unknown) => ({ content: [{ type: 'text' as const, text: `出错：${String((e as Error).message ?? e)}` }], isError: true });
const safe = <A>(fn: (a: A) => Promise<ReturnType<typeof text>>) => async (a: A) => { try { return await fn(a); } catch (e) { return fail(e); } };

export async function runMcp() {
  const server = new McpServer({ name: 'jobs', version: '0.2.0' });

  server.registerTool('publish_product', {
    description: '把一个产品发布到 JobsWorld（一座住着约两百位虚拟居民的城）。发布后，城里的人会在应用商店、广告、朋友口中遇到它，自己决定看不看、用不用。产品必须有一个能从本机访问的网址（本地开发服务器也可以）。返回发布的 id。',
    inputSchema: { name: z.string().describe('产品名'), tagline: z.string().describe('一句话介绍（商店页和广告上显示的那句话）'), url: z.string().describe('产品地址，例如 http://127.0.0.1:3000/'), landing_url: z.string().optional().describe('官网或落地页地址（可选）'), description: z.string().optional().describe('商店页上的介绍（可选）'), ad_text: z.string().optional().describe('广告文案（可选，不填用一句话介绍）'), intensity: z.number().min(0).max(1).optional().describe('宣发强度 0–1：0.1 悄悄上线，0.5 正常投放，1 全城铺开。默认 0.3'), form: z.enum(['web', 'h5']).optional().describe('web：电脑和手机都能开；h5：只在手机上开') },
  }, safe(async (a) => { const l = await api<LaunchView>('/launches', { body: a }); return text(`已发布「${l.name}」，id=${l.id}。\n城里的人接下来会陆续遇到它（需要一些时间）。用 product_status 看进展；想马上得到反馈，用 invite_people 把手机递给几个人。`); }));

  server.registerTool('list_products', { description: '列出已发布到 JobsWorld 的产品和各自的漏斗人数。', inputSchema: {} },
    safe(async () => { const ls = await api<LaunchView[]>('/launches'); return text(ls.length ? ls.map((l) => `${l.id}  ${l.name}（${l.status}，宣发 ${Math.round(l.intensity * 100)}%）\n  ${funnelLine(l.funnel)}`).join('\n') : '还没有发布过产品。'); }));

  server.registerTool('product_status', {
    description: '一个产品此刻在城里的状况：多少人看到、注意到、有兴趣、打开过、回来再用，谁正在用，路过的人怎么想。数字是这座城里实际发生的人数（模拟），不是对真实市场的预测。',
    inputSchema: { product: z.string().describe('发布 id 或产品名') },
  }, safe(async ({ product }) => {
    const d = await api<LaunchView & { uses: { name: string; occupation: string; age: number; status: string; outcome: string | null; end_reason: string | null; where: string | null; channel: string | null; invited: boolean }[]; passersby: { name: string; channel: string; reaction: string; thought: string | null }[] }>(`/launches/${encodeURIComponent(product)}`);
    const uses = d.uses.slice(0, 15).map((u) => `  · ${u.name}（${u.age} 岁，${u.occupation}）${u.where ? `在「${u.where}」` : ''}${u.invited ? '【受邀】' : ''}：${u.status === 'running' ? '正在用' : `${u.outcome ?? u.status}${u.end_reason ? ` — ${u.end_reason.slice(0, 80)}` : ''}`}`).join('\n');
    const pass = d.passersby.slice(0, 10).map((p) => `  · ${p.name}（${p.channel}）：${p.thought ?? p.reaction}`).join('\n');
    return text(`${d.name}（${d.status}，宣发 ${Math.round(d.intensity * 100)}%，已花费约 $${d.spend.usd}）\n${funnelLine(d.funnel)}\n\n用过的人：\n${uses || '  还没有人打开过'}\n\n看到了没点开的人：\n${pass || '  —'}`);
  }));

  server.registerTool('product_report', {
    description: '取回一页结论：这个产品好不好用、最让人难受的地方、让人高兴的地方、谁会留下谁会走、看到的人为什么没点开、最该改的一件事。每条都带当事人的原话。同时返回可据此修改代码的问题清单（虚拟人亲身遇到的问题含复现步骤）和工程附录（无障碍扫描、接口错误等用户看不到的技术信号）。',
    inputSchema: { product: z.string().describe('发布 id 或产品名'), refresh: z.boolean().optional().describe('强制重新归纳结论') },
  }, safe(async ({ product, refresh }) => {
    const l = await api<LaunchView>(`/launches/${encodeURIComponent(product)}`);
    const r = await api<ReportView>(`/launches/${l.id}/report${refresh ? '?force=1' : ''}`, { timeoutMs: 300_000 });
    const eng = await api<EngineeringView>(`/launches/${l.id}/engineering`);
    return text(reportText(l, r, eng));
  }));

  server.registerTool('set_promotion', {
    description: '调节宣发：强度（0–1）、暂停、恢复或结束一次发布。',
    inputSchema: { product: z.string(), intensity: z.number().min(0).max(1).optional(), status: z.enum(['live', 'paused', 'ended']).optional(), ad_text: z.string().optional() },
  }, safe(async ({ product, ...patch }) => { const l = await api<LaunchView>(`/launches/${encodeURIComponent(product)}`); const o = await api<LaunchView>(`/launches/${l.id}/promotion`, { body: patch }); return text(`「${o.name}」现在：${o.status}，宣发强度 ${Math.round(o.intensity * 100)}%。`); }));

  server.registerTool('invite_people', {
    description: '把手机递给城里的几个人，请他们现在就试试这个产品（不等他们自己遇到）。受邀的使用会单独标注。可以指定人群和语言。几分钟后用 product_status / product_report 看结果。',
    inputSchema: { product: z.string(), n: z.number().int().min(1).max(20).optional().describe('请几个人，默认 3'), segment: z.string().optional().describe('人群：office_worker、senior、student、teen、professional、blue_collar、service_worker、freelancer、homemaker、job_seeker'), locale: z.enum(['zh-CN', 'en-US']).optional(), want: z.string().optional().describe('（可选）希望他们用它做的一件事，用生活里的话说，例如「记一下今天花了多少钱」') },
  }, safe(async ({ product, ...b }) => { const l = await api<LaunchView>(`/launches/${encodeURIComponent(product)}`); const o = await api<{ invited: number }>(`/launches/${l.id}/invite`, { body: b }); return text(`已请 ${o.invited} 个人试用「${l.name}」。每个人大约需要几分钟。`); }));

  server.registerTool('ask_person', {
    description: '向一位用过产品的虚拟居民追问（例如「你刚才为什么关掉了？」）。基于他最近一次已结束的使用来回答。',
    inputSchema: { persona_id: z.string().describe('人物 id（见 product_status 里的使用记录，或 people 列表）'), question: z.string() },
  }, safe(async ({ persona_id, question }) => { const o = await api<{ answer: string | null; busy?: boolean; none?: boolean }>('/world/ask', { body: { persona_id, question } }); return text(o.busy ? '他正在使用产品，等这次用完再问。' : o.none ? '他还没有用过任何产品。' : String(o.answer)); }));

  await server.connect(new StdioServerTransport());
}
