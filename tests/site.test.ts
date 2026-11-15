// 官网（site/）：提交进仓库的产物与源一致；每种语言的每个页面都在；不向第三方请求任何东西；源码不会被发布
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '@pux/core';

const site = (p: string) => join(REPO_ROOT, 'site', p);
const read = (p: string) => readFileSync(site(p), 'utf8');

// 与 site/src/site.mjs 的 LANGS、PAGES 对应：加了语言或页面，这里跟着加
const LANGS = [{ prefix: '', htmlLang: 'zh-CN' }, { prefix: 'en/', htmlLang: 'en' }];
const PAGES = ['', 'about/', 'terms/', 'privacy/'];
const pages = LANGS.flatMap((l) => PAGES.map((p) => ({ file: `${l.prefix}${p}index.html`, lang: l.htmlLang })));
const notFound = LANGS.map((l) => ({ file: `${l.prefix}404.html`, lang: l.htmlLang }));
// 首页内联的示意图（site/src/figures.mjs）；README 另有一幅只给它用的字标条幅 banner
const FIGURES = ['journey', 'screen', 'verdict', 'loop', 'stack'];
const README_FIGURES = ['banner', ...FIGURES];

describe('官网产物', () => {
  it('与源一致：文案每种语言齐全、键对得上，中文字体子集盖住页面上的每个汉字（不一致时运行 pnpm site:build 并提交）', () => {
    expect(() => execFileSync('node', [site('scripts/build.mjs'), '--check'], { stdio: 'pipe' })).not.toThrow();
  });

  it('每种语言的每个页面都在，语言标注正确，并互相声明另一种语言的版本', () => {
    for (const p of [...pages, ...notFound]) {
      expect(existsSync(site(p.file)), p.file).toBe(true);
      expect(read(p.file), p.file).toContain(`<html lang="${p.lang}" `);
    }
    for (const p of pages) {
      const html = read(p.file);
      for (const l of LANGS) expect(html, p.file).toContain(`hreflang="${l.htmlLang}"`);
      expect(html, p.file).toContain('hreflang="x-default"');
      expect(html, p.file).toMatch(/<link rel="canonical" href="https:\/\/jobs\.plutokeating\.beer\//);
    }
    for (const p of notFound) expect(read(p.file), p.file).toContain('<meta name="robots" content="noindex">');
  });

  it('每个页面都有页眉、页脚和三个合规页面的入口', () => {
    for (const p of [...pages, ...notFound]) {
      const html = read(p.file);
      const base = p.lang === 'en' ? '/en' : '';
      expect(html, p.file).toContain('<header class="site-header">');
      expect(html, p.file).toContain('<footer class="site-footer">');
      for (const legal of ['about', 'terms', 'privacy']) expect(html, p.file).toContain(`href="${base}/${legal}"`);
      expect(html, p.file).toContain('data-theme-toggle');
      expect(html, p.file).toContain('class="lang-menu"');
      expect(html, p.file).toContain('AGPL-3.0');
    }
  });

  it('页面不向任何第三方请求资源，也不含内联样式', () => {
    for (const p of [...pages, ...notFound]) {
      const html = read(p.file);
      // 样式表、脚本、图片、字体的地址都以 / 开头（站内）；外链只出现在 <a> 和 <head> 的规范地址 / 分享信息里
      const loaded = [...html.matchAll(/<(?:link rel="(?:stylesheet|preload|icon)"[^>]*href|script[^>]*src|img[^>]*src)="([^"]+)"/g)].map((m) => m[1]);
      expect(loaded.length, p.file).toBeGreaterThan(3);
      for (const url of loaded) expect(url, `${p.file} 引用了 ${url}`).toMatch(/^\/(?!\/)/);
      expect(html, p.file).not.toMatch(/\sstyle="/);
      expect(html, p.file).not.toMatch(/<style[\s>]/);
    }
    expect(read('css/site.css')).not.toMatch(/url\((?!"\/fonts\/)/);
    expect(read('js/site.js')).not.toMatch(/https?:\/\//);
  });

  it('内联脚本的哈希都列在内容安全策略里，策略不允许站外来源', () => {
    const headers = read('_headers');
    const csp = headers.match(/Content-Security-Policy: (.+)/)?.[1] ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).not.toMatch(/https?:|\*|unsafe-inline|unsafe-eval/);
    for (const p of [...pages, ...notFound]) {
      const inline = [...read(p.file).matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
      expect(inline.length, p.file).toBe(1);
      for (const code of inline) expect(csp, p.file).toContain(`'sha256-${createHash('sha256').update(code, 'utf8').digest('base64')}'`);
    }
  });

  it('隐私政策里写的浏览器存储项，就是脚本实际用的那两项', () => {
    const keys = [...new Set([...read('js/site.js').matchAll(/'(jobs\.[a-z]+)'/g)].map((m) => m[1]))].sort();
    expect(keys).toEqual(['jobs.lang', 'jobs.theme']);
    for (const f of ['privacy/index.html', 'en/privacy/index.html']) for (const k of keys) expect(read(f), f).toContain(k);
    expect(read('js/site.js')).not.toMatch(/document\.cookie|sessionStorage/);
  });

  it('首页内联了五幅示意图，图里不带颜色与内联样式（颜色跟着页面的明暗走）', () => {
    for (const f of ['index.html', 'en/index.html']) {
      const html = read(f);
      for (const name of FIGURES) expect(html, `${f} 缺示意图 ${name}`).toContain(`class="fig fig-${name}`);
      const figures = [...html.matchAll(/<svg class="fig [\s\S]*?<\/svg>/g)].map((m) => m[0]);
      expect(figures.length, f).toBe(FIGURES.length);
      for (const svg of figures) expect(svg, f).not.toMatch(/\s(?:fill|stroke|style)="/);
    }
  });

  it('源码、生成脚本与说明文档不会被发布', () => {
    const ignored = read('.assetsignore').split('\n');
    for (const f of ['wrangler.jsonc', '.assetsignore', '.wrangler', 'src/', 'scripts/', 'docs/']) expect(ignored).toContain(f);
  });
});

describe('README 的示意图', () => {
  const repo = (p: string) => join(REPO_ROOT, p);

  it('与源一致（不一致时运行 pnpm site:build 并提交）', () => {
    expect(() => execFileSync('node', [site('scripts/build-figures.mjs'), '--check'], { stdio: 'pipe' })).not.toThrow();
  });

  it('每幅图 × 每种语言 × 明暗各一份，文件自带样式，不引用任何外部资源，也没有脚本', () => {
    for (const name of README_FIGURES) for (const lang of ['zh', 'en']) for (const theme of ['dark', 'light']) {
      const file = `docs/images/${name}.${lang}.${theme}.svg`;
      expect(existsSync(repo(file)), file).toBe(true);
      const svg = readFileSync(repo(file), 'utf8');
      expect(svg, file).toContain('<style>');
      expect(svg, file).not.toMatch(/var\(--/); // 变量都换成了具体的值
      expect(svg.replace('http://www.w3.org/2000/svg', ''), file).not.toMatch(/https?:|<script|@import|\shref=/);
    }
  });

  it('两份 README 引用的本地图片都在仓库里，并且互相指向对方', () => {
    for (const [file, other] of [['README.md', 'README.zh-CN.md'], ['README.zh-CN.md', 'README.md']]) {
      const md = readFileSync(repo(file), 'utf8');
      const local = [...md.matchAll(/(?:src|srcset)="([^"]+)"/g)].map((m) => m[1]).filter((u) => !/^https?:/.test(u));
      expect(local.length, file).toBeGreaterThan(10);
      for (const path of local) expect(existsSync(repo(path)), `${file} 引用了不存在的 ${path}`).toBe(true);
      expect(md, file).toContain(`](${other})`);
    }
  });
});
