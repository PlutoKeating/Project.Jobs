// Jobs 的版本号只有一个来源：仓库根 package.json 的 version。
// 发版时打的 v* 标签必须与它一致（.github/workflows/release.yml 会检查），镜像里装的就是那一份 package.json。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './paths.ts';

let cached: string | undefined;
export function jobsVersion(): string {
  if (cached) return cached;
  try { cached = String((JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as { version?: string }).version ?? '0.0.0'); } catch { cached = '0.0.0'; }
  return cached;
}

/** 比较两个语义化版本（可带 v 前缀与 -预发布 后缀）：a 比 b 新返回正数，旧返回负数，相同返回 0 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => { const [core, pre] = v.trim().replace(/^v/i, '').split('+')[0].split(/-(.*)/s); return { nums: core.split('.').map((x) => Number.parseInt(x, 10) || 0), pre: pre ?? '' }; };
  const x = parse(a); const y = parse(b);
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length, 3); i++) { const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0); if (d) return d; }
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1; if (!y.pre) return -1;   // 正式版比同号的预发布版新
  const xs = x.pre.split('.'); const ys = y.pre.split('.');
  for (let i = 0; i < Math.max(xs.length, ys.length); i++) {
    if (xs[i] === undefined) return -1; if (ys[i] === undefined) return 1;
    const xn = /^\d+$/.test(xs[i]); const yn = /^\d+$/.test(ys[i]);
    if (xn && yn) { const d = Number(xs[i]) - Number(ys[i]); if (d) return d; continue; }
    if (xn !== yn) return xn ? -1 : 1;
    if (xs[i] !== ys[i]) return xs[i] < ys[i] ? -1 : 1;
  }
  return 0;
}
