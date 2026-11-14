// 飞书机器人：扫码接入（飞书的一键创建应用），之后在飞书里就能发布产品、看状况、要结论、调宣发、把手机递给人、向居民追问；
// 有人用完了、结论有了新版本、需要人介入时，机器人主动告诉你。事件走长连接，不需要公网回调地址。
import * as lark from '@larksuiteoapi/node-sdk';
import QRCode from 'qrcode';
import type { FastifyInstance } from 'fastify';
import { logger, type PersonaSpec } from '@pux/core';
import { and, desc, eq, getDb, gt, humanTasks, inArray, personas, sessions, studies, worldKv } from '@pux/db';
import * as E from '@pux/engine';
import { latestPersonas, SUBJ, type Bus } from '@pux/jobsworld';
import { open, seal } from '@pux/llm';
import { requireAdmin } from './auth.ts';

// ---- 飞书里说的话 → 要做的事（纯函数，便于测试）----
export type Command =
  | { cmd: 'help' } | { cmd: 'list' }
  | { cmd: 'publish'; url: string; name: string; tagline: string }
  | { cmd: 'status' | 'report'; product?: string }
  | { cmd: 'invite'; product?: string; n: number }
  | { cmd: 'promote'; product: string; intensity?: number; status?: 'live' | 'paused' | 'ended' }
  | { cmd: 'ask'; who: string; question: string }
  | { cmd: 'unknown'; text: string };

export function parseCommand(raw: string): Command {
  const text = raw.replace(/@_user_\d+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text || /^(帮助|help|\?|？|你好|hi|hello)$/i.test(text)) return { cmd: 'help' };
  const [head, ...rest] = text.split(' '); const h = head.toLowerCase(); const tail = rest.join(' ').trim();
  if (/^(发布|publish)$/.test(h)) {
    const url = rest.find((x) => /^(https?:\/\/|localhost[:/]|\d+\.\d+\.\d+\.\d+)/i.test(x));
    const others = rest.filter((x) => x !== url);
    if (!url || others.length < 2) return { cmd: 'unknown', text };
    return { cmd: 'publish', url: /^https?:\/\//i.test(url) ? url : `http://${url}`, name: others[0], tagline: others.slice(1).join(' ') };
  }
  if (/^(产品|列表|ls|list)$/.test(h)) return { cmd: 'list' };
  if (/^(状况|状态|进展|status)$/.test(h)) return { cmd: 'status', product: tail || undefined };
  if (/^(结论|报告|report)$/.test(h)) return { cmd: 'report', product: tail || undefined };
  if (/^(邀请|递手机|invite)$/.test(h)) { const n = Number(rest.find((x) => /^\d+$/.test(x)) ?? 3); const product = rest.filter((x) => !/^\d+$/.test(x)).join(' ') || undefined; return { cmd: 'invite', product, n: Math.max(1, Math.min(10, n)) }; }
  if (/^(宣发|promote)$/.test(h) && rest.length >= 2) {
    const op = rest[rest.length - 1].toLowerCase().replace(/%$/, ''); const product = rest.slice(0, -1).join(' ');
    if (/^(暂停|pause)$/.test(op)) return { cmd: 'promote', product, status: 'paused' };
    if (/^(继续|恢复|resume)$/.test(op)) return { cmd: 'promote', product, status: 'live' };
    if (/^(结束|end)$/.test(op)) return { cmd: 'promote', product, status: 'ended' };
    const n = Number(op); if (Number.isFinite(n) && n >= 0 && n <= 100) return { cmd: 'promote', product, intensity: n / 100 };
    return { cmd: 'unknown', text };
  }
  if (/^(问|ask)$/.test(h) && rest.length >= 2) return { cmd: 'ask', who: rest[0], question: rest.slice(1).join(' ') };
  const m = /^[@＠]?([^\s:：，,]{1,24})[:：，,]\s*(.+)$/.exec(text);          // 「赵红梅：你为什么关掉了？」
  if (m) return { cmd: 'ask', who: m[1], question: m[2] };
  return { cmd: 'unknown', text };
}

export const HELP = `我是 Jobs。把产品发布到 JobsWorld，看住在里面的人怎么对待它。你可以这样跟我说：

发布 <网址> <名字> <一句话介绍>
产品 —— 已发布的产品
状况 [产品] —— 多少人看到、注意到、打开过、回来再用
结论 [产品] —— 一页结论
邀请 [产品] [人数] —— 把手机递给几个人，请他们现在就试
宣发 <产品> <0-100 | 暂停 | 继续 | 结束>
问 <居民的名字> <问题> —— 向用过产品的人追问

有人用完了、结论更新了、需要你介入时，我会主动告诉你。人数是这座城里实际发生的人数（模拟）。`;

interface Saved { app_id: string; secret: string; owner?: string; brand?: 'feishu' | 'lark'; origin?: string; connected_at: string }
interface Cursor { sessions_at: string; human_at: string; reported: Record<string, number> }
const OUTCOME: Record<string, string> = { success: '办成了', gave_up: '放弃了', resource_exhausted: '没时间了', stalled: '卡住了', blocked: '被拦住了', sim_error: '模拟出错' };
/** 用完多少人之后各推一次结论 */
const REPORT_AT = [3, 6, 12, 24, 48, 96];

const kvGet = async <T,>(key: string): Promise<T | undefined> => { const [r] = await getDb().select().from(worldKv).where(eq(worldKv.key, key)); return r?.value as T | undefined; };
const kvSet = (key: string, value: unknown) => getDb().insert(worldKv).values({ key, value }).onConflictDoUpdate({ target: worldKv.key, set: { value, updated_at: new Date() } });

export class FeishuBot {
  private client?: lark.Client; private ws?: lark.WSClient; private saved?: Saved;
  private seen = new Set<string>(); private timer?: NodeJS.Timeout; private ticking = false;
  pending?: { url: string; qr_svg: string; expires_at: number; abort: AbortController };
  error?: string;
  constructor(private bus: Bus | undefined) {}

  get state() { return { connected: !!this.client, app_id: this.saved?.app_id ?? null, brand: this.saved?.brand ?? null, has_owner: !!this.saved?.owner, connected_at: this.saved?.connected_at ?? null, pending: this.pending ? { url: this.pending.url, qr_svg: this.pending.qr_svg, expires_at: this.pending.expires_at } : null, error: this.error ?? null }; }

  /** 服务启动时：之前接入过就直接连上 */
  async resume() { const s = await kvGet<Saved>('feishu').catch(() => undefined); if (s?.app_id) await this.start(s).catch((e) => { this.error = String((e as Error).message); logger.warn({ err: this.error }, '飞书机器人启动失败'); }); }

  /** 开始扫码接入：返回二维码；扫码确认后在后台完成接入并给扫码的人发一条消息 */
  async connect(origin: string): Promise<void> {
    this.pending?.abort.abort(); this.pending = undefined; this.error = undefined;
    const abort = new AbortController();
    await new Promise<void>((ready, fail) => {
      lark.registerApp({
        source: 'jobs', signal: abort.signal, createOnly: true,
        appPreset: { name: 'Jobs', desc: '把产品发布到 JobsWorld，看住在里面的人怎么对待它' },
        addons: { scopes: { tenant: ['im:message', 'im:message:send_as_bot', 'im:message.p2p_msg:readonly', 'im:message.group_at_msg:readonly'] }, events: { items: { tenant: ['im.message.receive_v1'] } } },
        onQRCodeReady: (info) => { void QRCode.toString(info.url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }).then((svg) => { this.pending = { url: info.url, qr_svg: svg, expires_at: Date.now() + info.expireIn * 1000, abort }; ready(); }, fail); },
      }).then(async (r) => {
        const saved: Saved = { app_id: r.client_id, secret: seal(r.client_secret, 'feishu'), owner: r.user_info?.open_id, brand: r.user_info?.tenant_brand ?? 'feishu', origin, connected_at: new Date().toISOString() };
        await kvSet('feishu', saved); this.pending = undefined;
        await this.start(saved);
        await this.tell('Jobs 已接入飞书。\n\n' + HELP).catch((e) => logger.warn({ err: String((e as Error).message) }, '飞书欢迎消息发送失败'));
      }).catch((e) => { this.pending = undefined; if (!abort.signal.aborted) { this.error = String((e as Error).message ?? e).slice(0, 200); logger.warn({ err: this.error }, '飞书扫码接入没有完成'); } fail(e); });
    });
  }

  async disconnect() { this.pending?.abort.abort(); this.pending = undefined; this.stop(); this.saved = undefined; this.error = undefined; await getDb().delete(worldKv).where(inArray(worldKv.key, ['feishu', 'feishu_cursor'])); }

  private stop() { if (this.timer) clearInterval(this.timer); this.timer = undefined; try { this.ws?.close(); } catch { /* 已经断开 */ } this.ws = undefined; this.client = undefined; }

  private async start(s: Saved) {
    this.stop(); this.saved = s;
    const base = { appId: s.app_id, appSecret: open(s.secret, 'feishu'), domain: s.brand === 'lark' ? lark.Domain.Lark : lark.Domain.Feishu, loggerLevel: lark.LoggerLevel.warn };
    this.client = new lark.Client(base);
    this.ws = new lark.WSClient(base);
    const dispatcher = new lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data) => {
        const m = data.message; if (!m || this.seen.has(m.message_id)) return; this.seen.add(m.message_id); if (this.seen.size > 400) this.seen = new Set([...this.seen].slice(-200));
        if (m.message_type !== 'text') return;
        let text = ''; try { text = String((JSON.parse(m.content) as { text?: string }).text ?? ''); } catch { return; }
        // 三秒内必须应答事件：活儿放到后面慢慢做
        void this.handle(text, m.chat_id, data.sender?.sender_id?.open_id).catch((e) => this.reply(m.chat_id, `出错了：${String((e as Error).message).slice(0, 200)}`).catch(() => undefined));
      },
    });
    await this.ws.start({ eventDispatcher: dispatcher });
    this.timer = setInterval(() => void this.tick(), 20_000);
    logger.info({ app_id: s.app_id }, '飞书机器人已连接');
  }

  private send(receive_id_type: 'open_id' | 'chat_id', receive_id: string, text: string) {
    if (!this.client) throw new Error('飞书还没接入');
    return this.client.im.message.create({ params: { receive_id_type }, data: { receive_id, msg_type: 'text', content: JSON.stringify({ text: text.slice(0, 3800) }) } });
  }
  reply(chatId: string, text: string) { return this.send('chat_id', chatId, text); }
  /** 主动告诉接入的那个人 */
  async tell(text: string) { if (this.saved?.owner) await this.send('open_id', this.saved.owner, text); }
  private link(path: string) { return this.saved?.origin ? `${this.saved.origin}${path}` : ''; }

  private async view(l: E.LaunchRow): Promise<E.LaunchView> {
    const [s] = await getDb().select({ cost: studies.cost_usd, tokens: studies.tokens }).from(studies).where(eq(studies.id, l.study_id));
    return { id: l.id, name: l.name, tagline: l.tagline, url: l.url, intensity: l.intensity, status: l.status, funnel: await E.launchFunnel(l.id), spend: { usd: Math.round((s?.cost ?? 0) * 100) / 100, tokens: s?.tokens ?? 0 } };
  }
  private async pick(ref?: string): Promise<E.LaunchRow | undefined> { if (ref) return E.getLaunch(ref); return (await E.listLaunches({ liveOnly: true }))[0] ?? (await E.listLaunches())[0]; }
  private async request(subject: string, data: unknown, timeout = 120_000) {
    if (!this.bus) throw new Error('世界服务没有在运行');
    const m = await this.bus.nc.request(subject, new TextEncoder().encode(JSON.stringify(data)), { timeout });
    const out = JSON.parse(new TextDecoder().decode(m.data)) as Record<string, unknown>; if (out.error) throw new Error(String(out.error)); return out;
  }

  /** 处理飞书里发来的一句话。发布、调宣发、递手机只听接入者本人的 */
  async handle(text: string, chatId: string, sender?: string) {
    const c = parseCommand(text);
    const owner = !this.saved?.owner || sender === this.saved.owner;
    const guard = () => { if (!owner) throw new Error('只有接入 Jobs 的人能这样做'); };
    if (c.cmd === 'help') return void (await this.reply(chatId, HELP));
    if (c.cmd === 'unknown') return void (await this.reply(chatId, `没听懂「${c.text.slice(0, 40)}」。\n\n${HELP}`));
    if (c.cmd === 'list') { const ls = await E.listLaunches(); const lines = []; for (const l of ls.slice(0, 10)) lines.push(`${l.name}${l.status === 'live' ? '' : l.status === 'paused' ? '（已暂停）' : '（已结束）'}\n${E.funnelLine(await E.launchFunnel(l.id))}`); return void (await this.reply(chatId, lines.join('\n\n') || '还没有发布过产品。跟我说：发布 <网址> <名字> <一句话介绍>')); }
    if (c.cmd === 'publish') { guard(); await this.reply(chatId, `正在发布「${c.name}」…`); const l = await E.publishProduct({ url: c.url, name: c.name, tagline: c.tagline }); return void (await this.reply(chatId, `已发布「${l.name}」。城里的人接下来会自己遇到它。\n想马上得到反馈：邀请 ${l.name} 3\n${this.link(`/products/${l.id}`)}`)); }
    if (c.cmd === 'ask') {
      const p = (await latestPersonas()).find((x) => { const n = (x.spec as PersonaSpec).identity.name; return n === c.who || n.includes(c.who) || c.who.includes(n); });
      if (!p) return void (await this.reply(chatId, `城里没有叫「${c.who}」的人。`));
      const name = (p.spec as PersonaSpec).identity.name;
      const o = await this.request(SUBJ.ask, { persona_id: p.id, question: c.question }) as { answer?: string | null; busy?: boolean; none?: boolean };
      return void (await this.reply(chatId, o.busy ? `${name}正在用产品，等这次用完再问。` : o.none ? `${name}还没有用过任何产品。` : `${name}：${o.answer ?? '…'}`));
    }
    const l = await this.pick(c.product);
    if (!l) return void (await this.reply(chatId, c.cmd !== 'promote' && !c.product ? '还没有发布过产品。' : `没有找到产品「${(c as { product?: string }).product}」。`));
    if (c.cmd === 'status') return void (await this.reply(chatId, `${l.name} — ${l.tagline}\n${E.funnelLine(await E.launchFunnel(l.id))}\n宣发强度 ${Math.round(l.intensity * 100)}%\n${this.link(`/products/${l.id}`)}`));
    if (c.cmd === 'report') { await this.reply(chatId, `正在归纳「${l.name}」的结论…`); const r = await E.launchReport(l, 'zh'); return void (await this.reply(chatId, `${E.reportText(await this.view(l), r as unknown as E.ReportView)}\n\n${this.link(`/products/${l.id}`)}`)); }
    if (c.cmd === 'invite') { guard(); const o = await this.request(SUBJ.cmdInvite, { launch_id: l.id, n: c.n }, 180_000) as { invited?: number }; return void (await this.reply(chatId, `已把手机递给 ${o.invited ?? 0} 个人，请他们试用「${l.name}」。他们用完我会告诉你。`)); }
    if (c.cmd === 'promote') { guard(); const out = await E.setPromotion(l.id, { intensity: c.intensity, status: c.status }); return void (await this.reply(chatId, `「${l.name}」：${out?.status === 'paused' ? '已暂停' : out?.status === 'ended' ? '已结束' : '进行中'}，宣发强度 ${Math.round((out?.intensity ?? 0) * 100)}%。`)); }
  }

  /** 每隔一会儿看看有没有该告诉接入者的事：有人用完了、结论该更新了、需要人介入 */
  async tick() {
    if (!this.client || !this.saved?.owner || this.ticking) return; this.ticking = true;
    try {
      const db = getDb(); const nowIso = new Date().toISOString();
      const cur = (await kvGet<Cursor>('feishu_cursor')) ?? { sessions_at: nowIso, human_at: nowIso, reported: {} };
      const ls = await E.listLaunches(); const byStudy = new Map(ls.map((l) => [l.study_id, l]));
      if (ls.length) {
        const done = await db.select({ id: sessions.id, study_id: sessions.study_id, persona_id: sessions.persona_id, outcome: sessions.outcome, end_reason: sessions.end_reason, ended_at: sessions.ended_at, plan: sessions.plan_reason })
          .from(sessions).where(and(inArray(sessions.study_id, ls.map((l) => l.study_id)), gt(sessions.ended_at, new Date(cur.sessions_at)))).orderBy(sessions.ended_at).limit(20);
        if (done.length) {
          const who = new Map((await db.select({ id: personas.id, spec: personas.spec }).from(personas).where(and(inArray(personas.id, done.map((d) => d.persona_id)), eq(personas.active, true)))).map((p) => [p.id, p.spec as PersonaSpec]));
          const lines = done.slice(0, 6).map((d) => { const l = byStudy.get(d.study_id)!; const p = who.get(d.persona_id)?.identity; const invited = (d.plan as { invited?: boolean } | null)?.invited; return `「${l.name}」${p ? `${p.name}（${p.age} 岁，${p.occupation}）` : ''}${invited ? '【受邀】' : ''}${OUTCOME[d.outcome ?? ''] ?? '用完了'}${d.end_reason ? `：${d.end_reason.slice(0, 120)}` : ''}\n${this.link(`/sessions/${d.id}`)}`; });
          await this.tell(lines.join('\n\n') + (done.length > 6 ? `\n\n…还有 ${done.length - 6} 个人也用完了` : ''));
          cur.sessions_at = (done[done.length - 1].ended_at ?? new Date()).toISOString();
          // 用完的人数跨过门槛时推一次结论
          for (const l of ls.filter((x) => x.status !== 'ended')) {
            const f = await E.launchFunnel(l.id); const last = cur.reported[l.id] ?? 0; const hit = [...REPORT_AT].reverse().find((n) => f.opened >= n && n > last);
            if (!hit) continue; cur.reported[l.id] = hit;
            const r = await E.launchReport(l, 'zh').catch(() => undefined);
            if (r) await this.tell(`「${l.name}」已经有 ${f.opened} 个人用过。\n\n${r.headline}\n${r.summary}${r.next ? `\n\n如果只改一件事：${r.next}` : ''}\n\n${this.link(`/products/${l.id}`)}`);
          }
        }
      }
      const need = await db.select().from(humanTasks).where(and(eq(humanTasks.status, 'pending'), gt(humanTasks.created_at, new Date(cur.human_at)))).orderBy(desc(humanTasks.created_at)).limit(5);
      if (need.length) { await this.tell(need.map((h) => `需要你介入：${h.reason}`).join('\n') + `\n${this.link('/human')}`); cur.human_at = need[0].created_at.toISOString(); }
      await kvSet('feishu_cursor', cur);
    } catch (e) { logger.warn({ err: String((e as Error).message).slice(0, 200) }, '飞书推送出错'); }
    finally { this.ticking = false; }
  }
}

export function feishuRoutes(app: FastifyInstance, bus: Bus | undefined) {
  const bot = new FeishuBot(bus);
  void bot.resume();
  app.get('/api/v1/feishu', async (q, r) => { if (!requireAdmin(q, r)) return; return bot.state; });
  app.post('/api/v1/feishu/connect', async (q, r) => {
    if (!requireAdmin(q, r)) return;
    const origin = String(q.headers.origin ?? `${q.protocol}://${q.headers.host ?? ''}`).replace(/\/$/, '');
    try { await bot.connect(origin); return bot.state; } catch (e) { return r.code(502).send({ error: String((e as Error).message).slice(0, 200) }); }
  });
  app.post('/api/v1/feishu/disconnect', async (q, r) => { if (!requireAdmin(q, r)) return; await bot.disconnect(); return bot.state; });
  app.post('/api/v1/feishu/test', async (q, r) => {
    if (!requireAdmin(q, r)) return;
    try { await bot.tell('这是 Jobs 发来的一条测试消息。'); return { ok: true }; } catch (e) { return r.code(502).send({ error: String((e as Error).message).slice(0, 200) }); }
  });
}
