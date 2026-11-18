// 干净重放（§12.1 ②）：用复现路径在没有世界约束、没有感知过滤、动作精度满分的环境里重放
import { newId, Rng, type ActionRequest, type ActionResult } from '@pux/core';
import { eq, getDb, observations, reproPaths, sessions, steps, studies, appVersions } from '@pux/db';
import { BrowserSession, putEvidence } from '@pux/executor';

export interface ReproStep { verb: string; selector?: string; target_name?: string; args?: Record<string, unknown>; url?: string; orig_status?: string; orig_error?: string; orig_effects?: ActionResult['effects'] }

export async function buildReproPath(sessionId: string, upToStep: number): Promise<{ start_url: string; steps: ReproStep[] }> {
  const db = getDb();
  const s = (await db.select().from(sessions).where(eq(sessions.id, sessionId)))[0];
  const st = (await db.select().from(steps).where(eq(steps.session_id, sessionId)).orderBy(steps.idx)).filter((x) => x.idx <= upToStep);
  const obs = new Map((await db.select().from(observations).where(eq(observations.session_id, sessionId))).map((o) => [o.id, o]));
  const study = (await db.select().from(studies).where(eq(studies.id, s.study_id)))[0];
  const av = (await db.select().from(appVersions).where(eq(appVersions.id, study.app_version_id)))[0];
  const out: ReproStep[] = [];
  for (const x of st) {
    const q = x.action_request as ActionRequest | null; const r = x.action_result as ActionResult | null;
    if (!q?.verb || q.injected || ['switch_away', 'return', 'close_tab', 'lock', 'look_closer'].includes(q.verb as string)) continue;
    if (r && (r.status === 'blocked_by_policy' || (r.error?.layer === 'simulator' && x.idx !== upToStep))) continue;
    const sel = r?.resolved_target?.resolved?.selector ?? q.target?.resolved?.selector;
    if (!sel && ['click', 'long_press', 'hover', 'drag', 'select', 'upload'].includes(q.verb)) continue;   // 当时就没找到目标：重放时无从点起
    out.push({ verb: q.verb, selector: sel, target_name: q.target?.text || r?.resolved_target?.resolved?.a11y_name, args: q.args, url: x.observation_id ? obs.get(x.observation_id)?.url : undefined, orig_status: r?.status, orig_error: r?.error?.code, orig_effects: r?.effects });
  }
  return { start_url: av.env_url, steps: out };
}

/** 重放并判断最后一步是否复现了原始现象（相同状态类别与错误码） */
export async function cleanReplay(path: { start_url: string; steps: ReproStep[] }, opts: { candidateId?: string; issueId?: string; fromSession: string; studyId: string; account?: { username: string } }) {
  const db = getDb();
  const sid = newId('replay');
  const b = await BrowserSession.launch({ sessionId: sid, studyId: opts.studyId, executor: 'playwright', policy: { child: false, allow_real_payment: false, sandbox_domains: ['127.0.0.1', 'localhost'] }, rng: new Rng(1), record: { video: false, rrweb: false, axe: false } });
  const suffix = Math.random().toString(36).slice(2, 6);
  const log: { i: number; verb: string; status: string; error?: string }[] = [];
  let reproduced = false; let last: ActionResult | undefined;
  try {
    await b.page.goto(path.start_url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    for (let i = 0; i < path.steps.length; i++) {
      const p = path.steps[i];
      await b.observe(sid, i);
      let text = p.args?.text as string | undefined;
      if (text && opts.account && text.includes(opts.account.username)) text = text.replace(opts.account.username, `${opts.account.username.slice(0, 14)}r${suffix}`);
      const req: ActionRequest = { action_id: newId('act'), session_id: sid, step_idx: i, verb: p.verb as never, target: p.selector ? { by: 'selector', value: p.selector.replace(/^xpath=/, 'xpath=') } : undefined, args: { ...p.args, text }, intent_text: `[replay] ${p.target_name ?? p.verb}`, success: { any_of: [], within_ms: 3000 }, motor: { precision: 1, typing_cps: 20, typo_rate: 0, one_handed: false, double_tap_risk: 0 }, timeout_ms: 15000 };
      if (p.verb === 'wait') req.args = { seconds: Math.min(15, Number(p.args?.seconds ?? 8)) };
      last = await b.act(req, new Rng(1));
      log.push({ i, verb: p.verb, status: last.status, error: last.error?.code });
    }
    const target = path.steps[path.steps.length - 1];
    if (last && target) {
      const sameStatus = last.status === target.orig_status || (['failed', 'no_effect'].includes(last.status) && ['failed', 'no_effect'].includes(target.orig_status ?? ''));
      const sameError = !target.orig_error || last.error?.code === target.orig_error;
      const sameEffect = target.orig_status === 'success' && !target.orig_error ? (last.effects.url_changed === target.orig_effects?.url_changed) : true;
      reproduced = sameStatus && sameError && sameEffect;
      // 滚动、等待、按键、悬停、拖动这类动作「没反应」可能只是模拟器自己的问题，用同一套执行器重放一遍等于自己验证自己：不算复现
      if (['scroll', 'wait', 'key', 'hover', 'drag', 'look_closer'].includes(target.verb)) reproduced = false;
    }
  } catch (e) { log.push({ i: -1, verb: 'error', status: String((e as Error).message).slice(0, 120) }); }
  const shot = await b.page.screenshot({ type: 'jpeg', quality: 60 }).catch(() => null);
  await b.close().catch(() => {});
  const evId = await putEvidence('replay_result', { study_id: opts.studyId, session_id: opts.fromSession }, { inline: { reproduced, log, start_url: path.start_url }, ...(shot ? {} : {}) });
  if (shot) await putEvidence('screenshot', { study_id: opts.studyId, session_id: opts.fromSession }, { data: shot, mime: 'image/jpeg' });
  const rp = newId('repro');
  await db.insert(reproPaths).values({ id: rp, candidate_id: opts.candidateId, issue_id: opts.issueId, start_url: path.start_url, steps: path.steps, from_session_ids: [opts.fromSession], replay_runs: 1, replay_ok: reproduced ? 1 : 0, replay_ok_rate: reproduced ? 1 : 0, last_replay: { log, evidence: evId } });
  return { reproduced, repro_path_id: rp, evidence_id: evId, log };
}
