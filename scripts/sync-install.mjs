// site/install 是 deploy/install.sh 的原样副本（jobs.plutokeating.beer/install 发出去的就是它）。改了安装脚本后运行：node scripts/sync-install.mjs
import { copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
copyFileSync(join(root, 'deploy/install.sh'), join(root, 'site/install'));
console.log('site/install ← deploy/install.sh');
