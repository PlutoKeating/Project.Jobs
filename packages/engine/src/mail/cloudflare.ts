// Cloudflare v4 接口的最小封装：验证令牌、找到域名所在的区、上传转发 Worker、开启 Email Routing、增删收信路由规则。
// 只用维护者在设置页贴进来的 API Token；不需要 wrangler。

const API = process.env.JOBS_CF_API ?? 'https://api.cloudflare.com/client/v4';

export class CfError extends Error {
  constructor(message: string, readonly status: number, readonly codes: number[] = []) { super(message); }
}

type CfEnvelope<T> = { success: boolean; errors?: { code: number; message: string }[]; result: T; result_info?: { total_count?: number; total_pages?: number } };

async function cf<T>(token: string, method: string, path: string, body?: unknown, init: { form?: FormData } = {}): Promise<CfEnvelope<T>> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: init.form ?? (body !== undefined ? JSON.stringify(body) : undefined),
    signal: AbortSignal.timeout(30_000),
  });
  const j = await res.json().catch(() => ({ success: false, errors: [{ code: res.status, message: res.statusText }] })) as CfEnvelope<T>;
  if (!res.ok || !j.success) {
    const errs = j.errors ?? [];
    throw new CfError(errs.map((e) => `${e.message} (${e.code})`).join('; ') || `HTTP ${res.status}`, res.status, errs.map((e) => e.code));
  }
  return j;
}

/** 令牌能不能用（GET /user/tokens/verify） */
export async function cfVerifyToken(token: string): Promise<void> {
  const r = await cf<{ status: string }>(token, 'GET', '/user/tokens/verify');
  if (r.result.status !== 'active') throw new CfError(`令牌状态是 ${r.result.status}`, 403);
}

export interface CfZone { id: string; name: string; account_id: string }

/** 主机名所在的区：从完整主机名开始逐级去掉最左边一段，直到找到一个这枚令牌看得到的区 */
export async function cfFindZone(token: string, host: string): Promise<CfZone> {
  const parts = host.toLowerCase().split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    const name = parts.slice(i).join('.');
    const r = await cf<{ id: string; name: string; account: { id: string } }[]>(token, 'GET', `/zones?name=${encodeURIComponent(name)}`);
    if (r.result[0]) return { id: r.result[0].id, name: r.result[0].name, account_id: r.result[0].account.id };
  }
  throw new CfError(`这枚令牌看不到 ${host} 所在的域名。确认域名托管在 Cloudflare，并且令牌的「区域资源」包含它`, 404);
}

/** 上传（或覆盖）一个 ES 模块 Worker，带上普通变量和机密变量 */
export async function cfUploadWorker(token: string, accountId: string, name: string, source: string, vars: Record<string, string>, secrets: Record<string, string>, compatibilityDate: string): Promise<void> {
  const metadata = {
    main_module: 'worker.js', compatibility_date: compatibilityDate,
    bindings: [...Object.entries(vars).map(([n, text]) => ({ type: 'plain_text', name: n, text })), ...Object.entries(secrets).map(([n, text]) => ({ type: 'secret_text', name: n, text }))],
  };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('worker.js', new Blob([source], { type: 'application/javascript+module' }), 'worker.js');
  await cf(token, 'PUT', `/accounts/${accountId}/workers/scripts/${encodeURIComponent(name)}`, undefined, { form });
}

export async function cfDeleteWorker(token: string, accountId: string, name: string): Promise<void> {
  await cf(token, 'DELETE', `/accounts/${accountId}/workers/scripts/${encodeURIComponent(name)}?force=true`).catch((e) => { if ((e as CfError).status !== 404) throw e; });
}

/** 在区或它的一个子域上开启 Email Routing（POST /zones/{id}/email/routing/dns，需要「区域设置」编辑权限）：Cloudflare 自动加上 MX、SPF、DKIM 记录。
 *  返回 Cloudflare 报告的状态：ready 才是能收信了 */
export async function cfEnableRouting(token: string, zone: CfZone, host: string): Promise<{ status: string; name: string }> {
  const r = await cf<{ status?: string; name?: string }>(token, 'POST', `/zones/${zone.id}/email/routing/dns`, { name: host });
  return { status: r.result?.status ?? 'unknown', name: r.result?.name ?? host };
}

/** 区上 Email Routing 的状态（GET /zones/{id}/email/routing） */
export async function cfRoutingStatus(token: string, zone: CfZone): Promise<{ enabled: boolean; status?: string }> {
  const r = await cf<{ enabled: boolean; status?: string }>(token, 'GET', `/zones/${zone.id}/email/routing`);
  return { enabled: !!r.result.enabled, status: r.result.status };
}

/** 收信要用的 DNS 记录（GET /zones/{id}/email/routing/dns） */
export async function cfRoutingRecords(token: string, zone: CfZone): Promise<{ type: string; name: string; content: string }[]> {
  const r = await cf<{ type: string; name: string; content: string }[] | { record?: { type: string; name: string; content: string }[] }>(token, 'GET', `/zones/${zone.id}/email/routing/dns`);
  return Array.isArray(r.result) ? r.result : r.result.record ?? [];
}

/** 令牌需要的权限（设置页照这个说明怎么建令牌） */
export const CF_TOKEN_PERMISSIONS = ['Zone › Zone › Read', 'Zone › Zone Settings › Edit', 'Zone › Email Routing Rules › Edit', 'Account › Workers Scripts › Edit'];

export interface CfRule { id: string; name?: string; enabled: boolean; matchers: { type: string; field?: string; value?: string }[]; actions: { type: string; value?: string[] }[] }

/** 一个地址 → 交给转发 Worker */
export async function cfCreateRule(token: string, zone: CfZone, address: string, script: string): Promise<string> {
  const r = await cf<{ id?: string; tag?: string }>(token, 'POST', `/zones/${zone.id}/email/routing/rules`, {
    name: `jobsworld ${address}`, enabled: true, priority: 0,
    matchers: [{ type: 'literal', field: 'to', value: address }],
    actions: [{ type: 'worker', value: [script] }],
  });
  const id = r.result.id ?? r.result.tag;
  if (!id) throw new CfError('Cloudflare 没有返回规则的 id', 500);
  return id;
}

export async function cfDeleteRule(token: string, zone: CfZone, id: string): Promise<void> {
  await cf(token, 'DELETE', `/zones/${zone.id}/email/routing/rules/${id}`).catch((e) => { if ((e as CfError).status !== 404) throw e; });
}

export async function cfListRules(token: string, zone: CfZone): Promise<CfRule[]> {
  const out: CfRule[] = [];
  for (let page = 1; page <= 20; page++) {
    const r = await cf<(CfRule & { tag?: string })[]>(token, 'GET', `/zones/${zone.id}/email/routing/rules?page=${page}&per_page=50`);
    out.push(...r.result.map((x) => ({ ...x, id: x.id ?? x.tag ?? '' })));
    if (r.result.length < 50) break;
  }
  return out;
}

/** 这个错误是不是「规则数到上限了」 */
export const isRuleLimit = (e: unknown) => e instanceof CfError && /limit|maximum|too many/i.test(e.message);
