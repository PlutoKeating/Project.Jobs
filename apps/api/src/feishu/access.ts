// 飞书里谁能用、是什么角色（决策 5「1+3」）：扫码接入的人是管理员；同一飞书组织的其他人默认是访客；
// 私聊发口令配对：管理员口令 → 管理员，访客口令 → 访客；网页里可以改角色、撤销；口令换了，配对得来的身份全部失效。
import { createHash, timingSafeEqual } from 'node:crypto';
import { eq, feishuUsers, getDb } from '@pux/db';

export type Role = 'admin' | 'viewer';
export interface Who { open_id: string; name?: string; tenant_key?: string }
export interface Owner { owner?: string; tenant_key?: string }

const same = (a: string, b: string) => { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
/** 这句话是不是口令本身；是哪一种。没有设置口令时一律不认（不然随便一句话都能配对） */
export function passcodeRole(text: string, env = process.env): Role | null {
  const t = text.trim(); if (!t || t.length > 200) return null;
  if (env.JW_ADMIN_PASSCODE && same(t, env.JW_ADMIN_PASSCODE)) return 'admin';
  if (env.JW_PASSCODE && same(t, env.JW_PASSCODE)) return 'viewer';
  return null;
}
export const pairFp = (env = process.env) => createHash('sha256').update(`jw-feishu|${env.JW_ADMIN_PASSCODE ?? ''}|${env.JW_PASSCODE ?? ''}`).digest('hex').slice(0, 24);

export interface UserRow { open_id: string; name: string | null; tenant_key: string | null; role: string; via: string; fp: string | null; revoked: boolean }

/** 纯规则：这个人此刻是什么角色；null = 不认识（不在接入者的组织里，也没配对过） */
export function decideRole(who: Who, owner: Owner, row: UserRow | undefined, fp: string): { role: Role; via: 'owner' | 'tenant' | 'passcode' | 'web' } | null {
  if (owner.owner && who.open_id === owner.owner) return { role: 'admin', via: 'owner' };
  if (row?.revoked) return null;
  if (row && (row.via !== 'passcode' || row.fp === fp)) return { role: row.role === 'admin' ? 'admin' : 'viewer', via: row.via as 'tenant' | 'passcode' | 'web' };
  if (owner.tenant_key && who.tenant_key && who.tenant_key === owner.tenant_key) return { role: 'viewer', via: 'tenant' };
  return null;
}

export async function loadUser(openId: string): Promise<UserRow | undefined> { const [r] = await getDb().select().from(feishuUsers).where(eq(feishuUsers.open_id, openId)); return r; }

/** 识别说话的人；第一次见到时记一行（返回 first=true，用来发欢迎卡） */
export async function actorOf(who: Who, owner: Owner): Promise<{ role: Role; via: string; first: boolean } | null> {
  const row = await loadUser(who.open_id);
  const d = decideRole(who, owner, row, pairFp());
  if (!d) return null;
  const db = getDb();
  if (!row) await db.insert(feishuUsers).values({ open_id: who.open_id, name: who.name ?? null, tenant_key: who.tenant_key ?? null, role: d.role, via: d.via }).onConflictDoNothing();
  else await db.update(feishuUsers).set({ last_seen_at: new Date(), ...(who.name && who.name !== row.name ? { name: who.name } : {}), ...(d.via === 'owner' && (row.role !== 'admin' || row.via !== 'owner') ? { role: 'admin', via: 'owner', revoked: false } : {}) }).where(eq(feishuUsers.open_id, who.open_id));
  return { ...d, first: !row };
}

/** 口令配对（只在私聊里接受） */
export async function pair(who: Who, role: Role) {
  await getDb().insert(feishuUsers).values({ open_id: who.open_id, name: who.name ?? null, tenant_key: who.tenant_key ?? null, role, via: 'passcode', fp: pairFp() })
    .onConflictDoUpdate({ target: feishuUsers.open_id, set: { role, via: 'passcode', fp: pairFp(), revoked: false, last_seen_at: new Date() } });
}

export const listUsers = () => getDb().select().from(feishuUsers);
/** 网页上改角色或撤销（改了角色就不再依赖口令） */
export async function setUser(openId: string, patch: { role?: Role; revoked?: boolean }) {
  await getDb().update(feishuUsers).set({ ...(patch.role ? { role: patch.role, via: 'web', fp: null } : {}), ...(patch.revoked !== undefined ? { revoked: patch.revoked } : {}) }).where(eq(feishuUsers.open_id, openId));
}
