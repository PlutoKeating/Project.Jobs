// 发布：把一个产品发布到 JobsWorld。此后城里的人会自己看到它、决定用不用、用完跟谁说。
import { chromium } from 'playwright';
import { logger, newId } from '@pux/core';
import { and, appVersions, apps, desc, eq, exposures, getDb, inArray, launches, sessions, storeReviews, studies, type AudienceRow } from '@pux/db';
import { putEvidence } from '@pux/executor';
import { absMinute, worldClock } from '@pux/jobsworld';
import { addApp, addVersion } from '../control/apps.ts';
import { createStudy } from '../control/study.ts';

export type LaunchRow = typeof launches.$inferSelect;
export interface PublishInput {
  name: string; tagline: string; url: string;
  landing_url?: string; description?: string; form?: 'web' | 'h5'; ad_text?: string;
  intensity?: number; audience?: AudienceRow; version?: string;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** 给商店页拍几张截图（手机和电脑各一张）。只是把页面的样子拍下来，不读页面内容 */
async function captureShots(url: string, ctx: { study_id: string }): Promise<string[]> {
  const out: string[] = [];
  let browser;
  try {
    browser = await chromium.launch({ headless: true, chromiumSandbox: false });
    for (const v of [{ width: 390, height: 844, mobile: true }, { width: 1280, height: 800, mobile: false }]) {
      const c = await browser.newContext({ viewport: { width: v.width, height: v.height }, ...(v.mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
      const p = await c.newPage();
      await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(() => {});
      await p.waitForTimeout(1200);
      const shot = await p.screenshot({ type: 'jpeg', quality: 72 }).catch(() => null);
      if (shot) out.push(await putEvidence('screenshot', ctx, { data: shot, mime: 'image/jpeg' }));
      await c.close();
    }
  } catch (e) { logger.warn({ err: String((e as Error).message).slice(0, 160) }, '商店截图失败'); }
  finally { await browser?.close().catch(() => {}); }
  return out;
}

/** 发布一个产品。同名产品再次发布视为新版本，之前的发布自动结束 */
export async function publishProduct(input: PublishInput): Promise<LaunchRow> {
  const db = getDb();
  if (!/^https?:\/\//i.test(input.url)) throw new Error('产品地址必须以 http:// 或 https:// 开头');
  const name = input.name.trim(); const tagline = input.tagline.trim();
  if (!name || !tagline) throw new Error('需要产品名和一句话介绍');
  const appId = await addApp({ name, form: input.form ?? 'web', description: `${tagline}${input.description ? `\n${input.description}` : ''}` });
  const prev = await db.select().from(launches).where(eq(launches.app_id, appId));
  const version = input.version ?? `v${prev.length + 1}`;
  const avId = await addVersion({ appId, version, url: input.url, prd: input.description });
  const st = await createStudy({ app_version_id: avId, name: `launch:${name}@${version}`, trigger: 'launch', judges: 1, interview: true, clean_replay: true, expert_baseline: false, budget: { max_sessions: 100_000, max_steps_per_session: 40, max_tokens: 2_000_000_000, max_tokens_per_session: 800_000, concurrency: 3, round_size: 1 } });
  await db.update(studies).set({ status: 'running', started_at: new Date() }).where(eq(studies.id, st.id));
  for (const p of prev.filter((x) => x.status !== 'ended')) await db.update(launches).set({ status: 'ended' }).where(eq(launches.id, p.id));
  const clk = await worldClock();
  const shots = await captureShots(input.landing_url || input.url, { study_id: st.id });
  const id = newId('lch');
  await db.insert(launches).values({
    id, app_id: appId, app_version_id: avId, study_id: st.id, name, tagline, description: input.description ?? null, url: input.url, landing_url: input.landing_url || null, form: input.form ?? 'web',
    shot_evs: shots, ad_text: input.ad_text ?? null, intensity: clamp01(input.intensity ?? 0.3), audience: input.audience ?? {}, published_min: absMinute(clk.date, clk.minute),
  });
  return (await db.select().from(launches).where(eq(launches.id, id)))[0];
}

/** 上帝视角的宣发旋钮：强度（悄悄上线 → 全城铺开）和投给谁；也可以暂停或结束 */
export async function setPromotion(id: string, patch: { intensity?: number; audience?: AudienceRow; status?: 'live' | 'paused' | 'ended'; ad_text?: string; tagline?: string }) {
  const set: Partial<LaunchRow> = {};
  if (patch.intensity !== undefined) set.intensity = clamp01(patch.intensity);
  if (patch.audience !== undefined) set.audience = patch.audience;
  if (patch.status) set.status = patch.status;
  if (patch.ad_text !== undefined) set.ad_text = patch.ad_text;
  if (patch.tagline) set.tagline = patch.tagline;
  if (Object.keys(set).length) await getDb().update(launches).set(set).where(eq(launches.id, id));
  return getLaunch(id);
}

export async function getLaunch(idOrName: string): Promise<LaunchRow | undefined> {
  const db = getDb();
  const [byId] = await db.select().from(launches).where(eq(launches.id, idOrName));
  if (byId) return byId;
  return (await db.select().from(launches).where(eq(launches.name, idOrName)).orderBy(desc(launches.created_at)))[0];
}
export async function listLaunches(opts: { liveOnly?: boolean } = {}): Promise<LaunchRow[]> {
  const rows = await getDb().select().from(launches).orderBy(desc(launches.created_at));
  return opts.liveOnly ? rows.filter((r) => r.status === 'live') : rows;
}

export interface Funnel { reached: number; noticed: number; interested: number; opened: number; came_back: number; using_now: number; sessions: number; reviews: number; rating: number | null; by_channel: Record<string, { reached: number; opened: number }> }

/** 漏斗（按人去重）：看到 → 注意到 → 有兴趣 → 打开过 → 回来再用。数字是这座城里实际发生的人数，不是对真实市场的预测 */
export async function launchFunnel(launchId: string): Promise<Funnel> {
  const db = getDb();
  const l = (await db.select().from(launches).where(eq(launches.id, launchId)))[0];
  const ex = await db.select().from(exposures).where(eq(exposures.launch_id, launchId));
  const ss = l ? await db.select({ id: sessions.id, persona_id: sessions.persona_id, status: sessions.status, started_at: sessions.started_at, ctx: sessions.world_context }).from(sessions).where(eq(sessions.study_id, l.study_id)) : [];
  const uniq = (xs: string[]) => new Set(xs).size;
  const opened = new Set(ss.map((s) => s.persona_id));
  const days = new Map<string, Set<number>>();
  for (const s of ss) { const d = (s.ctx as { day?: number } | null)?.day ?? 0; days.set(s.persona_id, (days.get(s.persona_id) ?? new Set()).add(d)); }
  const rv = await db.select().from(storeReviews).where(eq(storeReviews.launch_id, launchId));
  const by: Funnel['by_channel'] = {};
  for (const e of ex) { by[e.channel] ??= { reached: 0, opened: 0 }; by[e.channel].reached++; if (e.reaction === 'opened') by[e.channel].opened++; }
  return {
    reached: uniq([...ex.map((e) => e.persona_id), ...opened]), noticed: uniq([...ex.filter((e) => e.reaction !== 'unnoticed').map((e) => e.persona_id), ...opened]),
    interested: uniq([...ex.filter((e) => ['curious_later', 'opened'].includes(e.reaction)).map((e) => e.persona_id), ...opened]), opened: opened.size,
    came_back: [...days.values()].filter((d) => d.size >= 2).length, using_now: ss.filter((s) => s.status === 'running').length, sessions: ss.length,
    reviews: rv.length, rating: rv.length ? Math.round((rv.reduce((a, r) => a + r.rating, 0) / rv.length) * 10) / 10 : null, by_channel: by,
  };
}

/** 商店页：这座城里的人打开应用商店时看到的列表（按宣发强度、评分和新旧排序） */
export async function storeListing(): Promise<{ launch: LaunchRow; rating: number | null; reviews: { rating: number; body: string }[]; rank: number }[]> {
  const db = getDb();
  const live = await listLaunches({ liveOnly: true });
  if (!live.length) return [];
  const rv = await db.select().from(storeReviews).where(inArray(storeReviews.launch_id, live.map((l) => l.id)));
  const clk = await worldClock(); const now = absMinute(clk.date, clk.minute);
  return live.map((l) => {
    const mine = rv.filter((r) => r.launch_id === l.id).sort((a, b) => b.world_min - a.world_min);
    const rating = mine.length ? mine.reduce((a, r) => a + r.rating, 0) / mine.length : null;
    const fresh = Math.max(0, 1 - (now - l.published_min) / (14 * 1440));
    return { launch: l, rating: rating === null ? null : Math.round(rating * 10) / 10, reviews: mine.slice(0, 3).map((r) => ({ rating: r.rating, body: r.body })), rank: l.intensity * 1.2 + (rating ?? 3.5) / 5 * 0.6 + fresh * 0.4 };
  }).sort((a, b) => b.rank - a.rank);
}

export async function appOfLaunch(l: LaunchRow) {
  const db = getDb();
  const [app] = await db.select().from(apps).where(eq(apps.id, l.app_id));
  const [av] = await db.select().from(appVersions).where(and(eq(appVersions.id, l.app_version_id)));
  return { app, av };
}
