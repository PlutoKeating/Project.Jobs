// 推送的规矩（纯函数，便于测试）：什么事实时说、什么合并说、什么不说；早报晚报什么时候发；偏好怎么改、怎么念给人听。
// 决策 9–12：实时只推「严重问题第一次出现」「结论有实质变化」「需要你介入」（以及修好后的自动验证）；其余合并成一条；早报 / 晚报；一句话就能改偏好。
import type { NoticeMsg } from '@pux/jobsworld';

export interface Prefs {
  /** 严重问题（P0、P1）第一次出现时马上说 */
  issues: boolean;
  /** 结论有实质变化（一句话结论变了）时马上说 */
  reports: boolean;
  /** 需要人介入时马上说 */
  human: boolean;
  /** 需要人介入时用应用内加急 */
  urgent: boolean;
  /** 其余的事（有人用完、次要问题）合并成一条的时间窗（分钟）；0 = 不发 */
  merge_minutes: number;
  /** 早报、晚报的时刻（HH:MM，按 tz）；null = 不发 */
  morning: string | null;
  evening: string | null;
  tz: string;
  /** 每个产品一张会自己刷新的看板卡 */
  boards: boolean;
  /** 只关心这些产品（发布 id）；null = 全部 */
  products: string[] | null;
}

export const DEFAULT_PREFS: Prefs = { issues: true, reports: true, human: true, urgent: true, merge_minutes: 30, morning: '08:30', evening: '19:00', tz: 'Asia/Shanghai', boards: true, products: null };
export const prefsOf = (p: Partial<Prefs> | undefined | null): Prefs => ({ ...DEFAULT_PREFS, ...(p ?? {}) });

const SERIOUS = new Set(['P0', 'P1']);
export type Route = 'now' | 'merge' | 'drop';

/** 一件事该怎么说 */
export function route(n: NoticeMsg, p: Prefs): Route {
  const lid = 'launch_id' in n ? n.launch_id : undefined;
  if (lid && p.products && !p.products.includes(lid)) return 'drop';
  switch (n.kind) {
    case 'human': return p.human ? 'now' : 'drop';
    case 'issue_new': return SERIOUS.has(n.severity) && p.issues ? 'now' : p.merge_minutes > 0 ? 'merge' : 'drop';
    case 'report': return p.reports ? 'now' : 'drop';
    case 'fix_verify': return 'now';
    case 'session_end': return p.merge_minutes > 0 ? 'merge' : 'drop';
    default: return 'drop';
  }
}

/** 一句话结论算不算「实质变化」：之前没说过、或者结论档位变了、或者一句话本身变了 */
export function reportChanged(prev: { headline: string; verdict: string } | undefined, n: { headline: string; verdict: string }): boolean {
  if (!prev) return true;
  if (prev.verdict !== n.verdict) return true;
  const norm = (s: string) => s.replace(/[\s，。,.！!？?、“”"'「」]/g, '');
  return norm(prev.headline) !== norm(n.headline);
}

const hm = (d: Date, tz: string) => { const s = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }); return s; };
const day = (d: Date, tz: string) => d.toLocaleDateString('en-CA', { timeZone: tz });

/** 现在该不该发早报 / 晚报（到了时刻、今天还没发过） */
export function dueDigests(now: Date, p: Prefs, last: Record<string, string>): ('morning' | 'evening')[] {
  const out: ('morning' | 'evening')[] = []; const t = hm(now, p.tz); const today = day(now, p.tz);
  for (const k of ['morning', 'evening'] as const) { const at = p[k]; if (at && t >= at && last[k] !== today && t < addMinutes(at, 90)) out.push(k); }
  return out;
}
const addMinutes = (at: string, m: number) => { const [h, mm] = at.split(':').map(Number); const x = h * 60 + mm + m; return x >= 24 * 60 ? '24:00' : `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; };
export const todayIn = (now: Date, tz: string) => day(now, tz);

/** 合并窗口到没到（最早的一件等够了 merge_minutes） */
export const mergeDue = (pending: { ts: number }[], p: Prefs, now = Date.now()) => p.merge_minutes > 0 && pending.length > 0 && now - Math.min(...pending.map((x) => x.ts)) >= p.merge_minutes * 60_000;

const OUT: Record<string, string> = { success: '办成', gave_up: '放弃', resource_exhausted: '没时间', stalled: '卡住', blocked: '被拦住', sim_error: '模拟出错' };
/** 合并的那一条：按产品说有几个人用完、结局分布，次要的新问题 */
export function mergeText(pending: NoticeMsg[], names: Map<string, string>, minutes: number): string {
  const by = new Map<string, { ends: string[]; issues: string[] }>();
  for (const n of pending) {
    if (!('launch_id' in n)) continue;
    const g = by.get(n.launch_id) ?? { ends: [], issues: [] }; by.set(n.launch_id, g);
    if (n.kind === 'session_end') g.ends.push(n.outcome ?? 'unknown'); else if (n.kind === 'issue_new') g.issues.push(`[${n.severity}] ${n.title}`);
  }
  const lines: string[] = [];
  for (const [id, g] of by) {
    const name = names.get(id) ?? id; const parts: string[] = [];
    if (g.ends.length) { const c = new Map<string, number>(); for (const o of g.ends) c.set(o, (c.get(o) ?? 0) + 1); parts.push(`${g.ends.length} 人用完（${[...c].map(([o, k]) => `${OUT[o] ?? o} ${k}`).join('、')}）`); }
    if (g.issues.length) parts.push(`新问题：${g.issues.slice(0, 3).join('；')}`);
    if (parts.length) lines.push(`**${name}**：${parts.join('；')}`);
  }
  return lines.length ? `过去 ${minutes} 分钟里：\n${lines.join('\n')}` : '';
}

/** 偏好念给人听 */
export function prefsText(p: Prefs, products?: Map<string, string>): string {
  return [
    `马上告诉你：${[p.issues && '严重问题第一次出现', p.reports && '结论有实质变化', p.human && `需要你介入${p.urgent ? '（应用内加急）' : ''}`].filter(Boolean).join('、') || '（都关了）'}`,
    `其余的事：${p.merge_minutes > 0 ? `每 ${p.merge_minutes} 分钟合并成一条` : '不发'}`,
    `早报 ${p.morning ?? '关'} · 晚报 ${p.evening ?? '关'}（${p.tz}）`,
    `看板卡：${p.boards ? '开' : '关'}`,
    `只关心：${p.products ? p.products.map((id) => products?.get(id) ?? id).join('、') : '全部产品'}`,
  ].join('\n');
}

/** 改偏好（工具的参数 → 新偏好）；时刻写 off 关掉 */
export function applyPrefs(p: Prefs, a: { issues?: boolean; reports?: boolean; human?: boolean; urgent?: boolean; merge_minutes?: number; morning?: string; evening?: string; boards?: boolean; products?: string[] | 'all'; tz?: string }): Prefs {
  const time = (v: string | undefined, cur: string | null) => (v === undefined ? cur : /^(off|关|none|no|null)$/i.test(v.trim()) ? null : /^\d{1,2}:\d{2}$/.test(v.trim()) ? v.trim().padStart(5, '0') : cur);
  return {
    ...p,
    ...(a.issues !== undefined ? { issues: a.issues } : {}), ...(a.reports !== undefined ? { reports: a.reports } : {}), ...(a.human !== undefined ? { human: a.human } : {}), ...(a.urgent !== undefined ? { urgent: a.urgent } : {}),
    ...(a.merge_minutes !== undefined ? { merge_minutes: Math.max(0, Math.min(24 * 60, Math.round(a.merge_minutes))) } : {}),
    morning: time(a.morning, p.morning), evening: time(a.evening, p.evening),
    ...(a.boards !== undefined ? { boards: a.boards } : {}), ...(a.products !== undefined ? { products: a.products === 'all' || !a.products.length ? null : a.products } : {}), ...(a.tz ? { tz: a.tz } : {}),
  };
}
