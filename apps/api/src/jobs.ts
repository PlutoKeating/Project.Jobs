// 在 API 进程内运行的 Study 任务（inline 模式；Temporal 模式提交给 worker）
import { existsSync } from 'node:fs';
import { logger, type StudyInput } from '@pux/core';
import * as E from '@pux/engine';

export interface Job { log: string[]; started: number; done?: boolean; error?: string }
export const running = new Map<string, Job>();

function newJob(id: string): (m: string) => void {
  const job: Job = { log: [], started: Date.now() };
  running.set(id, job);
  return (m: string) => { job.log.push(`${new Date().toLocaleTimeString()} ${m}`); if (job.log.length > 500) job.log.shift(); };
}

export async function startStudyJob(studyId: string, temporal: boolean) {
  if (temporal) { const { submitStudy } = await import('@pux/worker/client'); await submitStudy(studyId); return; }
  const log = newJob(studyId);
  const job = running.get(studyId)!;
  E.runStudyInline(studyId, log).then(() => { job.done = true; }).catch((e) => { job.error = String((e as Error).message); job.done = true; logger.error(e); });
}

export async function createAndRun(body: Record<string, unknown>, key?: string) {
  const input = {
    app_version_id: String(body.app_version_id), trigger: (body.trigger as 'api') ?? 'api', idempotency_key: key ?? (body.idempotency_key as string | undefined),
    executor: 'midscene', locale: (body.locale as 'zh-CN') ?? 'zh-CN',
    budget: { max_sessions: Number(body.sessions ?? 6), max_steps_per_session: Number(body.steps ?? 30), max_tokens: 6_000_000, max_tokens_per_session: 800_000, concurrency: Number(body.concurrency ?? 3), round_size: Number(body.round ?? 4) },
    ...(typeof body.config === 'object' && body.config ? body.config as Partial<StudyInput> : {}),
  };
  const st = await E.createStudy(input as never);
  if (!st.existing) await startStudyJob(st.id, !!body.temporal);
  return st;
}

/** 全自动：注册 → 爬取 → 归纳 → 自动确认 → 建 Study → 运行 */
export async function autoProject(o: { name: string; url: string; version: string; form: 'web' | 'h5'; prd?: string; sessions: number; steps: number; user?: string; password?: string; temporal: boolean }) {
  const appId = await E.addApp({ name: o.name, form: o.form });
  const avId = await E.addVersion({ appId, version: o.version, url: o.url, prd: o.prd });
  const st = await E.createStudy({ app_version_id: avId, trigger: 'console', executor: 'midscene', budget: { max_sessions: o.sessions, max_steps_per_session: o.steps, max_tokens: 6_000_000, max_tokens_per_session: 800_000, concurrency: 3, round_size: 4 } } as never);
  const log = newJob(st.id);
  const job = running.get(st.id)!;
  (async () => {
    const specPath = E.productSpecPath(o.name, o.version);
    if (!existsSync(specPath)) { log('crawl'); const cr = await E.crawl(o.url, { maxPages: 20, account: o.user ? { username: o.user, password: o.password ?? '' } : undefined }); log(`induce ${cr.pages.length}`); await E.saveDraft(await E.induceProductSpec(o.name, o.version, cr, o.prd)); }
    const imp = await E.importProductSpec(specPath, { autoConfirm: true }); log(`features ${imp.features} · tasks ${imp.tasks} · hypotheses ${imp.hypotheses}`);
    if (o.temporal) { const { submitStudy } = await import('@pux/worker/client'); await submitStudy(st.id); log('temporal'); job.done = true; return; }
    await E.runStudyInline(st.id, log);
    job.done = true;
  })().catch((e) => { job.error = String((e as Error).message); job.done = true; });
  return st.id;
}
