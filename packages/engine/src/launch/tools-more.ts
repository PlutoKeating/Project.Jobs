// 第二批工具（2026-11-17，飞书渠道重构时加的；MCP、命令行、Jobs Agent 共用）：
// 城里现在的情况、问题分诊与按版本对比、交给 coding agent、运维与设置。和 tools.ts 一样只经 REST 工作。
import { z } from '@pux/core';
import type { JobsTool, ToolApi } from './tools.ts';

interface PersonaRow { id: string; name: string; age: number; gender: string; occupation: string; region?: string; segment: string; locale: string; digital_literacy: number; ai_familiarity: number; sessions: number; apps: string[]; live: { place_id: string; activity: string; mode: string; app?: string } | null }
interface IssueRow { id: string; track: string; severity: string; title: string; category: string; status: string; where: string | null; people: number; sessions: number; sessions_since_version: number | null; github: { url: string; state: string } | null }
interface IssueDetail { id: string; launch_id: string | null; track: string; severity: string; title: string; description: string; status: string; where: string | null; recommendation: string | null; steps: string[]; reproduced: boolean | null; moments: { session_id: string; persona_id: string; name: string; who: string; outcome: string | null; quote: string | null; screenshot: string | null }[]; github: { url: string; state: string; number: number; verified_version: number | null } | null }

const SEG = 'office_worker、senior、student、teen、professional、blue_collar、service_worker、freelancer、homemaker、job_seeker';
const STATUS: Record<string, string> = { open: '待处理', confirmed: '确认要改', rejected: '不是问题', known: '已知（暂不改）' };
const OUT: Record<string, string> = { success: '办成了', gave_up: '放弃了', resource_exhausted: '没时间了', stalled: '卡住了', blocked: '被拦住了', sim_error: '模拟出错' };

/** 名字、id 都认；同名或包含关系时取第一个 */
export async function resolvePerson(api: ToolApi, ref: string): Promise<PersonaRow> {
  const all = await api<PersonaRow[]>('/personas');
  const r = ref.trim();
  const p = all.find((x) => x.id === r) ?? all.find((x) => x.name === r) ?? all.find((x) => x.name.includes(r) || r.includes(x.name));
  if (!p) throw new Error(`城里没有「${r}」这个人。可以用 find_people 按画像找`);
  return p;
}
const personLine = (p: PersonaRow) => `${p.name}（${p.age} 岁，${p.occupation}${p.region ? `，${p.region}` : ''}；${p.segment} · ${p.locale}；会用手机 ${Math.round(p.digital_literacy * 100)}%）${p.live ? ` — 此刻${p.live.app ? `正在用「${p.live.app}」` : p.live.activity}` : ''}  [persona_id=${p.id}]`;
const issueLine = (i: IssueRow) => `[${i.severity}] ${i.title}${i.where ? `  @${i.where}` : ''}（${i.people} 人、${i.sessions} 次${i.sessions_since_version != null ? `；最新版本里 ${i.sessions_since_version} 次` : ''}；${STATUS[i.status] ?? i.status}${i.github ? `；GitHub ${i.github.state === 'open' ? '开着' : '已关闭'}` : ''}）  [issue_id=${i.id}]`;

export const MORE_TOOLS: JobsTool[] = [
  // ---------------------------------------------------------------- 城里现在
  {
    name: 'town_now', admin: false, label: '看城里现在',
    description: '城里此刻的样子：世界时间、谁正在用哪个产品（在哪、用到哪一步）、各产品此刻在用和排队的人数、正在发生的事件（下雨、停电、弱网…）。',
    input: {},
    run: async (_a, { api }) => {
      const s = await api<{ clock: { clock: string; date: string; speed: number; paused: boolean }; personas: { id: string; name: string; occupation: string; age: number; place_id: string; activity: string; session?: { app: string; status: string; replay?: boolean; step_idx: number; monologue?: string } }[]; events: { place_id: string; kind: string }[] } | null>('/world/snapshot');
      if (!s) return '世界服务还没有发过快照（可能没在运行）。';
      const using = s.personas.filter((p) => p.session && !p.session.replay && ['running', 'waiting_human'].includes(p.session.status));
      const ls = await api<{ name: string; status: string; funnel: { using_now: number; queued?: number; opened: number } }[]>('/launches');
      return [
        `世界时间 ${s.clock.date} ${s.clock.clock}${s.clock.paused ? '（暂停中）' : s.clock.speed !== 1 ? `（${s.clock.speed} 倍速）` : ''}，城里 ${s.personas.length} 人。`,
        `\n此刻在用产品的人（${using.length}）：`, ...(using.length ? using.slice(0, 20).map((p) => `  · ${p.name}（${p.age} 岁，${p.occupation}）在「${p.place_id}」用「${p.session!.app}」第 ${p.session!.step_idx + 1} 步${p.session!.status === 'waiting_human' ? '，卡在需要人介入的地方' : ''}${p.session!.monologue ? `：「${p.session!.monologue.slice(0, 60)}」` : ''}  [persona_id=${p.id}]`) : ['  没有人']),
        '\n各产品：', ...(ls.length ? ls.map((l) => `  · ${l.name}（${l.status}）此刻 ${l.funnel.using_now} 人在用${l.funnel.queued ? `，${l.funnel.queued} 人排队` : ''}，累计 ${l.funnel.opened} 人打开过`) : ['  还没有发布过产品']),
        s.events.length ? `\n正在发生：${s.events.map((e) => `${e.place_id} ${e.kind}`).join('；')}` : '',
      ].filter(Boolean).join('\n');
    },
  },
  {
    name: 'find_people', admin: false, label: '按画像找人',
    description: `按画像在城里找人，返回 persona_id（可以交给 invite_people 的 persona_ids 指定请谁试、交给 person_profile 看详情、交给 ask_person 追问）。所有条件都可选、可以组合：query 匹配名字、职业、地区；人群 segment：${SEG}；会用手机的程度 0–1（0.3 以下算不太会用）。`,
    input: { query: z.string().optional().describe('名字、职业或地区里的关键词，例如「护士」「退休」「上海」'), segment: z.string().optional(), locale: z.enum(['zh-CN', 'en-US']).optional(), min_age: z.number().optional(), max_age: z.number().optional(), max_digital_literacy: z.number().min(0).max(1).optional().describe('只要不太会用手机的人：例如 0.35'), min_digital_literacy: z.number().min(0).max(1).optional(), used_product: z.string().optional().describe('只要用过这个产品的人（产品名）'), using_now: z.boolean().optional().describe('只要此刻正在用产品的人'), limit: z.number().int().min(1).max(40).optional() },
    run: async (a, { api }) => {
      const q = String(a.query ?? '').trim().toLowerCase();
      const hit = (await api<PersonaRow[]>('/personas')).filter((p) =>
        (!q || [p.name, p.occupation, p.region ?? ''].some((x) => x.toLowerCase().includes(q))) && (!a.segment || p.segment === a.segment) && (!a.locale || p.locale === a.locale)
        && (a.min_age == null || p.age >= Number(a.min_age)) && (a.max_age == null || p.age <= Number(a.max_age))
        && (a.max_digital_literacy == null || p.digital_literacy <= Number(a.max_digital_literacy)) && (a.min_digital_literacy == null || p.digital_literacy >= Number(a.min_digital_literacy))
        && (!a.used_product || p.apps.some((x) => x.includes(String(a.used_product)))) && (!a.using_now || !!p.live?.app));
      const n = Number(a.limit ?? 12);
      return hit.length ? `找到 ${hit.length} 人${hit.length > n ? `，列出前 ${n} 个` : ''}：\n${hit.slice(0, n).map(personLine).join('\n')}` : '没有符合这些条件的人。放宽一点条件再找。';
    },
  },
  {
    name: 'person_profile', admin: false, label: '看一个人',
    description: '一位居民是什么样的人：身份、性格与处境、会不会用手机、此刻在哪做什么、用过哪些产品和结局、对产品的信任、身边的人。person 可以是名字或 persona_id。',
    input: { person: z.string().describe('名字或 persona_id') },
    run: async ({ person }, { api }) => {
      const p = await resolvePerson(api, String(person));
      const d = await api<{ spec: { identity: { name: string; age: number; gender: string; occupation: string; region?: string; bio?: string; first_person?: string }; personality?: Record<string, unknown>; capability: { digital_literacy: number; ai_familiarity: number } }; sessions: { id: string; app?: string; app_name?: string; outcome: string | null; end_reason: string | null; started_at: string | null }[]; here: { scenario?: string; place_id?: string; device?: string; available?: boolean; unavailable_reason?: string | null; time_left_min?: number } | null; ties: { name: string; kind: string }[]; resident: { income_month?: number; currency?: string; life_event?: string | null } | null }>(`/personas/${encodeURIComponent(p.id)}`);
      const id = d.spec.identity; const bio = (id.first_person ?? id.bio ?? '').replace(/\s+/g, ' ').slice(0, 400);
      const used = d.sessions.slice(0, 8).map((s) => `  · ${s.app_name ?? s.app ?? '某产品'}：${OUT[s.outcome ?? ''] ?? s.outcome ?? '进行中'}${s.end_reason ? ` — ${s.end_reason.slice(0, 80)}` : ''}  [session_id=${s.id}]`);
      return [personLine(p), bio ? `\n${bio}` : '', d.resident?.life_event ? `\n近况：${d.resident.life_event}` : '',
        d.here ? `\n此刻：${d.here.scenario ?? d.here.place_id ?? ''}${d.here.device ? `，手里是${d.here.device}` : ''}${d.here.available === false ? `，现在没空看手机（${d.here.unavailable_reason ?? ''}）` : d.here.time_left_min ? `，大约有 ${d.here.time_left_min} 分钟空` : ''}` : '',
        `\n用过的产品：\n${used.join('\n') || '  还没有'}`, d.ties.length ? `\n身边的人：${d.ties.slice(0, 8).map((t) => `${t.name}（${t.kind}）`).join('、')}` : ''].filter(Boolean).join('');
    },
  },
  {
    name: 'town_talk', admin: false, label: '看城里在说什么',
    description: '城里的人在公开动态和应用商店评论里说了什么（最新的在前）。给 product 只看关于这个产品的。',
    input: { product: z.string().optional().describe('发布 id 或产品名（可选）') },
    run: async ({ product }, { api }) => {
      let id: string | undefined; let reviews: { rating: number; body: string; persona?: string }[] = [];
      if (product) { const l = await api<{ id: string; reviews?: { rating: number; body: string; name?: string }[] }>(`/launches/${encodeURIComponent(String(product))}`); id = l.id; reviews = (l.reviews ?? []).map((r) => ({ rating: r.rating, body: r.body, persona: r.name })); }
      const feed = await api<{ name?: string; body: string; launch_name?: string | null; likes?: number }[]>(`/feed${id ? `?launch_id=${encodeURIComponent(id)}` : ''}`);
      const posts = feed.slice(0, 12).map((p) => `  · ${p.name ?? '某人'}${p.launch_name ? `（关于「${p.launch_name}」）` : ''}：${p.body.replace(/\s+/g, ' ').slice(0, 160)}${p.likes ? `  ♥${p.likes}` : ''}`);
      const rv = reviews.slice(0, 8).map((r) => `  · ${'★'.repeat(Math.round(r.rating))}${r.persona ? ` ${r.persona}` : ''}：${r.body.replace(/\s+/g, ' ').slice(0, 160)}`);
      return [`公开动态：\n${posts.join('\n') || '  还没有'}`, product ? `\n商店评论：\n${rv.join('\n') || '  还没有'}` : ''].join('');
    },
  },

  // ---------------------------------------------------------------- 问题分诊与对比
  {
    name: 'list_issues', admin: false, label: '看问题清单',
    description: '一个产品的问题清单，按严重度排：每条有多少人遇到、标过新版本时最新版本里还出现几次、分诊状态、有没有开成 GitHub issue。track：experience（虚拟人亲身遇到的，默认）、engineering（工程附录：用户看不到的技术信号）、all。status 可筛 open / confirmed / known / rejected。',
    input: { product: z.string(), track: z.enum(['experience', 'engineering', 'all']).optional(), status: z.enum(['open', 'confirmed', 'known', 'rejected']).optional() },
    run: async ({ product, track, status }, { api }) => {
      const l = await api<{ id: string; name: string }>(`/launches/${encodeURIComponent(String(product))}`);
      const qs = new URLSearchParams(); if (track) qs.set('track', String(track)); if (status) qs.set('status', String(status));
      const xs = await api<IssueRow[]>(`/launches/${l.id}/issues${qs.size ? `?${qs}` : ''}`);
      return xs.length ? `「${l.name}」的问题（${xs.length}）：\n${xs.map(issueLine).join('\n')}\n\n用 issue_detail 看某一条的来龙去脉。` : `「${l.name}」目前没有${status ? STATUS[String(status)] : ''}问题。`;
    },
  },
  {
    name: 'issue_detail', admin: false, label: '看一个问题',
    description: '一个问题的来龙去脉：描述、谁在哪一步遇到、他们当时的原话、截图的证据 id、复现步骤、建议、GitHub issue 状态。',
    input: { issue_id: z.string() },
    run: async ({ issue_id }, { api }) => {
      const d = await api<IssueDetail>(`/issues/${encodeURIComponent(String(issue_id))}`);
      return [`[${d.severity}] ${d.title}（${STATUS[d.status] ?? d.status}${d.track === 'engineering' ? '，工程附录' : ''}）${d.where ? `  @${d.where}` : ''}`, d.description,
        d.moments.length ? `\n遇到的人：\n${d.moments.slice(0, 8).map((m) => `  · ${m.name}（${m.who}）${OUT[m.outcome ?? ''] ?? ''}${m.quote ? `：「${m.quote}」` : ''}${m.screenshot ? `  [截图 evidence_id=${m.screenshot}]` : ''}  [session_id=${m.session_id}]`).join('\n')}` : '',
        d.steps.length ? `\n复现${d.reproduced ? '（已干净重放过）' : ''}：${d.steps.join(' → ')}` : '', d.recommendation ? `\n建议：${d.recommendation}` : '',
        d.github ? `\nGitHub：${d.github.url}（${d.github.state === 'open' ? '开着' : '已关闭'}${d.github.verified_version ? `，关闭后自动标了第 ${d.github.verified_version} 版并请人验证` : ''}）` : ''].filter(Boolean).join('\n');
    },
  },
  {
    name: 'triage_issue', admin: true, label: '分诊问题',
    description: '给一个问题分诊：confirmed（确认要改）、known（已知，暂时不改；以后不再当成新问题推送）、rejected（不是问题，从清单里拿掉）、open（回到待处理）。',
    input: { issue_id: z.string(), status: z.enum(['confirmed', 'known', 'rejected', 'open']) },
    run: async ({ issue_id, status }, { api }) => { await api(`/issues/${encodeURIComponent(String(issue_id))}/triage`, { body: { status } }); return `已标为「${STATUS[String(status)]}」。`; },
  },
  {
    name: 'compare_versions', admin: false, label: '按版本对比',
    description: '按版本点切开对比：每一版里开始了几次使用、几次办成、几次放弃，每个亲历问题在每一版里出现了几次。用来回答「修好了没有」「新版本是不是更好」。',
    input: { product: z.string() },
    run: async ({ product }, { api }) => {
      const l = await api<{ id: string; name: string }>(`/launches/${encodeURIComponent(String(product))}`);
      const c = await api<{ versions: { n: number; note: string | null; at: string; sessions: number; finished: number; succeeded: number; gave_up: number }[]; issues: { id: string; severity: string; title: string; by_version: number[] }[] }>(`/launches/${l.id}/compare`);
      if (c.versions.length < 2) return `「${l.name}」还没有标过新版本，只有第 1 版。改好上线后用 mark_new_version 标一下，再请人试。`;
      const head = c.versions.map((v) => `第 ${v.n} 版（${v.at.slice(0, 16).replace('T', ' ')} 起${v.note ? `：${v.note}` : ''}）：${v.sessions} 次使用，${v.finished} 次结束，办成 ${v.succeeded}，放弃 ${v.gave_up}`).join('\n');
      const rows = c.issues.map((i) => `[${i.severity}] ${i.title}：${i.by_version.map((n, k) => `v${c.versions[k].n} ${n}`).join(' / ')}  [issue_id=${i.id}]`).join('\n');
      return `「${l.name}」按版本：\n${head}\n\n问题在各版里出现的次数：\n${rows || '  没有亲历问题'}\n\n（使用次数少时，某一版里没出现不代表修好了；最新的使用可能还没归并进问题清单。）`;
    },
  },

  // ---------------------------------------------------------------- 交给 coding agent
  {
    name: 'fix_task', admin: false, label: '生成修复任务',
    description: '把一个问题写成可以直接贴给任何 coding agent 的修复任务（Markdown）：问题、谁在哪一步遇到、原话、截图链接、复现步骤、建议、修完怎么验收。',
    input: { issue_id: z.string() },
    run: async ({ issue_id }, { api }) => (await api<{ text: string }>(`/issues/${encodeURIComponent(String(issue_id))}/fix-task`)).text,
  },
  {
    name: 'open_github_issue', admin: true, label: '开 GitHub issue',
    description: '把一个问题开成 GitHub issue（正文就是 fix_task 的修复任务，截图是只能看那一张图的签名链接）。要先在网页产品页的「交给 coding agent」里给这个产品配好仓库和令牌。issue 关闭后，Jobs 会自动标新版本，并请撞上过这个问题的那类人再试一遍。',
    input: { issue_id: z.string() },
    run: async ({ issue_id }, { api }) => { const o = await api<{ url: string; number: number; existed: boolean }>(`/issues/${encodeURIComponent(String(issue_id))}/github`, { body: {} }); return o.existed ? `这个问题已经开过 issue，还开着：${o.url}` : `已开成 #${o.number}：${o.url}\n关闭它之后 Jobs 会自动标新版本并请人验证。`; },
  },

  // ---------------------------------------------------------------- 运维与设置
  {
    name: 'system_status', admin: false, label: '看 Jobs 自己',
    description: 'Jobs 自己的状况：版本与有没有新版本、模型是否可用、累计花费、居民邮箱、游戏服、待人介入的任务数、此刻进行中的使用。',
    input: {},
    run: async (_a, { api }) => {
      const safe = async <T,>(p: string) => api<T>(p).catch(() => undefined);
      const [me, ov, ver, mail, game] = await Promise.all([safe<{ models_ready?: { ready: boolean; missing: string[] } | boolean }>('/me'), safe<{ personas: number; launches: number; live: number; spend_usd: number; human_pending: number }>('/overview'), safe<{ version: string; update_available?: boolean; latest?: { version: string } | null }>('/version'), safe<{ real: boolean; domain: string }>('/mail/status'), safe<{ tshock?: { up: boolean }; tml?: { up: boolean } }>('/game')]);
      const mr = me?.models_ready; const ready = typeof mr === 'object' ? mr.ready : mr;
      return [ver ? `Jobs ${ver.version}${ver.update_available && ver.latest ? `，有新版本 ${ver.latest.version}（管理员可以让我升级）` : '，已是最新'}` : '',
        `模型：${ready === false ? `缺少可用的模型${typeof mr === 'object' && mr.missing.length ? `（${mr.missing.join('、')}）` : ''}，到网页「设置 › 模型」接入` : '可用'}`,
        ov ? `城里 ${ov.personas} 人，${ov.launches} 个产品，此刻 ${ov.live} 次使用在进行；累计花费约 $${Math.round(ov.spend_usd * 100) / 100}；待人介入 ${ov.human_pending} 件` : '',
        mail ? `居民邮箱：${mail.real ? `已开通（@${mail.domain}），能收真实邮件` : '没开通，真实产品的验证邮件到不了'}` : '',
        game ? `游戏服：TShock ${game.tshock?.up ? '开着' : '关着'}，tModLoader ${game.tml?.up ? '开着' : '关着'}` : ''].filter(Boolean).join('\n');
    },
  },
  {
    name: 'human_tasks', admin: false, label: '看待介入的事',
    description: '需要人介入的事（例如居民卡在验证码、要人帮忙的地方），最新的在前。',
    input: {},
    run: async (_a, { api }) => {
      const xs = (await api<{ id: string; status: string; reason: string; session_id: string | null; created_at: string }[]>('/human')).filter((h) => h.status === 'pending');
      return xs.length ? xs.slice(0, 12).map((h) => `· ${h.reason}（${h.created_at.slice(5, 16).replace('T', ' ')}）  [task_id=${h.id}${h.session_id ? ` session_id=${h.session_id}` : ''}]`).join('\n') + '\n\n要在网页的「接管」里处理的，用 resolve_human_task 标记处理完。' : '没有待人介入的事。';
    },
  },
  {
    name: 'resolve_human_task', admin: true, label: '标记介入已处理',
    description: '把一件需要人介入的事标记为处理完（例如已经在网页上替居民输了验证码）。',
    input: { task_id: z.string() },
    run: async ({ task_id }, { api }) => { await api(`/human/${encodeURIComponent(String(task_id))}/resolve`, { body: {} }); return '已标记处理完。'; },
  },
  {
    name: 'update_jobs', admin: true, label: '升级 Jobs',
    description: '把 Jobs 升级到 GitHub 上最新的正式版本（先比较版本、备份数据库再重建；服务会重启一两分钟）。只在 system_status 说有新版本、且用户要求升级时用。',
    input: {},
    run: async (_a, { api }) => { const o = await api<{ requested?: boolean; already?: boolean; command?: string }>('/update', { body: {} }); return o.already ? '已经在升级了。' : o.requested ? '已请宿主机开始升级。服务会重启一两分钟，之后我会恢复。' : `这台机器不能一键升级，请在宿主机上运行：${o.command ?? 'jobsworld update'}`; },
  },
  {
    name: 'toggle_game', admin: true, label: '开关游戏服',
    description: '开或关 Terraria 游戏服：tshock（原版客户端进城）、tml（tModLoader 客户端进城）。',
    input: { kind: z.enum(['tshock', 'tml']), on: z.boolean() },
    run: async ({ kind, on }, { api }) => { const o = await api<{ requested?: boolean; command?: string }>('/game', { body: { kind, on } }).catch((e: Error) => ({ requested: false, command: e.message })); return o.requested ? `已请宿主机${on ? '打开' : '关掉'} ${kind}。` : `不能一键开关：${o.command ?? ''}`; },
  },
];
