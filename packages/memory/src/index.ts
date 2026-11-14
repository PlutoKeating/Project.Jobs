// 人物记忆：每个人一棵 ewave 树（@plutokeating/ewave，原样使用已发布的包）。
// 本文件是适配层：数据库持久化、单写者、节点上限、检索打分、旧记忆迁入都在这里，不改 ewave 本身。
import { Ewave, hashEmbedder, type EwaveOptions, type EwaveSnapshot, type Node } from '@plutokeating/ewave';
import { newId } from '@pux/core';
import { and, eq, getDb, personaMemories, personaMemoryTrees, sql } from '@pux/db';

export const MEMORY_DIM = 256;          // 向量截断到 256 维再归一化（Gemini embedding 支持前缀截断），控制每棵树的体积
export const MAX_LEAVES = 240;          // 每人最多保留的记忆条数（ewave 目前按几百节点设计）

export type MemoryKind = 'core' | 'episodic' | 'belief' | 'trust' | 'habit' | 'commerce' | 'life' | 'hearsay';
export interface MemoryMeta {
  kind: MemoryKind; valence: number; importance: number;
  app_id?: string | null; session_id?: string | null;
  sim_day: number; sim_time?: string | null; created_at: number;
}
export interface MemoryItem extends MemoryMeta { id: string; content: string; branch: string }
export interface RecalledMemory { id: string; kind: string; content: string; valence: number; importance: number; score: number; conflicts_with?: string }

export const BRANCH = { core: 'core', self: 'self', life: 'life', people: 'people', app: (appId: string) => `app:${appId}` } as const;

/** 截断并归一化向量 */
export function compact(v: readonly number[]): number[] {
  const s = v.slice(0, MEMORY_DIM); let n = 0; for (const x of s) n += x * x;
  n = Math.sqrt(n) || 1; return s.map((x) => Math.round((x / n) * 1e4) / 1e4);     // 4 位小数足够，快照体积减半以上
}
const cos = (a: readonly number[], b: readonly number[]) => { let d = 0; const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) d += a[i] * b[i]; return d; };

// 记忆内容的向量都由调用方传入；包自带的哈希向量只用于没有内容的分支标签，维度必须与记忆向量一致
const TREE_OPTS = (name?: string): EwaveOptions => ({ name, embedder: hashEmbedder({ dimensions: MEMORY_DIM }), autoSplit: false, growBranchOnFar: false });

export class MemoryTree {
  constructor(readonly personaId: string, readonly tree: Ewave<string>, public version = 0, public dirty = false) {}

  static create(personaId: string) { return new MemoryTree(personaId, new Ewave<string>(TREE_OPTS(personaId)), 0, true); }
  static from(personaId: string, snap: EwaveSnapshot<string>, version: number) { return new MemoryTree(personaId, Ewave.fromJSON<string>(snap, TREE_OPTS()), version); }

  /** 分支按 meta.key 定位：core（不可改的自我）/ self（对事物的一般看法）/ life（生活经历）/ people（听别人说的）/ app:<id>（对某个产品的经历与态度） */
  branch(key: string, label?: string): Node<string> {
    const found = this.tree.projectRoots().find((b) => b.meta.key === key);
    if (found) return found;
    this.dirty = true;
    return this.tree.addBranch({ label: label ?? key, meta: { key } });
  }
  hasBranch(key: string) { return this.tree.projectRoots().some((b) => b.meta.key === key); }
  private branchKeyOf(n: Node<string>): string { const p = n.primaryParent ? this.tree.get(n.primaryParent) : undefined; return String(p?.meta.key ?? ''); }

  leaves(): Node<string>[] { return this.tree.leaves().filter((n) => n.isValid && n.meta.kind); }

  add(branchKey: string, content: string, embedding: readonly number[], meta: MemoryMeta, opts: { label?: string; linkSimilar?: boolean } = {}): Node<string> {
    const b = this.branch(branchKey, opts.label);
    const emb = compact(embedding);
    // 与同一分支里语义相近的旧记忆连边：看法一致是支撑（+1），看法相反是冲突（-1）
    const near = opts.linkSimilar === false ? [] : this.leaves().filter((n) => n.primaryParent === b.id && n.embedding).map((n) => ({ n, c: cos(emb, n.embedding!) })).filter((x) => x.c >= 0.55).sort((a, b2) => b2.c - a.c).slice(0, 2);
    const node = this.tree.add(content, { parent: b.id, embedding: emb, text: content, sliceId: `day-${meta.sim_day}`, at: meta.created_at, meta: { ...meta } });
    for (const x of near) {
      const va = Number(x.n.meta.valence ?? 0);
      if (Math.abs(va) < 0.15 || Math.abs(meta.valence) < 0.15) continue;
      this.tree.link(node.id, x.n.id, { weight: Math.min(1, Math.max(0.05, x.c)), polarity: Math.sign(va) === Math.sign(meta.valence) ? 1 : -1, relation: Math.sign(va) === Math.sign(meta.valence) ? 'supports' : 'contradicts' });
    }
    this.dirty = true;
    this.enforceCap();
    return node;
  }

  /** 超出上限时忘掉最不重要、最久远的记忆（core 分支不会被忘） */
  enforceCap(max = MAX_LEAVES) {
    const ls = this.leaves().filter((n) => this.branchKeyOf(n) !== BRANCH.core);
    if (ls.length <= max) return 0;
    const today = Math.max(...ls.map((n) => Number(n.meta.sim_day ?? 0)));
    const keep = (n: Node<string>) => Number(n.meta.importance ?? 0.5) * 0.7 + Math.pow(0.5, (today - Number(n.meta.sim_day ?? 0)) / 14) * 0.3;
    const drop = [...ls].sort((a, b) => keep(a) - keep(b)).slice(0, ls.length - max);
    for (const n of drop) this.tree.remove(n.id);
    this.dirty = true;
    return drop.length;
  }

  /** core 分支：身份、价值观、底线。写入后锁为只读——一次经历改不动它 */
  seedCore(items: { content: string; embedding: readonly number[] }[], now: number) {
    if (this.hasBranch(BRANCH.core)) return;
    const b = this.branch(BRANCH.core, 'core');
    for (const it of items) this.tree.add(it.content, { parent: b.id, embedding: compact(it.embedding), text: it.content, sliceId: 'core', at: now, meta: { kind: 'core', valence: 0, importance: 0.9, sim_day: 0, created_at: now } satisfies MemoryMeta });
    this.tree.lock(b.id, 'read_only', { setBy: 'owner', reason: 'core identity is not changed by a single experience' });
    this.dirty = true;
  }

  /**
   * 检索：相关性 × 时效性 × 重要性（Generative Agents 式），只在 core / self / life / people 和当前产品的分支里找。
   * 被想起的记忆如果有与之冲突的记忆（-1 边），一并带出——人想起一件事时也会想起相反的经历。
   */
  recall(query: readonly number[], o: { appId?: string; simDay: number; k: number; weights: { alpha_relevance: number; beta_recency: number; gamma_importance: number; recency_half_life_h: number }; onlySessions?: Set<string> }): RecalledMemory[] {
    const q = compact(query);
    const allowed = new Set<string>([BRANCH.core, BRANCH.self, BRANCH.life, BRANCH.people, ...(o.appId ? [BRANCH.app(o.appId)] : [])]);
    const ranked = this.leaves().filter((n) => n.embedding && allowed.has(this.branchKeyOf(n)))
      .filter((n) => !o.onlySessions || !n.meta.app_id || (typeof n.meta.session_id === 'string' && o.onlySessions.has(n.meta.session_id)))
      .map((n) => {
        const hours = Math.max(0, (o.simDay - Number(n.meta.sim_day ?? 0)) * 24);
        const rec = n.meta.kind === 'core' ? 0.5 : Math.pow(0.5, hours / o.weights.recency_half_life_h);
        return { n, score: o.weights.alpha_relevance * cos(q, n.embedding!) + o.weights.beta_recency * rec + o.weights.gamma_importance * Number(n.meta.importance ?? 0.5) };
      }).sort((a, b) => b.score - a.score);
    // 几乎一样的记忆只想起一条（同一件事被记了好几遍时，不让它挤掉别的记忆）
    const picked: typeof ranked = [];
    for (const c of ranked) { if (picked.length >= o.k) break; if (!picked.some((p) => cos(p.n.embedding!, c.n.embedding!) > 0.9)) picked.push(c); }
    const scored = picked;
    const out: RecalledMemory[] = scored.map(({ n, score }) => ({ id: n.id, kind: String(n.meta.kind), content: n.text ?? '', valence: Number(n.meta.valence ?? 0), importance: Number(n.meta.importance ?? 0.5), score }));
    const seen = new Set(out.map((x) => x.id));
    for (const { n } of scored.slice(0, 3)) for (const e of this.tree.edges(n.id, { kind: 'link', direction: 'both', polarity: -1 })) {
      const other = this.tree.get(e.from === n.id ? e.to : e.from);
      if (!other || !other.isValid || seen.has(other.id) || !allowed.has(this.branchKeyOf(other))) continue;
      seen.add(other.id);
      out.push({ id: other.id, kind: String(other.meta.kind), content: other.text ?? '', valence: Number(other.meta.valence ?? 0), importance: Number(other.meta.importance ?? 0.5), score: 0, conflicts_with: n.id });
    }
    return out;
  }

  list(limit = 120): MemoryItem[] {
    return this.leaves().map((n) => ({ id: n.id, content: n.text ?? '', branch: this.branchKeyOf(n), ...(n.meta as unknown as MemoryMeta) }))
      .sort((a, b) => b.created_at - a.created_at).slice(0, limit);
  }
  stats() { const s = this.tree.stats(); return { leaves: this.leaves().length, branches: s.branches, links: s.links, conflicts: s.negativeLinks }; }
}

// ---------------------------------------------------------------- 持久化（Postgres JSONB，带版本号的乐观锁 + 进程内串行）
const locks = new Map<string, Promise<unknown>>();

export async function loadTree(personaId: string): Promise<MemoryTree | undefined> {
  const [row] = await getDb().select().from(personaMemoryTrees).where(eq(personaMemoryTrees.persona_id, personaId));
  return row ? MemoryTree.from(personaId, row.snapshot as EwaveSnapshot<string>, row.version) : undefined;
}

async function save(t: MemoryTree): Promise<boolean> {
  const snapshot = t.tree.toJSON(); const leaves = t.leaves().length; const db = getDb();
  if (t.version === 0) {
    const r = await db.insert(personaMemoryTrees).values({ persona_id: t.personaId, snapshot, leaves, version: 1 }).onConflictDoNothing().returning({ v: personaMemoryTrees.version });
    if (r.length) { t.version = 1; t.dirty = false; return true; }
    return false;
  }
  const r = await db.update(personaMemoryTrees).set({ snapshot, leaves, version: t.version + 1, updated_at: sql`now()` }).where(and(eq(personaMemoryTrees.persona_id, t.personaId), eq(personaMemoryTrees.version, t.version))).returning({ v: personaMemoryTrees.version });
  if (r.length) { t.version += 1; t.dirty = false; return true; }
  return false;
}

/**
 * 对一个人的记忆做一次读改写。同一进程内对同一个人串行；跨进程用版本号乐观锁，冲突时重读重做。
 * 首次访问时建树，并把旧表 persona_memories 里的记忆迁入（沿用原有向量）。
 */
export async function withTree<R>(personaId: string, fn: (t: MemoryTree) => Promise<R> | R): Promise<R> {
  const prev = locks.get(personaId) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const t = (await loadTree(personaId)) ?? (await importLegacy(MemoryTree.create(personaId)));
      const out = await fn(t);
      if (!t.dirty || (await save(t))) return out;
    }
    throw new Error(`记忆树写入冲突：${personaId}`);
  });
  locks.set(personaId, run);
  try { return await run; } finally { if (locks.get(personaId) === run) locks.delete(personaId); }
}

async function importLegacy(t: MemoryTree): Promise<MemoryTree> {
  const rows = await getDb().select().from(personaMemories).where(eq(personaMemories.persona_id, t.personaId));
  for (const m of rows.sort((a, b) => a.created_at.getTime() - b.created_at.getTime())) {
    const emb = m.embedding as unknown as number[] | null; if (!emb?.length) continue;
    t.add(m.app_id ? BRANCH.app(m.app_id) : BRANCH.self, m.content, emb, { kind: m.kind as MemoryKind, valence: m.valence, importance: m.importance, app_id: m.app_id, session_id: m.source_session_id, sim_day: m.sim_day, sim_time: m.sim_time, created_at: m.created_at.getTime() });
  }
  t.dirty = true;
  return t;
}

export async function listMemories(personaId: string, limit = 120): Promise<MemoryItem[]> {
  return (await loadTree(personaId))?.list(limit) ?? [];
}

/** 每个人有多少条记忆（列表页用） */
export async function memoryCounts(): Promise<Map<string, number>> {
  const rows = await getDb().select({ id: personaMemoryTrees.persona_id, n: personaMemoryTrees.leaves }).from(personaMemoryTrees);
  return new Map(rows.map((r) => [r.id, r.n]));
}

export const newMemoryId = () => newId('mem');
