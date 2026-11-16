// 收信：Cloudflare 上的转发 Worker 把原始邮件 POST 到 /inbound/email，这里验签、解析、存证据、放进对应居民的收件箱。
import { createHmac, timingSafeEqual } from 'node:crypto';
import { simpleParser } from 'mailparser';
import { logger } from '@pux/core';
import { putEvidence } from '@pux/executor';
import { deliverMail } from '../launch/identity.ts';
import { mailSettings, openMail } from './settings.ts';
import { MAX_MAIL_BYTES } from './worker.ts';
import { noteCheckMail, touchRoute } from './routes.ts';

/** 签名：HMAC-SHA256(secret, `${ts}.${to}.` + 原始邮件)，十六进制。时间戳与现在相差超过 10 分钟的不收（防重放） */
export function signInbound(secret: string, ts: string, to: string, raw: Buffer): string {
  return createHmac('sha256', secret).update(`${ts}.${to}.`).update(raw).digest('hex');
}

export function verifyInbound(secret: string, h: { ts?: string; to?: string; sig?: string }, raw: Buffer, now = Date.now()): string | undefined {
  if (!h.ts || !h.to || !h.sig) return 'missing signature headers';
  if (!/^\d{10,16}$/.test(h.ts) || Math.abs(now - Number(h.ts)) > 10 * 60_000) return 'stale timestamp';
  const want = Buffer.from(signInbound(secret, h.ts, h.to, raw), 'hex'); const got = Buffer.from(h.sig, 'hex');
  if (want.length !== got.length || !timingSafeEqual(want, got)) return 'bad signature';
  return undefined;
}

export type InboundResult = { status: 200 | 400 | 401 | 413 | 503; body: Record<string, unknown> };

/** 处理一封转发来的信。返回的状态码决定 Worker 怎么做：2xx 收下，4xx 退信，5xx 让对方稍后重投 */
export async function receiveInbound(raw: Buffer, h: { ts?: string; to?: string; from?: string; sig?: string }): Promise<InboundResult> {
  const m = await mailSettings();
  if (!m.secret) return { status: 503, body: { error: 'mail_not_configured' } };
  if (raw.length > MAX_MAIL_BYTES) return { status: 413, body: { error: 'too_large' } };
  const bad = verifyInbound(openMail(m.secret), h, raw);
  if (bad) { logger.warn({ why: bad, to: h.to }, '拒收一封签名不对的转发邮件'); return { status: 401, body: { error: bad } }; }
  const to = String(h.to).trim().toLowerCase();
  const parsed = await simpleParser(raw, { skipImageLinks: true });
  const subject = parsed.subject ?? '';
  const sender = parsed.from?.text || h.from || '';
  const html = typeof parsed.html === 'string' ? parsed.html : undefined;
  const text = (parsed.text ?? (html ? htmlToText(html) : '')).trim();
  // 自检用的测试信：不属于任何居民
  if (await noteCheckMail(to, { sender, subject })) return { status: 200, body: { ok: true, check: true } };
  const raw_ev = await putEvidence('email', {}, { data: raw, mime: 'message/rfc822' });
  const r = await deliverMail({ kind: 'email', address: to, sender, subject, body: text || subject, html, message_id: parsed.messageId, raw_ev });
  if (r.persona_id) await touchRoute(to, { received: true }).catch(() => {});
  logger.info({ to, persona: r.persona_id, dup: !!r.duplicate }, r.persona_id ? '居民收到一封真实邮件' : '收到一封没有对应居民的邮件');
  return { status: 200, body: { ok: true, id: r.id, persona_id: r.persona_id } };
}

/** HTML 邮件没有纯文本部分时，取它的文字 */
export function htmlToText(html: string): string {
  return html.replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
