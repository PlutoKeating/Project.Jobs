// 版本号：只有根 package.json 一个来源；命令行、MCP、接口都读它；比较新旧按语义化版本
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compareVersions, jobsVersion, REPO_ROOT } from '@pux/core';

describe('版本号', () => {
  it('jobsVersion 就是根 package.json 的 version；代码里没有另外写死的版本号', () => {
    expect(jobsVersion()).toBe(JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')).version);
    for (const f of ['apps/cli/src/index.ts', 'apps/cli/src/mcp.ts']) expect(readFileSync(join(REPO_ROOT, f), 'utf8')).toContain('jobsVersion()');
  });
  it('按语义化版本比较新旧', () => {
    expect(compareVersions('0.2.0', '0.1.0')).toBeGreaterThan(0);
    expect(compareVersions('v0.10.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('v1.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBeLessThan(0);
    expect(compareVersions('1.0.0-rc.2', '1.0.0-rc.10')).toBeLessThan(0);
    expect(compareVersions('1.0.0-alpha', '1.0.0-beta')).toBeLessThan(0);
    expect(compareVersions('0.1.0', '0.2.0')).toBeLessThan(0);
  });
});
