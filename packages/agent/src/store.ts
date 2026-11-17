// 会话的存取：一条长期对话一行（agent_sessions）；等确认的动作（agent_actions）。
// 测试用内存实现，运行时用 Postgres。存之前把旧消息里的图片换成占位、把很长的工具结果截短，压缩由 hub 决定什么时候做。
import { newId } from '@pux/core';
import { agentActions, agentSessions, and, desc, eq, getDb, sql } from '@pux/db';
import type { AgentMessage } from '@earendil-works/pi-agent-core';

export interface ResidentMode { persona_id: string; name: string; history: { role: 'user' | 'resident'; text: string }[] }
export interface SessionRow { id: string; channel: string; title: string | null; messages: AgentMessage[]; summary: string | null; mode: { resident?: ResidentMode } | null; tokens: number; cost_usd: number; updated_at: Date }
export interface ActionRow { id: string; session_id: string; tool: string; args: Record<string, unknown>; actor: { id: string; name?: string; role: 'admin' | 'viewer' }; status: string; result: string | null; message_ref: string | null; expires_at: Date }

export interface Store {
  load(id: string): Promise<SessionRow | undefined>;
  save(row: Pick<SessionRow, 'id' | 'channel'> & Partial<SessionRow>): Promise<void>;
  addCost(id: string, usd: number, tokens: number): Promise<void>;
  list(channelPrefix?: string, limit?: number): Promise<Pick<SessionRow, 'id' | 'channel' | 'title' | 'updated_at' | 'tokens' | 'cost_usd'>[]>;
  createAction(a: Omit<ActionRow, 'id' | 'status' | 'result' | 'message_ref'>): Promise<ActionRow>;
  getAction(id: string): Promise<ActionRow | undefined>;
  /** 只有还在等的动作才能改状态（单次有效）：返回 false 表示已经被处理过了 */
  decideAction(id: string, status: 'done' | 'failed' | 'cancelled' | 'expired' | 'running', result?: string): Promise<boolean>;
  setActionRef(id: string, ref: string): Promise<void>;
}

/** 存之前的整理：只有最近两条带图的用户消息保留图片；旧的工具结果截到 4000 字 */
export function compactForStorage(messages: AgentMessage[]): AgentMessage[] {
  const ms = messages.filter((m) => (m as { role: string }).role !== 'system');
  let keepImages = 2; const out: AgentMessage[] = [];
  for (let i = ms.length - 1; i >= 0; i--) {
    const m = ms[i] as { role: string; content: unknown };
    if (m.role === 'user' && Array.isArray(m.content) && m.content.some((c: { type: string }) => c.type === 'image')) {
      if (keepImages > 0) keepImages--;
      else { out.unshift({ ...m, content: m.content.map((c: { type: string }) => (c.type === 'image' ? { type: 'text', text: '[图片]' } : c)) } as AgentMessage); continue; }
    }
    if (m.role === 'toolResult' && Array.isArray(m.content) && i < ms.length - 6) {
      out.unshift({ ...m, content: m.content.map((c: { type: string; text?: string }) => (c.type === 'text' && (c.text?.length ?? 0) > 4000 ? { ...c, text: `${c.text!.slice(0, 4000)}…（截短）` } : c.type === 'image' ? { type: 'text', text: '[图片]' } : c)) } as AgentMessage); continue;
    }
    out.unshift(ms[i]);
  }
  return out;
}

export class MemoryStore implements Store {
  sessions = new Map<string, SessionRow>(); actions = new Map<string, ActionRow>();
  async load(id: string) { const s = this.sessions.get(id); return s ? { ...s, messages: [...s.messages] } : undefined; }
  async save(row: Pick<SessionRow, 'id' | 'channel'> & Partial<SessionRow>) { const cur = this.sessions.get(row.id); this.sessions.set(row.id, { title: null, messages: [], summary: null, mode: null, tokens: 0, cost_usd: 0, ...cur, ...row, updated_at: new Date() } as SessionRow); }
  async addCost(id: string, usd: number, tokens: number) { const s = this.sessions.get(id); if (s) { s.cost_usd += usd; s.tokens += tokens; } }
  async list(prefix = '') { return [...this.sessions.values()].filter((s) => s.id.startsWith(prefix)).sort((a, b) => b.updated_at.getTime() - a.updated_at.getTime()); }
  async createAction(a: Omit<ActionRow, 'id' | 'status' | 'result' | 'message_ref'>) { const r: ActionRow = { ...a, id: newId('act'), status: 'pending', result: null, message_ref: null }; this.actions.set(r.id, r); return r; }
  async getAction(id: string) { return this.actions.get(id); }
  async decideAction(id: string, status: ActionRow['status'], result?: string) { const a = this.actions.get(id); if (!a || (a.status !== 'pending' && !(a.status === 'running' && status !== 'running'))) return false; a.status = status; a.result = result ?? a.result; return true; }
  async setActionRef(id: string, ref: string) { const a = this.actions.get(id); if (a) a.message_ref = ref; }
}

export class DbStore implements Store {
  async load(id: string) {
    const [r] = await getDb().select().from(agentSessions).where(eq(agentSessions.id, id));
    return r ? { id: r.id, channel: r.channel, title: r.title, messages: (r.messages ?? []) as AgentMessage[], summary: r.summary, mode: r.mode as SessionRow['mode'], tokens: r.tokens, cost_usd: r.cost_usd, updated_at: r.updated_at } : undefined;
  }
  async save(row: Pick<SessionRow, 'id' | 'channel'> & Partial<SessionRow>) {
    const set: Record<string, unknown> = { updated_at: new Date() };
    for (const k of ['title', 'messages', 'summary', 'mode'] as const) if (row[k] !== undefined) set[k] = row[k];
    await getDb().insert(agentSessions).values({ id: row.id, channel: row.channel, title: row.title ?? null, messages: (row.messages ?? []) as unknown[], summary: row.summary ?? null, mode: (row.mode ?? null) as never }).onConflictDoUpdate({ target: agentSessions.id, set });
  }
  async addCost(id: string, usd: number, tokens: number) { await getDb().update(agentSessions).set({ cost_usd: sql`${agentSessions.cost_usd} + ${usd}`, tokens: sql`${agentSessions.tokens} + ${tokens}` }).where(eq(agentSessions.id, id)); }
  async list(prefix = '', limit = 30) {
    const rows = await getDb().select({ id: agentSessions.id, channel: agentSessions.channel, title: agentSessions.title, updated_at: agentSessions.updated_at, tokens: agentSessions.tokens, cost_usd: agentSessions.cost_usd }).from(agentSessions).where(sql`${agentSessions.id} like ${`${prefix}%`}`).orderBy(desc(agentSessions.updated_at)).limit(limit);
    return rows;
  }
  async createAction(a: Omit<ActionRow, 'id' | 'status' | 'result' | 'message_ref'>) {
    const [r] = await getDb().insert(agentActions).values({ id: newId('act'), session_id: a.session_id, tool: a.tool, args: a.args, actor: a.actor, expires_at: a.expires_at }).returning();
    return { ...r, args: r.args as Record<string, unknown> } as ActionRow;
  }
  async getAction(id: string) { const [r] = await getDb().select().from(agentActions).where(eq(agentActions.id, id)); return r ? ({ ...r, args: r.args as Record<string, unknown> } as ActionRow) : undefined; }
  async decideAction(id: string, status: ActionRow['status'], result?: string) {
    const from = status === 'running' ? 'pending' : undefined;
    const rows = await getDb().update(agentActions).set({ status, ...(result !== undefined ? { result } : {}), decided_at: new Date() }).where(and(eq(agentActions.id, id), from ? eq(agentActions.status, from) : sql`${agentActions.status} in ('pending','running')`)).returning({ id: agentActions.id });
    return rows.length > 0;
  }
  async setActionRef(id: string, ref: string) { await getDb().update(agentActions).set({ message_ref: ref }).where(eq(agentActions.id, id)); }
}
