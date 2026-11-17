// 给 coding agent 的 MCP 工具，只定义一次：本机的 stdio 服务（jobsworld mcp）和远程的 /mcp 都注册这一份。
// 工具只通过 REST 接口工作（api 由调用方给出：命令行用 HTTP，远程 /mcp 在进程内转发并带上这次授权的身份），
// 所以权限检查只在接口那一层。这里不碰数据库，也不依赖 MCP SDK。
import { z } from '@pux/core';
import { funnelLine, reportText, type EngineeringView, type LaunchView, type ReportView } from './text.ts';

export type ToolApi = <T = unknown>(path: string, opts?: { method?: string; body?: unknown; timeoutMs?: number }) => Promise<T>;
export interface ToolCtx { api: ToolApi; signal?: AbortSignal; progress?: (done: number, total: number, message: string) => Promise<void> }
export interface JobsTool {
  name: string; description: string; input: z.ZodRawShape;
  /** 需要管理员身份（发布、宣发、递手机、标版本）。访客授权的连接看不到这些工具 */
  admin: boolean;
  run: (args: Record<string, unknown>, ctx: ToolCtx) => Promise<string>;
}

interface Use { session_id: string; persona_id: string; name: string; occupation: string; age: number; status: string; outcome: string | null; end_reason: string | null; where: string | null; channel: string | null; invited: boolean; started_at: string | null }
type Detail = LaunchView & { uses: Use[]; passersby: { name: string; channel: string; reaction: string; thought: string | null }[] };
const ACTIVE = new Set(['planned', 'running']);
const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((res) => { const t = setTimeout(res, ms); signal?.addEventListener('abort', () => { clearTimeout(t); res(); }, { once: true }); });
const useLine = (u: Use) => `  · ${u.name}（${u.age} 岁，${u.occupation}）${u.where ? `在「${u.where}」` : ''}${u.invited ? '【受邀】' : ''}：${u.status === 'running' ? '正在用' : u.status === 'planned' ? '排队中（决定要用了，还没轮到，不算在用）' : u.status === 'waiting_human' ? '卡在需要人介入的地方（例如验证码），在网页的「接管」里处理' : `${u.outcome ?? u.status}${u.end_reason ? ` — ${u.end_reason.slice(0, 80)}` : ''}`}  [persona_id=${u.persona_id}]`;
const launchOf = (api: ToolApi, product: unknown) => api<LaunchView>(`/launches/${encodeURIComponent(String(product))}`);

export const JOBS_TOOLS: JobsTool[] = [
  {
    name: 'publish_product', admin: true,
    description: '把一个产品发布到 JobsWorld（一座住着约两百位虚拟居民的城）。发布后，城里的人会在应用商店、广告、朋友口中遇到它，自己决定看不看、用不用。产品地址必须是 Jobs 服务能打开的真实地址：Jobs 在云端时，localhost 和内网地址都打不开，请先把产品部署到公网（预览环境也可以）。同一个产品改了代码不要重复发布，用 mark_new_version 标一下新版本。返回发布的 id。',
    input: { name: z.string().describe('产品名'), tagline: z.string().describe('一句话介绍（商店页和广告上显示的那句话）'), url: z.string().describe('产品地址，例如 https://my-app.example.com/'), landing_url: z.string().optional().describe('官网或落地页地址（可选）'), description: z.string().optional().describe('商店页上的介绍（可选）'), ad_text: z.string().optional().describe('广告文案（可选，不填用一句话介绍）'), intensity: z.number().min(0).max(1).optional().describe('宣发强度 0–1：0.1 悄悄上线，0.5 正常投放，1 全城铺开。默认 0.3'), form: z.enum(['web', 'h5']).optional().describe('web：电脑和手机都能开；h5：只在手机上开') },
    run: async (a, { api }) => { const l = await api<LaunchView>('/launches', { body: a }); return `已发布「${l.name}」，id=${l.id}。\n城里的人接下来会陆续遇到它（需要一些时间）。用 product_status 看进展；想马上得到反馈，用 invite_people 把手机递给几个人，再用 wait_for_people 等他们用完。`; },
  },
  {
    name: 'list_products', admin: false, description: '列出已发布到 JobsWorld 的产品和各自的漏斗人数。', input: {},
    run: async (_a, { api }) => { const ls = await api<LaunchView[]>('/launches'); return ls.length ? ls.map((l) => `${l.id}  ${l.name}（${l.status}，宣发 ${Math.round(l.intensity * 100)}%）\n  ${funnelLine(l.funnel)}`).join('\n') : '还没有发布过产品。'; },
  },
  {
    name: 'product_status', admin: false,
    description: '一个产品此刻在城里的状况：多少人看到、注意到、有兴趣、打开过、回来再用，谁正在用，路过的人怎么想。数字是这座城里实际发生的人数（模拟），不是对真实市场的预测。',
    input: { product: z.string().describe('发布 id 或产品名') },
    run: async ({ product }, { api }) => {
      const d = await api<Detail & { spend: { usd: number } }>(`/launches/${encodeURIComponent(String(product))}`);
      const pass = d.passersby.slice(0, 10).map((p) => `  · ${p.name}（${p.channel}）：${p.thought ?? p.reaction}`).join('\n');
      // 此刻在用（已经开始、还没结束）单独列在最前面；排队的只给人数，不算在用
      const now = d.uses.filter((u) => u.status === 'running' || u.status === 'waiting_human');
      const queued = d.uses.filter((u) => u.status === 'planned').length;
      const past = d.uses.filter((u) => !['running', 'waiting_human', 'planned'].includes(u.status));
      return `${d.name}（${d.status}，宣发 ${Math.round(d.intensity * 100)}%，已花费约 $${d.spend.usd}）\n${funnelLine(d.funnel)}\n\n此刻在用：\n${now.map(useLine).join('\n') || '  此刻没人在用'}${queued ? `\n  （另有 ${queued} 人排队，还没开始）` : ''}\n\n用过的人：\n${past.slice(0, 15).map(useLine).join('\n') || '  还没有人用完过'}\n\n看到了没点开的人：\n${pass || '  —'}`;
    },
  },
  {
    name: 'product_report', admin: false,
    description: '取回一页结论：这个产品好不好用、最让人难受的地方、让人高兴的地方、谁会留下谁会走、看到的人为什么没点开、最该改的一件事。每条都带当事人的原话。同时返回可据此修改代码的问题清单（虚拟人亲身遇到的问题含复现步骤；标过新版本时，注明每个问题在新版本里还有没有出现）和工程附录（无障碍扫描、接口错误等用户看不到的技术信号）。归纳要几分钟：素材变了时会先给上一版并在后台重写。',
    input: { product: z.string().describe('发布 id 或产品名'), refresh: z.boolean().optional().describe('强制重新归纳结论（会等它写完，可能要几分钟）') },
    run: async ({ product, refresh }, { api }) => {
      const l = await launchOf(api, product);
      const r = await api<ReportView & { refreshing?: boolean }>(`/launches/${l.id}/report${refresh ? '?force=1' : ''}`, { timeoutMs: 600_000 });
      const eng = await api<EngineeringView>(`/launches/${l.id}/engineering`);
      return (r.refreshing ? '（这是上一版结论；有新的使用，新的一版正在后台归纳，几分钟后再取）\n\n' : '') + reportText(l, r, eng);
    },
  },
  {
    name: 'set_promotion', admin: true, description: '调节宣发：强度（0–1）、暂停、恢复或结束一次发布。',
    input: { product: z.string(), intensity: z.number().min(0).max(1).optional(), status: z.enum(['live', 'paused', 'ended']).optional(), ad_text: z.string().optional() },
    run: async ({ product, ...patch }, { api }) => { const l = await launchOf(api, product); const o = await api<LaunchView>(`/launches/${l.id}/promotion`, { body: patch }); return `「${o.name}」现在：${o.status}，宣发强度 ${Math.round(o.intensity * 100)}%。`; },
  },
  {
    name: 'invite_people', admin: true,
    description: '把手机递给城里的几个人，请他们现在就试试这个产品（不等他们自己遇到）。受邀的使用会单独标注。可以指定人群和语言。之后用 wait_for_people 等他们用完，再用 product_report 取回结论。',
    input: { product: z.string(), n: z.number().int().min(1).max(20).optional().describe('请几个人，默认 3'), segment: z.string().optional().describe('人群：office_worker、senior、student、teen、professional、blue_collar、service_worker、freelancer、homemaker、job_seeker'), locale: z.enum(['zh-CN', 'en-US']).optional(), want: z.string().optional().describe('（可选）希望他们用它做的一件事，用生活里的话说，例如「记一下今天花了多少钱」') },
    run: async ({ product, ...b }, { api }) => { const l = await launchOf(api, product); const o = await api<{ invited: number; session_ids?: string[] }>(`/launches/${l.id}/invite`, { body: b }); return `已请 ${o.invited} 个人试用「${l.name}」。每个人大约需要几分钟。${o.session_ids?.length ? `\nsession_ids：${o.session_ids.join(', ')}（交给 wait_for_people 就能等到他们用完）` : ''}`; },
  },
  {
    name: 'wait_for_people', admin: false,
    description: '等受邀试用的人用完（不用反复调 product_status）。默认等这个产品所有还没用完的受邀使用；也可以只等 invite_people 返回的那几个 session。最多等 max_minutes 分钟，到时还没用完就返回当前进度，可以再调一次接着等。',
    input: { product: z.string().describe('发布 id 或产品名'), session_ids: z.array(z.string()).optional().describe('只等这几次使用（invite_people 返回的 session_ids）'), max_minutes: z.number().min(0.5).max(15).optional().describe('最多等几分钟，默认 5') },
    run: async ({ product, session_ids, max_minutes }, { api, signal, progress }) => {
      const ids = Array.isArray(session_ids) && session_ids.length ? new Set(session_ids.map(String)) : null;
      const deadline = Date.now() + Number(max_minutes ?? 5) * 60_000;
      let watch: Set<string> | null = ids;
      for (;;) {
        const d = await api<Detail>(`/launches/${encodeURIComponent(String(product))}`);
        // 没指定时：开始等的那一刻还没用完的受邀使用
        watch ??= new Set(d.uses.filter((u) => u.invited && (ACTIVE.has(u.status) || u.status === 'waiting_human')).map((u) => u.session_id));
        const mine = d.uses.filter((u) => watch!.has(u.session_id));
        const pending = mine.filter((u) => ACTIVE.has(u.status));
        const stuck = mine.filter((u) => u.status === 'waiting_human');
        if (!mine.length) return `「${d.name}」现在没有正在进行的受邀使用。先用 invite_people 请几个人。`;
        await progress?.(mine.length - pending.length, mine.length, `${mine.length - pending.length}/${mine.length} 人用完`);
        if (!pending.length || Date.now() >= deadline || signal?.aborted) {
          const head = !pending.length ? `${mine.length} 次使用都结束了${stuck.length ? `（其中 ${stuck.length} 次在等人介入）` : ''}。接下来用 product_report 取回结论和问题清单。` : `等了 ${max_minutes ?? 5} 分钟，还有 ${pending.length} 人没用完（${mine.length - pending.length}/${mine.length}）。可以再调一次 wait_for_people 接着等。`;
          return `${d.name}：${head}\n${mine.map(useLine).join('\n')}`;
        }
        await sleep(10_000, signal);
      }
    },
  },
  {
    name: 'mark_new_version', admin: true,
    description: '告诉 JobsWorld「我改好了，线上已经是新版本」。之后开始的使用算新版本；product_report 的问题清单会注明每个问题在新版本里还有没有出现。产品地址不变时不用重新发布。先把修复部署上线，再调这个工具，然后用 invite_people 请人再试一轮。',
    input: { product: z.string().describe('发布 id 或产品名'), note: z.string().optional().describe('这一版改了什么，例如「修复：退出后笔记丢失」') },
    run: async ({ product, note }, { api }) => { const l = await launchOf(api, product); const v = await api<{ n: number }>(`/launches/${l.id}/versions`, { body: { note } }); return `「${l.name}」已标记为第 ${v.n} 版。接下来用 invite_people 请人试新版本，wait_for_people 等他们用完，再用 product_report 看问题还在不在。`; },
  },
  {
    name: 'reset_product', admin: true,
    description: '把一个产品在城里的经历全部清零：谁见过它、用过它、说过什么，评论、动态、居民对它的记忆与信任、问题清单和一页结论都归零（同名产品发布过的每一版都算）。产品本身（地址、介绍、商店截图、宣发设置）不动，此刻重新上线、花费归零，等于第一次发布。正在用它的人会被停下来。想在大改之后从一张白纸重新看反应时用；只是修了问题、想对比修复前后，用 mark_new_version。',
    input: { product: z.string().describe('发布 id 或产品名') },
    run: async ({ product }, { api }) => {
      const l = await launchOf(api, product);
      const o = await api<LaunchView & { cleared: Record<string, number> }>(`/launches/${l.id}/reset`, { body: {}, timeoutMs: 300_000 });
      const c = o.cleared ?? {};
      return `「${o.name}」已清零并重新上线（id=${o.id}）。清掉了 ${c.sessions ?? 0} 次使用、${c.exposures ?? 0} 次曝光、${c.reviews ?? 0} 条评论、${c.posts ?? 0} 条动态；${c.people ?? 0} 位居民忘掉了它（${c.memories ?? 0} 条记忆）。城里的人会重新遇到它，也可以用 invite_people 马上请人试。`;
    },
  },
  {
    name: 'remove_product', admin: true,
    description: '让一个产品下线：从城里拿掉（同名产品发布过的每一版），商店、广告、熟人的念头里都不再有它，list_products 里也没有了；正在用它的人会被停下来。默认保留城里的经历（用过的人还记得它，同名产品以后再发布时居民认得它）；wipe_history=true 时连同使用过程、评论、动态、居民的记忆一起删掉，就像从没发布过。',
    input: { product: z.string().describe('发布 id 或产品名'), wipe_history: z.boolean().optional().describe('连同城里的经历一起删除。默认 false：保留') },
    run: async ({ product, wipe_history }, { api }) => {
      const l = await launchOf(api, product);
      const o = await api<{ kept: boolean; sessions: number; reviews: number; posts: number; memories: number; people: number }>(`/launches/${l.id}${wipe_history ? '?history=delete' : ''}`, { method: 'DELETE', timeoutMs: 300_000 });
      return o.kept ? `「${l.name}」已下线，城里的经历保留（作废了 ${o.sessions} 次没用完的使用）。` : `「${l.name}」已下线，经历一起删除：${o.sessions} 次使用、${o.reviews} 条评论、${o.posts} 条动态，${o.people} 位居民忘掉了它（${o.memories} 条记忆）。`;
    },
  },
  {
    name: 'ask_person', admin: false,
    description: '向一位用过产品的虚拟居民追问（例如「你刚才为什么关掉了？」）。基于他最近一次已结束的使用来回答。',
    input: { persona_id: z.string().describe('人物 id（见 product_status、wait_for_people 列出的 persona_id）'), question: z.string() },
    run: async ({ persona_id, question }, { api }) => { const o = await api<{ answer: string | null; busy?: boolean; none?: boolean }>('/world/ask', { body: { persona_id, question } }); return o.busy ? '他正在使用产品，等这次用完再问。' : o.none ? '他还没有用过任何产品。' : String(o.answer); },
  },
  {
    name: 'person_inbox', admin: false,
    description: '看一位居民收到的邮件和短信（最新的在前）：产品发出的验证邮件有没有到、什么时候到、他有没有点开。排查「居民收不到验证码」时用。',
    input: { persona_id: z.string().describe('人物 id（见 product_status、wait_for_people 列出的 persona_id）') },
    run: async ({ persona_id }, { api }) => {
      const [st, rows] = await Promise.all([api<{ real: boolean; domain: string }>('/mail/status'), api<{ kind: string; sender: string | null; subject: string | null; body: string; opened_at: string | null; real: boolean; at: string }[]>(`/personas/${encodeURIComponent(String(persona_id))}/inbox`)]);
      const head = st.real ? `居民邮箱已开通（@${st.domain}），产品发出的真实邮件会进到这里。` : `居民邮箱还没开通：地址是 @${st.domain} 的假地址，真实产品的邮件到不了。到网页的「设置」里填公网链接并开通。`;
      if (!rows.length) return `${head}\n他还没有收到任何邮件或短信。`;
      return `${head}\n${rows.slice(0, 15).map((m) => `· ${new Date(m.at).toLocaleString('zh-CN', { hour12: false })} ${m.kind === 'sms' ? '短信' : '邮件'}${m.sender ? ` 来自 ${m.sender}` : ''}${m.subject ? `「${m.subject}」` : ''}${m.kind === 'email' ? (m.opened_at ? '（他点开看过）' : '（他没点开）') : ''}\n  ${m.body.replace(/\s+/g, ' ').slice(0, 240)}`).join('\n')}`;
    },
  },
];

export const MCP_INSTRUCTIONS = 'JobsWorld 是一座住着约两百位虚拟居民的城。把真实可访问的产品发布进来（publish_product），城里的人会自己遇到、决定用不用；想马上得到反馈就 invite_people 请几个人试，wait_for_people 等他们用完，product_report 取回结论和带复现步骤的问题清单。改好并上线后 mark_new_version，再请人试一轮，看问题还在不在。想从一张白纸重来用 reset_product，不再需要时用 remove_product 下线。人数是这座城里实际发生的（模拟），不是对真实市场的预测。';
