#!/usr/bin/env node
/**
 * build-shots.mjs — 给首页的配图截图：一台正在运行的 Jobs 的首屏，每种语言 × 明暗两种外观各一张，另加一张分享图 og.png。
 *
 *   node site/scripts/build-shots.mjs [Jobs 的地址，默认 http://127.0.0.1:5320]
 *
 * 需要：那台 Jobs 不设访客口令（或者已经在同一个浏览器里登录过）、城里有人、发布过产品；仓库依赖已安装（用的是 packages/executor 里的 playwright 与 sharp）。
 * 界面改了之后运行一次，再运行 build.mjs（图片内容变了，页面里的 ?v= 要跟着变），产物一起提交。
 * 页头的累计花费是那台机器自己的数字，截图前隐藏。
 */
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LANGS } from '../src/site.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(resolve(root, '../packages/executor/package.json'));
const { chromium } = require('playwright');
const sharp = require('sharp');

const base = (process.argv[2] ?? 'http://127.0.0.1:5320').replace(/\/$/, '');
const PLACE = 'home_d'; // 镜头对准的地点（config/jobsworld/town.yaml）：锦绣花园，左右是另外两栋住宅楼
mkdirSync(resolve(root, 'shots'), { recursive: true });

const browser = await chromium.launch();
try {
  for (const l of LANGS) {
    for (const theme of ['dark', 'light']) {
      const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.5, colorScheme: theme, locale: l.htmlLang });
      // 网页自己的语言与外观设置（apps/web：jw.lang 只有 zh / en，jw.theme 是 dark / light）
      await ctx.addInitScript(([lang, t]) => { try { localStorage.setItem('jw.lang', lang === 'zh' ? 'zh' : 'en'); localStorage.setItem('jw.theme', t); } catch { /* 忽略 */ } }, [l.code, theme]);
      const page = await ctx.newPage();
      await page.goto(`${base}/?place=${PLACE}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(5000); // 等城市画出来、镜头停稳
      await page.getByRole('button', { name: 'close' }).click(); // 关掉地点面板，回到「产品 / 此刻」
      await page.evaluate(() => {
        for (const el of document.querySelectorAll('header *')) if (!el.children.length && /^\$\d/.test(el.textContent.trim())) el.style.visibility = 'hidden';
      });
      await page.waitForTimeout(1200);
      const png = await page.screenshot();
      const out = `shots/city-${l.code}-${theme}.webp`;
      await sharp(png).webp({ quality: 84, effort: 6 }).toFile(resolve(root, out));
      console.log(`已生成 ${out}`);
      if (l.code === LANGS[0].code && theme === 'dark') {
        await sharp(png).resize(1200, 630, { fit: 'cover', position: 'left top' }).png({ compressionLevel: 9, palette: true }).toFile(resolve(root, 'og.png'));
        console.log('已生成 og.png');
      }
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}
