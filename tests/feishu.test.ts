// 飞书渠道：卡片的样子、推送规则、谁能用、流式卡片的更新顺序，以及用模拟的飞书接口走一遍「收到消息 → Jobs Agent → 卡片」
import { describe, expect, it, vi } from 'vitest';

// 不连数据库：身份识别换成「同组织的访客」，其余规则用真的
vi.mock('../apps/api/src/feishu/access.ts', async (orig) => ({ ...(await orig<typeof import('../apps/api/src/feishu/access.ts')>()), actorOf: async () => ({ role: 'viewer', via: 'tenant', first: false }) }));
import { answerCard, boardCard, confirmCard, residentCard, welcomeCard } from '../apps/api/src/feishu/cards.ts';
import { AnswerStream, type CardApi } from '../apps/api/src/feishu/stream.ts';
import { applyPrefs, DEFAULT_PREFS, dueDigests, mergeDue, mergeText, prefsText, reportChanged, route } from '../apps/api/src/feishu/rules.ts';
import { decideRole, pairFp, passcodeRole } from '../apps/api/src/feishu/access.ts';
import { ADDONS, chatOfSession, cleanText, FeishuChannel, sessionKey } from '../apps/api/src/feishu/channel.ts';
import { reportMarkdown } from '../apps/api/src/feishu/docs.ts';
import { AgentHub, MemoryStore, type Converse } from '../packages/agent/src/index.ts';
import type { ConvRes } from '../packages/llm/src/converse.ts';

const walk = (c: unknown, f: (n: Record<string, unknown>) => void) => { if (Array.isArray(c)) c.forEach((x) => walk(x, f)); else if (c && typeof c === 'object') { f(c as Record<string, unknown>); Object.values(c).forEach((x) => walk(x, f)); } };
const values = (card: unknown) => { const v: Record<string, unknown>[] = []; walk(card, (n) => { if (n.type === 'callback' && n.value) v.push(n.value as Record<string, unknown>); }); return v; };

describe('卡片', () => {
  it('回答卡：流式时有步骤、回答、停止；定稿后步骤收成一行，没有停止', () => {
    const live = answerCard({ steps: [{ label: '看产品状况', status: 'done' }, { label: '取一页结论', status: 'running' }], text: '正在看', streaming: true, stopValue: { a: 'stop', s: 'feishu:oc_1' } });
    expect(live).toMatchObject({ schema: '2.0', config: { streaming_mode: true } });
    const ids: string[] = []; walk(live, (n) => { if (typeof n.element_id === 'string') ids.push(n.element_id); });
    expect(ids).toEqual(expect.arrayContaining(['steps', 'answer', 'stop']));
    expect(values(live)).toEqual([{ a: 'stop', s: 'feishu:oc_1' }]);
    const done = answerCard({ steps: [{ label: '看产品状况', status: 'done' }, { label: '取一页结论', status: 'done' }], text: '好', streaming: false, images: ['img_1'], error: undefined });
    expect(JSON.stringify(done)).toContain('✓ 看产品状况 · 取一页结论'); expect(JSON.stringify(done)).toContain('img_1');
    expect(values(done)).toEqual([]); expect((done.config as Record<string, unknown>).streaming_mode).toBeUndefined();
  });
  it('确认卡：两个按钮带动作 id；处理过后没有按钮，写明结果', () => {
    expect(values(confirmCard({ label: '清零', text: 'x', actionId: 'act_1' }))).toEqual([{ a: 'confirm', id: 'act_1', approve: true }, { a: 'confirm', id: 'act_1', approve: false }]);
    const d = confirmCard({ label: '清零', text: 'x', actionId: 'act_1', state: 'done', result: '已清零', by: '小王' });
    expect(values(d)).toEqual([]); expect(JSON.stringify(d)).toContain('已确认（小王）');
  });
  it('居民卡、看板卡、欢迎卡的按钮都是交给 Jobs 的一句话', () => {
    expect(values(residentCard({ name: '赵红梅', text: '我不懂', session: 'feishu:oc_1' }))).toEqual([{ a: 'end_resident', s: 'feishu:oc_1' }]);
    const b = boardCard({ id: 'l1', name: 'Quick Notes', status: 'live', intensity: 0.3, funnel: { reached: 10, noticed: 5, opened: 3, came_back: 1, using_now: 1, queued: 2, rating: null }, spend: 0.2, headline: '多数人用得下去', issues: [{ severity: 'P1', title: '保存慢' }], version: 2, updated: '12:00', url: 'https://x/s/abc' });
    expect(JSON.stringify(b)).toContain('2 人排队'); expect(JSON.stringify(b)).toContain('第 2 版'); expect(JSON.stringify(b)).toContain('https://x/s/abc');
    expect(values(b).every((v) => v.a === 'ask' && typeof v.q === 'string')).toBe(true);
    expect(JSON.stringify(welcomeCard({ role: 'viewer' }))).toContain('访客');
  });
});

describe('推送规则', () => {
  const t = Date.now();
  it('严重问题、结论、介入、修好验证实时；其余合并；关了就不说；只关心的产品', () => {
    const P = DEFAULT_PREFS;
    expect(route({ kind: 'issue_new', launch_id: 'l1', issue_id: 'i', severity: 'P0', title: 'x', ts: t }, P)).toBe('now');
    expect(route({ kind: 'issue_new', launch_id: 'l1', issue_id: 'i', severity: 'P2', title: 'x', ts: t }, P)).toBe('merge');
    expect(route({ kind: 'session_end', launch_id: 'l1', session_id: 's', persona_id: 'p', outcome: 'success', invited: false, ts: t }, P)).toBe('merge');
    expect(route({ kind: 'human', task_id: 'h', session_id: null, reason: '验证码', ts: t }, P)).toBe('now');
    expect(route({ kind: 'report', launch_id: 'l1', headline: 'h', verdict: 'mixed', people_used: 3, ts: t }, { ...P, reports: false })).toBe('drop');
    expect(route({ kind: 'session_end', launch_id: 'l1', session_id: 's', persona_id: 'p', outcome: null, invited: false, ts: t }, { ...P, merge_minutes: 0 })).toBe('drop');
    expect(route({ kind: 'human', task_id: 'h', session_id: null, reason: 'x', ts: t }, { ...P, products: ['l2'] })).toBe('now');
    expect(route({ kind: 'issue_new', launch_id: 'l1', issue_id: 'i', severity: 'P0', title: 'x', ts: t }, { ...P, products: ['l2'] })).toBe('drop');
  });
  it('结论变没变：档位或一句话变了才算', () => {
    expect(reportChanged(undefined, { headline: 'a', verdict: 'mixed' })).toBe(true);
    expect(reportChanged({ headline: '多数人用得下去。', verdict: 'works' }, { headline: '多数人用得下去', verdict: 'works' })).toBe(false);
    expect(reportChanged({ headline: 'a', verdict: 'works' }, { headline: 'a', verdict: 'mixed' })).toBe(true);
  });
  it('早报晚报：到了时刻且今天没发过；过了一个半小时不补发', () => {
    const at = (iso: string) => new Date(iso);
    expect(dueDigests(at('2026-11-17T00:35:00Z'), DEFAULT_PREFS, {})).toEqual(['morning']);            // 上海 08:35
    expect(dueDigests(at('2026-11-17T00:35:00Z'), DEFAULT_PREFS, { morning: '2026-11-17' })).toEqual([]);
    expect(dueDigests(at('2026-11-17T03:00:00Z'), DEFAULT_PREFS, {})).toEqual([]);                      // 11:00 早报过了
    expect(dueDigests(at('2026-11-17T11:05:00Z'), DEFAULT_PREFS, {})).toEqual(['evening']);            // 19:05
    expect(dueDigests(at('2026-11-17T11:05:00Z'), { ...DEFAULT_PREFS, evening: null }, {})).toEqual([]);
  });
  it('合并：窗口到了才发；按产品说几个人用完、结局分布', () => {
    expect(mergeDue([{ ts: t - 31 * 60_000 }], DEFAULT_PREFS, t)).toBe(true);
    expect(mergeDue([{ ts: t - 5 * 60_000 }], DEFAULT_PREFS, t)).toBe(false);
    const txt = mergeText([
      { kind: 'session_end', launch_id: 'l1', session_id: 'a', persona_id: 'p', outcome: 'success', invited: false, ts: t },
      { kind: 'session_end', launch_id: 'l1', session_id: 'b', persona_id: 'p', outcome: 'gave_up', invited: false, ts: t },
      { kind: 'issue_new', launch_id: 'l1', issue_id: 'i', severity: 'P2', title: '按钮太小', ts: t },
    ], new Map([['l1', 'Quick Notes']]), 30);
    expect(txt).toContain('**Quick Notes**：2 人用完（办成 1、放弃 1）；新问题：[P2] 按钮太小');
  });
  it('一句话改偏好：时刻 off 关掉，产品 all 回到全部', () => {
    const p = applyPrefs(DEFAULT_PREFS, { morning: 'off', evening: '7:30', urgent: false, merge_minutes: 0, products: ['l1'] });
    expect(p).toMatchObject({ morning: null, evening: '07:30', urgent: false, merge_minutes: 0, products: ['l1'] });
    expect(applyPrefs(p, { products: 'all' }).products).toBeNull();
    expect(prefsText(p, new Map([['l1', 'Quick Notes']]))).toContain('只关心：Quick Notes');
  });
});

describe('谁能用', () => {
  const owner = { owner: 'ou_owner', tenant_key: 't1' }; const fp = pairFp({ JW_ADMIN_PASSCODE: 'a', JW_PASSCODE: 'v' } as NodeJS.ProcessEnv);
  it('扫码的人是管理员；同组织默认访客；外人不认；配对得来的身份在口令换了之后失效；撤销的不认', () => {
    expect(decideRole({ open_id: 'ou_owner' }, owner, undefined, fp)).toEqual({ role: 'admin', via: 'owner' });
    expect(decideRole({ open_id: 'ou_x', tenant_key: 't1' }, owner, undefined, fp)).toEqual({ role: 'viewer', via: 'tenant' });
    expect(decideRole({ open_id: 'ou_x', tenant_key: 't2' }, owner, undefined, fp)).toBeNull();
    const paired = { open_id: 'ou_y', name: null, tenant_key: 't2', role: 'admin', via: 'passcode', fp, revoked: false };
    expect(decideRole({ open_id: 'ou_y', tenant_key: 't2' }, owner, paired, fp)).toEqual({ role: 'admin', via: 'passcode' });
    expect(decideRole({ open_id: 'ou_y', tenant_key: 't2' }, owner, paired, 'other')).toBeNull();
    expect(decideRole({ open_id: 'ou_z', tenant_key: 't1' }, owner, { ...paired, open_id: 'ou_z', revoked: true }, fp)).toBeNull();
  });
  it('口令配对只认口令本身；没设口令时谁说什么都不算', () => {
    const env = { JW_ADMIN_PASSCODE: 'admin-123', JW_PASSCODE: 'view-456' } as NodeJS.ProcessEnv;
    expect(passcodeRole(' admin-123 ', env)).toBe('admin'); expect(passcodeRole('view-456', env)).toBe('viewer'); expect(passcodeRole('admin', env)).toBeNull();
    expect(passcodeRole('anything', {} as NodeJS.ProcessEnv)).toBeNull();
  });
});

describe('会话键与扫码追加的权限', () => {
  it('私聊、群一条；话题各一条；@ 占位去掉', () => {
    expect(sessionKey('oc_1')).toBe('feishu:oc_1'); expect(sessionKey('oc_1', 'omt_9')).toBe('feishu:oc_1:omt_9');
    expect(chatOfSession('feishu:oc_1:omt_9')).toEqual({ chat_id: 'oc_1', thread: 'omt_9' });
    expect(cleanText('@_user_1  Quick Notes 怎么样')).toBe('Quick Notes 怎么样');
  });
  it('卡片回调、图片文件、CardKit、加急、云文档都在追加的清单里', () => {
    expect(ADDONS.callbacks?.items).toContain('card.action.trigger');
    for (const s of ['im:resource', 'cardkit:card:write', 'im:message.urgent', 'docx:document', 'drive:drive']) expect(ADDONS.scopes?.tenant).toContain(s);
    expect(ADDONS.events?.items?.tenant).toContain('im.chat.member.bot.added_v1');
  });
});

/** 记下每一次调用的假 CardKit */
function fakeCards() {
  const log: { op: string; card?: string; el?: string; text?: string; seq?: number; body?: unknown }[] = []; let n = 0;
  const api: CardApi = {
    create: async (card) => { n++; log.push({ op: 'create', card: `c${n}`, body: card }); return `c${n}`; },
    send: async (to, cardId) => { log.push({ op: 'send', card: cardId, body: to }); return `m_${cardId}`; },
    content: async (cardId, el, text, seq) => { log.push({ op: 'content', card: cardId, el, text, seq }); },
    update: async (cardId, card, seq) => { log.push({ op: 'update', card: cardId, body: card, seq }); },
    settings: async (cardId, s, seq) => { log.push({ op: 'settings', card: cardId, body: s, seq }); },
  };
  return { api, log };
}

describe('流式回答卡', () => {
  it('先发卡片；步骤与文字分别更新；sequence 严格递增；定稿时关流式、整张换掉', async () => {
    const { api, log } = fakeCards();
    const s = new AnswerStream(api, { chat_id: 'oc_1', reply_to: 'om_1' }, { a: 'stop', s: 'feishu:oc_1' }, 10);
    await s.start();
    s.step('t1', '看产品状况', 'running'); s.append('有 3 '); s.append('个人用过。'); s.step('t1', '看产品状况', 'done');
    await new Promise((r) => setTimeout(r, 40));
    await s.finish({ text: '有 3 个人用过。', images: ['img_9'] });
    expect(log[0].op).toBe('create'); expect(log[1]).toMatchObject({ op: 'send', body: { chat_id: 'oc_1', reply_to: 'om_1' } });
    expect(log.filter((x) => x.op === 'content' && x.el === 'answer').at(-1)?.text).toBe('有 3 个人用过。');
    expect(log.filter((x) => x.op === 'content' && x.el === 'steps').at(-1)?.text).toBe('✓ 看产品状况');
    const seqs = log.filter((x) => x.seq !== undefined).map((x) => x.seq!);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b)); expect(new Set(seqs).size).toBe(seqs.length);
    expect(log.at(-2)).toMatchObject({ op: 'settings', body: { config: { streaming_mode: false } } });
    expect(JSON.stringify(log.at(-1)?.body)).toContain('img_9');
  });
  it('元素更新失败（例如流式已过期）：不再逐字更新，定稿时仍然整张换掉', async () => {
    const { api, log } = fakeCards(); api.content = async () => { throw new Error('streaming closed'); };
    const s = new AnswerStream(api, { chat_id: 'oc_1' }, {}, 5);
    s.append('a'); await new Promise((r) => setTimeout(r, 20)); s.append('b');
    await s.finish({ text: 'ab' });
    expect(JSON.stringify(log.at(-1)?.body)).toContain('"content":"ab"');
  });
});

describe('收到消息 → Jobs Agent → 卡片（模拟的飞书）', () => {
  it('同组织的访客：回答卡流式出来，访客看不到写操作的工具', async () => {
    const seen: string[][] = [];
    const converse: Converse = async (o) => { seen.push(o.tools.map((t) => t.name)); const r: ConvRes = { text: '城里现在 199 人。', tool_calls: [], finish: 'stop', usage: { prompt: 1, completion: 1, reasoning: 0 } }; o.onEvent({ type: 'text', delta: r.text }); return r; };
    const hub = new AgentHub({ store: new MemoryStore(), apiFor: () => (async () => []) as never, base: async () => 'https://jobs.example', converse, chatResident: async () => ({ reply: '', name: '' }) });
    const { api, log } = fakeCards();
    const fs = new FeishuChannel({} as never, hub);
    const sent: unknown[] = [];
    Object.defineProperty(fs, 'cardApi', { get: () => api });
    fs.saved = { app_id: 'cli_x', secret: '', owner: 'ou_owner', tenant_key: 't1', connected_at: '' };
    fs.ch = { rawClient: { im: { v1: { message: { create: async (x: unknown) => { sent.push(x); return { data: { message_id: 'om_w' } }; } } } } }, addReaction: async () => '' } as never;
    await (fs as unknown as { onMessage: (m: unknown) => Promise<void> }).onMessage({ messageId: 'om_1', chatId: 'oc_1', chatType: 'p2p', senderId: 'ou_v', senderName: '小李', content: '城里现在怎么样', rawContentType: 'text', resources: [], mentions: [], mentionAll: false, mentionedBot: false, createTime: Date.now(), raw: { header: { tenant_key: 't1' } } });
    await new Promise((r) => setTimeout(r, 600));
    expect(seen[0]).not.toContain('publish_product'); expect(seen[0]).toContain('product_status');
    const finalCard = log.filter((x) => x.op === 'update').at(-1)?.body;
    expect(JSON.stringify(finalCard)).toContain('城里现在 199 人。');
  });
});

describe('云文档', () => {
  it('一页结论 → Markdown：标题、结论、原话、问题与复现、模拟标注', () => {
    const r = { verdict: 'mixed', headline: '有人行有人不行', summary: '老人看不清', hurts: [{ text: '字太小', moments: [{ persona: '赵红梅', who: '67 岁', quote: '看不清', session_id: 's1', step_idx: 2 }], passersby: [] }], delights: [], who_stays: [], who_leaves: [], why_not_opened: [], next: '把字调大', funnel: { reached: 9, noticed: 5, interested: 4, opened: 3, came_back: 1, using_now: 0, sessions: 3, reviews: 0, rating: null }, people_used: 3 };
    const eng = { experienced: [{ id: 'i1', severity: 'P1', title: '字太小', description: '正文 11px', where: '/', people: 2, reproduced: true, steps: ['open'] }], appendix: [] };
    const md = reportMarkdown({ name: 'Q', tagline: 't', url: 'https://q' }, r as never, eng as never, (p) => `https://jobs${p}`);
    expect(md).toContain('# Q：有人行有人不行'); expect(md).toContain('「看不清」 [这次使用](https://jobs/sessions/s1)'); expect(md).toContain('[P1] 字太小'); expect(md).toContain('模拟'); expect(md).toContain('## 如果只改一件事');
  });
});
