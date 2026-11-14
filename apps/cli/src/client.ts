// 本机 Jobs 服务的 HTTP 客户端（命令行与 MCP 共用）
export const apiBase = () => { const b = process.env.JOBS_API ?? `http://127.0.0.1:${process.env.JW_PORT ?? 7777}`; return b.endsWith('/') ? b.slice(0, -1) : b; };
const key = () => process.env.JOBS_KEY ?? process.env.JW_ADMIN_PASSCODE ?? process.env.JW_PASSCODE ?? '';

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (key()) headers.authorization = `Bearer ${key()}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  let r: Response;
  try { r = await fetch(`${apiBase()}/api/v1${path}`, { method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'), headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined, signal: AbortSignal.timeout(opts.timeoutMs ?? 180_000) }); }
  catch (e) { throw new Error(`连不上 Jobs 服务（${apiBase()}）：${String((e as Error).message)}。服务没启动的话先运行 pnpm jobsworld`); }
  const text = await r.text();
  let data: unknown; try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text.slice(0, 300) }; }
  if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? `没有权限（${r.status}）：把管理员口令放进环境变量 JOBS_KEY` : `${r.status} ${(data as { error?: string }).error ?? text.slice(0, 200)}`);
  return data as T;
}

export interface FunnelView { reached: number; noticed: number; interested: number; opened: number; came_back: number; using_now: number; sessions: number; reviews: number; rating: number | null }
export interface LaunchView { id: string; name: string; tagline: string; url: string; intensity: number; status: string; funnel: FunnelView; spend: { usd: number; tokens: number } }
export interface Cited { text: string; moments: { persona: string; who: string; quote: string; session_id: string; step_idx: number }[]; passersby: { persona: string; who: string; thought: string }[] }
export interface ReportView { verdict: string; headline: string; summary: string; hurts: Cited[]; delights: Cited[]; who_stays: Cited[]; who_leaves: Cited[]; why_not_opened: Cited[]; next: string; funnel: FunnelView; people_used: number }
export interface EngineeringView { experienced: { id: string; severity: string; title: string; description: string; where: string | null; people: number; reproduced: boolean | null; steps: string[] }[]; appendix: { id: string; severity: string; category: string; title: string; description: string; recommendation: string | null; where: string | null }[] }

const pct = (v: number) => `${Math.round(v * 100)}%`;
export const funnelLine = (f: FunnelView) => `看到 ${f.reached} 人 → 注意到 ${f.noticed} → 有兴趣 ${f.interested} → 打开过 ${f.opened} → 回来再用 ${f.came_back}${f.using_now ? `（此刻 ${f.using_now} 人在用）` : ''}${f.rating ? ` · 评分 ${f.rating}（${f.reviews} 条）` : ''}`;

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
    if (eng.experienced.length) lines.push('\n── 虚拟人亲身遇到的问题（可据此修改）──', ...eng.experienced.map((i) => `[${i.severity}] ${i.title}${i.where ? `  @${i.where}` : ''}（${i.people} 人遇到${i.reproduced ? '，已复现' : ''}）\n    ${i.description}${i.steps.length ? `\n    复现：${i.steps.join(' → ')}` : ''}`));
    if (eng.appendix.length) lines.push('\n── 工程附录（用户看不到的技术信号与专家检查）──', ...eng.appendix.map((i) => `[${i.severity}] ${i.title}${i.where ? `  @${i.where}` : ''}${i.recommendation ? `\n    建议：${i.recommendation}` : ''}`));
  }
  return lines.filter((x) => x !== '').join('\n');
}
