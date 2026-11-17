// 一次性的只读签名链接（决策 16）：飞书卡片里的网页链接换成 <公网链接>/s/<令牌>。手机上点开，不用输口令就能看那一页；
// 令牌只存哈希、只能打开一次、24 小时过期；打开后这个浏览器得到 1 天的访客身份（只读）。没有设置口令时不需要签名，原样返回。
import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { eq, getDb, signedLinks } from '@pux/db';
import { publicUrl } from '@pux/engine/mail/settings';
import { authEnabled, grantViewer, roleOf } from './auth.ts';

const TTL = 24 * 3600_000;
const hash = (t: string) => createHash('sha256').update(`jw-link|${t}`).digest('hex');
const PAGE = /^\/(products|sessions|people|human)(\/[\w-]*)?([?#].*)?$/;

/** 一个页面的一次性链接 */
export async function signLink(path: string): Promise<string> {
  const base = await publicUrl();
  if (!authEnabled() || !PAGE.test(path)) return `${base}${path}`;
  const t = randomBytes(18).toString('base64url');
  await getDb().insert(signedLinks).values({ hash: hash(t), path, expires_at: new Date(Date.now() + TTL) });
  return `${base}/s/${t}`;
}

/** 把一段回答里指向本站页面的链接都换成一次性链接 */
export async function signLinksIn(text: string): Promise<string> {
  if (!authEnabled() || !text) return text;
  const base = await publicUrl(); const esc = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${esc}(/(?:products|sessions|people|human)(?:/[\\w-]*)?)`, 'g');
  const found = [...new Set([...text.matchAll(re)].map((m) => m[1]))];
  let out = text;
  for (const p of found) { const u = await signLink(p); out = out.split(`${base}${p}`).join(u); }
  return out;
}

export function signedRoutes(app: FastifyInstance) {
  app.get('/s/:token', async (q, r) => {
    const t = (q.params as { token: string }).token;
    const [row] = await getDb().select().from(signedLinks).where(eq(signedLinks.hash, hash(t)));
    if (!row) return r.redirect('/');
    if (roleOf(q).viewer) return r.redirect(row.path);                         // 已经登录过：直接去
    if (row.used_at || row.expires_at.getTime() < Date.now()) return r.redirect('/');   // 用过或过期：去登录页
    await getDb().update(signedLinks).set({ used_at: new Date() }).where(eq(signedLinks.hash, row.hash));
    grantViewer(r);
    return r.redirect(row.path);
  });
}
