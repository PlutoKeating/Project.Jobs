// 飞书里说的话 → 要做的事；以及安装后「本机地址」的换算
import { describe, expect, it } from 'vitest';
import { reachableUrl } from '@pux/engine';
import { HELP, parseCommand } from '../apps/api/src/feishu.ts';

describe('飞书：一句话变成一件事', () => {
  it('发布：网址、名字、一句话（一句话里可以有空格；没写协议的本机地址按 http 处理）', () => {
    expect(parseCommand('发布 http://127.0.0.1:3000/ 闪念笔记 想到什么 马上记下')).toEqual({ cmd: 'publish', url: 'http://127.0.0.1:3000/', name: '闪念笔记', tagline: '想到什么 马上记下' });
    expect(parseCommand('publish localhost:5173 Notes Write it down')).toMatchObject({ cmd: 'publish', url: 'http://localhost:5173', name: 'Notes', tagline: 'Write it down' });
    expect(parseCommand('发布 闪念笔记').cmd).toBe('unknown');
  });
  it('看状况、要结论：不说产品就是最近那个', () => {
    expect(parseCommand('状况')).toEqual({ cmd: 'status', product: undefined }); expect(parseCommand('结论 闪念笔记')).toEqual({ cmd: 'report', product: '闪念笔记' });
    expect(parseCommand('report')).toEqual({ cmd: 'report', product: undefined }); expect(parseCommand('产品')).toEqual({ cmd: 'list' });
  });
  it('递手机：人数可写可不写，最多 10 个', () => {
    expect(parseCommand('邀请 闪念笔记 5')).toEqual({ cmd: 'invite', product: '闪念笔记', n: 5 }); expect(parseCommand('邀请')).toEqual({ cmd: 'invite', product: undefined, n: 3 });
    expect(parseCommand('invite 99')).toMatchObject({ n: 10 });
  });
  it('调宣发：百分数或暂停 / 继续 / 结束', () => {
    expect(parseCommand('宣发 闪念笔记 80')).toEqual({ cmd: 'promote', product: '闪念笔记', intensity: 0.8 }); expect(parseCommand('宣发 闪念笔记 30%')).toMatchObject({ intensity: 0.3 });
    expect(parseCommand('宣发 今天吃啥 暂停')).toEqual({ cmd: 'promote', product: '今天吃啥', status: 'paused' }); expect(parseCommand('promote Notes end')).toMatchObject({ status: 'ended' });
    expect(parseCommand('宣发 闪念笔记 很多').cmd).toBe('unknown');
  });
  it('向居民追问：「问 名字 问题」或「名字：问题」；群里 @ 机器人的占位符会被去掉', () => {
    expect(parseCommand('问 赵红梅 你刚才为什么关掉了？')).toEqual({ cmd: 'ask', who: '赵红梅', question: '你刚才为什么关掉了？' });
    expect(parseCommand('@_user_1 赵红梅：你觉得哪里最烦')).toEqual({ cmd: 'ask', who: '赵红梅', question: '你觉得哪里最烦' });
  });
  it('没听懂时不乱猜；打招呼给出能说的话', () => {
    expect(parseCommand('随便说点什么').cmd).toBe('unknown'); expect(parseCommand('你好').cmd).toBe('help'); expect(parseCommand('  ').cmd).toBe('help');
    expect(HELP).toContain('模拟'); expect(HELP).not.toMatch(/测试员|评测/);
  });
});

describe('装在容器里时的本机地址', () => {
  it('没有别名时原样；有别名时 localhost / 127.0.0.1 指向用户的电脑，别的地址不动', () => {
    expect(reachableUrl('http://127.0.0.1:3000/a?b=1', undefined)).toBe('http://127.0.0.1:3000/a?b=1');
    expect(reachableUrl('http://127.0.0.1:3000/a?b=1', 'host.docker.internal')).toBe('http://host.docker.internal:3000/a?b=1');
    expect(reachableUrl('http://localhost:5173/', 'host.docker.internal')).toBe('http://host.docker.internal:5173/');
    expect(reachableUrl('https://example.com/', 'host.docker.internal')).toBe('https://example.com/');
  });
});
