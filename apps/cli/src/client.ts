// 本机 Jobs 服务的 HTTP 客户端（命令行与 MCP 共用）
export const apiBase = () => { const b = process.env.JOBS_API ?? `http://127.0.0.1:${process.env.JW_PORT ?? 7777}`; return b.endsWith('/') ? b.slice(0, -1) : b; };
const key = () => process.env.JOBS_KEY ?? process.env.JW_ADMIN_PASSCODE ?? process.env.JW_PASSCODE ?? '';

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (key()) headers.authorization = `Bearer ${key()}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const method = opts.method ?? (opts.body !== undefined ? 'POST' : 'GET');
  // 读操作遇到中转层的短暂失败（502/503/504、连接被重置）重试几次；写操作不重试，免得重复发布、重复邀请
  const tries = method === 'GET' ? 4 : 1;
  let r!: Response; let text = '';
  for (let i = 0; i < tries; i++) {
    try { r = await fetch(`${apiBase()}/api/v1${path}`, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined, signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000) }); }
    catch (e) { if (i + 1 < tries) { await new Promise((x) => setTimeout(x, 1500 * (i + 1))); continue; } throw new Error(`连不上 Jobs 服务（${apiBase()}）：${String((e as Error).message)}。服务没启动的话先运行 pnpm jobsworld`); }
    text = await r.text();
    if ([502, 503, 504].includes(r.status) && i + 1 < tries) { await new Promise((x) => setTimeout(x, 1500 * (i + 1))); continue; }
    break;
  }
  let data: unknown; try { data = text ? JSON.parse(text) : {}; } catch { data = { error: /^\s*<(!doctype|html)/i.test(text) ? `中转层返回了一个网页错误（${r.status}），不是 Jobs 自己的错误，稍后再试；一直这样就检查 Jobs 服务和隧道是否在运行` : text.slice(0, 300) }; }
  if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? `没有权限（${r.status}）：把管理员口令放进环境变量 JOBS_KEY` : `${r.status} ${(data as { error?: string }).error ?? text.slice(0, 200)}`);
  return data as T;
}

export { funnelLine, reportText, type Cited, type EngineeringView, type FunnelView, type LaunchView, type ReportView } from '@pux/engine/launch/text';
