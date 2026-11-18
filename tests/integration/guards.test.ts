// 集成测试：滚动、下拉框、首屏等待在真实 Chromium 里的表现（需要本机 Chromium、MinIO、Postgres）
// 运行：PUX_INTEGRATION=1 pnpm test tests/integration/guards.test.ts
import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, Rng, type ActionRequest } from '@pux/core';
import { BrowserSession } from '@pux/executor';

const LONG = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><h1>长页面</h1>${Array.from({ length: 60 }, (_, i) => `<p style="height:90px;margin:0">第 ${i} 段</p>`).join('')}
<select id="sel"><option>苹果</option><option>香蕉</option><option>橙子</option></select><div id="out"></div>
<script>document.getElementById('sel').onchange=e=>{document.getElementById('out').textContent='picked='+e.target.value};</script></body></html>`;
const SLOW = `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="app"></div><script>setTimeout(()=>{document.getElementById('app').innerHTML='<h1>终于画出来了</h1><p>这是一个延迟渲染的页面，里面有足够多的文字。</p>'},1800)</script></body></html>`;

const run = process.env.PUX_INTEGRATION === '1' ? describe : describe.skip;
run('护栏与首屏（集成）', () => {
  let server: ReturnType<typeof createServer>; let base = ''; let s: BrowserSession;
  const req = (verb: ActionRequest['verb'], extra: Partial<ActionRequest> = {}): ActionRequest => ({ action_id: newId('act'), session_id: 'it', step_idx: 0, verb, intent_text: verb, success: { any_of: [{ kind: 'viewport_changed' }], within_ms: 1500 }, motor: { precision: 1, typing_cps: 20, typo_rate: 0, one_handed: false, double_tap_risk: 0 }, timeout_ms: 15000, ...extra });
  beforeAll(async () => {
    server = createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(q.url?.startsWith('/slow') ? SLOW : LONG); });
    await new Promise<void>((res) => server.listen(0, '127.0.0.1', () => res()));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    s = await BrowserSession.launch({ sessionId: newId('it'), executor: 'playwright', mobile: true, policy: { child: false, allow_real_payment: false, sandbox_domains: ['127.0.0.1'] }, rng: new Rng(1), record: { video: false, rrweb: false, axe: false } });
  }, 60000);
  afterAll(async () => { await s?.close(); server?.close(); });

  it('手机上连续往下滑，每一次滚动位置都在变（不会被当成原地打转）', async () => {
    await s.page.goto(`${base}/`); await s.observe('it', 0);
    const ys: number[] = [];
    for (let i = 0; i < 4; i++) { await s.act(req('scroll', { args: { direction: 'down', amount: 500 } })); ys.push(await s.scrollY()); }
    expect(ys.every((y, i) => y > (ys[i - 1] ?? 0))).toBe(true);
  }, 90000);

  it('选下拉框的选项：按「选中」处理，不超时', async () => {
    await s.page.goto(`${base}/`); await s.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const o = await s.observe('it', 1);
    const sel = o.elements.find((e) => e.role === 'combobox')!;
    expect(sel).toBeTruthy();
    await s.act(req('click', { target: { by: 'selector', value: sel.selector }, success: { any_of: [{ kind: 'dom_changed' }], within_ms: 1500 } }));
    const o2 = await s.observe('it', 2);
    const opt = o2.elements.find((e) => e.role === 'option' && e.vis_text === '香蕉');
    expect(opt).toBeTruthy();
    const t0 = Date.now();
    const r = await s.act(req('click', { target: { by: 'selector', value: opt!.selector }, success: { any_of: [{ kind: 'dom_changed' }], within_ms: 1500 } }));
    expect(Date.now() - t0).toBeLessThan(8000);
    expect(r.status).not.toBe('failed');
    expect(await s.page.textContent('#out')).toBe('picked=香蕉');
  }, 90000);

  it('首屏：延迟渲染的页面，观察前会等它画出来', async () => {
    await s.page.goto(`${base}/slow`, { waitUntil: 'domcontentloaded' });
    const o = await s.observe('it', 3);
    expect(o.text).toContain('终于画出来了');
  }, 60000);
});
