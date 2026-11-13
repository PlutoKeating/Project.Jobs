// Exploration Memory 与覆盖率（§8.1）
import { newId } from '@pux/core';
import { and, coverage, eq, getDb, sql } from '@pux/db';

export type CovDim = 'state' | 'feature' | 'task' | 'segment' | 'scenario' | 'hypothesis' | 'issue' | 'path' | 'mode';

/** 记录一次覆盖；返回是否是新覆盖 */
export async function touch(appVersionId: string, dimension: CovDim, key: string, sessionId: string, opts: { label?: string; used?: boolean; newIssue?: boolean } = {}): Promise<boolean> {
  const db = getDb();
  const cur = (await db.select().from(coverage).where(and(eq(coverage.app_version_id, appVersionId), eq(coverage.dimension, dimension), eq(coverage.key, key))))[0];
  if (!cur) {
    await db.insert(coverage).values({ id: newId('cov'), app_version_id: appVersionId, dimension, key, label: opts.label, visits: 1, used: !!opts.used, sessions: [sessionId], last_new_issue_at: opts.newIssue ? new Date() : null }).onConflictDoNothing();
    return true;
  }
  const sessions = cur.sessions?.includes(sessionId) ? cur.sessions : [...(cur.sessions ?? []), sessionId].slice(-200);
  const becameUsed = !!opts.used && !cur.used;
  await db.update(coverage).set({ visits: sql`${coverage.visits} + 1`, used: cur.used || !!opts.used, sessions, label: opts.label ?? cur.label, last_new_issue_at: opts.newIssue ? new Date() : cur.last_new_issue_at, saturation: Math.min(1, (cur.visits + 1) / 10), updated_at: new Date() }).where(eq(coverage.id, cur.id));
  return becameUsed;
}

export async function coverageOf(appVersionId: string, dimension?: CovDim) {
  const db = getDb();
  return dimension ? db.select().from(coverage).where(and(eq(coverage.app_version_id, appVersionId), eq(coverage.dimension, dimension))) : db.select().from(coverage).where(eq(coverage.app_version_id, appVersionId));
}

/** 覆盖率摘要：功能（真正用过 / 确认功能总数）、状态数、任务路径数等 */
export async function coverageSummary(appVersionId: string, confirmedFeatureIds: string[]) {
  const rows = await coverageOf(appVersionId);
  const by = (d: string) => rows.filter((r) => r.dimension === d);
  const usedFeatures = by('feature').filter((r) => r.used && confirmedFeatureIds.includes(r.key)).length;
  return {
    features_used: usedFeatures, features_total: confirmedFeatureIds.length,
    feature_coverage: confirmedFeatureIds.length ? usedFeatures / confirmedFeatureIds.length : 0,
    states: by('state').length, task_paths: by('path').length, segments: by('segment').length, scenarios: by('scenario').length, issues: by('issue').length,
  };
}
