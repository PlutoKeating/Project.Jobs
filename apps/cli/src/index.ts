#!/usr/bin/env node
// pux —— AI 产品体验官命令行（MVP 的主入口）
import { Command } from 'commander';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { env, logger, REPO_ROOT, dataPath, type StudyInput } from '@pux/core';
import { closeDb, desc, eq, getDb, humanTasks, issues, runMigrations, sessions, studies, apps, appVersions, personas, calibrationResults, executorComparisons } from '@pux/db';
import { gateway } from '@pux/llm';
import { blobs } from '@pux/storage';
import * as E from '@pux/engine';

const program = new Command();
program.name('pux').description('AI 产品体验官：让模拟用户在模拟世界里使用真实产品，发现体验问题并给出可信度').version('0.1.0');

const out = (x: unknown) => console.log(typeof x === 'string' ? x : JSON.stringify(x, null, 2));
const progress = (m: string) => console.log(m);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const wrap = <A extends any[]>(fn: (...a: A) => Promise<unknown>) => async (...a: A) => { try { await fn(...a); } catch (e) { console.error(`❌ ${(e as Error).message}`); process.exitCode = 1; } finally { await closeDb(); } };

// ---------------------------------------------------------------- 环境
program.command('doctor').description('检查依赖服务、模型网关、数据库、对象存储、Temporal、浏览器').action(wrap(async () => {
  const check = async (name: string, f: () => Promise<string>) => { try { console.log(`✅ ${name}: ${await f()}`); } catch (e) { console.log(`❌ ${name}: ${String((e as Error).message).slice(0, 160)}`); } };
  await check('Postgres', async () => { await getDb().execute('select 1' as never); return env.databaseUrl.replace(/:[^:@/]+@/, ':***@'); });
  await check('MinIO/S3', async () => { await blobs().ping(); return env.s3Endpoint; });
  await check('LiteLLM', async () => { const r = await gateway().ping(); if (!r.ok) throw new Error(r.detail); return r.detail; });
  await check('Temporal', async () => { const { Connection } = await import('@temporalio/client'); const c = await Connection.connect({ address: env.temporalAddress, connectTimeout: 3000 }); await c.close(); return env.temporalAddress; });
  await check('Chromium', async () => { const { chromium } = await import('playwright'); const b = await chromium.launch(); await b.close(); return 'ok'; });
  await check('ffmpeg', async () => execSync('ffmpeg -version').toString().split('\n')[0]);
  await check('gcloud ADC', async () => { execSync('gcloud auth application-default print-access-token', { stdio: 'pipe' }); return 'ok（TTS 语音注入可用）'; });
}));

program.command('init').description('一键初始化：数据库迁移 + 导入 Persona 与世界模板 + 注册内置 Demo').option('--no-demos', '不注册内置 Demo').action(wrap(async (o: { demos: boolean }) => {
  await runMigrations(); console.log('✅ 数据库迁移完成');
  const p = await E.importPersonas(); console.log(`✅ Persona：新增 ${p.imported}，未变化 ${p.unchanged}${p.errors.length ? `，错误 ${p.errors.length}\n${p.errors.join('\n')}` : ''}`);
  const w = await E.importWorldTemplates(); console.log(`✅ 世界模板：${w.join(', ')}`);
  if (o.demos) { const d = await E.registerDemos(); console.log(`✅ Demo：${d.map((x) => x.app).join(', ')}（先运行 pnpm demos 启动）`); }
}));

const db = program.command('db').description('数据库');
db.command('migrate').action(wrap(async () => { await runMigrations(); console.log('✅ 迁移完成'); }));

// ---------------------------------------------------------------- 被测应用
const app = program.command('app').description('被测应用（灌入新项目）');
app.command('add').description('注册一个被测应用及版本').requiredOption('--name <name>').requiredOption('--url <url>', '测试环境入口 URL').option('--version <v>', '版本号', 'v1').option('--form <form>', 'web | h5', 'web').option('--prd <file>', 'PRD/产品说明文件（Markdown/文本）').option('--desc <text>', '一句话描述').option('--seeded <file>', '已知缺陷清单 YAML/JSON（植入缺陷版本，用于校准）').option('--reset-url <url>', '每次 Study 开始前调用的测试环境重置地址（可选）')
  .action(wrap(async (o: { name: string; url: string; version: string; form: 'web' | 'h5'; prd?: string; desc?: string; seeded?: string; resetUrl?: string }) => {
    const appId = await E.addApp({ name: o.name, form: o.form, description: o.desc });
    const seeded = o.seeded ? (o.seeded.endsWith('.json') ? JSON.parse(readFileSync(o.seeded, 'utf8')) : (await import('yaml')).parse(readFileSync(o.seeded, 'utf8'))) : undefined;
    const av = await E.addVersion({ appId, version: o.version, url: o.url, prd: o.prd ? readFileSync(o.prd, 'utf8') : o.desc, seededDefects: seeded, resetUrl: o.resetUrl });
    console.log(`✅ ${o.name}@${o.version} → ${av}`);
  }));
app.command('list').action(wrap(async () => {
  const rows = await getDb().select({ app: apps.name, form: apps.form, version: appVersions.version, id: appVersions.id, url: appVersions.env_url, seeded: appVersions.seeded_defects }).from(appVersions).innerJoin(apps, eq(apps.id, appVersions.app_id));
  console.table(rows.map((r) => ({ ...r, seeded: Array.isArray(r.seeded) ? r.seeded.length : 0 })));
}));

const demo = program.command('demo').description('内置 Demo 被测应用');
demo.command('register').argument('[ids...]').action(wrap(async (ids: string[]) => out(await E.registerDemos(ids))));
demo.command('start').description('启动全部 Demo（前台运行）').argument('[ids...]').action(async (ids: string[]) => { execSync(`pnpm --filter @pux/demos start ${ids.join(' ')}`, { stdio: 'inherit', cwd: REPO_ROOT }); });

// ---------------------------------------------------------------- Product Intelligence
const product = program.command('product').description('产品理解：爬取、归纳、确认');
product.command('crawl').description('爬取并让 LLM 归纳功能清单/任务/假设草稿（YAML）').requiredOption('--app <name@version>').option('--max-pages <n>', '最大页面数', '25').option('--user <username>').option('--password <password>').option('--no-signup', '登录墙时不自动注册测试账号')
  .action(wrap(async (o: { app: string; maxPages: string; user?: string; password?: string; signup: boolean }) => {
    const { app: a, av } = await E.resolveAppVersion(o.app);
    const cr = await E.crawl(av.env_url, { maxPages: Number(o.maxPages), account: o.user ? { username: o.user, password: o.password ?? '' } : undefined, autoSignup: o.signup });
    console.log(`🕸️ 爬取 ${cr.pages.length} 个页面`);
    const spec = await E.induceProductSpec(a.name, av.version, cr, av.prd ?? a.description ?? undefined);
    const p = await E.saveDraft(spec);
    console.log(`📝 草稿：${p}\n   功能 ${spec.features.length} · 任务 ${spec.tasks.length} · 假设 ${spec.hypotheses.length}\n   请检查后把 confirmed 改为 true，再运行：pux product import ${p}`);
  }));
product.command('import').argument('<file>').option('--auto-confirm', '全部功能视为已确认（全自动模式）').action(wrap(async (file: string, o: { autoConfirm?: boolean }) => out(await E.importProductSpec(file, { autoConfirm: o.autoConfirm }))));

// ---------------------------------------------------------------- Persona / 世界
const persona = program.command('persona').description('Persona（六层 Human Ontology）');
persona.command('import').argument('[dirs...]').action(wrap(async (dirs: string[]) => out(await E.importPersonas(dirs.length ? dirs : undefined))));
persona.command('list').action(wrap(async () => { const rows = await getDb().select().from(personas).where(eq(personas.active, true)); console.table(rows.map((r) => ({ id: r.id, version: r.version, kind: r.kind, locale: r.locale, segment: r.segment, name: (r.spec as { identity: { name: string } }).identity.name, frozen: r.frozen }))); }));
persona.command('generate').description('生成流水线：分布骨架 → PersonaHub 种子 → 六层补全 → 一致性 → 去重').option('-n <n>', '数量', '5').option('--locale <l>', 'zh-CN | en-US', 'zh-CN').option('--seed <s>').action(wrap(async (o: { n: string; locale: 'zh-CN' | 'en-US'; seed?: string }) => out(await E.generatePersonas({ n: Number(o.n), locale: o.locale, seed: o.seed ? Number(o.seed) : undefined }))));
const world = program.command('world').description('世界模板');
world.command('import').action(wrap(async () => out(await E.importWorldTemplates())));

// ---------------------------------------------------------------- Study
const studyOpts = (c: Command) => c.option('--sessions <n>', '最多 Session 数').option('--steps <n>', '每个 Session 最多步数').option('--concurrency <n>', '并发').option('--round <n>', '每轮 Session 数').option('--executor <e>', 'stagehand | midscene', 'stagehand').option('--locale <l>', 'zh-CN | en-US | mixed', 'zh-CN').option('--personas <ids>', '逗号分隔的 Persona id').option('--worlds <ids>', '逗号分隔的世界模板 id').option('--mix <g,c,s,a>', '模式配比 goal,curiosity,stress,adversarial').option('--revisits <days>', '留存回访天数，例如 1,7,30').option('--children', '包含儿童 Persona（需配置开启）').option('--no-replay', '不做干净重放').option('--no-interview', '不做事后访谈').option('--judges <n>', '评审数 1–3').option('--headed', '有头浏览器（可实时观察）').option('--key <k>', '幂等键').option('--study-name <name>', 'Study 名称').option('--lang <l>', '报告语言 zh | en | both');
function toInput(av: string, o: Record<string, string | boolean | undefined>): Partial<StudyInput> & { app_version_id: string } {
  const mix = typeof o.mix === 'string' ? o.mix.split(',').map(Number) : undefined;
  return { app_version_id: av, name: o.studyName as string, trigger: 'cli', idempotency_key: o.key as string, executor: (o.executor as 'stagehand') ?? 'stagehand', locale: (o.locale as 'zh-CN') ?? 'zh-CN',
    budget: { max_sessions: Number(o.sessions ?? 8), max_steps_per_session: Number(o.steps ?? 40), max_tokens: 6_000_000, max_tokens_per_session: 800_000, concurrency: Number(o.concurrency ?? 3), round_size: Number(o.round ?? 4) },
    persona_ids: typeof o.personas === 'string' ? o.personas.split(',') : undefined, world_ids: typeof o.worlds === 'string' ? o.worlds.split(',') : undefined,
    mode_mix: mix ? { goal: mix[0], curiosity: mix[1], stress: mix[2], adversarial: mix[3] } : undefined as never,
    revisits: typeof o.revisits === 'string' ? o.revisits.split(',').map(Number) : [], include_children: !!o.children, clean_replay: o.replay !== false, interview: o.interview !== false, judges: Number(o.judges ?? 2), headed: !!o.headed, report_lang: (o.lang as 'both') ?? 'both' };
}
const study = program.command('study').description('Study：一次完整的模拟研究');
studyOpts(study.command('create').requiredOption('--app <name@version>')).action(wrap(async (o: Record<string, string>) => { const { av } = await E.resolveAppVersion(o.app); const r = await E.createStudy(toInput(av.id, o)); out(r); }));
study.command('run').argument('<studyId>').option('--temporal', '提交到 Temporal 工作流（需先运行 pnpm worker）').option('--headed').description('运行 Study（默认进程内编排）').action(wrap(async (id: string, o: { temporal?: boolean; headed?: boolean }) => {
  if (o.temporal) { const { submitStudy } = await import('@pux/worker/client'); const wf = await submitStudy(id); console.log(`🚀 已提交 Temporal 工作流 ${wf}（UI: http://127.0.0.1:${env.temporalUiPort}）`); return; }
  await E.runStudyInline(id, progress, { headed: o.headed });
}));
study.command('list').action(wrap(async () => { const rows = await getDb().select().from(studies).orderBy(desc(studies.created_at)); console.table(rows.map((s) => ({ id: s.id, status: s.status, name: s.name, tokens: s.tokens, cost: s.cost_usd.toFixed(2), stop: s.stop_reason?.slice(0, 30), created: s.created_at.toLocaleString() }))); }));
study.command('status').argument('<studyId>').action(wrap(async (id: string) => {
  const s = (await getDb().select().from(studies).where(eq(studies.id, id)))[0]; if (!s) throw new Error('不存在');
  const ss = await getDb().select().from(sessions).where(eq(sessions.study_id, id));
  console.log(`${s.id} · ${s.status} · tokens ${s.tokens} · $${s.cost_usd.toFixed(2)} ${s.stop_reason ?? ''}`);
  console.table(ss.map((x) => ({ id: x.id, persona: x.persona_id, world: x.world_template_id, mode: x.mode, status: x.status, outcome: x.outcome, steps: x.steps_count, reason: x.end_reason?.slice(0, 40) })));
}));
study.command('finalize').argument('<studyId>').description('重新合成问题、校准并生成报告').action(wrap(async (id: string) => { await E.finalizeStudy(id, progress); }));

/** 全自动：灌入新项目一步到位（注册 → 爬取 → 归纳 → 自动确认 → 运行 → 报告） */
studyOpts(program.command('auto').description('全自动评测一个新项目：注册 → 爬取 → 归纳功能/任务/假设 → 自动确认 → 多轮模拟 → 评估 → 校准 → 报告').option('--url <url>', '被测 Web App 入口').option('--app <name@version>', '已注册的应用版本').option('--name <name>', '新应用名称').option('--version <v>', '版本', 'v1').option('--form <f>', 'web | h5', 'web').option('--prd <file>').option('--user <username>').option('--password <password>').option('--max-pages <n>', '爬取页数', '20'))
  .action(wrap(async (o: Record<string, string>) => {
    let ref = o.app;
    if (!ref) {
      if (!o.url) throw new Error('需要 --url 或 --app');
      const name = o.name ?? new URL(o.url).host.replace(/[:.]/g, '-');
      const appId = await E.addApp({ name, form: o.form as 'web' });
      await E.addVersion({ appId, version: o.version, url: o.url, prd: o.prd ? readFileSync(o.prd, 'utf8') : undefined });
      ref = `${name}@${o.version}`;
    }
    const { app: a, av } = await E.resolveAppVersion(ref);
    if (!(await getDb().select().from(personas)).length) { await E.importPersonas(); await E.importWorldTemplates(); }
    const specPath = E.productSpecPath(a.name, av.version);
    if (!existsSync(specPath)) {
      console.log('🕸️ 爬取产品…');
      const cr = await E.crawl(av.env_url, { maxPages: Number(o.maxPages ?? 20), account: o.user ? { username: o.user, password: o.password ?? '' } : undefined });
      console.log(`   ${cr.pages.length} 个页面；🧠 归纳功能/任务/假设…`);
      const spec = await E.induceProductSpec(a.name, av.version, cr, av.prd ?? a.description ?? undefined);
      await E.saveDraft(spec);
    }
    const imp = await E.importProductSpec(specPath, { autoConfirm: true });
    console.log(`📦 产品理解：功能 ${imp.features} · 任务 ${imp.tasks} · 假设 ${imp.hypotheses}（${specPath}）`);
    const st = await E.createStudy(toInput(av.id, { ...o, trigger: 'cli' }));
    if (st.isolation_warning) console.log(`⚠️ ${st.isolation_warning}`);
    console.log(`🚀 Study ${st.id}`);
    await E.runStudyInline(st.id, progress, { headed: !!o.headed });
  }));

// ---------------------------------------------------------------- 报告、访谈、问题
program.command('report').argument('<studyId>').description('重新生成报告（Markdown + HTML）').action(wrap(async (id: string) => { const r = await E.generateReport(id); out(r.paths); }));
program.command('issues').argument('<studyId>').action(wrap(async (id: string) => { const rows = await E.studyIssues(id); console.table(rows.map((i) => ({ sev: i.severity, cat: i.category, attr: i.attribution, trust: i.trust_level, status: i.status, sessions: i.session_ids?.length, seeded: i.seeded_match, title: i.title.slice(0, 50) }))); }));
program.command('interview').argument('<sessionId>').argument('[question...]').description('可追问访谈（不带问题则进入交互模式）').action(wrap(async (sid: string, q: string[]) => {
  if (q.length) { console.log(await E.askPersona(sid, q.join(' '))); return; }
  const rl = (await import('node:readline/promises')).createInterface({ input: process.stdin, output: process.stdout });
  for (;;) { const line = (await rl.question('你问> ')).trim(); if (!line || line === 'exit') break; console.log(`💬 ${await E.askPersona(sid, line)}\n`); }
  rl.close();
}));

const issueCmd = program.command('issue').description('问题分诊（人工确认 / 驳回，用于误报率下界与校准）');
issueCmd.command('confirm').argument('<issueId>').action(wrap(async (id: string) => { await getDb().update(issues).set({ status: 'confirmed' }).where(eq(issues.id, id)); console.log('✅ 已确认为真实问题'); }));
issueCmd.command('reject').argument('<issueId>').action(wrap(async (id: string) => { await getDb().update(issues).set({ status: 'rejected' }).where(eq(issues.id, id)); console.log('✅ 已驳回（计为误报）'); }));

// ---------------------------------------------------------------- 校准
const cal = program.command('calibrate').description('校准与学习回路');
cal.command('seeded').argument('<studyId>').description('在植入缺陷版本上计算检出率/误报率').action(wrap(async (id: string) => out(await E.calibrateSeeded(id))));
cal.command('human').argument('<studyId>').argument('<file>').description('导入真人基准（YAML/JSON，见 docs/CALIBRATION.md）').action(wrap(async (id: string, f: string) => out(await E.calibrateHuman(f, id))));
cal.command('funnel').argument('<studyId>').argument('<csv>').description('埋点漏斗 CSV：step,url_pattern,dropoff').action(wrap(async (id: string, f: string) => out(await E.calibrateFunnel(f, id))));
cal.command('reviews').argument('<studyId>').argument('<file>').description('应用商店/社媒评论文本').action(wrap(async (id: string, f: string) => out(await E.calibrateReviews(f, id))));
cal.command('card').argument('<app>').action(wrap(async (name: string) => { const a = (await getDb().select().from(apps).where(eq(apps.name, name)))[0]; out(await E.calibrationCard(a.id)); }));
cal.command('learn').argument('<app>').action(wrap(async (name: string) => { const a = (await getDb().select().from(apps).where(eq(apps.name, name)))[0]; out(await E.learnFromCalibration(a.id)); }));

// ---------------------------------------------------------------- 人工接管
const human = program.command('human').description('人工接管（验证码等 needs_human）');
human.command('list').action(wrap(async () => console.table(await getDb().select().from(humanTasks).orderBy(desc(humanTasks.created_at)))));
human.command('resolve').argument('<taskId>').option('--note <n>').action(wrap(async (id: string, o: { note?: string }) => { await E.resolveHumanTask(id, 'resolved', o.note); try { const { signalHuman } = await import('@pux/worker/client'); await signalHuman(id); } catch { /* inline 模式无需信号 */ } console.log('✅ 已标记处理完成'); }));

// ---------------------------------------------------------------- M0：执行器对比
program.command('m0').description('M0 执行器对比：在同一被测 App 上用同一组动作对比 Stagehand 与 Midscene').requiredOption('--app <name@version>').action(wrap(async (o: { app: string }) => {
  const { runM0 } = await import('./m0.ts'); const r = await runM0(o.app); out(r);
}));

program.command('console').description('启动本地 Web 控制台').action(async () => { await import('@pux/console/server'); });
program.command('worker').description('启动 Temporal worker').action(async () => { await import('@pux/worker'); });

program.parseAsync().catch((e) => { logger.error(e); process.exit(1); });
export { dataPath, join, calibrationResults, executorComparisons };
