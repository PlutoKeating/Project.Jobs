// 产品的生命周期：清零（城里关于它的一切经历归零，产品本身不动，等于重新从零发布）与下线（从城里拿掉，可选是否连经历一起删）。
// 「经历」按产品算（同名产品发布过的每一版，即同一个 app_id 下的所有发布）：使用过程与证据、问题、曝光、念头、评论、动态、
// 使用期间收到的信，以及居民记忆里关于它的部分。模型调用记录（llm_traces）是真实花费，不删。
// 正在进行的使用由世界服务先作废（LaunchEngine.cancel），再调这里清库；世界服务不在跑时接口直接调这里。
import { logger } from '@pux/core';
import {
  and, appVersions, apps, coverage, eq, events, evidence, evidenceLinks, exposures, getDb, goals, humanTasks, hypotheses, inArray, intentions, interviews, issueCandidates, issues,
  judgments, launchReports, launches, launchVersions, mailbox, observations, or, personaGlobalState, personaMemories, personaMemoryTrees, posts, reports, reproPaths,
  scores, sessions, storeReviews, studies, worldStates,
} from '@pux/db';
import { absMinute, worldClock } from '@pux/jobsworld';
import { withTree } from '@pux/memory';
import type { LaunchRow } from './launch.ts';

export interface LaunchScope { appId: string; launches: LaunchRow[]; launchIds: string[]; studyIds: string[] }
export interface PurgeCounts { sessions: number; exposures: number; reviews: number; posts: number; memories: number; people: number }

/** 这个产品（同一个 app_id）发布过的每一版 */
export async function launchScope(l: LaunchRow): Promise<LaunchScope> {
  const ls = await getDb().select().from(launches).where(eq(launches.app_id, l.app_id));
  return { appId: l.app_id, launches: ls, launchIds: ls.map((x) => x.id), studyIds: ls.map((x) => x.study_id) };
}

/** 删掉一批使用过程，以及挂在它们和这些 study 上的评估、问题、证据、使用期间收到的信 */
async function purgeStudies(studyIds: string[], onlySessions?: string[]): Promise<number> {
  if (!studyIds.length) return 0;
  const db = getDb();
  const sessWhere = onlySessions ? inArray(sessions.id, onlySessions.length ? onlySessions : ['']) : inArray(sessions.study_id, studyIds);
  const sids = (await db.select({ id: sessions.id }).from(sessions).where(sessWhere)).map((x) => x.id);
  if (!onlySessions) {
    // 问题、候选、评审：整个 study 的都删
    const iss = db.select({ id: issues.id }).from(issues).where(inArray(issues.study_id, studyIds));
    const cand = db.select({ id: issueCandidates.id }).from(issueCandidates).where(inArray(issueCandidates.study_id, studyIds));
    const jud = db.select({ id: judgments.id }).from(judgments).where(inArray(judgments.study_id, studyIds));
    await db.delete(evidenceLinks).where(or(inArray(evidenceLinks.subject_id, iss), inArray(evidenceLinks.subject_id, jud)));
    await db.delete(reproPaths).where(or(inArray(reproPaths.issue_id, iss), inArray(reproPaths.candidate_id, cand)));
    for (const t of [issues, issueCandidates, judgments, scores, reports, goals, hypotheses, humanTasks] as const) await db.delete(t).where(inArray(t.study_id, studyIds));
  } else if (sids.length) {
    await db.delete(humanTasks).where(inArray(humanTasks.session_id, sids));
    await db.delete(issueCandidates).where(inArray(issueCandidates.session_id, sids));
  }
  for (let i = 0; i < sids.length; i += 2000) {
    const part = sids.slice(i, i + 2000);
    for (const t of [worldStates, events, observations, interviews, evidence, mailbox] as const) await db.delete(t).where(inArray(t.session_id, part));
    await db.delete(sessions).where(inArray(sessions.id, part));            // steps 随之级联删除
  }
  return sids.length;
}

/** 曝光、念头、评论、动态、一页结论、版本点 */
async function purgeLaunchRecords(launchIds: string[]) {
  const db = getDb();
  const n = { exposures: 0, reviews: 0, posts: 0 };
  if (!launchIds.length) return n;
  n.exposures = (await db.delete(exposures).where(inArray(exposures.launch_id, launchIds)).returning({ id: exposures.id })).length;
  n.reviews = (await db.delete(storeReviews).where(inArray(storeReviews.launch_id, launchIds)).returning({ id: storeReviews.id })).length;
  n.posts = (await db.delete(posts).where(inArray(posts.launch_id, launchIds)).returning({ id: posts.id })).length;
  for (const t of [intentions, launchReports, launchVersions] as const) await db.delete(t).where(inArray(t.launch_id, launchIds));
  return n;
}

/** 居民忘掉这个产品：记忆树里它的分支与相关记忆、对它的信任、指向它的信念证据。对 AI 产品整体的信任已经被改动的部分不回退 */
async function forgetEverywhere(appId: string, sessionIds: Set<string>): Promise<{ memories: number; people: number }> {
  const db = getDb();
  let memories = 0; let people = 0;
  const ids = (await db.select({ id: personaMemoryTrees.persona_id }).from(personaMemoryTrees)).map((r) => r.id);
  for (const id of ids) {
    const n = await withTree(id, (t) => t.forgetApp(appId, sessionIds)).catch((e) => { logger.warn({ persona: id, err: String((e as Error).message).slice(0, 160) }, '忘掉产品失败'); return 0; });
    if (n) { memories += n; people++; }
  }
  await db.delete(personaMemories).where(eq(personaMemories.app_id, appId));
  for (const g of await db.select().from(personaGlobalState)) {
    const trust = { ...(g.app_trust ?? {}) }; const had = appId in trust; delete trust[appId];
    const ev = (g.belief_evidence ?? []).filter((e) => e.app_id !== appId && !sessionIds.has(e.session_id));
    if (had || ev.length !== (g.belief_evidence ?? []).length) await db.update(personaGlobalState).set({ app_trust: trust, belief_evidence: ev }).where(eq(personaGlobalState.persona_id, g.persona_id));
  }
  return { memories, people };
}

/** 一个产品在城里留下的全部经历 */
async function purgeExperience(scope: LaunchScope): Promise<PurgeCounts> {
  const db = getDb();
  const sids = new Set((await db.select({ id: sessions.id }).from(sessions).where(inArray(sessions.study_id, scope.studyIds.length ? scope.studyIds : ['']))).map((x) => x.id));
  const nSess = await purgeStudies(scope.studyIds);
  const avIds = [...new Set(scope.launches.map((l) => l.app_version_id))];
  if (avIds.length) await db.delete(coverage).where(inArray(coverage.app_version_id, avIds));
  const rec = await purgeLaunchRecords(scope.launchIds);
  const mem = await forgetEverywhere(scope.appId, sids);
  return { sessions: nSess, ...rec, ...mem };
}

/**
 * 清零：城里关于这个产品的一切经历归零，产品本身（地址、介绍、商店截图、宣发设置）不动，等于此刻重新发布。
 * 同一产品更早的几版发布一并清掉，只留下这一版
 */
export async function resetLaunch(l: LaunchRow): Promise<PurgeCounts> {
  const db = getDb();
  const scope = await launchScope(l);
  const counts = await purgeExperience(scope);
  const older = scope.launches.filter((x) => x.id !== l.id);
  if (older.length) {
    const st = older.map((x) => x.study_id).filter((s) => s !== l.study_id);
    if (st.length) { await db.delete(evidence).where(inArray(evidence.study_id, st)); await db.delete(studies).where(inArray(studies.id, st)); }
    await db.delete(launches).where(inArray(launches.id, older.map((x) => x.id)));
  }
  const clk = await worldClock();
  await db.update(launches).set({ status: 'live', published_min: absMinute(clk.date, clk.minute), created_at: new Date() }).where(eq(launches.id, l.id));
  await db.update(studies).set({ status: 'running', started_at: new Date(), finished_at: null, tokens: 0, cost_usd: 0, stop_reason: null }).where(eq(studies.id, l.study_id));
  logger.info({ launch: l.id, ...counts }, '产品经历已清零');
  return counts;
}

/**
 * 下线：从城里拿掉这个产品（发布过的每一版），商店、广告、念头里都不再有它。
 * keepHistory = true：已经发生的使用、评论、动态、居民的记忆都留着（人物页还能看到，同名产品再次发布时居民还记得它）；
 * 只有没用完的使用被作废。false：连同全部经历一起删掉，产品记录本身也删掉（内部校准还在用它时保留）
 */
export async function removeLaunch(l: LaunchRow, opts: { keepHistory: boolean }): Promise<PurgeCounts & { kept: boolean }> {
  const db = getDb();
  const scope = await launchScope(l);
  let counts: PurgeCounts = { sessions: 0, exposures: 0, reviews: 0, posts: 0, memories: 0, people: 0 };
  if (opts.keepHistory) {
    const open = (await db.select({ id: sessions.id }).from(sessions).where(and(inArray(sessions.study_id, scope.studyIds), inArray(sessions.status, ['planned', 'running', 'waiting_human'])))).map((x) => x.id);
    counts.sessions = await purgeStudies(scope.studyIds, open);
    await db.delete(intentions).where(inArray(intentions.launch_id, scope.launchIds));
    await db.delete(launchReports).where(inArray(launchReports.launch_id, scope.launchIds));
    await db.delete(launchVersions).where(inArray(launchVersions.launch_id, scope.launchIds));
    await db.update(studies).set({ status: 'done', finished_at: new Date(), stop_reason: 'removed' }).where(inArray(studies.id, scope.studyIds));
    await db.delete(launches).where(inArray(launches.id, scope.launchIds));
  } else {
    counts = await purgeExperience(scope);
    await db.delete(evidence).where(inArray(evidence.study_id, scope.studyIds));
    await db.delete(launches).where(inArray(launches.id, scope.launchIds));
    await db.delete(studies).where(inArray(studies.id, scope.studyIds));
    // 产品记录：没有别的 study（内部校准批次）用它的版本时一起删掉（版本、功能、任务随之级联删除）
    const avs = (await db.select({ id: appVersions.id }).from(appVersions).where(eq(appVersions.app_id, scope.appId))).map((x) => x.id);
    const other = avs.length ? await db.select({ id: studies.id }).from(studies).where(inArray(studies.app_version_id, avs)).limit(1) : [];
    if (!other.length) await db.delete(apps).where(eq(apps.id, scope.appId));
  }
  logger.info({ launch: l.id, keep: opts.keepHistory, ...counts }, '产品已下线');
  return { ...counts, kept: opts.keepHistory };
}
