// 进程内调用 REST 的身份：Jobs Agent（飞书、网页聊天面板、命令行对话）执行工具时，用说话人自己的角色转发到 /api/v1，
// 权限检查仍然只在接口那一层。标记是这个进程启动时随机生成的，进程外拿不到。
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ToolApi } from '@pux/engine/launch/tools';

const KEY = randomBytes(24).toString('hex');
export const INTERNAL_HEADER = 'x-jobs-internal';
export type Role = 'admin' | 'viewer';

/** 请求上带的进程内身份；没有或不对时 undefined */
export function internalRole(q: FastifyRequest): Role | undefined {
  const v = q.headers[INTERNAL_HEADER]; if (typeof v !== 'string') return undefined;
  const [k, role] = v.split(':'); if (!k || (role !== 'admin' && role !== 'viewer')) return undefined;
  const a = Buffer.from(k); const b = Buffer.from(KEY);
  return a.length === b.length && timingSafeEqual(a, b) ? role : undefined;
}

/** 用某个角色在进程内调 REST。出错时抛出带人话的错误（工具把它交给模型） */
export function internalApi(app: FastifyInstance, role: Role): ToolApi {
  return async <T,>(path: string, o: { method?: string; body?: unknown } = {}) => {
    const r = await app.inject({ method: (o.method ?? (o.body !== undefined ? 'POST' : 'GET')) as 'GET', url: `/api/v1${path}`, headers: { [INTERNAL_HEADER]: `${KEY}:${role}`, ...(o.body !== undefined ? { 'content-type': 'application/json' } : {}) }, payload: o.body !== undefined ? JSON.stringify(o.body) : undefined });
    let data: unknown; try { data = r.body ? JSON.parse(r.body) : {}; } catch { data = { error: r.body.slice(0, 300) }; }
    if (r.statusCode >= 400) {
      const d = data as { error?: string; reason?: string; hint?: string };
      throw new Error(r.statusCode === 403 ? '你在 Jobs 里是访客，只能看，不能做这件事。要操作，请用管理员口令配对（直接把管理员口令发给我）。' : `${r.statusCode} ${d.reason ?? d.error ?? r.body.slice(0, 200)}${d.hint ? `（${d.hint}）` : ''}`);
    }
    return data as T;
  };
}

/** 进程内取一个文件（证据截图）：返回原始字节 */
export async function internalFile(app: FastifyInstance, role: Role, path: string): Promise<{ body: Buffer; type: string } | undefined> {
  const r = await app.inject({ method: 'GET', url: `/api/v1${path}`, headers: { [INTERNAL_HEADER]: `${KEY}:${role}` } });
  if (r.statusCode >= 400) return undefined;
  return { body: r.rawPayload, type: String(r.headers['content-type'] ?? '') };
}
