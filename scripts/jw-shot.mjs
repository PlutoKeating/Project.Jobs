// 网页截图（开发自检）：node scripts/jw-shot.mjs <url> <out.png> [width] [height] [waitMs] [theme] [clickSelector]
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../packages/executor/package.json', import.meta.url))('playwright');
const [url, out, w = '1440', h = '900', wait = '2500', theme = 'dark', click] = process.argv.slice(2);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: Number(w), height: Number(h) }, colorScheme: theme === 'light' ? 'light' : 'dark' });
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await p.goto(url, { waitUntil: 'networkidle' }).catch(() => {});
await p.waitForTimeout(Number(wait));
if (click) { await p.click(click).catch((e) => errors.push(`click: ${e}`)); await p.waitForTimeout(1500); }
await p.screenshot({ path: out, fullPage: false });
if (errors.length) console.log('ERRORS:\n' + errors.slice(0, 10).join('\n'));
await b.close();
