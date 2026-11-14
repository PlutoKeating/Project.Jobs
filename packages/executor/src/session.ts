import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium, type Browser, type BrowserContext, type CDPSession, type Dialog, type Page, type Request } from 'playwright';
import { localBrowser, Stagehand } from '@browserbasehq/stagehand';
import {
  dataPath, env, logger, makeError, newId, shortHash,
  type ActionRequest, type ActionResult, type Criterion, type Executor, type MotorProfile, type Observation, type Rng, type TargetRef, type UIElement, type UAPError,
} from '@pux/core';
import { gateway } from '@pux/llm';
import { putEvidence, type EvidenceCtx } from './evidence.ts';
import { checkPolicy, type SafetyPolicy } from './policy.ts';
import { ModalityFiles } from './modality.ts';
import { EXTRACT_SCRIPT, INIT_SCRIPT, PROBE_SCRIPT } from './page-scripts.ts';

const run = promisify(execFile);
const require = createRequire(import.meta.url);
const RRWEB_SRC = (() => { try { return readFileSync(require.resolve('@rrweb/record/dist/record.umd.min.cjs'), 'utf8'); } catch { return ''; } })();
const RRWEB_BOOT = `(() => { try { if (window.__puxRr || !window.rrwebRecord) return; window.__puxRr = []; window.rrwebRecord.record({ emit(e) { window.__puxRr.push(e); if (window.__puxRr.length > 20000) window.__puxRr.splice(0, 5000); }, sampling: { mousemove: 50, scroll: 150, input: 'last' }, maskAllInputs: false, recordCanvas: false }); } catch (e) {} })();`;

export interface SessionOptions {
  sessionId: string; studyId?: string; personaId?: string;
  executor: 'stagehand' | 'midscene' | 'playwright';
  headed?: boolean;
  mobile?: boolean;
  locale?: string;
  timezone?: string;
  policy: SafetyPolicy;
  record?: { video?: boolean; rrweb?: boolean; axe?: boolean };
  rng: Rng;
  geolocation?: { latitude: number; longitude: number } | null;   // null：拒绝定位授权
  deviceStateFile?: string;   // 同一 Persona 在同一 Study 内复用设备状态（Cookie），模拟同一台手机/电脑
}

interface NetState { inflight: Map<Request, number>; failed: { url: string; status: number; method?: string; at: number }[]; slowest: number; total: number; log: unknown[] }

const freePort = () => new Promise<number>((res, rej) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => res(p)); }); s.on('error', rej); });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const iso = () => new Date().toISOString();

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
 * 一个 Session 的浏览器沙箱：独立浏览器进程 + BrowserContext + 证据采集。
 * 浏览器由 Stagehand 的 localBrowser 启动（Stagehand v4 运行时以扩展形式驻留），Playwright 通过 CDP 接入同一浏览器。
 */
export class BrowserSession implements Executor {
  readonly name: string;
  private sb!: Awaited<ReturnType<typeof localBrowser.launch>>;
  private sh?: Stagehand;
  private pw!: Browser;
  ctx!: BrowserContext;
  page!: Page;
  private cdp?: CDPSession;
  private mid?: { aiLocate(p: string): Promise<{ rect: { left: number; top: number; width: number; height: number }; center: [number, number] }> };
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
  private seenStates = new Set<string>();
  private frameDir: string;
  private frames: { file: string; t: number }[] = [];
  private rrEvents: unknown[] = [];
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

  private async start() {
    const o = this.opts;
    await this.modality.prepare();
    this.cdpPort = await freePort();
    const viewport = o.mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 };
    this.sb = await localBrowser.launch({
      headless: !o.headed, chromiumSandbox: false, executablePath: chromium.executablePath(), port: this.cdpPort,
      viewport, locale: o.locale ?? 'zh-CN', hasTouch: !!o.mobile,
      args: [...this.modality.launchArgs(), '--disable-features=Translate', '--lang=' + (o.locale ?? 'zh-CN'), '--remote-allow-origins=*'],
      userDataDir: join(this.modality.dir, 'profile'),
      acceptDownloads: true, downloadsPath: join(this.modality.dir, 'downloads'),
    });
    if (o.executor === 'stagehand') this.sh = await Stagehand.create({ browser: this.sb, model: { generate: stagehandGenerate(this.ev) } as never, domSettleTimeoutMs: 3000 });
    this.pw = await chromium.connectOverCDP(this.cdpUrl);
    this.ctx = this.pw.contexts()[0];
    await this.ctx.addInitScript(INIT_SCRIPT);
    if (o.record?.rrweb !== false && RRWEB_SRC) await this.ctx.addInitScript(`${RRWEB_SRC}\n;${RRWEB_BOOT}`);
    const perms = ['notifications', 'microphone', 'camera', 'clipboard-read', 'clipboard-write'];
    if (o.geolocation !== null) perms.push('geolocation');
    await this.ctx.grantPermissions(perms).catch(() => {});
    if (o.geolocation) await this.ctx.setGeolocation({ ...o.geolocation, accuracy: 50 }).catch(() => {});
    try { const bs = await this.pw.newBrowserCDPSession(); await bs.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: join(this.modality.dir, 'downloads'), eventsEnabled: true }); } catch { /* ignore */ }
    if (o.deviceStateFile && existsSync(o.deviceStateFile)) {
      try { const st = JSON.parse(readFileSync(o.deviceStateFile, 'utf8')) as { cookies: Parameters<BrowserContext['addCookies']>[0] }; await this.ctx.addCookies(st.cookies); } catch (e) { logger.debug({ e }, '设备状态恢复失败'); }
    }
    this.page = this.ctx.pages().find((pg) => !pg.url().startsWith('chrome-extension://')) ?? await this.ctx.newPage();
    this.attachPage(this.page);
    if (o.executor === 'midscene') await this.initMidscene();
    if (o.record?.video !== false) await this.startScreencast();
  }

  private async initMidscene() {
    process.env.MIDSCENE_MODEL_BASE_URL = `${env.litellmBaseUrl}/v1`;
    process.env.MIDSCENE_MODEL_API_KEY = env.litellmKey;
    process.env.MIDSCENE_MODEL_NAME = 'operator.locate';
    process.env.MIDSCENE_MODEL_FAMILY = 'gemini';
    process.env.MIDSCENE_MODEL_REASONING_ENABLED = 'default';
    process.env.MIDSCENE_RUN_DIR = dataPath('runtime', this.opts.sessionId, 'midscene');
    const { PlaywrightAgent } = await import('@midscene/web/playwright/agent');
    this.mid = new PlaywrightAgent(this.page as never, { generateReport: false } as never) as never;
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
    // 只跟随被测页面自己打开的新标签页（例如 target=_blank），忽略 Stagehand 扩展等后台页面
    p.on('popup', (np) => { this.page = np; this.attachPage(np); });
  }

  private async startScreencast() {
    try {
      mkdirSync(this.frameDir, { recursive: true });
      this.cdp = await this.ctx.newCDPSession(this.page);
      let i = 0;
      this.cdp.on('Page.screencastFrame', (f: { data: string; sessionId: number }) => {
        const file = join(this.frameDir, `f${String(i++).padStart(6, '0')}.jpg`);
        try { writeFileSync(file, Buffer.from(f.data, 'base64')); this.frames.push({ file, t: Date.now() }); } catch { /* ignore */ }
        this.cdp?.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
      });
      await this.cdp.send('Page.startScreencast', { format: 'jpeg', quality: 45, maxWidth: 960, maxHeight: 960, everyNthFrame: 3 });
    } catch (e) { logger.debug({ e }, 'screencast 不可用'); }
  }

  // ------------------------------------------------------------------ observe
  async observe(_session_id?: string, stepIdx = 0): Promise<Observation & { elements: UIElement[]; captcha: boolean; text: string }> {
    const obs_id = newId('obs');
    const ctx = { ...this.ev, step_idx: stepIdx };
    let extracted: { elements: UIElement[]; captcha: boolean; text: string; scroll: { y: number; max_y: number }; notifications: string[]; hidden: boolean; dialogsInDom: number };
    const dialogOpen = !!this.pendingDialog;
    if (dialogOpen) {
      extracted = { elements: [], captcha: false, text: '', scroll: { y: 0, max_y: 0 }, notifications: [], hidden: false, dialogsInDom: 1 };
    } else {
      await this.page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
      extracted = await this.page.evaluate(EXTRACT_SCRIPT).catch(async () => { await sleep(800); return this.page.evaluate(EXTRACT_SCRIPT); }).catch(() => ({ elements: [], captcha: false, text: '', scroll: { y: 0, max_y: 0 }, notifications: [], hidden: false, dialogsInDom: 0 })) as typeof extracted;
    }
    const elements: UIElement[] = extracted.elements;
    if (this.pendingDialog) {
      const d = this.pendingDialog;
      elements.unshift(
        { ref: 'dlg_ok', role: 'button', name: d.type() === 'alert' ? '确定 (浏览器弹窗)' : '确定 (浏览器确认框)', tag: 'dialog', bbox: [540, 300, 80, 32], in_viewport: true, occluded: false, selector: 'dialog:accept', kind: 'interactive' },
        ...(d.type() !== 'alert' ? [{ ref: 'dlg_cancel', role: 'button', name: '取消 (浏览器确认框)', tag: 'dialog', bbox: [640, 300, 80, 32] as [number, number, number, number], in_viewport: true, occluded: false, selector: 'dialog:dismiss', kind: 'interactive' as const }] : []),
      );
    }
    const url = this.page.url();
    const title = dialogOpen ? (this.lastObs?.title ?? '') : await this.page.title().catch(() => '');
    const state_id = stateIdOf(url, elements, dialogOpen || extracted.dialogsInDom > 0);
    const isNew = !this.seenStates.has(state_id);
    this.seenStates.add(state_id);

    let screenshot_ev = this.lastScreenshotEv;
    if (!dialogOpen) {
      const shot = await this.page.screenshot({ type: 'jpeg', quality: 70, timeout: 10000 }).catch(() => null);
      if (shot) { screenshot_ev = await putEvidence('screenshot', ctx, { data: shot, mime: 'image/jpeg' }); this.lastScreenshotEv = screenshot_ev; }
    }
    const aria = dialogOpen ? `dialog: ${this.pendingDialog?.message()}` : await this.page.locator('body').ariaSnapshot({ timeout: 5000 }).catch(() => '');
    const a11y_ev = await putEvidence('a11y', ctx, { data: aria || '(empty)', mime: 'text/plain' });
    if (isNew && !dialogOpen && this.opts.record?.axe !== false) await this.runAxe(state_id, ctx).catch((e) => logger.debug({ e }, 'axe 失败'));
    await this.drainRrweb();

    const vp = this.page.viewportSize() ?? { width: 1280, height: 800 };
    const dpr = await this.page.evaluate('window.devicePixelRatio').catch(() => 1) as number;
    const obs: Observation & { elements: UIElement[]; captcha: boolean; text: string } = {
      obs_id, ts: iso(), url, title, viewport: { w: vp.width, h: vp.height, dpr },
      state_id, screenshot_ev, a11y_ev,
      visible_text_digest: extracted.text.slice(0, 1500),
      console_errors: this.consoleErrors.splice(0),
      network: { pending: this.net.inflight.size, failed: this.net.failed.splice(0).map(({ url, status, method }) => ({ url, status, method })), slowest_ms: this.net.slowest, requests: this.net.total },
      dialogs: [...this.dialogLog.splice(0), ...(extracted.dialogsInDom > 0 ? ['(页面内弹层)'] : [])],
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

  // ------------------------------------------------------------------ act
  async act(req: ActionRequest, rng?: Rng): Promise<ActionResult> {
    const r = rng ?? this.opts.rng;
    const started = Date.now(); const started_at = iso();
    const before_obs = this.lastObs?.obs_id ?? '';
    const ctx = { ...this.ev, step_idx: req.step_idx };
    const motor = req.motor ?? DEFAULT_MOTOR;
    const result = (status: ActionResult['status'], extra: Partial<ActionResult> = {}): ActionResult => ({
      action_id: req.action_id, status, matched_criteria: [], started_at, ended_at: iso(), duration_ms: Date.now() - started,
      executor: { name: this.name, version: this.name === 'stagehand' ? '4.4.0' : this.name === 'midscene' ? '1.17.8' : 'playwright-1.65', model_alias: 'operator.locate' },
      before_obs, after_obs: '', effects: { url_changed: false, dom_changed: false, requests: 0, new_dialog: false }, evidence_ids: [], ...extra,
    });

    // 1) 解析目标
    let el: UIElement | undefined; let point: [number, number] | undefined; let resolved: TargetRef | undefined;
    const needsTarget = ['click', 'long_press', 'hover', 'type', 'select', 'upload', 'drag'].includes(req.verb) || (['speak', 'show_camera'].includes(req.verb) && !!req.target);
    if (req.target && needsTarget) {
      const res = await this.resolveTarget(req.target, req.intent_text).catch((e) => ({ error: makeError('EXEC_TARGET_NOT_FOUND', String((e as Error).message).slice(0, 200)) }));
      if ('error' in res) return result('failed', { error: res.error });
      ({ el, point } = res); resolved = res.resolved;
      if (el?.occluded && !el.selector.startsWith('dialog:')) return result('failed', { error: makeError('EXEC_INTERCEPTED', `目标「${el.name}」被其他元素遮挡`), resolved_target: resolved });
    } else if (needsTarget && req.verb !== 'type') {
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
    const req0 = this.net.total; const failed0 = this.net.failed.length; const pageErr0 = this.pageErrors.length; const dlg0 = this.dialogLog.length;
    let motorMiss = false; let extraErr: UAPError | undefined;
    try {
      switch (req.verb) {
        case 'navigate': await this.page.goto(String(req.args?.url), { waitUntil: 'domcontentloaded', timeout: req.timeout_ms || 20000 }); break;
        case 'back': await this.page.goBack({ timeout: 10000 }).catch(() => null); break;
        case 'reload': await this.page.reload({ timeout: 20000 }); break;
        case 'click': case 'long_press': case 'hover': {
          if (el?.selector.startsWith('dialog:')) { await this.handleDialog(el.selector === 'dialog:accept', req.args?.text as string | undefined); break; }
          const p = this.motorPoint(el, point, motor, r);
          motorMiss = p.miss;
          await this.page.mouse.move(p.x, p.y, { steps: 4 });
          if (req.verb === 'hover') { await sleep(600); break; }
          if (req.verb === 'long_press') { await this.page.mouse.down(); await sleep(900); await this.page.mouse.up(); break; }
          await this.page.mouse.click(p.x, p.y, { clickCount: r.bool(motor.double_tap_risk) ? 2 : 1 });
          break;
        }
        case 'type': {
          if (el?.selector.startsWith('dialog:')) { await this.handleDialog(true, String(req.args?.text ?? '')); break; }
          if (el) { const p = this.motorPoint(el, point, motor, r); await this.page.mouse.click(p.x, p.y); motorMiss = p.miss; }
          if (req.args?.clear) { await this.page.keyboard.press('Control+A'); await this.page.keyboard.press('Backspace'); }
          if (req.args?.paste) await this.page.keyboard.insertText(String(req.args?.text ?? ''));
          else await this.humanType(String(req.args?.text ?? ''), motor, r);
          if (req.args?.submit) await this.page.keyboard.press('Enter');
          break;
        }
        case 'key': await this.page.keyboard.press(String(req.args?.key ?? 'Enter')); break;
        case 'scroll': {
          const dir = req.args?.direction === 'up' ? -1 : 1; const amount = Number(req.args?.amount ?? 600) * dir;
          if (el) await this.page.mouse.move(el.bbox[0] + el.bbox[2] / 2, el.bbox[1] + el.bbox[3] / 2);
          else { const vp = this.page.viewportSize(); await this.page.mouse.move((vp?.width ?? 1280) / 2, (vp?.height ?? 800) / 2); }
          await this.page.mouse.wheel(0, amount); await sleep(400); break;
        }
        case 'select': await this.page.locator(el!.selector).selectOption({ label: String(req.args?.value) }).catch(() => this.page.locator(el!.selector).selectOption(String(req.args?.value))); break;
        case 'upload': {
          const file = String(req.args?.file ?? '');
          if (!existsSync(file)) throw Object.assign(new Error(`测试素材不存在：${file}`), { code: 'SIM_INVALID_INTENT' });
          const tag = el?.tag;
          if (tag === 'input') await this.page.locator(el!.selector).setInputFiles(file);
          else { const [fc] = await Promise.all([this.page.waitForEvent('filechooser', { timeout: 5000 }), this.page.mouse.click(point![0], point![1])]); await fc.setFiles(file); }
          break;
        }
        case 'drag': {
          const to = req.args?.to as TargetRef | undefined; const dest = to ? await this.resolveTarget(to, req.intent_text) : undefined;
          const p = this.motorPoint(el, point, motor, r);
          await this.page.mouse.move(p.x, p.y); await this.page.mouse.down();
          const tp = dest && !('error' in dest) ? dest.point : [p.x, p.y + Number(req.args?.dy ?? 200)];
          await this.page.mouse.move(tp[0], tp[1], { steps: 12 }); await this.page.mouse.up(); break;
        }
        case 'wait': {
          const max = Number(req.args?.seconds ?? 10) * 1000;
          await this.waitForSettle(max, String(req.args?.until_text ?? ''));
          break;
        }
        case 'speak': {
          const sp = await this.modality.speak(String(req.args?.text ?? ''), this.opts.locale);
          if (el) { const p = this.motorPoint(el, point, motor, r); await this.page.mouse.click(p.x, p.y); }
          await sleep(Math.min(12000, sp.seconds * 1000 + 800));
          if (el && req.args?.toggle_stop) await this.page.mouse.click(point![0], point![1]);
          break;
        }
        case 'show_camera': {
          await this.modality.showCamera({ imagePath: req.args?.image as string | undefined, prompt: req.args?.prompt as string | undefined });
          if (el) { const p = this.motorPoint(el, point, motor, r); await this.page.mouse.click(p.x, p.y); }
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

    // 4) 成功标准
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
    const effects = { url_changed: probe1.url !== probe0.url, dom_changed: probe1.mutations > probe0.mutations, requests: this.net.total - req0, new_dialog: this.dialogLog.length > dlg0 || probe1.dialogsInDom > probe0.dialogsInDom };
    const newFailed = this.net.failed.slice(failed0);
    const evIds = [await putEvidence('action', ctx, { inline: { req: { ...req, motor }, resolved: resolved ?? null, effects, matched } })];

    let status: ActionResult['status'] = matched.length ? 'success' : 'no_effect';
    let error = extraErr;
    if (newFailed.some((f) => f.status >= 500)) { error = makeError('PRODUCT_HTTP_5XX', `接口返回 ${newFailed.find((f) => f.status >= 500)!.status}：${newFailed.find((f) => f.status >= 500)!.url}`); status = matched.length ? 'success' : 'failed'; }
    else if (this.pageErrors.length > pageErr0 && !matched.length) { error = makeError('PRODUCT_JS_ERROR', this.pageErrors[this.pageErrors.length - 1]); status = 'failed'; }
    else if (newFailed.some((f) => f.status === 0) && this.injectedNetwork && !matched.length) { error = makeError('INJECTED_NETWORK', '注入的弱网导致请求失败'); status = 'failed'; }
    else if (extraErr) status = 'failed';
    else if (!matched.length && req.verb === 'click' && motorMiss) {
      // WCAG 2.2 目标尺寸（24×24）；行内文本链接豁免
      const inlineText = el?.role === 'link' && (el.text_len ?? 0) >= 4;
      const small = !!el && !inlineText && el.bbox[2] < 24 && el.bbox[3] < 24;
      error = makeError(small ? 'PRODUCT_SMALL_TARGET' : 'SIM_MOTOR_MISS', small ? `目标「${el!.name}」尺寸过小（${el!.bbox[2]}×${el!.bbox[3]}px），按动作精度未点中` : '动作精度导致未点中');
    } else if (!matched.length && effects.requests > 0 && ['click', 'key', 'type'].includes(req.verb)) {
      error = makeError('PRODUCT_NO_FEEDBACK', '动作触发了请求，但界面没有任何可见反馈');
    }
    if (this.pendingDialog && req.verb !== 'click') { /* 弹窗阻塞 */ }
    return result(status, { matched_criteria: matched, error, resolved_target: resolved, effects, evidence_ids: evIds });
  }

  /** 解析 TargetRef → 元素与点击坐标 */
  async resolveTarget(t: TargetRef, intent: string): Promise<{ el?: UIElement; point: [number, number]; resolved: TargetRef }> {
    const els = this.lastObs?.elements ?? [];
    const centerOf = (e: UIElement): [number, number] => [e.bbox[0] + e.bbox[2] / 2, e.bbox[1] + e.bbox[3] / 2];
    const mk = (e: UIElement | undefined, point: [number, number], by: TargetRef['by']): { el?: UIElement; point: [number, number]; resolved: TargetRef } => ({ el: e, point, resolved: { by, value: t.value, resolved: { selector: e?.selector, bbox: e?.bbox, a11y_role: e?.role, a11y_name: e?.name, in_perceived_view: true } } });
    const refreshBox = async (e: UIElement) => {
      if (e.selector.startsWith('dialog:')) return e;
      const loc = this.page.locator(e.selector).first();
      await loc.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
      const b = await loc.boundingBox({ timeout: 3000 }).catch(() => null);
      if (!b) throw Object.assign(new Error(`目标「${e.name}」已不在页面上`), { code: 'EXEC_TARGET_NOT_FOUND' });
      const occluded = await loc.evaluate((node, [x, y]) => { const top = document.elementFromPoint(x, y); return !!top && top !== node && !node.contains(top) && !top.contains(node); }, [b.x + b.width / 2, b.y + b.height / 2]).catch(() => false);
      return { ...e, bbox: [b.x, b.y, b.width, b.height] as [number, number, number, number], occluded };
    };
    if (this.opts.executor === 'midscene' && t.by !== 'coords') {
      const desc = t.by === 'ref' ? (els.find((e) => e.ref === t.value)?.name ?? intent) : t.value;
      const dlg = els.find((e) => e.ref === t.value && e.selector.startsWith('dialog:'));
      if (dlg) return mk(dlg, centerOf(dlg), 'ref');
      const loc = await this.mid!.aiLocate(desc || intent);
      const pt: [number, number] = [loc.center[0], loc.center[1]];
      const hit = els.find((e) => e.kind === 'interactive' && pt[0] >= e.bbox[0] && pt[0] <= e.bbox[0] + e.bbox[2] && pt[1] >= e.bbox[1] && pt[1] <= e.bbox[1] + e.bbox[3]);
      return { el: hit ? { ...hit } : { ref: 'vis', role: 'unknown', name: desc, tag: 'visual', bbox: [loc.rect.left, loc.rect.top, loc.rect.width, loc.rect.height], in_viewport: true, occluded: false, selector: `coords=${pt.join(',')}`, kind: 'interactive' }, point: pt, resolved: { by: 'visual', value: desc, resolved: { bbox: [loc.rect.left, loc.rect.top, loc.rect.width, loc.rect.height], a11y_name: hit?.name, in_perceived_view: true } } };
    }
    switch (t.by) {
      case 'ref': {
        const e = els.find((x) => x.ref === t.value);
        if (!e) throw Object.assign(new Error(`元素编号 ${t.value} 不存在`), { code: 'SIM_INVALID_INTENT' });
        const fresh = await refreshBox(e); return mk(fresh, centerOf(fresh), 'ref');
      }
      case 'coords': { const [x, y] = t.value.split(',').map(Number); return mk(undefined, [x, y], 'coords'); }
      case 'selector': case 'a11y': case 'text': {
        const loc = t.by === 'selector' ? this.page.locator(t.value).first()
          : t.by === 'text' ? this.page.getByText(t.value, { exact: false }).first()
            : (() => { const m = /^role=(\w+)(?:\[name=(.+)\])?$/.exec(t.value); return m ? this.page.getByRole(m[1] as never, m[2] ? { name: m[2] } : {}).first() : this.page.locator(t.value).first(); })();
        const cnt = await loc.count().catch(() => 0);
        if (!cnt) throw Object.assign(new Error(`找不到目标 ${t.value}`), { code: 'EXEC_TARGET_NOT_FOUND' });
        await loc.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
        const b = await loc.boundingBox(); if (!b) throw Object.assign(new Error('目标不可见'), { code: 'EXEC_TARGET_NOT_FOUND' });
        const e: UIElement = { ref: 'sel', role: 'unknown', name: t.value, tag: 'unknown', bbox: [b.x, b.y, b.width, b.height], in_viewport: true, occluded: false, selector: t.by === 'selector' ? t.value : `xpath=${await loc.evaluate((n) => { const p: string[] = []; for (let e: Element | null = n as Element; e && e.nodeType === 1; e = e.parentElement) { let i = 1; for (let s = e.previousElementSibling; s; s = s.previousElementSibling) if (s.nodeName === e.nodeName) i++; p.unshift(`${e.nodeName.toLowerCase()}[${i}]`); } return '/' + p.join('/'); })}`, kind: 'interactive' };
        return mk(e, centerOf(e), t.by);
      }
      case 'visual': default: {
        if (!this.sh) throw Object.assign(new Error('visual 定位需要 stagehand 或 midscene 执行器'), { code: 'EXEC_UNSUPPORTED' });
        const r = await this.sh.observe(t.value || intent);
        const a = (r as unknown as { data: { selector: string; description: string }[] }).data?.[0];
        if (!a) throw Object.assign(new Error(`Stagehand 未找到：${t.value}`), { code: 'EXEC_TARGET_NOT_FOUND' });
        const loc = this.page.locator(a.selector).first();
        await loc.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
        const b = await loc.boundingBox(); if (!b) throw Object.assign(new Error('Stagehand 定位的元素不可见'), { code: 'EXEC_TARGET_NOT_FOUND' });
        const known = els.find((e) => e.selector === a.selector);
        const e: UIElement = known ? { ...known, bbox: [b.x, b.y, b.width, b.height] } : { ref: 'sh', role: 'unknown', name: a.description, tag: 'unknown', bbox: [b.x, b.y, b.width, b.height], in_viewport: true, occluded: false, selector: a.selector, kind: 'interactive' };
        return { el: e, point: centerOf(e), resolved: { by: 'visual', value: t.value, resolved: { selector: a.selector, bbox: e.bbox, a11y_name: a.description, in_perceived_view: true } } };
      }
    }
  }

  /** 按 MotorProfile 计算实际落点（精度越低偏移越大，可能点偏） */
  private motorPoint(el: UIElement | undefined, point: [number, number] | undefined, motor: MotorProfile, r: Rng) {
    const [cx, cy] = point ?? [640, 400];
    if (!el) return { x: cx, y: cy, miss: false };
    const [x, y, w, h] = el.bbox;
    const spread = (1 - motor.precision) * (motor.one_handed ? 1.6 : 1) * 22;   // 像素级抖动
    const px = cx + r.normal(0, spread); const py = cy + r.normal(0, spread);
    const miss = px < x || px > x + w || py < y || py > y + h;
    return { x: Math.max(1, px), y: Math.max(1, py), miss };
  }

  /** 按速度与错字率逐字输入；真实耗时被压缩（模拟时钟另行按 typing_cps 结算） */
  private async humanType(text: string, motor: MotorProfile, r: Rng) {
    const keys = 'qwertyuiopasdfghjklzxcvbnm';
    for (const ch of text) {
      if (/[a-z]/i.test(ch) && r.bool(motor.typo_rate * (motor.one_handed ? 2 : 1))) {
        await this.page.keyboard.type(keys[r.int(0, keys.length - 1)], { delay: 15 });
        await this.page.keyboard.press('Backspace');
      }
      await this.page.keyboard.type(ch, { delay: Math.min(35, 1000 / Math.max(1, motor.typing_cps) / 8) });
    }
  }

  private async handleDialog(accept: boolean, promptText?: string) {
    const d = this.pendingDialog; this.pendingDialog = undefined;
    if (!d) return;
    if (accept) await d.accept(promptText).catch(() => {}); else await d.dismiss().catch(() => {});
  }

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
        case 'value_equals': {
          const sel = req.target?.resolved?.selector ?? (req.target?.by === 'ref' ? this.lastObs?.elements.find((e) => e.ref === req.target!.value)?.selector : undefined);
          if (sel) { const v = await this.page.locator(sel).first().inputValue({ timeout: 1000 }).catch(() => this.page.locator(sel).first().innerText({ timeout: 1000 }).catch(() => '')); if (v.includes(c.value) || c.value.includes(v) && v.length > 0) out.push('value_equals'); }
          else if (p1.mutations > p0.mutations) out.push('value_equals');
          break;
        }
        case 'file_attached': if (await this.page.getByText(c.name, { exact: false }).first().isVisible().catch(() => false)) out.push('file_attached'); break;
      }
    }
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
  async switchAway() { this.hiddenSince = Date.now(); await this.page.evaluate('window.__pux && window.__pux.setHidden(true)').catch(() => {}); await this.cdp?.send('Page.setWebLifecycleState', { state: 'frozen' }).catch(() => {}); }
  async returnBack() { await this.cdp?.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => {}); await this.page.evaluate('window.__pux && window.__pux.setHidden(false)').catch(() => {}); this.hiddenSince = undefined; }
  async closeTab() { const url = this.page.url(); await this.page.close().catch(() => {}); this.page = await this.ctx.newPage(); this.attachPage(this.page); this.lastUrl = url; }
  async reopenLast() { if (this.lastUrl) await this.page.goto(this.lastUrl, { waitUntil: 'domcontentloaded' }).catch(() => {}); }

  /** 弱网注入（Chromium 网络条件模拟），标记为 injected */
  async setNetwork(p: { down_kbps: number; up_kbps: number; rtt_ms: number; offline?: boolean } | null) {
    const s = this.cdp ?? await this.ctx.newCDPSession(this.page);
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
    await this.sh?.close().catch(() => {});
    await this.pw?.close().catch(() => {});
    await this.sb?.close().catch(() => {});
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
    try { for (const f of readdirSync(this.frameDir)) rmSync(join(this.frameDir, f)); rmSync(join(this.modality.dir, 'profile'), { recursive: true, force: true }); } catch { /* ignore */ }
    return out;
  }
}

/** §10.1 默认成功标准 */
export function defaultCriteria(req: ActionRequest): { any_of: Criterion[]; within_ms: number } {
  switch (req.verb) {
    case 'click': case 'long_press': return { any_of: [{ kind: 'url_changed' }, { kind: 'dom_changed' }, { kind: 'dialog_opened' }], within_ms: 3000 };
    case 'type': return { any_of: [{ kind: 'value_equals', target: req.target!, value: String(req.args?.text ?? '') }, { kind: 'dom_changed' }], within_ms: 2000 };
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

/** Stagehand v4 的客户端 LLM：通过 LiteLLM 的 operator.locate 角色别名调用 */
function stagehandGenerate(ev: EvidenceCtx) {
  return async (req: { messages: { role: string; content: unknown }[]; systemPrompt?: string; responseFormat?: { name: string; schema: Record<string, unknown> } }) => {
    const toParts = (c: unknown): { type: string; text?: string; image_url?: { url: string } }[] => (Array.isArray(c) ? c : [c]).map((p: { type: string; text?: string; data?: string; mimeType?: string }) =>
      p.type === 'text' ? { type: 'text', text: p.text } : p.type === 'image' ? { type: 'image_url', image_url: { url: `data:${p.mimeType};base64,${p.data}` } } : { type: 'text', text: JSON.stringify(p) });
    const gw = gateway();
    const body: Record<string, unknown> = { model: 'operator.locate', messages: [...(req.systemPrompt ? [{ role: 'system', content: req.systemPrompt }] : []), ...req.messages.map((m) => ({ role: m.role, content: toParts(m.content) }))] };
    if (req.responseFormat) body.response_format = { type: 'json_schema', json_schema: { name: req.responseFormat.name, schema: req.responseFormat.schema } };
    const t0 = Date.now();
    const r = await gw.client.chat.completions.create(body as never) as { choices: { message: { content: string | null } }[]; usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } };
    const text = r.choices[0]?.message?.content ?? '';
    const usage = { inputTokens: r.usage?.prompt_tokens ?? 0, outputTokens: r.usage?.completion_tokens ?? 0, totalTokens: r.usage?.total_tokens ?? 0 };
    logger.debug({ ms: Date.now() - t0, session: ev.session_id }, 'stagehand llm');
    if (req.responseFormat) {
      let parsed: unknown = {};
      try { parsed = JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')); } catch { parsed = {}; }
      return { role: 'assistant', content: [{ type: 'text', text }], outputFormat: 'json_schema', structuredContent: parsed, usage };
    }
    return { role: 'assistant', content: [{ type: 'text', text }], outputFormat: 'text', usage };
  };
}
