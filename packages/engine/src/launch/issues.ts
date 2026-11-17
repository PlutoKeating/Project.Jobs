// 一个产品的问题清单：列出与筛选、单个问题的来龙去脉（谁、在哪一步、当时说了什么、截图、复现步骤）、按版本对比、
// 以及交给 coding agent 的修复任务文本。网页、命令行、MCP、Jobs Agent 读的都是这里。
import { and, desc, eq, getDb, inArray, issueCandidates, issueLinks, issues, personas, reproPaths, sessions, steps } from '@pux/db';
import type { PersonaSpec } from '@pux/core';
import { launchVersionList, type LaunchRow } from './launch.ts';

const SEV: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
/** 「已知」：开发者知道、暂时不改；仍然列出，但不再算进「新问题」的推送 */
export const TRIAGE_STATUSES = ['open', 'confirmed', 'rejected', 'known'] as const;

export interface IssueRow { id: string; track: string; severity: string; title: string; category: string; status: string; where: string | null; people: number; sessions: number; sessions_since_version: number | null; github: { url: string; state: string } | null; created_at: string }

export async function listIssues(l: LaunchRow, o: { track?: 'experience' | 'engineering' | 'all'; status?: string } = {}): Promise<IssueRow[]> {
  const db = getDb(); const track = o.track ?? 'experience';
  let rows = await db.select().from(issues).where(eq(issues.app_version_id, l.app_version_id));
  rows = rows.filter((i) => i.status !== 'folded' && (track === 'all' || i.track === track) && (o.status ? i.status === o.status : i.status !== 'rejected'));
  const latest = (await launchVersionList(l)).at(-1)!;
  const since = latest.n > 1 ? new Set((await db.select({ id: sessions.id, started_at: sessions.started_at }).from(sessions).where(eq(sessions.study_id, l.study_id))).filter((s) => s.started_at && s.started_at.getTime() >= Date.parse(latest.at)).map((s) => s.id)) : null;
  const links = rows.length ? await db.select().from(issueLinks).where(inArray(issueLinks.issue_id, rows.map((r) => r.id))) : [];
  return rows.map((i) => {
    const gl = links.find((x) => x.issue_id === i.id);
    return { id: i.id, track: i.track, severity: i.severity, title: i.title, category: i.category, status: i.status, where: i.url_pattern, people: (i.affected_personas ?? []).length, sessions: (i.session_ids ?? []).length, sessions_since_version: since ? (i.session_ids ?? []).filter((s) => since.has(s)).length : null, github: gl ? { url: gl.url, state: gl.state } : null, created_at: new Date(i.created_at).toISOString() };
  }).sort((a, b) => (SEV[a.severity] ?? 9) - (SEV[b.severity] ?? 9) || b.people - a.people);
}

export interface IssueDetail {
  id: string; launch_id: string | null; track: string; severity: string; title: string; description: string; category: string; status: string; where: string | null; recommendation: string | null;
  steps: string[]; reproduced: boolean | null;
  moments: { session_id: string; step_idx: number | null; persona_id: string; name: string; who: string; segment: string; locale: string; outcome: string | null; quote: string | null; screenshot: string | null }[];
  github: { url: string; state: string; number: number; verified_version: number | null } | null;
}

export async function issueDetail(id: string): Promise<IssueDetail | undefined> {
  const db = getDb();
  const [i] = await db.select().from(issues).where(eq(issues.id, id)); if (!i) return undefined;
  const { launches } = await import('@pux/db');
  const [l] = await db.select({ id: launches.id }).from(launches).where(eq(launches.app_version_id, i.app_version_id));
  const rp = i.repro_path_id ? (await db.select().from(reproPaths).where(eq(reproPaths.id, i.repro_path_id)))[0] : undefined;
  const cands = await db.select().from(issueCandidates).where(eq(issueCandidates.issue_id, i.id)).orderBy(desc(issueCandidates.created_at)).limit(12);
  const sids = [...new Set([...cands.map((c) => c.session_id), ...(i.session_ids ?? [])])].slice(0, 12);
  const ss = sids.length ? await db.select({ id: sessions.id, persona_id: sessions.persona_id, outcome: sessions.outcome }).from(sessions).where(inArray(sessions.id, sids)) : [];
  const ps = ss.length ? await db.select({ id: personas.id, spec: personas.spec, segment: personas.segment, locale: personas.locale }).from(personas).where(and(inArray(personas.id, ss.map((s) => s.persona_id)), eq(personas.active, true))) : [];
  const moments: IssueDetail['moments'] = [];
  for (const sid of sids) {
    const s = ss.find((x) => x.id === sid); if (!s) continue;
    const p = ps.find((x) => x.id === s.persona_id); const spec = p?.spec as PersonaSpec | undefined;
    const c = cands.find((x) => x.session_id === sid);
    const idx = c?.step_idx ?? null;
    const st = idx != null ? (await db.select({ monologue: steps.monologue, observation_id: steps.observation_id }).from(steps).where(and(eq(steps.session_id, sid), eq(steps.idx, idx))))[0] : undefined;
    const shot = (c?.evidence_ids ?? [])[0] ?? null;
    moments.push({ session_id: sid, step_idx: idx, persona_id: s.persona_id, name: spec?.identity.name ?? s.persona_id, who: spec ? `${spec.identity.age} 岁，${spec.identity.occupation}` : '', segment: p?.segment ?? '', locale: p?.locale ?? '', outcome: s.outcome, quote: st?.monologue?.slice(0, 240) ?? null, screenshot: shot });
  }
  const [gl] = await db.select().from(issueLinks).where(eq(issueLinks.issue_id, i.id)).orderBy(desc(issueLinks.created_at)).limit(1);
  return {
    id: i.id, launch_id: l?.id ?? null, track: i.track, severity: i.severity, title: i.title, description: i.description ?? '', category: i.category, status: i.status, where: i.url_pattern, recommendation: i.recommendation,
    steps: rp ? (rp.steps as { verb: string; target_name?: string; args?: { text?: string } }[]).map((s) => `${s.verb}${s.target_name ? ` "${s.target_name}"` : ''}${s.args?.text ? ` → "${String(s.args.text).slice(0, 60)}"` : ''}`) : [],
    reproduced: rp ? rp.replay_ok_rate === 1 : null, moments,
    github: gl ? { url: gl.url, state: gl.state, number: gl.number, verified_version: gl.verified_version } : null,
  };
}

export async function triageIssue(id: string, status: string) {
  if (!(TRIAGE_STATUSES as readonly string[]).includes(status)) throw new Error('bad_status');
  await getDb().update(issues).set({ status }).where(eq(issues.id, id));
}

export interface VersionCompare { versions: { n: number; note: string | null; at: string; sessions: number; finished: number; succeeded: number; gave_up: number }[]; issues: { id: string; severity: string; title: string; by_version: number[] }[] }

/** 按版本点切开：每一版里开始了几次使用、几次办成、几次放弃，每个亲历问题在每一版里出现了几次 */
export async function compareVersions(l: LaunchRow): Promise<VersionCompare> {
  const db = getDb();
  const vs = await launchVersionList(l);
  const ss = await db.select({ id: sessions.id, started_at: sessions.started_at, status: sessions.status, outcome: sessions.outcome }).from(sessions).where(eq(sessions.study_id, l.study_id));
  const versionOf = (t: Date | null) => { if (!t) return -1; let k = 0; for (let i = 0; i < vs.length; i++) if (t.getTime() >= Date.parse(vs[i].at)) k = i; return k; };
  const vOfSession = new Map(ss.map((s) => [s.id, versionOf(s.started_at)]));
  const versions = vs.map((v, k) => {
    const mine = ss.filter((s) => vOfSession.get(s.id) === k);
    return { ...v, sessions: mine.length, finished: mine.filter((s) => !!s.outcome).length, succeeded: mine.filter((s) => s.outcome === 'success').length, gave_up: mine.filter((s) => s.outcome === 'gave_up').length };
  });
  const rows = (await db.select().from(issues).where(and(eq(issues.app_version_id, l.app_version_id), eq(issues.track, 'experience')))).filter((i) => !['rejected', 'folded'].includes(i.status));
  const out = rows.map((i) => { const by = vs.map(() => 0); for (const s of i.session_ids ?? []) { const k = vOfSession.get(s); if (k !== undefined && k >= 0) by[k]++; } return { id: i.id, severity: i.severity, title: i.title, by_version: by }; });
  return { versions, issues: out.sort((a, b) => (SEV[a.severity] ?? 9) - (SEV[b.severity] ?? 9)) };
}

/** 交给 coding agent 的修复任务（Markdown）：问题、谁在哪一步遇到、原话、复现步骤、证据链接、怎么验收 */
export function fixTaskText(l: { id: string; name: string; url: string }, d: IssueDetail, link: (path: string) => string): string {
  const lines = [
    `# 修复：${d.title}`, '',
    `产品「${l.name}」（${l.url}）在 Jobs 的虚拟城里被居民用的时候遇到的问题。严重度 ${d.severity}${d.where ? `，位置 ${d.where}` : ''}。`, '',
    '## 发生了什么', d.description || '（没有更多描述）', '',
  ];
  if (d.moments.length) {
    lines.push('## 谁遇到了');
    for (const m of d.moments.slice(0, 6)) lines.push(`- ${m.name}（${m.who}）${m.quote ? `：「${m.quote}」` : ''}${m.screenshot ? ` [当时的截图](${link(`/api/v1/evidence/${m.screenshot}`)})` : ''} · [这次使用](${link(`/sessions/${m.session_id}`)})`);
    lines.push('');
  }
  if (d.steps.length) lines.push('## 复现步骤', ...d.steps.map((s, i) => `${i + 1}. ${s}`), d.reproduced ? '（Jobs 已经按这些步骤干净地重放过，能复现）' : '', '');
  if (d.recommendation) lines.push('## 建议', d.recommendation, '');
  lines.push('## 验收', `1. 修好并部署到 ${l.url}。`, `2. 告诉 Jobs 线上已经是新版本：\`jobsworld\` 的 mark_new_version（MCP）或在网页产品页「标记新版本」。`, `3. 请几个人再用一遍（invite_people / \`jobsworld invite ${l.id} -n 3\`），等他们用完后看问题清单里这一条在新版本里还出现没有。`);
  return lines.filter((x, i, a) => !(x === '' && a[i - 1] === '')).join('\n').trim();
}
