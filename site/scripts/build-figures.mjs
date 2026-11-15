#!/usr/bin/env node
/**
 * build-figures.mjs — 把 src/figures.mjs 的示意图另存成独立的 SVG 文件，给 README 用。只用 Node 内置模块。
 *
 *   node site/scripts/build-figures.mjs           生成并写入 docs/images/
 *   node site/scripts/build-figures.mjs --check   只比对：产物与源不一致时列出文件并以非零退出（测试用）
 *
 * 每幅图 × 每种语言 × 明暗各一份：<名字>.<语言>.<dark|light>.svg。README 用 <picture> 按读者的外观挑一份。
 * 图本身只有类名；这里把 src/site.css 里「示意图」那一段样式取出来，把 design system 的变量换成那种外观下的具体的值，
 * 嵌进文件（GitHub 把 README 里的 SVG 当图片显示：不加载外部样式，也不跑脚本，但文件里自带的 CSS 动画会播放）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LANGS } from '../src/site.mjs';
import { esc } from '../src/render.mjs';
import { FIGURES, figure } from '../src/figures.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(root, '..');
const outDir = resolve(repo, 'docs/images');
const check = process.argv.includes('--check');

/* ------------------------------------------------------------ design system 的变量：每种外观一张表 */
const tokenSource = readFileSync(resolve(repo, 'apps/web/src/design-system/tokens.css'), 'utf8');
const declarations = (block) => Object.fromEntries([...block.matchAll(/(--ds-[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const darkBlock = tokenSource.slice(tokenSource.indexOf(':root'), tokenSource.indexOf('@media'));
const lightAt = tokenSource.indexOf(':root[data-theme="light"]');
if (lightAt < 0) throw new Error('apps/web/src/design-system/tokens.css 的结构变了：找不到 :root[data-theme="light"]');
const lightBlock = tokenSource.slice(lightAt, tokenSource.indexOf('}', lightAt));
const base = declarations(darkBlock);
const TOKENS = { dark: base, light: { ...base, ...declarations(lightBlock) } };

/* ------------------------------------------------------------ 图的样式：src/site.css 里两行标记之间的那一段 */
const css = readFileSync(resolve(root, 'src/site.css'), 'utf8');
const from = css.indexOf('/* @figures:start */');
const to = css.indexOf('/* @figures:end */');
if (from < 0 || to < 0) throw new Error('src/site.css 里找不到 @figures:start / @figures:end');
const figureCss = css.slice(from + '/* @figures:start */'.length, to);

// 独立文件里没有官网的字体：用读者系统里的无衬线字体
const SANS = 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans SC", sans-serif';

function styleFor(theme) {
  const t = TOKENS[theme];
  const value = (name) => {
    if (name === '--site-font-sans') return SANS;
    if (!(name in t)) throw new Error(`示意图样式用了 tokens.css 里没有的变量 ${name}`);
    return t[name];
  };
  let out = figureCss;
  for (let i = 0; i < 4 && out.includes('var('); i++) out = out.replace(/var\((--[\w-]+)\)/g, (_, name) => value(name));
  // 像素图形的四种颜色（官网上由 site.css 的「像素」一段给出）与关掉动画时的写法
  out += `.fig .px-a{fill:${t['--ds-color-secondary']}}.fig .px-b{fill:${t['--ds-color-secondary-fg']}}.fig .px-lit{fill:${t['--ds-color-accent']}}.fig .px-dim{fill:${t['--ds-color-bg']};opacity:.5}`;
  out += '@media (prefers-reduced-motion:reduce){.fig *{animation:none!important}}';
  return out
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{};,>])\s*/g, '$1')
    .replace(/:\s+/g, ':')
    .replace(/;}/g, '}')
    .trim();
}

function standalone(name, lang, theme) {
  const f = figure(name, lang);
  const t = TOKENS[theme];
  const htmlLang = LANGS.find((l) => l.code === lang).htmlLang;
  return `<svg xmlns="http://www.w3.org/2000/svg" class="fig fig-${f.name}${f.steps ? ` fig-n${f.steps}` : ''}" viewBox="0 0 ${f.w} ${f.h}" width="${f.w}" height="${f.h}" role="img" aria-label="${esc(f.label)}" xml:lang="${htmlLang}">
<title>${esc(f.label)}</title>
<style>${styleFor(theme)}</style>
<defs><clipPath id="fig-card"><rect width="${f.w}" height="${f.h}" rx="16"/></clipPath></defs>
<g clip-path="url(#fig-card)"><rect width="${f.w}" height="${f.h}" fill="${t['--ds-color-bg']}"/>${f.body}</g>
<rect x="0.5" y="0.5" width="${f.w - 1}" height="${f.h - 1}" rx="15.5" fill="none" stroke="${t['--ds-color-border-strong']}"/>
</svg>
`;
}

/* ------------------------------------------------------------ 写入或比对 */
const outputs = new Map();
for (const name of FIGURES) for (const l of LANGS) for (const theme of ['dark', 'light']) outputs.set(`${name}.${l.code}.${theme}.svg`, standalone(name, l.code, theme));

const stale = [];
for (const [file, content] of outputs) {
  const abs = resolve(outDir, file);
  if (existsSync(abs) && readFileSync(abs, 'utf8') === content) continue;
  if (check) stale.push(file);
  else {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(abs, content);
  }
}
if (check && stale.length) {
  console.error(`README 的示意图不是最新的（运行 node site/scripts/build-figures.mjs 重新生成并提交）：\n  ${stale.map((f) => `docs/images/${f}`).join('\n  ')}`);
  process.exit(1);
}
console.log(check ? `README 的示意图是最新的（${outputs.size} 个文件）` : `已生成 ${outputs.size} 个文件：docs/images/{${FIGURES.join(',')}}.{${LANGS.map((l) => l.code).join(',')}}.{dark,light}.svg`);
