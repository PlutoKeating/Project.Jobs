// Jobs Agent 在 API 进程里：一个 AgentHub，飞书、网页聊天面板、jobsworld chat 共用。
// 网页和命令行：POST /agent/send 返回这一轮的事件流（SSE）；GET /agent/stream 订阅后台等到的结果这类主动消息。
// 会话键：网页与命令行共用 local:<角色>（同一个口令就是同一个人）；飞书的会话由飞书渠道自己起键（feishu:…），管理员在网页上也能看、能接着聊。
import { EventEmitter } from 'node:events';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AgentHub, DbStore, type Actor, type AgentOut, type Channel, type HubDeps, type Out } from '@pux/agent';
import { publicUrl } from '@pux/engine/mail/settings';
import { roleOf } from './auth.ts';
import { internalApi, type Role } from './internal.ts';

/** 渠道为自己的会话提供「主动消息」出口（后台等到结果时往哪里说） */
type Proactive = NonNullable<HubDeps['proactive']>;
const proactives: { prefix: string; fn: Proactive }[] = [];
export const registerProactive = (prefix: string, fn: Proactive) => { proactives.push({ prefix, fn }); };

/** 网页与命令行的会话事件（后台消息）：每个会话一个频道 */
const bus = new EventEmitter(); bus.setMaxListeners(100);
const lastActor = new Map<string, Actor>();

let hub: AgentHub | undefined;
export function agentHub(app: FastifyInstance): AgentHub {
  if (hub) return hub;
  hub = new AgentHub({
    store: new DbStore(),
    apiFor: (role: Role) => internalApi(app, role),
    base: () => publicUrl(),
    chatResident: async (persona_id, message, history) => {
      const o = await internalApi(app, 'viewer')<{ reply?: string; name?: string; error?: string }>('/world/chat', { body: { persona_id, message, history } });
      if (!o.reply) throw new Error(o.error ?? '没有回答');
      return { reply: o.reply, name: o.name ?? '' };
    },
    proactive: (session) => {
      for (const p of proactives) if (session.startsWith(p.prefix)) return p.fn(session);
      const actor = lastActor.get(session); if (!actor) return undefined;
      return { out: (e: AgentOut) => { bus.emit(session, e); }, channel: session.startsWith('local:') ? 'web' : 'cli', actor };
    },
  });
  return hub;
}

const sse = (r: FastifyReply) => {
  r.hijack();
  r.raw.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  const ping = setInterval(() => { r.raw.write(': ping\n\n'); }, 20_000);
  return { send: (e: unknown) => { r.raw.write(`data: ${JSON.stringify(e)}\n\n`); }, close: () => { clearInterval(ping); r.raw.end(); }, raw: r.raw };
};

const roleIn = (q: FastifyRequest): Role => (roleOf(q).admin ? 'admin' : 'viewer');
/** 这个人能不能碰这条会话：自己的 local 会话；管理员能看全部 */
const canUse = (q: FastifyRequest, session: string) => roleOf(q).admin || session === `local:${roleIn(q)}`;

export function agentRoutes(app: FastifyInstance) {
  const h = agentHub(app);

  app.post('/api/v1/agent/send', async (q, r) => {
    const b = (q.body ?? {}) as { text?: string; images?: { data: string; mime: string }[]; session?: string; client?: 'web' | 'cli' };
    const role = roleIn(q); const session = b.session ?? `local:${role}`;
    if (!canUse(q, session)) return r.code(403).send({ error: 'admin_required' });
    if (!b.text?.trim() && !b.images?.length) return r.code(400).send({ error: 'text_required' });
    const channel: Channel = session.startsWith('feishu:') ? 'feishu' : b.client === 'cli' ? 'cli' : 'web';
    const actor: Actor = { id: `${channel}:${role}`, name: channel === 'cli' ? '终端' : '网页', role };
    lastActor.set(session, actor);
    const s = sse(r);
    let done = false; const finish = () => { if (!done) { done = true; s.close(); } };
    const out: Out = (e) => { if (done) return; s.send(e); if (e.type === 'end') finish(); };
    s.send({ type: 'session', session });
    try {
      const how = await h.send({ session, channel: channel === 'feishu' ? 'web' : channel, actor, input: { text: b.text ?? '', images: b.images }, out });
      // 插进了正在跑的一轮：输出会到原来那条流上，这里说一声就结束（排队的会在轮到时接着用这条流）
      if (how === 'steered') { s.send({ type: 'end', text: '', steered: true }); finish(); }
    } catch (e) { s.send({ type: 'end', text: '', error: String((e as Error).message).slice(0, 300) }); finish(); }
  });

  /** 主动消息：后台等到结果、确认后的执行结果 */
  app.get('/api/v1/agent/stream', async (q, r) => {
    const session = (q.query as { session?: string }).session ?? `local:${roleIn(q)}`;
    if (!canUse(q, session)) return r.code(403).send({ error: 'admin_required' });
    const s = sse(r);
    const on = (e: AgentOut) => s.send(e);
    bus.on(session, on);
    s.raw.on('close', () => { bus.off(session, on); s.close(); });
  });

  app.post('/api/v1/agent/stop', async (q, r) => {
    const session = (q.body as { session?: string } | undefined)?.session ?? `local:${roleIn(q)}`;
    if (!canUse(q, session)) return r.code(403).send({ error: 'admin_required' });
    return { stopped: h.stop(session) };
  });

  app.post('/api/v1/agent/actions/:id', async (q) => {
    const role = roleIn(q); const approve = (q.body as { approve?: boolean } | undefined)?.approve !== false;
    return h.decide((q.params as { id: string }).id, approve, { id: `web:${role}`, name: '网页', role });
  });

  app.get('/api/v1/agent/sessions', async (q) => {
    const store = new DbStore();
    const rows = roleOf(q).admin ? await store.list('', 40) : await store.list(`local:${roleIn(q)}`, 1);
    return rows.map((x) => ({ id: x.id, channel: x.channel, title: x.title, updated_at: x.updated_at, tokens: x.tokens, cost_usd: Math.round(x.cost_usd * 1000) / 1000, busy: h.busy(x.id) }));
  });

  app.get('/api/v1/agent/sessions/:id', async (q, r) => {
    const id = (q.params as { id: string }).id;
    if (!canUse(q, id)) return r.code(403).send({ error: 'admin_required' });
    const row = await new DbStore().load(id);
    if (!row) return { id, title: null, summary: null, mode: null, items: [], busy: h.busy(id) };
    return { id, title: row.title, summary: row.summary, mode: row.mode?.resident ? { resident: { persona_id: row.mode.resident.persona_id, name: row.mode.resident.name, history: row.mode.resident.history } } : null, items: transcript(row.messages as never[]), busy: h.busy(id), cost_usd: Math.round(row.cost_usd * 1000) / 1000 };
  });
}

/** 存下来的消息 → 给界面看的条目：用户的话、Jobs 的话、做过的步骤 */
export function transcript(messages: { role: string; content: unknown; toolName?: string; isError?: boolean; timestamp?: number }[]) {
  const items: ({ kind: 'user' | 'assistant'; text: string; at?: number } | { kind: 'step'; tool: string; error: boolean; at?: number })[] = [];
  let skipAck = false;
  for (const m of messages) {
    const c = m.content as string | { type: string; text?: string }[];
    const text = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((x) => x.type === 'text').map((x) => x.text ?? '').join('') : '';
    if (m.role === 'user' && /^\[记录\]/.test(text)) { skipAck = true; continue; }
    if (m.role === 'assistant' && skipAck) { skipAck = false; continue; }
    skipAck = false;
    if (m.role === 'user') { if (/^\[系统消息/.test(text)) continue; items.push({ kind: 'user', text: text + (Array.isArray(c) && c.some((x) => x.type === 'image') ? ' 🖼' : ''), at: m.timestamp }); }
    else if (m.role === 'assistant') { if (text.trim()) items.push({ kind: 'assistant', text, at: m.timestamp }); }
    else if (m.role === 'toolResult') items.push({ kind: 'step', tool: m.toolName ?? '', error: !!m.isError, at: m.timestamp });
  }
  return items;
}
