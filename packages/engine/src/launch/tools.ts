// 给 coding agent 的 MCP 工具，只定义一次：本机的 stdio 服务（jobsworld mcp）和远程的 /mcp 都注册这一份。
// 工具只通过 REST 接口工作（api 由调用方给出：命令行用 HTTP，远程 /mcp 在进程内转发并带上这次授权的身份），
// 所以权限检查只在接口那一层。这里不碰数据库，也不依赖 MCP SDK。
import { z } from '@pux/core';
import { MORE_TOOLS } from './tools-more.ts';
import { cleanReason, funnelLine, reportText, type EngineeringView, type LaunchView, type ReportView } from './text.ts';

export type ToolApi = <T = unknown>(path: string, opts?: { method?: string; body?: unknown; timeoutMs?: number }) => Promise<T>;
export interface ToolCtx { api: ToolApi; signal?: AbortSignal; progress?: (done: number, total: number, message: string) => Promise<void> }
export interface JobsTool {
  name: string; description: string; input: z.ZodRawShape;
  /** 需要管理员身份（发布、宣发、递手机、标版本）。访客授权的连接看不到这些工具 */
  admin: boolean;
  /** 界面上显示的一步（飞书卡片、网页聊天面板）：「看产品状况」 */
  label?: string;
  /** 破坏性：Jobs Agent 执行前要用户点「确认」（清零、下线） */
  danger?: boolean;
  run: (args: Record<string, unknown>, ctx: ToolCtx) => Promise<string>;
}

interface Use { session_id: string; persona_id: string; name: string; occupation: string; age: number; status: string; outcome: string | null; end_reason: string | null; where: string | null; channel: string | null; invited: boolean; started_at: string | null }
type Detail = LaunchView & { uses: Use[]; passersby: { name: string; channel: string; reaction: string; thought: string | null }[] };
const ACTIVE = new Set(['planned', 'running']);
const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((res) => { const t = setTimeout(res, ms); signal?.addEventListener('abort', () => { clearTimeout(t); res(); }, { once: true }); });
const useLine = (u: Use) => `  · ${u.name}（${u.age} 岁，${u.occupation}）${u.where ? `在「${u.where}」` : ''}${u.invited ? '【受邀】' : ''}：${u.status === 'running' ? '正在用' : u.status === 'planned' ? '排队中（决定要用了，还没轮到，不算在用）' : u.status === 'waiting_human' ? '卡在需要人介入的地方（例如验证码），在网页的「接管」里处理' : `${u.outcome ?? u.status}${cleanReason(u.end_reason) ? ` — ${cleanReason(u.end_reason).slice(0, 80)}` : ''}`}  [persona_id=${u.persona_id}]`;
const launchOf = (api: ToolApi, product: unknown) => api<LaunchView>(`/launches/${encodeURIComponent(String(product))}`);

const BASE_TOOLS: JobsTool[] = [
  {
    name: 'publish_product', admin: true, label: '发布产品',
    description: '把一个产品发布到 JobsWorld（一座住着约两百位虚拟居民的城）。发布后，城里的人会在应用商店、广告、朋友口中遇到它，自己决定看不看、用不用。产品地址必须是 Jobs 服务能打开的真实地址：Jobs 在云端时，localhost 和内网地址都打不开，请先把产品部署到公网（预览环境也可以）。同一个产品改了代码不要重复发布，用 mark_new_version 标一下新版本。返回发布的 id。',
    input: { name: z.string().describe('产品名'), tagline: z.string().describe('一句话介绍（商店页和广告上显示的那句话）'), url: z.string().describe('产品地址，例如 https://my-app.example.com/'), landing_url: z.string().optional().describe('官网或落地页地址（可选）'), description: z.string().optional().describe('商店页上的介绍（可选）'), ad_text: z.string().optional().describe('广告文案（可选，不填用一句话介绍）'), intensity: z.number().min(0).max(1).optional().describe('宣发强度 0–1：0.1 悄悄上线，0.5 正常投放，1 全城铺开。默认 0.3'), form: z.enum(['web', 'h5']).optional().describe('web：电脑和手机都能开；h5：只在手机上开'), audience: z.object({ locales: z.array(z.enum(['zh-CN', 'en-US'])).optional(), age_min: z.number().optional(), age_max: z.number().optional(), segments: z.array(z.string()).optional().describe('人群：office_worker、senior、student、teen、professional、blue_collar、service_worker、freelancer、homemaker、job_seeker'), occupations: z.array(z.string()).optional().describe('职业关键词，例如「大学生」「工程师」「研究生」；职业里含这个词的人算投放对象') }).optional().describe('投给谁（可选）：广告和宣发主要触达这些人，其余的人也可能自然遇到，只是少得多；不填就是所有人') },
    run: async (a, { api }) => { const l = await api<LaunchView>('/launches', { body: a }); return `已发布「${l.name}」，id=${l.id}。\n城里的人接下来会陆续遇到它（需要一些时间）。用 product_status 看进展；想马上得到反馈，用 invite_people 把手机递给几个人，再用 wait_for_people 等他们用完。`; },
  },
  {
    name: 'list_products', admin: false, label: '看已发布的产品', description: '列出已发布到 JobsWorld 的产品和各自的漏斗人数。', input: {},
    run: async (_a, { api }) => { const ls = await api<LaunchView[]>('/launches'); return ls.length ? ls.map((l) => `${l.id}  ${l.name}（${l.status}，宣发 ${Math.round(l.intensity * 100)}%）\n  ${funnelLine(l.funnel)}`).join('\n') : '还没有发布过产品。'; },
  },
  {
    name: 'product_status', admin: false, label: '看产品状况',
    description: '一个产品此刻在城里的状况：多少人看到、注意到、有兴趣、打开过、回来再用，谁正在用，路过的人怎么想。数字是这座城里实际发生的人数（模拟），不是对真实市场的预测。',
    input: { product: z.string().describe('发布 id 或产品名') },
    run: async ({ product }, { api }) => {
      const d = await api<Detail & { spend: { usd: number } }>(`/launches/${encodeURIComponent(String(product))}`);
      const pass = d.passersby.slice(0, 10).map((p) => `  · ${p.name}（${p.channel}）：${p.thought ?? p.reaction}`).join('\n');
      // 此刻在用（已经开始、还没结束）单独列在最前面；排队的只给人数，不算在用
      const now = d.uses.filter((u) => u.status === 'running' || u.status === 'waiting_human');
      const queued = d.uses.filter((u) => u.status === 'planned').length;
      const past = d.uses.filter((u) => !['running', 'waiting_human', 'planned'].includes(u.status));
      return `${d.name}（${d.status}，宣发 ${Math.round(d.intensity * 100)}%，模型费用约 $${d.spend.usd}（居民思考和使用花的，不是宣发花费））\n${funnelLine(d.funnel)}\n\n此刻在用：\n${now.map(useLine).join('\n') || '  此刻没人在用'}${queued ? `\n  （另有 ${queued} 人排队，还没开始：同时最多跑几个使用，前面的用完才轮到；等太久可以用 cancel_invites 撤掉）` : ''}\n\n用过的人：\n${past.slice(0, 15).map(useLine).join('\n') || '  还没有人用完过'}\n\n看到了没点开的人：\n${pass || '  —'}`;
    },
  },
  {
    name: 'product_report', admin: false, label: '取一页结论',
    description: '取回一页结论：这个产品好不好用、最让人难受的地方、让人高兴的地方、谁会留下谁会走、看到的人为什么没点开、最该改的一件事。每条都带当事人的原话。同时返回可据此修改代码的问题清单（虚拟人亲身遇到的问题含复现步骤；标过新版本时，注明每个问题在新版本里还有没有出现）和工程附录（无障碍扫描、接口错误等用户看不到的技术信号）。归纳要几分钟：素材变了时会先给上一版并在后台重写。',
    input: { product: z.string().describe('发布 id 或产品名'), refresh: z.boolean().optional().describe('强制重新归纳结论（会等它写完，可能要几分钟）') },
    run: async ({ product, refresh }, { api, signal }) => {
      const l = await launchOf(api, product);
      let r = await api<ReportView>(`/launches/${l.id}/report${refresh ? '?force=1' : ''}`, { timeoutMs: 600_000 });
      // 有新的使用、新的一版在后台写：最多等 2 分钟拿新版，别让调用方拿着旧结论自己猜什么时候完整
      for (let i = 0; r.refreshing && i < 12 && !signal?.aborted; i++) { await sleep(10_000, signal); r = await api<ReportView>(`/launches/${l.id}/report`, { timeoutMs: 120_000 }); }
      const eng = await api<EngineeringView>(`/launches/${l.id}/engineering`);
      return reportText(l, r, eng);
    },
  },
  {
    name: 'set_promotion', admin: true, label: '调宣发 / 改商店页',
    description: '调节宣发（强度 0–1、暂停、恢复、结束、投给谁），也可以修改已发布产品的商店页信息：一句话介绍 tagline、商店页介绍 description、落地页 landing_url、广告文案 ad_text（发布后写错了不用删了重发）。只传要改的字段，没传的保持原样，不会被改动。',
    input: { product: z.string(), intensity: z.number().min(0).max(1).optional().describe('只有明确要改强度时才传'), status: z.enum(['live', 'paused', 'ended']).optional(), ad_text: z.string().optional(), tagline: z.string().optional(), description: z.string().optional(), landing_url: z.string().optional(), audience: z.object({ locales: z.array(z.enum(['zh-CN', 'en-US'])).optional(), age_min: z.number().optional(), age_max: z.number().optional(), segments: z.array(z.string()).optional().describe('人群：office_worker、senior、student、teen、professional、blue_collar、service_worker、freelancer、homemaker、job_seeker'), occupations: z.array(z.string()).optional().describe('职业关键词，例如「大学生」「工程师」「研究生」；职业里含这个词的人算投放对象') }).optional().describe('投给谁（可选）：广告和宣发主要触达这些人，其余的人也可能自然遇到，只是少得多；不填就是所有人') },
    run: async ({ product, ...patch }, { api }) => {
      const l = await launchOf(api, product); const o = await api<LaunchView & { audience?: Record<string, unknown> }>(`/launches/${l.id}/promotion`, { body: patch });
      const changed = Object.keys(patch).filter((k) => patch[k] !== undefined).join('、') || '（没有传要改的字段）';
      const aud = o.audience && Object.keys(o.audience).length ? `；投给：${JSON.stringify(o.audience)}` : '；投给所有人';
      return `「${o.name}」现在：${o.status}，宣发强度 ${Math.round(o.intensity * 100)}%${aud}。这次改了：${changed}。`;
    },
  },
  {
    name: 'invite_people', admin: true, label: '把手机递给人',
    description: '把手机递给城里的几个人，请他们现在就试试这个产品（不等他们自己遇到）。受邀的使用会单独标注。可以指定人群和语言。之后用 wait_for_people 等他们用完，再用 product_report 取回结论。',
    input: { product: z.string(), n: z.number().int().min(1).max(20).optional().describe('请几个人，默认 3'), segment: z.string().optional().describe('人群：office_worker、senior、student、teen、professional、blue_collar、service_worker、freelancer、homemaker、job_seeker'), locale: z.enum(['zh-CN', 'en-US']).optional().describe('语言。不填时按产品的语言挑（中文产品只请说中文的人）'), query: z.string().optional().describe('名字、职业、地区、经历里的关键词，例如「大学生」「工程师」「研究生」'), min_age: z.number().optional(), max_age: z.number().optional(), want: z.string().optional().describe('（可选）希望他们用它做的一件事，用生活里的话说，例如「记一下今天花了多少钱」'), persona_ids: z.array(z.string()).optional().describe('（可选）指定请谁：find_people 找到的 persona_id；给了就不再按人群挑') },
    run: async ({ product, ...b }, { api }) => {
      const l = await launchOf(api, product);
      const o = await api<{ invited: number; session_ids?: string[]; people?: { id: string; name: string; session_id: string }[]; skipped?: { name: string; reason: string }[]; matched?: number; notes?: string[] }>(`/launches/${l.id}/invite`, { body: b });
      const lines = [`已请 ${o.invited} 个人试用「${l.name}」（符合条件的共 ${o.matched ?? '?'} 人）。每个人大约需要几分钟。`];
      if (o.people?.length) lines.push(`请到的人：${o.people.map((p) => `${p.name}[persona_id=${p.id}]`).join('、')}`);
      if (o.skipped?.length) lines.push(`没请成：${o.skipped.map((p) => `${p.name}（${p.reason}）`).join('；')}`);
      for (const n of o.notes ?? []) lines.push(`说明：${n}`);
      if (o.session_ids?.length) lines.push(`session_ids：${o.session_ids.join(', ')}（交给 wait_for_people 等他们用完；想撤掉用 cancel_invites）`);
      return lines.join('\n');
    },
  },
  {
    name: 'cancel_invites', admin: true, label: '取消试用',
    description: '取消还没开始（排队中）或正在进行的使用，卡住时用。不指定 session_ids 就取消这个产品所有排队中的使用。被取消的使用不算人数、不留评论和口碑。',
    input: { product: z.string(), session_ids: z.array(z.string()).optional().describe('要取消的使用（product_status、invite_people 里的 session_id）') },
    run: async ({ product, session_ids }, { api }) => { const l = await launchOf(api, product); const o = await api<{ cancelled: number }>(`/launches/${l.id}/cancel`, { body: { session_ids, all_queued: !(Array.isArray(session_ids) && session_ids.length) } }); return `已取消 ${o.cancelled} 次使用。`; },
  },
  {
    name: 'wait_for_people', admin: false, label: '等人用完',
    description: '等受邀试用的人用完（不用反复调 product_status）。默认等这个产品所有还没用完的受邀使用；也可以只等 invite_people 返回的那几个 session。一次最多等 3 分钟（默认 2 分钟，避免连接被中途断掉），到时还没用完就返回当前进度和每个人用到哪了，再调一次接着等；断了也不丢：随时可以用 product_status 看进度。',
    input: { product: z.string().describe('发布 id 或产品名'), session_ids: z.array(z.string()).optional().describe('只等这几次使用（invite_people 返回的 session_ids）'), max_minutes: z.number().min(0.2).max(3).optional().describe('最多等几分钟，默认 2，最多 3') },
    run: async ({ product, session_ids, max_minutes }, { api, signal, progress }) => {
      const ids = Array.isArray(session_ids) && session_ids.length ? new Set(session_ids.map(String)) : null;
      const deadline = Date.now() + Math.min(3, Number(max_minutes ?? 2)) * 60_000;
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
          const head = !pending.length ? `${mine.length} 次使用都结束了${stuck.length ? `（其中 ${stuck.length} 次在等人介入）` : ''}。接下来用 product_report 取回结论和问题清单。` : `等了 ${Math.min(3, Number(max_minutes ?? 2))} 分钟，还有 ${pending.length} 人没用完（${mine.length - pending.length}/${mine.length}）。可以再调一次 wait_for_people 接着等。`;
          return `${d.name}：${head}\n${mine.map(useLine).join('\n')}`;
        }
        await sleep(10_000, signal);
      }
    },
  },
  {
    name: 'mark_new_version', admin: true, label: '标记新版本',
    description: '告诉 JobsWorld「我改好了，线上已经是新版本」。之后开始的使用算新版本；product_report 的问题清单会注明每个问题在新版本里还有没有出现。产品地址不变时不用重新发布。先把修复部署上线，再调这个工具，然后用 invite_people 请人再试一轮。',
    input: { product: z.string().describe('发布 id 或产品名'), note: z.string().optional().describe('这一版改了什么，例如「修复：退出后笔记丢失」') },
    run: async ({ product, note }, { api }) => { const l = await launchOf(api, product); const v = await api<{ n: number }>(`/launches/${l.id}/versions`, { body: { note } }); return `「${l.name}」已标记为第 ${v.n} 版。接下来用 invite_people 请人试新版本，wait_for_people 等他们用完，再用 product_report 看问题还在不在。`; },
  },
  {
    name: 'reset_product', admin: true, label: '清零', danger: true,
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
    name: 'remove_product', admin: true, label: '下线', danger: true,
    description: '让一个产品下线：从城里拿掉（同名产品发布过的每一版），商店、广告、熟人的念头里都不再有它，list_products 里也没有了；正在用它的人会被停下来。默认保留城里的经历（用过的人还记得它，同名产品以后再发布时居民认得它）；wipe_history=true 时连同使用过程、评论、动态、居民的记忆一起删掉，就像从没发布过。',
    input: { product: z.string().describe('发布 id 或产品名'), wipe_history: z.boolean().optional().describe('连同城里的经历一起删除。默认 false：保留') },
    run: async ({ product, wipe_history }, { api }) => {
      const l = await launchOf(api, product);
      const o = await api<{ kept: boolean; sessions: number; reviews: number; posts: number; memories: number; people: number }>(`/launches/${l.id}${wipe_history ? '?history=delete' : ''}`, { method: 'DELETE', timeoutMs: 300_000 });
      return o.kept ? `「${l.name}」已下线，城里的经历保留（作废了 ${o.sessions} 次没用完的使用）。` : `「${l.name}」已下线，经历一起删除：${o.sessions} 次使用、${o.reviews} 条评论、${o.posts} 条动态，${o.people} 位居民忘掉了它（${o.memories} 条记忆）。`;
    },
  },
  {
    name: 'ask_person', admin: false, label: '追问居民',
    description: '向一位用过产品的虚拟居民追问（例如「你刚才为什么关掉了？」）。基于他最近一次已结束的使用来回答。',
    input: { persona_id: z.string().describe('人物 id（见 product_status、wait_for_people 列出的 persona_id）'), question: z.string() },
    run: async ({ persona_id, question }, { api }) => { const o = await api<{ answer: string | null; busy?: boolean; none?: boolean }>('/world/ask', { body: { persona_id, question } }); return o.busy ? '他正在使用产品，等这次用完再问。' : o.none ? '他还没有用过任何产品。' : String(o.answer); },
  },
  {
    name: 'person_inbox', admin: false, label: '看居民的收件箱',
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

export const JOBS_TOOLS: JobsTool[] = [...BASE_TOOLS, ...MORE_TOOLS];

export const MCP_INSTRUCTIONS = 'JobsWorld 是一座住着约两百位虚拟居民的城。把真实可访问的产品发布进来（publish_product），城里的人会自己遇到、决定用不用；想马上得到反馈就 invite_people 请几个人试，wait_for_people 等他们用完，product_report 取回结论和带复现步骤的问题清单。改好并上线后 mark_new_version，再请人试一轮，看问题还在不在。想从一张白纸重来用 reset_product，不再需要时用 remove_product 下线。问题清单用 list_issues / issue_detail 细看，compare_versions 看修好了没有，fix_task 把一个问题写成修复任务、open_github_issue 开成 GitHub issue（关闭后 Jobs 自动标新版本并请人验证）；find_people 按画像找人、person_profile 看一个人、town_now 看城里此刻。人数是这座城里实际发生的（模拟），不是对真实市场的预测。';
