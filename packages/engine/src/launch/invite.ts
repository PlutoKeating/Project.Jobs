// 把手机递给谁：从居民里按条件挑一批人。挑人是纯规则（可测试），说清楚「为什么是他们」和「为什么有些人没被请到」。
import type { PersonaSpec } from '@pux/core';

export interface InviteCandidate { id: string; segment: string; spec: PersonaSpec }
export interface InviteFilter { n?: number; segment?: string; locale?: string; query?: string; min_age?: number; max_age?: number; persona_ids?: string[] }
export interface InvitePick { picks: InviteCandidate[]; matched: number; locale: string; notes: string[] }

const CJK = /[㐀-鿿]/g;

/** 产品面向哪种语言：名字、一句话和介绍里汉字占多数就是中文，否则英文 */
export function productLocale(l: { name: string; tagline: string; description?: string | null }): 'zh-CN' | 'en-US' {
  const t = `${l.name} ${l.tagline} ${l.description ?? ''}`; const letters = t.replace(/[\s\d\p{P}]/gu, '').length || 1;
  return (t.match(CJK)?.length ?? 0) / letters >= 0.2 ? 'zh-CN' : 'en-US';
}

/**
 * 挑人。默认只请说产品所用语言的人（不指定 locale 时），优先没用过这个产品、此刻不在用别的产品的人；
 * 指定了 persona_ids 就照指定的来（不再按条件挑）。孩子默认不请。
 */
export function pickInvitees(roster: InviteCandidate[], f: InviteFilter, o: { used: Set<string>; busy: Set<string>; productLocale: string; shuffle: <T>(xs: T[]) => T[] }): InvitePick {
  const notes: string[] = [];
  const n = Math.max(1, Math.min(20, f.n ?? 3));
  const people = roster.filter((r) => r.spec.kind !== 'expert');
  if (f.persona_ids?.length) {
    const want = new Set(f.persona_ids); const hit = people.filter((r) => want.has(r.id));
    const miss = f.persona_ids.filter((id) => !hit.some((r) => r.id === id));
    if (miss.length) notes.push(`没有找到这些人：${miss.join('、')}`);
    return { picks: hit, matched: hit.length, locale: 'any', notes };
  }
  const locale = f.locale ?? o.productLocale;
  const q = (f.query ?? '').trim().toLowerCase();
  const fits = people.filter((r) => {
    const id = r.spec.identity;
    if (r.spec.kind === 'child') return false;
    if (f.segment && r.segment !== f.segment) return false;
    if (r.spec.locale !== locale) return false;
    if (f.min_age != null && id.age < f.min_age) return false;
    if (f.max_age != null && id.age > f.max_age) return false;
    if (q && ![id.name, id.occupation, id.region ?? '', id.life_story ?? ''].some((x) => x.toLowerCase().includes(q))) return false;
    return true;
  });
  if (!f.locale) notes.push(`按产品的语言只请说${locale === 'zh-CN' ? '中文' : '英文'}的人（想请别的语言的人可以指定 locale）`);
  const fresh = fits.filter((r) => !o.used.has(r.id) && !o.busy.has(r.id));
  const rest = fits.filter((r) => !fresh.includes(r));
  const picks = [...o.shuffle(fresh), ...o.shuffle(rest)].slice(0, n);
  if (fits.length < n) notes.push(`符合条件的只有 ${fits.length} 人，不够 ${n} 个${fits.length ? '，都请了' : '：放宽条件再试（可以先用 find_people 看看城里有谁）'}`);
  if (picks.some((p) => o.used.has(p.id))) notes.push('符合条件又没用过的人不够，补上了已经用过它的人');
  return { picks, matched: fits.length, locale, notes };
}
