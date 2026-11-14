// 单端口复用网关：浏览器（HTTP/WebSocket）→ API；原版 Terraria → TShock；tModLoader → tML 服务端
import net from 'node:net';
import { logger } from '@pux/core';
import { sniff, type Route } from './sniff.ts';

const PORT = Number(process.env.JW_PORT ?? 7777);
const HOST = process.env.JW_HOST ?? '0.0.0.0';
const target = (host: string | undefined, port: string | undefined, d: number) => ({ host: host ?? '127.0.0.1', port: Number(port ?? d) });
export const TARGETS: Record<Exclude<Route, 'unknown' | 'more'>, { host: string; port: number }> = {
  http: target(process.env.API_HOST_UPSTREAM, process.env.API_PORT, 5320),
  vanilla: target(process.env.TSHOCK_HOST, process.env.TSHOCK_PORT, 57777),
  tmodloader: target(process.env.TML_HOST, process.env.TML_PORT, 57778),
};
const SNIFF_TIMEOUT_MS = 5000;
const stats = { http: 0, vanilla: 0, tmodloader: 0, rejected: 0 };

const BAD_GATEWAY = 'HTTP/1.1 502 Bad Gateway\r\ncontent-type: text/plain; charset=utf-8\r\nconnection: close\r\n\r\nJobsWorld API 未启动';

function route(client: net.Socket) {
  let buf = Buffer.alloc(0);
  const timer = setTimeout(() => { stats.rejected++; client.destroy(); }, SNIFF_TIMEOUT_MS);
  const onData = (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);
    const r = sniff(buf);
    if (r === 'more' && buf.length < 4096) return;
    clearTimeout(timer);
    client.off('data', onData);
    if (r === 'more' || r === 'unknown') { stats.rejected++; client.destroy(); return; }
    stats[r]++;
    const up = net.connect(TARGETS[r]);
    up.setNoDelay(true); client.setNoDelay(true);
    up.once('connect', () => { up.write(buf); client.pipe(up); up.pipe(client); });
    up.on('error', (e) => {
      logger.warn({ route: r, err: e.message }, '上游不可用');
      if (r === 'http' && !client.destroyed) client.end(BAD_GATEWAY);
      else client.destroy();
    });
    client.on('error', () => up.destroy());
    client.on('close', () => up.destroy());
    up.on('close', () => client.destroy());
  };
  client.on('data', onData);
  client.on('error', () => { clearTimeout(timer); });
}

export function startGateway() {
  const server = net.createServer({ pauseOnConnect: false }, route);
  server.listen(PORT, HOST, () => logger.info({ port: PORT, host: HOST, targets: TARGETS }, '🚪 JobsWorld 网关已启动（HTTP / Terraria / tModLoader 共用一个端口）'));
  setInterval(() => logger.debug(stats, '网关连接统计'), 60_000).unref();
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) startGateway();
