// 设置页上的「一键开通居民邮箱」：维护者只给公网链接和一枚 Cloudflare API Token。
// 依次：确认链接从外网能回到这台 Jobs → 验证令牌 → 找到主机名所在的区 → 上传转发 Worker → 在主机名上开启 Email Routing → 把居民的地址换成这个域名。
import { randomBytes } from 'node:crypto';
import { jobsVersion, logger } from '@pux/core';
import { count, getDb, isNull, mailbox, mailRoutes } from '@pux/db';
import { CfError, cfDeleteWorker, cfEnableRouting, cfFindZone, cfRoutingStatus, cfUploadWorker, cfVerifyToken, CF_TOKEN_PERMISSIONS, type CfZone } from './cloudflare.ts';
import { assignMailAddresses, currentCheck, dropAllRoutes, endMailCheck, ruleCap, type MailCheck } from './routes.ts';
import { FAKE_DOMAIN, isLocalUrl, mailSettings, openMail, publicUrl, saveMailSettings, sealMail, type MailSettings } from './settings.ts';
import { WORKER_COMPAT_DATE, WORKER_NAME, WORKER_SOURCE } from './worker.ts';

const mask = (t: string) => (t.length > 10 ? `${t.slice(0, 4)}…${t.slice(-4)}` : '…');

/** 从这台机器去访问公网链接上的 /inbound/ping：能回到自己，说明 Cloudflare 上的 Worker 也能把信送回来 */
export async function pingSelf(base: string): Promise<string | undefined> {
  try {
    const r = await fetch(`${base}/inbound/ping`, { signal: AbortSignal.timeout(15_000), headers: { 'cache-control': 'no-cache' } });
    const j = await r.json().catch(() => ({})) as { jobs?: boolean };
    if (!r.ok || !j.jobs) return `从外网访问 ${base}/inbound/ping 没有回到这台 Jobs（HTTP ${r.status}）`;
    return undefined;
  } catch (e) { return `从这台机器访问不到 ${base}：${String((e as Error).message).slice(0, 160)}`; }
}

export async function deployMail(rawToken?: string): Promise<MailSettings> {
  const prev = await mailSettings();
  const token = rawToken?.trim() || (prev.token ? openMail(prev.token) : '');
  if (!token) throw new Error('需要一枚 Cloudflare API Token');
  const base = await publicUrl();
  if (isLocalUrl(base) || !base.startsWith('https://')) throw new Error('先在上面填好这台 Jobs 对外的 https 公网链接（例如 Cloudflare Tunnel 绑定的域名）');
  const host = new URL(base).hostname.toLowerCase();
  const fail = async (msg: string) => { await saveMailSettings({ ...prev, status: prev.deployed_at ? 'error' : 'off', error: msg }); return new Error(msg); };

  await saveMailSettings({ ...prev, status: 'deploying', error: undefined });
  const unreachable = await pingSelf(base);
  if (unreachable) throw await fail(unreachable);
  let zone: CfZone;
  try { await cfVerifyToken(token); zone = await cfFindZone(token, host); }
  catch (e) { throw await fail(`Cloudflare 令牌不能用：${(e as Error).message}。令牌需要这些权限：${CF_TOKEN_PERMISSIONS.join('、')}`); }

  const secret = prev.secret ? openMail(prev.secret) : randomBytes(32).toString('hex');
  try {
    await cfUploadWorker(token, zone.account_id, WORKER_NAME, WORKER_SOURCE, { JOBS_INBOUND_URL: `${base}/inbound/email`, JOBS_VERSION: jobsVersion() }, { JOBS_SECRET: secret }, WORKER_COMPAT_DATE);
  } catch (e) { throw await fail(`上传转发 Worker 失败：${(e as Error).message}（需要 Account › Workers Scripts › Edit 权限）`); }

  // 先在公网链接的主机名上开启收信；Cloudflare 不接受（例如主机名上已有 Tunnel 的 CNAME 记录）时，改用 mail.<主机名>
  let domain = host; let note: string | undefined; let status = 'unknown';
  try { status = (await cfEnableRouting(token, zone, host)).status; }
  catch (e1) {
    const alt = `mail.${host}`;
    try { status = (await cfEnableRouting(token, zone, alt)).status; domain = alt; note = `Cloudflare 不允许在 ${host} 上收信（${(e1 as Error).message}），居民邮箱改用 ${alt}`; }
    catch (e2) { throw await fail(`开启 Email Routing 失败：${(e1 as Error).message}；改用 ${alt} 也失败：${(e2 as Error).message}（需要 Zone › Zone Settings › Edit 权限）`); }
  }

  // 换了域名或区：先把旧规则删掉
  if (prev.deployed_at && prev.token && prev.zone_id && (prev.domain !== domain || prev.zone_id !== zone.id)) {
    await endMailCheck().catch(() => {});
    await dropAllRoutes(openMail(prev.token), { id: prev.zone_id, name: prev.zone_name ?? '', account_id: prev.account_id ?? '' }).catch(() => {});
  }
  const next: MailSettings = {
    token: sealMail(token), token_hint: mask(token), account_id: zone.account_id, zone_id: zone.id, zone_name: zone.name, domain, script: WORKER_NAME,
    secret: sealMail(secret), status: 'ready', note: [note, status === 'ready' ? '' : `Cloudflare 报告收信状态是「${status}」：新加的 MX 记录生效通常要几分钟，之后用下面的测试信确认`].filter(Boolean).join('；') || undefined,
    deployed_at: new Date().toISOString(), check: prev.domain === domain ? prev.check : undefined,
  };
  await saveMailSettings(next);
  await assignMailAddresses();
  logger.info({ domain, zone: zone.name, status }, '居民邮箱已部署');
  return next;
}

/** 关掉居民邮箱：删掉自己建的规则和 Worker，居民地址回到 jobsworld.test。Cloudflare 上的 MX 记录留着（维护者自己决定删不删） */
export async function disableMail(): Promise<void> {
  const m = await mailSettings();
  if (m.token && m.zone_id) {
    const token = openMail(m.token); const zone = { id: m.zone_id, name: m.zone_name ?? '', account_id: m.account_id ?? '' };
    await endMailCheck().catch(() => {});
    await dropAllRoutes(token, zone).catch(() => {});
    if (m.account_id) await cfDeleteWorker(token, m.account_id, m.script ?? WORKER_NAME).catch(() => {});
  }
  await saveMailSettings({ status: 'off' });
  await assignMailAddresses();
}

export interface MailStatus {
  status: MailSettings['status']; error?: string; note?: string; domain: string; real: boolean; token_hint?: string; zone?: string; deployed_at?: string;
  cloudflare?: { enabled: boolean; status?: string } | { error: string };
  routes: { used: number; cap: number }; unowned: number; check?: MailCheck; permissions: string[];
}

/** 设置页显示的状态；live=true 时顺便问一下 Cloudflare 现在的收信状态 */
export async function mailStatus(live = false): Promise<MailStatus> {
  const m = await mailSettings(); const db = getDb();
  const [{ n: used }] = await db.select({ n: count() }).from(mailRoutes);
  const [{ n: unowned }] = await db.select({ n: count() }).from(mailbox).where(isNull(mailbox.persona_id));
  let cloudflare: MailStatus['cloudflare'];
  if (live && m.token && m.zone_id) {
    try {
      cloudflare = await cfRoutingStatus(openMail(m.token), { id: m.zone_id, name: m.zone_name ?? '', account_id: m.account_id ?? '' });
    } catch (e) { cloudflare = { error: e instanceof CfError ? e.message : String(e) }; }
  }
  return {
    status: m.status, error: m.error, note: m.note, domain: m.deployed_at && m.domain ? m.domain : FAKE_DOMAIN, real: !!(m.deployed_at && m.domain), token_hint: m.token_hint, zone: m.zone_name, deployed_at: m.deployed_at,
    cloudflare, routes: { used, cap: ruleCap() }, unowned, check: await currentCheck(), permissions: CF_TOKEN_PERMISSIONS,
  };
}
