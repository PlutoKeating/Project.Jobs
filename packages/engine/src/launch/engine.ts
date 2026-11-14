// 发布引擎：世界每往前走一段时间，已发布的产品就可能出现在某些人面前；注意到的人自己决定要不要点开；
// 点开的人排队使用（一次使用 = 一个浏览器会话）；用完之后评估、留下评论和口碑。由世界服务驱动（见 apps/world）。
import { logger, Rng, type PersonaSpec, langOf } from '@pux/core';
import { and, desc, eq, exposures, getDb, gt, intentions, posts, sessions } from '@pux/db';
import { dayIndex, liveContextFor, type LiveContext } from '@pux/jobsworld';
import { evaluateSessionPost, runSessionInline } from '../control/study.ts';
import { synthesizeIssues } from '../evaluation/issues.ts';
import { addIntention, audienceMatch, decide, exposureChance, notices, recordExposure, whatTheySee, type Channel, type Seen } from './exposure.ts';
import { listLaunches, storeListing, type LaunchRow } from './launch.ts';
import { afterUse, startUsage } from './usage.ts';

export interface Citizen { id: string; spec: PersonaSpec; place_id: string; place_kind: string; phone: number; in_session: boolean; asleep: boolean; attention: number }
export interface EngineHooks { say?: (personaId: string, text: string, tone: 'neutral' | 'happy' | 'confused' | 'angry') => void; log?: (msg: string) => void }

interface Rel { seen: number; rejected: boolean; opened: boolean }

export class LaunchEngine {
  private rng = new Rng(Date.now() % 1_000_000);
  private rel = new Map<string, Rel>();            // `${launch}|${persona}`
  private deciding = new Set<string>();            // 正在做决定的人（一次只想一件事）
  private queue: { sessionId: string; launchId: string; studyId: string }[] = [];
  private running = new Set<string>();
  private sinceSynth = new Map<string, number>();
  private synthBusy = new Set<string>();
  private loaded = false;
  constructor(private opts: { concurrency?: number; decisionConcurrency?: number } & EngineHooks = {}) {}

  get busy() { return { queued: this.queue.length, running: this.running.size, deciding: this.deciding.size }; }

  private async load() {
    if (this.loaded) return; this.loaded = true;
    for (const e of await getDb().select().from(exposures)) {
      const k = `${e.launch_id}|${e.persona_id}`; const r = this.rel.get(k) ?? { seen: 0, rejected: false, opened: false };
      r.seen++; if (e.reaction === 'not_for_me') r.rejected = true; if (e.reaction === 'opened') r.opened = true; this.rel.set(k, r);
    }
    // 上次停下时排着队、还没开始的使用，接着跑
    for (const l of await listLaunches({ liveOnly: true })) for (const s of await getDb().select({ id: sessions.id }).from(sessions).where(and(eq(sessions.study_id, l.study_id), eq(sessions.status, 'planned')))) this.queue.push({ sessionId: s.id, launchId: l.id, studyId: l.study_id });
  }

  /** 世界往前走了 minutes 分钟：算一遍谁遇到了什么 */
  async tick(o: { abs: number; date: string; minutes: number; citizens: Citizen[] }): Promise<void> {
    await this.load();
    const live = await listLaunches({ liveOnly: true });
    if (live.length) {
      const db = getDb();
      const open = await db.select().from(intentions).where(eq(intentions.done, false));
      const recentPosts = await db.select().from(posts).where(gt(posts.world_min, o.abs - 2 * 1440)).orderBy(desc(posts.world_min)).limit(60);
      const store = await storeListing();
      const minutes = Math.min(o.minutes, 90);
      for (const c of o.citizens) {
        if (c.in_session || c.asleep || this.deciding.has(c.id) || (c.spec.kind === 'child' && c.spec.identity.age < 10)) continue;
        let hit: { l: LaunchRow; channel: Channel; seen: () => Seen; intentionId?: string; source?: string } | undefined;
        // 1) 之前留下的念头：熟人提起过、想着以后看看、用过想再用
        for (const it of this.rng.shuffle(open.filter((x) => x.persona_id === c.id))) {
          const l = live.find((x) => x.id === it.launch_id); if (!l || c.phone < 0.15) continue;
          let wom: { from: string; name: string; kind: string; said: string } | undefined;
          try { const j = JSON.parse(it.reason ?? ''); if (j?.said) wom = j; } catch { /* 普通念头 */ }
          const rate = (wom ? 0.9 : 0.25) * it.strength * c.phone;
          if (!this.rng.bool(1 - Math.exp(-rate * (minutes / 60)))) continue;
          const lang = langOf(c.spec.locale);
          hit = { l, channel: wom ? 'word_of_mouth' : 'recall', intentionId: it.id, source: wom?.from, seen: () => ({ channel: wom ? 'word_of_mouth' : 'recall', text: whatTheySee(l, wom ? 'word_of_mouth' : 'recall', lang, { from: wom ? { name: wom.name, kind: lang === 'zh' ? tieZh(wom.kind) : wom.kind.replace('_', ' '), said: wom.said } : undefined, memory: wom ? undefined : it.reason ?? undefined }) }) };
          break;
        }
        // 2) 自然遇到：广告、广告牌、动态、逛商店
        if (!hit) for (const l of this.rng.shuffle(live)) {
          const r = this.rel.get(`${l.id}|${c.id}`) ?? { seen: 0, rejected: false, opened: false };
          if (r.rejected || r.opened) continue;
          const base = { intensity: l.intensity, affinity: c.phone, match: audienceMatch(c.spec, l.audience), minutes, placeKind: c.place_kind, exploration: c.spec.behavior_policy.exploration_propensity, seenBefore: r.seen };
          const lang = langOf(c.spec.locale);
          const myPosts = recentPosts.filter((p) => p.launch_id === l.id && p.persona_id !== c.id);
          const slot = store.findIndex((s) => s.launch.id === l.id);
          const ch: Channel | undefined = this.rng.bool(exposureChance('ad', base)) ? 'ad' : this.rng.bool(exposureChance('billboard', base)) ? 'billboard' : myPosts.length && this.rng.bool(exposureChance('feed', base)) ? 'feed' : slot >= 0 && slot < 6 && this.rng.bool(exposureChance('store_browse', base) * [1, 0.6, 0.4, 0.25, 0.15, 0.1][slot]) ? 'store' : undefined;
          if (!ch) continue;
          const post = ch === 'feed' ? this.rng.pick(myPosts) : undefined; const st = store[slot];
          hit = { l, channel: ch, source: post?.persona_id, seen: () => ({ channel: ch, text: whatTheySee(l, ch, lang, { rating: st?.rating, reviews: st?.reviews, post: post?.body }) }) };
          break;
        }
        if (!hit) continue;
        const k = `${hit.l.id}|${c.id}`; const r = this.rel.get(k) ?? { seen: 0, rejected: false, opened: false }; r.seen++; this.rel.set(k, r);
        const noticeKey = hit.channel === 'recall' || hit.channel === 'word_of_mouth' || hit.channel === 'invite' ? hit.channel : hit.channel;
        if (!notices(noticeKey as never, this.rng, { attention: c.attention, seenBefore: r.seen - 1 })) { await recordExposure({ launch_id: hit.l.id, persona_id: c.id, channel: hit.channel, world_min: o.abs, place_id: c.place_id, reaction: 'unnoticed', source_persona_id: hit.source }); continue; }
        if (this.deciding.size >= (this.opts.decisionConcurrency ?? 4)) continue;      // 决定点排不过来：这次就当没看到
        this.deciding.add(c.id);
        void this.decideAndAct(c, hit.l, hit.channel, hit.seen(), o, hit.intentionId, hit.source).catch((e) => logger.warn({ err: String((e as Error).message).slice(0, 200) }, '曝光决定失败')).finally(() => this.deciding.delete(c.id));
      }
    }
    this.pump();
  }

  private async decideAndAct(c: Citizen, l: LaunchRow, channel: Channel, seen: Seen, o: { abs: number; date: string }, intentionId?: string, source?: string) {
    const db = getDb();
    const ctx = await liveContextFor(c.id);
    if (!ctx || !ctx.available) return;
    const k = `${l.id}|${c.id}`; const r = this.rel.get(k)!;
    const d = await decide(c.spec, ctx, l, seen, { appId: l.app_id, simDay: dayIndex(o.date), used: r.opened });
    const expId = await recordExposure({ launch_id: l.id, persona_id: c.id, channel, world_min: o.abs, place_id: c.place_id, reaction: d.reaction === 'open_now' ? 'curious_later' : d.reaction, thought: d.thought, source_persona_id: source });
    if (d.thought && d.reaction !== 'ignored') this.opts.say?.(c.id, d.thought, d.reaction === 'not_for_me' ? 'confused' : d.reaction === 'open_now' ? 'happy' : 'neutral');
    if (d.reaction === 'not_for_me') r.rejected = true;
    if (intentionId) {
      if (d.reaction === 'open_now' || d.reaction === 'not_for_me') await db.update(intentions).set({ done: true }).where(eq(intentions.id, intentionId));
      else { const [it] = await db.select().from(intentions).where(eq(intentions.id, intentionId)); if (it) await db.update(intentions).set({ strength: it.strength * 0.7, done: it.strength * 0.7 < 0.08 }).where(eq(intentions.id, intentionId)); }
    } else if (d.reaction === 'curious_later') await addIntention(l.id, c.id, 'try_later', d.want || d.thought, 0.5, o.abs);
    if (d.reaction === 'open_now') {
      r.opened = true;
      const sid = await startUsage(l, c.spec, { channel, want: d.want, found: seen.text, ctx, exposureId: expId, source });
      this.queue.push({ sessionId: sid, launchId: l.id, studyId: l.study_id });
      this.opts.log?.(`▶ ${c.spec.identity.name} 决定打开「${l.name}」（${channel}）：${d.thought}`);
      this.pump();
    }
  }

  /** 把手机递给一批人之后，把这些使用排进队列 */
  enqueue(sessionIds: string[], l: LaunchRow) { for (const id of sessionIds) this.queue.push({ sessionId: id, launchId: l.id, studyId: l.study_id }); this.pump(); }

  private pump() {
    const max = this.opts.concurrency ?? 3;
    while (this.running.size < max && this.queue.length) {
      const job = this.queue.shift()!; this.running.add(job.sessionId);
      void this.runOne(job).catch((e) => logger.warn({ err: String((e as Error).message).slice(0, 200) }, '使用运行失败')).finally(() => { this.running.delete(job.sessionId); this.pump(); });
    }
  }

  private async runOne(job: { sessionId: string; launchId: string; studyId: string }) {
    const log = this.opts.log ?? (() => {});
    const outcome = await runSessionInline(job.sessionId, () => {});
    log(`■ ${job.sessionId} 结局：${outcome}`);
    await evaluateSessionPost(job.sessionId).catch((e) => logger.warn({ err: String(e).slice(0, 200) }, '评估失败'));
    const a = await afterUse(job.sessionId).catch((e) => { logger.warn({ err: String(e).slice(0, 200) }, '用完之后的处理失败'); return undefined; });
    if (a && (a.review || a.post || a.told)) log(`  ↳ ${a.review ? '写了评论 ' : ''}${a.post ? '发了动态 ' : ''}${a.told ? `跟${a.told}说了` : ''}`);
    // 攒够几次使用就把问题重新归并一次
    const n = (this.sinceSynth.get(job.studyId) ?? 0) + 1; this.sinceSynth.set(job.studyId, n);
    if ((n >= 3 || (!this.queue.some((q) => q.studyId === job.studyId) && this.running.size <= 1)) && !this.synthBusy.has(job.studyId)) {
      this.synthBusy.add(job.studyId); this.sinceSynth.set(job.studyId, 0);
      void synthesizeIssues(job.studyId, { cleanReplay: true, lang: 'zh' }).catch((e) => logger.warn({ err: String(e).slice(0, 200) }, '问题归并失败')).finally(() => this.synthBusy.delete(job.studyId));
    }
  }
}

const tieZh = (k: string) => ({ spouse: '伴侣', parent_child: '家人', grandparent: '家人', sibling: '兄弟姐妹', roommate: '室友', colleague: '同事', classmate: '同学', friend: '朋友', neighbor: '邻居' } as Record<string, string>)[k] ?? '熟人';
export type { LiveContext };
