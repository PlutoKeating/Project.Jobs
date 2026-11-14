// 配置的发布与生效：每次发布是一个不可变的完整版本；运行实例定期核对版本号，换上新快照并报告自己用的是哪一版。
//   编辑草稿（界面内存）→ 提交（带编辑起点的版本）→ 同一事务内核对版本、写入新凭证、写入新版本 → 各实例几秒内发现并换上 → 界面看到各实例的版本
import { hostname } from 'node:os';
import { logger, newId, sha256 } from '@pux/core';
import { desc, eq, getDb, inArray, llmConfigVersions, llmInstances, llmSecrets, lt, sql } from '@pux/db';
import { EMPTY_CONFIG, hintOf, normalizeConfig, type HealthMap, type LlmConfig } from './config.ts';
import { open, seal } from './secrets.ts';

export interface Snapshot { version: number; config: LlmConfig; loaded_at: number }
/** 实例多久核对一次版本。发布后其他实例最迟这么久换上新配置（本实例立即生效） */
export const POLL_MS = 5_000;

let snap: Snapshot | undefined;
let checkedAt = 0;
let loading: Promise<Snapshot> | undefined;
const secretCache = new Map<string, string>();
/** 这个实例里暂时被跳过的目标（t:<id>）与凭证（c:<id>）。只是近期的运行状况，不改变管理员的启停意图；换了配置版本就清空 */
export const health: HealthMap = new Map();
const instanceId = `${hostname()}:${process.pid}`;
let instanceKind = 'process';
export const setInstanceKind = (k: string) => { instanceKind = k; };

async function readLatest(): Promise<Snapshot> {
  const [row] = await getDb().select().from(llmConfigVersions).orderBy(desc(llmConfigVersions.version)).limit(1);
  return { version: row?.version ?? 0, config: row ? (row.content as LlmConfig) : EMPTY_CONFIG, loaded_at: Date.now() };
}

/** 当前快照。一次业务请求开头取一次并用到底；下一次请求再取，可能已经是新版本 */
export async function snapshot(force = false): Promise<Snapshot> {
  const now = Date.now();
  if (snap && !force && now - checkedAt < POLL_MS) return snap;
  if (loading) return loading;
  loading = (async () => {
    try {
      const [v] = await getDb().select({ v: sql<number>`coalesce(max(${llmConfigVersions.version}), 0)` }).from(llmConfigVersions);
      const latest = Number(v?.v ?? 0);
      // 只接受更新的版本：迟到的旧读取不能把旧内容填回来
      let changed = false;
      if (!snap || latest > snap.version) { const next = await readLatest(); if (!snap || next.version > snap.version) { snap = next; health.clear(); secretCache.clear(); changed = true; } }
      checkedAt = Date.now();
      if (changed) await heartbeat(true); else void heartbeat();          // 换上新版本时立刻报告，界面上的生效进度才跟得上
      return snap!;
    } finally { loading = undefined; }
  })();
  return loading;
}

let lastBeat = 0;
async function heartbeat(force = false) {
  if (!snap || (!force && Date.now() - lastBeat < 4_000)) return; lastBeat = Date.now();
  const now = Date.now();
  const cooling = [...health].filter(([, h]) => h.until > now).map(([key, h]) => ({ key, reason: h.reason, until: h.until }));
  try {
    await getDb().insert(llmInstances).values({ id: instanceId, kind: instanceKind, version: snap.version, health: cooling, seen_at: new Date() })
      .onConflictDoUpdate({ target: llmInstances.id, set: { kind: instanceKind, version: snap.version, health: cooling, seen_at: new Date() } });
  } catch (e) { logger.debug({ e }, '实例版本上报失败'); }
}

/** 正在运行的实例各自用的是哪一版（半分钟没上报的不算在线） */
export async function instances() {
  const db = getDb();
  await heartbeat(true);
  await db.delete(llmInstances).where(lt(llmInstances.seen_at, new Date(Date.now() - 10 * 60_000)));
  return (await db.select().from(llmInstances)).filter((i) => Date.now() - i.seen_at.getTime() < 30_000).map((i) => ({ id: i.id, kind: i.kind, version: i.version, health: (i.health ?? []) as { key: string; reason: string; until: number }[], seen_at: i.seen_at }));
}

/** 取凭证正文（只在真正发起调用前解密；按快照版本缓存在内存里） */
export async function secretOf(providerId: string, secretId: string): Promise<string> {
  const hit = secretCache.get(secretId); if (hit !== undefined) return hit;
  const [row] = await getDb().select().from(llmSecrets).where(eq(llmSecrets.id, secretId));
  if (!row || row.revoked_at) throw Object.assign(new Error('凭证已撤销或不存在'), { status: 401 });
  const plain = open(row.cipher, providerId);
  secretCache.set(secretId, plain);
  return plain;
}

/** 是否把每次尝试写进 llm_traces（测试里注入快照时关闭） */
export const tracing = { on: true };

export class ConflictError extends Error { constructor(public current: number) { super('配置已被别人更新'); } }

export interface PublishInput {
  /** 编辑起点的版本：线上已经不是这一版时拒绝，草稿留在界面里 */
  base_version: number;
  /** 这次提交的标识：回执丢了再提交，得到的是同一个结果 */
  submit_id?: string;
  config: LlmConfig;
  /** 新录入的凭证正文：凭证 id → 明文。只在这一次请求里出现，不进配置版本、不进日志 */
  new_secrets?: Record<string, string>;
  author?: string; note?: string;
}

/** 发布一份完整配置。全部成功或全部不发生：不会出现只存了凭证、没存模型的半截状态 */
export async function publish(input: PublishInput): Promise<{ version: number; config: LlmConfig; replay: boolean }> {
  const db = getDb();
  const out = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(7730115)`);
    if (input.submit_id) {
      const [done] = await tx.select().from(llmConfigVersions).where(eq(llmConfigVersions.submit_id, input.submit_id));
      if (done) return { version: done.version, config: done.content as LlmConfig, replay: true };
    }
    const [cur] = await tx.select().from(llmConfigVersions).orderBy(desc(llmConfigVersions.version)).limit(1);
    const current = cur?.version ?? 0;
    if (current !== input.base_version) throw new ConflictError(current);
    // 新凭证：加密后单独存放，配置里只留引用和脱敏提示
    const draft: LlmConfig = { providers: input.config.providers.map((p) => ({ ...p, credentials: p.credentials.map((c) => ({ ...c })) })), order: input.config.order };
    for (const p of draft.providers) for (const c of p.credentials) {
      const plain = input.new_secrets?.[c.id];
      if (plain === undefined) continue;
      if (!plain.trim()) throw new Error(`「${p.name}」有一个凭证是空的`);
      const sid = newId('sec');
      await tx.insert(llmSecrets).values({ id: sid, provider_id: p.id, hint: hintOf(plain), cipher: seal(plain.trim(), p.id) });
      c.secret_id = sid; c.hint = hintOf(plain);
    }
    const config = normalizeConfig(draft);
    // 引用必须还在、没被撤销、属于同一个连接（换地址不能把旧凭证带过去）
    const refs = config.providers.flatMap((p) => p.credentials.map((c) => ({ p, c })));
    const rows = refs.length ? await tx.select().from(llmSecrets).where(inArray(llmSecrets.id, refs.map((r) => r.c.secret_id))) : [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const { p, c } of refs) {
      const r = byId.get(c.secret_id);
      if (!r || r.revoked_at) throw new Error(`「${p.name}」的凭证「${c.label || c.hint}」已撤销，需要重新填写`);
      if (r.provider_id !== p.id) throw new Error(`「${p.name}」的凭证不属于这个连接`);
      c.hint = r.hint;
    }
    // 已有凭证的连接不能悄悄换地址：凭证只发给保存它时的那个地址
    const before = cur ? (cur.content as LlmConfig).providers : [];
    for (const p of config.providers) {
      const old = before.find((x) => x.id === p.id);
      const kept = old ? p.credentials.filter((c) => old.credentials.some((o) => o.secret_id === c.secret_id)) : [];
      if (old && kept.length && new URL(old.base_url.replace(/\{[a-z_]+\}/g, 'x')).host !== new URL(p.base_url.replace(/\{[a-z_]+\}/g, 'x')).host) throw new Error(`「${p.name}」换了地址：原来的凭证不会发给新地址，请删掉旧凭证后重新填写`);
    }
    // 这一版不再引用的凭证：撤销（回滚到旧版本也不会让它复活）
    const kept = new Set(refs.map((r) => r.c.secret_id));
    const prevRefs = before.flatMap((p) => p.credentials.map((c) => c.secret_id)).filter((id) => !kept.has(id));
    if (prevRefs.length) await tx.update(llmSecrets).set({ revoked_at: new Date() }).where(inArray(llmSecrets.id, prevRefs));
    const version = current + 1;
    await tx.insert(llmConfigVersions).values({ version, parent: current || null, content: config, digest: sha256(JSON.stringify(config)).slice(0, 16), submit_id: input.submit_id, author: input.author, note: input.note });
    return { version, config, replay: false };
  });
  await snapshot(true);            // 本实例立即生效；其他实例在 POLL_MS 内发现
  return out;
}

export async function history(limit = 30) {
  return (await getDb().select({ version: llmConfigVersions.version, parent: llmConfigVersions.parent, digest: llmConfigVersions.digest, author: llmConfigVersions.author, note: llmConfigVersions.note, created_at: llmConfigVersions.created_at, content: llmConfigVersions.content }).from(llmConfigVersions).orderBy(desc(llmConfigVersions.version)).limit(limit))
    .map((r) => { const c = r.content as LlmConfig; return { version: r.version, parent: r.parent, digest: r.digest, author: r.author, note: r.note, created_at: r.created_at, providers: c.providers.length, models: c.order.length }; });
}

/** 回滚 = 把旧版本的内容作为一个新版本重新发布（时间顺序完整）。旧版本里已经撤销的凭证不会回来：对应的凭证条目被去掉 */
export async function rollback(to: number, author?: string): Promise<{ version: number; config: LlmConfig; dropped: number }> {
  const db = getDb();
  const [row] = await db.select().from(llmConfigVersions).where(eq(llmConfigVersions.version, to));
  if (!row) throw new Error('没有这个版本');
  const old = row.content as LlmConfig;
  const ids = old.providers.flatMap((p) => p.credentials.map((c) => c.secret_id));
  const alive = new Set((ids.length ? await db.select().from(llmSecrets).where(inArray(llmSecrets.id, ids)) : []).filter((s) => !s.revoked_at).map((s) => s.id));
  let dropped = 0;
  const config: LlmConfig = { order: old.order, providers: old.providers.map((p) => ({ ...p, credentials: p.credentials.filter((c) => { const ok = alive.has(c.secret_id); if (!ok) dropped++; return ok; }) })) };
  const cur = await snapshot(true);
  const out = await publish({ base_version: cur.version, config, author, note: `回滚到第 ${to} 版` });
  return { version: out.version, config: out.config, dropped };
}

/** 测试用：丢掉内存里的快照 */
export const _resetStore = () => { snap = undefined; checkedAt = 0; health.clear(); secretCache.clear(); };
/** 测试用：直接放一份快照和凭证正文进来（不读数据库） */
export const _setSnapshot = (config: LlmConfig, secrets: Record<string, string> = {}, version = 1) => { tracing.on = false; snap = { version, config, loaded_at: Date.now() }; checkedAt = Date.now() + 1e12; lastBeat = Date.now() + 1e12; health.clear(); secretCache.clear(); for (const [k, v] of Object.entries(secrets)) secretCache.set(k, v); };
