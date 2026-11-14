// 人物记忆（ewave 记忆树，见 @pux/memory）与态度更新规则。
// 分层借鉴「海不被一朵浪改变」：身份与价值观钉住（core 分支只读）；对某个产品的态度有界可变；
// 对一类事物的全局信念要有多次独立经历指向同一方向才会动。记忆以「你想起来的事」的身份进入提示词，是信息不是指令。
import { z, loadConfig, type PersonaSpec, langOf } from '@pux/core';
import { eq, getDb, personaGlobalState, sql } from '@pux/db';
import { gateway } from '@pux/llm';
import { BRANCH, withTree, type MemoryKind, type RecalledMemory } from '@pux/memory';
import { personaBio } from './persona.ts';

export type { RecalledMemory };

/** 身份里钉住不动的部分：价值观、看法、底线、动机。一次使用经历改不了它们 */
export function coreStatements(p: PersonaSpec): string[] {
  const zh = langOf(p.locale) === 'zh'; const ps = p.psychology;
  return [
    ...ps.beliefs.map((b) => (zh ? `我一直觉得：${b}` : `I've always believed: ${b}`)),
    ...(ps.values.length ? [zh ? `我最在乎的是${ps.values.join('、')}` : `What matters most to me: ${ps.values.join(', ')}`] : []),
    ...p.behavior_policy.abandonment_rules.map((r) => (zh ? `我的底线：${r}` : `My limit: ${r}`)),
    ...(ps.motivations.length ? [zh ? `我想要的是${ps.motivations.join('、')}` : `What I want: ${ps.motivations.join(', ')}`] : []),
  ].slice(0, 8);
}

async function ensureCore(p: PersonaSpec) {
  await withTree(p.id, async (t) => {
    if (t.hasBranch(BRANCH.core)) return;
    const items: { content: string; embedding: number[] }[] = [];
    for (const content of coreStatements(p)) items.push({ content, embedding: await gateway().embed(content, { purpose: 'memory_core' }) });
    t.seedCore(items, Date.now());
  });
}

/** 检索：相关性 × 时效性 × 重要性加权。只在这个人的 core / self / life / people 和当前产品的分支里找；带出与之冲突的记忆 */
export async function recall(personaId: string, appId: string, query: string, simDay: number, k?: number, onlySessions?: Set<string>, persona?: PersonaSpec): Promise<RecalledMemory[]> {
  const cfg = loadConfig().memory;
  if (persona) await ensureCore(persona).catch(() => {});
  const q = await gateway().embed(query);
  return withTree(personaId, (t) => t.recall(q, { appId, simDay, k: k ?? cfg.top_k, weights: cfg, onlySessions }));
}

const ConsolidationSchema = z.object({
  memories: z.array(z.object({
    kind: z.enum(['episodic', 'belief', 'trust', 'habit', 'commerce']),
    content: z.string(),
    valence: z.number(),
    importance: z.number(),
    scope: z.enum(['app', 'global']),
  })),
  app_trust_delta: z.number(),
  ai_trust_delta: z.number(),
  would_return: z.boolean(),
  reason: z.string(),
  // 用完之后的事（大多数人什么也不写、什么也不说）
  store_rating: z.number(),          // 0 = 不会去评分；1–5
  store_review: z.string(),
  tell_who: z.string(),              // 会跟哪位熟人提起（名字，没有就空）
  tell_what: z.string(),
  public_post: z.string(),           // 会不会公开发一条动态（内容，不会就空）
  come_back: z.enum(['never', 'if_needed', 'soon', 'habit']),
  come_back_for: z.string(),
});

/** 一次经历最多把对某个产品的态度推动这么多 */
export const APP_TRUST_STEP_MAX = 0.15;
/** 全局信念：至少这么多次独立经历指向同一方向、且距上次改变满这么多天，才动一小步 */
export const BELIEF_MIN_EVIDENCE = 3; export const BELIEF_COOLDOWN_DAYS = 3; export const BELIEF_STEP = 0.05;

export interface Evidence { dir: 1 | -1; app_id: string; sim_day: number; session_id: string }

/**
 * 态度更新规则（纯函数）。
 * - 对这个产品的信任：有界可变，单次变化不超过 APP_TRUST_STEP_MAX；
 * - 对 AI 产品整体的信任：把这次经历记为一条证据；只有同方向证据 ≥ BELIEF_MIN_EVIDENCE 条、来自至少两个不同的产品或日子、
 *   且过了冷却期，才移动 BELIEF_STEP，并清掉用掉的证据。
 */
export function updateAttitudes(prev: { ai_trust: number; app_trust: Record<string, number>; evidence: Evidence[]; changed_day: number | null }, base: number, e: { app_id: string; session_id: string; sim_day: number; app_trust_delta: number; ai_trust_delta: number }) {
  const app_trust = { ...prev.app_trust };
  app_trust[e.app_id] = clamp((app_trust[e.app_id] ?? base) + clamp(e.app_trust_delta, -APP_TRUST_STEP_MAX, APP_TRUST_STEP_MAX), 0, 1);
  let evidence = [...prev.evidence]; let ai_trust = prev.ai_trust; let changed_day = prev.changed_day; let moved = 0;
  if (Math.abs(e.ai_trust_delta) >= 0.05 && !evidence.some((x) => x.session_id === e.session_id)) evidence.push({ dir: e.ai_trust_delta > 0 ? 1 : -1, app_id: e.app_id, sim_day: e.sim_day, session_id: e.session_id });
  evidence = evidence.slice(-12);
  for (const dir of [1, -1] as const) {
    const same = evidence.filter((x) => x.dir === dir);
    const independent = new Set(same.map((x) => `${x.app_id}|${x.sim_day}`)).size;
    const cooled = changed_day === null || e.sim_day - changed_day >= BELIEF_COOLDOWN_DAYS;
    if (same.length >= BELIEF_MIN_EVIDENCE && independent >= 2 && cooled) {
      ai_trust = clamp(ai_trust + dir * BELIEF_STEP, 0, 1); moved = dir * BELIEF_STEP; changed_day = e.sim_day;
      evidence = evidence.filter((x) => x.dir !== dir);
      break;
    }
  }
  return { ai_trust, app_trust, evidence, changed_day, moved };
}

/** 记忆整理：一次使用结束后，由 mind.slow 以这个人的口吻写下会留在脑子里的事，写进他的记忆树 */
export async function consolidate(opts: { persona: PersonaSpec; appId: string; appName: string; sessionId: string; studyId: string; simDay: number; simTime: string; outcome: string; endReason: string; diary: string; ties?: string[] }) {
  const lang = langOf(opts.persona.locale);
  const sys = lang === 'en'
    ? `${personaBio(opts.persona)}\n\nYou are thinking back over what just happened while using "${opts.appName}". Write memories the way this person would remember them (first person, short). Valence -1..1, importance 0..1. Trust deltas -0.5..0.5.`
    : `${personaBio(opts.persona)}\n\n你刚刚用完「${opts.appName}」，现在回想这段经历。以这个人的口吻写下会留在脑子里的记忆（第一人称、简短）。valence 取 -1..1，importance 取 0..1，信任变化取 -0.5..0.5。`;
  const user = lang === 'en'
    ? `How it ended: ${opts.outcome} (${opts.endReason}).\nWhat happened (in order):\n${opts.diary}\n\nWrite 2–6 memories (episodic experiences, beliefs about what it is good/bad at, trust events, habits formed, payment/subscription reasons). scope=app for memories about this product, global for general feelings about AI products.\n\nThen, what happens afterwards. In reality most people write nothing and tell no one — only when they're delighted, angry, or it happens to come up:\n- store_rating: would you rate it in the app store? 0 if you wouldn't bother; otherwise 1–5 with a short, casual line in store_review.\n- tell_who / tell_what: would you mention it to someone you know? If so pick one name from: ${(opts.ties ?? []).join(', ') || '(nobody)'} and write what you'd say; otherwise leave both empty.\n- public_post: would you post about it publicly? Write the post, or leave empty.\n- come_back: never / if_needed (when the need comes up) / soon (want to use it again in a few days) / habit (would use it regularly); come_back_for: what you'd open it for next time.`
    : `结局：${opts.outcome}（${opts.endReason}）。\n经过（按时间）：\n${opts.diary}\n\n写 2–6 条记忆（经历、对它擅长/不擅长什么的看法、信任事件、形成的习惯、付费/退订原因）。关于这个产品的 scope=app，对 AI 产品整体的感受 scope=global。\n\n再说说用完之后的事。现实里大多数人用完什么也不写、什么也不说——只有特别满意、特别生气，或者正好想跟某个人说时才会：\n- store_rating：你会不会去应用商店打分？不会就填 0；会就填 1–5，并在 store_review 写一句你会写的评论（口语、短）。\n- tell_who / tell_what：你会不会跟某位熟人提起它？会就从这些人里选一个名字：${(opts.ties ?? []).join('、') || '（没有）'}，并写你会怎么说；不会就都留空。\n- public_post：你会不会公开发一条动态说它？会就写内容，不会就留空。\n- come_back：以后还会不会再打开——never（不会了）、if_needed（哪天正好需要时）、soon（过几天还想用）、habit（会经常用）；come_back_for 写下次会为了什么事打开它。`;
  const r = await gateway().chat('mind_slow', { messages: [{ role: 'system', content: sys }, { role: 'user', content: user }], schema: ConsolidationSchema, schemaName: 'consolidation', tags: { study_id: opts.studyId, session_id: opts.sessionId, purpose: 'memory_consolidation' } });
  await ensureCore(opts.persona).catch(() => {});
  const withEmb: { m: z.infer<typeof ConsolidationSchema>['memories'][number]; emb: number[] }[] = [];
  for (const m of r.data.memories) withEmb.push({ m, emb: await gateway().embed(m.content, { study_id: opts.studyId, session_id: opts.sessionId, purpose: 'memory_embed' }) });
  const now = Date.now();
  await withTree(opts.persona.id, (t) => {
    for (const { m, emb } of withEmb) t.add(m.scope === 'app' ? BRANCH.app(opts.appId) : BRANCH.self, m.content, emb, { kind: m.kind as MemoryKind, valence: clamp(m.valence, -1, 1), importance: clamp(m.importance, 0, 1), app_id: m.scope === 'app' ? opts.appId : null, session_id: opts.sessionId, sim_day: opts.simDay, sim_time: opts.simTime, created_at: now }, { label: m.scope === 'app' ? opts.appName : undefined });
  });
  const db = getDb();
  const g = (await db.select().from(personaGlobalState).where(eq(personaGlobalState.persona_id, opts.persona.id)))[0];
  const base = opts.persona.psychology.trust_in_ai;
  const next = updateAttitudes({ ai_trust: g?.ai_trust ?? base, app_trust: g?.app_trust ?? {}, evidence: (g?.belief_evidence ?? []) as Evidence[], changed_day: g?.belief_changed_day ?? null }, base, { app_id: opts.appId, session_id: opts.sessionId, sim_day: opts.simDay, app_trust_delta: r.data.app_trust_delta, ai_trust_delta: r.data.ai_trust_delta });
  const set = { ai_trust: next.ai_trust, app_trust: next.app_trust, belief_evidence: next.evidence, belief_changed_day: next.changed_day, sim_day: opts.simDay };
  await db.insert(personaGlobalState).values({ persona_id: opts.persona.id, ...set }).onConflictDoUpdate({ target: personaGlobalState.persona_id, set: { ...set, updated_at: sql`now()` } });
  return { ...r.data, app_trust: next.app_trust[opts.appId], ai_trust: next.ai_trust, belief_moved: next.moved };
}

/** 生活里的一件事进入记忆（life 分支）：世界事件、和人的交往、两次使用之间发生的事 */
export async function rememberLife(personaId: string, content: string, o: { simDay: number; simTime?: string; valence?: number; importance?: number; kind?: 'life' | 'hearsay'; appId?: string }) {
  const emb = await gateway().embed(content, { purpose: 'memory_life' });
  await withTree(personaId, (t) => { t.add(o.kind === 'hearsay' ? BRANCH.people : BRANCH.life, content, emb, { kind: o.kind ?? 'life', valence: clamp(o.valence ?? 0, -1, 1), importance: clamp(o.importance ?? 0.3, 0, 1), app_id: o.appId ?? null, session_id: null, sim_day: o.simDay, sim_time: o.simTime ?? null, created_at: Date.now() }); });
}

/** 回访之间的生活经历（时间压缩，粗粒度，开放问题 6 的默认方案） */
export async function lifeBetween(persona: PersonaSpec, appName: string, fromDay: number, toDay: number, tags: { study_id?: string; session_id?: string }): Promise<string> {
  const lang = langOf(persona.locale);
  const r = await gateway().chat('mind_slow', { messages: [
    { role: 'system', content: personaBio(persona) },
    { role: 'user', content: lang === 'en' ? `Summarize in 2–3 sentences what plausibly happened in your life from day ${fromDay} to day ${toDay} (work, family, mood). Mention whether "${appName}" crossed your mind at all. First person, plain.` : `用 2–3 句话概括从第 ${fromDay} 天到第 ${toDay} 天你生活里大概发生了什么（工作、家庭、心情），以及期间有没有想起「${appName}」。第一人称，朴素。` },
  ], tags: { ...tags, purpose: 'life_between' } });
  return r.data as string;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : 0));
