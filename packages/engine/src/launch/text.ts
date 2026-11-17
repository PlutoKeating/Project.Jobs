// 发布状况与一页结论的纯文本排版：终端、MCP（coding agent）、飞书读的是同一份。这里只有类型和字符串，不碰数据库与网络。
export interface FunnelView { reached: number; noticed: number; interested: number; opened: number; came_back: number; using_now: number; queued?: number; sessions: number; reviews: number; rating: number | null }
export interface LaunchView { id: string; name: string; tagline: string; url: string; intensity: number; status: string; funnel: FunnelView; spend: { usd: number; tokens: number } }
export interface Cited { text: string; moments: { persona: string; who: string; quote: string; session_id: string; step_idx: number }[]; passersby: { persona: string; who: string; thought: string }[] }
export interface ReportView { verdict: string; headline: string; summary: string; hurts: Cited[]; delights: Cited[]; who_stays: Cited[]; who_leaves: Cited[]; why_not_opened: Cited[]; next: string; funnel: FunnelView; people_used: number }
export interface VersionView { n: number; note: string | null; at: string; sessions: number; finished: number }
export interface EngineeringView { version?: VersionView | null; experienced: { id: string; severity: string; title: string; description: string; where: string | null; people: number; sessions?: number; sessions_since_version?: number | null; reproduced: boolean | null; steps: string[] }[]; appendix: { id: string; severity: string; category: string; title: string; description: string; recommendation: string | null; where: string | null }[]; mail?: { mails: number; sessions: number; opened: number; median_delay_s: number | null; max_delay_s: number | null; switches: number; forgot: number; mistyped: number } | null }

const pct = (v: number) => `${Math.round(v * 100)}%`;
export const funnelLine = (f: FunnelView) => `看到 ${f.reached} 人 → 注意到 ${f.noticed} → 有兴趣 ${f.interested} → 打开过 ${f.opened} → 回来再用 ${f.came_back}${f.using_now || f.queued ? `（此刻 ${f.using_now} 人在用${f.queued ? `，${f.queued} 人排队` : ''}）` : ''}${f.rating ? ` · 评分 ${f.rating}（${f.reviews} 条）` : ''}`;

/** 把一页结论排成纯文本（终端和 coding agent 都读这一份） */
export function reportText(l: LaunchView, r: ReportView, eng?: EngineeringView): string {
  const verdict = ({ works: '多数人用得下去', mixed: '有人行，有人不行', not_yet: '多数人用不下去', too_early: '还太早' } as Record<string, string>)[r.verdict] ?? r.verdict;
  const quotes = (c: Cited) => [...c.moments.map((m) => `     — ${m.persona}（${m.who}）：「${m.quote}」`), ...c.passersby.map((p) => `     — ${p.persona}（${p.who}）：「${p.thought}」`)].join('\n');
  const sec = (title: string, xs: Cited[]) => (xs.length ? `\n${title}\n${xs.map((c, i) => `  ${i + 1}. ${c.text}\n${quotes(c)}`).join('\n')}` : '');
  const lines = [
    `${l.name} — ${l.tagline}`, `${r.headline}  [${verdict}]`, '', r.summary, '',
    `漏斗（这座城里实际发生的人数，模拟）：${funnelLine(r.funnel)}`, `宣发强度 ${pct(l.intensity)} · 已花费约 $${l.spend.usd}`,
    sec('最让人难受的地方', r.hurts), sec('让人高兴的地方', r.delights), sec('会留下的人', r.who_stays), sec('会走的人', r.who_leaves), sec('看到了却没点开', r.why_not_opened),
    r.next ? `\n如果只改一件事：${r.next}` : '',
  ];
  if (eng) {
    const v = eng.version;
    if (v) lines.push(`\n── 第 ${v.n} 版（${v.at.slice(0, 16).replace('T', ' ')} 起${v.note ? `：${v.note}` : ''}）──\n新版本里开始了 ${v.sessions} 次使用，${v.finished} 次已结束。问题清单每累计几次使用重新归并一次，最新的使用可能还没算进去。`);
    const sinceV = (i: EngineeringView['experienced'][number]) => (v && i.sessions_since_version != null ? (i.sessions_since_version ? `；第 ${v.n} 版里仍出现 ${i.sessions_since_version} 次` : v.finished ? `；第 ${v.n} 版里没再出现` : '') : '');
    if (eng.experienced.length) lines.push('\n── 虚拟人亲身遇到的问题（可据此修改）──', ...eng.experienced.map((i) => `[${i.severity}] ${i.title}${i.where ? `  @${i.where}` : ''}（${i.people} 人遇到${i.reproduced ? '，已复现' : ''}${sinceV(i)}）\n    ${i.description}${i.steps.length ? `\n    复现：${i.steps.join(' → ')}` : ''}`));
    const m = eng.mail;
    if (m) lines.push(`\n── 验证邮件（仪器读数）──\n${m.sessions} 次使用里收到 ${m.mails} 封邮件，点开 ${m.opened} 封${m.median_delay_s != null ? `；从填好邮箱到信到达，中位 ${m.median_delay_s} 秒，最慢 ${m.max_delay_s} 秒` : ''}。在产品和邮箱之间切换 ${m.switches} 次${m.forgot ? `，其中 ${m.forgot} 次切回来时记不清验证码` : ''}${m.mistyped ? `；${m.mistyped} 次输入的码与邮件里的不一致` : ''}。`);
    if (eng.appendix.length) lines.push('\n── 工程附录（用户看不到的技术信号与专家检查）──', ...eng.appendix.map((i) => `[${i.severity}] ${i.title}${i.where ? `  @${i.where}` : ''}${i.recommendation ? `\n    建议：${i.recommendation}` : ''}`));
  }
  return lines.filter((x) => x !== '').join('\n');
}
