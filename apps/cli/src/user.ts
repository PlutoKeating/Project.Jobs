// 日常命令：发布、看状况、看结论、调宣发、把手机递给人、清零、下线。全部通过本机的 Jobs 服务（HTTP）完成。
import type { Command } from 'commander';
import { api, apiBase, funnelLine, reportText, type EngineeringView, type LaunchView, type ReportView } from './client.ts';

const run = <A extends unknown[]>(fn: (...a: A) => Promise<void>) => async (...a: A) => { try { await fn(...a); } catch (e) { console.error(`❌ ${(e as Error).message}`); process.exitCode = 1; } };
const find = (ref: string) => api<LaunchView>(`/launches/${encodeURIComponent(ref)}`);

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

  program.command('promote').argument('<product>').description('调宣发强度；--pause / --resume / --end').option('--intensity <0-1>').option('--pause').option('--resume').option('--end').option('--ad <text>', '换广告文案')
    .action(run(async (ref: string, o: { intensity?: string; pause?: boolean; resume?: boolean; end?: boolean; ad?: string }) => {
      const l = await find(ref);
      const out = await api<LaunchView>(`/launches/${l.id}/promotion`, { body: { intensity: o.intensity !== undefined ? Number(o.intensity) : undefined, status: o.end ? 'ended' : o.pause ? 'paused' : o.resume ? 'live' : undefined, ad_text: o.ad } });
      console.log(`「${out.name}」：${out.status}，宣发强度 ${Math.round(out.intensity * 100)}%`);
    }));

  program.command('invite').argument('<product>').description('把手机递给城里的几个人，请他们现在就试试').option('-n <n>', '请几个人', '3').option('--segment <s>', '人群：office_worker / senior / student / teen / professional / blue_collar / service_worker / freelancer / homemaker / job_seeker').option('--locale <l>', 'zh-CN | en-US').option('--who <ids>', '指定人物 id，逗号分隔').option('--want <text>', '希望他们用它做的一件事（生活里的话）')
    .action(run(async (ref: string, o: { n: string; segment?: string; locale?: string; who?: string; want?: string }) => {
      const l = await find(ref);
      const out = await api<{ invited: number }>(`/launches/${l.id}/invite`, { body: { n: Number(o.n), segment: o.segment, locale: o.locale, persona_ids: o.who?.split(','), want: o.want } });
      console.log(`已请 ${out.invited} 个人试用「${l.name}」。几分钟后：jobsworld status ${l.id}`);
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

  program.command('mcp').description('启动给同一台机器上的 coding agent 用的 MCP 服务（stdio）。Jobs 在别处时，把 <Jobs 地址>/mcp 直接加给 agent 即可').action(async () => { const { runMcp } = await import('./mcp.ts'); await runMcp(); });
}
