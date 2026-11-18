// 发布引擎：世界每往前走一段时间，已发布的产品就可能出现在某些人面前；注意到的人自己决定要不要点开；
// 点开的人排队使用（一次使用 = 一个浏览器会话）；用完之后评估、留下评论和口碑。由世界服务驱动（见 apps/world）。
import { logger, Rng, type PersonaSpec, langOf } from '@pux/core';
import { and, desc, eq, exposures, getDb, gt, inArray, intentions, posts, sessions } from '@pux/db';
import { dayIndex, liveContextFor, type LiveContext } from '@pux/jobsworld';
import { evaluateSessionPost, runSessionInline } from '../control/study.ts';
import { SessionRunner } from '../runtime/session-runner.ts';
import { synthesizeIssues } from '../evaluation/issues.ts';
import { addIntention, audienceMatch, decide, exposureChance, notices, recordExposure, whatTheySee, type Channel, type Seen } from './exposure.ts';
import { listLaunches, storeListing, type LaunchRow } from './launch.ts';
import { afterUse, startUsage } from './usage.ts';
import { emitNotice } from './notice.ts';

export interface Citizen { id: string; spec: PersonaSpec; place_id: string; place_kind: string; phone: number; in_session: boolean; asleep: boolean; attention: number }
export interface EngineHooks { say?: (personaId: string, text: string, tone: 'neutral' | 'happy' | 'confused' | 'angry') => void; log?: (msg: string) => void }

interface Rel { seen: number; rejected: boolean; opened: boolean }

export class LaunchEngine {
  private rng = new Rng(Date.now() % 1_000_000);
  private rel = new Map<string, Rel>();            // `${launch}|${persona}`
  private deciding = new Set<string>();            // 正在做决定的人（一次只想一件事）
  private queue: { sessionId: string; launchId: string; studyId: string }[] = [];
  private running = new Map<string, string>();     // sessionId → studyId
  private cancelled = new Set<string>();           // 正在被清零或下线的产品的 studyId
  private epoch = new Map<string, number>();       // studyId → 第几次清零：清零之前开始的决定与使用，结束时作废
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
    // 上次停下时正在进行的使用：进程没了，它们永远不会结束，却会一直显示「在用」、让 wait_for_people 白等。标为中断（不算人数），受邀的可以重新请
    for (const l of await listLaunches({ liveOnly: true })) {
      const orphans = await getDb().update(sessions).set({ status: 'cancelled', outcome: 'cancelled', end_reason: '世界服务重启，这次使用被中断了', ended_at: new Date() }).where(and(eq(sessions.study_id, l.study_id), inArray(sessions.status, ['running', 'waiting_human']))).returning({ id: sessions.id });
      if (orphans.length) logger.warn({ launch: l.id, sessions: orphans.length }, '世界服务重启：把上次中断的使用标为取消');
    }
    // 上次停下时排着队、还没开始的使用，接着跑
    for (const l of await listLaunches({ liveOnly: true })) for (const s of await getDb().select({ id: sessions.id }).from(sessions).where(and(eq(sessions.study_id, l.study_id), eq(sessions.status, 'planned')))) if (!this.queue.some((q) => q.sessionId === s.id) && !this.running.has(s.id)) this.queue.push({ sessionId: s.id, launchId: l.id, studyId: l.study_id });
  }

  /** 世界往前走了 minutes 分钟：算一遍谁遇到了什么 */
  async tick(o: { abs: number; date: string; minutes: number; citizens: Citizen[] }): Promise<void> {
    await this.load();
    const live = (await listLaunches({ liveOnly: true })).filter((l) => !this.cancelled.has(l.study_id));
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
    const k = `${l.id}|${c.id}`; const r = this.rel.get(k) ?? { seen: 1, rejected: false, opened: false };
    const ep = this.epoch.get(l.study_id) ?? 0;
    const d = await decide(c.spec, ctx, l, seen, { appId: l.app_id, simDay: dayIndex(o.date), used: r.opened });
    if (this.stale(l.study_id, ep)) return;          // 想的时候产品被清零或下线了
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
      if (this.cancelled.has(l.study_id)) return;
      this.queue.push({ sessionId: sid, launchId: l.id, studyId: l.study_id });
      this.opts.log?.(`▶ ${c.spec.identity.name} 决定打开「${l.name}」（${channel}）：${d.thought}`);
      this.pump();
    }
  }

  /**
   * 产品被清零或下线：排队的使用丢掉，进行中的使用在当前这一步做完后作废，等它们都停下来（最多 timeoutMs），
   * 并忘掉内存里「谁见过它、谁拒绝过它」。之后由调用方清库。清库之后调用 release() 让同一个 study 重新可用（清零）
   */
  async cancel(launchIds: string[], studyIds: string[], timeoutMs = 90_000): Promise<void> {
    await this.load();
    for (const s of studyIds) { this.cancelled.add(s); this.epoch.set(s, (this.epoch.get(s) ?? 0) + 1); }
    this.queue = this.queue.filter((q) => !studyIds.includes(q.studyId));
    for (const [sid, st] of this.running) if (studyIds.includes(st)) SessionRunner.get(sid)?.cancel();
    for (const k of [...this.rel.keys()]) if (launchIds.some((l) => k.startsWith(`${l}|`))) this.rel.delete(k);
    for (const s of studyIds) { this.sinceSynth.delete(s); }
    const deadline = Date.now() + timeoutMs;
    while ([...this.running.values()].some((st) => studyIds.includes(st)) || studyIds.some((s) => this.synthBusy.has(s))) {
      if (Date.now() > deadline) { logger.warn({ studyIds }, '等进行中的使用停下来超时，照常清理'); break; }
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  private stale(studyId: string, ep: number) { return this.cancelled.has(studyId) || (this.epoch.get(studyId) ?? 0) !== ep; }
  release(studyIds: string[]) { for (const s of studyIds) this.cancelled.delete(s); }

  /** 把手机递给一批人之后，把这些使用排进队列 */
  async enqueue(sessionIds: string[], l: LaunchRow) {
    await this.load().catch(() => {});     // 世界服务刚重启时，先把上次排着的接回来；不然受邀的使用会一直「排队」到下一次 tick
    if (this.cancelled.has(l.study_id)) return;
    for (const id of sessionIds) if (!this.queue.some((q) => q.sessionId === id) && !this.running.has(id)) this.queue.push({ sessionId: id, launchId: l.id, studyId: l.study_id });
    this.pump();
  }

  /** 取消排队中或正在进行的使用（受邀的、自己点开的都行）。排队的直接作废，进行中的在当前这一步做完后停下，都不整理记忆、不评估 */
  async cancelSessions(ids: string[]): Promise<number> {
    if (!ids.length) return 0;
    const db = getDb(); const set = new Set(ids);
    this.queue = this.queue.filter((q) => !set.has(q.sessionId));
    for (const id of ids) SessionRunner.get(id)?.cancel();
    await db.update(sessions).set({ status: 'cancelled', outcome: 'cancelled', end_reason: '被取消了', ended_at: new Date() }).where(and(inArray(sessions.id, ids), inArray(sessions.status, ['planned', 'running'])));
    return ids.length;
  }

  private pump() {
    const max = this.opts.concurrency ?? 3;
    while (this.running.size < max && this.queue.length) {
      const job = this.queue.shift()!; this.running.set(job.sessionId, job.studyId);
      void this.runOne(job).catch((e) => logger.warn({ err: String((e as Error).message).slice(0, 200) }, '使用运行失败')).finally(() => { this.running.delete(job.sessionId); this.pump(); });
    }
  }

  private async runOne(job: { sessionId: string; launchId: string; studyId: string }) {
    const log = this.opts.log ?? (() => {});
    const ep = this.epoch.get(job.studyId) ?? 0;
    const outcome = await runSessionInline(job.sessionId, () => {});
    log(`■ ${job.sessionId} 结局：${outcome}`);
    if (this.stale(job.studyId, ep) || outcome === 'cancelled') return;         // 产品被清零或下线、或这次使用被取消：不评估、不留口碑
    await evaluateSessionPost(job.sessionId).catch((e) => logger.warn({ err: String(e).slice(0, 200) }, '评估失败'));
    const a = await afterUse(job.sessionId).catch((e) => { logger.warn({ err: String(e).slice(0, 200) }, '用完之后的处理失败'); return undefined; });
    if (a && (a.review || a.post || a.told)) log(`  ↳ ${a.review ? '写了评论 ' : ''}${a.post ? '发了动态 ' : ''}${a.told ? `跟${a.told}说了` : ''}`);
    const [sr] = await getDb().select({ persona_id: sessions.persona_id, outcome: sessions.outcome, plan: sessions.plan_reason }).from(sessions).where(eq(sessions.id, job.sessionId));
    if (sr) emitNotice({ kind: 'session_end', launch_id: job.launchId, session_id: job.sessionId, persona_id: sr.persona_id, outcome: sr.outcome, invited: !!(sr.plan as { invited?: boolean } | null)?.invited, ts: Date.now() });
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
