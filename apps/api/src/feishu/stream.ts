// 一张会自己长出来的回答卡（CardKit 卡片实体）：步骤与回答两个元素各自流式更新，最后整张换成定稿。
// 为什么不用 LarkChannel.stream({ card })：那条路改的是消息本身，同一条消息改到二三十次以后会静默失败；
// 卡片实体的元素更新没有这个上限，还有打字机效果。所有操作按顺序排队，sequence 严格递增。
import { answerCard, type Btn, type Card, type StepView } from './cards.ts';

/** CardKit 与消息的几个接口（测试里换成假的） */
export interface CardApi {
  create(card: Card): Promise<string>;
  send(to: { chat_id: string; reply_to?: string; in_thread?: boolean }, cardId: string): Promise<string>;
  content(cardId: string, elementId: string, text: string, seq: number): Promise<void>;
  update(cardId: string, card: Card, seq: number): Promise<void>;
  settings(cardId: string, settings: Record<string, unknown>, seq: number): Promise<void>;
}

export class AnswerStream {
  cardId = ''; messageId = '';
  private seq = 0; private q: Promise<unknown> = Promise.resolve();
  private text = ''; private steps: (StepView & { id: string })[] = [];
  private pushed = ''; private timer?: NodeJS.Timeout; private broken = false; private started?: Promise<void>;
  constructor(private api: CardApi, private to: { chat_id: string; reply_to?: string; in_thread?: boolean }, private stopValue: Record<string, unknown>, private throttleMs = 350) {}

  private run<T>(f: () => Promise<T>): Promise<T | undefined> { const p = this.q.then(f).catch(() => { this.broken = true; return undefined; }); this.q = p; return p; }
  private card(streaming: boolean, extra: { images?: string[]; error?: string; footer?: string; actions?: Btn[] } = {}) { return answerCard({ steps: this.steps, text: this.text, streaming, stopValue: this.stopValue, ...extra }); }

  /** 第一次有东西要显示时才发卡片 */
  start(): Promise<void> {
    this.started ??= (async () => { this.cardId = await this.api.create(this.card(true)); this.messageId = await this.api.send(this.to, this.cardId); })();
    return this.started;
  }
  append(delta: string) { this.text += delta; this.schedule(); }
  step(id: string, label: string, status: StepView['status'], detail?: string) {
    const i = this.steps.findIndex((s) => s.id === id); const s = { id, label, status, detail };
    if (i >= 0) this.steps[i] = s; else this.steps.push(s);
    void this.start().then(() => this.run(async () => { if (!this.broken) await this.api.content(this.cardId, 'steps', this.steps.map((x) => `${x.status === 'running' ? '⏳' : x.status === 'error' ? '⚠️' : '✓'} ${x.label}${x.detail ? `：${x.detail}` : ''}`).join('\n') || ' ', ++this.seq); }));
  }
  private schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.flush(); }, this.throttleMs);
  }
  private async flush() {
    await this.start();
    const t = this.text; if (t === this.pushed) return;
    await this.run(async () => { if (!this.broken) { await this.api.content(this.cardId, 'answer', t || '…', ++this.seq); this.pushed = t; } });
  }
  /** 定稿：关掉流式，整张换成最终的样子（步骤收成一行、回答、截图、错误、按钮；没有「停止」） */
  async finish(o: { text?: string; images?: string[]; error?: string; footer?: string; actions?: Btn[] } = {}) {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    if (o.text !== undefined && o.text.length >= this.text.length) this.text = o.text;
    await this.start();
    await this.q;
    const final = this.card(false, o);
    try { await this.api.settings(this.cardId, { config: { streaming_mode: false } }, ++this.seq); } catch { /* 十分钟后飞书也会自己关 */ }
    try { await this.api.update(this.cardId, final, ++this.seq); } catch { /* 卡片已经失效时就留着流式的样子 */ }
  }
}
