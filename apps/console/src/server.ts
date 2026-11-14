// 本地 Web 控制台 + API（POST /studies 统一入口，支持幂等键）
import Fastify, { type FastifyReply } from 'fastify';
import formbody from '@fastify/formbody';
import fstatic from '@fastify/static';
import { existsSync, readFileSync } from 'node:fs';
import { dataPath, env, logger, type StudyInput } from '@pux/core';
import { and, appVersions, apps, desc, eq, evidence, getDb, humanTasks, issues, sessions, studies, steps, observations, interviews, judgments, events } from '@pux/db';
import { blobs } from '@pux/storage';
import * as E from '@pux/engine';

const app = Fastify({ logger: false, bodyLimit: 10 * 1024 * 1024 });
await app.register(formbody);
await app.register(fstatic, { root: dataPath('reports'), prefix: '/reports/', decorateReply: false });

const running = new Map<string, { log: string[]; started: number; done?: boolean; error?: string }>();
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const page = (title: string, body: string, refresh = false) => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · AI 产品体验官</title>${refresh ? '<meta http-equiv="refresh" content="8">' : ''}
<style>:root{--bg:#f6f7f9;--fg:#1d2129;--mut:#86909c;--card:#fff;--line:#e5e6eb;--acc:#3b5bdb}@media(prefers-color-scheme:dark){:root{--bg:#131417;--fg:#e6e8eb;--mut:#9aa0a6;--card:#1c1e22;--line:#2c2f34;--acc:#7b93ff}}
*{box-sizing:border-box}body{margin:0;font:14px/1.6 -apple-system,"PingFang SC","Noto Sans CJK SC",sans-serif;background:var(--bg);color:var(--fg)}a{color:var(--acc)}header{background:var(--card);border-bottom:1px solid var(--line);padding:12px 20px;display:flex;gap:18px;align-items:center;flex-wrap:wrap}header b{font-size:16px}
main{max-width:1180px;margin:0 auto;padding:16px}.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;margin-bottom:14px}table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;font-size:13px;vertical-align:top}
input,select,textarea{font:inherit;padding:7px 9px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg)}button{font:inherit;background:var(--acc);color:#fff;border:0;border-radius:8px;padding:7px 14px;cursor:pointer}.mut{color:var(--mut)}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
.sev{display:inline-block;border-radius:6px;padding:0 7px;color:#fff;font-weight:600}.P0{background:#c92a2a}.P1{background:#e8590c}.P2{background:#f59f00}.P3{background:#868e96}pre{white-space:pre-wrap;max-height:300px;overflow:auto;font-size:12px}
.tl{display:grid;grid-template-columns:300px 1fr;gap:12px;border-top:1px solid var(--line);padding:8px 0}.tl img{width:100%;border-radius:6px;border:1px solid var(--line)}@media(max-width:760px){.tl{grid-template-columns:1fr}}label{display:block;margin:6px 0 2px}</style></head>
<body><header><b>🧪 AI 产品体验官</b><a href="/">总览</a><a href="/new">灌入新项目</a><a href="/human">人工接管</a><a href="http://127.0.0.1:${env.temporalUiPort}" target="_blank">Temporal UI</a></header><main>${body}</main></body></html>`;
const html = (r: FastifyReply, s: string) => r.type('text/html; charset=utf-8').send(s);

function startStudyJob(studyId: string, temporal: boolean) {
  if (temporal) return import('@pux/worker/client').then((m) => m.submitStudy(studyId));
  const job = { log: [] as string[], started: Date.now() } as { log: string[]; started: number; done?: boolean; error?: string };
  running.set(studyId, job);
  E.runStudyInline(studyId, (m) => { job.log.push(`${new Date().toLocaleTimeString()} ${m}`); if (job.log.length > 500) job.log.shift(); })
    .then(() => { job.done = true; }).catch((e) => { job.error = String((e as Error).message); job.done = true; logger.error(e); });
  return Promise.resolve(studyId);
}

/** 全自动：注册 → 爬取 → 归纳 → 自动确认 → 建 Study → 运行 */
async function autoProject(o: { name: string; url: string; version: string; form: 'web' | 'h5'; prd?: string; sessions: number; steps: number; user?: string; password?: string; temporal: boolean; executor: 'stagehand' | 'midscene' }) {
  const appId = await E.addApp({ name: o.name, form: o.form });
  const avId = await E.addVersion({ appId, version: o.version, url: o.url, prd: o.prd });
  const st = await E.createStudy({ app_version_id: avId, trigger: 'console', executor: o.executor, budget: { max_sessions: o.sessions, max_steps_per_session: o.steps, max_tokens: 6_000_000, max_tokens_per_session: 800_000, concurrency: 3, round_size: 4 } } as never);
  const job = { log: [] as string[], started: Date.now() } as { log: string[]; started: number; done?: boolean; error?: string };
  running.set(st.id, job);
  const log = (m: string) => job.log.push(`${new Date().toLocaleTimeString()} ${m}`);
  (async () => {
    const specPath = E.productSpecPath(o.name, o.version);
    if (!existsSync(specPath)) { log('🕸️ 爬取产品…'); const cr = await E.crawl(o.url, { maxPages: 20, account: o.user ? { username: o.user, password: o.password ?? '' } : undefined }); log(`🧠 归纳 ${cr.pages.length} 个页面`); await E.saveDraft(await E.induceProductSpec(o.name, o.version, cr, o.prd)); }
    const imp = await E.importProductSpec(specPath, { autoConfirm: true }); log(`📦 功能 ${imp.features} · 任务 ${imp.tasks} · 假设 ${imp.hypotheses}`);
    if (o.temporal) { const { submitStudy } = await import('@pux/worker/client'); await submitStudy(st.id); log('🚀 已提交 Temporal'); job.done = true; return; }
    await E.runStudyInline(st.id, log);
    job.done = true;
  })().catch((e) => { job.error = String((e as Error).message); job.done = true; });
  return st.id;
}

app.get('/', async (_q, r) => {
  const db = getDb();
  const avs = await db.select({ app: apps.name, form: apps.form, av: appVersions.id, version: appVersions.version, url: appVersions.env_url, seeded: appVersions.seeded_defects }).from(appVersions).innerJoin(apps, eq(apps.id, appVersions.app_id)).orderBy(apps.name);
  const sts = await db.select().from(studies).orderBy(desc(studies.created_at)).limit(40);
  const pending = (await db.select().from(humanTasks).where(eq(humanTasks.status, 'pending'))).length;
  html(r, page('总览', `${pending ? `<div class="card" style="border-color:#e8590c">⚠️ 有 ${pending} 个人工接管任务等待处理：<a href="/human">去处理</a></div>` : ''}
<div class="card"><h3>Study</h3><table><tr><th>ID</th><th>应用</th><th>状态</th><th>Tokens</th><th>成本估算</th><th>停止原因</th><th>报告</th></tr>${sts.map((s) => { const a = avs.find((x) => x.av === s.app_version_id); return `<tr><td><a href="/studies/${s.id}">${s.id}</a><br><span class="mut">${esc(s.name ?? '')}</span></td><td>${esc(a?.app)}@${esc(a?.version)}</td><td>${esc(s.status)}${running.get(s.id) && !running.get(s.id)!.done ? ' ⏳' : ''}</td><td>${s.tokens.toLocaleString()}</td><td>$${s.cost_usd.toFixed(2)}</td><td>${esc(s.stop_reason ?? s.status_detail ?? '')}</td><td>${existsSync(dataPath('reports', s.id, 'index.html')) ? `<a href="/reports/${s.id}/index.html" target="_blank">HTML</a> · <a href="/reports/${s.id}/report.zh.md" target="_blank">MD</a>` : '—'}</td></tr>`; }).join('')}</table></div>
<div class="card"><h3>被测应用</h3><table><tr><th>应用</th><th>版本</th><th>入口</th><th>已知缺陷</th><th>新建 Study</th></tr>${avs.map((a) => `<tr><td>${esc(a.app)} <span class="mut">${a.form}</span></td><td>${esc(a.version)}</td><td><a href="${esc(a.url)}" target="_blank">${esc(a.url)}</a></td><td>${Array.isArray(a.seeded) ? a.seeded.length : 0}</td><td><form method="post" action="/studies" style="display:flex;gap:6px;flex-wrap:wrap"><input type="hidden" name="app_version_id" value="${a.av}"><input name="sessions" value="6" size="2" title="Session 数"><input name="steps" value="30" size="2" title="每个 Session 步数"><select name="executor"><option>stagehand</option><option>midscene</option></select><select name="locale"><option value="zh-CN">中文</option><option value="en-US">English</option><option value="mixed">混合</option></select><label style="margin:0"><input type="checkbox" name="temporal"> Temporal</label><button>运行</button></form></td></tr>`).join('')}</table>
<p class="mut">注：运行前需已执行产品理解（pux product crawl/import 或「灌入新项目」）；没有任务定义时只会进行好奇探索。</p></div>`));
});

app.get('/new', async (_q, r) => html(r, page('灌入新项目', `<div class="card"><h3>灌入新项目 · 全自动评测</h3><form method="post" action="/api/projects">
<label>应用名称</label><input name="name" required placeholder="my-app"><label>入口 URL（测试环境）</label><input name="url" required placeholder="http://127.0.0.1:3000/" size="50">
<label>版本</label><input name="version" value="v1"><label>形态</label><select name="form"><option value="web">Web</option><option value="h5">H5（移动端视口）</option></select>
<label>产品说明 / PRD（可选，会作为 Product Intelligence 的输入）</label><textarea name="prd" rows="6" cols="80"></textarea>
<label>测试账号（可选；不填则 Persona 自己注册）</label><input name="user" placeholder="用户名"> <input name="password" placeholder="密码">
<label>Session 数 / 每 Session 步数</label><input name="sessions" value="6" size="3"> <input name="steps" value="30" size="3">
<label>执行器</label><select name="executor"><option>stagehand</option><option>midscene</option></select> <label><input type="checkbox" name="temporal"> 提交到 Temporal（需运行 pnpm worker）</label>
<p><button>开始全自动评测</button></p></form></div>`)));

app.post('/api/projects', async (q, r) => {
  const b = q.body as Record<string, string>;
  const id = await autoProject({ name: b.name, url: b.url, version: b.version || 'v1', form: (b.form as 'web') || 'web', prd: b.prd || undefined, sessions: Number(b.sessions || 6), steps: Number(b.steps || 30), user: b.user || undefined, password: b.password || undefined, temporal: !!b.temporal, executor: (b.executor as 'stagehand') || 'stagehand' });
  return q.headers.accept?.includes('json') ? { study_id: id } : r.redirect(`/studies/${id}`);
});

/** POST /studies：所有入口统一调用，Idempotency-Key 防止重复运行 */
const createAndRun = async (body: Record<string, unknown>, key?: string) => {
  const input = { app_version_id: String(body.app_version_id), trigger: (body.trigger as 'api') ?? 'api', idempotency_key: key ?? (body.idempotency_key as string | undefined), executor: (body.executor as 'stagehand') ?? 'stagehand', locale: (body.locale as 'zh-CN') ?? 'zh-CN',
    budget: { max_sessions: Number(body.sessions ?? 6), max_steps_per_session: Number(body.steps ?? 30), max_tokens: 6_000_000, max_tokens_per_session: 800_000, concurrency: Number(body.concurrency ?? 3), round_size: Number(body.round ?? 4) },
    ...(typeof body.config === 'object' ? body.config as Partial<StudyInput> : {}) };
  const st = await E.createStudy(input as never);
  if (!st.existing) await startStudyJob(st.id, !!body.temporal);
  return st;
};
app.post('/studies', async (q, r) => { const st = await createAndRun(q.body as Record<string, unknown>, q.headers['idempotency-key'] as string | undefined); return r.redirect(`/studies/${st.id}`); });
app.post('/api/studies', async (q) => createAndRun(q.body as Record<string, unknown>, q.headers['idempotency-key'] as string | undefined));
app.get('/api/studies/:id', async (q) => { const id = (q.params as { id: string }).id; const db = getDb(); return { study: (await db.select().from(studies).where(eq(studies.id, id)))[0], sessions: await db.select().from(sessions).where(eq(sessions.study_id, id)), issues: (await E.studyIssues(id)).map((i) => ({ id: i.id, title: i.title, severity: i.severity, category: i.category, attribution: i.attribution, trust: i.trust_level, status: i.status })), log: running.get(id)?.log.slice(-50) }; });

app.get('/studies/:id', async (q, r) => {
  const id = (q.params as { id: string }).id; const db = getDb();
  const s = (await db.select().from(studies).where(eq(studies.id, id)))[0]; if (!s) return r.code(404).send('not found');
  const ss = await db.select().from(sessions).where(eq(sessions.study_id, id));
  const iss = (await E.studyIssues(id)).sort((a, b) => a.severity.localeCompare(b.severity));
  const job = running.get(id);
  const live = ['running', 'evaluating', 'created'].includes(s.status) || (job && !job.done);
  html(r, page(id, `<div class="card"><h3>Study ${id} <span class="mut">${esc(s.status)}</span></h3><p>tokens ${s.tokens.toLocaleString()} · ≈$${s.cost_usd.toFixed(2)} · ${esc(s.stop_reason ?? '')} ${s.isolation_warning ? `<br>⚠️ ${esc(s.isolation_warning)}` : ''}</p>
${existsSync(dataPath('reports', id, 'index.html')) ? `<p>📄 <a href="/reports/${id}/index.html" target="_blank">HTML 报告</a> · <a href="/reports/${id}/report.zh.md" target="_blank">Markdown（中文）</a> · <a href="/reports/${id}/report.en.md" target="_blank">Markdown（English）</a></p>` : ''}
${job ? `<details ${live ? 'open' : ''}><summary>运行日志${job.error ? `（失败：${esc(job.error)}）` : ''}</summary><pre>${esc(job.log.slice(-80).join('\n'))}</pre></details>` : ''}</div>
<div class="card"><h3>Session</h3><table><tr><th>ID</th><th>Persona</th><th>世界</th><th>模式</th><th>状态</th><th>结局</th><th>步数</th><th>原因</th></tr>${ss.map((x) => `<tr><td><a href="/sessions/${x.id}">${x.id}</a>${x.is_expert_baseline ? ' 🎓' : ''}${x.revisit_day ? ` 📅D${x.revisit_day}` : ''}</td><td>${esc(x.persona_id)}</td><td>${esc(x.world_template_id)}</td><td>${esc(x.mode)}</td><td>${esc(x.status)}</td><td>${esc(x.outcome ?? '')}</td><td>${x.steps_count}</td><td>${esc((x.end_reason ?? '').slice(0, 60))}</td></tr>`).join('')}</table></div>
<div class="card"><h3>问题（${iss.length}）</h3><table><tr><th>严重度</th><th>标题</th><th>类别</th><th>归因</th><th>可信度</th><th>状态</th><th>人群</th></tr>${iss.map((i) => `<tr><td><span class="sev ${i.severity}">${i.severity}</span></td><td>${esc(i.title)}${i.seeded_match ? ` <span class="mut">≈${esc(i.seeded_match)}</span>` : ''}</td><td>${esc(i.category)}</td><td>${esc(i.attribution)}</td><td>${esc(i.trust_level)}</td><td>${esc(i.status)} <form method="post" action="/issues/${i.id}/triage" style="display:inline"><input type="hidden" name="back" value="/studies/${id}"><button name="status" value="confirmed" title="确认是真实问题" style="padding:1px 6px">✓</button><button name="status" value="rejected" title="驳回（误报）" style="padding:1px 6px;background:#868e96">✗</button></form></td><td>${esc((i.affected_segments ?? []).join(','))}</td></tr>`).join('')}</table><p class="mut">✓/✗ 为人工分诊：用于误报率下界与校准（pux calibrate seeded 重新计算）。</p></div>`, !!live));
});

app.get('/sessions/:id', async (q, r) => {
  const id = (q.params as { id: string }).id; const db = getDb();
  const s = (await db.select().from(sessions).where(eq(sessions.id, id)))[0]; if (!s) return r.code(404).send('not found');
  const st = await db.select().from(steps).where(eq(steps.session_id, id)).orderBy(steps.idx);
  const obs = new Map((await db.select().from(observations).where(eq(observations.session_id, id))).map((o) => [o.id, o]));
  const evts = await db.select().from(events).where(eq(events.session_id, id));
  const itv = await db.select().from(interviews).where(eq(interviews.session_id, id)).orderBy(interviews.created_at);
  const js = await db.select().from(judgments).where(and(eq(judgments.target_id, id), eq(judgments.target, 'session')));
  html(r, page(id, `<div class="card"><h3>Session ${id}</h3><p>${esc(s.persona_id)} · ${esc(s.world_template_id)} · ${esc(s.mode)} · <b>${esc(s.outcome ?? s.status)}</b> · ${esc(s.end_reason ?? '')}</p>${s.video_ev ? `<video controls src="/evidence/${s.video_ev}" style="max-width:100%;max-height:420px"></video>` : ''}</div>
<div class="card"><h3>可追问访谈（模拟）</h3>${itv.flatMap((i) => i.qa).map((x) => `<p><b>Q：</b>${esc(x.q)}<br><b>A：</b>${esc(x.a)}</p>`).join('')}<form method="post" action="/sessions/${id}/ask" style="display:flex;gap:8px"><input name="q" style="flex:1" placeholder="继续追问这位用户…"><button>提问</button></form></div>
<div class="card"><h3>评审（模拟估计，原始分）</h3><table>${js.map((j) => `<tr><td>${esc(j.evaluator_role)} · ${esc(j.model_alias)} · ${esc(j.phase)}</td><td>${esc(JSON.stringify(j.scores))}</td><td>${esc(j.rationale)}</td></tr>`).join('')}</table></div>
<div class="card"><h3>时间线</h3>${st.map((x) => { const o = x.observation_id ? obs.get(x.observation_id) : undefined; const shot = (o?.data as { screenshot_ev?: string } | undefined)?.screenshot_ev; const q2 = x.action_request as { verb?: string; args?: { text?: string } } | null; const r2 = x.action_result as { status?: string; error?: { code: string } } | null;
    return `<div class="tl"><div>${shot ? `<a href="/evidence/${shot}" target="_blank"><img loading="lazy" src="/evidence/${shot}"></a>` : ''}</div><div><b>#${x.idx} ${esc(x.sim_clock)}</b> <span class="mut">${esc(o?.url ?? '')}</span>${evts.filter((e) => e.step_idx === x.idx).map((e) => `<div>🌍 ${esc(e.text)} <span class="mut">${esc(e.source)}</span></div>`).join('')}<div>💭 ${esc(x.monologue)}</div><div>→ ${esc(x.intent)} ${q2?.args?.text ? `「${esc(q2.args.text)}」` : ''}</div><div class="mut">${esc(q2?.verb ?? x.decision)} · ${esc(r2?.status ?? '')} ${r2?.error ? `❗${esc(r2.error.code)}` : ''} ${x.expectation_violated ? '⚡预期落空' : ''}</div><div class="mut">${esc(JSON.stringify(x.dynamic_state))}</div></div></div>`; }).join('')}</div>`));
});
app.post('/sessions/:id/ask', async (q, r) => { const id = (q.params as { id: string }).id; await E.askPersona(id, String((q.body as Record<string, string>).q ?? '')); r.redirect(`/sessions/${id}`); });

app.get('/evidence/:id', async (q, r) => {
  const ev = (await getDb().select().from(evidence).where(eq(evidence.id, (q.params as { id: string }).id)))[0];
  if (!ev) return r.code(404).send('not found');
  if (ev.storage_ref) return r.type(ev.mime ?? 'application/octet-stream').send(await blobs().get(ev.storage_ref));
  return ev.inline;
});

app.get('/human', async (_q, r) => {
  const rows = await getDb().select().from(humanTasks).orderBy(desc(humanTasks.created_at)).limit(50);
  html(r, page('人工接管', `<div class="card"><h3>人工接管</h3><p class="mut">Session 遇到验证码等需要人工处理的情况时会挂起。打开「接管」链接（Chromium DevTools 远程画面）完成操作后点击「已处理」。超时后 Session 记为 blocked。</p><table><tr><th>任务</th><th>Session</th><th>原因</th><th>页面</th><th>状态</th><th>操作</th></tr>${rows.map((t) => `<tr><td>${t.id}</td><td><a href="/sessions/${t.session_id}">${t.session_id}</a></td><td>${esc(t.reason)}</td><td>${esc(t.url)}</td><td>${esc(t.status)}</td><td>${t.status === 'pending' ? `<a href="${esc(t.cdp_url)}" target="_blank">接管</a> <form method="post" action="/human/${t.id}/resolve" style="display:inline"><button>已处理</button></form>` : ''}</td></tr>`).join('')}</table></div>`, true));
});
app.post('/human/:id/resolve', async (q, r) => { const id = (q.params as { id: string }).id; await E.resolveHumanTask(id, 'resolved', 'console'); try { const { signalHuman } = await import('@pux/worker/client'); await signalHuman(id); } catch { /* inline */ } r.redirect('/human'); });

app.post('/issues/:id/triage', async (q, r) => { const b = q.body as Record<string, string>; if (['confirmed', 'rejected', 'open'].includes(b.status)) await getDb().update(issues).set({ status: b.status }).where(eq(issues.id, (q.params as { id: string }).id)); r.redirect(b.back || '/'); });
app.get('/healthz', async () => ({ ok: true }));

const port = env.consolePort;
await app.listen({ port, host: '127.0.0.1' });
console.log(`🧪 控制台：http://127.0.0.1:${port}/`);
export { issues, readFileSync };
