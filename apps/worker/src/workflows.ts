// Temporal 工作流（确定性代码，只能调用 activities）
import { condition, defineSignal, executeChild, proxyActivities, setHandler, workflowInfo, ApplicationFailure } from '@temporalio/workflow';
import type * as A from './activities.ts';

export const humanResolved = defineSignal<[string]>('humanResolved');

const main = proxyActivities<typeof A>({ startToCloseTimeout: '30 minutes', retry: { maximumAttempts: 2 }, heartbeatTimeout: '10 minutes' });

export async function sessionWorkflow(sessionId: string, humanTimeoutMin: number): Promise<string> {
  const queue = await main.claimHost();
  const host = proxyActivities<typeof A>({ taskQueue: queue, startToCloseTimeout: '20 minutes', heartbeatTimeout: '10 minutes', retry: { maximumAttempts: 1 } });
  const resolved = new Set<string>();
  setHandler(humanResolved, (taskId: string) => { resolved.add(taskId); });
  try {
    await host.startSession(sessionId);
    for (;;) {
      const r = await host.stepSession(sessionId);
      if (r.done) break;
      if (r.needsHuman) {
        const t = r.needsHuman.task_id;
        const ok = await condition(() => resolved.has(t), `${humanTimeoutMin} minutes`);
        if (!ok) { await main.markHuman(t, 'timeout'); await host.finishSession(sessionId, 'blocked'); await main.evaluateSession(sessionId); return 'blocked'; }
      }
    }
    const outcome = await host.finishSession(sessionId);
    await main.evaluateSession(sessionId);
    return outcome;
  } catch (e) {
    await main.failSession(sessionId, String((e as Error).message ?? e));
    throw ApplicationFailure.nonRetryable(`session ${sessionId} failed: ${String((e as Error).message ?? e)}`);
  }
}

export async function studyWorkflow(studyId: string, humanTimeoutMin = 10): Promise<Record<string, string>> {
  try {
    let st = await main.studyState(studyId);
    const b = st.config.budget; let round = 0; let total = st.sessions; let stop = '';
    while (total < b.max_sessions) {
      if (st.tokens > b.max_tokens) { stop = 'token 预算耗尽'; break; }
      const ids = await main.planRound(studyId, round, Math.min(b.round_size, b.max_sessions - total));
      const queue = [...ids];
      await Promise.all(Array.from({ length: Math.min(b.concurrency, queue.length) }, async () => {
        while (queue.length) { const id = queue.shift()!; await executeChild(sessionWorkflow, { args: [id, humanTimeoutMin], workflowId: `session-${id}` }).catch(() => 'failed'); }
      }));
      total += ids.length; round++;
      const r = await main.synthesizeRound(studyId);
      if (r.saturated) { stop = '探索饱和'; break; }
      st = await main.studyState(studyId);
    }
    if (!stop) stop = `达到 Session 预算 ${b.max_sessions}`;
    for (const day of st.config.revisits ?? []) {
      const ids = await main.planRound(studyId, round++, Math.min(3, b.round_size), day);
      await Promise.all(ids.map((id) => executeChild(sessionWorkflow, { args: [id, humanTimeoutMin], workflowId: `session-${id}` }).catch(() => 'failed')));
      await main.synthesizeRound(studyId);
    }
    return await main.finalize(studyId, stop);
  } catch (e) {
    await main.failStudy(studyId, `${workflowInfo().workflowId}: ${String((e as Error).message ?? e)}`);
    throw e;
  }
}
