// M0 技术验证：在真实被测 App 上用同一组「自然语言定位」动作对比 Stagehand 与 Midscene（成功率、耗时、失败分类）
import { writeFileSync, mkdirSync } from 'node:fs';
import { dataPath, newId, Rng, type UIElement } from '@pux/core';
import { executorComparisons, getDb } from '@pux/db';
import { BrowserSession } from '@pux/executor';
import { resolveAppVersion } from '@pux/engine';

export async function runM0(ref: string) {
  const { av, app } = await resolveAppVersion(ref);
  const policy = { child: false, allow_real_payment: false, sandbox_domains: ['127.0.0.1', 'localhost'] };
  // 以 Playwright 抽取的元素作为真值，生成动作集
  const probe = await BrowserSession.launch({ sessionId: newId('m0'), executor: 'playwright', policy, rng: new Rng(1), record: { video: false, rrweb: false, axe: false } });
  await probe.page.goto(av.env_url, { waitUntil: 'domcontentloaded' });
  const obs = await probe.observe('m0', 0);
  await probe.close();
  const targets = obs.elements.filter((e: UIElement) => e.kind === 'interactive' && e.in_viewport && e.name && e.name.length >= 2 && e.name.length < 30).slice(0, 8);
  const results: Record<string, unknown> = {};
  const md: string[] = [`# M0 执行器对比：${app.name}@${av.version}`, '', `动作集：${targets.length} 个自然语言定位（真值来自 Playwright DOM/a11y）`, '', '| 执行器 | 成功率 | 平均耗时 | 失败分类 |', '|---|---|---|---|'];
  for (const ex of ['stagehand', 'midscene'] as const) {
    const s = await BrowserSession.launch({ sessionId: newId('m0'), executor: ex, policy, rng: new Rng(1), record: { video: false, rrweb: false, axe: false } });
    await s.page.goto(av.env_url, { waitUntil: 'domcontentloaded' });
    await s.observe('m0', 0);
    const rows: { target: string; ok: boolean; ms: number; error?: string }[] = [];
    for (const t of targets) {
      const t0 = Date.now();
      try {
        const r = await s.resolveTarget({ by: 'visual', value: `${t.role === 'link' ? '链接' : t.role === 'button' ? '按钮' : '输入框'}「${t.name}」` }, t.name);
        const [x, y] = r.point; const [bx, by, bw, bh] = t.bbox;
        rows.push({ target: t.name, ok: x >= bx - 4 && x <= bx + bw + 4 && y >= by - 4 && y <= by + bh + 4, ms: Date.now() - t0, error: undefined });
      } catch (e) { rows.push({ target: t.name, ok: false, ms: Date.now() - t0, error: (e as { code?: string }).code ?? 'EXEC_TARGET_NOT_FOUND' }); }
    }
    await s.close();
    const rate = rows.filter((r) => r.ok).length / Math.max(1, rows.length); const avg = rows.reduce((a, r) => a + r.ms, 0) / Math.max(1, rows.length);
    const layers = rows.filter((r) => !r.ok).reduce((a, r) => { const k = r.error ?? 'EXEC_WRONG_TARGET'; a[k] = (a[k] ?? 0) + 1; return a; }, {} as Record<string, number>);
    await getDb().insert(executorComparisons).values({ id: newId('m0'), app_version_id: av.id, executor: ex, action_set: 'visual_locate_top8', results: rows, success_rate: rate, avg_ms: avg, failure_layers: layers });
    results[ex] = { success_rate: rate, avg_ms: Math.round(avg), failures: layers, rows };
    md.push(`| ${ex} | ${(rate * 100).toFixed(0)}% | ${Math.round(avg)}ms | ${JSON.stringify(layers)} |`);
  }
  md.push('', '结论建议：成功率接近时优先选择耗时更低者；canvas/富文本等 DOM 不可靠的界面以 Midscene 视觉定位为准。数据保存在 executor_comparisons 表。');
  mkdirSync(dataPath('reports'), { recursive: true });
  const file = dataPath('reports', `m0-${app.name}-${av.version}.md`); writeFileSync(file, md.join('\n'));
  return { file, ...results };
}
