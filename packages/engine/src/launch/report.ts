// 一页人话：这个产品在城里过得怎么样。每句结论都指回当时那个人、那一步、那句话（点开就是画面）。
// 数字是这座城里实际发生的人数（模拟），不是对真实市场的预测。技术信号与专家检查在工程附录里，不出现在这一页。
import { z, type PersonaSpec, langOf } from '@pux/core';
import { and, eq, exposures, getDb, inArray, interviews, issues, launchReports, observations, personas, posts, sessions, steps, storeReviews } from '@pux/db';
import { gateway } from '@pux/llm';
import { launchFunnel, type Funnel, type LaunchRow } from './launch.ts';

export interface Moment { ref: string; session_id: string; step_idx: number; persona_id: string; persona: string; who: string; quote: string; screenshot_ev?: string; kind: 'first_look' | 'stuck' | 'left' | 'done' | 'said_after' | 'review' | 'post' }
export interface Passerby { ref: string; persona_id: string; persona: string; who: string; channel: string; reaction: string; thought: string }
export interface Cited { text: string; moments: Moment[]; passersby: Passerby[] }
export interface LaunchReport {
  launch_id: string; lang: 'zh' | 'en'; generated_at: string; basis: string;
  verdict: 'works' | 'mixed' | 'not_yet' | 'too_early'; headline: string; summary: string;
  hurts: Cited[]; delights: Cited[]; who_stays: Cited[]; who_leaves: Cited[]; why_not_opened: Cited[]; next: string;
  funnel: Funnel; people_used: number; simulated: true;
}

const Item = z.object({ text: z.string(), refs: z.array(z.string()) });
const ReportSchema = z.object({
  verdict: z.enum(['works', 'mixed', 'not_yet']), headline: z.string(), summary: z.string(),
  hurts: z.array(Item), delights: z.array(Item), who_stays: z.array(Item), who_leaves: z.array(Item), why_not_opened: z.array(Item), next: z.string(),
});

const brief = (p: PersonaSpec, zh: boolean) => (zh ? `${p.identity.age} 岁${p.identity.gender}，${p.identity.occupation}` : `${p.identity.age}, ${p.identity.gender}, ${p.identity.occupation}`);

/** 收集素材：每个人使用过程中的关键时刻（第一眼、卡住、离开、办成）、用完后说的话、评论与动态，以及路过没点开的人的想法 */
export async function gatherMoments(l: LaunchRow): Promise<{ moments: Moment[]; passersby: Passerby[]; sessions: number; people: Map<string, PersonaSpec> }> {
  const db = getDb();
  const ss = (await db.select().from(sessions).where(eq(sessions.study_id, l.study_id))).filter((s) => s.status === 'evaluated' || s.status === 'finished');
  const ex = await db.select().from(exposures).where(eq(exposures.launch_id, l.id));
  const ids = [...new Set([...ss.map((s) => s.persona_id), ...ex.map((e) => e.persona_id)])];
  const ps = ids.length ? await db.select({ id: personas.id, spec: personas.spec }).from(personas).where(and(inArray(personas.id, ids), eq(personas.active, true))) : [];
  const people = new Map(ps.map((p) => [p.id, p.spec as PersonaSpec]));
  const moments: Moment[] = []; let n = 0;
  const add = (m: Omit<Moment, 'ref' | 'persona' | 'who'>) => { const p = people.get(m.persona_id); if (!p || !m.quote.trim()) return; moments.push({ ...m, ref: `m${++n}`, persona: p.identity.name, who: brief(p, langOf(p.locale) === 'zh'), quote: m.quote.trim().slice(0, 220) }); };
  for (const s of ss.slice(-60)) {
    const st = await db.select().from(steps).where(eq(steps.session_id, s.id)).orderBy(steps.idx);
    const obs = await db.select({ step_idx: observations.step_idx, data: observations.data }).from(observations).where(eq(observations.session_id, s.id));
    const shot = (i: number) => (obs.find((o) => o.step_idx === i)?.data as { screenshot_ev?: string } | undefined)?.screenshot_ev;
    if (!st.length) continue;
    add({ session_id: s.id, step_idx: 0, persona_id: s.persona_id, quote: st[0].monologue ?? '', screenshot_ev: shot(0), kind: 'first_look' });
    for (let i = 0; i < st.length - 1; i++) if (st[i].expectation_violated) add({ session_id: s.id, step_idx: st[i + 1].idx, persona_id: s.persona_id, quote: st[i + 1].monologue ?? '', screenshot_ev: shot(st[i + 1].idx), kind: 'stuck' });
    const last = st[st.length - 1];
    add({ session_id: s.id, step_idx: last.idx, persona_id: s.persona_id, quote: s.outcome === 'success' ? (last.monologue ?? '') : `${last.monologue ?? ''}${s.end_reason ? `（${s.end_reason.slice(0, 80)}）` : ''}`, screenshot_ev: shot(last.idx), kind: s.outcome === 'success' ? 'done' : 'left' });
    const [iv] = await db.select().from(interviews).where(and(eq(interviews.session_id, s.id), eq(interviews.kind, 'post_session')));
    for (const qa of (iv?.qa ?? []).slice(1, 4)) add({ session_id: s.id, step_idx: last.idx, persona_id: s.persona_id, quote: qa.a, screenshot_ev: shot(last.idx), kind: 'said_after' });
  }
  for (const r of await db.select().from(storeReviews).where(eq(storeReviews.launch_id, l.id))) add({ session_id: r.session_id ?? '', step_idx: 0, persona_id: r.persona_id, quote: `${'★'.repeat(r.rating)} ${r.body}`, kind: 'review' });
  for (const p of await db.select().from(posts).where(eq(posts.launch_id, l.id))) add({ session_id: p.session_id ?? '', step_idx: 0, persona_id: p.persona_id, quote: p.body, kind: 'post' });
  const passersby: Passerby[] = ex.filter((e) => ['not_for_me', 'ignored', 'curious_later'].includes(e.reaction) && e.thought).slice(-50).map((e, i) => { const p = people.get(e.persona_id); return p ? { ref: `x${i + 1}`, persona_id: e.persona_id, persona: p.identity.name, who: brief(p, langOf(p.locale) === 'zh'), channel: e.channel, reaction: e.reaction, thought: e.thought! } : undefined; }).filter((x): x is Passerby => !!x);
  return { moments: moments.slice(-140), passersby, sessions: ss.length, people };
}

/** 生成（或读取缓存的）一页结论 */
export async function launchReport(l: LaunchRow, lang: 'zh' | 'en' = 'zh', opts: { force?: boolean } = {}): Promise<LaunchReport> {
  const db = getDb(); const zh = lang === 'zh';
  const funnel = await launchFunnel(l.id);
  const { moments, passersby, sessions: nSess, people } = await gatherMoments(l);
  const used = new Set(moments.filter((m) => m.session_id).map((m) => m.persona_id)).size;
  // 什么时候重新归纳：有人用完了、有了新评论，或者路过没点开的人明显变多了。只是多几个人刷到广告不重算（那只改人数，人数每次都取最新）
  const basis = `${nSess}:${funnel.reviews}:${moments.length}:${Math.floor(passersby.length / 10)}:${funnel.reached > 0 ? 1 : 0}:${funnel.opened > 0 ? 1 : 0}`;
  const [cached] = await db.select().from(launchReports).where(and(eq(launchReports.launch_id, l.id), eq(launchReports.lang, lang)));
  if (cached && cached.basis === basis && !opts.force) return { ...(cached.data as LaunchReport), funnel, people_used: used };
  const base = { launch_id: l.id, lang, generated_at: new Date().toISOString(), basis, funnel, people_used: used, simulated: true as const };
  if (nSess === 0) {
    // 还没有人打开过：只说「为什么没点开」
    // 有人已经打开、只是还没用完时，不能说「没有人点开」
    const using = funnel.opened > 0;
    const headline = zh ? (using ? '有人正在用，还没有人用完' : funnel.reached ? '看到的人还没有谁点开' : '还没有人看到它') : (using ? 'People are using it; nobody has finished yet' : funnel.reached ? 'People saw it, nobody opened it yet' : 'Nobody has seen it yet');
    const summary = zh
      ? (using ? `${funnel.reached} 个人看到过，${funnel.opened} 个人打开了，还在用。等他们用完再来看。` : funnel.reached ? `${funnel.reached} 个人看到过，${funnel.noticed} 个人注意到了，还没有人点开。` : '城里的人还没遇到它。可以把宣发强度调高，或者把手机递给几个人试试。')
      : (using ? `${funnel.reached} people saw it and ${funnel.opened} opened it; they are still using it. Check back when they finish.` : funnel.reached ? `${funnel.reached} people saw it, ${funnel.noticed} noticed, none opened it yet.` : 'Nobody in town has come across it yet. Raise the promotion, or hand it to a few people.');
    const rep: LaunchReport = { ...base, verdict: 'too_early', headline, summary, hurts: [], delights: [], who_stays: [], who_leaves: [], why_not_opened: passersby.filter((x) => x.reaction === 'not_for_me').slice(0, 3).map((x) => ({ text: x.thought, moments: [], passersby: [x] })), next: '' };
    await save(l.id, lang, basis, rep); return rep;
  }
  const iss = (await db.select().from(issues).where(and(eq(issues.app_version_id, l.app_version_id), eq(issues.track, 'experience')))).filter((i) => !['rejected', 'folded'].includes(i.status));
  const sys = zh
    ? `你在替一位独立开发者看他的产品「${l.name}」（${l.tagline}）发布到一座模拟小城之后发生了什么。下面是城里的人真实留下的痕迹：使用时的想法（m 编号）、路过没点开的人的想法（x 编号）、归并后的问题、漏斗人数。请写一页给他看的结论。
要求：
- 用大白话，像朋友当面跟他说。不要出现任何技术词（接口、DOM、路由、状态码、可用性、启发式、转化率、SUS 等），不要客套，不要建议他「持续优化」这类空话。
- 每一条都必须有 refs（引用 m 或 x 编号，1–4 个），没有痕迹支撑的话不要写。
- hurts：最让人难受的地方，最多 3 条，按伤害大小排。写清楚「人想做什么、看到了什么、然后怎样了」。
- delights：真正让人高兴或顺手的地方，最多 3 条；没有就给空数组，不要硬凑。
- who_stays / who_leaves：什么样的人会留下、什么样的人会走（用生活化的描述，如「下班后才有空的上班族」，不要用人群标签），各最多 3 条。
- why_not_opened：看到了却没点开的人是怎么想的，最多 3 条（引用 x 编号）。
- headline：一句话结论，不超过 22 个字。verdict：works（多数人用得下去）、mixed（有人行有人不行）、not_yet（多数人用不下去）。
- summary：两三句话说清现在的状况。next：如果只改一件事，改哪件（一句话，具体到哪个地方）。
- 痕迹里如果有人说屏幕「模糊」「看不清某一块」，那是他当时没细看，不是产品的毛病，不要写进结论。
样本很小时要老实说（例如「目前只有 3 个人用过」）。
所有字段都用中文写，即使痕迹里有别的语言。`
    : `You're looking, on behalf of an indie developer, at what happened after their product "${l.name}" (${l.tagline}) was released into a simulated town. Below are traces people actually left: thoughts while using it (m refs), thoughts of people who saw it and didn't open it (x refs), merged issues, funnel counts. Write the one page they should read.
Rules:
- Plain words, like a friend telling them face to face. No technical terms (API, DOM, routing, status codes, usability, heuristics, conversion rate, SUS…), no pleasantries, no filler like "keep iterating".
- Every item needs refs (1–4 m or x ids). If no trace supports it, don't write it.
- hurts: what hurt people most, up to 3, worst first: what they wanted, what they saw, what happened.
- delights: what genuinely pleased people, up to 3; empty array if none — don't invent.
- who_stays / who_leaves: what kind of person stays or leaves (everyday descriptions like "office workers who only have time after work", not segment labels), up to 3 each.
- why_not_opened: what people who saw it but didn't open were thinking, up to 3 (x refs).
- headline: one sentence, at most 12 words. verdict: works / mixed / not_yet.
- summary: two or three sentences on where things stand. next: if only one thing gets fixed, which (one concrete sentence).
- If a trace mentions the screen being blurry or an area hard to make out, that person simply wasn't looking closely; it is not a product flaw, leave it out.
Say so plainly when the sample is tiny.
Write every field in English, even when the traces are in another language.`;
  const kindZh: Record<string, string> = { first_look: '第一眼', stuck: '卡住', left: '走了', done: '办成了', said_after: '用完后说', review: '商店评论', post: '公开动态' };
  const user = `${zh ? '漏斗（人数）' : 'Funnel (people)'}：${JSON.stringify({ saw: funnel.reached, noticed: funnel.noticed, interested: funnel.interested, opened: funnel.opened, came_back: funnel.came_back, rating: funnel.rating, reviews: funnel.reviews })}
${zh ? '用过的人数' : 'People who used it'}：${used}（${nSess} ${zh ? '次使用' : 'sessions'}）

${zh ? '使用时留下的痕迹' : 'Traces from use'}：
${moments.map((m) => `${m.ref} | ${m.persona}（${m.who}）| ${zh ? kindZh[m.kind] : m.kind} | ${m.quote}`).join('\n')}

${zh ? '路过没点开的人' : 'People who passed by'}：
${passersby.map((x) => `${x.ref} | ${x.persona}（${x.who}）| ${x.channel} | ${x.reaction} | ${x.thought}`).join('\n') || '—'}

${zh ? '归并后的问题（虚拟人亲历）' : 'Merged issues (experienced)'}：
${iss.slice(0, 20).map((i) => `- [${i.severity}] ${zh ? i.title : (i.title_en ?? i.title)}（${(i.session_ids ?? []).length} ${zh ? '次使用遇到' : 'sessions'}）`).join('\n') || '—'}`;
  const r = await gateway().chatWithFallback(['judge_meta', 'judge_0'], { messages: [{ role: 'system', content: sys }, { role: 'user', content: user }], schema: ReportSchema, schemaName: 'launch_report', reasoning: 'medium', tags: { study_id: l.study_id, purpose: 'launch_report' } });
  const mById = new Map(moments.map((m) => [m.ref, m])); const xById = new Map(passersby.map((x) => [x.ref, x]));
  const cite = (it: z.infer<typeof Item>): Cited => ({ text: it.text.trim(), moments: it.refs.map((x) => mById.get(x.trim())).filter((x): x is Moment => !!x).slice(0, 4), passersby: it.refs.map((x) => xById.get(x.trim())).filter((x): x is Passerby => !!x).slice(0, 4) });
  const keep = (xs: z.infer<typeof Item>[]) => xs.map(cite).filter((c) => c.text && (c.moments.length || c.passersby.length)).slice(0, 3);
  const d = r.data;
  const rep: LaunchReport = { ...base, verdict: d.verdict, headline: d.headline.trim(), summary: d.summary.trim(), hurts: keep(d.hurts), delights: keep(d.delights), who_stays: keep(d.who_stays), who_leaves: keep(d.who_leaves), why_not_opened: keep(d.why_not_opened), next: d.next.trim() };
  void people;
  await save(l.id, lang, basis, rep);
  return rep;
}

async function save(launchId: string, lang: string, basis: string, data: LaunchReport) {
  await getDb().insert(launchReports).values({ launch_id: launchId, lang, basis, data }).onConflictDoUpdate({ target: [launchReports.launch_id, launchReports.lang], set: { basis, data, created_at: new Date() } });
}

/** 工程附录：用户看不到的技术信号与专家检查（给开发者或 coding agent） */
export async function engineeringAppendix(l: LaunchRow) {
  const rows = (await getDb().select().from(issues).where(and(eq(issues.app_version_id, l.app_version_id), eq(issues.track, 'engineering')))).filter((i) => !['rejected', 'folded'].includes(i.status));
  const order: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
  return rows.sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9)).map((i) => ({ id: i.id, severity: i.severity, category: i.category, title: i.title, title_en: i.title_en, description: (i.description ?? '').split('\n\n')[0], recommendation: i.recommendation, where: i.url_pattern, sessions: (i.session_ids ?? []).length }));
}

/** 虚拟人亲历的问题（结构化，给 coding agent 用：含复现步骤） */
export async function experiencedIssues(l: LaunchRow) {
  const db = getDb(); const { reproPaths } = await import('@pux/db');
  const rows = (await db.select().from(issues).where(and(eq(issues.app_version_id, l.app_version_id), eq(issues.track, 'experience')))).filter((i) => !['rejected', 'folded'].includes(i.status));
  const out = [];
  for (const i of rows) {
    const rp = i.repro_path_id ? (await db.select().from(reproPaths).where(eq(reproPaths.id, i.repro_path_id)))[0] : undefined;
    out.push({ id: i.id, severity: i.severity, title: i.title, title_en: i.title_en, description: (i.description ?? '').split('\n\n')[0], where: i.url_pattern, people: (i.affected_personas ?? []).length, sessions: (i.session_ids ?? []).length, reproduced: rp ? rp.replay_ok_rate === 1 : null, steps: rp ? (rp.steps as { verb: string; target_name?: string; args?: { text?: string } }[]).map((s) => `${s.verb}${s.target_name ? ` "${s.target_name}"` : ''}${s.args?.text ? ` → "${String(s.args.text).slice(0, 60)}"` : ''}`) : [] });
  }
  const order: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
  return out.sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9));
}
