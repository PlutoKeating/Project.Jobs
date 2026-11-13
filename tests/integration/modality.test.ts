// 集成测试：语音/相机/定位/通知/打断/弱网注入（需要本机 Chromium、ffmpeg、gcloud ADC、MinIO、Postgres）
// 运行：PUX_INTEGRATION=1 pnpm test
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dataPath, newId, Rng, type ActionRequest } from '@pux/core';
import { BrowserSession } from '@pux/executor';

const PAGE = `<!doctype html><html><body><h1>media</h1><button id="mic">mic</button><button id="cam">cam</button><button id="geo">geo</button><button id="noti">noti</button><a id="dl" href="data:text/plain,hello" download="note.md">下载</a><input id="tx"><div id="out"></div>
<script>
document.getElementById('mic').onclick=async()=>{const s=await navigator.mediaDevices.getUserMedia({audio:true});const ac=new AudioContext();const src=ac.createMediaStreamSource(s);const an=ac.createAnalyser();src.connect(an);const d=new Float32Array(an.fftSize);let peak=0;const t0=Date.now();while(Date.now()-t0<2500){await new Promise(r=>setTimeout(r,50));an.getFloatTimeDomainData(d);for(const v of d)peak=Math.max(peak,Math.abs(v));}document.getElementById('out').textContent='peak='+peak.toFixed(3);};
document.getElementById('cam').onclick=async()=>{const s=await navigator.mediaDevices.getUserMedia({video:true});const v=document.createElement('video');v.srcObject=s;await v.play();await new Promise(r=>setTimeout(r,700));const c=document.createElement('canvas');c.width=64;c.height=48;const x=c.getContext('2d');x.drawImage(v,0,0,64,48);const p=x.getImageData(0,0,64,48).data;let r=0,g=0;for(let i=0;i<p.length;i+=4){r+=p[i];g+=p[i+1];}document.getElementById('out').textContent='red='+(r>g*1.5);};
document.getElementById('geo').onclick=()=>navigator.geolocation.getCurrentPosition(p=>{document.getElementById('out').textContent='lat='+p.coords.latitude.toFixed(2);});
document.getElementById('noti').onclick=()=>new Notification('hello',{body:'world'});
document.addEventListener('visibilitychange',()=>{document.title='vis:'+document.visibilityState;});
</script></body></html>`;

const run = process.env.PUX_INTEGRATION === '1' ? describe : describe.skip;
run('模态注入与打断（集成）', () => {
  let server: ReturnType<typeof createServer>; let url = ''; let s: BrowserSession;
  const req = (verb: ActionRequest['verb'], extra: Partial<ActionRequest> = {}): ActionRequest => ({ action_id: newId('act'), session_id: 'it', step_idx: 0, verb, intent_text: verb, success: { any_of: [{ kind: 'dom_changed' }], within_ms: 6000 }, motor: { precision: 1, typing_cps: 10, typo_rate: 0, one_handed: false, double_tap_risk: 0 }, timeout_ms: 20000, ...extra });
  beforeAll(async () => {
    server = createServer((_q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(PAGE); });
    await new Promise<void>((res) => server.listen(0, '127.0.0.1', () => res()));
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
    s = await BrowserSession.launch({ sessionId: newId('it'), executor: 'playwright', policy: { child: false, allow_real_payment: false, sandbox_domains: ['127.0.0.1'] }, rng: new Rng(1), record: { video: false, rrweb: false, axe: false } });
    await s.page.goto(url);
    await s.observe('it', 0);
  }, 60000);
  afterAll(async () => { await s?.close(); server?.close(); });

  it('speak：TTS 语音注入到假麦克风', async () => {
    const r = await s.act(req('speak', { target: { by: 'selector', value: '#mic' }, args: { text: '帮我写一份周报' } }));
    expect(r.status).not.toBe('failed');
    await s.page.waitForFunction(() => document.getElementById('out')!.textContent!.startsWith('peak='), undefined, { timeout: 15000 });
    const peak = Number((await s.page.textContent('#out'))!.split('=')[1]);
    expect(peak).toBeGreaterThan(0.01);
  }, 90000);

  it('show_camera：图片注入到假摄像头', async () => {
    const dir = dataPath('runtime', 'it'); mkdirSync(dir, { recursive: true });
    const img = join(dir, 'red.png'); execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=320x240', '-frames:v', '1', img]);
    // 摄像头文件在打开设备时读取：先写入 y4m，再点击按钮
    await s.act(req('show_camera', { target: { by: 'selector', value: '#cam' }, args: { image: img } }));
    await s.page.waitForFunction(() => document.getElementById('out')!.textContent!.startsWith('red='), undefined, { timeout: 15000 });
    expect(await s.page.textContent('#out')).toBe('red=true');
  }, 60000);

  it('set_location + 通知拦截', async () => {
    await s.act(req('set_location', { args: { lat: 31.23, lng: 121.47 } }));
    await s.act(req('click', { target: { by: 'selector', value: '#geo' } }));
    await s.page.waitForFunction(() => document.getElementById('out')!.textContent!.startsWith('lat='));
    expect(await s.page.textContent('#out')).toBe('lat=31.23');
    await s.act(req('click', { target: { by: 'selector', value: '#noti' } }));
    const o = await s.observe('it', 1);
    expect(o.notifications.join()).toContain('hello');
  }, 60000);

  it('switch_away / return 改变页面可见性', async () => {
    await s.act(req('switch_away', { injected: true }));
    expect(await s.page.title()).toBe('vis:hidden');
    await s.act(req('return', { injected: true }));
    expect(await s.page.title()).toBe('vis:visible');
  }, 30000);

  it('下载有可感知反馈，粘贴一次性插入长文本', async () => {
    await s.observe('it', 2);
    await s.act(req('click', { target: { by: 'selector', value: '#dl' } }));
    await new Promise((r) => setTimeout(r, 1500));
    const o = await s.observe('it', 3);
    expect(o.notifications.join()).toContain('note.md');
    const long = '会议记录'.repeat(200);
    const t0 = Date.now();
    await s.act(req('type', { target: { by: 'selector', value: '#tx' }, args: { text: long, paste: true } }));
    expect(Date.now() - t0).toBeLessThan(8000);
    expect((await s.page.inputValue('#tx')).length).toBe(long.length);
  }, 60000);

  it('弱网注入被标记为 injected', async () => {
    await s.setNetwork({ down_kbps: 50, up_kbps: 20, rtt_ms: 800 });
    expect(s.injectedNetwork).toBe(true);
    const t0 = Date.now(); await s.page.reload(); expect(Date.now() - t0).toBeGreaterThan(700);
    await s.setNetwork(null);
  }, 60000);
});
