// 居民的地址与收信规则。
// 邮件域名是公网链接的主机名（子域）：Cloudflare 不允许在子域上用通配规则，只能一个地址一条，每个域最多 200 条。
// Cloudflare 上新建的规则要一两分钟才在它的收信服务器上生效（实测：刚建好就发来的信被退回「Address does not exist」），
// 而居民开始用产品后几十秒就可能要验证码，所以开通后就在后台把规则预先建到上限（prewarmRoutes），城里绝大多数人一开始就能收信；
// 超出上限的人在开始一次使用时按需建（ensureMailRoute），名额不够时先回收从没收到过真实邮件的人，再回收收到过的，各按最久没用的先回收。
// 被回收的人地址不变，下次再用产品时重新建规则。
import { randomBytes } from 'node:crypto';
import { logger, type PersonaSpec } from '@pux/core';
import { and, asc, eq, getDb, inArray, isNotNull, mailbox, mailRoutes, notInArray, personas, residents, sessions, sql, worldKv } from '@pux/db';
import { isLegacyHandle, mailHandle } from '@pux/jobsworld';
import { cfCreateRule, cfDeleteRule, isRuleLimit, type CfZone } from './cloudflare.ts';
import { FAKE_DOMAIN, mailDomain, mailSettings, openMail } from './settings.ts';

/** 自己最多占多少条规则（给维护者在同一个域上的其他规则和自检留出余量）。JOBS_MAIL_RULE_CAP 可改 */
export const ruleCap = () => Math.max(5, Math.min(200, Number(process.env.JOBS_MAIL_RULE_CAP ?? 190)));

async function cfCtx(): Promise<{ token: string; zone: CfZone; script: string; domain: string } | undefined> {
  const m = await mailSettings();
  if (!m.deployed_at || !m.token || !m.zone_id || !m.account_id || !m.zone_name || !m.script || !m.domain) return undefined;
  return { token: openMail(m.token), zone: { id: m.zone_id, name: m.zone_name, account_id: m.account_id }, script: m.script, domain: m.domain };
}

/** 给每个居民一个像真人的地址，域名换成现在的邮件域名。旧的编号式用户名（zh.r.779e0d8c）换掉；已经像真人的保持不变 */
export async function assignMailAddresses(): Promise<{ changed: number; domain: string }> {
  const db = getDb(); const domain = await mailDomain();
  const rows = await db.select({ id: residents.persona_id, email: residents.email, spec: personas.spec }).from(residents).leftJoin(personas, eq(personas.id, residents.persona_id));
  const taken = new Set<string>(); const plan: { id: string; local?: string; email: string | null }[] = [];
  for (const r of rows) { const local = r.email?.split('@')[0]?.toLowerCase(); if (local && !isLegacyHandle(local)) taken.add(local); plan.push({ id: r.id, local: local && !isLegacyHandle(local) ? local : undefined, email: r.email }); }
  let changed = 0;
  for (const p of plan) {
    const spec = rows.find((r) => r.id === p.id)?.spec as PersonaSpec | null;
    const local = p.local ?? (spec ? mailHandle({ id: p.id, name: spec.identity.name, locale: spec.locale, age: spec.identity.age, gender: spec.identity.gender }, taken) : undefined);
    if (!local) continue;
    const email = `${local}@${domain}`;
    if (email !== p.email) { await db.update(residents).set({ email }).where(eq(residents.persona_id, p.id)); changed++; }
  }
  if (changed) logger.info({ changed, domain }, '居民邮箱地址已更新');
  return { changed, domain };
}

/** 一次使用开始前：确保这个人的地址在 Cloudflare 上有一条规则（没部署真实邮箱时什么也不做）。返回他的地址 */
export async function ensureMailRoute(personaId: string): Promise<string | undefined> {
  const db = getDb();
  const [r] = await db.select({ email: residents.email }).from(residents).where(eq(residents.persona_id, personaId));
  const address = r?.email?.toLowerCase();
  if (!address || address.endsWith(`@${FAKE_DOMAIN}`)) return address;
  const ctx = await cfCtx(); if (!ctx || !address.endsWith(`@${ctx.domain}`)) return address;
  const [have] = await db.select().from(mailRoutes).where(eq(mailRoutes.address, address));
  if (have) { await touchRoute(address); return address; }
  for (let attempt = 0; attempt < 3; attempt++) {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(mailRoutes);
    if (n >= ruleCap()) await evictRoutes(n - ruleCap() + 1, ctx);
    try {
      const rule_id = await cfCreateRule(ctx.token, ctx.zone, address, ctx.script);
      await db.insert(mailRoutes).values({ address, persona_id: personaId, rule_id }).onConflictDoUpdate({ target: mailRoutes.address, set: { rule_id, persona_id: personaId, last_used_at: new Date() } });
      logger.info({ address }, '已为这位居民开通收信');
      return address;
    } catch (e) {
      if (isRuleLimit(e)) { await evictRoutes(1, ctx); continue; }
      logger.warn({ address, err: String((e as Error).message).slice(0, 200) }, '开通收信失败：这次使用里他收不到真实邮件');
      return address;
    }
  }
  return address;
}

let warming: Promise<number> | undefined;
/** 把收信规则预先建到上限：先给最近用过产品的人，再给其余的人。已经建好的跳过；重复调用时等上一次做完。返回新建了几条 */
export function prewarmRoutes(): Promise<number> {
  warming ??= (async () => {
    const ctx = await cfCtx(); if (!ctx) return 0;
    const db = getDb();
    const have = new Set((await db.select({ a: mailRoutes.address }).from(mailRoutes)).map((x) => x.a));
    let room = ruleCap() - have.size; if (room <= 0) return 0;
    const recent = new Map((await db.select({ p: sessions.persona_id, at: sql<Date>`max(${sessions.started_at})` }).from(sessions).groupBy(sessions.persona_id)).map((x) => [x.p, x.at ? new Date(x.at).getTime() : 0]));
    const rows = (await db.select({ id: residents.persona_id, email: residents.email }).from(residents))
      .map((r) => ({ id: r.id, address: r.email?.toLowerCase() ?? '' }))
      .filter((r) => r.address.endsWith(`@${ctx.domain}`) && !have.has(r.address))
      .sort((a, b) => (recent.get(b.id) ?? 0) - (recent.get(a.id) ?? 0));
    let made = 0;
    for (const r of rows) {
      if (room <= 0) break;
      const [again] = await db.select({ a: mailRoutes.address }).from(mailRoutes).where(eq(mailRoutes.address, r.address));
      if (again) continue;
      try {
        const rule_id = await cfCreateRule(ctx.token, ctx.zone, r.address, ctx.script);
        await db.insert(mailRoutes).values({ address: r.address, persona_id: r.id, rule_id }).onConflictDoNothing();
        made++; room--;
      } catch (e) {
        if (isRuleLimit(e)) break;
        logger.warn({ address: r.address, err: String((e as Error).message).slice(0, 160) }, '预建收信规则失败');
        break;
      }
    }
    if (made) logger.info({ made }, '已预先为居民开通收信');
    return made;
  })().finally(() => { warming = undefined; });
  return warming;
}

export async function touchRoute(address: string, _o: { received?: boolean } = {}) {
  await getDb().update(mailRoutes).set({ last_used_at: new Date() }).where(eq(mailRoutes.address, address.toLowerCase()));
}

/** 回收 k 条规则：正在用产品的人不回收；先回收从没收到过真实邮件的人，再回收收到过的；各自按最久没用的先回收 */
export async function evictRoutes(k: number, ctx?: Awaited<ReturnType<typeof cfCtx>>): Promise<number> {
  ctx ??= await cfCtx(); if (!ctx || k <= 0) return 0;
  const db = getDb();
  const busy = (await db.select({ p: sessions.persona_id }).from(sessions).where(inArray(sessions.status, ['planned', 'running', 'waiting_human']))).map((x) => x.p);
  const withMail = new Set((await db.selectDistinct({ p: mailbox.persona_id }).from(mailbox).where(and(isNotNull(mailbox.persona_id), isNotNull(mailbox.raw_ev)))).map((x) => x.p));
  const rows = await db.select().from(mailRoutes).where(busy.length ? notInArray(mailRoutes.persona_id, busy) : undefined).orderBy(asc(mailRoutes.last_used_at));
  const order = [...rows.filter((r) => !withMail.has(r.persona_id)), ...rows.filter((r) => withMail.has(r.persona_id))].slice(0, k);
  for (const r of order) {
    await cfDeleteRule(ctx.token, ctx.zone, r.rule_id).catch((e) => logger.warn({ err: String((e as Error).message).slice(0, 160) }, '删除收信规则失败'));
    await db.delete(mailRoutes).where(eq(mailRoutes.address, r.address));
  }
  if (order.length) logger.info({ n: order.length }, '回收了一些居民的收信规则');
  return order.length;
}

/** 删除自己建的全部规则（换域名、关掉邮箱时） */
export async function dropAllRoutes(token: string, zone: CfZone): Promise<void> {
  const db = getDb();
  for (const r of await db.select().from(mailRoutes)) await cfDeleteRule(token, zone, r.rule_id).catch(() => {});
  await db.delete(mailRoutes);
}

// ---- 自检：给一个临时地址建规则，维护者从自己的邮箱给它发一封信，看它有没有转回来 ----
export interface MailCheck { address: string; rule_id: string; created_at: string; received_at?: string; sender?: string; subject?: string }
const KV_CHECK = 'mail_check';

export async function currentCheck(): Promise<MailCheck | undefined> {
  const [r] = await getDb().select().from(worldKv).where(eq(worldKv.key, KV_CHECK));
  return r?.value as MailCheck | undefined;
}
async function saveCheck(c: MailCheck | undefined) {
  const db = getDb();
  if (!c) { await db.delete(worldKv).where(eq(worldKv.key, KV_CHECK)); return; }
  await db.insert(worldKv).values({ key: KV_CHECK, value: c as never }).onConflictDoUpdate({ target: worldKv.key, set: { value: c as never, updated_at: new Date() } });
}

/** 开始一次自检：建一个 check 开头的临时地址。之前的临时地址一并删掉 */
export async function startMailCheck(): Promise<MailCheck> {
  const ctx = await cfCtx(); if (!ctx) throw new Error('居民邮箱还没部署');
  await endMailCheck();
  const address = `check${randomBytes(3).toString('hex').replace(/[^a-z0-9]/g, '')}@${ctx.domain}`;
  const rule_id = await cfCreateRule(ctx.token, ctx.zone, address, ctx.script);
  const c = { address, rule_id, created_at: new Date().toISOString() };
  await saveCheck(c);
  return c;
}

export async function endMailCheck(): Promise<void> {
  const c = await currentCheck(); if (!c) return;
  const ctx = await cfCtx(); if (ctx) await cfDeleteRule(ctx.token, ctx.zone, c.rule_id).catch(() => {});
  await saveCheck(undefined);
}

/** 收信时调用：如果是自检地址，记下收到了，返回 true */
export async function noteCheckMail(to: string, info: { sender: string; subject: string }): Promise<boolean> {
  const c = await currentCheck();
  if (!c || c.address !== to) return false;
  await saveCheck({ ...c, received_at: new Date().toISOString(), sender: info.sender.slice(0, 200), subject: info.subject.slice(0, 200) });
  return true;
}
