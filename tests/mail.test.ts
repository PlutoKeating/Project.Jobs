// 居民邮箱：像真人的用户名、验证码与链接的提取（仪器）、转发 Worker 的签名与收信验签、Cloudflare 接口封装、居民的两个新动作
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isLegacyHandle, mailHandle } from '@pux/jobsworld';
import { findCodes, findLinks } from '../packages/engine/src/mail/extract.ts';
import { htmlToText, signInbound, verifyInbound } from '../packages/engine/src/mail/inbound.ts';
import { isLocalUrl, normalizePublicUrl } from '../packages/engine/src/mail/settings.ts';
import { WORKER_SOURCE } from '../packages/engine/src/mail/worker.ts';
import { cfCreateRule, cfFindZone, isRuleLimit, CfError } from '../packages/engine/src/mail/cloudflare.ts';
import { ACTIONS, MindSchema } from '../packages/engine/src/runtime/roles.ts';

const residents = readFileSync(new URL('../config/population/residents.jsonl', import.meta.url), 'utf8').trim().split('\n').map((l) => JSON.parse(l).spec as { id: string; locale: string; identity: { name: string; age: number; gender: string } });
const input = (s: (typeof residents)[number]) => ({ id: s.id, name: s.identity.name, locale: s.locale, age: s.identity.age, gender: s.identity.gender });

describe('居民邮箱的用户名', () => {
  it('随包居民每人一个，只有小写字母和数字、6–20 位、互不重复、不是编号式', () => {
    const taken = new Set<string>();
    const hs = residents.map((s) => mailHandle(input(s), taken));
    expect(new Set(hs).size).toBe(residents.length);
    for (const h of hs) {
      expect(h).toMatch(/^[a-z0-9]{6,20}$/);
      expect(h).toMatch(/[a-z]{3,}/);
      expect(isLegacyHandle(h)).toBe(false);
      expect(h).not.toMatch(/^[0-9a-f]+$/);
    }
  });
  it('同一个人每次算出来一样；中文名用拼音', () => {
    const p = { id: 'zh_x_1', name: '陈炳权', locale: 'zh-CN', age: 51, gender: '男' };
    expect(mailHandle(p)).toBe(mailHandle(p));
    const many = Array.from({ length: 40 }, (_, i) => mailHandle({ ...p, id: `zh_x_${i}` }));
    expect(many.some((h) => h.includes('chen'))).toBe(true);
  });
  it('撞名时换一种写法，不会重复', () => {
    const taken = new Set<string>(); const p = { id: 'en_a', name: 'John Smith', locale: 'en-US', age: 40, gender: 'male' };
    const a = mailHandle(p, taken); const b = mailHandle(p, taken); const c = mailHandle(p, taken);
    expect(new Set([a, b, c]).size).toBe(3);
  });
  it('认得出旧的编号式地址', () => {
    expect(isLegacyHandle('zh.r.779e0d8c')).toBe(true);
    expect(isLegacyHandle('en.r.079b8acb')).toBe(true);
    expect(isLegacyHandle('chenbq168')).toBe(false);
  });
});

describe('验证码与链接（只作仪器）', () => {
  it('从中英文验证邮件里认出验证码，不把年份和电话当成码', () => {
    expect(findCodes('您的验证码是 482913，15 分钟内有效。© 2026 Causally')[0]).toBe('482913');
    expect(findCodes('Your verification code: 7F3K9Q. Call 555-0100 for help.')[0]).toBe('7F3K9Q');
    expect(findCodes('Welcome! Thanks for joining in 2026.')).toEqual([]);
  });
  it('验证类链接排在前面，去掉退订与图片', () => {
    const html = '<a href="https://x.com/unsubscribe?u=1">退订</a><img src="https://x.com/a.png"><a href="https://x.com/help">help</a><a href="https://id.x.com/verify?token=abc&amp;f=1">Verify</a>';
    const l = findLinks(html, '');
    expect(l[0]).toBe('https://id.x.com/verify?token=abc&f=1');
    expect(l.some((u) => /unsubscribe|\.png/.test(u))).toBe(false);
  });
  it('HTML 邮件取出文字', () => {
    expect(htmlToText('<style>p{}</style><p>验证码&nbsp;<b>123456</b></p><br>谢谢')).toBe('验证码 123456\n\n谢谢');
  });
});

describe('转发 Worker 与收信验签', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('Worker 算的签名能被 /inbound/email 验过；改一个字节、过期、换密钥都不行', async () => {
    const raw = Buffer.from('From: a@b.c\r\nTo: chenbq168@jobs.example.com\r\nSubject: code\r\n\r\nYour code is 123456\r\n');
    let sent: { headers: Record<string, string>; body: Buffer } | undefined;
    vi.stubGlobal('fetch', async (_u: string, init: { headers: Record<string, string>; body: ArrayBuffer }) => { sent = { headers: init.headers, body: Buffer.from(init.body) }; return new Response('{}', { status: 200 }); });
    const mod = await import(`data:text/javascript;base64,${Buffer.from(WORKER_SOURCE).toString('base64')}`);
    let rejected = '';
    await mod.default.email({ rawSize: raw.length, raw: new Blob([raw]).stream(), to: 'chenbq168@jobs.example.com', from: 'a@b.c', setReject: (r: string) => { rejected = r; } }, { JOBS_SECRET: 's3cret', JOBS_INBOUND_URL: 'https://jobs.example.com/inbound/email' });
    expect(rejected).toBe('');
    const h = { ts: sent!.headers['x-jobs-timestamp'], to: sent!.headers['x-jobs-to'], sig: sent!.headers['x-jobs-signature'] };
    expect(sent!.body.equals(raw)).toBe(true);
    expect(h.sig).toBe(signInbound('s3cret', h.ts, h.to, raw));
    expect(verifyInbound('s3cret', h, raw)).toBeUndefined();
    const bad = Buffer.from(raw); bad[bad.length - 3] ^= 1;
    expect(verifyInbound('s3cret', h, bad)).toBe('bad signature');
    expect(verifyInbound('other', h, raw)).toBe('bad signature');
    expect(verifyInbound('s3cret', { ...h, to: 'someone@jobs.example.com' }, raw)).toBe('bad signature');
    expect(verifyInbound('s3cret', h, raw, Number(h.ts) + 11 * 60_000)).toBe('stale timestamp');
  });
  it('Jobs 回答 4xx 时退信，5xx 时抛错让对方重投', async () => {
    const mod = await import(`data:text/javascript;base64,${Buffer.from(WORKER_SOURCE).toString('base64')}`);
    const msg = () => { const m = { rawSize: 3, raw: new Blob([Buffer.from('x\r\n')]).stream(), to: 't@x', from: 'f@x', rejected: '', setReject(r: string) { m.rejected = r; } }; return m; };
    vi.stubGlobal('fetch', async () => new Response('', { status: 401 }));
    const m1 = msg(); await mod.default.email(m1, { JOBS_SECRET: 's', JOBS_INBOUND_URL: 'https://x/inbound/email' }); expect(m1.rejected).not.toBe('');
    vi.stubGlobal('fetch', async () => new Response('', { status: 503 }));
    await expect(mod.default.email(msg(), { JOBS_SECRET: 's', JOBS_INBOUND_URL: 'https://x/inbound/email' })).rejects.toThrow(/503/);
    const big = msg(); big.rawSize = 11 * 1024 * 1024; await mod.default.email(big, { JOBS_SECRET: 's', JOBS_INBOUND_URL: 'https://x' }); expect(big.rejected).toMatch(/large/);
  });
});

describe('公网链接', () => {
  it('补全协议、去掉结尾斜杠；认得出本机与局域网地址', () => {
    expect(normalizePublicUrl('jobs.example.com/')).toBe('https://jobs.example.com');
    expect(normalizePublicUrl('https://jobs.example.com:8443/x/')).toBe('https://jobs.example.com:8443/x');
    expect(() => normalizePublicUrl('ftp://x')).toThrow();
    expect(isLocalUrl('http://127.0.0.1:7777')).toBe(true);
    expect(isLocalUrl('http://192.168.1.5:7777')).toBe(true);
    expect(isLocalUrl('https://jobs.example.com')).toBe(false);
  });
});

describe('Cloudflare 接口封装', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('从完整主机名逐级找到所在的区；规则把一个地址交给转发 Worker', async () => {
    const calls: { url: string; method: string; body?: string }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: { method: string; body?: string }) => {
      calls.push({ url, method: init.method, body: typeof init.body === 'string' ? init.body : undefined });
      if (url.includes('/zones?name=jobs.example.com')) return Response.json({ success: true, result: [] });
      if (url.includes('/zones?name=example.com')) return Response.json({ success: true, result: [{ id: 'z1', name: 'example.com', account: { id: 'a1' } }] });
      if (url.endsWith('/zones/z1/email/routing/rules')) return Response.json({ success: true, result: { id: 'r1' } });
      return Response.json({ success: false, errors: [{ code: 1, message: 'nope' }] }, { status: 400 });
    });
    const zone = await cfFindZone('tok', 'jobs.example.com');
    expect(zone).toEqual({ id: 'z1', name: 'example.com', account_id: 'a1' });
    expect(await cfCreateRule('tok', zone, 'chenbq168@jobs.example.com', 'jobsworld-mail')).toBe('r1');
    const body = JSON.parse(calls.at(-1)!.body!);
    expect(body.matchers).toEqual([{ type: 'literal', field: 'to', value: 'chenbq168@jobs.example.com' }]);
    expect(body.actions).toEqual([{ type: 'worker', value: ['jobsworld-mail'] }]);
  });
  it('认得出「规则数到上限」', () => {
    expect(isRuleLimit(new CfError('Rule limit reached (2020)', 400))).toBe(true);
    expect(isRuleLimit(new CfError('Invalid token', 403))).toBe(false);
  });
});

describe('居民的两个新动作', () => {
  it('看邮箱、切回产品是人物可以选的动作', () => {
    expect(ACTIONS).toContain('check_mail');
    expect(ACTIONS).toContain('back_to_app');
    expect(MindSchema.shape.action.options).toContain('check_mail');
  });
});
