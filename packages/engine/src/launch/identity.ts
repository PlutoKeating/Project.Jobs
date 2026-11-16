// 虚拟身份：世界给每个人一个邮箱、一个手机号和一个钱包。产品发来的验证码他真的收得到；付款走沙箱，从钱包里扣。
import { newId, type PersonaSpec, langOf } from '@pux/core';
import { and, desc, eq, getDb, inArray, mailbox, or, residents, sessions, sql } from '@pux/db';
import { findCodes, findLinks } from '../mail/extract.ts';
import { personaAccount } from '../exploration/goals.ts';
import { isLegacyHandle } from '@pux/jobsworld';

/** 注册时这个人会用的身份：自己的邮箱和手机号，习惯用的用户名和密码，手头有多少钱。只描述个人习惯，不预设任何答案 */
export async function identityHint(p: PersonaSpec): Promise<string> {
  const [r] = await getDb().select().from(residents).where(eq(residents.persona_id, p.id));
  const zh = langOf(p.locale) === 'zh';
  // 惯用的用户名就是邮箱 @ 前面那一段（真人常这样）；还是旧的编号式地址时沿用原来的写法
  const local = r?.email?.split('@')[0]; const acc0 = personaAccount(p, 'jobsworld');
  const acc = { ...acc0, username: local && !isLegacyHandle(local) ? local : acc0.username };
  const money = r ? (zh ? `你手头大约有 ${Math.round(r.wallet)} ${r.currency === 'CNY' ? '元' : '美元'}。` : `You have about ${r.currency === 'USD' ? '$' : '¥'}${Math.round(r.wallet)} on hand.`) : '';
  return zh
    ? `如果需要注册或登录：你的邮箱是 ${r?.email ?? `${acc.username}@jobsworld.test`}，手机号是 ${r?.phone ?? '19900000000'}；你平时惯用的用户名是「${acc.username}」，习惯用的密码是「${acc.password}」。验证码会发到你的邮箱（手机上有邮箱 App）或以短信发到手机上。${money}`
    : `If you need to sign up or log in: your email is ${r?.email ?? `${acc.username}@jobsworld.test`} and your phone number is ${r?.phone ?? '+15550000000'}; the username you usually use is "${acc.username}" and the password you habitually use is "${acc.password}". Verification codes arrive in your email (you have a mail app) or by text. ${money}`;
}

const normPhone = (s: string) => s.replace(/[^\d+]/g, '').replace(/^(\+?86|0086)/, '');

export interface IncomingMail { kind: 'email' | 'sms'; address: string; sender?: string; subject?: string; body: string; html?: string; message_id?: string; raw_ev?: string }

/** 产品发来一封邮件或一条短信：按地址或号码找到这个人，放进他的收件箱。同一封信（Message-ID 相同）重复投递只收一次 */
export async function deliverMail(m: IncomingMail): Promise<{ id: string; persona_id: string | null; duplicate?: boolean }> {
  const db = getDb(); const addr = m.kind === 'sms' ? normPhone(m.address) : m.address.trim().toLowerCase();
  const rows = await db.select({ id: residents.persona_id, email: residents.email, phone: residents.phone }).from(residents).where(m.kind === 'email' ? sql`lower(${residents.email}) = ${addr}` : or(eq(residents.phone, addr), eq(residents.phone, `+${addr}`), eq(residents.phone, m.address)));
  const pid = rows[0]?.id ?? null;
  if (m.message_id) {
    const [dup] = await db.select({ id: mailbox.id }).from(mailbox).where(and(eq(mailbox.address, addr), eq(mailbox.message_id, m.message_id)));
    if (dup) return { id: dup.id, persona_id: pid, duplicate: true };
  }
  // 信到的时候他正在用哪个产品（工程附录据此算「信多久才到」「他有没有去看」）
  const [live] = pid ? await db.select({ id: sessions.id }).from(sessions).where(and(eq(sessions.persona_id, pid), inArray(sessions.status, ['running', 'waiting_human']))).orderBy(desc(sessions.started_at)).limit(1) : [];
  const id = newId('mail');
  const extracted = m.kind === 'email' ? { codes: findCodes(`${m.subject ?? ''}\n${m.body}`), links: findLinks(m.html, m.body) } : undefined;
  await db.insert(mailbox).values({ id, persona_id: pid, kind: m.kind, address: addr, sender: m.sender ?? null, subject: m.subject ?? null, body: m.body.slice(0, 20000), html: m.html?.slice(0, 400_000) ?? null, message_id: m.message_id ?? null, raw_ev: m.raw_ev ?? null, extracted: extracted ?? null, session_id: live?.id ?? null });
  return { id, persona_id: pid };
}

/** 这个人还没被告知的新邮件和短信（取出即标记为已告知）。邮件只给发件人和标题（像手机上的推送），正文要他自己去邮箱看；短信推送本来就显示全文 */
export async function unseenMail(personaId: string): Promise<{ id: string; kind: string; sender: string | null; subject: string | null; body: string }[]> {
  const db = getDb();
  const rows = await db.select().from(mailbox).where(and(eq(mailbox.persona_id, personaId), eq(mailbox.seen, false)));
  if (rows.length) await db.update(mailbox).set({ seen: true }).where(and(eq(mailbox.persona_id, personaId), eq(mailbox.seen, false)));
  return rows.map((r) => ({ id: r.id, kind: r.kind, sender: r.sender, subject: r.subject, body: r.kind === 'sms' ? r.body : '' }));
}

export async function inbox(personaId: string, limit = 30) {
  return getDb().select().from(mailbox).where(eq(mailbox.persona_id, personaId)).orderBy(desc(mailbox.created_at)).limit(limit);
}

/** 从一段屏幕文字里读出金额（「确认支付 ¥19.9」「Pay $4.99」） */
export function amountIn(text: string): number | undefined {
  const m = /(?:[¥￥$]|rmb|usd)\s*(\d+(?:\.\d{1,2})?)/i.exec(text) ?? /(\d+(?:\.\d{1,2})?)\s*(?:元|块|美元|dollars?)/i.exec(text);
  return m ? Number(m[1]) : undefined;
}

/** 沙箱付款成功后从钱包里扣钱（不会扣成负数） */
export async function payFromWallet(personaId: string, amount: number): Promise<number | undefined> {
  const db = getDb();
  const [r] = await db.select().from(residents).where(eq(residents.persona_id, personaId));
  if (!r) return undefined;
  const left = Math.max(0, Math.round((r.wallet - amount) * 100) / 100);
  await db.update(residents).set({ wallet: left }).where(eq(residents.persona_id, personaId));
  return left;
}
