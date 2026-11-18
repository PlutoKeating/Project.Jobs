// 日常命令：发布、看状况、看结论、调宣发、把手机递给人、清零、下线。全部通过本机的 Jobs 服务（HTTP）完成。
import type { Command } from 'commander';
import { JOBS_TOOLS } from '@pux/engine/launch/tools';
import { api, apiBase, funnelLine, reportText, type EngineeringView, type LaunchView, type ReportView } from './client.ts';

const run = <A extends unknown[]>(fn: (...a: A) => Promise<void>) => async (...a: A) => { try { await fn(...a); } catch (e) { console.error(`❌ ${(e as Error).message}`); process.exitCode = 1; } };
const find = (ref: string) => api<LaunchView>(`/launches/${encodeURIComponent(ref)}`);
/** 用和 MCP、Jobs Agent 同一份工具把结果打出来 */
const tool = async (name: string, args: Record<string, unknown> = {}) => { const t = JOBS_TOOLS.find((x) => x.name === name); if (!t) throw new Error(`没有这个工具：${name}`); console.log(await t.run(args, { api })); };

export function userCommands(program: Command) {
  program.command('publish').argument('<url>', '产品地址（本机能访问即可）').description('把产品发布到 JobsWorld。之后城里的人会自己遇到它、决定用不用')
    .requiredOption('--name <name>', '产品名').requiredOption('--tagline <text>', '一句话介绍（商店页和广告上的那句话）')
    .option('--landing <url>', '官网或落地页').option('--desc <text>', '商店页上的介绍').option('--ad <text>', '广告文案').option('--intensity <0-1>', '宣发强度：0.1 悄悄上线，1 全城铺开', '0.3').option('--phone-only', '只在手机上开（H5）')
    .action(run(async (url: string, o: { name: string; tagline: string; landing?: string; desc?: string; ad?: string; intensity: string; phoneOnly?: boolean }) => {
      const l = await api<LaunchView>('/launches', { body: { name: o.name, tagline: o.tagline, url, landing_url: o.landing, description: o.desc, ad_text: o.ad, intensity: Number(o.intensity), form: o.phoneOnly ? 'h5' : 'web' } });
      console.log(`✅ 已发布「${l.name}」 ${l.id}\n   在网页上看：${apiBase()}/products/${l.id}\n   想马上得到反馈：jobsworld invite ${l.id} -n 3`);
    }));

  program.command('ls').description('已发布的产品').action(run(async () => {
    const ls = await api<LaunchView[]>('/launches');
    if (!ls.length) { console.log('还没有发布过产品。jobsworld publish <url> --name … --tagline …'); return; }
    for (const l of ls) console.log(`${l.id}  ${l.name}  [${l.status} · 宣发 ${Math.round(l.intensity * 100)}% · $${l.spend.usd}]\n    ${funnelLine(l.funnel)}`);
  }));

  program.command('status').argument('<product>', '发布 id 或产品名').description('一个产品此刻在城里的状况').action(run(async (ref: string) => {
    const d = await api<LaunchView & { uses: { name: string; occupation: string; age: number; status: string; outcome: string | null; end_reason: string | null; where: string | null; invited: boolean }[]; passersby: { name: string; channel: string; thought: string | null; reaction: string }[] }>(`/launches/${encodeURIComponent(ref)}`);
    console.log(`${d.name} — ${d.tagline}  [${d.status} · 宣发 ${Math.round(d.intensity * 100)}% · $${d.spend.usd}]\n${funnelLine(d.funnel)}\n`);
    // ▶ 此刻在用（✋ 卡在需要人介入的地方）· … 排队，还没开始 · ✓ / ✗ 用完了
    const rank = (s: string) => (s === 'running' || s === 'waiting_human' ? 0 : s === 'planned' ? 2 : 1);
    for (const u of [...d.uses].sort((a, b) => rank(a.status) - rank(b.status)).slice(0, 20)) console.log(`  ${u.status === 'running' ? '▶' : u.status === 'waiting_human' ? '✋' : u.status === 'planned' ? '…' : u.outcome === 'success' ? '✓' : '✗'} ${u.name}（${u.age} 岁，${u.occupation}）${u.where ? ` · ${u.where}` : ''}${u.invited ? ' · 受邀' : ''}${u.end_reason ? `\n      ${u.end_reason.slice(0, 100)}` : ''}`);
    if (d.passersby.length) { console.log('\n看到了没点开：'); for (const p of d.passersby.slice(0, 8)) console.log(`  · ${p.name}（${p.channel}）：${p.thought ?? p.reaction}`); }
  }));

  program.command('report').argument('<product>').description('一页结论（加 --json 给程序读，加 --eng 带上问题清单与工程附录）').option('--json').option('--eng', '附上虚拟人亲历的问题（含复现步骤）与工程附录').option('--refresh', '强制重新归纳').option('--lang <zh|en>', '语言', 'zh')
    .action(run(async (ref: string, o: { json?: boolean; eng?: boolean; refresh?: boolean; lang: string }) => {
      const l = await find(ref);
      const r = await api<ReportView>(`/launches/${l.id}/report?lang=${o.lang}${o.refresh ? '&force=1' : ''}`, { timeoutMs: 300_000 });
      const eng = o.eng || o.json ? await api<EngineeringView>(`/launches/${l.id}/engineering`) : undefined;
      console.log(o.json ? JSON.stringify({ launch: l, report: r, ...eng }, null, 2) : reportText(l, r, eng));
    }));

  program.command('promote').argument('<product>').description('调宣发强度；--pause / --resume / --end').option('--intensity <0-1>').option('--pause').option('--resume').option('--end').option('--ad <text>', '换广告文案').option('--tagline <text>', '改一句话介绍').option('--desc <text>', '改商店页介绍').option('--landing <url>', '改落地页').option('--who <occupations>', '投给谁：职业关键词，逗号分隔，如 大学生,工程师').option('--age <min-max>', '投给谁：年龄段，如 18-25')
    .action(run(async (ref: string, o: { intensity?: string; pause?: boolean; resume?: boolean; end?: boolean; ad?: string; tagline?: string; desc?: string; landing?: string; who?: string; age?: string }) => {
      const l = await find(ref);
      const out = await api<LaunchView>(`/launches/${l.id}/promotion`, { body: { intensity: o.intensity !== undefined ? Number(o.intensity) : undefined, status: o.end ? 'ended' : o.pause ? 'paused' : o.resume ? 'live' : undefined, ad_text: o.ad, tagline: o.tagline, description: o.desc, landing_url: o.landing, audience: o.who || o.age ? { occupations: o.who?.split(',').map((x) => x.trim()).filter(Boolean), age_min: o.age ? Number(o.age.split('-')[0]) || undefined : undefined, age_max: o.age ? Number(o.age.split('-')[1]) || undefined : undefined } : undefined } });
      console.log(`「${out.name}」：${out.status}，宣发强度 ${Math.round(out.intensity * 100)}%`);
    }));

  program.command('invite').argument('<product>').description('把手机递给城里的几个人，请他们现在就试试').option('-n <n>', '请几个人', '3').option('--segment <s>', '人群：office_worker / senior / student / teen / professional / blue_collar / service_worker / freelancer / homemaker / job_seeker').option('--locale <l>', 'zh-CN | en-US').option('--who <ids>', '指定人物 id，逗号分隔').option('--want <text>', '希望他们用它做的一件事（生活里的话）').option('--query <kw>', '名字、职业、地区里的关键词，如 大学生').option('--min-age <n>').option('--max-age <n>')
    .action(run(async (ref: string, o: { n: string; segment?: string; locale?: string; who?: string; want?: string; query?: string; minAge?: string; maxAge?: string }) => {
      const l = await find(ref);
      const out = await api<{ invited: number; matched?: number; people?: { name: string }[]; skipped?: { name: string; reason: string }[]; notes?: string[] }>(`/launches/${l.id}/invite`, { body: { n: Number(o.n), segment: o.segment, locale: o.locale, persona_ids: o.who?.split(','), want: o.want, query: o.query, min_age: o.minAge ? Number(o.minAge) : undefined, max_age: o.maxAge ? Number(o.maxAge) : undefined } });
      console.log(`已请 ${out.invited} 个人试用「${l.name}」（符合条件共 ${out.matched ?? '?'} 人）。几分钟后：jobsworld status ${l.id}`);
      if (out.people?.length) console.log(`  请到：${out.people.map((p) => p.name).join('、')}`);
      for (const k of out.skipped ?? []) console.log(`  没请成：${k.name}（${k.reason}）`);
      for (const n of out.notes ?? []) console.log(`  说明：${n}`);
    }));

  program.command('cancel').argument('<product>').description('取消排队中（或指定）的使用').option('--sessions <ids>', '指定使用 id，逗号分隔；不给就取消所有排队中的')
    .action(run(async (ref: string, o: { sessions?: string }) => {
      const l = await find(ref);
      const out = await api<{ cancelled: number }>(`/launches/${l.id}/cancel`, { body: { session_ids: o.sessions?.split(','), all_queued: !o.sessions } });
      console.log(`已取消 ${out.cancelled} 次使用。`);
    }));

  program.command('reset').argument('<product>', '发布 id 或产品名').description('清零：城里关于它的经历全部归零（使用、曝光、评论、动态、居民的记忆与信任、问题与结论），产品本身不动，此刻重新上线、花费归零')
    .action(run(async (ref: string) => {
      const l = await find(ref);
      const o = await api<LaunchView & { cleared: Record<string, number> }>(`/launches/${l.id}/reset`, { body: {}, timeoutMs: 300_000 });
      const c = o.cleared ?? {};
      console.log(`✅「${o.name}」已清零并重新上线：清掉 ${c.sessions ?? 0} 次使用、${c.exposures ?? 0} 次曝光、${c.reviews ?? 0} 条评论、${c.posts ?? 0} 条动态，${c.people ?? 0} 位居民忘掉了它`);
    }));

  program.command('remove').argument('<product>', '发布 id 或产品名').description('下线：从城里拿掉这个产品。默认保留城里的经历；--wipe 连同经历一起删除').option('--wipe', '连同使用过程、评论、动态、居民的记忆一起删除')
    .action(run(async (ref: string, o: { wipe?: boolean }) => {
      const l = await find(ref);
      const r = await api<{ kept: boolean; sessions: number; reviews: number; posts: number; people: number }>(`/launches/${l.id}${o.wipe ? '?history=delete' : ''}`, { method: 'DELETE', timeoutMs: 300_000 });
      console.log(r.kept ? `✅「${l.name}」已下线，城里的经历保留` : `✅「${l.name}」已下线，删除了 ${r.sessions} 次使用、${r.reviews} 条评论、${r.posts} 条动态，${r.people} 位居民忘掉了它`);
    }));

  program.command('people').description('城里的人').option('--using', '只看正在用产品的人').action(run(async (o: { using?: boolean }) => {
    const ps = await api<{ id: string; name: string; age: number; occupation: string; segment: string; live: { activity: string; place_id: string; app?: string } | null }[]>('/personas');
    for (const p of ps.filter((x) => !o.using || x.live?.app)) console.log(`${p.id.padEnd(18)} ${p.name}（${p.age}，${p.occupation}）${p.live ? ` — ${p.live.app ? `正在用 ${p.live.app}` : p.live.activity}` : ''}`);
  }));

  program.command('ask').argument('<personaId>').argument('<question...>').description('向一位用过产品的居民追问').action(run(async (id: string, q: string[]) => {
    const o = await api<{ answer: string | null; busy?: boolean; none?: boolean }>('/world/ask', { body: { persona_id: id, question: q.join(' ') } });
    console.log(o.busy ? '他正在使用产品，等这次用完再问。' : o.none ? '他还没有用过任何产品。' : o.answer);
  }));

  program.command('clock').description('世界时钟：--pause / --resume / --speed <n> / --jump HH:MM').option('--pause').option('--resume').option('--speed <n>').option('--jump <hhmm>')
    .action(run(async (o: { pause?: boolean; resume?: boolean; speed?: string; jump?: string }) => { console.log(JSON.stringify(await api('/world/clock', { body: { paused: o.pause ? true : o.resume ? false : undefined, speed: o.speed ? Number(o.speed) : undefined, jump_to: o.jump } }))); }));

  // ---- 城里现在、问题分诊、交给 coding agent、运维（与 MCP 工具同一份）----
  program.command('town').description('城里此刻：谁在用哪个产品、各产品在用与排队的人数、正在发生的事件').action(run(async () => tool('town_now')));
  program.command('find').argument('[query]', '名字、职业或地区里的关键词').description('按画像找人（返回 persona_id，可交给 invite --who）')
    .option('--segment <s>').option('--locale <l>').option('--min-age <n>').option('--max-age <n>').option('--max-literacy <0-1>', '只要不太会用手机的人，例如 0.35').option('--used <product>', '用过这个产品的人').option('--using', '此刻正在用产品的人').option('-n <n>', '最多列几个', '12')
    .action(run(async (query: string | undefined, o: { segment?: string; locale?: string; minAge?: string; maxAge?: string; maxLiteracy?: string; used?: string; using?: boolean; n: string }) => tool('find_people', { query, segment: o.segment, locale: o.locale, min_age: o.minAge ? Number(o.minAge) : undefined, max_age: o.maxAge ? Number(o.maxAge) : undefined, max_digital_literacy: o.maxLiteracy ? Number(o.maxLiteracy) : undefined, used_product: o.used, using_now: o.using, limit: Number(o.n) })));
  program.command('whois').argument('<person>', '名字或 persona_id').description('一位居民是什么样的人、此刻在做什么、用过什么').action(run(async (person: string) => tool('person_profile', { person })));
  program.command('talk').argument('[product]').description('城里的公开动态与商店评论').action(run(async (product?: string) => tool('town_talk', { product })));
  program.command('issues').argument('<product>').description('问题清单（按严重度）').option('--track <t>', 'experience（默认）/ engineering / all').option('--status <s>', 'open / confirmed / known / rejected')
    .action(run(async (product: string, o: { track?: string; status?: string }) => tool('list_issues', { product, track: o.track, status: o.status })));
  program.command('issue').argument('<issueId>').description('一个问题的来龙去脉').option('--triage <status>', '分诊：confirmed / known / rejected / open')
    .action(run(async (id: string, o: { triage?: string }) => (o.triage ? tool('triage_issue', { issue_id: id, status: o.triage }) : tool('issue_detail', { issue_id: id }))));
  program.command('compare').argument('<product>').description('按版本对比：每一版的使用与结局、各问题在每一版里出现几次').action(run(async (product: string) => tool('compare_versions', { product })));
  program.command('fix').argument('<issueId>').description('把一个问题写成修复任务（Markdown，直接贴给 coding agent）；--github 开成 GitHub issue').option('--github', '开成 GitHub issue（先用 jobsworld github 配好仓库）')
    .action(run(async (id: string, o: { github?: boolean }) => tool(o.github ? 'open_github_issue' : 'fix_task', { issue_id: id })));
  program.command('github').argument('<product>').description('这个产品的 GitHub 仓库与令牌（开 issue、关闭后自动验证用）').option('--repo <owner/name>').option('--token <token>', '细粒度令牌：只给这个仓库的 Issues 读写').option('--no-verify', '关闭 issue 后不自动验证').option('--invite <n>', '自动验证时请几个人', '3').option('--clear', '删除设置')
    .action(run(async (ref: string, o: { repo?: string; token?: string; verify: boolean; invite: string; clear?: boolean }) => {
      const l = await find(ref);
      if (o.clear) { await api(`/launches/${l.id}/github`, { method: 'DELETE' }); console.log('已删除'); return; }
      const g = o.repo || o.token ? await api<{ repo: string; auto_verify: boolean; invite_n: number }>(`/launches/${l.id}/github`, { method: 'PUT', body: { repo: o.repo, token: o.token, auto_verify: o.verify, invite_n: Number(o.invite) } }) : await api<{ repo: string | null; auto_verify: boolean; invite_n: number }>(`/launches/${l.id}/github`);
      console.log(g.repo ? `「${l.name}」→ ${g.repo}${g.auto_verify ? `，issue 关闭后自动标新版本并请 ${g.invite_n} 人验证` : '，不自动验证'}` : `「${l.name}」还没有配置：jobsworld github ${l.id} --repo owner/name --token <令牌>`);
    }));
  program.command('system').description('Jobs 自己：版本、模型、花费、居民邮箱、游戏服、待人介入').action(run(async () => tool('system_status')));
  program.command('human').description('需要人介入的事；--done <id> 标记处理完').option('--done <taskId>').action(run(async (o: { done?: string }) => (o.done ? tool('resolve_human_task', { task_id: o.done }) : tool('human_tasks'))));
  program.command('tool').argument('<name>').argument('[json]', '参数（JSON）').description('直接调用一个 Jobs 工具（与 MCP 同一份；jobsworld tool list 列出全部）')
    .action(run(async (name: string, json?: string) => { if (name === 'list') { for (const t of JOBS_TOOLS) console.log(`${t.name.padEnd(20)} ${t.admin ? '[管理员] ' : ''}${t.description.slice(0, 70)}`); return; } await tool(name, json ? JSON.parse(json) as Record<string, unknown> : {}); }));

  program.command('chat').argument('[text...]', '只说一句（不进入交互）').description('跟 Jobs 说话：和飞书、网页右下角的对话是同一个 Jobs Agent（网页与终端共用一条对话）').action(async (text: string[]) => { const { runChat } = await import('./chat.ts'); try { await runChat(text.length ? text.join(' ') : undefined); } catch (e) { console.error(`❌ ${(e as Error).message}`); process.exitCode = 1; } });
  program.command('mcp').description('启动给同一台机器上的 coding agent 用的 MCP 服务（stdio）。Jobs 在别处时，把 <Jobs 地址>/mcp 直接加给 agent 即可').action(async () => { const { runMcp } = await import('./mcp.ts'); await runMcp(); });
}
