// 使用：一个人决定打开产品 → 一次使用（在他此时此地的处境里）→ 用完之后要不要评分、发帖、跟人说、以后还来不来。
import { logger, newId, type PersonaSpec, langOf } from '@pux/core';
import { and, eq, exposures, getDb, goals, intentions, launches, personas, posts, sessions, storeReviews } from '@pux/db';
import { absMinute, dayIndex, liveContextFor, tiesOf, type LiveContext } from '@pux/jobsworld';
import { rememberLife } from '../human/memory.ts';
import { contextRecord, nextFreeContext } from '../world/live.ts';
import { addIntention, recordExposure, whatTheySee, type Channel } from './exposure.ts';
import type { LaunchRow } from './launch.ts';

export interface AfterUse { store_rating: number; store_review: string; tell_who: string; tell_what: string; public_post: string; come_back: 'never' | 'if_needed' | 'soon' | 'habit'; come_back_for: string }

/**
 * 发起一次使用。goal 是这个人自己说的想用它做的事；处境是他此时此地在城里的状态。
 * 从广告、广告牌、动态、熟人那里来的人，如果产品有落地页，先到落地页。
 */
export async function startUsage(l: LaunchRow, p: PersonaSpec, o: { channel: Channel; want: string; found: string; ctx: LiveContext; invited?: boolean; exposureId?: string; source?: string }): Promise<string> {
  const db = getDb(); const zh = langOf(p.locale) === 'zh';
  const prior = (await db.select({ id: sessions.id }).from(sessions).where(and(eq(sessions.study_id, l.study_id), eq(sessions.persona_id, p.id)))).length;
  const [ver] = await db.select({ version: personas.version }).from(personas).where(and(eq(personas.id, p.id), eq(personas.active, true)));
  const goalId = newId('goal');
  const statement = o.want.trim() || (zh ? `看看「${l.name}」是什么、对我有没有用` : `See what "${l.name}" is and whether it's any use to me`);
  await db.insert(goals).values({ id: goalId, study_id: l.study_id, kind: prior ? 'life_goal' : 'curiosity', statement_for_persona: statement, locale: p.locale });
  const entry = l.landing_url && ['ad', 'billboard', 'feed', 'word_of_mouth'].includes(o.channel) && !prior ? l.landing_url : l.url;
  const id = newId('ses');
  await db.insert(sessions).values({
    id, study_id: l.study_id, round: 0, persona_id: p.id, persona_version: ver.version, world_template_id: 'live', world_context: contextRecord(o.ctx), goal_id: goalId,
    mode: o.invited ? 'goal' : prior ? 'goal' : 'curiosity', revisit_day: 0, plan_reason: { launch_id: l.id, channel: o.channel, found: o.found, entry_url: entry, invited: !!o.invited, visit: prior + 1, source: o.source },
    rng_seed: Math.floor(Math.random() * 1_000_000), executor: 'midscene',
  });
  if (o.exposureId) await db.update(exposures).set({ reaction: 'opened', session_id: id }).where(eq(exposures.id, o.exposureId));
  return id;
}

/** 定向邀请：把手机递给一批人（「试试这个？」）。受邀的使用单独标注，不算自然流量 */
export async function inviteToLaunch(l: LaunchRow, people: { id: string; spec: PersonaSpec }[], opts: { want?: string } = {}): Promise<string[]> {
  const out: string[] = [];
  for (const p of people) {
    const ctx = await nextFreeContext(p.id).catch(() => undefined);
    if (!ctx) continue;
    const lang = langOf(p.spec.locale);
    const found = whatTheySee(l, 'invite', lang);
    const exp = await recordExposure({ launch_id: l.id, persona_id: p.id, channel: 'invite', world_min: absMinute(ctx.date, ctx.minute), place_id: ctx.place_id, reaction: 'opened', thought: lang === 'zh' ? '（有人请我试试）' : '(someone asked me to try it)' });
    out.push(await startUsage(l, p.spec, { channel: 'invite', want: opts.want ?? '', found, ctx, invited: true, exposureId: exp }));
  }
  return out;
}

/**
 * 用完之后：按这个人自己在回想时说的（见记忆整理），去商店评分、公开发帖、跟熟人提起、留下以后再来的念头。
 * 大多数人用完什么也不写、什么也不说。
 */
export async function afterUse(sessionId: string): Promise<{ review: boolean; post: boolean; told?: string; come_back: string }> {
  const db = getDb();
  const [s] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
  const pr = (s?.plan_reason ?? {}) as { launch_id?: string };
  const out = { review: false, post: false, told: undefined as string | undefined, come_back: 'never' };
  if (!s || !pr.launch_id) return out;
  const [l] = await db.select().from(launches).where(eq(launches.id, pr.launch_id));
  const a = (s.summary as { memory?: Partial<AfterUse> } | null)?.memory;
  if (!l || !a) return out;
  const rec = s.world_context as { date?: string; clock?: string; day?: number } | null;
  const clk = rec?.date ? { date: rec.date, minute: Number(rec.clock?.slice(0, 2) ?? 0) * 60 + Number(rec.clock?.slice(3, 5) ?? 0) } : undefined;
  const now = clk ? absMinute(clk.date, clk.minute) + 15 : 0;
  const rating = Math.round(Number(a.store_rating ?? 0));
  if (rating >= 1 && rating <= 5 && (a.store_review ?? '').trim()) { await db.insert(storeReviews).values({ id: newId('rev'), launch_id: l.id, persona_id: s.persona_id, session_id: s.id, rating, body: a.store_review!.trim().slice(0, 400), world_min: now }); out.review = true; }
  if ((a.public_post ?? '').trim()) { await db.insert(posts).values({ id: newId('post'), persona_id: s.persona_id, launch_id: l.id, session_id: s.id, body: a.public_post!.trim().slice(0, 400), sentiment: rating ? (rating - 3) / 2 : 0, world_min: now }); out.post = true; }
  // 跟熟人提起：对方记住「听谁说过」，下次有空时会想起来
  const who = (a.tell_who ?? '').trim(); const what = (a.tell_what ?? '').trim();
  if (who && what) {
    const tie = (await tiesOf(s.persona_id)).find((t) => t.name === who || who.includes(t.name) || t.name.includes(who));
    if (tie) {
      const [me] = await db.select({ spec: personas.spec }).from(personas).where(and(eq(personas.id, s.persona_id), eq(personas.active, true)));
      const myName = (me?.spec as PersonaSpec | undefined)?.identity.name ?? '';
      await rememberLife(tie.id, langOf((me?.spec as PersonaSpec).locale) === 'zh' ? `${myName}跟我说起过「${l.name}」：${what}` : `${myName} told me about "${l.name}": ${what}`, { simDay: rec?.day ?? (clk ? dayIndex(clk.date) : 0), kind: 'hearsay', valence: rating ? (rating - 3) / 2 : 0, importance: 0.45, appId: l.app_id }).catch((e) => logger.debug({ e }, '口碑记忆写入失败'));
      await db.insert(intentions).values({ id: newId('int'), launch_id: l.id, persona_id: tie.id, kind: 'try_later', reason: JSON.stringify({ from: s.persona_id, name: myName, kind: tie.kind, said: what }), strength: 0.55 + tie.strength * 0.4, created_min: now });
      out.told = tie.name;
    }
  }
  const cb = a.come_back ?? 'never'; out.come_back = cb;
  if (cb !== 'never') await addIntention(l.id, s.persona_id, 'return', a.come_back_for ?? '', cb === 'habit' ? 0.9 : cb === 'soon' ? 0.65 : 0.3, now);
  return out;
}

export { liveContextFor };
