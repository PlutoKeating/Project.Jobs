// 版本与升级：当前版本、GitHub 上最新发布的版本、一键升级。
// 检查新版本只是匿名读一次公开的 GitHub Releases 接口（不带任何本机信息）：后台每小时一次，管理员打开网页时上次检查已超过 15 分钟就当场再查一次；JOBS_UPDATE_CHECK=0 关闭，
// JOBS_UPDATE_URL 换成别的地址（返回同样格式的 JSON：tag_name、html_url、published_at）。
// 一键升级与游戏服开关同一个做法：容器里的服务只往 control/requests 放一个只含动作名的文件，由宿主机上的 jobsworld _control 执行 jobsworld update
// （拉取新镜像 → 备份数据库 → 重建容器）；进度与结果由宿主机写回 control/update-status 与 control/update.log。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { compareVersions, dataPath, jobsVersion, logger } from '@pux/core';
import { requireAdmin, roleOf } from './auth.ts';

const RELEASES = 'https://github.com/PlutoKeating/Project.Jobs/releases';
const LATEST_URL = process.env.JOBS_UPDATE_URL || 'https://api.github.com/repos/PlutoKeating/Project.Jobs/releases/latest';
const CHECK = process.env.JOBS_UPDATE_CHECK !== '0';
const EVERY_MS = 3600_000;
/** 管理员看版本时，结果超过这么久就当场重查（GitHub 匿名接口每个 IP 每小时 60 次，这样最多每小时 4 次） */
const FRESH_MS = 15 * 60_000;

interface Latest { version: string; url: string; published_at: string | null }
const state: { latest: Latest | null; checked_at: string | null; error: string | null } = { latest: null, checked_at: null, error: null };
let inflight: Promise<void> | undefined;

/** 读 GitHub 上最新的正式发布（不含草稿与预发布）。还没有任何发布时 latest 为空 */
export function checkLatest(): Promise<void> {
  inflight ??= (async () => {
    try {
      const r = await fetch(LATEST_URL, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'jobs-update-check' }, signal: AbortSignal.timeout(10_000) });
      if (r.status === 404) { state.latest = null; state.error = null; }
      else if (!r.ok) state.error = `HTTP ${r.status}`;
      else {
        const b = (await r.json()) as { tag_name?: string; html_url?: string; published_at?: string | null };
        state.latest = b.tag_name ? { version: b.tag_name.replace(/^v/i, ''), url: b.html_url ?? RELEASES, published_at: b.published_at ?? null } : null;
        state.error = null;
      }
    } catch (e) { state.error = String((e as Error).message ?? e); }
    state.checked_at = new Date().toISOString();
    if (state.error) logger.debug({ err: state.error }, '检查新版本失败');
  })().finally(() => { inflight = undefined; });
  return inflight;
}

const controlDir = () => dataPath('control');
const readText = (f: string) => { try { return readFileSync(join(controlDir(), f), 'utf8'); } catch { return ''; } };
/** 宿主机上有监视单元，而且宿主机上的 jobsworld 命令认得 update 这个动作（旧版本的命令不认得，会忽略） */
const watcher = () => existsSync(join(controlDir(), 'watcher'));
const hostCanUpdate = () => watcher() && readText('host-features').split(/\s+/).includes('update');
const request = (action: string) => { const dir = join(controlDir(), 'requests'); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, `${Date.now()}.${action}`), ''); };

// 宿主机上的命令是不是新版本，只能问一次：放一个 ping，新版本的 _control 会写下 host-features
let pingedAt = 0;
function probeHost() { if (!watcher() || hostCanUpdate() || Date.now() - pingedAt < 10 * 60_000) return; pingedAt = Date.now(); try { request('ping'); } catch { /* 目录不可写：当作不能一键升级 */ } }

/** 宿主机写回的升级状态：「running|时间」「ok|时间」「failed|时间」 */
function hostUpdate() {
  const [s, at] = readText('update-status').trim().split('|');
  if (!s) return null;
  return { state: s as 'running' | 'ok' | 'failed', at: at || null };
}
let requestedAt: number | null = null;

export function updateRoutes(app: FastifyInstance) {
  if (CHECK) { setTimeout(() => void checkLatest(), 30_000).unref(); setInterval(() => void checkLatest(), EVERY_MS).unref(); }
  probeHost();

  app.get('/api/v1/version', async (q) => {
    const admin = roleOf(q).admin; const version = jobsVersion();
    probeHost();
    // 刚发布的新版本不用等下一轮后台检查：管理员打开网页时，结果旧了就当场重查（最多等 10 秒）
    if (CHECK && admin && (!state.checked_at || Date.now() - Date.parse(state.checked_at) > FRESH_MS)) await checkLatest();
    const latest = state.latest;
    const out: Record<string, unknown> = {
      version, check: CHECK, latest, checked_at: state.checked_at, error: state.error,
      update_available: !!latest && compareVersions(latest.version, version) > 0,
    };
    if (admin) {
      const inContainer = !!process.env.JOBS_IN_CONTAINER;
      const host = hostUpdate();
      if (requestedAt && (Date.now() - requestedAt > 30 * 60_000 || (host && host.at && Date.parse(host.at) >= requestedAt && host.state !== 'running'))) requestedAt = null;
      out.can_update = inContainer && hostCanUpdate();
      out.command = inContainer ? 'jobsworld update' : 'git pull && pnpm install && pnpm db:migrate';
      out.update = { requested: requestedAt !== null, host, log: host?.state === 'failed' ? readText('update.log').trim().split('\n').slice(-20).join('\n') : null };
    }
    return out;
  });

  app.post('/api/v1/version/check', async (q, r) => {
    if (!requireAdmin(q, r)) return;
    await checkLatest();
    return { latest: state.latest, checked_at: state.checked_at, error: state.error, update_available: !!state.latest && compareVersions(state.latest.version, jobsVersion()) > 0 };
  });

  app.post('/api/v1/update', async (q, r) => {
    if (!requireAdmin(q, r)) return;
    if (!process.env.JOBS_IN_CONTAINER || !hostCanUpdate()) return r.code(409).send({ error: 'manual', command: process.env.JOBS_IN_CONTAINER ? 'jobsworld update' : 'git pull && pnpm install && pnpm db:migrate' });
    if (hostUpdate()?.state === 'running' || requestedAt) return { requested: true, already: true };
    request('update'); requestedAt = Date.now();
    return { requested: true };
  });
}
