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
  it('脚本语法正确', () => {
    for (const f of ['deploy/install.sh', 'deploy/jobs']) expect(() => execFileSync('bash', ['-n', join(REPO_ROOT, f)])).not.toThrow();
    expect(() => execFileSync('sh', ['-n', join(REPO_ROOT, 'deploy/entrypoint.sh')])).not.toThrow();
  });
  it('口令与密钥是安装时随机生成的，不写死在仓库里；已有配置时不覆盖', () => {
    const s = read('deploy/install.sh');
    for (const k of ['JW_ADMIN_PASSCODE', 'JW_PASSCODE', 'JOBS_SECRET_KEY', 'PG_PASSWORD', 'S3_SECRET_KEY']) expect(s).toMatch(new RegExp(`^${k}=\\$\\(rand `, 'm'));
    expect(s).toContain('if [ ! -f "$JOBS_HOME/.env" ]'); expect(s).toContain('umask 077');
  });
  it('主命令是 jobsworld（jobs 是 shell 的内建命令，只作为别名）；安装脚本不改动 shell 启动文件', () => {
    const s = read('deploy/install.sh');
    expect(s).toContain('/usr/local/bin/jobsworld'); expect(s).toContain('/usr/local/bin/jobs &&');
    expect(s).not.toMatch(/bashrc|zshrc|config\/fish/);
    expect(read('deploy/jobs')).toContain('jobsworld publish');
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
