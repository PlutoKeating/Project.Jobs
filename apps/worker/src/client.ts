import { Client, Connection } from '@temporalio/client';
import { env, loadConfig } from '@pux/core';
import { eq, getDb, humanTasks, studies } from '@pux/db';

export const MAIN_QUEUE = 'pux-main';
async function client() { const connection = await Connection.connect({ address: env.temporalAddress }); return new Client({ connection, namespace: env.temporalNamespace }); }

/** 把 Study 提交为 Temporal 工作流（幂等：workflowId = study-<id>） */
export async function submitStudy(studyId: string) {
  const c = await client();
  const h = await c.workflow.start('studyWorkflow', { taskQueue: MAIN_QUEUE, workflowId: `study-${studyId}`, args: [studyId, loadConfig().human_takeover.timeout_min] });
  await getDb().update(studies).set({ workflow_id: h.workflowId, status: 'running' }).where(eq(studies.id, studyId));
  return h.workflowId;
}

/** 人工接管完成：给对应 Session 工作流发 Signal */
export async function signalHuman(taskId: string) {
  const t = (await getDb().select().from(humanTasks).where(eq(humanTasks.id, taskId)))[0];
  if (!t) return;
  const c = await client();
  await c.workflow.getHandle(`session-${t.session_id}`).signal('humanResolved', taskId).catch(() => {});
}
