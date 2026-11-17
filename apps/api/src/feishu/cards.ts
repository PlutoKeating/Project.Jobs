// 飞书卡片（JSON 2.0）的样子。纯函数，便于测试：流式回答卡、确认卡、跟居民聊的卡、看板卡、提醒卡、欢迎卡。
export type Card = Record<string, unknown>;
export type Btn = { text: string; value?: Record<string, unknown>; url?: string; type?: 'default' | 'primary' | 'danger' | 'primary_filled' | 'danger_filled' };

const md = (content: string, element_id?: string, small = false): Card => ({ tag: 'markdown', content, ...(element_id ? { element_id } : {}), ...(small ? { text_size: 'notation' } : {}) });
export const button = (b: Btn, element_id?: string): Card => ({ tag: 'button', ...(element_id ? { element_id } : {}), text: { tag: 'plain_text', content: b.text }, type: b.type ?? 'default', size: 'small', behaviors: [b.url ? { type: 'open_url', default_url: b.url } : { type: 'callback', value: b.value ?? {} }] });
/** 一排按钮（2.0 里横排要放进 column_set） */
export const buttons = (bs: Btn[], element_id?: string): Card => ({ tag: 'column_set', ...(element_id ? { element_id } : {}), flex_mode: 'flow', horizontal_spacing: '8px', columns: bs.map((b) => ({ tag: 'column', width: 'auto', elements: [button(b)] })) });
const header = (title: string, template = 'default', subtitle?: string): Card => ({ title: { tag: 'plain_text', content: title }, ...(subtitle ? { subtitle: { tag: 'plain_text', content: subtitle } } : {}), template });
const summary = (s: string) => ({ content: s.replace(/\s+/g, ' ').slice(0, 60) });
const img = (k: string): Card => ({ tag: 'img', img_key: k, alt: { tag: 'plain_text', content: '' }, scale_type: 'fit_horizontal', preview: true });

export interface StepView { label: string; status: 'running' | 'done' | 'error'; detail?: string }
export const stepsText = (steps: StepView[]) => steps.map((s) => `${s.status === 'running' ? '⏳' : s.status === 'error' ? '⚠️' : '✓'} ${s.label}${s.detail ? `：${s.detail}` : ''}`).join('\n');

/** 回答卡：上面一小行一小行是做的步骤，下面是逐字出现的回答，最下面「停止」 */
export function answerCard(o: { steps: StepView[]; text: string; streaming: boolean; stopValue?: Record<string, unknown>; images?: string[]; error?: string; footer?: string; actions?: Btn[] }): Card {
  const elements: Card[] = [];
  if (o.streaming) elements.push(md(stepsText(o.steps), 'steps', true));
  else if (o.steps.length) elements.push(md(o.steps.some((s) => s.status === 'error') ? stepsText(o.steps) : `✓ ${o.steps.map((s) => s.label).join(' · ')}`, 'steps', true));
  elements.push(md(o.text || (o.streaming ? '…' : o.error ? ' ' : '（没有回答）'), 'answer'));
  for (const k of o.images ?? []) elements.push(img(k));
  if (o.error) elements.push(md(`⚠️ ${o.error}`, 'error', true));
  if (o.footer) elements.push(md(o.footer, 'footer', true));
  if (o.actions?.length) elements.push(buttons(o.actions, 'actions'));
  if (o.streaming && o.stopValue) elements.push(button({ text: '停止', value: o.stopValue }, 'stop'));
  return { schema: '2.0', config: { update_multi: true, ...(o.streaming ? { streaming_mode: true, streaming_config: { print_frequency_ms: { default: 50 }, print_step: { default: 2 }, print_strategy: 'fast' } } : {}), summary: summary(o.text || (o.streaming ? '正在想…' : '')) }, body: { elements } };
}

/** 清零、下线前的确认 */
export function confirmCard(o: { label: string; text: string; actionId: string; state?: 'done' | 'cancelled' | 'failed' | 'expired' | 'running'; result?: string; by?: string }): Card {
  const done = !!o.state;
  const tone = o.state === 'done' ? 'green' : o.state === 'failed' ? 'red' : o.state ? 'grey' : 'red';
  const status = o.state === 'running' ? '正在执行…' : o.state === 'done' ? `已确认${o.by ? `（${o.by}）` : ''}` : o.state === 'cancelled' ? `已取消${o.by ? `（${o.by}）` : ''}` : o.state === 'expired' ? '已失效' : o.state === 'failed' ? '没有成功' : '30 分钟内有效，只能点一次';
  return {
    schema: '2.0', config: { update_multi: true, summary: summary(`要确认：${o.label}`) }, header: header(`要确认：${o.label}`, tone),
    body: { elements: [md(o.text), ...(done ? [md(`${status}${o.result ? `\n${o.result}` : ''}`, undefined, true)] : [buttons([{ text: '确认', type: 'danger_filled', value: { a: 'confirm', id: o.actionId, approve: true } }, { text: '取消', value: { a: 'confirm', id: o.actionId, approve: false } }]), md(status, undefined, true)])] },
  };
}

/** 跟居民聊：卡片头是她的名字 */
export function residentCard(o: { name: string; who?: string; text: string; session: string; first?: boolean }): Card {
  return {
    schema: '2.0', config: { update_multi: true, summary: summary(`${o.name}：${o.text}`) }, header: header(o.name, 'orange', o.who ?? '城里的居民'),
    body: { elements: [md(o.text), ...(o.first ? [md('接下来你说的话会直接交给她。说「结束」回到 Jobs。', undefined, true)] : []), buttons([{ text: '结束，回到 Jobs', value: { a: 'end_resident', s: o.session } }])] },
  };
}

/** 一句提醒（需要介入、严重问题第一次出现、结论变了、修好后的自动验证、早报晚报） */
export function alertCard(o: { title: string; text: string; tone?: 'red' | 'orange' | 'green' | 'blue' | 'grey' | 'turquoise'; images?: string[]; actions?: Btn[]; note?: string }): Card {
  return {
    schema: '2.0', config: { update_multi: true, summary: summary(o.title) }, header: header(o.title, o.tone ?? 'blue'),
    body: { elements: [md(o.text), ...(o.images ?? []).map(img), ...(o.note ? [md(o.note, undefined, true)] : []), ...(o.actions?.length ? [buttons(o.actions)] : [])] },
  };
}

export interface BoardView { id: string; name: string; status: string; intensity: number; funnel: { reached: number; noticed: number; opened: number; came_back: number; using_now: number; queued?: number; rating: number | null }; spend: number; headline?: string | null; next?: string | null; issues?: { severity: string; title: string }[]; version?: number; updated: string; url?: string }

/** 一个产品的看板卡：在原处刷新 */
export function boardCard(b: BoardView): Card {
  const f = b.funnel;
  const status = b.status === 'live' ? '上线中' : b.status === 'paused' ? '暂停' : '已结束';
  const lines = [
    `**${f.reached}** 人看到 → **${f.noticed}** 注意到 → **${f.opened}** 打开过 → **${f.came_back}** 回来再用${f.rating ? ` · 评分 ${f.rating}` : ''}`,
    f.using_now || f.queued ? `此刻 **${f.using_now}** 人在用${f.queued ? `，${f.queued} 人排队` : ''}` : '此刻没人在用',
    b.headline ? `\n**结论**：${b.headline}${b.next ? `\n如果只改一件事：${b.next}` : ''}` : '',
    b.issues?.length ? `\n**问题**\n${b.issues.slice(0, 3).map((i) => `[${i.severity}] ${i.title}`).join('\n')}` : '',
  ].filter(Boolean).join('\n');
  return {
    schema: '2.0', config: { update_multi: true, summary: summary(`${b.name}：${f.opened} 人打开过`) }, header: header(b.name, b.status === 'live' ? 'turquoise' : 'grey', `${status} · 宣发 ${Math.round(b.intensity * 100)}%${b.version && b.version > 1 ? ` · 第 ${b.version} 版` : ''}`),
    body: { elements: [md(lines), md(`人数是城里实际发生的（模拟）· 已花费约 $${b.spend} · 更新于 ${b.updated}`, undefined, true), buttons([
      { text: '看结论', value: { a: 'ask', q: `给我看「${b.name}」的一页结论，先说最该改的一件事` } },
      { text: '请 3 人试', value: { a: 'ask', q: `请 3 个人现在试试「${b.name}」，用完告诉我` } },
      { text: '问题清单', value: { a: 'ask', q: `「${b.name}」现在有哪些问题？` } },
      ...(b.url ? [{ text: '网页', url: b.url }] : []),
    ])] },
  };
}

/** 第一次见面、/help：能做什么 + 几个常用的按钮 */
export function welcomeCard(o: { role: 'admin' | 'viewer'; name?: string }): Card {
  const can = o.role === 'admin' ? '发布产品、请人试用、调宣发、看结论和问题、跟居民聊、把问题交给 coding agent' : '看产品状况、结论和问题、跟居民聊（你是访客，只能看；把管理员口令私聊发给我就能升级）';
  return {
    schema: '2.0', config: { update_multi: true, summary: summary('我是 Jobs') }, header: header('我是 Jobs', 'turquoise', '把产品发布到一座住着两百位虚拟居民的城'),
    body: { elements: [md(`${o.name ? `${o.name}，` : ''}直接跟我说话就行：${can}。\n有人撞上严重问题、结论变了、需要你介入时，我会主动告诉你。\n\n\`/new\` 重新开始 · \`/stop\` 停下 · 在群里 @ 我`), buttons([
      { text: '城里现在', value: { a: 'ask', q: '城里现在怎么样？' } }, { text: '我的产品', value: { a: 'ask', q: '我的产品现在都怎么样？' } }, { text: '待我处理', value: { a: 'ask', q: '有没有需要我处理的事？' } }, { text: '推送设置', value: { a: 'ask', q: '现在推送是怎么设置的？' } },
    ])] },
  };
}
