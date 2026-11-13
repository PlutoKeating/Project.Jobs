// Product Intelligence Engine（§9）：爬取 → LLM 归纳 → YAML 人工确认 → 入库
import { chromium, type Page } from 'playwright';
import { existsSync } from 'node:fs';
import { dataPath, logger, newId, ProductSpecSchema, readYaml, writeYaml, z, type ProductSpec, type UIElement } from '@pux/core';
import { and, appVersions, apps, eq, features, getDb, hypotheses, taskDefs } from '@pux/db';
import { gateway } from '@pux/llm';
import { EXTRACT_SCRIPT, INIT_SCRIPT, putEvidence, stateIdOf, urlTemplate } from '@pux/executor';

export interface CrawlPage { url: string; template: string; title: string; state_id: string; headings: string[]; actions: string[]; inputs: string[]; text: string; screenshot_ev?: string; depth: number }
export interface CrawlResult { start_url: string; pages: CrawlPage[]; account?: { username: string; password: string }; edges: [string, string][] }

/** 用 Playwright 爬一遍：链接图、a11y、关键页面截图。遇到登录墙时可用测试账号登录，或自动注册一个测试账号。 */
export async function crawl(startUrl: string, opts: { maxPages?: number; account?: { username: string; password: string }; autoSignup?: boolean; appVersionId?: string } = {}): Promise<CrawlResult> {
  const maxPages = opts.maxPages ?? 25;
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'zh-CN' });
  await ctx.addInitScript(INIT_SCRIPT);
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  const origin = new URL(startUrl).origin;
  const seen = new Set<string>(); const pages: CrawlPage[] = []; const edges: [string, string][] = [];
  const queue: { url: string; depth: number; from?: string }[] = [{ url: startUrl, depth: 0 }];
  let account = opts.account;
  const danger = /logout|signout|退出|注销|delete|删除|pay|支付|reset|__pux/i;
  try {
    while (queue.length && pages.length < maxPages) {
      const { url, depth, from } = queue.shift()!;
      const tpl = urlTemplate(url);
      if (seen.has(tpl)) continue; seen.add(tpl);
      try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 }); await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {}); } catch { continue; }
      // 登录墙
      if (await page.locator('input[type=password]').count() && !page.url().includes('signup')) {
        account = await ensureAuth(page, origin, account, opts.autoSignup ?? true);
        if (account) { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}); }
      }
      const ex = await page.evaluate(EXTRACT_SCRIPT) as { elements: UIElement[]; text: string };
      const els = ex.elements;
      const cur = page.url();
      const shot = await page.screenshot({ type: 'jpeg', quality: 60 }).catch(() => null);
      const screenshot_ev = shot ? await putEvidence('crawl', { study_id: undefined }, { data: shot, mime: 'image/jpeg' }) : undefined;
      pages.push({
        url: cur, template: urlTemplate(cur), title: await page.title(), state_id: stateIdOf(cur, els, false), depth,
        headings: els.filter((e) => e.kind === 'heading').map((e) => e.name).slice(0, 12),
        actions: els.filter((e) => e.kind === 'interactive' && ['button', 'link', 'tab', 'menuitem'].includes(e.role)).map((e) => `${e.role}:${e.name || e.aria_label || '(无文字)'}`).slice(0, 40),
        inputs: els.filter((e) => e.kind === 'interactive' && ['textbox', 'searchbox', 'combobox', 'checkbox', 'file'].includes(e.role)).map((e) => `${e.role}:${e.name || e.placeholder || ''}`).slice(0, 20),
        text: ex.text.slice(0, 600), screenshot_ev,
      });
      if (from) edges.push([from, urlTemplate(cur)]);
      if (depth >= 3) continue;
      const links = await page.$$eval('a[href]', (as) => as.map((a) => (a as HTMLAnchorElement).href)).catch(() => [] as string[]);
      for (const l of links) {
        try { const u = new URL(l); u.hash = ''; if (u.origin !== origin || danger.test(u.pathname) || /\.(md|csv|pdf|zip|png|jpg)$/i.test(u.pathname)) continue; if (!seen.has(urlTemplate(u.href))) queue.push({ url: u.href, depth: depth + 1, from: urlTemplate(cur) }); } catch { /* ignore */ }
      }
    }
  } finally { await browser.close(); }
  logger.info({ pages: pages.length, start: startUrl }, '爬取完成');
  return { start_url: startUrl, pages, account, edges };
}

async function ensureAuth(page: Page, origin: string, account: { username: string; password: string } | undefined, autoSignup: boolean) {
  const fill = async (acc: { username: string; password: string }) => {
    const user = page.locator('input[type=text],input[type=email],input[name*=user],input[name*=email],input[name*=phone],input:not([type])').first();
    await user.fill(acc.username).catch(() => {});
    await page.locator('input[type=password]').first().fill(acc.password).catch(() => {});
    await Promise.all([page.waitForLoadState('domcontentloaded').catch(() => {}), page.locator('form button[type=submit],form button,input[type=submit]').first().click().catch(() => {})]);
    await page.waitForTimeout(800);
    return !(await page.locator('input[type=password]').count());
  };
  if (account && await fill(account)) return account;
  if (!autoSignup) return account;
  const signup = page.getByRole('link', { name: /注册|sign ?up|create account|register/i }).first();
  if (await signup.count()) await signup.click().catch(() => {}); else await page.goto(`${origin}/signup`).catch(() => {});
  const acc = { username: `pux_crawler_${Math.random().toString(36).slice(2, 7)}`, password: 'Pux2026ok' };
  const inputs = page.locator('form input:not([type=hidden]):not([type=password]):not([type=checkbox])');
  const n = await inputs.count();
  for (let i = 0; i < n; i++) await inputs.nth(i).fill(i === 0 ? acc.username : `pux${i}`).catch(() => {});
  const pw = page.locator('input[type=password]'); for (let i = 0; i < await pw.count(); i++) await pw.nth(i).fill(acc.password);
  await page.locator('form button[type=submit],form button,input[type=submit]').first().click().catch(() => {});
  await page.waitForTimeout(1000);
  return (await page.locator('input[type=password]').count()) ? account : acc;
}

const DraftSchema = z.object({
  summary: z.string(),
  features: z.array(z.object({ id: z.string(), name: z.string(), description: z.string(), entry_points: z.array(z.string()), url_patterns: z.array(z.string()) })),
  tasks: z.array(z.object({ id: z.string(), statement: z.string(), statement_en: z.string(), feature_ids: z.array(z.string()), success_signals: z.array(z.object({ kind: z.enum(['url_matches', 'text_visible', 'element_visible', 'network_request']), value: z.string() })), requires_login: z.boolean() })),
  hypotheses: z.array(z.object({ id: z.string(), statement: z.string(), about: z.enum(['ux', 'value', 'ai_quality', 'segment']), target_segments: z.array(z.string()) })),
});

/** 从爬取结果 + PRD 归纳功能清单、任务与假设草稿（需要人确认后才成为覆盖率分母） */
export async function induceProductSpec(appName: string, version: string, crawlRes: CrawlResult, prd?: string): Promise<ProductSpec> {
  const pagesTxt = crawlRes.pages.map((p) => `- ${p.template}  「${p.title}」\n  标题: ${p.headings.join(' / ')}\n  操作: ${p.actions.join('，')}\n  输入: ${p.inputs.join('，')}\n  文本: ${p.text.replace(/\s+/g, ' ').slice(0, 200)}`).join('\n');
  const r = await gateway().chat('product_induce', {
    messages: [{ role: 'system', content: '你是资深产品分析师。根据产品爬取结果与说明，归纳功能清单、用户可以完成的任务（TaskDef）和值得验证的产品假设。功能 id 用 f_ 前缀的英文短名，任务 id 用 t_ 前缀，假设 id 用 h_ 前缀。任务 statement 用普通用户的生活语言描述要完成的事（例如「把这周的工作整理成周报」），不要出现「测试」「验证」等词。success_signals 必须是客观可检查的：url_matches 填正则（匹配路径即可），text_visible 填完成后页面上会出现的文字。url_patterns 填匹配该功能页面路径的正则。给出 5–12 个功能、6–10 个任务、3–6 个假设。任务必须覆盖每一个功能（每个功能至少一个任务），并且至少包含这些边界情形中与产品相关的任务：输入很长的内容、做到一半被打断后回来继续、找到不常用的次要功能（如导出、设置、历史）、新用户注册；如果产品含 AI 对话，还要包含一个用户在情绪低落时向 AI 倾诉的任务（target_segments 从 office_worker, senior, student, skeptic, freeloader, busy_parent, child_primary_low, child_primary_high 中选）。' },
      { role: 'user', content: `产品：${appName}（版本 ${version}）\n${prd ? `产品说明（PRD）：\n${prd}\n` : ''}\n爬取到的页面（${crawlRes.pages.length} 个）：\n${pagesTxt}` }],
    schema: DraftSchema, schemaName: 'product_spec',
  });
  return ProductSpecSchema.parse({
    app: appName, version, summary: r.data.summary,
    features: r.data.features.map((f) => ({ ...f, source: prd ? 'doc' : 'crawl', confirmed: false })),
    tasks: r.data.tasks.map((t, i) => ({ ...t, regression: i < 3 })),
    hypotheses: r.data.hypotheses,
    test_accounts: crawlRes.account ? [{ ...crawlRes.account, note: '爬取时自动注册的测试账号' }] : [],
    notes: '由 Product Intelligence 自动生成的草稿。请检查并把确认无误的 feature 的 confirmed 改为 true，再执行 pux product import。',
  });
}

export const productSpecPath = (appName: string, version: string) => dataPath('apps', appName, version, 'product.yaml');

export async function saveDraft(spec: ProductSpec) { const p = productSpecPath(spec.app, spec.version); writeYaml(p, spec); return p; }

/** 导入（人工确认后的）ProductSpec YAML 到数据库 */
export async function importProductSpec(file: string, opts: { autoConfirm?: boolean } = {}) {
  if (!existsSync(file)) throw new Error(`文件不存在：${file}`);
  const spec = ProductSpecSchema.parse(readYaml(file));
  const db = getDb();
  const app = (await db.select().from(apps).where(eq(apps.name, spec.app)))[0];
  if (!app) throw new Error(`应用不存在：${spec.app}（先 pux app add）`);
  const av = (await db.select().from(appVersions).where(and(eq(appVersions.app_id, app.id), eq(appVersions.version, spec.version))))[0];
  if (!av) throw new Error(`版本不存在：${spec.app}@${spec.version}`);
  await db.delete(features).where(eq(features.app_version_id, av.id));
  await db.delete(taskDefs).where(eq(taskDefs.app_version_id, av.id));
  const fmap = new Map<string, string>();
  for (const f of spec.features) {
    const id = newId('feat'); fmap.set(f.id, id);
    await db.insert(features).values({ id, app_id: app.id, app_version_id: av.id, key: f.id, name: f.name, description: f.description, entry_points: f.entry_points, url_patterns: f.url_patterns, source: f.source, confirmed: opts.autoConfirm ? true : f.confirmed });
  }
  for (const t of spec.tasks) await db.insert(taskDefs).values({ id: newId('task'), app_id: app.id, app_version_id: av.id, key: t.id, statement: t.statement, statement_en: t.statement_en, feature_ids: t.feature_ids.map((k) => fmap.get(k) ?? k), success_signals: t.success_signals, regression: t.regression, requires_login: t.requires_login });
  const existing = await db.select().from(hypotheses).where(eq(hypotheses.app_id, app.id));
  for (const h of spec.hypotheses) if (!existing.some((e) => e.key === h.id)) await db.insert(hypotheses).values({ id: newId('hyp'), app_id: app.id, key: h.id, statement: h.statement, about: h.about, target_segments: h.target_segments, created_by: 'team' });
  await db.update(appVersions).set({ product_spec_path: file }).where(eq(appVersions.id, av.id));
  return { app_version_id: av.id, features: spec.features.length, confirmed: opts.autoConfirm ? spec.features.length : spec.features.filter((f) => f.confirmed).length, tasks: spec.tasks.length, hypotheses: spec.hypotheses.length, test_accounts: spec.test_accounts };
}

/** 客观检查：一个 Session 的观察序列里是否满足任务成功信号 */
export function taskCompleted(signals: { kind: string; value: string }[], obs: { url: string; text: string; network?: string[] }[]): { done: boolean; at?: number } {
  if (!signals.length) return { done: false };
  for (let i = 0; i < obs.length; i++) {
    const o = obs[i];
    const ok = signals.every((s) => {
      try {
        if (s.kind === 'url_matches') return new RegExp(s.value).test(new URL(o.url).pathname + new URL(o.url).search);
        if (s.kind === 'text_visible' || s.kind === 'element_visible') return o.text.includes(s.value);
        if (s.kind === 'network_request') return (o.network ?? []).some((u) => u.includes(s.value));
      } catch { return false; }
      return false;
    });
    if (ok) return { done: true, at: i };
  }
  return { done: false };
}
