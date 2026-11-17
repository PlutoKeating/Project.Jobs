// 问题清单与「交给 coding agent」：列出与筛选、单个问题的来龙去脉、分诊、按版本对比、修复任务文本、GitHub 设置与开 issue；
// 以及 issue 关闭后的自动验证（每分钟看一次到期该查的 issue：标新版本、把手机递给撞上过这个问题的那类人、发一条 jw.notice）。
import type { FastifyInstance } from 'fastify';
import { logger } from '@pux/core';
import * as E from '@pux/engine';
import { publicUrl } from '@pux/engine/mail/settings';
import { SUBJ, type Bus, type NoticeMsg } from '@pux/jobsworld';
import { evidenceSig, requireAdmin } from './auth.ts';

type P = { id: string };

/** 公网链接下的地址；证据文件带上单文件签名，拿到链接的人只能看这一张图 */
export async function linker() {
  const base = await publicUrl();
  return (path: string) => { const m = /^\/api\/v1\/evidence\/([^/?#]+)$/.exec(path); return m ? `${base}/evidence/${m[1]}?s=${evidenceSig(decodeURIComponent(m[1]))}` : `${base}${path}`; };
}

export function issueRoutes(app: FastifyInstance, bus: Bus | undefined) {
  const launch = async (id: string) => E.getLaunch(id);

  app.get('/api/v1/launches/:id/issues', async (q, r) => {
    const l = await launch((q.params as P).id); if (!l) return r.code(404).send({ error: 'not_found' });
    const qq = q.query as { track?: 'experience' | 'engineering' | 'all'; status?: string };
    return E.listIssues(l, { track: qq.track, status: qq.status });
  });
  app.get('/api/v1/launches/:id/compare', async (q, r) => {
    const l = await launch((q.params as P).id); if (!l) return r.code(404).send({ error: 'not_found' });
    return E.compareVersions(l);
  });
  app.get('/api/v1/issues/:id', async (q, r) => (await E.issueDetail((q.params as P).id)) ?? r.code(404).send({ error: 'not_found' }));
  app.post('/api/v1/issues/:id/triage', async (q, r) => {
    if (!requireAdmin(q, r)) return;
    try { await E.triageIssue((q.params as P).id, String((q.body as { status?: string })?.status)); return { ok: true }; }
    catch { return r.code(400).send({ error: 'bad_status', allowed: E.TRIAGE_STATUSES }); }
  });
  app.get('/api/v1/issues/:id/fix-task', async (q, r) => {
    const d = await E.issueDetail((q.params as P).id); if (!d) return r.code(404).send({ error: 'not_found' });
    const l = d.launch_id ? await launch(d.launch_id) : undefined; if (!l) return r.code(404).send({ error: 'launch_not_found' });
    return { text: E.fixTaskText(l, d, await linker()) };
  });

  // ---- 每个产品的 GitHub 设置（令牌只进不出）----
  app.get('/api/v1/launches/:id/github', async (q, r) => {
    if (!requireAdmin(q, r)) return;
    const l = await launch((q.params as P).id); if (!l) return r.code(404).send({ error: 'not_found' });
    return (await E.githubSettings(l.id)) ?? { repo: null, auto_verify: true, invite_n: 3, has_token: false };
  });
  app.put('/api/v1/launches/:id/github', async (q, r) => {
    if (!requireAdmin(q, r)) return;
    const l = await launch((q.params as P).id); if (!l) return r.code(404).send({ error: 'not_found' });
    try { return await E.saveGithubSettings(l.id, (q.body ?? {}) as { repo?: string; token?: string; auto_verify?: boolean; invite_n?: number }); }
    catch (e) { return r.code(400).send({ error: 'github_settings', reason: String((e as Error).message).slice(0, 300) }); }
  });
  app.delete('/api/v1/launches/:id/github', async (q, r) => {
    if (!requireAdmin(q, r)) return;
    const l = await launch((q.params as P).id); if (!l) return r.code(404).send({ error: 'not_found' });
    await E.clearGithubSettings(l.id); return { ok: true };
  });
  app.post('/api/v1/issues/:id/github', async (q, r) => {
    if (!requireAdmin(q, r)) return;
    try { return await E.openGithubIssue((q.params as P).id, await linker()); }
    catch (e) { return r.code(400).send({ error: 'github_issue', reason: String((e as Error).message).slice(0, 300) }); }
  });

  // ---- 修好后的自动验证 ----
  const invite = async (launchId: string, body: Record<string, unknown>) => {
    if (!bus) return { invited: 0, session_ids: [] as string[] };
    const m = await bus.nc.request(SUBJ.cmdInvite, new TextEncoder().encode(JSON.stringify({ ...body, launch_id: launchId })), { timeout: 180_000 });
    return JSON.parse(new TextDecoder().decode(m.data)) as { invited?: number; session_ids?: string[]; error?: string };
  };
  let polling = false;
  const poll = async () => {
    if (polling) return; polling = true;
    try {
      await E.pollGithubIssues(async ({ link, launch: l, detail, settings }) => {
        const v = await E.markLaunchVersion(l, `修复：#${link.number} ${detail.title}`.slice(0, 200));
        const aud = E.verifyAudience(detail);
        const o = await invite(l.id, { n: settings.invite_n, ...aud, want: detail.where ? `再用一下${detail.where ? `「${detail.where}」那里` : ''}` : undefined }).catch((e) => ({ invited: 0, session_ids: [], error: String((e as Error).message) }));
        const notice: NoticeMsg = { kind: 'fix_verify', launch_id: l.id, issue_id: detail.id, title: detail.title, url: link.url, version: v.n, invited: o.invited ?? 0, ts: Date.now() };
        bus?.publish(SUBJ.notice, notice);
        logger.info({ issue: detail.id, version: v.n, invited: o.invited }, 'GitHub issue 已关闭：标了新版本并请人验证');
        return { version: v.n, sessions: o.session_ids ?? [] };
      });
    } catch (e) { logger.warn({ err: String((e as Error).message).slice(0, 200) }, 'GitHub issue 轮询出错'); }
    finally { polling = false; }
  };
  if (process.env.JOBS_GITHUB_POLL !== '0') { const t = setInterval(() => void poll(), 60_000); t.unref(); }
}
