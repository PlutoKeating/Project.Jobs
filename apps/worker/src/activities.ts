// Temporal Activities：Study = 工作流，Session = 子工作流，Step = Activity（§18）
import { hostname } from 'node:os';
import { Context } from '@temporalio/activity';
import { loadConfig } from '@pux/core';
import { eq, getDb, issues, sessions, studies } from '@pux/db';
import * as E from '@pux/engine';

export const HOST_QUEUE = `pux-host-${hostname()}-${process.pid}`;

export async function claimHost(): Promise<string> { return HOST_QUEUE; }

export async function planRound(studyId: string, round: number, size: number, revisitDay?: number): Promise<string[]> {
  return E.planNextRound(studyId, round, size, revisitDay ? { revisitDay } : {});
}

export async function studyState(studyId: string) {
  const db = getDb();
  const s = (await db.select().from(studies).where(eq(studies.id, studyId)))[0];
  const n = (await db.select().from(sessions).where(eq(sessions.study_id, studyId))).length;
  await db.update(studies).set({ status: 'running', started_at: s.started_at ?? new Date() }).where(eq(studies.id, studyId));
  return { config: s.config as import('@pux/core').StudyInput, sessions: n, tokens: s.tokens };
}

export async function startSession(sessionId: string): Promise<void> { await E.SessionRunner.start(sessionId); }

export async function stepSession(sessionId: string): Promise<{ done: boolean; needsHuman?: { task_id: string; takeover: string } }> {
  const r = E.SessionRunner.get(sessionId);
  if (!r) throw new Error(`Session ${sessionId} 不在本 worker 内存中（worker 可能已重启）`);
  Context.current().heartbeat({ step: r.stepIdx });
  const o = await r.step();
  if (o.done) return { done: true };
  return { done: false, needsHuman: o.needsHuman ? { task_id: o.needsHuman.task_id, takeover: o.needsHuman.takeover } : undefined };
}

export async function finishSession(sessionId: string, abortReason?: string): Promise<string> {
  const r = E.SessionRunner.get(sessionId);
  if (!r) { await getDb().update(sessions).set({ status: 'failed', outcome: 'sim_error', end_reason: abortReason ?? 'runner lost' }).where(eq(sessions.id, sessionId)); return 'sim_error'; }
  const end = abortReason ? await r.abort(abortReason) : await r.finish();
  if (abortReason === 'blocked') await getDb().update(sessions).set({ outcome: 'blocked', end_reason: 'needs_human 超时' }).where(eq(sessions.id, sessionId));
  return end.outcome;
}

export async function failSession(sessionId: string, reason: string) {
  await getDb().update(sessions).set({ status: 'failed', outcome: 'sim_error', end_reason: reason.slice(0, 400), ended_at: new Date() }).where(eq(sessions.id, sessionId));
}

export async function markHuman(taskId: string, status: 'resolved' | 'timeout') { await E.resolveHumanTask(taskId, status); }

export async function evaluateSession(sessionId: string) { await E.evaluateSessionPost(sessionId); }

export async function synthesizeRound(studyId: string): Promise<{ newIssues: number; saturated: boolean }> {
  const db = getDb();
  const s = (await db.select().from(studies).where(eq(studies.id, studyId)))[0];
  const cfg = s.config as import('@pux/core').StudyInput;
  const before = (await db.select().from(issues).where(eq(issues.app_version_id, s.app_version_id))).length;
  await E.synthesizeIssues(studyId, { cleanReplay: cfg.clean_replay, lang: 'zh' });
  const after = (await db.select().from(issues).where(eq(issues.app_version_id, s.app_version_id))).length;
  return { newIssues: after - before, saturated: await E.saturated(studyId, cfg.saturation_m ?? loadConfig().guards.saturation_m, after - before) };
}

export async function finalize(studyId: string, stopReason: string) { const r = await E.finalizeStudy(studyId, () => {}, stopReason); return r.paths; }
export async function failStudy(studyId: string, reason: string) { await getDb().update(studies).set({ status: 'failed', status_detail: reason.slice(0, 500), finished_at: new Date() }).where(eq(studies.id, studyId)); }
