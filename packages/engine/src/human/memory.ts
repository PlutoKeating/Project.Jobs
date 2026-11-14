import { z, loadConfig, newId, type PersonaSpec, langOf } from '@pux/core';
import { and, eq, getDb, isNull, or, personaGlobalState, personaMemories, sql, vec } from '@pux/db';
import { cosine, gateway } from '@pux/llm';
import { personaBio } from './persona.ts';

export interface RecalledMemory { id: string; kind: string; content: string; valence: number; importance: number; score: number }

/** Generative Agents 式检索：相关性 × 时效性 × 重要性加权（§6.2）。记忆按 persona × app 隔离，app_id 为空的是全局记忆。 */
export async function recall(personaId: string, appId: string, query: string, simDay: number, k?: number, onlySessions?: Set<string>): Promise<RecalledMemory[]> {
  const cfg = loadConfig().memory;
  // onlySessions：测试环境被重置时，只回忆本 Study 内关于该产品的经历（全局记忆照常保留）
  const rows = (await getDb().select().from(personaMemories).where(and(eq(personaMemories.persona_id, personaId), or(eq(personaMemories.app_id, appId), isNull(personaMemories.app_id))))).filter((m) => !onlySessions || m.app_id === null || (m.source_session_id !== null && onlySessions.has(m.source_session_id)));
  if (!rows.length) return [];
  const q = await gateway().embed(query);
  const scored = rows.map((m) => {
    const emb = (m.embedding as unknown as number[] | null) ?? [];
    const rel = emb.length ? cosine(q, emb) : 0;
    const hours = Math.max(0, (simDay - m.sim_day) * 24);
    const rec = Math.pow(0.5, hours / cfg.recency_half_life_h) * m.decay;
    const score = cfg.alpha_relevance * rel + cfg.beta_recency * rec + cfg.gamma_importance * m.importance;
    return { id: m.id, kind: m.kind, content: m.content, valence: m.valence, importance: m.importance, score };
  }).sort((a, b) => b.score - a.score).slice(0, k ?? cfg.top_k);
  if (scored.length) await getDb().update(personaMemories).set({ last_recalled_at: sql`now()` }).where(sql`${personaMemories.id} in (${sql.join(scored.map((s) => sql`${s.id}`), sql`, `)})`);
  return scored;
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
});

/** 记忆整理（consolidation）：Session 结束后由 mind.slow 把经历写回 PersonaMemory（§5 第 6 步） */
export async function consolidate(opts: { persona: PersonaSpec; appId: string; appName: string; sessionId: string; studyId: string; simDay: number; simTime: string; outcome: string; endReason: string; diary: string }) {
  const lang = langOf(opts.persona.locale);
  const sys = lang === 'en'
    ? `${personaBio(opts.persona)}\n\nYou are thinking back over what just happened while using "${opts.appName}". Write memories the way this person would remember them (first person, short). Valence -1..1, importance 0..1. Trust deltas -0.5..0.5.`
    : `${personaBio(opts.persona)}\n\n你刚刚用完「${opts.appName}」，现在回想这段经历。以这个人的口吻写下会留在脑子里的记忆（第一人称、简短）。valence 取 -1..1，importance 取 0..1，信任变化取 -0.5..0.5。`;
  const user = lang === 'en'
    ? `How it ended: ${opts.outcome} (${opts.endReason}).\nWhat happened (in order):\n${opts.diary}\n\nWrite 2–6 memories (episodic experiences, beliefs about what it is good/bad at, trust events, habits formed, payment/subscription reasons). scope=app for memories about this product, global for general feelings about AI products.`
    : `结局：${opts.outcome}（${opts.endReason}）。\n经过（按时间）：\n${opts.diary}\n\n写 2–6 条记忆（经历、对它擅长/不擅长什么的看法、信任事件、形成的习惯、付费/退订原因）。关于这个产品的 scope=app，对 AI 产品整体的感受 scope=global。`;
  const r = await gateway().chat('mind_slow', { messages: [{ role: 'system', content: sys }, { role: 'user', content: user }], schema: ConsolidationSchema, schemaName: 'consolidation', tags: { study_id: opts.studyId, session_id: opts.sessionId, purpose: 'memory_consolidation' } });
  const db = getDb();
  for (const m of r.data.memories) {
    const emb = await gateway().embed(m.content, { study_id: opts.studyId, session_id: opts.sessionId, purpose: 'memory_embed' });
    await db.insert(personaMemories).values({ id: newId('mem'), persona_id: opts.persona.id, app_id: m.scope === 'app' ? opts.appId : null, kind: m.kind, content: m.content, valence: clamp(m.valence, -1, 1), importance: clamp(m.importance, 0, 1), source_session_id: opts.sessionId, embedding: emb, sim_time: opts.simTime, sim_day: opts.simDay });
  }
  const g = (await db.select().from(personaGlobalState).where(eq(personaGlobalState.persona_id, opts.persona.id)))[0];
  const appTrust = { ...(g?.app_trust ?? {}) }; appTrust[opts.appId] = clamp((appTrust[opts.appId] ?? opts.persona.psychology.trust_in_ai) + r.data.app_trust_delta, 0, 1);
  const ai = clamp((g?.ai_trust ?? opts.persona.psychology.trust_in_ai) + r.data.ai_trust_delta * 0.5, 0, 1);
  await db.insert(personaGlobalState).values({ persona_id: opts.persona.id, ai_trust: ai, app_trust: appTrust, sim_day: opts.simDay }).onConflictDoUpdate({ target: personaGlobalState.persona_id, set: { ai_trust: ai, app_trust: appTrust, sim_day: opts.simDay, updated_at: sql`now()` } });
  return { ...r.data, app_trust: appTrust[opts.appId], ai_trust: ai };
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
export { vec };
