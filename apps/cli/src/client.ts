// 本机 Jobs 服务的 HTTP 客户端（命令行与 MCP 共用）
export const apiBase = () => { const b = process.env.JOBS_API ?? `http://127.0.0.1:${process.env.JW_PORT ?? 7777}`; return b.endsWith('/') ? b.slice(0, -1) : b; };
const key = () => process.env.JOBS_KEY ?? process.env.JW_ADMIN_PASSCODE ?? process.env.JW_PASSCODE ?? '';

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (key()) headers.authorization = `Bearer ${key()}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  let r: Response;
  try { r = await fetch(`${apiBase()}/api/v1${path}`, { method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'), headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined, signal: AbortSignal.timeout(opts.timeoutMs ?? 180_000) }); }
  catch (e) { throw new Error(`连不上 Jobs 服务（${apiBase()}）：${String((e as Error).message)}。服务没启动的话先运行 pnpm jobsworld`); }
  const text = await r.text();
  let data: unknown; try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text.slice(0, 300) }; }
  if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? `没有权限（${r.status}）：把管理员口令放进环境变量 JOBS_KEY` : `${r.status} ${(data as { error?: string }).error ?? text.slice(0, 200)}`);
  return data as T;
}

export { funnelLine, reportText, type Cited, type EngineeringView, type FunnelView, type LaunchView, type ReportView } from '@pux/engine/launch/text';
