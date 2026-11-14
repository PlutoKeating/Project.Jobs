// 虚拟身份：世界给每个人一个邮箱、一个手机号和一个钱包。产品发来的验证码他真的收得到；付款走沙箱，从钱包里扣。
import { newId, type PersonaSpec, langOf } from '@pux/core';
import { and, eq, getDb, mailbox, or, residents, sql } from '@pux/db';
import { personaAccount } from '../exploration/goals.ts';

/** 注册时这个人会用的身份：自己的邮箱和手机号，习惯用的用户名和密码，手头有多少钱。只描述个人习惯，不预设任何答案 */
export async function identityHint(p: PersonaSpec): Promise<string> {
  const [r] = await getDb().select().from(residents).where(eq(residents.persona_id, p.id));
  const acc = personaAccount(p, 'jobsworld'); const zh = langOf(p.locale) === 'zh';
  const money = r ? (zh ? `你手头大约有 ${Math.round(r.wallet)} ${r.currency === 'CNY' ? '元' : '美元'}。` : `You have about ${r.currency === 'USD' ? '$' : '¥'}${Math.round(r.wallet)} on hand.`) : '';
  return zh
    ? `如果需要注册或登录：你的邮箱是 ${r?.email ?? `${acc.username}@jobsworld.test`}，手机号是 ${r?.phone ?? '19900000000'}；你平时惯用的用户名是「${acc.username}」，习惯用的密码是「${acc.password}」。验证码会发到你的邮箱或手机上。${money}`
    : `If you need to sign up or log in: your email is ${r?.email ?? `${acc.username}@jobsworld.test`} and your phone number is ${r?.phone ?? '+15550000000'}; the username you usually use is "${acc.username}" and the password you habitually use is "${acc.password}". Verification codes arrive in your email or by text. ${money}`;
}

const normPhone = (s: string) => s.replace(/[^\d+]/g, '').replace(/^(\+?86|0086)/, '');

/** 产品（或它的测试环境）发来一封邮件或一条短信：按地址或号码找到这个人，放进他的收件箱 */
export async function deliverMail(m: { kind: 'email' | 'sms'; address: string; sender?: string; subject?: string; body: string }): Promise<{ id: string; persona_id: string | null }> {
  const db = getDb(); const addr = m.kind === 'sms' ? normPhone(m.address) : m.address.trim().toLowerCase();
  const rows = await db.select({ id: residents.persona_id, email: residents.email, phone: residents.phone }).from(residents).where(m.kind === 'email' ? sql`lower(${residents.email}) = ${addr}` : or(eq(residents.phone, addr), eq(residents.phone, `+${addr}`), eq(residents.phone, m.address)));
  const pid = rows[0]?.id ?? null; const id = newId('mail');
  await db.insert(mailbox).values({ id, persona_id: pid, kind: m.kind, address: addr, sender: m.sender ?? null, subject: m.subject ?? null, body: m.body.slice(0, 4000) });
  return { id, persona_id: pid };
}

/** 这个人还没看到的新邮件和短信（取出即标记为已看到） */
export async function unseenMail(personaId: string): Promise<{ kind: string; sender: string | null; subject: string | null; body: string }[]> {
  const db = getDb();
  const rows = await db.select().from(mailbox).where(and(eq(mailbox.persona_id, personaId), eq(mailbox.seen, false)));
  if (rows.length) await db.update(mailbox).set({ seen: true }).where(and(eq(mailbox.persona_id, personaId), eq(mailbox.seen, false)));
  return rows.map((r) => ({ kind: r.kind, sender: r.sender, subject: r.subject, body: r.body }));
}

export async function inbox(personaId: string, limit = 30) {
  return (await getDb().select().from(mailbox).where(eq(mailbox.persona_id, personaId))).sort((a, b) => b.created_at.getTime() - a.created_at.getTime()).slice(0, limit);
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
