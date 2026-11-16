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
    expect(admin).toEqual(['invite_people', 'mark_new_version', 'publish_product', 'set_promotion']);
    expect(JOBS_TOOLS.map((t) => t.name)).toEqual(expect.arrayContaining(['list_products', 'product_status', 'product_report', 'wait_for_people', 'ask_person']));
  });
});
