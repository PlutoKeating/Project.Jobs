// 交给 coding agent：每个产品配一个 GitHub 仓库和细粒度令牌（只需要 Issues 读写），把一个问题开成 issue；
// issue 关闭后，自动验证由调用方（API 进程里的轮询）做：标新版本、把手机递给撞上过这个问题的那类人。
import { newId } from '@pux/core';
import { and, eq, getDb, issueLinks, launchGithub, lt, or, isNull } from '@pux/db';
import { open, seal } from '@pux/llm';
import { fixTaskText, issueDetail, type IssueDetail } from './issues.ts';
import { getLaunch, type LaunchRow } from './launch.ts';

const GH = 'https://api.github.com';
const REPO = /^[\w.-]+\/[\w.-]+$/;
const BIND = 'github';

async function gh<T>(token: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const r = await fetch(`${GH}${path}`, { method: init.method ?? 'GET', headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'x-github-api-version': '2022-11-28', 'user-agent': 'jobs', ...(init.body ? { 'content-type': 'application/json' } : {}) }, body: init.body ? JSON.stringify(init.body) : undefined, signal: AbortSignal.timeout(20_000) });
  const text = await r.text();
  if (!r.ok) { let msg = text.slice(0, 200); try { msg = (JSON.parse(text) as { message?: string }).message ?? msg; } catch { /* */ } throw new Error(`GitHub ${r.status}：${msg}`); }
  return (text ? JSON.parse(text) : {}) as T;
}

export interface GithubSettings { repo: string; auto_verify: boolean; invite_n: number; has_token: boolean }

export async function githubSettings(launchId: string): Promise<GithubSettings | null> {
  const [g] = await getDb().select().from(launchGithub).where(eq(launchGithub.launch_id, launchId));
  return g ? { repo: g.repo, auto_verify: g.auto_verify, invite_n: g.invite_n, has_token: !!g.token } : null;
}

/** 保存设置：换了令牌或仓库时先用它读一次仓库，确认令牌能用、仓库开着 Issues */
export async function saveGithubSettings(launchId: string, b: { repo?: string; token?: string; auto_verify?: boolean; invite_n?: number }): Promise<GithubSettings> {
  const db = getDb();
  const [cur] = await db.select().from(launchGithub).where(eq(launchGithub.launch_id, launchId));
  const repo = (b.repo ?? cur?.repo ?? '').trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '');
  if (!REPO.test(repo)) throw new Error('仓库要写成 owner/name');
  const token = b.token?.trim() || (cur ? open(cur.token, BIND) : '');
  if (!token) throw new Error('需要一个 GitHub 令牌（细粒度令牌，只给这个仓库的 Issues 读写权限）');
  if (b.token || repo !== cur?.repo) {
    const r = await gh<{ has_issues?: boolean; full_name?: string }>(token, `/repos/${repo}`);
    if (r.has_issues === false) throw new Error(`${r.full_name ?? repo} 关掉了 Issues`);
  }
  const row = { launch_id: launchId, repo, token: seal(token, BIND), auto_verify: b.auto_verify ?? cur?.auto_verify ?? true, invite_n: Math.max(1, Math.min(10, Math.round(b.invite_n ?? cur?.invite_n ?? 3))), updated_at: new Date() };
  await db.insert(launchGithub).values(row).onConflictDoUpdate({ target: launchGithub.launch_id, set: row });
  return { repo, auto_verify: row.auto_verify, invite_n: row.invite_n, has_token: true };
}

export async function clearGithubSettings(launchId: string) { await getDb().delete(launchGithub).where(eq(launchGithub.launch_id, launchId)); }

/** 把一个问题开成 GitHub issue（已经开过且还开着时直接返回那一个） */
export async function openGithubIssue(issueId: string, link: (path: string) => string): Promise<{ url: string; number: number; existed: boolean }> {
  const db = getDb();
  const d = await issueDetail(issueId); if (!d) throw new Error('没有这个问题');
  if (!d.launch_id) throw new Error('这个问题不属于任何一次发布');
  if (d.github?.state === 'open') return { url: d.github.url, number: d.github.number, existed: true };
  const l = await getLaunch(d.launch_id); if (!l) throw new Error('发布不存在');
  const [g] = await db.select().from(launchGithub).where(eq(launchGithub.launch_id, l.id));
  if (!g) throw new Error(`「${l.name}」还没有配置 GitHub 仓库：在网页的产品页「交给 coding agent」里填仓库和令牌`);
  const body = `${fixTaskText(l, d, link)}\n\n---\n由 Jobs 开出（问题 ${d.id}）。关闭这个 issue 后，Jobs ${g.auto_verify ? '会自动标记新版本，并请撞上过这个问题的那类人再试一遍' : '不会自动验证（产品设置里关掉了）'}。`;
  const r = await gh<{ html_url: string; number: number }>(open(g.token, 'github'), `/repos/${g.repo}/issues`, { method: 'POST', body: { title: `[Jobs] ${d.title}`.slice(0, 250), body } });
  await db.insert(issueLinks).values({ id: newId('gil'), issue_id: d.id, launch_id: l.id, repo: g.repo, number: r.number, url: r.html_url, state: 'open', checked_at: new Date() });
  return { url: r.html_url, number: r.number, existed: false };
}

export interface ClosedFix { link: typeof issueLinks.$inferSelect; launch: LaunchRow; detail: IssueDetail; settings: GithubSettings }

/**
 * 查一遍还开着的 issue（每个最多 5 分钟查一次）。关掉了的交给 onClosed 去做自动验证（标版本、递手机），
 * 它返回新版本号与这次请的人，记在链接上，这样同一个关闭只验证一次。
 */
export async function pollGithubIssues(onClosed: (f: ClosedFix) => Promise<{ version: number; sessions: string[] } | null>, minAgeMs = 5 * 60_000): Promise<number> {
  const db = getDb(); const cutoff = new Date(Date.now() - minAgeMs);
  const links = await db.select().from(issueLinks).where(and(eq(issueLinks.state, 'open'), or(isNull(issueLinks.checked_at), lt(issueLinks.checked_at, cutoff)))).limit(30);
  let closed = 0;
  for (const k of links) {
    const [g] = await db.select().from(launchGithub).where(eq(launchGithub.launch_id, k.launch_id));
    if (!g) { await db.update(issueLinks).set({ checked_at: new Date() }).where(eq(issueLinks.id, k.id)); continue; }
    try {
      const r = await gh<{ state: string; closed_at?: string | null; state_reason?: string | null }>(open(g.token, 'github'), `/repos/${k.repo}/issues/${k.number}`);
      if (r.state !== 'closed') { await db.update(issueLinks).set({ checked_at: new Date() }).where(eq(issueLinks.id, k.id)); continue; }
      const closedAt = r.closed_at ? new Date(r.closed_at) : new Date();
      await db.update(issueLinks).set({ state: 'closed', closed_at: closedAt, checked_at: new Date() }).where(eq(issueLinks.id, k.id));
      closed++;
      if (!g.auto_verify || r.state_reason === 'not_planned') continue;               // 「不打算修」关掉的不验证
      const l = await getLaunch(k.launch_id); const d = await issueDetail(k.issue_id);
      if (!l || !d) continue;
      const v = await onClosed({ link: { ...k, state: 'closed', closed_at: closedAt }, launch: l, detail: d, settings: { repo: g.repo, auto_verify: g.auto_verify, invite_n: g.invite_n, has_token: true } });
      if (v) await db.update(issueLinks).set({ verified_version: v.version, verify_sessions: v.sessions }).where(eq(issueLinks.id, k.id));
    } catch { await db.update(issueLinks).set({ checked_at: new Date() }).where(eq(issueLinks.id, k.id)); }
  }
  return closed;
}

/** 撞上过这个问题的「那类人」：出现最多的人群与语言 */
export function verifyAudience(d: IssueDetail): { segment?: string; locale?: string } {
  const top = (xs: string[]) => { const c = new Map<string, number>(); for (const x of xs.filter(Boolean)) c.set(x, (c.get(x) ?? 0) + 1); return [...c].sort((a, b) => b[1] - a[1])[0]?.[0]; };
  return { segment: top(d.moments.map((m) => m.segment)), locale: top(d.moments.map((m) => m.locale)) };
}
