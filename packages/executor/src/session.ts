import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium, type Browser, type BrowserContext, type CDPSession, type Dialog, type Page, type Request } from 'playwright';
import {
  dataPath, logger, makeError, newId, shortHash,
  type ActionRequest, type ActionResult, type Criterion, type Executor, type MotorProfile, type Observation, type Rng, type TargetRef, type UIElement, type UAPError,
} from '@pux/core';
import { candidates, health, locateFamily, noModelMessage, snapshot, startLocalEndpoint } from '@pux/llm';
import { putEvidence, type EvidenceCtx } from './evidence.ts';
import { checkPolicy, type SafetyPolicy } from './policy.ts';
import { ModalityFiles } from './modality.ts';
import { EXTRACT_SCRIPT, INIT_SCRIPT, PROBE_SCRIPT } from './page-scripts.ts';
import { landingPoint, mousePath, swipePath, typingPlan, wheelPlan, type Pt } from './humanize.ts';
import { dialogLayout, drawDialog, visualDelta } from './visual.ts';

const run = promisify(execFile);
const require = createRequire(import.meta.url);
const RRWEB_SRC = (() => { try { return readFileSync(require.resolve('@rrweb/record/dist/record.umd.min.cjs'), 'utf8'); } catch { return ''; } })();
const RRWEB_BOOT = `(() => { try { if (window.__puxRr || !window.rrwebRecord) return; window.__puxRr = []; window.rrwebRecord.record({ emit(e) { window.__puxRr.push(e); if (window.__puxRr.length > 20000) window.__puxRr.splice(0, 5000); }, sampling: { mousemove: 50, scroll: 150, input: 'last' }, maskAllInputs: false, recordCanvas: false }); } catch (e) {} })();`;
const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
export const MIDSCENE_VERSION = '1.17.8';

export interface SessionOptions {
  sessionId: string; studyId?: string; personaId?: string;
  /** midscene：看截图定位（人物使用）；playwright：按选择器重放（只用于干净重放，不调用模型） */
  executor: 'midscene' | 'playwright';
  headed?: boolean;
  mobile?: boolean;
  locale?: string;
  timezone?: string;
  policy: SafetyPolicy;
  record?: { video?: boolean; rrweb?: boolean; axe?: boolean };
  rng: Rng;
  geolocation?: { latitude: number; longitude: number } | null;   // null：拒绝定位授权
  deviceStateFile?: string;   // 同一人物在同一 Study 内复用设备状态（Cookie），模拟同一台手机/电脑
}

interface NetState { inflight: Map<Request, number>; failed: { url: string; status: number; method?: string; at: number }[]; slowest: number; total: number; log: unknown[] }
type Located = { el?: UIElement; point: [number, number]; resolved: TargetRef };
type MidAgent = { aiLocate(p: string, opt?: Record<string, unknown>): Promise<{ rect: { left: number; top: number; width: number; height: number }; center: [number, number]; dpr?: number }> };

const freePort = () => new Promise<number>((res, rej) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => res(p)); }); s.on('error', rej); });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const iso = () => new Date().toISOString();
const norm = (s?: string) => (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

export function urlTemplate(u: string): string {
  try {
    const url = new URL(u);
    const path = url.pathname.split('/').map((s) => (/^\d+$/.test(s) || /^[0-9a-f-]{16,}$/i.test(s) || /^[a-z]{2,4}_[a-z0-9]{8,}$/i.test(s) ? ':id' : s)).join('/');
    const q = [...url.searchParams.keys()].sort().join('&');
    const h = url.hash ? url.hash.replace(/\d+/g, ':n').split('?')[0] : '';
    return `${url.host}${path}${q ? `?${q}` : ''}${h}`;
  } catch { return u; }
}

export function stateIdOf(url: string, elements: UIElement[], dialogOpen: boolean): string {
  const skel = elements
    .filter((e) => e.kind === 'interactive' || e.kind === 'heading')
    .map((e) => `${e.role}:${e.kind === 'heading' ? e.name.slice(0, 24) : (e.role === 'button' || e.role === 'tab' ? e.name.slice(0, 16) : '')}`)
    .sort();
  const uniq = [...new Set(skel)].join('|');
  return `st_${shortHash(`${urlTemplate(url)}#${uniq}#${dialogOpen ? 'D' : ''}`, 12)}`;
}

export const DEFAULT_MOTOR: MotorProfile = { precision: 0.9, typing_cps: 5, typo_rate: 0.01, one_handed: false, double_tap_risk: 0 };

/**
 * 借 DOM 把「人物在屏幕上看到并照抄的字」换算成落点：只有当这些字在视口内恰好对应唯一一个
 * 没被遮挡的可交互元素时才采用；否则交给 Midscene 看截图定位。只比较屏幕上渲染出来的字（vis_text）。
 */
export function matchVisibleText(els: UIElement[], text: string): UIElement | undefined {
  const t = norm(text);
  if (!t) return undefined;
  const pool = els.filter((e) => e.kind === 'interactive' && e.in_viewport && !e.occluded && !e.disabled && norm(e.vis_text));
  const exact = pool.filter((e) => norm(e.vis_text) === t);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return undefined;
  const loose = pool.filter((e) => { const v = norm(e.vis_text); return v.includes(t) && v.length <= t.length * 2 + 2; });
  return loose.length === 1 ? loose[0] : undefined;
}

/** 落点处的元素（最小的那个可交互元素），用于策略闸门、误触判断与重放记录 */
export function elementAt(els: UIElement[], x: number, y: number): UIElement | undefined {
  const hit = els.filter((e) => e.in_viewport && x >= e.bbox[0] && x <= e.bbox[0] + e.bbox[2] && y >= e.bbox[1] && y <= e.bbox[1] + e.bbox[3]);
  const inter = hit.filter((e) => e.kind === 'interactive');
  return (inter.length ? inter : hit).sort((a, b) => a.bbox[2] * a.bbox[3] - b.bbox[2] * b.bbox[3])[0];
}

/**
 * 一个 Session 的浏览器沙箱：独立浏览器进程 + BrowserContext + 证据采集。
 * 人物只通过两件事接触产品：看截图（observe）和手上的动作（act：点、滑、长按、打字、按键）。
 */
export class BrowserSession implements Executor {
  readonly name: string;
  private browser!: Browser;
  ctx!: BrowserContext;
  page!: Page;
  private cdp?: CDPSession;
  private cdpPage?: Page;
  private mid?: MidAgent;
  private midPage?: Page;
  modality: ModalityFiles;
  cdpPort = 0;
  private consoleErrors: string[] = [];
  private pageErrors: string[] = [];
  private net: NetState = { inflight: new Map(), failed: [], slowest: 0, total: 0, log: [] };
  private pendingDialog?: Dialog;
  private dialogLog: string[] = [];
  private downloads: string[] = [];
  private lastObs?: Observation & { elements: UIElement[] };
  private lastScreenshotEv = '';
  /** 最近一次页面截图（人物上一眼看到的画面），用于判断动作之后屏幕有没有肉眼可见的变化 */
  lastShot?: Buffer;
  private seenStates = new Set<string>();
  private frameDir: string;
  private frames: { file: string; t: number }[] = [];
  private frameIdx = 0;
  /** 同一个设备上开着的几个「应用」（标签页）：main 是被测产品，其余如 mail 是城里给的邮箱 */
  private tabs = new Map<string, Page>();
  tab = 'main';
  private rrEvents: unknown[] = [];
  private pointer: Pt = { x: 200, y: 200 };
  /** 上一次点偏的目标与连续次数：点偏过的人下一次会瞄得更准 */
  private lastMiss?: { key: string; n: number };
  injectedNetwork = false;
  hiddenSince?: number;
  private lastUrl = '';
  private ev: EvidenceCtx;
  private closed = false;
  axeByState = new Map<string, string>();

  private constructor(private opts: SessionOptions) {
    this.name = opts.executor;
    this.modality = new ModalityFiles(opts.sessionId);
    this.frameDir = join(this.modality.dir, 'frames');
    this.ev = { study_id: opts.studyId, session_id: opts.sessionId, persona_id: opts.personaId };
  }

  static async launch(opts: SessionOptions): Promise<BrowserSession> {
    const s = new BrowserSession(opts);
    await s.start();
    return s;
  }

  get cdpUrl() { return `http://127.0.0.1:${this.cdpPort}`; }
  get mobile() { return !!this.opts.mobile; }

  private async start() {
    const o = this.opts;
    await this.modality.prepare();
    this.cdpPort = await freePort();
    const viewport = o.mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 };
    this.browser = await chromium.launch({
      headless: !o.headed, chromiumSandbox: false,
      args: [...this.modality.launchArgs(), '--disable-features=Translate', '--lang=' + (o.locale ?? 'zh-CN'), `--remote-debugging-port=${this.cdpPort}`, '--remote-allow-origins=*'],
    });
    // 手机网页：真正的移动端上下文（移动 UA、触屏、2 倍屏），交互走触屏事件
    this.ctx = await this.browser.newContext({
      viewport, locale: o.locale ?? 'zh-CN', acceptDownloads: true,
      ...(o.mobile ? { hasTouch: true, isMobile: true, deviceScaleFactor: 2, userAgent: MOBILE_UA } : {}),
      ...(o.timezone ? { timezoneId: o.timezone } : {}),
    });
    await this.ctx.addInitScript(INIT_SCRIPT);
    if (o.record?.rrweb !== false && RRWEB_SRC) await this.ctx.addInitScript(`${RRWEB_SRC}\n;${RRWEB_BOOT}`);
    const perms = ['notifications', 'microphone', 'camera', 'clipboard-read', 'clipboard-write'];
    if (o.geolocation !== null) perms.push('geolocation');
    await this.ctx.grantPermissions(perms).catch(() => {});
    if (o.geolocation) await this.ctx.setGeolocation({ ...o.geolocation, accuracy: 50 }).catch(() => {});
    if (o.deviceStateFile && existsSync(o.deviceStateFile)) {
      try { const st = JSON.parse(readFileSync(o.deviceStateFile, 'utf8')) as { cookies: Parameters<BrowserContext['addCookies']>[0] }; await this.ctx.addCookies(st.cookies); } catch (e) { logger.debug({ e }, '设备状态恢复失败'); }
    }
    this.page = await this.ctx.newPage();
    this.attachPage(this.page);
    if (o.record?.video !== false) await this.startScreencast();
  }

  /** Midscene：只用它「看截图找到目标在哪」；动作由本类按人物的手来注入 */
  private async midAgent(): Promise<MidAgent> {
    if (this.mid && this.midPage === this.page) return this.mid;
    // Midscene 自己发请求：指到本进程的兼容入口，由它按已发布的模型配置路由到「在截图上定位」的目标。
    // 提示与坐标格式按模型家族定，所以入口地址里带上家族：这次会话里只会转发给同一家族的目标
    const { eligible, skipped } = candidates((await snapshot()).config, 'locate', {}, health);
    if (!eligible.length) throw Object.assign(new Error(noModelMessage('locate', skipped)), { code: 'EXEC_UNSUPPORTED' });
    const family = locateFamily(eligible[0].model.model)!;
    const ep = await startLocalEndpoint();
    process.env.MIDSCENE_MODEL_BASE_URL = ep.url('locate', family);
    process.env.MIDSCENE_MODEL_API_KEY = ep.key;
    process.env.MIDSCENE_MODEL_NAME = eligible[0].model.model;
    process.env.MIDSCENE_MODEL_FAMILY = family;
    process.env.MIDSCENE_MODEL_REASONING_ENABLED = 'default';
    process.env.MIDSCENE_RUN_DIR = dataPath('runtime', this.opts.sessionId, 'midscene');
    const { PlaywrightAgent } = await import('@midscene/web/playwright/agent');
    this.mid = new PlaywrightAgent(this.page as never, { generateReport: false } as never) as never;
    this.midPage = this.page;
    return this.mid!;
  }

  private async cdpSession(): Promise<CDPSession> {
    if (this.cdp && this.cdpPage === this.page) return this.cdp;
    this.cdp = await this.ctx.newCDPSession(this.page); this.cdpPage = this.page;
    return this.cdp;
  }

  private attachPage(p: Page) {
    p.on('console', (m) => { if (m.type() === 'error') this.consoleErrors.push(m.text().slice(0, 300)); });
    p.on('pageerror', (e) => { this.pageErrors.push(String(e.message).slice(0, 300)); this.consoleErrors.push(`[pageerror] ${String(e.message).slice(0, 300)}`); });
    p.on('request', (r) => { this.net.inflight.set(r, Date.now()); this.net.total++; });
    const done = (r: Request, status: number) => {
      const t0 = this.net.inflight.get(r); this.net.inflight.delete(r);
      const ms = t0 ? Date.now() - t0 : 0; this.net.slowest = Math.max(this.net.slowest, ms);
      if (this.net.log.length < 3000) this.net.log.push({ url: r.url().slice(0, 300), method: r.method(), status, ms, type: r.resourceType(), at: iso() });
      if (status >= 400 || status === 0) this.net.failed.push({ url: r.url().slice(0, 300), status, method: r.method(), at: Date.now() });
    };
    p.on('requestfinished', async (r) => { const resp = await r.response().catch(() => null); done(r, resp?.status() ?? 0); });
    p.on('requestfailed', (r) => done(r, 0));
    p.on('dialog', (d) => { this.pendingDialog = d; this.dialogLog.push(`${d.type()}: ${d.message()}`); });
    // 下载：像浏览器下载栏一样告知用户
    p.on('download', (dl) => { this.downloads.push(dl.suggestedFilename()); dl.saveAs(join(this.modality.dir, 'downloads', dl.suggestedFilename())).catch(() => {}); });
    p.on('crash', () => { this.consoleErrors.push('[crash] page crashed'); });
    // 跟随被测页面自己打开的新标签页（例如 target=_blank）
    p.on('popup', (np) => { this.page = np; this.attachPage(np); });
  }

  private async startScreencast() {
    try {
      mkdirSync(this.frameDir, { recursive: true });
      const cdp = await this.cdpSession();
      cdp.on('Page.screencastFrame', (f: { data: string; sessionId: number }) => {
        const file = join(this.frameDir, `f${String(this.frameIdx++).padStart(6, '0')}.jpg`);
        try { writeFileSync(file, Buffer.from(f.data, 'base64')); this.frames.push({ file, t: Date.now() }); } catch { /* ignore */ }
        cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
      });
      await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 45, maxWidth: 960, maxHeight: 960, everyNthFrame: 3 });
    } catch (e) { logger.debug({ e }, 'screencast 不可用'); }
  }

  // ------------------------------------------------------------------ observe
  /**
   * 观察。给人物的只有截图（screenshot_ev）；元素几何、无障碍快照、axe、网络与控制台都是执行层仪器与工程证据。
   */
  async observe(_session_id?: string, stepIdx = 0): Promise<Observation & { elements: UIElement[]; captcha: boolean; text: string }> {
    const obs_id = newId('obs');
    const ctx = { ...this.ev, step_idx: stepIdx };
    let extracted: { elements: UIElement[]; captcha: boolean; text: string; scroll: { y: number; max_y: number }; notifications: string[]; hidden: boolean; dialogsInDom: number };
    const dialogOpen = !!this.pendingDialog;
    const vp = this.page.viewportSize() ?? { width: 1280, height: 800 };
    if (dialogOpen) {
      extracted = { elements: [], captcha: false, text: '', scroll: { y: 0, max_y: 0 }, notifications: [], hidden: false, dialogsInDom: 1 };
    } else {
      await this.page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
      extracted = await this.page.evaluate(EXTRACT_SCRIPT).catch(async () => { await sleep(800); return this.page.evaluate(EXTRACT_SCRIPT); }).catch(() => ({ elements: [], captcha: false, text: '', scroll: { y: 0, max_y: 0 }, notifications: [], hidden: false, dialogsInDom: 0 })) as typeof extracted;
    }
    const elements: UIElement[] = extracted.elements;
    if (this.pendingDialog) {
      const d = this.pendingDialog; const zh = !(this.opts.locale ?? 'zh-CN').startsWith('en');
      const L = dialogLayout(vp.width, vp.height, d.type() !== 'alert');
      elements.unshift(
        { ref: 'dlg_ok', role: 'button', name: zh ? '确定' : 'OK', vis_text: zh ? '确定' : 'OK', tag: 'dialog', bbox: L.ok, in_viewport: true, occluded: false, selector: 'dialog:accept', kind: 'interactive' },
        ...(L.cancel ? [{ ref: 'dlg_cancel', role: 'button', name: zh ? '取消' : 'Cancel', vis_text: zh ? '取消' : 'Cancel', tag: 'dialog', bbox: L.cancel, in_viewport: true, occluded: false, selector: 'dialog:dismiss', kind: 'interactive' as const }] : []),
      );
    }
    const url = this.page.url();
    const title = dialogOpen ? (this.lastObs?.title ?? '') : await this.page.title().catch(() => '');
    const state_id = stateIdOf(url, elements, dialogOpen || extracted.dialogsInDom > 0);
    const isNew = !this.seenStates.has(state_id);
    this.seenStates.add(state_id);

    let screenshot_ev = this.lastScreenshotEv;
    if (!dialogOpen) {
      const shot = await this.page.screenshot({ type: 'jpeg', quality: 72, timeout: 10000 }).catch(() => null);
      if (shot) { this.lastShot = shot; screenshot_ev = await putEvidence('screenshot', ctx, { data: shot, mime: 'image/jpeg' }); this.lastScreenshotEv = screenshot_ev; }
    } else if (this.lastShot) {
      // 原生弹窗不在页面截图里：按浏览器的样子画到上一张截图上，人物才看得见
      const d = this.pendingDialog!; const zh = !(this.opts.locale ?? 'zh-CN').startsWith('en');
      const host = (() => { try { return new URL(url).host; } catch { return ''; } })();
      const shot = await drawDialog(this.lastShot, { vw: vp.width, vh: vp.height, host: zh ? `${host} 显示` : `${host} says`, message: d.message(), kind: d.type(), okLabel: zh ? '确定' : 'OK', cancelLabel: zh ? '取消' : 'Cancel' }).catch(() => null);
      if (shot) screenshot_ev = await putEvidence('screenshot', ctx, { data: shot, mime: 'image/jpeg' });
    }
    const aria = dialogOpen ? `dialog: ${this.pendingDialog?.message()}` : await this.page.locator('body').ariaSnapshot({ timeout: 5000 }).catch(() => '');
    const a11y_ev = await putEvidence('a11y', ctx, { data: aria || '(empty)', mime: 'text/plain' });
    if (isNew && !dialogOpen && this.opts.record?.axe !== false) await this.runAxe(state_id, ctx).catch((e) => logger.debug({ e }, 'axe 失败'));
    await this.drainRrweb();

    const dpr = dialogOpen ? 1 : await this.page.evaluate('window.devicePixelRatio').catch(() => 1) as number;
    const obs: Observation & { elements: UIElement[]; captcha: boolean; text: string } = {
      obs_id, ts: iso(), url, title, viewport: { w: vp.width, h: vp.height, dpr },
      state_id, screenshot_ev, a11y_ev,
      visible_text_digest: extracted.text.slice(0, 1500),
      console_errors: this.consoleErrors.splice(0),
      network: { pending: this.net.inflight.size, failed: this.net.failed.splice(0).map(({ url, status, method }) => ({ url, status, method })), slowest_ms: this.net.slowest, requests: this.net.total },
      dialogs: this.dialogLog.splice(0),
      notifications: [...extracted.notifications, ...this.downloads.splice(0).map((f) => `浏览器下载完成：${f}`)],
      page_visibility: extracted.hidden ? 'hidden' : 'visible',
      elements, scroll: extracted.scroll, is_new_state: isNew,
      captcha: extracted.captcha, text: extracted.text,
    };
    this.net.slowest = 0;
    this.lastObs = obs;
    this.lastUrl = url;
    return obs;
  }

  private async runAxe(state_id: string, ctx: EvidenceCtx) {
    if (this.axeByState.has(state_id)) return;
    const { AxeBuilder } = await import('@axe-core/playwright');
    const r = await new AxeBuilder({ page: this.page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    const slim = r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, helpUrl: v.helpUrl, nodes: v.nodes.slice(0, 5).map((n) => ({ target: n.target, html: n.html.slice(0, 200), summary: n.failureSummary?.slice(0, 300) })), count: v.nodes.length }));
    const id = await putEvidence('axe', ctx, { inline: { state_id, url: this.page.url(), violations: slim } });
    this.axeByState.set(state_id, id);
  }

  private async drainRrweb() {
    const evs = await this.page.evaluate('(() => { const a = window.__puxRr || []; window.__puxRr = []; return a; })()').catch(() => []) as unknown[];
    if (Array.isArray(evs) && evs.length) this.rrEvents.push(...evs);
  }

  // ------------------------------------------------------------------ 手：指针、触屏、键盘
  /** 注入一次输入。页面弹出原生弹窗时浏览器不会回执这次输入：弹窗一出现就不再等（人的手已经点完了） */
  private async inject(op: () => Promise<unknown>): Promise<void> {
    let settled = false; let err: unknown;
    const p = op().then(() => { settled = true; }, (e) => { settled = true; err = e; });
    while (!settled && !this.pendingDialog) await Promise.race([p, sleep(50)]);
    if (settled && err && !this.pendingDialog) throw err;
  }
  private async moveTo(to: Pt, motor: MotorProfile, r: Rng, targetSize?: number) {
    if (this.mobile) { this.pointer = to; return; }           // 触屏没有悬停的指针
    for (const p of mousePath(this.pointer, to, { targetSize, precision: motor.precision, rng: r })) { await this.page.mouse.move(p.x, p.y); if (p.dt > 1) await sleep(p.dt); }
    this.pointer = to;
  }
  private async tap(p: Pt, motor: MotorProfile, r: Rng, targetSize?: number) {
    await this.moveTo(p, motor, r, targetSize);
    const twice = r.bool(motor.double_tap_risk);
    for (let i = 0; i < (twice ? 2 : 1); i++) {
      if (this.mobile) await this.inject(() => this.page.touchscreen.tap(p.x, p.y));
      else { await this.page.mouse.down(); await sleep(30 + r.next() * 60); await this.inject(() => this.page.mouse.up()); }
      if (this.pendingDialog) break;
      if (twice) await sleep(70);
    }
  }
  private async press(p: Pt, ms: number, motor: MotorProfile, r: Rng) {
    await this.moveTo(p, motor, r);
    if (this.mobile) {
      const s = await this.cdpSession();
      await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] });
      await sleep(ms);
      await this.inject(() => s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }));
    } else { await this.page.mouse.down(); await sleep(ms); await this.inject(() => this.page.mouse.up()); }
  }
  /** 手指或鼠标按住从一点拖到另一点 */
  private async dragBetween(from: Pt, to: Pt, motor: MotorProfile, r: Rng) {
    await this.moveTo(from, motor, r);
    if (this.mobile) {
      const s = await this.cdpSession();
      await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
      for (let i = 1; i <= 10; i++) { await sleep(16); await s.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + ((to.x - from.x) * i) / 10, y: from.y + ((to.y - from.y) * i) / 10 }] }); }
      await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await this.page.mouse.down();
      for (const p of mousePath(from, to, { precision: motor.precision, rng: r, compress: 3 })) { await this.page.mouse.move(p.x, p.y); await sleep(Math.max(4, p.dt)); }
      await this.page.mouse.up(); this.pointer = to;
    }
  }
  /** 滚动：电脑上是滚轮一格一格滚；手机上是手指在屏幕上滑（带惯性） */
  private async scrollBy(amount: number, at: Pt, r: Rng) {
    if (!this.mobile) {
      await this.page.mouse.move(at.x, at.y); this.pointer = at;
      for (const t of wheelPlan(amount, r)) { await this.page.mouse.wheel(0, t.dy); await sleep(t.dt); }
      await sleep(260); return;
    }
    const y0 = (await this.probe()).scrollY;
    const s = await this.cdpSession();
    const vp = this.page.viewportSize() ?? { width: 390, height: 844 };
    const dist = Math.max(-vp.height * 0.6, Math.min(vp.height * 0.6, -amount * 0.75));
    const from = { x: at.x, y: Math.max(80, Math.min(vp.height - 80, dist < 0 ? vp.height * 0.72 : vp.height * 0.3)) };
    try {
      await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
      for (const p of swipePath(from, dist, r)) { await sleep(p.dt); await s.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p.x, y: p.y }] }); }
      await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } catch (e) { logger.debug({ e: String(e).slice(0, 120) }, '触屏滑动注入失败'); }
    await sleep(450);
    // 个别页面的滚动容器不响应合成触摸：退回系统级滚动手势，保证「手指滑了屏幕就会动」
    if ((await this.probe()).scrollY === y0) await s.send('Input.synthesizeScrollGesture', { x: at.x, y: vp.height / 2, yDistance: -amount, speed: 1400, gestureSourceType: 'touch' }).catch(() => this.page.mouse.wheel(0, amount).catch(() => {}));
    await sleep(200);
  }
  /** 按人物的打字速度与错字率逐字输入（邻键错字 + 回删）；真实耗时被压缩，模拟时钟另行结算 */
  private async humanType(text: string, motor: MotorProfile, r: Rng) {
    for (const k of typingPlan(text, motor, r)) {
      if (k.kind === 'backspace') await this.page.keyboard.press('Backspace');
      else if (/^[\x20-\x7e]$/.test(k.ch)) await this.page.keyboard.type(k.ch);
      else if (k.ch === '\n') await this.page.keyboard.press('Shift+Enter');
      else await this.page.keyboard.insertText(k.ch);
      await sleep(k.dt);
    }
  }

  // ------------------------------------------------------------------ act
  async act(req: ActionRequest, rng?: Rng): Promise<ActionResult> {
    const r = rng ?? this.opts.rng;
    const started = Date.now(); const started_at = iso();
    const before_obs = this.lastObs?.obs_id ?? '';
    const ctx = { ...this.ev, step_idx: req.step_idx };
    const motor = req.motor ?? DEFAULT_MOTOR;
    const result = (status: ActionResult['status'], extra: Partial<ActionResult> = {}): ActionResult => ({
      action_id: req.action_id, status, matched_criteria: [], started_at, ended_at: iso(), duration_ms: Date.now() - started,
      executor: { name: this.name, version: this.name === 'midscene' ? MIDSCENE_VERSION : 'playwright', model_alias: this.name === 'midscene' ? (process.env.MIDSCENE_MODEL_NAME ?? 'locate') : undefined },
      before_obs, after_obs: '', effects: { url_changed: false, dom_changed: false, requests: 0, new_dialog: false }, evidence_ids: [], ...extra,
    });

    // 1) 目标 → 落点
    let el: UIElement | undefined; let point: [number, number] | undefined; let resolved: TargetRef | undefined;
    const needsTarget = ['click', 'long_press', 'hover', 'select', 'upload', 'drag'].includes(req.verb) || (['type', 'speak', 'show_camera', 'scroll'].includes(req.verb) && !!req.target);
    if (req.target && needsTarget) {
      const res = await this.resolveTarget(req.target, req.intent_text).catch((e) => ({ error: makeError((e as { code?: string }).code ?? 'EXEC_TARGET_NOT_FOUND', String((e as Error).message).slice(0, 200)) }));
      if ('error' in res) {
        if (req.verb === 'scroll') { /* 没找到要滚的区域：就在屏幕中间滚 */ } else return result('failed', { error: res.error });
      } else {
        ({ el, point } = res); resolved = res.resolved;
        if (el?.occluded && !el.selector.startsWith('dialog:')) return result('failed', { error: makeError('EXEC_INTERCEPTED', `目标「${el.vis_text || el.name}」被其他元素遮挡`), resolved_target: resolved });
      }
    } else if (needsTarget) {
      return result('failed', { error: makeError('SIM_INVALID_INTENT', '动作缺少目标') });
    }

    // 2) Policy Gate
    const decision = checkPolicy(req, this.opts.policy, el, this.page.url());
    if (!decision.allowed) {
      const evId = await putEvidence('action', ctx, { inline: { req, policy: decision } });
      return result('blocked_by_policy', { error: makeError('POLICY_BLOCKED', decision.reason ?? 'blocked'), resolved_target: resolved, evidence_ids: [evId] });
    }

    // 3) 执行
    const probe0 = await this.probe();
    const shot0 = this.lastShot;
    const req0 = this.net.total; const failed0 = this.net.failed.length; const pageErr0 = this.pageErrors.length; const dlg0 = this.dialogLog.length;
    const dialogWasOpen = !!this.pendingDialog;
    let motorMiss = false; let extraErr: UAPError | undefined;
    const box = el ? { x: el.bbox[0], y: el.bbox[1], w: el.bbox[2], h: el.bbox[3] } : undefined;
    const missKey = el?.selector ?? '';
    const attempt = this.lastMiss && this.lastMiss.key === missKey ? this.lastMiss.n : 0;
    const land = () => { const c = { x: point?.[0] ?? 640, y: point?.[1] ?? 400 }; const p = landingPoint(c, box, motor, r, { attempt, touch: this.mobile }); motorMiss = p.miss; return p; };
    const size = el ? Math.min(el.bbox[2], el.bbox[3]) : undefined;
    try {
      switch (req.verb) {
        case 'navigate': await this.page.goto(String(req.args?.url), { waitUntil: 'domcontentloaded', timeout: req.timeout_ms || 20000 }); break;
        case 'back': await this.page.goBack({ timeout: 10000 }).catch(() => null); break;
        case 'reload': await this.page.reload({ timeout: 20000 }); break;
        case 'click': case 'long_press': case 'hover': {
          if (el?.selector.startsWith('dialog:')) { await this.handleDialog(el.selector === 'dialog:accept', req.args?.text as string | undefined); break; }
          // 下拉框的选项（页面里画出的列表项或原生 <option>）不能走普通点击：原生选项没有可点的盒子，
          // 画出的列表遇到页面滚动就会收起。统一按「选中这一项」处理
          if (req.verb === 'click' && el && (el.tag === 'option' || el.role === 'option') && await this.pickOption(el)) break;
          const p = land();
          if (req.verb === 'hover') { await this.moveTo(p, motor, r, size); await sleep(600); break; }
          if (req.verb === 'long_press') { await this.press(p, 900, motor, r); break; }
          await this.tap(p, motor, r, size);
          break;
        }
        case 'type': {
          if (this.pendingDialog) { await this.handleDialog(true, String(req.args?.text ?? '')); break; }
          if (point) await this.tap(land(), motor, r, size);
          if (req.args?.clear) { await this.page.keyboard.press('Control+A'); await this.page.keyboard.press('Backspace'); }
          if (req.args?.paste) await this.page.keyboard.insertText(String(req.args?.text ?? ''));
          else await this.humanType(String(req.args?.text ?? ''), motor, r);
          if (req.args?.submit) await this.inject(() => this.page.keyboard.press('Enter'));
          break;
        }
        case 'key': await this.inject(() => this.page.keyboard.press(String(req.args?.key ?? 'Enter'))); break;
        case 'scroll': {
          const dir = req.args?.direction === 'up' ? -1 : 1; const amount = Number(req.args?.amount ?? 600) * dir;
          const vp = this.page.viewportSize() ?? { width: 1280, height: 800 };
          await this.scrollBy(amount, point ? { x: point[0], y: point[1] } : { x: vp.width / 2, y: vp.height / 2 }, r);
          break;
        }
        case 'select': await this.page.locator(el!.selector).selectOption({ label: String(req.args?.value) }).catch(() => this.page.locator(el!.selector).selectOption(String(req.args?.value))); break;
        case 'upload': {
          const file = String(req.args?.file ?? '');
          if (!existsSync(file)) throw Object.assign(new Error(`素材不存在：${file}`), { code: 'SIM_INVALID_INTENT' });
          if (el?.tag === 'input' && el.selector.startsWith('xpath=')) await this.page.locator(el.selector).setInputFiles(file);
          else { const [fc] = await Promise.all([this.page.waitForEvent('filechooser', { timeout: 5000 }), this.tap({ x: point![0], y: point![1] }, motor, r)]); await fc.setFiles(file); }
          break;
        }
        case 'drag': {
          const to = req.args?.to as TargetRef | undefined; const dest = to ? await this.resolveTarget(to, req.intent_text).catch(() => undefined) : undefined;
          const p = land();
          const tp = dest ? { x: dest.point[0], y: dest.point[1] } : { x: p.x + Number(req.args?.dx ?? 0), y: p.y + Number(req.args?.dy ?? 200) };
          await this.dragBetween(p, tp, motor, r); break;
        }
        case 'wait': {
          const max = Number(req.args?.seconds ?? 10) * 1000;
          await this.waitForSettle(max, String(req.args?.until_text ?? ''));
          break;
        }
        case 'speak': {
          const sp = await this.modality.speak(String(req.args?.text ?? ''), this.opts.locale);
          if (point) await this.tap(land(), motor, r, size);
          await sleep(Math.min(12000, sp.seconds * 1000 + 800));
          if (point && req.args?.toggle_stop) await this.tap({ x: point[0], y: point[1] }, motor, r);
          break;
        }
        case 'show_camera': {
          await this.modality.showCamera({ imagePath: req.args?.image as string | undefined, prompt: req.args?.prompt as string | undefined });
          if (point) await this.tap(land(), motor, r, size);
          await sleep(1500); break;
        }
        case 'set_location': await this.ctx.setGeolocation({ latitude: Number(req.args?.lat), longitude: Number(req.args?.lng), accuracy: 30 }); break;
        case 'switch_away': case 'lock': await this.switchAway(); break;
        case 'return': await this.returnBack(); break;
        case 'close_tab': await this.closeTab(); break;
        default: return result('failed', { error: makeError('EXEC_UNSUPPORTED', `不支持的动词 ${req.verb}`) });
      }
    } catch (e) {
      const msg = String((e as Error).message ?? e);
      const code = (e as { code?: string }).code ?? (/net::ERR_/.test(msg) ? (this.injectedNetwork ? 'INJECTED_NETWORK' : 'ENV_NETWORK') : /Target (page|closed)|crash/i.test(msg) ? 'ENV_BROWSER_CRASH' : /Timeout/i.test(msg) ? 'PRODUCT_UNRESPONSIVE' : 'EXEC_TARGET_NOT_FOUND');
      extraErr = makeError(code, msg.slice(0, 300), true);
    }

    // 4) 等页面安静下来（仪器判断），再看屏幕有没有肉眼可见的变化（人物判断）
    const crit = req.success?.any_of?.length ? req.success : defaultCriteria(req);
    const deadline = Date.now() + Math.min(crit.within_ms, 15000);
    let matched: string[] = []; let probe1 = probe0;
    for (;;) {
      await sleep(150);
      probe1 = await this.probe();
      matched = await this.evalCriteria(crit.any_of, req, probe0, probe1);
      if (matched.length && this.net.inflight.size === 0 && Date.now() - (probe1.lastMutationAt || 0) > 300) break;
      if (Date.now() > deadline) break;
    }
    this.lastMiss = motorMiss ? { key: missKey, n: attempt + 1 } : undefined;
    const new_dialog = this.dialogLog.length > dlg0 || probe1.dialogsInDom > probe0.dialogsInDom;
    let visible = true; let ratio = 0;
    const visualVerb = ['click', 'long_press', 'type', 'key', 'scroll', 'drag', 'back', 'reload', 'select', 'upload'].includes(req.verb);
    if (visualVerb && !this.pendingDialog && !dialogWasOpen) {
      const shot1 = await this.page.screenshot({ type: 'jpeg', quality: 72, timeout: 8000 }).catch(() => undefined);
      const d = await visualDelta(shot0, shot1 ?? undefined); visible = d.visible; ratio = d.ratio;
    }
    const effects = { url_changed: probe1.url !== probe0.url, dom_changed: probe1.mutations > probe0.mutations, requests: this.net.total - req0, new_dialog, visible_change: visible || new_dialog, visual_ratio: Math.round(ratio * 10000) / 10000 };
    const newFailed = this.net.failed.slice(failed0);
    const evIds = [await putEvidence('action', ctx, { inline: { req: { ...req, motor }, resolved: resolved ?? null, effects, matched } })];

    // 状态按「人看到了什么」定：屏幕变了就是有反应，没变就是没反应。错误码是工程信号，只挂在结果上
    let status: ActionResult['status'] = extraErr ? 'failed' : !visualVerb || effects.visible_change || effects.url_changed ? 'success' : 'no_effect';
    let error = extraErr;
    if (newFailed.some((f) => f.status >= 500)) error = makeError('PRODUCT_HTTP_5XX', `接口返回 ${newFailed.find((f) => f.status >= 500)!.status}：${newFailed.find((f) => f.status >= 500)!.url}`);
    else if (this.pageErrors.length > pageErr0 && !error) error = makeError('PRODUCT_JS_ERROR', this.pageErrors[this.pageErrors.length - 1]);
    else if (newFailed.some((f) => f.status === 0) && this.injectedNetwork && status === 'no_effect') { error = makeError('INJECTED_NETWORK', '注入的弱网导致请求失败'); status = 'failed'; }
    else if (status === 'no_effect' && req.verb === 'click' && motorMiss) {
      // WCAG 2.2 目标尺寸（24×24）；行内文本链接豁免
      const inlineText = el?.role === 'link' && (el.text_len ?? 0) >= 4;
      const small = !!el && !inlineText && el.bbox[2] < 24 && el.bbox[3] < 24;
      error = makeError(small ? 'PRODUCT_SMALL_TARGET' : 'SIM_MOTOR_MISS', small ? `目标「${el!.vis_text || el!.name}」尺寸过小（${el!.bbox[2]}×${el!.bbox[3]}px），按动作精度未点中` : '动作精度导致未点中');
    } else if (status === 'no_effect' && effects.requests > 0 && ['click', 'key', 'type'].includes(req.verb)) {
      error = makeError('PRODUCT_NO_FEEDBACK', '动作触发了请求，但屏幕上没有任何可见变化');
    }
    return result(status, { matched_criteria: matched, error, resolved_target: resolved, effects, evidence_ids: evIds });
  }

  /** TargetRef → 落点。visual 是人物使用的路径；selector / a11y / text / coords / ref 只用于重放与弹窗 */
  async resolveTarget(t: TargetRef, intent: string): Promise<Located> {
    const els = this.lastObs?.elements ?? [];
    const centerOf = (e: UIElement): [number, number] => [e.bbox[0] + e.bbox[2] / 2, e.bbox[1] + e.bbox[3] / 2];
    const mk = (e: UIElement | undefined, point: [number, number], by: TargetRef['by']): Located => ({ el: e, point, resolved: { by, value: t.value, text: t.text, resolved: { selector: e?.selector, bbox: e?.bbox, a11y_role: e?.role, a11y_name: e ? (e.vis_text || e.name) : undefined, in_perceived_view: true } } });
    const refreshBox = async (e: UIElement, scroll: boolean) => {
      if (e.selector.startsWith('dialog:')) return e;
      const loc = this.page.locator(e.selector).first();
      if (scroll && e.role !== 'option') await loc.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
      const b = await loc.boundingBox({ timeout: 3000 }).catch(() => null);
      if (!b) throw Object.assign(new Error(`目标「${e.vis_text || e.name}」已不在屏幕上`), { code: 'EXEC_TARGET_NOT_FOUND' });
      const occluded = await loc.evaluate((node, [x, y]) => { const top = document.elementFromPoint(x, y); return !!top && top !== node && !node.contains(top) && !top.contains(node); }, [b.x + b.width / 2, b.y + b.height / 2]).catch(() => false);
      return { ...e, bbox: [b.x, b.y, b.width, b.height] as [number, number, number, number], occluded };
    };
    switch (t.by) {
      case 'visual': {
        // 原生弹窗打开时，屏幕上能点的只有弹窗按钮
        if (this.pendingDialog) {
          const cancel = els.find((e) => e.ref === 'dlg_cancel'); const ok = els.find((e) => e.ref === 'dlg_ok')!;
          const wantsCancel = !!cancel && /取消|不|否|关闭|cancel|no\b|dismiss|close/i.test(`${t.text ?? ''} ${t.value}`) && !/确定|好|是|ok|yes|confirm/i.test(t.text ?? '');
          const d = wantsCancel ? cancel! : ok; return mk(d, centerOf(d), 'visual');
        }
        // ① 借 DOM 换算落点：照抄的字在屏幕上恰好对应唯一一个可交互元素
        const m = matchVisibleText(els, t.text ?? '');
        if (m) { const fresh = await refreshBox(m, false).catch(() => undefined); if (fresh && !fresh.occluded) return mk(fresh, centerOf(fresh), 'visual'); }
        // ② Midscene 看截图定位
        if (this.name !== 'midscene') throw Object.assign(new Error('看截图定位需要 midscene 执行器'), { code: 'EXEC_UNSUPPORTED' });
        const desc = [t.text ? `「${t.text}」` : '', t.value].filter(Boolean).join(' ').trim() || intent;
        let loc: Awaited<ReturnType<MidAgent['aiLocate']>>;
        try { loc = await (await this.midAgent()).aiLocate(desc, { cacheable: false }); }
        catch (e) { throw Object.assign(new Error(`在屏幕上没有找到：${desc}（${String((e as Error).message).slice(0, 80)}）`), { code: 'EXEC_TARGET_NOT_FOUND' }); }
        const vp = this.page.viewportSize() ?? { width: 1280, height: 800 };
        // Midscene 返回的是截图像素坐标；高倍屏（手机 2 倍屏）要换算回屏幕坐标
        const d = loc.dpr && loc.dpr > 1 ? loc.dpr : 1;
        const pt: [number, number] = [loc.center[0] / d, loc.center[1] / d];
        loc.rect = { left: loc.rect.left / d, top: loc.rect.top / d, width: loc.rect.width / d, height: loc.rect.height / d };
        if (!(pt[0] >= 0 && pt[0] <= vp.width && pt[1] >= 0 && pt[1] <= vp.height)) throw Object.assign(new Error(`定位结果超出屏幕：${desc}`), { code: 'EXEC_TARGET_NOT_FOUND' });
        const hit = elementAt(els, pt[0], pt[1]);
        const e: UIElement = hit ? { ...hit } : { ref: 'vis', role: 'unknown', name: desc, vis_text: t.text, tag: 'visual', bbox: [loc.rect.left, loc.rect.top, Math.max(8, loc.rect.width), Math.max(8, loc.rect.height)], in_viewport: true, occluded: false, selector: `coords=${Math.round(pt[0])},${Math.round(pt[1])}`, kind: 'interactive' };
        return mk(e, pt, 'visual');
      }
      case 'ref': {
        const e = els.find((x) => x.ref === t.value);
        if (!e) throw Object.assign(new Error(`元素编号 ${t.value} 不存在`), { code: 'SIM_INVALID_INTENT' });
        const fresh = await refreshBox(e, true); return mk(fresh, centerOf(fresh), 'ref');
      }
      case 'coords': { const [x, y] = t.value.split(',').map(Number); return mk(elementAt(els, x, y), [x, y], 'coords'); }
      case 'selector': case 'a11y': case 'text': default: {
        if (t.by === 'selector' && t.value.startsWith('coords=')) { const [x, y] = t.value.slice(7).split(',').map(Number); return mk(elementAt(els, x, y), [x, y], 'coords'); }
        const loc = t.by === 'selector' ? this.page.locator(t.value).first()
          : t.by === 'text' ? this.page.getByText(t.value, { exact: false }).first()
            : (() => { const m = /^role=(\w+)(?:\[name=(.+)\])?$/.exec(t.value); return m ? this.page.getByRole(m[1] as never, m[2] ? { name: m[2] } : {}).first() : this.page.locator(t.value).first(); })();
        const cnt = await loc.count().catch(() => 0);
        if (!cnt) throw Object.assign(new Error(`找不到目标 ${t.value}`), { code: 'EXEC_TARGET_NOT_FOUND' });
        await loc.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
        const b = await loc.boundingBox(); if (!b) throw Object.assign(new Error('目标不可见'), { code: 'EXEC_TARGET_NOT_FOUND' });
        const known = t.by === 'selector' ? els.find((x) => x.selector === t.value) : undefined;
        const e: UIElement = { ...(known ?? { ref: 'sel', role: 'unknown', name: t.value, tag: 'unknown', in_viewport: true, occluded: false, selector: t.value, kind: 'interactive' as const }), bbox: [b.x, b.y, b.width, b.height] };
        return mk(e, centerOf(e), t.by);
      }
    }
  }

  private async handleDialog(accept: boolean, promptText?: string) {
    const d = this.pendingDialog; this.pendingDialog = undefined;
    if (!d) return;
    if (accept) await d.accept(promptText).catch(() => {}); else await d.dismiss().catch(() => {});
  }

  /** 选中下拉框里的一项：先找页面里画出的列表项，再找原生 <option>；成功返回 true，找不到返回 false 让调用方照常点击 */
  private async pickOption(el: UIElement): Promise<boolean> {
    const label = (el.vis_text || el.name || '').trim();
    const viaPopup = await this.page.evaluate((txt) => {
      const pop = document.querySelector('[data-pux-select]'); if (!pop) return false;
      const it = Array.from(pop.querySelectorAll('[role=option]')).find((n) => (n.textContent || '').trim() === txt) as HTMLElement | undefined;
      if (!it) return false;
      it.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); return true;
    }, label).catch(() => false);
    if (viaPopup) return true;
    if (!el.selector.startsWith('xpath=')) return false;
    return await this.page.locator(el.selector).first().evaluate((o) => {
      const sel = (o as HTMLOptionElement).closest ? (o as HTMLElement).closest('select') : null; if (!sel || !(o instanceof HTMLOptionElement) || o.disabled) return false;
      sel.selectedIndex = o.index; sel.dispatchEvent(new Event('input', { bubbles: true })); sel.dispatchEvent(new Event('change', { bubbles: true })); return true;
    }, undefined, { timeout: 2000 }).catch(() => false);
  }

  /** 当前页面纵向滚动位置（循环护栏用：滚动后位置变了就不是原地打转） */
  async scrollY(): Promise<number> { return (await this.probe()).scrollY; }

  private async probe(): Promise<{ url: string; mutations: number; lastMutationAt: number; scrollY: number; dialogsInDom: number; textLen: number }> {
    if (this.pendingDialog) return { url: this.page.url(), mutations: -1, lastMutationAt: 0, scrollY: 0, dialogsInDom: 1, textLen: 0 };
    return await this.page.evaluate(PROBE_SCRIPT).catch(() => ({ url: this.page.url(), mutations: 0, lastMutationAt: 0, scrollY: 0, dialogsInDom: 0, textLen: 0 })) as never;
  }

  private async evalCriteria(list: Criterion[], req: ActionRequest, p0: Awaited<ReturnType<BrowserSession['probe']>>, p1: Awaited<ReturnType<BrowserSession['probe']>>): Promise<string[]> {
    const out: string[] = [];
    for (const c of list) {
      switch (c.kind) {
        case 'url_changed': if (p1.url !== p0.url) out.push('url_changed'); break;
        case 'dom_changed': if (p1.mutations > p0.mutations || p1.textLen !== p0.textLen) out.push('dom_changed'); break;
        case 'dialog_opened': if (p1.dialogsInDom > p0.dialogsInDom || !!this.pendingDialog) out.push('dialog_opened'); break;
        case 'viewport_changed': if (p1.scrollY !== p0.scrollY) out.push('viewport_changed'); break;
        case 'network_settled': if (this.net.inflight.size === 0) out.push('network_settled'); break;
        case 'content_appeared': if (await this.page.getByText(c.text, { exact: false }).first().isVisible().catch(() => false)) out.push('content_appeared'); break;
        case 'element_visible': if (c.target.by === 'text' && await this.page.getByText(c.target.value).first().isVisible().catch(() => false)) out.push('element_visible'); break;
        case 'value_equals': if (p1.mutations > p0.mutations || p1.textLen !== p0.textLen) out.push('value_equals'); break;
        case 'file_attached': if (await this.page.getByText(c.name, { exact: false }).first().isVisible().catch(() => false)) out.push('file_attached'); break;
      }
    }
    void req;
    return out;
  }

  /** 等待页面稳定（AI 回复流式输出结束），或超过容忍时长 */
  async waitForSettle(maxMs: number, untilText = '') {
    const t0 = Date.now();
    let stableSince = Date.now(); let lastLen = -1;
    while (Date.now() - t0 < maxMs) {
      await sleep(400);
      if (untilText && await this.page.getByText(untilText, { exact: false }).first().isVisible().catch(() => false)) return;
      const p = await this.probe();
      if (p.textLen !== lastLen || this.net.inflight.size > 0) { lastLen = p.textLen; stableSince = Date.now(); }
      if (Date.now() - stableSince > 1500 && Date.now() - t0 > 1200) return;
    }
  }

  // ------------------------------------------------------------------ 打断与环境注入（由 World Simulator 触发）
  async switchAway() { this.hiddenSince = Date.now(); await this.page.evaluate('window.__pux && window.__pux.setHidden(true)').catch(() => {}); await (await this.cdpSession().catch(() => undefined))?.send('Page.setWebLifecycleState', { state: 'frozen' }).catch(() => {}); }
  async returnBack() { await (await this.cdpSession().catch(() => undefined))?.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => {}); await this.page.evaluate('window.__pux && window.__pux.setHidden(false)').catch(() => {}); this.hiddenSince = undefined; }
  /** 切到另一个应用（标签页）：没开过就新开并打开 url；原来那个在后台（页面可见性变成 hidden），录像跟着切过去 */
  async showTab(key: string, url?: string): Promise<void> {
    if (key === this.tab && !this.page.isClosed()) return;
    this.tabs.set(this.tab, this.page);
    await this.page.evaluate('window.__pux && window.__pux.setHidden(true)').catch(() => {});
    await this.cdp?.send('Page.stopScreencast').catch(() => {});
    let p = this.tabs.get(key);
    if (!p || p.isClosed()) {
      p = await this.ctx.newPage(); this.attachPage(p); this.tabs.set(key, p);
      if (url) await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch((e) => logger.debug({ e: String(e) }, '应用打开失败'));
    } else if (url && key !== 'main' && !p.url().startsWith(new URL(url).origin)) {
      // 应用里点了外面的链接之后再回来：回到应用首页
      await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    } else if (url && key !== 'main') {
      await p.reload({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    }
    await p.bringToFront().catch(() => {});
    this.page = p; this.tab = key;
    await p.evaluate('window.__pux && window.__pux.setHidden(false)').catch(() => {});
    if (this.opts.record?.video !== false) await this.startScreencast();
  }

  async closeTab() { const url = this.page.url(); await this.page.close().catch(() => {}); this.page = await this.ctx.newPage(); this.attachPage(this.page); this.lastUrl = url; }
  async reopenLast() { if (this.lastUrl) await this.page.goto(this.lastUrl, { waitUntil: 'domcontentloaded' }).catch(() => {}); }

  /** 弱网注入（Chromium 网络条件模拟），标记为 injected */
  async setNetwork(p: { down_kbps: number; up_kbps: number; rtt_ms: number; offline?: boolean } | null) {
    const s = await this.cdpSession();
    if (!p) { this.injectedNetwork = false; await s.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }).catch(() => {}); return; }
    this.injectedNetwork = true;
    await s.send('Network.enable').catch(() => {});
    await s.send('Network.emulateNetworkConditions', { offline: !!p.offline, latency: p.rtt_ms, downloadThroughput: (p.down_kbps * 1024) / 8, uploadThroughput: (p.up_kbps * 1024) / 8 }).catch(() => {});
  }
  async setGeolocation(lat: number, lng: number) { await this.ctx.setGeolocation({ latitude: lat, longitude: lng, accuracy: 30 }); }

  /** 人工接管：返回可在本机浏览器中打开的 DevTools 远程画面地址 */
  async takeoverUrl(): Promise<string> {
    try {
      const list = await (await fetch(`${this.cdpUrl}/json/list`)).json() as { id: string; url: string; type: string; devtoolsFrontendUrl?: string }[];
      const cur = list.find((t) => t.type === 'page' && t.url === this.page.url()) ?? list.find((t) => t.type === 'page');
      return cur ? `${this.cdpUrl}/devtools/inspector.html?ws=127.0.0.1:${this.cdpPort}/devtools/page/${cur.id}` : this.cdpUrl;
    } catch { return this.cdpUrl; }
  }

  // ------------------------------------------------------------------ 结束：视频、网络日志、rrweb 入库
  async close(): Promise<{ video_ev?: string; har_ev?: string; rrweb_ev?: string }> {
    if (this.closed) return {};
    this.closed = true;
    const out: { video_ev?: string; har_ev?: string; rrweb_ev?: string } = {};
    await this.drainRrweb().catch(() => {});
    if (this.opts.deviceStateFile) { try { mkdirSync(dirname(this.opts.deviceStateFile), { recursive: true }); writeFileSync(this.opts.deviceStateFile, JSON.stringify({ cookies: await this.ctx.cookies() })); } catch (e) { logger.debug({ e }, '设备状态保存失败'); } }
    await this.cdp?.send('Page.stopScreencast').catch(() => {});
    try { if (this.rrEvents.length) out.rrweb_ev = await putEvidence('rrweb', this.ev, { data: JSON.stringify(this.rrEvents), mime: 'application/json' }); } catch (e) { logger.warn({ e }, 'rrweb 入库失败'); }
    try { out.har_ev = await putEvidence('har', this.ev, { data: JSON.stringify({ log: { version: '1.2-lite', creator: { name: 'pux' }, entries: this.net.log } }), mime: 'application/json' }); } catch { /* ignore */ }
    await this.browser?.close().catch(() => {});
    try {
      if (this.frames.length > 2) {
        const list = join(this.modality.dir, 'frames.txt');
        const lines: string[] = [];
        for (let i = 0; i < this.frames.length; i++) { const d = i < this.frames.length - 1 ? Math.min(5, (this.frames[i + 1].t - this.frames[i].t) / 1000) : 1; lines.push(`file '${this.frames[i].file}'`, `duration ${Math.max(0.04, d).toFixed(3)}`); }
        lines.push(`file '${this.frames[this.frames.length - 1].file}'`);
        writeFileSync(list, lines.join('\n'));
        const mp4 = join(this.modality.dir, 'session.mp4');
        await run('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=8', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', mp4], { timeout: 180000 });
        out.video_ev = await putEvidence('video', this.ev, { data: readFileSync(mp4), mime: 'video/mp4' });
      }
    } catch (e) { logger.warn({ err: String(e).slice(0, 200) }, '视频合成失败'); }
    try { for (const f of readdirSync(this.frameDir)) rmSync(join(this.frameDir, f)); } catch { /* ignore */ }
    return out;
  }
}

/** §10.1 默认成功标准 */
export function defaultCriteria(req: ActionRequest): { any_of: Criterion[]; within_ms: number } {
  switch (req.verb) {
    case 'click': case 'long_press': return { any_of: [{ kind: 'url_changed' }, { kind: 'dom_changed' }, { kind: 'dialog_opened' }], within_ms: 3000 };
    case 'type': return { any_of: [{ kind: 'dom_changed' }, { kind: 'url_changed' }], within_ms: 2000 };
    case 'navigate': case 'back': case 'reload': return { any_of: [{ kind: 'url_changed' }, { kind: 'dom_changed' }], within_ms: 8000 };
    case 'scroll': return { any_of: [{ kind: 'viewport_changed' }], within_ms: 1500 };
    case 'upload': return { any_of: [{ kind: 'file_attached', name: String(req.args?.file ?? '').split('/').pop() ?? '' }, { kind: 'dom_changed' }], within_ms: 5000 };
    case 'wait': return { any_of: [{ kind: 'dom_changed' }, { kind: 'network_settled', max_ms: 1000 }], within_ms: 1000 };
    case 'hover': return { any_of: [{ kind: 'dom_changed' }], within_ms: 1500 };
    case 'select': case 'drag': case 'key': return { any_of: [{ kind: 'dom_changed' }, { kind: 'url_changed' }], within_ms: 3000 };
    case 'speak': case 'show_camera': return { any_of: [{ kind: 'dom_changed' }], within_ms: 5000 };
    default: return { any_of: [{ kind: 'network_settled', max_ms: 1000 }, { kind: 'dom_changed' }], within_ms: 1500 };
  }
}
