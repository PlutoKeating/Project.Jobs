import { newId } from '@pux/core';
import { and, appVersions, apps, eq, getDb, type SeededDefect } from '@pux/db';

export async function addApp(opts: { name: string; form?: 'web' | 'h5' | 'desktop'; description?: string; stage?: string }) {
  const db = getDb();
  const ex = (await db.select().from(apps).where(eq(apps.name, opts.name)))[0];
  if (ex) { await db.update(apps).set({ form: opts.form ?? ex.form, description: opts.description ?? ex.description }).where(eq(apps.id, ex.id)); return ex.id; }
  const id = newId('app');
  await db.insert(apps).values({ id, name: opts.name, form: opts.form ?? 'web', description: opts.description ?? '', stage: opts.stage ?? 'mvp' });
  return id;
}

export async function addVersion(opts: { appId: string; version: string; url: string; prd?: string; gitSha?: string; seededDefects?: SeededDefect[]; resetUrl?: string }) {
  const db = getDb();
  const ex = (await db.select().from(appVersions).where(and(eq(appVersions.app_id, opts.appId), eq(appVersions.version, opts.version))))[0];
  if (ex) { await db.update(appVersions).set({ env_url: opts.url, prd: opts.prd ?? ex.prd, seeded_defects: opts.seededDefects ?? ex.seeded_defects, git_sha: opts.gitSha ?? ex.git_sha, reset_url: opts.resetUrl ?? ex.reset_url }).where(eq(appVersions.id, ex.id)); return ex.id; }
  const id = newId('av');
  await db.insert(appVersions).values({ id, app_id: opts.appId, version: opts.version, env_url: opts.url, prd: opts.prd, git_sha: opts.gitSha, seeded_defects: opts.seededDefects, reset_url: opts.resetUrl });
  return id;
}

export async function resolveAppVersion(ref: string): Promise<{ app: typeof apps.$inferSelect; av: typeof appVersions.$inferSelect }> {
  const db = getDb();
  if (ref.startsWith('av_')) { const av = (await db.select().from(appVersions).where(eq(appVersions.id, ref)))[0]; if (!av) throw new Error(`版本不存在：${ref}`); const app = (await db.select().from(apps).where(eq(apps.id, av.app_id)))[0]; return { app, av }; }
  const [name, version] = ref.split('@');
  const app = (await db.select().from(apps).where(eq(apps.name, name)))[0];
  if (!app) throw new Error(`应用不存在：${name}`);
  const vs = await db.select().from(appVersions).where(eq(appVersions.app_id, app.id));
  const av = version ? vs.find((v) => v.version === version) : vs.sort((a, b) => b.created_at.getTime() - a.created_at.getTime())[0];
  if (!av) throw new Error(`版本不存在：${ref}`);
  return { app, av };
}

/** 注册内置 Demo：每个 Demo 一个 App，两个版本：clean（干净）与 seeded（植入已知缺陷，作为客观校准源） */
export async function registerDemos(only?: string[]) {
  const { DEMO_APPS, demoUrl } = await import('@pux/demos');
  const out: { app: string; clean: string; seeded: string }[] = [];
  for (const d of DEMO_APPS.filter((x) => !only?.length || only.includes(x.id))) {
    const appId = await addApp({ name: `demo-${d.id}`, form: d.form ?? 'web', description: `${d.name}（${d.name_en}）：${d.tagline}` });
    const clean = await addVersion({ appId, version: 'clean', url: demoUrl(d.id, false), prd: d.description, resetUrl: `${demoUrl(d.id, false)}__pux/reset` });
    const seeded = await addVersion({ appId, version: 'seeded', url: demoUrl(d.id, true), prd: d.description, resetUrl: `${demoUrl(d.id, true)}__pux/reset`, seededDefects: d.defects.map((x) => ({ id: x.id, category: x.category, title: x.title, description: x.description, location: x.location, keywords: x.keywords, severity: x.severity })) });
    out.push({ app: `demo-${d.id}`, clean, seeded });
  }
  return out;
}
