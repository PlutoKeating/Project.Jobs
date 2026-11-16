// 这台 Jobs 的设置：对外的公网链接，以及居民邮箱（Cloudflare 转发）的部署状态。
// 存在 world_kv 里，接口和世界服务都从这里读；缓存几秒，网页上改了几秒内两边都生效。
import { eq, getDb, worldKv } from '@pux/db';
import { open, seal } from '@pux/llm';

export interface SiteSettings { public_url?: string }

/** 居民邮箱的部署状态。token、secret 是密文（与模型凭证同一把主密钥） */
export interface MailSettings {
  token?: string;          // Cloudflare API Token（密文）
  token_hint?: string;     // 网页上显示的脱敏标识
  account_id?: string;
  zone_id?: string;
  zone_name?: string;
  domain?: string;         // 居民邮箱的域名（部署时确定）
  script?: string;         // 转发 Worker 的名字
  secret?: string;         // Worker 与 /inbound/email 之间的签名密钥（密文）
  status: 'off' | 'deploying' | 'ready' | 'error';
  error?: string;
  note?: string;            // 部署时值得告诉维护者的事（例如改用了 mail.<主机名>、DNS 还在生效）
  deployed_at?: string;
  /** 最近一次自检：发一封测试信，看它有没有转回来 */
  check?: { ok: boolean; at: string; detail: string };
}

const KV_SITE = 'settings'; const KV_MAIL = 'mail';
const TTL = 3000;
let cache: { at: number; site: SiteSettings; mail: MailSettings } | undefined;

async function kv<T>(key: string): Promise<T | undefined> {
  const [r] = await getDb().select().from(worldKv).where(eq(worldKv.key, key));
  return r?.value as T | undefined;
}
async function kvSet(key: string, value: unknown) {
  await getDb().insert(worldKv).values({ key, value: value as never }).onConflictDoUpdate({ target: worldKv.key, set: { value: value as never, updated_at: new Date() } });
  cache = undefined;
}

async function load() {
  if (cache && Date.now() - cache.at < TTL) return cache;
  const [site, mail] = await Promise.all([kv<SiteSettings>(KV_SITE), kv<MailSettings>(KV_MAIL)]);
  cache = { at: Date.now(), site: site ?? {}, mail: mail ?? { status: 'off' } };
  return cache;
}

export const siteSettings = async () => (await load()).site;
export const mailSettings = async () => (await load()).mail;
export async function saveMailSettings(m: MailSettings) { await kvSet(KV_MAIL, m); }
export function forgetSettingsCache() { cache = undefined; }

/** 把用户填的链接整理成 https://host[:port][/path]；不像链接时抛错 */
export function normalizePublicUrl(raw: string): string {
  let s = raw.trim();
  if (!s) return '';
  if (!/^[a-z]+:\/\//i.test(s)) s = `https://${s}`;
  const u = new URL(s);
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('公网链接需要是 http(s) 地址');
  return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`;
}

let lastPublic = '';
/** Jobs 对外的地址：设置页填的 > 环境变量 JOBS_PUBLIC_URL > 本机地址 */
export async function publicUrl(): Promise<string> {
  const s = await siteSettings().catch(() => ({} as SiteSettings));
  lastPublic = (s.public_url || process.env.JOBS_PUBLIC_URL?.trim() || `http://127.0.0.1:${process.env.JW_PORT ?? 7777}`).replace(/\/+$/, '');
  return lastPublic;
}
/** 同步版本：最近一次读到的值（还没读过时按环境变量） */
export function publicUrlSync(): string {
  return lastPublic || (process.env.JOBS_PUBLIC_URL?.trim() || `http://127.0.0.1:${process.env.JW_PORT ?? 7777}`).replace(/\/+$/, '');
}
export async function publicUrlSet(): Promise<boolean> {
  const s = await siteSettings().catch(() => ({} as SiteSettings));
  return !!(s.public_url || process.env.JOBS_PUBLIC_URL?.trim());
}

export async function savePublicUrl(raw: string): Promise<string> {
  const url = raw.trim() ? normalizePublicUrl(raw) : '';
  await kvSet(KV_SITE, { ...(await siteSettings()), public_url: url || undefined });
  return publicUrl();
}

/** 一个链接是不是只有本机能访问（127.0.0.1、localhost、局域网地址） */
export function isLocalUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === 'localhost' || h.endsWith('.localhost') || /^127\./.test(h) || h === '::1' || h === '[::1]' || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h.endsWith('.local');
  } catch { return true; }
}

export const sealMail = (plain: string) => seal(plain, 'mail');
export const openMail = (cipher: string) => open(cipher, 'mail');

/** 还没部署真实邮箱时居民用的域名 */
export const FAKE_DOMAIN = 'jobsworld.test';

/** 居民邮箱现在用的域名：部署成功过就是部署时的域名（之后自检偶尔失败也不改地址），否则是 jobsworld.test */
export async function mailDomain(): Promise<string> {
  const m = await mailSettings().catch(() => ({ status: 'off' } as MailSettings));
  return m.deployed_at && m.domain ? m.domain : FAKE_DOMAIN;
}
export async function realMailReady(): Promise<boolean> { return (await mailDomain()) !== FAKE_DOMAIN; }
