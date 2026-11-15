// 游戏服（Terraria）的状态与一键开启，以及随包的示例产品清单。
// 开关游戏服要操作 Docker：容器里的服务只往 control/requests 放一个只含动作名的文件，由宿主机上的 jobs 命令执行（见 deploy/jobs 的 _control）。
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { dataPath } from '@pux/core';
import { DEMO_APPS, demoUrl } from '@pux/demos/catalog';
import { requireAdmin } from './auth.ts';

const KINDS = { tshock: { host: process.env.TSHOCK_HOST ?? '127.0.0.1', port: Number(process.env.TSHOCK_PORT ?? 57777) }, tml: { host: process.env.TML_HOST ?? '127.0.0.1', port: Number(process.env.TML_PORT ?? 57778) } } as const;
type Kind = keyof typeof KINDS;

const listening = (host: string, port: number) => new Promise<boolean>((resolve) => {
  const s = connect({ host, port }); const done = (v: boolean) => { s.destroy(); resolve(v); };
  s.setTimeout(700, () => done(false)); s.once('connect', () => done(true)); s.once('error', () => done(false));
});
const controlDir = () => dataPath('control');
/** 宿主机上有人在看着请求目录（安装脚本在 Linux + systemd 上装的监视单元）时，网页才能一键开关 */
const canToggle = () => existsSync(join(controlDir(), 'watcher'));
const pending = new Map<Kind, { on: boolean; at: number }>();

export function gameRoutes(app: FastifyInstance) {
  app.get('/api/v1/game', async () => {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(KINDS) as Kind[]) {
      const up = await listening(KINDS[k].host, KINDS[k].port);
      const p = pending.get(k); if (p && (p.on === up || Date.now() - p.at > 180_000)) pending.delete(k);
      out[k] = { up, pending: pending.has(k) };
    }
    return { ...out, can_toggle: canToggle(), port: Number(process.env.JW_PORT ?? 7777), password: !!process.env.JW_GAME_PASSWORD };
  });

  app.post('/api/v1/game', async (q, r) => {
    if (!requireAdmin(q, r)) return;
    const b = (q.body ?? {}) as { kind?: Kind; on?: boolean };
    if (!b.kind || !(b.kind in KINDS) || typeof b.on !== 'boolean') return r.code(400).send({ error: 'kind (tshock|tml) and on are required' });
    const cmd = `jobsworld game ${b.on ? 'on' : 'off'} ${b.kind}`;
    if (!canToggle()) return r.code(409).send({ error: 'manual', command: process.env.JOBS_IN_CONTAINER ? cmd : `docker compose --profile game ${b.on ? `up -d --build --no-deps ${b.kind}` : `stop ${b.kind}`}` });
    const dir = join(controlDir(), 'requests'); mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${Date.now()}.game-${b.kind}-${b.on ? 'on' : 'off'}`), '');
    pending.set(b.kind, { on: b.on, at: Date.now() });
    return { requested: true };
  });

  // 随包的示例产品（JOBS_DEMOS=1 时在跑）：没有自己的产品时可以先拿它们发布试试
  app.get('/api/v1/demos', async () => {
    if (process.env.JOBS_DEMOS !== '1' && !(await listening('127.0.0.1', Number(new URL(demoUrl(DEMO_APPS[0].id, false, '127.0.0.1')).port)))) return [];
    return DEMO_APPS.filter((d) => d.id !== 'kids').map((d) => ({ id: d.id, name: d.name, name_en: d.name_en, tagline: d.tagline, url: demoUrl(d.id, false, '127.0.0.1'), flawed_url: demoUrl(d.id, true, '127.0.0.1') }));
  });
}
