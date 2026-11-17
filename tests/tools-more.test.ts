// 第二批工具（城里现在、问题、交给 coding agent、运维）：只经 REST，用假的 api 检查请求与输出
import { describe, expect, it } from 'vitest';
import { JOBS_TOOLS, type ToolApi } from '../packages/engine/src/launch/tools.ts';
import { fixTaskText, type IssueDetail } from '../packages/engine/src/launch/issues.ts';
import { verifyAudience } from '../packages/engine/src/launch/github.ts';

const people = [
  { id: 'p1', name: '赵红梅', age: 67, gender: 'f', occupation: '退休教师', region: '上海', segment: 'senior', locale: 'zh-CN', digital_literacy: 0.25, ai_familiarity: 0.1, sessions: 2, apps: ['Quick Notes'], live: { place_id: 'park', activity: '散步', mode: 'idle' } },
  { id: 'p2', name: 'Mia Chen', age: 24, gender: 'f', occupation: 'nurse', segment: 'professional', locale: 'en-US', digital_literacy: 0.8, ai_familiarity: 0.6, sessions: 0, apps: [], live: { place_id: 'cafe', activity: 'coffee', mode: 'session', app: 'Quick Notes' } },
];
function fakeApi(routes: Record<string, unknown>, calls: { path: string; body?: unknown }[] = []): ToolApi {
  return (async (path: string, o: { body?: unknown } = {}) => { calls.push({ path, body: o.body }); const k = Object.keys(routes).find((x) => path === x || path.startsWith(`${x}?`)); if (!k) throw new Error(`404 ${path}`); return routes[k]; }) as ToolApi;
}
const run = (name: string, args: Record<string, unknown>, api: ToolApi) => JOBS_TOOLS.find((t) => t.name === name)!.run(args, { api });

describe('工具清单', () => {
  it('名字唯一；每个都有界面上显示的一步；只有清零、下线是破坏性的', () => {
    const names = JOBS_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(JOBS_TOOLS.every((t) => !!t.label)).toBe(true);
    expect(JOBS_TOOLS.filter((t) => t.danger).map((t) => t.name).sort()).toEqual(['remove_product', 'reset_product']);
    for (const n of ['town_now', 'find_people', 'person_profile', 'town_talk', 'list_issues', 'issue_detail', 'triage_issue', 'compare_versions', 'fix_task', 'open_github_issue', 'system_status', 'human_tasks', 'resolve_human_task', 'update_jobs', 'toggle_game']) expect(names).toContain(n);
    for (const n of ['triage_issue', 'open_github_issue', 'resolve_human_task', 'update_jobs', 'toggle_game']) expect(JOBS_TOOLS.find((t) => t.name === n)!.admin).toBe(true);
  });
});

describe('城里现在', () => {
  it('find_people：条件组合，返回 persona_id', async () => {
    const out = await run('find_people', { max_digital_literacy: 0.35, locale: 'zh-CN' }, fakeApi({ '/personas': people }));
    expect(out).toContain('赵红梅'); expect(out).toContain('persona_id=p1'); expect(out).not.toContain('Mia');
    expect(await run('find_people', { using_now: true }, fakeApi({ '/personas': people }))).toContain('Mia Chen');
    expect(await run('find_people', { query: '护士' }, fakeApi({ '/personas': people }))).toContain('没有符合');
  });
  it('town_now：此刻在用的人与各产品人数', async () => {
    const out = await run('town_now', {}, fakeApi({
      '/world/snapshot': { clock: { clock: '12:30', date: '2026-11-17', speed: 1, paused: false }, personas: [{ id: 'p2', name: 'Mia Chen', occupation: 'nurse', age: 24, place_id: 'cafe', activity: 'coffee', session: { app: 'Quick Notes', status: 'running', step_idx: 2, monologue: 'where is save' } }], events: [{ place_id: 'cafe', kind: 'weak_network' }] },
      '/launches': [{ name: 'Quick Notes', status: 'live', funnel: { using_now: 1, queued: 2, opened: 5 } }],
    }));
    expect(out).toContain('12:30'); expect(out).toContain('Mia Chen'); expect(out).toContain('第 3 步'); expect(out).toContain('2 人排队'); expect(out).toContain('weak_network');
  });
});

describe('问题', () => {
  it('list_issues：按产品名找到发布，带筛选参数', async () => {
    const calls: { path: string }[] = [];
    const out = await run('list_issues', { product: 'Quick Notes', status: 'open' }, fakeApi({ '/launches/Quick%20Notes': { id: 'l1', name: 'Quick Notes' }, '/launches/l1/issues': [{ id: 'i1', track: 'experience', severity: 'P0', title: '保存后内容丢失', category: 'data', status: 'open', where: '/edit', people: 3, sessions: 4, sessions_since_version: 0, github: { url: 'u', state: 'open' } }] }, calls));
    expect(calls.map((c) => c.path)).toEqual(['/launches/Quick%20Notes', '/launches/l1/issues?status=open']);
    expect(out).toContain('[P0] 保存后内容丢失'); expect(out).toContain('最新版本里 0 次'); expect(out).toContain('issue_id=i1');
  });
  it('triage_issue 发 POST；open_github_issue 区分新开与已有', async () => {
    const calls: { path: string; body?: unknown }[] = [];
    await run('triage_issue', { issue_id: 'i1', status: 'known' }, fakeApi({ '/issues/i1/triage': { ok: true } }, calls));
    expect(calls[0]).toEqual({ path: '/issues/i1/triage', body: { status: 'known' } });
    expect(await run('open_github_issue', { issue_id: 'i1' }, fakeApi({ '/issues/i1/github': { url: 'https://github.com/o/r/issues/7', number: 7, existed: false } }))).toContain('#7');
  });
  it('compare_versions：只有一版时提示先标新版本', async () => {
    const out = await run('compare_versions', { product: 'l1' }, fakeApi({ '/launches/l1': { id: 'l1', name: 'Q' }, '/launches/l1/compare': { versions: [{ n: 1, note: null, at: '2026-11-17T00:00:00Z', sessions: 3, finished: 3, succeeded: 1, gave_up: 2 }], issues: [] } }));
    expect(out).toContain('mark_new_version');
  });
});

describe('交给 coding agent', () => {
  const d: IssueDetail = { id: 'i1', launch_id: 'l1', track: 'experience', severity: 'P0', title: '保存后内容丢失', description: '显示已自动保存，但退出再进来内容没了', category: 'data', status: 'open', where: '/edit', recommendation: '保存成功后再显示提示', steps: ['click "新建"', 'type "买菜"', 'click "返回"'], reproduced: true,
    moments: [{ session_id: 's1', step_idx: 4, persona_id: 'p1', name: '赵红梅', who: '67 岁，退休教师', segment: 'senior', locale: 'zh-CN', outcome: 'gave_up', quote: '我写的呢？', screenshot: 'ev1' }, { session_id: 's2', step_idx: 2, persona_id: 'p3', name: '王建', who: '70 岁', segment: 'senior', locale: 'zh-CN', outcome: 'gave_up', quote: null, screenshot: null }, { session_id: 's3', step_idx: 1, persona_id: 'p2', name: 'Mia', who: '24', segment: 'professional', locale: 'en-US', outcome: 'success', quote: null, screenshot: null }], github: null };
  it('修复任务：原话、截图链接、复现步骤与验收方法都在', () => {
    const t = fixTaskText({ id: 'l1', name: 'Quick Notes', url: 'https://q.example' }, d, (p) => `https://jobs.example${p}`);
    expect(t).toContain('# 修复：保存后内容丢失'); expect(t).toContain('「我写的呢？」'); expect(t).toContain('https://jobs.example/api/v1/evidence/ev1');
    expect(t).toContain('1. click "新建"'); expect(t).toContain('能复现'); expect(t).toContain('mark_new_version');
  });
  it('自动验证请「那类人」：出现最多的人群与语言', () => { expect(verifyAudience(d)).toEqual({ segment: 'senior', locale: 'zh-CN' }); });
});
