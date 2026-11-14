// 一键启动 Jobs：世界服务 + API（含网页）+ 单端口网关。依赖服务需已 `docker compose up -d`
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
if (!existsSync(join(root, 'apps/web/dist/index.html'))) {
  console.log('[jobsworld] 构建网页…');
  const b = spawnSync('pnpm', ['--dir', 'apps/web', 'build'], { cwd: root, stdio: 'inherit' });
  if (b.status !== 0) process.exit(b.status ?? 1);
}
// 装好的 Jobs 里顺带把示例产品也跑起来（JOBS_DEMOS=1）：没有自己的产品时可以先拿它们发布试试
const names = ['world', 'api', 'gateway', ...(process.env.JOBS_DEMOS === '1' ? ['demos'] : [])];
const procs = names.map((name) => {
  const p = spawn('pnpm', ['-s', name], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  const tag = `[${name}] `;
  for (const s of [p.stdout, p.stderr]) s.on('data', (d) => process.stdout.write(String(d).split('\n').filter(Boolean).map((l) => tag + l).join('\n') + '\n'));
  p.on('exit', (code) => { console.log(`${tag}exited ${code}`); shutdown(code ?? 1); });
  return p;
});
let down = false;
function shutdown(code = 0) { if (down) return; down = true; for (const p of procs) p.kill('SIGTERM'); setTimeout(() => process.exit(code), 1500); }
process.on('SIGINT', () => shutdown(0)); process.on('SIGTERM', () => shutdown(0));
