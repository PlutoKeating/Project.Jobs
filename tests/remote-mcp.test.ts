// 远程 MCP：口令 → 身份的规则（与网页、命令行一致）、授权页参数防篡改、哪些工具要管理员
import { afterEach, describe, expect, it } from 'vitest';
import { JOBS_TOOLS } from '@pux/engine/launch/tools';
import { passcodeFp, roleForPasscode } from '../apps/api/src/auth.ts';
import { loginPage, unsign } from '../apps/api/src/oauth.ts';

const saved = { a: process.env.JW_ADMIN_PASSCODE, v: process.env.JW_PASSCODE };
const set = (a?: string, v?: string) => { if (a === undefined) delete process.env.JW_ADMIN_PASSCODE; else process.env.JW_ADMIN_PASSCODE = a; if (v === undefined) delete process.env.JW_PASSCODE; else process.env.JW_PASSCODE = v; };
afterEach(() => set(saved.a, saved.v));

describe('remote MCP', () => {
  it('授权页的口令：管理员口令 → admin，访客口令 → viewer，错的 → null', () => {
    set('admin-x', 'view-x');
    expect(roleForPasscode('admin-x')).toBe('admin');
    expect(roleForPasscode('view-x')).toBe('viewer');
    expect(roleForPasscode('nope')).toBeNull();
    expect(roleForPasscode('')).toBeNull();
  });
  it('没设管理员口令时，能进来的人都是管理员；一个口令都没设时不用输口令', () => {
    set(undefined, 'view-x');
    expect(roleForPasscode('view-x')).toBe('admin');
    expect(roleForPasscode('nope')).toBeNull();
    set(undefined, undefined);
    expect(roleForPasscode('')).toBe('admin');
    set('admin-x', undefined);
    expect(roleForPasscode('')).toBe('viewer');
  });
  it('换了任何一个口令，令牌指纹就变（之前的令牌全部失效）', () => {
    set('a', 'v'); const fp = passcodeFp();
    set('a2', 'v'); expect(passcodeFp()).not.toBe(fp);
    set('a', 'v2'); expect(passcodeFp()).not.toBe(fp);
    set('a', 'v'); expect(passcodeFp()).toBe(fp);
  });
  it('授权页带着的参数被改过就不认', () => {
    set('admin-x', 'view-x');
    const html = loginPage({ client: '<b>x</b>', redirect: 'http://localhost:1/cb', req: 'r', needPasscode: true });
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).toContain('type="password"');
    expect(unsign('garbage')).toBeNull();
    expect(unsign('eyJ4IjoxfQ.bad')).toBeNull();
  });
  it('写操作的工具都要管理员；读的工具访客也能用', () => {
    const admin = JOBS_TOOLS.filter((t) => t.admin).map((t) => t.name).sort();
    expect(admin).toEqual(['invite_people', 'mark_new_version', 'publish_product', 'remove_product', 'reset_product', 'set_promotion']);
    expect(JOBS_TOOLS.map((t) => t.name)).toEqual(expect.arrayContaining(['list_products', 'product_status', 'product_report', 'wait_for_people', 'ask_person']));
  });
  it('清零与下线的工具调的是对应的接口：清零 POST reset；下线 DELETE，要删经历时带 history=delete', async () => {
    const calls: { path: string; method?: string }[] = [];
    const api = (async (path: string, o: { method?: string; body?: unknown } = {}) => {
      calls.push({ path, method: o.method ?? (o.body !== undefined ? 'POST' : 'GET') });
      if (path.endsWith('/reset')) return { id: 'lch_1', name: '闪念笔记', cleared: { sessions: 3, exposures: 9, reviews: 1, posts: 0, memories: 4, people: 2 } };
      if (o.method === 'DELETE') return { kept: !path.includes('history=delete'), sessions: 3, reviews: 1, posts: 0, memories: 4, people: 2 };
      return { id: 'lch_1', name: '闪念笔记' };
    }) as Parameters<(typeof JOBS_TOOLS)[number]['run']>[1]['api'];
    const tool = (n: string) => JOBS_TOOLS.find((t) => t.name === n)!;
    expect(await tool('reset_product').run({ product: '闪念笔记' }, { api })).toMatch(/清零.*3 次使用.*2 位居民/s);
    expect(await tool('remove_product').run({ product: 'lch_1' }, { api })).toMatch(/经历保留/);
    expect(await tool('remove_product').run({ product: 'lch_1', wipe_history: true }, { api })).toMatch(/经历一起删除/);
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([
      { path: '/launches/lch_1/reset', method: 'POST' },
      { path: '/launches/lch_1', method: 'DELETE' },
      { path: '/launches/lch_1?history=delete', method: 'DELETE' },
    ]);
  });
});
