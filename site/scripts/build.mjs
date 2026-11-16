#!/usr/bin/env node
/**
 * build.mjs — 从 src/ 生成整个官网。只用 Node 内置模块。
 *
 *   node site/scripts/build.mjs           生成并写入 site/
 *   node site/scripts/build.mjs --check   只比对：产物与源不一致时列出文件并以非零退出（测试用）
 *
 * 线上没有构建步骤（Cloudflare 直接发布 site/ 目录），所以全部产物都提交进仓库：
 *   每种语言 × 每个页面的 index.html、每种语言的 404.html、css/tokens.css、css/site.css、favicon.svg、robots.txt、sitemap.xml、_headers、install（deploy/install.sh 的副本）。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { COPYRIGHT_YEAR, DEFAULT_LANG, FALLBACK_LANG, LANGS, ORIGIN, PAGES, STORAGE_LANG, STORAGE_THEME, fileFor, pathFor } from '../src/site.mjs';
import { shell } from '../src/shell.mjs';
import { article, assertSameShape, footer, head, header } from '../src/render.mjs';
import { home, renderHome } from '../src/pages/home.mjs';
import { about } from '../src/pages/about.mjs';
import { terms } from '../src/pages/terms.mjs';
import { privacy } from '../src/pages/privacy.mjs';
import { renderNotFound } from '../src/pages/not-found.mjs';
import { figureText } from '../src/figures.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(root, '..');
const check = process.argv.includes('--check');
const read = (rel) => readFileSync(resolve(root, rel));
const hash = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 10);
const versioned = (rel) => `/${rel}?v=${hash(read(rel))}`;

/* ------------------------------------------------------------ 文案：每种语言都要齐，键与默认语言一致 */
const messages = { shell, home, about, terms, privacy, figures: figureText };
for (const [name, m] of Object.entries(messages)) {
  for (const l of LANGS) {
    if (!m[l.code]) throw new Error(`缺少文案 ${name}（语言 ${l.code}）`);
    // 示意图里的文字自己断行，各语言行数可以不同
    if (l.code !== DEFAULT_LANG) assertSameShape(m[DEFAULT_LANG], m[l.code], name, l.code, { freeLines: name === 'figures' });
  }
  for (const code of Object.keys(m)) if (!LANGS.some((l) => l.code === code)) throw new Error(`文案 ${name} 里有没注册的语言 ${code}（在 src/site.mjs 的 LANGS 里加上）`);
}
if (!LANGS.some((l) => l.code === FALLBACK_LANG)) throw new Error(`FALLBACK_LANG ${FALLBACK_LANG} 不在 LANGS 里`);

/* ------------------------------------------------------------ 产物收集 */
const outputs = new Map();
const emit = (rel, content) => outputs.set(rel, typeof content === 'string' ? Buffer.from(content, 'utf8') : content);

/* ------------------------------------------------------------ css/tokens.css：PlutoKeating design system 的变量部分 */
const tokenSource = readFileSync(resolve(repo, 'apps/web/src/design-system/tokens.css'), 'utf8');
const cut = tokenSource.indexOf('@theme');
if (cut < 0) throw new Error('apps/web/src/design-system/tokens.css 的结构变了：找不到 @theme');
const tokenVars = tokenSource.slice(tokenSource.indexOf(':root'), cut).trimEnd();
// .night：首页开头那座雨夜里的城不随页面的明暗变（与网页里「城市天空只跟模拟时钟走」同一条规则），
// 它里面一律用暗色那一套颜色。直接取默认（暗色）:root 里的颜色变量，不另写颜色。
const darkColors = tokenVars
  .slice(0, tokenVars.indexOf('@media'))
  .split('\n')
  .filter((line) => /^\s*--ds-color-/.test(line))
  .map((line) => `  ${line.trim()}`)
  .join('\n');
emit(
  'css/tokens.css',
  `/* 生成物（site/scripts/build.mjs），勿手改。PlutoKeating design system 的变量，取自 apps/web/src/design-system/tokens.css（去掉了只给 Tailwind 用的部分）。 */\n${tokenVars}\n\n/* 不随明暗变的夜色区域（首页开头与结尾的城）：暗色那一套颜色。--site-night-bg 给夜色区域外面的羽化用。 */\n:root {\n  --site-night-bg: ${token('color-bg', 'dark')};\n}\n.night {\n  color-scheme: dark;\n${darkColors}\n}\n`,
);
/** 取某个变量的值：scope 为 'dark'（默认的 :root）或 'light'（:root[data-theme="light"]）。 */
function token(name, scope) {
  const block = scope === 'light' ? tokenVars.slice(tokenVars.indexOf(':root[data-theme="light"]')) : tokenVars.slice(0, tokenVars.indexOf('@media'));
  const m = block.match(new RegExp(`--ds-${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`tokens.css 里没有 --ds-${name}（${scope}）`);
  return m[1].trim();
}

/* ------------------------------------------------------------ css/site.css：给字体地址补 ?v= */
const siteCss = readFileSync(resolve(root, 'src/site.css'), 'utf8').replace(/url\("\/(fonts\/[^"?]+)"\)/g, (_, rel) => {
  if (!existsSync(resolve(root, rel))) throw new Error(`src/site.css 引用的字体不存在：${rel}（先运行 node site/scripts/build-fonts.mjs）`);
  return `url("${versioned(rel)}")`;
});
emit('css/site.css', `/* 生成物（site/scripts/build.mjs），勿手改；源文件是 src/site.css。 */\n${siteCss}`);

/* ------------------------------------------------------------ 资源地址 */
const v = (rel, buf) => `/${rel}?v=${hash(buf)}`;
const assets = {
  tokensCss: v('css/tokens.css', outputs.get('css/tokens.css')),
  siteCss: v('css/site.css', outputs.get('css/site.css')),
  siteJs: versioned('js/site.js'),
  inter: versioned('fonts/InterVariable.woff2'),
  themeDark: token('color-bg', 'dark'),
  themeLight: token('color-bg', 'light'),
  // 首页配图：每种语言 × 明暗各一张（scripts/build-shots.mjs 生成）
  shot: (lang, theme) => versioned(`shots/city-${lang}-${theme}.webp`),
  // 首页开头那座雨夜里的城（生成的画，不随语言与明暗变）：webp 给现代浏览器，png 兜底
  town: { webp: versioned('shots/town-night.webp'), png: versioned('shots/town-night.png') },
};

/* ------------------------------------------------------------ 内联脚本（首帧之前） */
// 所有页面：标记有脚本；应用记住的外观。
const THEME_SCRIPT = `(function(){var d=document.documentElement;d.className+=" js";try{var t=localStorage.getItem(${JSON.stringify(STORAGE_THEME)});if(t==="light"||t==="dark")d.setAttribute("data-theme",t)}catch(e){}})();`;
// 仅默认语言的首页：记住的语言不是默认语言 → 去那种语言的首页；没记住时按浏览器的语言偏好挑第一个认识的，都不认识就去 FALLBACK_LANG。
const homes = Object.fromEntries(LANGS.filter((l) => l.code !== DEFAULT_LANG).map((l) => [l.code, pathFor(l.code, 'home')]));
const accepts = LANGS.flatMap((l) => l.accepts.map((a) => [a.toLowerCase(), l.code]));
const LANG_SCRIPT = `(function(){try{var H=${JSON.stringify(homes)},A=${JSON.stringify(accepts)},D=${JSON.stringify(DEFAULT_LANG)},s=localStorage.getItem(${JSON.stringify(STORAGE_LANG)});if(s){if(H[s])location.replace(H[s]);return}var n=navigator.languages&&navigator.languages.length?navigator.languages:[navigator.language||""],w="";for(var i=0;i<n.length&&!w;i++){var p=String(n[i]).toLowerCase();for(var j=0;j<A.length;j++)if(p.indexOf(A[j][0])===0){w=A[j][1];break}}if(!w)w=${JSON.stringify(FALLBACK_LANG)};if(w!==D&&H[w])location.replace(H[w])}catch(e){}})();`;
const inlineFor = (lang, page) => (page === 'home' && lang === DEFAULT_LANG ? THEME_SCRIPT + LANG_SCRIPT : THEME_SCRIPT);
const cspHashes = new Set();
const cspHash = (s) => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`;

/* ------------------------------------------------------------ 页面 */
const longform = { about, terms, privacy };
const titleFor = (lang, page) => (page === 'home' ? home[lang].title : `${longform[page][lang].title}${shell[lang].titleSuffix}`);
const document = (headHtml, lang, page, main) => `${headHtml}
<body>
${header({ lang, page })}
${main}
${footer({ lang, year: COPYRIGHT_YEAR })}
</body>
</html>
`;

for (const l of LANGS) {
  const lang = l.code;
  for (const page of PAGES) {
    const inlineScript = inlineFor(lang, page);
    cspHashes.add(cspHash(inlineScript));
    const t = page === 'home' ? home[lang] : longform[page][lang];
    const main = page === 'home' ? renderHome(lang, assets) : article({ lang, ...t });
    emit(fileFor(pathFor(lang, page)), document(head({ lang, page, title: titleFor(lang, page), description: t.description, inlineScript, assets }), lang, page, main));
  }
  // 404：不进站点地图、不让搜索引擎收录
  cspHashes.add(cspHash(THEME_SCRIPT));
  const nf = shell[lang].notFound;
  emit(
    `${l.prefix.slice(1)}${l.prefix ? '/' : ''}404.html`,
    document(head({ lang, page: null, title: `${nf.title}${shell[lang].titleSuffix}`, description: nf.line, inlineScript: THEME_SCRIPT, assets, robots: 'noindex' }), lang, null, renderNotFound(lang)),
  );
}

/* ------------------------------------------------------------ favicon.svg：字标（SVG 文件不能引用 CSS 变量，颜色取自 tokens） */
const c = { bg: token('color-bg', 'dark'), a: token('color-secondary', 'dark'), b: token('color-secondary-fg', 'dark'), lit: token('color-accent', 'dark') };
emit(
  'favicon.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges"><rect width="16" height="16" fill="${c.bg}"/><rect x="2" y="6" width="4" height="8" fill="${c.a}"/><rect x="7" y="3" width="4" height="11" fill="${c.b}"/><rect x="12" y="8" width="2" height="6" fill="${c.a}"/><rect x="8" y="5" width="1" height="1" fill="${c.lit}"/><rect x="9" y="8" width="1" height="1" fill="${c.lit}"/><rect x="3" y="9" width="1" height="1" fill="${c.lit}"/><rect y="14" width="16" height="2" fill="${c.lit}"/></svg>\n`,
);

/* ------------------------------------------------------------ robots.txt 与 sitemap.xml */
emit('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${ORIGIN}/sitemap.xml\n`);
const urls = PAGES.flatMap((page) =>
  LANGS.map(
    (l) => `  <url>
    <loc>${ORIGIN}${pathFor(l.code, page)}</loc>
${LANGS.map((x) => `    <xhtml:link rel="alternate" hreflang="${x.htmlLang}" href="${ORIGIN}${pathFor(x.code, page)}"/>`).join('\n')}
    <xhtml:link rel="alternate" hreflang="x-default" href="${ORIGIN}${pathFor(DEFAULT_LANG, page)}"/>
  </url>`,
  ),
);
emit('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`);

/* ------------------------------------------------------------ install：deploy/install.sh 的原样副本（curl -fsSL …/install | bash） */
emit('install', readFileSync(resolve(repo, 'deploy/install.sh')));

/* ------------------------------------------------------------ _headers：安全响应头与缓存 */
emit(
  '_headers',
  `# 生成物（site/scripts/build.mjs），勿手改。
/*
  Content-Security-Policy: default-src 'self'; script-src 'self' ${[...cspHashes].sort().join(' ')}; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
/install
  Content-Type: text/plain; charset=utf-8
  Cache-Control: no-cache
/fonts/*
  Cache-Control: public, max-age=31536000, immutable
/css/*
  Cache-Control: public, max-age=31536000, immutable
/js/*
  Cache-Control: public, max-age=31536000, immutable
/shots/*
  Cache-Control: public, max-age=31536000, immutable
`,
);

/* ------------------------------------------------------------ 中文字体子集要盖住页面上的每一个汉字 */
const subsetList = resolve(root, 'fonts/NotoSansSC.subset.txt');
const have = new Set(existsSync(subsetList) ? [...readFileSync(subsetList, 'utf8')] : []);
const missing = new Set();
for (const [rel, buf] of outputs) {
  if (!rel.endsWith('.html')) continue;
  for (const ch of buf.toString('utf8')) if (ch.codePointAt(0) >= 0x2e80 && !have.has(ch)) missing.add(ch);
}
if (missing.size) {
  console.error(`中文字体子集缺 ${missing.size} 个字：${[...missing].join('')}\n运行 node site/scripts/build-fonts.mjs 之后再运行本脚本。`);
  if (check) process.exit(1);
}

/* ------------------------------------------------------------ 写入或比对 */
const stale = [];
for (const [rel, buf] of outputs) {
  const abs = resolve(root, rel);
  const same = existsSync(abs) && readFileSync(abs).equals(buf);
  if (same) continue;
  if (check) stale.push(rel);
  else {
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, buf);
  }
}
if (check && stale.length) {
  console.error(`官网产物不是最新的（运行 node site/scripts/build.mjs 重新生成并提交）：\n  ${stale.join('\n  ')}`);
  process.exit(1);
}
console.log(check ? `官网产物是最新的（${outputs.size} 个文件）` : `已生成 ${outputs.size} 个文件：${[...outputs.keys()].join(' ')}`);
