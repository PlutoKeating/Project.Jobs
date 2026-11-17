// AgentHub：所有渠道（飞书、网页、命令行）共用的 Jobs Agent 调度。
// 每个会话键同一时刻最多一轮在跑：同一角色的人在它干活时又说了话 → steer 插进去；角色不同 → 排队，跑完再处理（不让访客借管理员的一轮做写操作）。
// 清零、下线先发确认卡片，用户点「确认」后由 decide() 执行（单次有效、30 分钟过期）。
// wait_for_people 在后台等：工具立刻返回，等到了再用渠道给的「主动消息」出口另起一轮告诉用户。
import { Agent, type AgentEvent, type AgentMessage, type AgentTool } from '@earendil-works/pi-agent-core';
import { logger } from '@pux/core';
import { JOBS_TOOLS, type JobsTool, type ToolApi } from '@pux/engine/launch/tools';
import { resolvePerson } from '@pux/engine/launch/tools-more';
import { systemPrompt } from './prompt.ts';
import { compactForStorage, type Store } from './store.ts';
import { JOBS_MODEL, makeStreamFn, type Converse } from './stream.ts';
import { adaptTool, conversationTools, toolsFor, type Role } from './tools.ts';

export interface Actor { id: string; name?: string; role: Role }
export interface AgentInput { text: string; images?: { data: string; mime: string }[] }
export type Channel = 'feishu' | 'web' | 'cli';
export type AgentOut =
  | { type: 'start' }
  | { type: 'text'; delta: string }
  | { type: 'step'; id: string; tool: string; label: string; status: 'running' | 'done' | 'error'; detail?: string }
  | { type: 'image'; evidence_id: string; caption?: string }
  | { type: 'confirm'; action_id: string; tool: string; label: string; text: string }
  | { type: 'mode'; resident: { persona_id: string; name: string } | null }
  | { type: 'resident'; persona_id: string; name: string; text: string }
  | { type: 'notice'; text: string }
  | { type: 'end'; text: string; error?: string; aborted?: boolean };
export type Out = (e: AgentOut) => void;

export interface SendOptions { session: string; channel: Channel; actor: Actor; input: AgentInput; out: Out; where?: string; extraTools?: AgentTool<object>[]; system?: boolean }

export interface HubDeps {
  store: Store;
  apiFor: (role: Role) => ToolApi;
  /** 网页的根地址（公网链接） */
  base: () => Promise<string>;
  converse?: Converse;
  tools?: JobsTool[];
  chatResident: (personaId: string, message: string, history: { role: 'user' | 'resident'; text: string }[]) => Promise<{ reply: string; name: string }>;
  /** 后台等到结果时往哪里说（渠道注册；没有就只存进会话） */
  proactive?: (session: string) => { out: Out; channel: Channel; actor: Actor; extraTools?: AgentTool<object>[]; where?: string } | undefined;
  /** 把旧对话压缩成摘要（默认用「归纳」组） */
  compact?: (oldText: string, prev: string | null) => Promise<string>;
  now?: () => Date;
  /** 压缩的门槛（字符数）；测试里调小 */
  compactAt?: number;
}

const EXIT = /^(结束|退出|回到\s*jobs|\/end|\/exit|end|exit|bye)$/i;
const NEW = /^(\/new|\/reset|新对话|重新开始)$/i;
const STOP = /^(\/stop|停|停止|别做了|stop)$/i;
const CONFIRM_MS = 30 * 60_000;

const userMsg = (input: AgentInput, actor: Actor, group: boolean, system = false): AgentMessage => {
  const head = system ? '' : group && actor.name ? `${actor.name}：` : '';
  const content = input.images?.length ? [{ type: 'text' as const, text: head + (input.text || '（看这张图）') }, ...input.images.map((i) => ({ type: 'image' as const, data: i.data, mimeType: i.mime }))] : head + input.text;
  return { role: 'user', content, timestamp: Date.now() } as AgentMessage;
};
const textOf = (m: AgentMessage) => { const c = (m as { content?: unknown }).content; return typeof c === 'string' ? c : Array.isArray(c) ? c.filter((x: { type: string }) => x.type === 'text').map((x: { text: string }) => x.text).join('') : ''; };

interface Job extends SendOptions { resolve: () => void }
interface Running { agent: Agent; actor: Actor; channel: Channel }

export class AgentHub {
  private running = new Map<string, Running>();
  private queues = new Map<string, Job[]>();
  private tools: JobsTool[];
  private converse: Converse;
  constructor(private d: HubDeps) {
    this.tools = d.tools ?? JOBS_TOOLS;
    this.converse = d.converse ?? (async (o) => { const { gateway } = await import('@pux/llm'); return gateway().converse('agent', { ...o, tags: { purpose: 'agent' } }); });
  }

  busy(session: string) { return this.running.has(session); }

  /** 收到一句话。返回这句话被怎么处理了：新的一轮、插进正在跑的一轮、排队、命令 */
  async send(o: SendOptions): Promise<'run' | 'steered' | 'queued' | 'command' | 'resident'> {
    const text = o.input.text.trim();
    if (!o.system && NEW.test(text)) { this.stop(o.session); await this.d.store.save({ id: o.session, channel: o.channel, messages: [], summary: null, mode: null }); o.out({ type: 'end', text: '好，重新开始。之前的对话不再算进来。' }); return 'command'; }
    if (!o.system && STOP.test(text)) { const was = this.stop(o.session); o.out({ type: 'end', text: was ? '已停止。' : '现在没有在做的事。' }); return 'command'; }
    const row = await this.d.store.load(o.session);
    if (!o.system && row?.mode?.resident) return this.resident(o, row.mode.resident);
    const run = this.running.get(o.session);
    if (run) {
      if (run.actor.role === o.actor.role && !o.system) { run.agent.steer(userMsg(o.input, o.actor, o.channel === 'feishu' && !!o.where)); o.out({ type: 'notice', text: '收到，正在做的事里一起考虑。' }); return 'steered'; }
      const q = this.queues.get(o.session) ?? []; q.push({ ...o, resolve: () => undefined }); this.queues.set(o.session, q);
      o.out({ type: 'notice', text: '前面还有一件事在做，做完马上处理这句。' });
      return 'queued';
    }
    await this.run(o);
    return 'run';
  }

  /** 停下这个会话正在跑的一轮 */
  stop(session: string): boolean { const r = this.running.get(session); if (!r) return false; r.agent.abort(); this.queues.delete(session); return true; }

  // ---------------------------------------------------------------- 跟居民聊
  private async resident(o: SendOptions, m: { persona_id: string; name: string; history: { role: 'user' | 'resident'; text: string }[] }) {
    const text = o.input.text.trim();
    if (EXIT.test(text)) {
      const row = await this.d.store.load(o.session);
      const note = m.history.length ? `（我刚才直接跟${m.name}聊了 ${Math.ceil(m.history.length / 2)} 个来回，最后几句：\n${m.history.slice(-6).map((h) => `${h.role === 'user' ? '我' : m.name}：${h.text}`).join('\n')}）` : '';
      const messages = note ? [...(row?.messages ?? []), { role: 'user', content: note, timestamp: Date.now() } as AgentMessage, { role: 'assistant', content: [{ type: 'text', text: '好的，我知道你们聊了什么。' }], api: 'jobs', provider: 'jobs', model: 'jobs-chat', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'stop', timestamp: Date.now() } as AgentMessage] : row?.messages;
      await this.d.store.save({ id: o.session, channel: o.channel, mode: null, ...(messages ? { messages } : {}) });
      o.out({ type: 'mode', resident: null }); o.out({ type: 'end', text: `回到 Jobs 了。和${m.name}的聊天我记下了。` });
      return 'resident' as const;
    }
    try {
      const r = await this.d.chatResident(m.persona_id, text, m.history);
      const history = [...m.history, { role: 'user' as const, text }, { role: 'resident' as const, text: r.reply }].slice(-30);
      await this.d.store.save({ id: o.session, channel: o.channel, mode: { resident: { ...m, history } } });
      o.out({ type: 'resident', persona_id: m.persona_id, name: m.name, text: r.reply }); o.out({ type: 'end', text: r.reply });
    } catch (e) { o.out({ type: 'end', text: '', error: `${m.name}暂时回不了话：${String((e as Error).message).slice(0, 160)}` }); }
    return 'resident' as const;
  }

  // ---------------------------------------------------------------- 确认
  /** 用户点了确认卡片上的按钮。返回给卡片显示的结果 */
  async decide(actionId: string, approve: boolean, actor: Actor): Promise<{ ok: boolean; status: string; text: string; tool?: string }> {
    const s = this.d.store; const a = await s.getAction(actionId);
    if (!a) return { ok: false, status: 'missing', text: '这张确认卡片已经失效了。' };
    if (a.status !== 'pending') return { ok: false, status: a.status, text: a.status === 'done' ? `已经确认过了：${a.result ?? ''}` : a.status === 'cancelled' ? '已经取消了。' : a.status === 'running' ? '正在执行。' : '已经失效了。', tool: a.tool };
    if (a.expires_at.getTime() < (this.d.now?.() ?? new Date()).getTime()) { await s.decideAction(a.id, 'expired'); return { ok: false, status: 'expired', text: '超过 30 分钟，已经失效。需要的话再跟我说一次。', tool: a.tool }; }
    if (actor.role !== 'admin') return { ok: false, status: 'pending', text: '只有管理员能确认这一步。', tool: a.tool };
    const t = this.tools.find((x) => x.name === a.tool);
    if (!approve) { if (await s.decideAction(a.id, 'cancelled')) await this.note(a.session_id, `（${actor.name ?? '我'}在卡片上取消了「${t?.label ?? a.tool}」。）`); return { ok: true, status: 'cancelled', text: '已取消，什么都没动。', tool: a.tool }; }
    if (!t || !(await s.decideAction(a.id, 'running'))) return { ok: false, status: 'done', text: '已经处理过了。', tool: a.tool };
    try {
      const result = await t.run(a.args, { api: this.d.apiFor('admin') });
      await s.decideAction(a.id, 'done', result);
      await this.note(a.session_id, `（${actor.name ?? '我'}在卡片上确认了「${t.label ?? t.name}」，已执行：${result}）`);
      return { ok: true, status: 'done', text: result, tool: a.tool };
    } catch (e) {
      const msg = String((e as Error).message).slice(0, 300);
      await s.decideAction(a.id, 'failed', msg);
      return { ok: false, status: 'failed', text: `没有成功：${msg}`, tool: a.tool };
    }
  }

  /** 往会话里记一笔（不触发模型）：确认结果、渠道里发生的事 */
  async note(session: string, text: string) {
    const run = this.running.get(session);
    if (run) { run.agent.steer({ role: 'user', content: text, timestamp: Date.now() } as AgentMessage); return; }
    const row = await this.d.store.load(session); if (!row) return;
    await this.d.store.save({ id: session, channel: row.channel, messages: [...row.messages, { role: 'user', content: text, timestamp: Date.now() } as AgentMessage, { role: 'assistant', content: [{ type: 'text', text: '好的。' }], api: 'jobs', provider: 'jobs', model: 'jobs-chat', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'stop', timestamp: Date.now() } as AgentMessage] });
  }

  // ---------------------------------------------------------------- 一轮
  private async run(o: SendOptions) {
    const { store } = this.d; const s = o.session;
    const agentBox: { a?: Agent } = {};
    try {
      let row = await store.load(s);
      if (!row) { await store.save({ id: s, channel: o.channel, messages: [] }); row = (await store.load(s))!; }
      row = await this.maybeCompact(row);
      const api = this.d.apiFor(o.actor.role);
      const base = await this.d.base().catch(() => '');
      const launches = await api<{ id: string; name: string; status: string; funnel: { opened: number; using_now: number } }[]>('/launches').then((ls) => ls.map((l) => ({ id: l.id, name: l.name, status: l.status, opened: l.funnel.opened, using_now: l.funnel.using_now }))).catch(() => []);
      const prompt = systemPrompt({ now: this.d.now?.() ?? new Date(), channel: o.channel, actor: o.actor, where: o.where, base, launches, summary: row.summary });
      const bgWait = (args: Record<string, unknown>) => this.backgroundWait(s, o, args, api);
      const tools: AgentTool<object>[] = [
        ...toolsFor(this.tools, o.actor.role).map((t) => adaptTool(t, api, t.name === 'wait_for_people' ? bgWait : undefined)),
        ...conversationTools({ showEvidence: (id, caption) => o.out({ type: 'image', evidence_id: id, caption }), enterResident: (person) => this.enterResident(s, o, api, person) }),
        ...(o.extraTools ?? []),
      ];
      const byName = new Map(this.tools.map((t) => [t.name, t]));
      const agent = new Agent({
        initialState: { systemPrompt: prompt, model: JOBS_MODEL, tools, messages: row.messages },
        streamFn: makeStreamFn(this.converse, (usd, tok) => void store.addCost(s, usd, tok).catch(() => undefined)),
        toolExecution: 'sequential',
        beforeToolCall: async (c) => {
          const t = byName.get(c.toolCall.name);
          if (!t?.danger) return undefined;
          const a = await store.createAction({ session_id: s, tool: t.name, args: c.args as Record<string, unknown>, actor: o.actor, expires_at: new Date((this.d.now?.() ?? new Date()).getTime() + CONFIRM_MS) });
          o.out({ type: 'confirm', action_id: a.id, tool: t.name, label: t.label ?? t.name, text: confirmText(t.name, c.args as Record<string, unknown>) });
          return { block: true, reason: '已经给用户发了确认卡片，用户点「确认」后才会执行。不要再调用这个工具；用一句话告诉用户点卡片上的确认（30 分钟内有效）。' };
        },
      });
      agentBox.a = agent;
      this.running.set(s, { agent, actor: o.actor, channel: o.channel });
      o.out({ type: 'start' });
      let full = '';
      agent.subscribe((ev: AgentEvent) => {
        if (ev.type === 'message_start' && (ev.message as { role: string }).role === 'assistant') { if (full && !full.endsWith('\n\n')) { full += '\n\n'; o.out({ type: 'text', delta: '\n\n' }); } }
        else if (ev.type === 'message_update' && ev.assistantMessageEvent.type === 'text_delta') { full += ev.assistantMessageEvent.delta; o.out({ type: 'text', delta: ev.assistantMessageEvent.delta }); }
        else if (ev.type === 'tool_execution_start') { const t = byName.get(ev.toolName); o.out({ type: 'step', id: ev.toolCallId, tool: ev.toolName, label: t?.label ?? tools.find((x) => x.name === ev.toolName)?.label ?? ev.toolName, status: 'running' }); }
        else if (ev.type === 'tool_execution_end') { const t = byName.get(ev.toolName); const err = (ev as { isError?: boolean }).isError; o.out({ type: 'step', id: ev.toolCallId, tool: ev.toolName, label: t?.label ?? tools.find((x) => x.name === ev.toolName)?.label ?? ev.toolName, status: err ? 'error' : 'done', detail: err ? textOf(((ev as { result?: { content?: unknown } }).result ?? {}) as AgentMessage).slice(0, 160) : undefined }); }
      });
      await agent.prompt(userMsg(o.input, o.actor, o.channel === 'feishu' && !!o.where, o.system));
      const msgs = compactForStorage(agent.state.messages);
      await store.save({ id: s, channel: o.channel, messages: msgs, ...(row.title ? {} : { title: (o.system ? null : o.input.text.slice(0, 40)) || null }) });
      const err = agent.state.errorMessage;
      const aborted = err === '已停止' || !!agent.signal?.aborted;
      o.out({ type: 'end', text: full.trim(), error: aborted ? undefined : err, aborted });
    } catch (e) {
      logger.warn({ err: String((e as Error).message).slice(0, 200), session: s }, 'Jobs Agent 这一轮出错');
      o.out({ type: 'end', text: '', error: String((e as Error).message).slice(0, 300) });
    } finally {
      this.running.delete(s);
      const q = this.queues.get(s); const next = q?.shift(); if (!q?.length) this.queues.delete(s);
      if (next) void this.run(next).finally(next.resolve);
    }
  }

  private async enterResident(session: string, o: SendOptions, api: ToolApi, person: string): Promise<string> {
    const p = await resolvePerson(api, person);
    await this.d.store.save({ id: session, channel: o.channel, mode: { resident: { persona_id: p.id, name: p.name, history: [] } } });
    o.out({ type: 'mode', resident: { persona_id: p.id, name: p.name } });
    return `已经切到和${p.name}（${p.age} 岁，${p.occupation}）的对话：用户接下来说的话会直接交给${p.name}，说「结束」回到你这里。用一句话告诉用户可以开始跟${p.name}说话了，不要替${p.name}回答。`;
  }

  /** wait_for_people 改成在后台等：立刻返回；等到了（最多 60 分钟）用渠道的主动消息出口另起一轮 */
  private backgroundWait(session: string, o: SendOptions, args: Record<string, unknown>, api: ToolApi): Promise<string> {
    const t = this.tools.find((x) => x.name === 'wait_for_people')!;
    void (async () => {
      let res = ''; const until = Date.now() + 60 * 60_000;
      try {
        while (Date.now() < until) { res = await t.run({ ...args, max_minutes: 15 }, { api }); if (/都结束了|没有正在进行/.test(res)) break; }
      } catch (e) { res = `等的时候出错了：${String((e as Error).message).slice(0, 200)}`; }
      const p = this.d.proactive?.(session);
      const input = { text: `[系统消息，不是用户说的] 你之前在后台等的人有结果了：\n${res}\n\n用一两句话告诉用户结果，并建议下一步（通常是取一页结论或看问题清单）。` };
      if (p) await this.send({ session, channel: p.channel, actor: p.actor, input, out: p.out, extraTools: p.extraTools, where: p.where, system: true }).catch(() => undefined);
      else await this.note(session, `（后台等的结果：${res}）`);
    })();
    return Promise.resolve('已经在后台等着了：他们用完会马上告诉用户（不用一直开着对话）。现在告诉用户这一点，可以先聊别的。');
  }

  // ---------------------------------------------------------------- 压缩
  private async maybeCompact<R extends { id: string; channel: string; messages: AgentMessage[]; summary: string | null }>(row: R): Promise<R> {
    const size = JSON.stringify(row.messages).length;
    if (size < (this.d.compactAt ?? 90_000)) return row;
    const keepChars = (this.d.compactAt ?? 90_000) / 3;
    let cut = row.messages.length; let acc = 0;
    for (let i = row.messages.length - 1; i >= 0; i--) { acc += JSON.stringify(row.messages[i]).length; if (acc > keepChars) break; cut = i; }
    while (cut > 0 && (row.messages[cut] as { role: string } | undefined)?.role !== 'user') cut--;      // 从一句用户的话开始，不切断工具调用与结果
    if (cut <= 0 || cut >= row.messages.length) return row;
    const old = row.messages.slice(0, cut).map((m) => { const r = (m as { role: string }).role; const t = textOf(m).slice(0, r === 'toolResult' ? 600 : 2000); return t ? `${r === 'user' ? '用户' : r === 'assistant' ? 'Jobs' : `工具 ${(m as { toolName?: string }).toolName ?? ''}`}：${t}` : ''; }).filter(Boolean).join('\n');
    const compact = this.d.compact ?? (async (text: string, prev: string | null) => { const { gateway } = await import('@pux/llm'); const r = await gateway().chat('agent_compact', { messages: [{ role: 'system', content: '把下面这段 Jobs 助手和用户的旧对话压缩成一份摘要，给助手以后接着聊用：用户关心哪些产品（带发布 id）、已经得出的结论和数字、做过的操作、答应过用户的事、用户的偏好。只写事实，600 字以内。' }, { role: 'user', content: `${prev ? `更早的摘要：\n${prev}\n\n` : ''}旧对话：\n${text.slice(-60_000)}` }], tags: { purpose: 'agent_compact' } }); return String(r.data); });
    try {
      const summary = await compact(old, row.summary);
      const messages = row.messages.slice(cut);
      await this.d.store.save({ id: row.id, channel: row.channel, messages, summary });
      return { ...row, messages, summary };
    } catch (e) { logger.warn({ err: String((e as Error).message).slice(0, 160) }, '压缩旧对话失败，这一轮用完整的对话'); return row; }
  }
}

function confirmText(tool: string, a: Record<string, unknown>): string {
  if (tool === 'reset_product') return `清零「${a.product}」：城里关于它的经历全部归零（使用、曝光、评论、动态、居民的记忆与信任、问题与结论），产品本身不动，此刻重新上线、花费归零。正在用它的人会被停下来。`;
  if (tool === 'remove_product') return `下线「${a.product}」：从城里拿掉，商店、广告、念头里都不再有它${a.wipe_history ? '；连同使用过程、评论、动态、居民的记忆一起删除，就像从没发布过' : '；城里的经历保留'}。`;
  return `${tool} ${JSON.stringify(a)}`;
}
