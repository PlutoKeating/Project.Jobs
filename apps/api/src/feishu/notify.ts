// 推送器：听 jw.notice（世界服务经 NATS）和本进程的通知，按每个推送去处的偏好决定实时发、合并发、进早报晚报，
// 并刷新每个产品的看板卡。推送去处默认是接入者的私聊；群可以由管理员说一句「以后往这个群推」设为推送去处。
import { logger, z } from '@pux/core';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { Actor } from '@pux/agent';
import { paramsOf } from '@pux/agent';
import { eq, feishuTargets, getDb, humanTasks, launchReports, studies } from '@pux/db';
import * as E from '@pux/engine';
import { SUBJ, type Bus, type NoticeMsg } from '@pux/jobsworld';
import { alertCard, boardCard, type BoardView, type Card } from './cards.ts';
import { chatOfSession, kvGet, kvSet, type FeishuChannel } from './channel.ts';
import { applyPrefs, dueDigests, mergeDue, mergeText, prefsOf, prefsText, reportChanged, route, todayIn, type Prefs } from './rules.ts';

type Target = typeof feishuTargets.$inferSelect;
const REPORT_AT = [3, 6, 12, 24, 48, 96, 192];

export class Notifier {
  private boardAt = new Map<string, number>(); private boardTimer = new Map<string, NodeJS.Timeout>();
  private reporting = new Set<string>();
  constructor(private fs: FeishuChannel, private signLink: (path: string) => Promise<string>) {}

  start(bus: Bus | undefined) {
    E.onNotice((n) => void this.handle(n));
    if (bus) void (async () => { for await (const m of bus.nc.subscribe(SUBJ.notice)) { try { void this.handle(JSON.parse(new TextDecoder().decode(m.data)) as NoticeMsg); } catch { /* */ } } })();
    const t = setInterval(() => void this.tick(), 60_000); t.unref();
    this.fs.onOwnerSeen = (chatId) => void this.ensureTarget(chatId, 'p2p', '接入者私聊');
  }

  async targets(): Promise<Target[]> { return (await getDb().select().from(feishuTargets)).filter((t) => t.enabled); }
  async ensureTarget(chatId: string, kind: 'p2p' | 'group', name?: string) { await getDb().insert(feishuTargets).values({ chat_id: chatId, kind, name: name ?? null, prefs: {} }).onConflictDoNothing(); }
  async setTarget(chatId: string, patch: { enabled?: boolean; prefs?: Prefs; name?: string; kind?: 'p2p' | 'group' }) {
    await getDb().insert(feishuTargets).values({ chat_id: chatId, kind: patch.kind ?? 'group', name: patch.name ?? null, prefs: (patch.prefs ?? {}) as Record<string, unknown>, enabled: patch.enabled ?? true })
      .onConflictDoUpdate({ target: feishuTargets.chat_id, set: { ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}), ...(patch.prefs ? { prefs: patch.prefs as unknown as Record<string, unknown> } : {}), ...(patch.name ? { name: patch.name } : {}) } });
  }

  // ---------------------------------------------------------------- 一件事
  async handle(n: NoticeMsg) {
    if (!this.fs.connected) return;
    try {
      if ('launch_id' in n) this.queueBoard(n.launch_id);
      if (n.kind === 'session_end') void this.maybeReport(n.launch_id);
      if (n.kind === 'report') { const last = (await kvGet<Record<string, { headline: string; verdict: string }>>('feishu_reported')) ?? {}; if (!reportChanged(last[n.launch_id], n)) return; last[n.launch_id] = { headline: n.headline, verdict: n.verdict }; await kvSet('feishu_reported', last); }
      if (n.kind === 'issue_new') { const st = await this.issueStatus(n.issue_id); if (st === 'known' || st === 'rejected') return; }
      for (const t of await this.targets()) {
        const p = prefsOf(t.prefs as Partial<Prefs>); const r = route(n, p);
        if (r === 'now') await this.sendNow(t, n, p).catch((e) => logger.warn({ err: String((e as Error).message).slice(0, 200) }, '飞书推送失败'));
        else if (r === 'merge') await getDb().update(feishuTargets).set({ pending: [...((t.pending as NoticeMsg[]) ?? []), n].slice(-200) }).where(eq(feishuTargets.chat_id, t.chat_id));
      }
    } catch (e) { logger.warn({ err: String((e as Error).message).slice(0, 200), kind: n.kind }, '飞书推送处理出错'); }
  }

  private async issueStatus(id: string) { return (await E.issueDetail(id).catch(() => undefined))?.status; }

  /** 用过的人数跨过门槛时重新归纳一次结论（结论写好会发 report 通知，变了才推） */
  private async maybeReport(launchId: string) {
    if (this.reporting.has(launchId)) return;
    const l = await E.getLaunch(launchId); if (!l || l.status === 'ended') return;
    const f = await E.launchFunnel(l.id);
    const done = (await kvGet<Record<string, number>>('feishu_report_at')) ?? {};
    const hit = [...REPORT_AT].reverse().find((k) => f.opened >= k && k > (done[l.id] ?? 0)); if (!hit) return;
    done[l.id] = hit; await kvSet('feishu_report_at', done);
    this.reporting.add(launchId);
    try { await E.launchReport(l, 'zh', { force: true }); } catch (e) { logger.warn({ err: String((e as Error).message).slice(0, 160) }, '推送前归纳结论失败'); } finally { this.reporting.delete(launchId); }
  }

  private async sendNow(t: Target, n: NoticeMsg, p: Prefs) {
    const link = async (path: string) => this.signLink(path);
    let card: Card | undefined; let urgent = false;
    if (n.kind === 'human') { card = alertCard({ title: '需要你介入', text: `${n.reason}${n.session_id ? `\n[打开这次使用](${await link(`/sessions/${n.session_id}`)})` : ''}`, tone: 'red', actions: [{ text: '看待处理的事', value: { a: 'ask', q: '有哪些需要我介入的事？' } }] }); urgent = p.urgent; }
    else if (n.kind === 'issue_new') {
      const d = await E.issueDetail(n.issue_id); const l = await E.getLaunch(n.launch_id);
      const m = d?.moments.find((x) => x.screenshot) ?? d?.moments[0];
      const img = m?.screenshot ? await this.fs.evidenceImage(m.screenshot).catch(() => undefined) : undefined;
      card = alertCard({ title: `[${n.severity}] ${l?.name ?? ''}：${n.title}`.slice(0, 80), tone: n.severity === 'P0' ? 'red' : 'orange',
        text: `${(d?.description ?? '').split('\n\n')[0].slice(0, 300)}${m ? `\n\n${m.name}（${m.who}）${m.quote ? `：「${m.quote.slice(0, 120)}」` : ''}\n[看这次使用](${await link(`/sessions/${m.session_id}`)})` : ''}`,
        images: img ? [img] : undefined,
        actions: [{ text: '交给 coding agent', value: { a: 'ask', q: `把问题 ${n.issue_id}（${n.title}）写成修复任务` } }, { text: '标为已知', value: { a: 'ask', q: `把问题 ${n.issue_id} 标为已知，暂时不改` } }, { text: '细看', value: { a: 'ask', q: `问题 ${n.issue_id} 是怎么回事？谁遇到的？` } }] });
    } else if (n.kind === 'report') {
      const l = await E.getLaunch(n.launch_id); if (!l) return;
      const r = await E.launchReport(l, 'zh').catch(() => undefined);
      const vs = await E.launchVersionList(l);
      let cmp = '';
      if (vs.length > 1) { const c = await E.compareVersions(l); const k = c.versions.length - 1; const fixed = c.issues.filter((i) => i.by_version.slice(0, k).some((x) => x > 0) && i.by_version[k] === 0); const still = c.issues.filter((i) => i.by_version[k] > 0); if (c.versions[k].finished) cmp = `\n\n第 ${c.versions[k].n} 版（${c.versions[k].finished} 次使用）：${fixed.length ? `没再出现 ${fixed.length} 个问题` : ''}${fixed.length && still.length ? '，' : ''}${still.length ? `仍有 ${still.length} 个问题出现` : ''}${!fixed.length && !still.length ? '还没有亲历问题' : ''}。`; }
      card = alertCard({ title: `${l.name}：结论变了`, tone: n.verdict === 'works' ? 'green' : n.verdict === 'not_yet' ? 'red' : 'orange', text: `**${n.headline}**\n${r?.summary ?? ''}${r?.next ? `\n\n如果只改一件事：${r.next}` : ''}${cmp}\n\n[打开一页结论](${await link(`/products/${l.id}`)})`, note: `${n.people_used} 人用过（模拟）`, actions: [{ text: '问题清单', value: { a: 'ask', q: `「${l.name}」现在有哪些问题？` } }, { text: '请 3 人再试', value: { a: 'ask', q: `请 3 个人现在试试「${l.name}」，用完告诉我` } }] });
    } else if (n.kind === 'fix_verify') {
      card = alertCard({ title: '修好了？正在验证', tone: 'green', text: `GitHub 上的 [${n.title}](${n.url}) 已关闭。已标记第 ${n.version} 版，请了 ${n.invited} 位撞上过这类问题的人再试一遍；他们用完后我会告诉你问题还在不在。` });
    }
    if (!card) return;
    const sent = await this.fs.sendCard({ chat_id: t.chat_id }, card);
    if (urgent && t.kind === 'p2p' && this.fs.saved?.owner) await this.fs.urgent(sent.messageId, [this.fs.saved.owner]).catch((e) => logger.warn({ err: String((e as Error).message).slice(0, 160) }, '应用内加急失败'));
  }

  // ---------------------------------------------------------------- 看板卡
  private queueBoard(launchId: string) {
    if (this.boardTimer.has(launchId)) return;
    const wait = Math.max(0, 60_000 - (Date.now() - (this.boardAt.get(launchId) ?? 0)));
    this.boardTimer.set(launchId, setTimeout(() => { this.boardTimer.delete(launchId); this.boardAt.set(launchId, Date.now()); void this.refreshBoard(launchId).catch((e) => logger.warn({ err: String((e as Error).message).slice(0, 160) }, '看板卡刷新失败')); }, wait));
  }
  async boardView(launchId: string): Promise<BoardView | undefined> {
    const l = await E.getLaunch(launchId); if (!l) return undefined;
    const [f, rep, iss, vs] = await Promise.all([E.launchFunnel(l.id), getDb().select().from(launchReports).where(eq(launchReports.launch_id, l.id)), E.listIssues(l).catch(() => []), E.launchVersionList(l)]);
    const r = rep.find((x) => x.lang === 'zh')?.data as { headline?: string; next?: string; verdict?: string } | undefined;
    const [st] = await getDb().select({ cost: studies.cost_usd }).from(studies).where(eq(studies.id, l.study_id));
    return { id: l.id, name: l.name, status: l.status, intensity: l.intensity, funnel: f, spend: Math.round((st?.cost ?? 0) * 100) / 100, headline: r && r.verdict !== 'too_early' ? r.headline : null, next: r?.next ?? null, issues: iss.filter((i) => i.status !== 'known').slice(0, 3), version: vs.at(-1)?.n, updated: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Shanghai' }), url: await this.signLink(`/products/${l.id}`) };
  }
  async refreshBoard(launchId: string) {
    if (!this.fs.connected) return;
    const v = await this.boardView(launchId); if (!v) return;
    for (const t of await this.targets()) {
      const p = prefsOf(t.prefs as Partial<Prefs>); if (!p.boards || (p.products && !p.products.includes(launchId))) continue;
      const boards = (t.boards ?? {}) as Record<string, string>; const card = boardCard(v);
      const cur = boards[launchId];
      if (cur) { try { await this.fs.updateCard(cur, card); continue; } catch { /* 卡片过期（14 天）或被删：发一张新的 */ } }
      const s = await this.fs.sendCard({ chat_id: t.chat_id }, card);
      await getDb().update(feishuTargets).set({ boards: { ...boards, [launchId]: s.cardId } }).where(eq(feishuTargets.chat_id, t.chat_id));
    }
  }

  // ---------------------------------------------------------------- 每分钟：合并的那一条、早报晚报
  async tick(now = new Date()) {
    if (!this.fs.connected) return;
    for (const t of await this.targets()) {
      const p = prefsOf(t.prefs as Partial<Prefs>);
      const pending = (t.pending ?? []) as NoticeMsg[];
      if (mergeDue(pending, p, now.getTime())) {
        await getDb().update(feishuTargets).set({ pending: [] }).where(eq(feishuTargets.chat_id, t.chat_id));
        const names = new Map((await E.listLaunches()).map((l) => [l.id, l.name]));
        const text = mergeText(pending, names, p.merge_minutes);
        if (text) await this.fs.sendCard({ chat_id: t.chat_id }, alertCard({ title: '这段时间', text, tone: 'grey' })).catch(() => undefined);
      }
      const last = (t.last_digest ?? {}) as Record<string, string>;
      for (const k of dueDigests(now, p, last)) {
        await getDb().update(feishuTargets).set({ last_digest: { ...last, [k]: todayIn(now, p.tz) } }).where(eq(feishuTargets.chat_id, t.chat_id));
        await this.digest(t, k, p).catch((e) => logger.warn({ err: String((e as Error).message).slice(0, 160) }, '早报晚报发送失败'));
      }
    }
  }

  /** 早报 / 晚报：每个上线中的产品此刻的人数、一句话结论、最该改的、问题数，以及待处理的事 */
  async digest(t: Target, k: 'morning' | 'evening', p: Prefs) {
    const ls = (await E.listLaunches()).filter((l) => l.status !== 'ended' && (!p.products || p.products.includes(l.id)));
    const base = (await kvGet<Record<string, { opened: number; came_back: number }>>(`feishu_digest_base:${t.chat_id}`)) ?? {};
    const lines: string[] = []; const next: Record<string, { opened: number; came_back: number }> = {};
    for (const l of ls) {
      const v = await this.boardView(l.id); if (!v) continue;
      const b = base[l.id]; next[l.id] = { opened: v.funnel.opened, came_back: v.funnel.came_back };
      lines.push(`**${l.name}**：${v.funnel.opened} 人打开过${b ? `（+${v.funnel.opened - b.opened}）` : ''}，${v.funnel.came_back} 人回来再用${v.headline ? `\n${v.headline}` : ''}${v.issues?.length ? `\n问题 ${v.issues.length} 个，最重的：[${v.issues[0].severity}] ${v.issues[0].title}` : ''}`);
    }
    await kvSet(`feishu_digest_base:${t.chat_id}`, next);
    const human = (await getDb().select().from(humanTasks)).filter((h) => h.status === 'pending').length;
    const text = `${lines.join('\n\n') || '还没有上线中的产品。'}${human ? `\n\n还有 ${human} 件事等你介入。` : ''}`;
    await this.fs.sendCard({ chat_id: t.chat_id }, alertCard({ title: k === 'morning' ? '早报' : '晚报', text, tone: 'turquoise', note: `人数是城里实际发生的（模拟）· ${prefsText(p).split('\n')[2]}`, actions: [{ text: '城里现在', value: { a: 'ask', q: '城里现在怎么样？' } }, { text: '推送设置', value: { a: 'ask', q: '现在推送是怎么设置的？' } }] }));
  }

  // ---------------------------------------------------------------- 一句话改偏好（只在飞书里有的工具）
  tools(session: string, actor: Actor): AgentTool<object>[] {
    const chatId = chatOfSession(session).chat_id;
    return [{
      name: 'notification_settings', label: '推送设置',
      description: '看或改飞书推送的偏好（这个聊天）。实时推：issues（严重问题第一次出现）、reports（结论有实质变化）、human（需要人介入）、urgent（介入时应用内加急）；merge_minutes 其余的事合并成一条的间隔（0 = 不发）；morning / evening 早报晚报时刻 HH:MM（off 关掉）；boards 看板卡；products 只关心哪些产品（发布 id 列表，或 "all"）；push_here：把这个群设为推送去处（true）或不再往这里推（false）。不带任何参数就是查看。只有管理员能改。',
      parameters: paramsOf({ issues: z.boolean().optional(), reports: z.boolean().optional(), human: z.boolean().optional(), urgent: z.boolean().optional(), merge_minutes: z.number().optional(), morning: z.string().optional(), evening: z.string().optional(), boards: z.boolean().optional(), products: z.union([z.array(z.string()), z.literal('all')]).optional(), push_here: z.boolean().optional() }),
      execute: async (_id, raw) => {
        const a = raw as Parameters<typeof applyPrefs>[1] & { push_here?: boolean };
        const [cur] = await getDb().select().from(feishuTargets).where(eq(feishuTargets.chat_id, chatId));
        const names = new Map((await E.listLaunches()).map((l) => [l.id, l.name]));
        const changing = Object.keys(a).length > 0;
        if (changing && actor.role !== 'admin') throw new Error('只有管理员能改推送设置');
        if (!cur && !a.push_here) return { content: [{ type: 'text', text: changing ? '这个聊天现在不是推送去处。要往这里推，先说「以后往这里推」（push_here: true）。' : `这个聊天不是推送去处（推送默认发到接入者的私聊）。` }], details: null };
        if (a.push_here === false) { await this.setTarget(chatId, { enabled: false }); return { content: [{ type: 'text', text: '以后不往这里推了。' }], details: null }; }
        const prefs = applyPrefs(prefsOf((cur?.prefs ?? {}) as Partial<Prefs>), a);
        await this.setTarget(chatId, { prefs, enabled: true, kind: cur?.kind === 'p2p' ? 'p2p' : 'group' });
        return { content: [{ type: 'text', text: `${changing ? '改好了。现在：\n' : ''}${prefsText(prefs, names)}` }], details: null };
      },
    }];
  }
}

