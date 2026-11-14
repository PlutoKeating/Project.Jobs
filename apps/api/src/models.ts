// 模型接入的管理接口：目录选型、整份草稿一次发布（带版本冲突保护）、单目标测试、路由预览、版本与回滚；以及 OpenAI 兼容入口
import { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { desc, getDb, llmTests } from '@pux/db';
import * as L from '@pux/llm';
import { requireAdmin, roleOf } from './auth.ts';

export const modelsReady = L.modelsReady;

export function modelRoutes(app: FastifyInstance) {
  L.setInstanceKind('api');
  let testing = 0; let lastTest = 0;

  const state = async () => {
    const snap = await L.snapshot(true);
    const cat = await L.getCatalog();
    const tests = await getDb().select().from(llmTests).orderBy(desc(llmTests.created_at)).limit(300);
    const latest = new Map<string, (typeof tests)[number]>();
    for (const t of tests) { const k = `${t.target_id}:${t.capability}`; if (!latest.has(k)) latest.set(k, t); }
    return {
      version: snap.version, config: snap.config, poll_ms: L.POLL_MS,
      instances: await L.instances(),
      tests: [...latest.values()].map((t) => ({ target_id: t.target_id, capability: t.capability, ok: t.ok, version: t.version, cred: t.cred, latency_ms: t.latency_ms, error_class: t.error_class, detail: t.detail, at: t.created_at })),
      catalog: { source: cat.source, fetched_at: cat.fetched_at, providers: cat.providers.map((p) => ({ id: p.id, name: p.name, protocol: p.protocol, base_url: p.base_url, credential: p.credential, doc: p.doc, models: p.models.length })) },
      ...(await modelsReady()),
    };
  };

  app.get('/api/v1/models', async (q, r) => { if (!requireAdmin(q, r)) return; return state(); });

  app.get('/api/v1/models/catalog/:id', async (q, r) => {
    if (!requireAdmin(q, r)) return;
    const p = (await L.getCatalog()).providers.find((x) => x.id === (q.params as { id: string }).id);
    return p ?? r.code(404).send({ error: 'not_found' });
  });

  app.post('/api/v1/models/catalog/refresh', async (q, r) => {
    if (!requireAdmin(q, r)) return;
    try { const c = await L.refreshCatalog(); return { fetched_at: c.fetched_at, providers: c.providers.length }; }
    catch (e) { return r.code(502).send({ error: 'catalog_unavailable', detail: String((e as Error).message).slice(0, 200) }); }     // 旧目录、已保存的配置和界面里的草稿都还在
  });

  app.post('/api/v1/models/publish', async (q, r) => {
    if (!requireAdmin(q, r)) return;
    const b = (q.body ?? {}) as Partial<L.PublishInput>;
    if (typeof b.base_version !== 'number' || !b.config) return r.code(400).send({ error: 'base_version and config are required' });
    try {
      const out = await L.publish({ base_version: b.base_version, submit_id: b.submit_id, config: b.config, new_secrets: b.new_secrets, note: b.note, author: roleOf(q).admin ? 'admin' : 'viewer' });
      return { ...(await state()), replay: out.replay };
    } catch (e) {
      if (e instanceof L.ConflictError) { const s = await L.snapshot(true); return r.code(409).send({ error: 'conflict', version: s.version, config: s.config }); }
      return r.code(422).send({ error: String((e as Error).message) });
    }
  });

  app.get('/api/v1/models/versions', async (q, r) => { if (!requireAdmin(q, r)) return; return L.history(); });

  app.post('/api/v1/models/rollback', async (q, r) => {
    if (!requireAdmin(q, r)) return;
    const v = Number((q.body as { version?: number })?.version);
    try { const out = await L.rollback(v, 'admin'); return { ...(await state()), dropped_credentials: out.dropped }; }
    catch (e) { return r.code(422).send({ error: String((e as Error).message) }); }
  });

  // 测试用的是已发布的配置：界面上有没保存的改动时不让测，免得测的和看到的不是一回事
  app.post('/api/v1/models/test', async (q, r) => {
    if (!requireAdmin(q, r)) return;
    const b = (q.body ?? {}) as { target_id?: string; credential_id?: string; capability?: L.TestCapability };
    if (!b.target_id) return r.code(400).send({ error: 'target_id is required' });
    if (testing >= 3 || Date.now() - lastTest < 300) return r.code(429).send({ error: 'too_many_tests' });
    testing++; lastTest = Date.now();
    try { return await L.testTarget(b.target_id, { credential_id: b.credential_id, capability: b.capability }); }
    catch (e) { return r.code(422).send({ error: String((e as Error).message) }); }
    finally { testing--; }
  });

  // 路由预览：某一类请求会按什么顺序试哪些目标、每个被跳过的目标为什么被跳过。不发任何真实请求。传 config 时预览的是草稿
  app.post('/api/v1/models/preview', async (q, r) => {
    if (!requireAdmin(q, r)) return;
    const b = (q.body ?? {}) as { config?: L.LlmConfig; use?: L.Use; vision?: boolean };
    let cfg: L.LlmConfig;
    try { cfg = b.config ? L.normalizeConfig(b.config) : (await L.snapshot()).config; } catch (e) { return r.code(422).send({ error: String((e as Error).message) }); }
    const one = (use: L.Use) => { const c = L.candidates(cfg, use, { vision: b.vision }, b.config ? new Map() : L.health); return { use, eligible: c.eligible.map((t) => t.model.id), skipped: c.skipped.filter((s) => s.reason !== 'wrong_kind' && s.reason !== 'not_in_group').map((s) => ({ id: s.target.model.id, reason: s.reason })) }; };
    if (b.use) return one(b.use);
    return { routes: L.USES.map(one), diff: b.config ? L.diffConfig((await L.snapshot()).config, cfg) : null };
  });

  // OpenAI 兼容入口：POST /api/v1/llm/<step|think|locate>/v1/chat/completions（示例产品与外部脚本用）
  app.post('/api/v1/llm/*', async (q, r) => {
    if (!requireAdmin(q, r)) return;                       // 这个入口花的是真钱：只给管理员（命令行与示例产品带的就是管理员口令）
    const res = await L.handleProxy(`/${(q.params as { '*': string })['*']}`, JSON.stringify(q.body ?? {}), { purpose: 'proxy' });
    r.code(res.status).header('content-type', res.headers.get('content-type') ?? 'application/json');
    return r.send(res.body ? Readable.fromWeb(res.body as never) : '');
  });
}
