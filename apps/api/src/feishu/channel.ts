// 飞书渠道：收发都基于官方 SDK 的 LarkChannel（长连接、消息归一化、去重、过期消息丢弃、群里要 @、卡片回调），
// 说的话交给 Jobs Agent（@pux/agent，和网页、命令行是同一个），Agent 的事件画成 CardKit 卡片（步骤 + 逐字出现的回答 + 停止）。
// 扫码接入用 registerApp 的一键创建应用；已经接入过、权限不够新的，用 registerApp({ appId }) 对原应用补权限。
import * as lark from '@larksuiteoapi/node-sdk';
import QRCode from 'qrcode';
import type { FastifyInstance } from 'fastify';
import { logger } from '@pux/core';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { confirmText, DbStore, type Actor, type AgentHub, type AgentOut, type Out } from '@pux/agent';
import { JOBS_TOOLS } from '@pux/engine/launch/tools';
import { eq, getDb, worldKv } from '@pux/db';
import { open, seal } from '@pux/llm';
import { actorOf, pair, passcodeRole, type Role } from './access.ts';
import { alertCard, confirmCard, residentCard, welcomeCard, type Card } from './cards.ts';
import { AnswerStream, type CardApi } from './stream.ts';
import { internalFile } from '../internal.ts';

/** 扫码时给应用追加的权限、事件、回调。改了这里就把 ADDONS_VERSION 加一：旧的接入会提示重新扫码补权限 */
export const ADDONS_VERSION = 2;
export const ADDONS: lark.AppAddons = {
  scopes: {
    tenant: ['im:message', 'im:message:send_as_bot', 'im:message.p2p_msg:readonly', 'im:message.group_at_msg:readonly', 'im:message:readonly', 'im:resource', 'im:chat:readonly', 'cardkit:card:write', 'im:message.urgent', 'im:message.urgent:app_send', 'im:message.reactions:write_only', 'contact:user.base:readonly', 'docx:document', 'drive:drive', 'docs:permission.member:create', 'docs:permission.member:transfer'],
  },
  events: { items: { tenant: ['im.message.receive_v1', 'im.chat.member.bot.added_v1'] } },
  callbacks: { items: ['card.action.trigger'] },
};

export interface Saved { app_id: string; secret: string; owner?: string; owner_name?: string; tenant_key?: string; brand?: 'feishu' | 'lark'; origin?: string; connected_at: string; addons?: number }

export const kvGet = async <T,>(key: string): Promise<T | undefined> => { const [r] = await getDb().select().from(worldKv).where(eq(worldKv.key, key)); return r?.value as T | undefined; };
export const kvSet = (key: string, value: unknown) => getDb().insert(worldKv).values({ key, value }).onConflictDoUpdate({ target: worldKv.key, set: { value, updated_at: new Date() } });

/** 会话键：私聊、群各一条；话题里每个话题一条（决策 6「1+3」） */
export const sessionKey = (chatId: string, threadId?: string) => (threadId ? `feishu:${chatId}:${threadId}` : `feishu:${chatId}`);
export const chatOfSession = (s: string) => { const [, chat, thread] = s.split(':'); return { chat_id: chat, thread }; };
/** @ 机器人的占位、多余空白去掉 */
export const cleanText = (s: string) => s.replace(/@_user_\d+/g, ' ').replace(/@_all/g, ' ').replace(/[ \t]+/g, ' ').trim();
const TEXT_FILE = /\.(txt|md|markdown|json|csv|tsv|log|ya?ml|html?|xml|ts|js|py)$/i;

export class FeishuChannel {
  ch?: lark.LarkChannel; saved?: Saved; error?: string;
  pending?: { url: string; qr_svg: string; expires_at: number; abort: AbortController; upgrade: boolean };
  /** 卡片实体的 sequence（每张卡严格递增）；进程重启后用时间推算，仍然递增 */
  private seqs = new Map<string, number>();
  private chatNames = new Map<string, string>();
  private lastActor = new Map<string, Actor>();
  /** 推送器（notify.ts）挂在这里：会话里的推送偏好工具、新绑定的推送去处 */
  onOwnerSeen?: (chatId: string) => void;
  /** 只在飞书里才有的工具（推送偏好、导出云文档），由 notify.ts / docs.ts 注入 */
  extraTools: (session: string, actor: Actor) => AgentTool<object>[] = () => [];

  constructor(private app: FastifyInstance, private hub: AgentHub) {}

  get connected() { return !!this.ch; }
  get state() {
    const s = this.saved;
    return { connected: this.connected, app_id: s?.app_id ?? null, brand: s?.brand ?? null, has_owner: !!s?.owner, owner_name: s?.owner_name ?? null, connected_at: s?.connected_at ?? null, needs_upgrade: !!s && (s.addons ?? 1) < ADDONS_VERSION, pending: this.pending ? { url: this.pending.url, qr_svg: this.pending.qr_svg, expires_at: this.pending.expires_at, upgrade: this.pending.upgrade } : null, error: this.error ?? null };
  }

  async resume() { const s = await kvGet<Saved>('feishu').catch(() => undefined); if (s?.app_id) await this.start(s).catch((e) => { this.error = String((e as Error).message); logger.warn({ err: this.error }, '飞书机器人启动失败'); }); }

  /** 扫码：没接入过 → 一键创建应用；接入过但权限旧了（upgrade）→ 对原应用补权限 */
  async connect(origin: string, upgrade = false): Promise<void> {
    this.pending?.abort.abort(); this.pending = undefined; this.error = undefined;
    const abort = new AbortController(); const prev = upgrade ? this.saved : undefined;
    await new Promise<void>((ready, fail) => {
      lark.registerApp({
        source: 'jobs', signal: abort.signal, ...(prev ? { appId: prev.app_id } : { createOnly: true }),
        appPreset: { name: 'Jobs', desc: '把产品发布到 JobsWorld，看住在里面的人怎么对待它' },
        addons: ADDONS,
        onQRCodeReady: (info) => { void QRCode.toString(info.url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }).then((svg) => { this.pending = { url: info.url, qr_svg: svg, expires_at: Date.now() + info.expireIn * 1000, abort, upgrade: !!prev }; ready(); }, fail); },
      }).then(async (r) => {
        const saved: Saved = { ...(prev ?? {}), app_id: r.client_id, secret: seal(r.client_secret, 'feishu'), owner: r.user_info?.open_id ?? prev?.owner, brand: r.user_info?.tenant_brand ?? prev?.brand ?? 'feishu', origin, connected_at: new Date().toISOString(), addons: ADDONS_VERSION };
        await kvSet('feishu', saved); this.pending = undefined;
        await this.start(saved);
        if (saved.owner) await this.sendCard({ open_id: saved.owner }, prev ? alertCard({ title: '权限已经补上', text: '流式回答、卡片按钮、图片与文件、应用内加急都可以用了。', tone: 'green' }) : welcomeCard({ role: 'admin' })).catch((e) => logger.warn({ err: String((e as Error).message) }, '飞书欢迎消息发送失败'));
      }).catch((e) => { this.pending = undefined; if (!abort.signal.aborted) { this.error = String((e as Error).message ?? e).slice(0, 200); logger.warn({ err: this.error }, '飞书扫码没有完成'); } fail(e); });
    });
  }

  async disconnect() { this.pending?.abort.abort(); this.pending = undefined; await this.stop(); this.saved = undefined; this.error = undefined; await getDb().delete(worldKv).where(eq(worldKv.key, 'feishu')); }
  private async stop() { try { await this.ch?.disconnect(); } catch { /* 已经断开 */ } this.ch = undefined; }

  async start(s: Saved) {
    await this.stop(); this.saved = s;
    const ch = lark.createLarkChannel({ appId: s.app_id, appSecret: open(s.secret, 'feishu'), domain: s.brand === 'lark' ? lark.Domain.Lark : lark.Domain.Feishu, loggerLevel: lark.LoggerLevel.warn, source: 'jobs', includeRawEvent: true, handshakeTimeoutMs: 20_000,
      // 谁能用由我们自己判断（access.ts）；群里要 @ 才回
      policy: { dmMode: 'open', requireMention: true, respondToMentionAll: false },
      // 同一个聊天的消息不用排队：Agent 自己处理插话与排队
      safety: { chatQueue: { enabled: false }, batch: { text: { delayMs: 600 } } },
    });
    ch.on({
      message: (m) => { void this.onMessage(m).catch((e) => logger.warn({ err: String((e as Error).message).slice(0, 200) }, '飞书消息处理出错')); },
      cardAction: (e) => { void this.onCardAction(e).catch((err) => logger.warn({ err: String((err as Error).message).slice(0, 200) }, '飞书卡片回调出错')); },
      botAdded: (e) => { void this.sendCard({ chat_id: e.chatId }, welcomeCard({ role: 'viewer' })).catch(() => undefined); },
      error: (e) => { logger.warn({ code: e.code, err: e.message.slice(0, 200) }, '飞书渠道出错'); },
    });
    await ch.connect();
    this.ch = ch; this.error = undefined;
    logger.info({ app_id: s.app_id }, '飞书机器人已连接');
  }

  // ---------------------------------------------------------------- 发卡片
  private seq(cardId: string) { const n = Math.max((this.seqs.get(cardId) ?? 0) + 1, Math.floor((Date.now() - 1.7e12) / 100)); this.seqs.set(cardId, n); return n; }
  get cardApi(): CardApi {
    const c = this.ch!.rawClient;
    const ok = <T extends { code?: number; msg?: string }>(r: T) => { if (r.code) throw new Error(`飞书 ${r.code}：${r.msg ?? ''}`); return r; };
    return {
      create: async (card) => String(ok(await c.cardkit.v1.card.create({ data: { type: 'card_json', data: JSON.stringify(card) } })).data?.card_id ?? ''),
      send: async (to, cardId) => {
        const content = JSON.stringify({ type: 'card', data: { card_id: cardId } });
        const r = to.reply_to ? await c.im.v1.message.reply({ path: { message_id: to.reply_to }, data: { msg_type: 'interactive', content, reply_in_thread: !!to.in_thread } }) : await c.im.v1.message.create({ params: { receive_id_type: 'chat_id' }, data: { receive_id: to.chat_id, msg_type: 'interactive', content } });
        return String(ok(r).data?.message_id ?? '');
      },
      content: async (cardId, el, text, seq) => { ok(await c.cardkit.v1.cardElement.content({ path: { card_id: cardId, element_id: el }, data: { content: text, sequence: seq } })); this.seqs.set(cardId, Math.max(seq, this.seqs.get(cardId) ?? 0)); },
      update: async (cardId, card, seq) => { ok(await c.cardkit.v1.card.update({ path: { card_id: cardId }, data: { card: { type: 'card_json', data: JSON.stringify(card) }, sequence: seq } })); this.seqs.set(cardId, Math.max(seq, this.seqs.get(cardId) ?? 0)); },
      settings: async (cardId, settings, seq) => { ok(await c.cardkit.v1.card.settings({ path: { card_id: cardId }, data: { settings: JSON.stringify(settings), sequence: seq } })); this.seqs.set(cardId, Math.max(seq, this.seqs.get(cardId) ?? 0)); },
    };
  }
  /** 发一张能改的卡片（卡片实体），返回 { cardId, messageId } */
  async sendCard(to: { chat_id?: string; open_id?: string; reply_to?: string; in_thread?: boolean }, card: Card): Promise<{ cardId: string; messageId: string }> {
    if (!this.ch) throw new Error('飞书还没接入');
    const api = this.cardApi; const cardId = await api.create(card);
    if (to.open_id) { const r = await this.ch.rawClient.im.v1.message.create({ params: { receive_id_type: 'open_id' }, data: { receive_id: to.open_id, msg_type: 'interactive', content: JSON.stringify({ type: 'card', data: { card_id: cardId } }) } }); return { cardId, messageId: String(r.data?.message_id ?? '') }; }
    return { cardId, messageId: await api.send({ chat_id: to.chat_id!, reply_to: to.reply_to, in_thread: to.in_thread }, cardId) };
  }
  async updateCard(cardId: string, card: Card) { await this.cardApi.update(cardId, card, this.seq(cardId)); }
  /** 应用内加急（只对需要人介入这类卡住的事） */
  async urgent(messageId: string, openIds: string[]) { if (!this.ch || !openIds.length) return; await this.ch.rawClient.im.v1.message.urgentApp({ path: { message_id: messageId }, params: { user_id_type: 'open_id' }, data: { user_id_list: openIds } }); }
  /** 证据截图 → 飞书图片 key */
  async evidenceImage(evidenceId: string): Promise<string | undefined> {
    if (!this.ch) return undefined;
    const f = await internalFile(this.app, 'admin', `/evidence/${encodeURIComponent(evidenceId)}`); if (!f || !/^image\//.test(f.type) || f.body.length > 10 * 1024 * 1024) return undefined;
    const r = await this.ch.rawClient.im.v1.image.create({ data: { image_type: 'message', image: f.body } });
    return r?.image_key ?? undefined;
  }

  // ---------------------------------------------------------------- 收消息
  private async chatName(chatId: string) { if (!this.chatNames.has(chatId)) { const n = await this.ch!.getChatInfo(chatId).then((x) => x.name ?? '').catch(() => ''); this.chatNames.set(chatId, n); } return this.chatNames.get(chatId) ?? ''; }

  private async onMessage(m: lark.NormalizedMessage) {
    if (!this.ch || !this.saved) return;
    const raw = (m.raw ?? {}) as { header?: { tenant_key?: string }; event?: { sender?: { tenant_key?: string } }; sender?: { tenant_key?: string } };
    const tenant = raw.header?.tenant_key ?? raw.event?.sender?.tenant_key ?? raw.sender?.tenant_key;
    const who = { open_id: m.senderId, name: m.senderName, tenant_key: tenant };
    // 接入者第一次说话时记下他所在的组织：同组织的人默认是访客
    if (who.open_id === this.saved.owner && tenant && (this.saved.tenant_key !== tenant || (m.senderName && this.saved.owner_name !== m.senderName))) { this.saved = { ...this.saved, tenant_key: tenant, owner_name: m.senderName ?? this.saved.owner_name }; await kvSet('feishu', this.saved); }
    if (who.open_id === this.saved.owner && m.chatType === 'p2p') this.onOwnerSeen?.(m.chatId);
    const text = cleanText(m.content);
    const reply = (card: Card) => this.sendCard({ chat_id: m.chatId, reply_to: m.messageId, in_thread: !!m.threadId }, card);

    // 口令配对：只在私聊里，且这句话就是口令本身
    const pr = m.chatType === 'p2p' ? passcodeRole(text) : null;
    if (pr) { await pair(who, pr); await reply(alertCard({ title: pr === 'admin' ? '已配对为管理员' : '已配对为访客', text: `${pr === 'admin' ? '你现在什么都能做。' : '你现在能看，不能改。'}\n建议把刚才发口令的那条消息撤回。`, tone: 'green' })); return; }

    const a = await actorOf(who, this.saved);
    if (!a) { if (m.chatType === 'p2p' || m.mentionedBot) await reply(alertCard({ title: '还不认识你', text: '你不在接入 Jobs 的那个飞书组织里。请私聊把 Jobs 的口令发给我（管理员口令能做全部的事，访客口令只能看）。', tone: 'grey' })); return; }
    const actor: Actor = { id: `feishu:${who.open_id}`, name: who.name, role: a.role as Role };
    if (a.first || /^(\/help|帮助|help|\?|？)$/i.test(text)) { await reply(welcomeCard({ role: actor.role, name: who.name })); if (!text || /^(\/help|帮助|help|\?|？)$/i.test(text)) return; }

    // 图片、文件
    const images: { data: string; mime: string }[] = []; const notes: string[] = [];
    for (const r of m.resources.slice(0, 6)) {
      try {
        if (r.type === 'image' && images.length < 3) { const buf = await this.resource(m.messageId, r.fileKey, 'image'); if (buf.length < 8 * 1024 * 1024) images.push({ data: buf.toString('base64'), mime: 'image/png' }); }
        else if (r.type === 'file' && r.fileName && TEXT_FILE.test(r.fileName)) { const buf = await this.resource(m.messageId, r.fileKey, 'file'); notes.push(`[文件 ${r.fileName}]\n${buf.toString('utf8').slice(0, 20_000)}`); }
        else if (r.type !== 'sticker') notes.push(`[${r.type === 'file' ? `文件 ${r.fileName ?? ''}（不是文本，读不了）` : r.type === 'audio' ? '语音（读不了，请打字）' : r.type === 'video' ? '视频（读不了）' : r.type}]`);
      } catch (e) { notes.push(`[${r.type} 下载失败：${String((e as Error).message).slice(0, 80)}]`); }
    }
    const body = [text, ...notes].filter(Boolean).join('\n\n');
    if (!body && !images.length) return;
    const session = sessionKey(m.chatId, m.chatType === 'group' ? m.threadId : undefined);
    this.lastActor.set(session, actor);
    const where = m.chatType === 'group' ? `在飞书群「${await this.chatName(m.chatId)}」里，好几个人共用这段对话；说话的是${who.name ?? '某人'}（${actor.role === 'admin' ? '管理员' : '访客'}）。` : undefined;
    const out = this.outFor(session, { chat_id: m.chatId, reply_to: m.messageId, in_thread: !!m.threadId }, m.messageId);
    const how = await this.hub.send({ session, channel: 'feishu', actor, input: { text: body, images }, out, where, extraTools: this.extraTools(session, actor) });
    void how;
  }

  /** 用户发来的图片和文件（LarkChannel.downloadResource 只能取机器人自己上传的，用户的要走 messageResource） */
  private async resource(messageId: string, fileKey: string, type: 'image' | 'file'): Promise<Buffer> {
    const r = await this.ch!.rawClient.im.v1.messageResource.get({ path: { message_id: messageId, file_key: fileKey }, params: { type } });
    const chunks: Buffer[] = []; for await (const c of r.getReadableStream()) chunks.push(Buffer.from(c as Buffer));
    return Buffer.concat(chunks);
  }

  /** Agent 的事件 → 卡片：一轮一张回答卡（步骤 + 逐字回答 + 停止），确认与跟居民聊另发卡片 */
  outFor(session: string, to: { chat_id: string; reply_to?: string; in_thread?: boolean }, userMessageId?: string): Out {
    let stream: AnswerStream | undefined; const images: string[] = [];
    const ensure = () => (stream ??= new AnswerStream(this.cardApi, to, { a: 'stop', s: session }));
    return (e: AgentOut) => {
      void (async () => {
        switch (e.type) {
          case 'start': await ensure().start(); break;
          case 'text': ensure().append(e.delta); break;
          case 'step': ensure().step(e.id, e.label, e.status, e.detail); break;
          case 'image': { const k = await this.evidenceImage(e.evidence_id).catch(() => undefined); if (k) images.push(k); break; }
          case 'confirm': { const c = await this.sendCard(to, confirmCard({ label: e.label, text: e.text, actionId: e.action_id })); await new DbStore().setActionRef(e.action_id, c.cardId); break; }
          case 'resident': await this.sendCard(to, residentCard({ name: e.name, text: e.text, session })); break;
          case 'notice': if (userMessageId) await this.ch?.addReaction(userMessageId, 'OK').catch(() => undefined); break;
          case 'end': {
            const text = await this.links(e.text);
            if (stream) await stream.finish({ text, images, error: e.aborted ? '已停止' : e.error });
            else if (e.error) await this.sendCard(to, alertCard({ title: '没有成功', text: e.error, tone: 'red' }));
            else if (text) await this.sendCard(to, alertCard({ title: 'Jobs', text, tone: 'grey' }));
            break;
          }
          default: break;
        }
      })().catch((err) => logger.warn({ err: String((err as Error).message).slice(0, 200), type: e.type }, '飞书卡片更新失败'));
    };
  }

  /** 回答里的网页链接换成一次性的只读签名链接（signed.ts 注入；没有时原样） */
  links: (text: string) => Promise<string> = async (t) => t;

  /** 后台等到结果：往这个会话所在的聊天另起一张回答卡 */
  proactive(session: string) {
    if (!this.ch || !this.saved) return undefined;
    const { chat_id } = chatOfSession(session);
    const actor = this.lastActor.get(session) ?? { id: `feishu:${this.saved.owner}`, name: this.saved.owner_name, role: 'admin' as const };
    return { out: this.outFor(session, { chat_id }), channel: 'feishu' as const, actor, extraTools: this.extraTools(session, actor) };
  }

  // ---------------------------------------------------------------- 卡片按钮
  private async onCardAction(e: lark.CardActionEvent) {
    if (!this.saved) return;
    const v = (e.action.value ?? {}) as { a?: string; id?: string; approve?: boolean; s?: string; q?: string };
    const raw = (e.raw ?? {}) as { header?: { tenant_key?: string }; event?: { tenant_key?: string } };
    const a = await actorOf({ open_id: e.operator.openId, name: e.operator.name, tenant_key: raw.header?.tenant_key ?? raw.event?.tenant_key }, this.saved);
    if (!a) return;
    const actor: Actor = { id: `feishu:${e.operator.openId}`, name: e.operator.name, role: a.role as Role };
    if (v.a === 'confirm' && v.id) {
      const row = await new DbStore().getAction(v.id); const cardId = row?.message_ref;
      const label = JOBS_TOOLS.find((x) => x.name === row?.tool)?.label ?? row?.tool ?? '';
      const text = row ? confirmText(row.tool, row.args) : '';
      if (cardId && actor.role === 'admin' && v.approve !== false) await this.updateCard(cardId, confirmCard({ label, text, actionId: v.id, state: 'running' })).catch(() => undefined);
      const r = await this.hub.decide(v.id, v.approve !== false, actor);
      if (cardId) await this.updateCard(cardId, confirmCard({ label, text, actionId: v.id, state: r.status === 'pending' ? undefined : (r.status as 'done'), result: r.text, by: actor.name })).catch(() => undefined);
      if (r.status === 'pending') await this.sendCard({ chat_id: e.chatId }, alertCard({ title: '没有确认', text: r.text, tone: 'grey' }));
      return;
    }
    if (v.a === 'stop' && v.s) { this.hub.stop(v.s); return; }
    const session = v.s ?? sessionKey(e.chatId);
    const text = v.a === 'end_resident' ? '结束' : v.a === 'ask' && v.q ? v.q : '';
    if (!text) return;
    this.lastActor.set(session, actor);
    await this.hub.send({ session, channel: 'feishu', actor, input: { text }, out: this.outFor(session, { chat_id: chatOfSession(session).chat_id }), extraTools: this.extraTools(session, actor) });
  }
}

