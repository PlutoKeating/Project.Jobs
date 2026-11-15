// 安装与打包：发出去的安装脚本就是仓库里的那一份；脚本语法正确；编排文件里我们自己的代码只有一个镜像
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '@pux/core';

const read = (p: string) => readFileSync(join(REPO_ROOT, p), 'utf8');

describe('一行安装', () => {
  it('jobs.plutokeating.beer/install 发出去的就是 deploy/install.sh（改了之后要运行 node scripts/sync-install.mjs）', () => {
    expect(read('site/install')).toBe(read('deploy/install.sh'));
  });
  it('站点目录里发出去的只有落地页、图片和安装脚本：配置文件被排除，/install 以纯文本返回', () => {
    const cfg = JSON.parse(read('site/wrangler.jsonc').replace(/^\s*\/\/.*$/gm, '')) as { name: string; assets: { directory: string } };
    expect(cfg.name).toBe('jobs-site'); expect(cfg.assets.directory).toBe('.');
    const ignored = read('site/.assetsignore').split('\n');
    for (const f of ['wrangler.jsonc', '.assetsignore', '.wrangler']) expect(ignored).toContain(f);
    expect(read('site/_headers')).toMatch(/^\/install\n\s+Content-Type: text\/plain; charset=utf-8$/m);
  });
  it('脚本语法正确', () => {
    for (const f of ['deploy/install.sh', 'deploy/jobs']) expect(() => execFileSync('bash', ['-n', join(REPO_ROOT, f)])).not.toThrow();
    expect(() => execFileSync('sh', ['-n', join(REPO_ROOT, 'deploy/entrypoint.sh')])).not.toThrow();
  });
  it('口令与密钥是安装时随机生成的，不写死在仓库里；已有配置时不覆盖', () => {
    const s = read('deploy/install.sh');
    for (const k of ['JW_ADMIN_PASSCODE', 'JW_PASSCODE', 'JOBS_SECRET_KEY', 'PG_PASSWORD', 'S3_SECRET_KEY']) expect(s).toMatch(new RegExp(`^${k}=\\$\\(rand `, 'm'));
    expect(s).toContain('if [ ! -f "$ENV_FILE" ]'); expect(s).toContain('ENV_FILE="$JOBS_HOME/.env"'); expect(s).toContain('umask 077');
  });
  it('主命令是 jobsworld（jobs 是 shell 的内建命令，只作为别名）；安装脚本不改动 shell 启动文件', () => {
    const s = read('deploy/install.sh');
    expect(s).toContain('/usr/local/bin/jobsworld'); expect(s).toContain('/usr/local/bin/jobs &&');
    expect(s).not.toMatch(/bashrc|zshrc|config\/fish/);
    expect(read('deploy/jobs')).toContain('jobsworld publish');
  });
});

describe('升级', () => {
  const jobs = read('deploy/jobs'); const install = read('deploy/install.sh');
  it('jobsworld update：先拉镜像、再备份数据库、再重建；游戏服（在 profile 里）也一起更新', () => {
    const body = jobs.slice(jobs.indexOf('update() {'));
    const order = ['dc pull', 'refresh_files', 'backup', 'dc up -d', 'refresh_games', 'wait_ready'].map((k) => body.indexOf(k));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(jobs).toContain('pg_dump -U jobs -Fc jobs');
    expect(jobs).toMatch(/dc --profile game pull/);
  });
  it('网页的一键升级只经过 control/requests：宿主机只认固定的几个动作名，并写回进度', () => {
    expect(jobs).toMatch(/^\s+update\)$/m);
    expect(jobs).toContain('"$ctl/update-status"'); expect(jobs).toContain('"$ctl/host-features"');
    expect(read('apps/api/src/update.ts')).toContain("request('update')");
  });
  it('重复运行安装脚本就是升级：沿用 .env 里的镜像、先备份、更新装过的游戏服', () => {
    expect(install).toContain('IMAGE="${JOBS_IMAGE:-$(envv JOBS_IMAGE)}"');
    expect(install.indexOf('" backup ||')).toBeLessThan(install.indexOf('compose up -d'));
    expect(install).toContain('_refresh-games');
  });
  it('发版：标签必须与 package.json 的版本一致；镜像推完之后才建 Release；预发布不打 latest', () => {
    const wf = read('.github/workflows/release.yml');
    expect(wf).toContain("require('./package.json').version");
    expect(wf).toMatch(/release:\n\s+needs: images/);
    expect(wf).toContain("!contains(github.ref_name, '-')");
  });
  it('三个镜像都发布 amd64 + arm64：各在原生机器上构建，合成一个多架构清单；TShock 按架构取发布包', () => {
    const wf = read('.github/workflows/release.yml');
    expect(wf).toContain('{ arch: amd64, runner: ubuntu-latest }');
    expect(wf).toContain('{ arch: arm64, runner: ubuntu-24.04-arm }');
    expect(wf).toMatch(/images:\n\s+needs: build/);
    expect(wf).toContain('docker buildx imagetools create');
    for (const d of ['Dockerfile', 'infra/game/tshock/Dockerfile', 'infra/game/tmodloader/Dockerfile']) expect(wf).toContain(`dockerfile: ${d} }`);
    const tshock = read('infra/game/tshock/Dockerfile');
    expect(tshock).toContain('ARG TARGETARCH');
    expect(tshock).toContain('arm64) RID=linux-arm64');
    expect(tshock).not.toMatch(/-linux-x64-Release/);
  });
});

describe('编排', () => {
  const base = read('deploy/compose.yml');
  it('我们自己的代码只在 jobs 这一个镜像里；数据库、对象存储、事件总线是标准镜像；游戏服默认不启动', () => {
    const images = [...base.matchAll(/^\s+image:\s*(.+)$/gm)].map((m) => m[1].trim());
    expect(images.filter((i) => i.includes('JOBS_IMAGE'))).toHaveLength(1);
    expect(images).toEqual(expect.arrayContaining(['pgvector/pgvector:pg17', 'elestio/minio:latest', 'nats:2.12-alpine']));
    expect(base.match(/profiles: \[game\]/g)).toHaveLength(2);
  });
  it('依赖服务只监听本机回环地址；对外只有网关一个端口', () => {
    for (const m of base.matchAll(/^\s+- "([^"]+:\d+)"$/gm)) expect(m[1]).toMatch(/^127\.0\.0\.1:/);
    expect(read('deploy/compose.bridge.yml')).toMatch(/JOBS_BIND:-0\.0\.0\.0\}:\$\{JOBS_PORT:-7777\}:7777/);
    expect(read('deploy/compose.host.yml')).toContain('network_mode: host');
  });
});
