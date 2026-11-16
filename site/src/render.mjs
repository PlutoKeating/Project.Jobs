/**
 * render.mjs — 把文案渲染成 HTML 字符串。无依赖，只拼字符串。
 *
 * 约定：
 * - 所有可见文本经 esc() 转义；段落里允许两种极简内联标记：[文字](地址) 生成链接（外链自动加 rel 与 ↗），`代码` 生成 <code>。
 * - 页面不含 style 属性与 <style> 块；内联脚本只有 <head> 里的一段，它的 sha256 由 scripts/build.mjs 写进 _headers 的 CSP。
 * - 颜色只来自 css/tokens.css（PlutoKeating design system）；像素图形只有字标、首页开头的城（一幅画）与页脚的街道。
 */
import {
  CONTACT_EMAIL,
  DOCS_INSTALL,
  GITHUB_ISSUES,
  GITHUB_RELEASES,
  GITHUB_REPO,
  LANGS,
  OPERATOR,
  ORIGIN,
  DEFAULT_LANG,
  langOf,
  pathFor,
} from './site.mjs';
import { shell } from './shell.mjs';

export const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const isExternal = (href) => /^https?:\/\//.test(href);

/* ---------------------------------------------------------------- 图标（手绘，20×20，1.5 描边） */

const icon = (name, body) =>
  `<svg class="icon icon-${name}" viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

export const ICON = {
  external: '<svg class="icon icon-external" viewBox="0 0 12 12" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4.5 2.5h5v5M9.5 2.5l-7 7"/></svg>',
  globe: icon('globe', '<circle cx="10" cy="10" r="7.25"/><path d="M2.75 10h14.5M10 2.75c2.2 2 3.3 4.4 3.3 7.25S12.2 15.25 10 17.25c-2.2-2-3.3-4.4-3.3-7.25S7.8 4.75 10 2.75z"/>'),
  chevron: '<svg class="icon icon-chevron" viewBox="0 0 12 12" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M2.75 4.5L6 7.75 9.25 4.5"/></svg>',
  system: icon('system', '<circle cx="10" cy="10" r="6.75"/><path d="M10 3.25v13.5a6.75 6.75 0 0 0 0-13.5z" fill="currentColor" stroke="none"/>'),
  light: icon('light', '<circle cx="10" cy="10" r="3.25"/><path d="M10 2.5v1.75M10 15.75v1.75M2.5 10h1.75M15.75 10h1.75M4.7 4.7l1.25 1.25M14.05 14.05l1.25 1.25M4.7 15.3l1.25-1.25M14.05 5.95l1.25-1.25"/>'),
  dark: icon('dark', '<path d="M16.5 11.6A6.75 6.75 0 0 1 8.4 3.5a6.75 6.75 0 1 0 8.1 8.1z"/>'),
  menu: icon('menu', '<path d="M3.5 6h13M3.5 10h13M3.5 14h13"/>'),
  close: icon('close', '<path d="M5 5l10 10M15 5L5 15"/>'),
  copy: icon('copy', '<rect x="7" y="7" width="9.5" height="9.5" rx="2"/><path d="M13 7V5.5a2 2 0 0 0-2-2H5.5a2 2 0 0 0-2 2V11a2 2 0 0 0 2 2H7"/>'),
  check: icon('check', '<path d="M4.5 10.5l3.5 3.5 7.5-8"/>'),
};

/* ---------------------------------------------------------------- 内联标记与链接 */

export function link(href, label, cls = 'text-link', attrs = '') {
  const c = cls ? ` class="${cls}"` : '';
  if (isExternal(href)) {
    return `<a${c} href="${esc(href)}" target="_blank" rel="noreferrer noopener"${attrs}>${esc(label)}${ICON.external}</a>`;
  }
  return `<a${c} href="${esc(href)}"${attrs}>${esc(label)}</a>`;
}

/** 极简内联标记：[文字](地址) 与 `代码`。其余文本转义。 */
export function inline(text) {
  let out = '';
  let last = 0;
  const re = /\[([^\]]+)\]\(([^)\s]+)\)|`([^`]+)`/g;
  let m;
  while ((m = re.exec(text))) {
    out += esc(text.slice(last, m.index));
    out += m[3] !== undefined ? `<code>${esc(m[3])}</code>` : link(m[2], m[1]);
    last = m.index + m[0].length;
  }
  return out + esc(text.slice(last));
}

/* ---------------------------------------------------------------- 字标与像素街道 */

/** 16×16 像素字标：石板灰绿的楼，琥珀的窗与地平线（与 apps/web 的 Wordmark 同一幅图）。 */
const MARK = `<svg class="mark" viewBox="0 0 16 16" width="22" height="22" shape-rendering="crispEdges" aria-hidden="true" focusable="false"><rect class="px-a" x="2" y="6" width="4" height="8"/><rect class="px-b" x="7" y="3" width="4" height="11"/><rect class="px-a" x="12" y="8" width="2" height="6"/><rect class="px-lit" x="8" y="5" width="1" height="1"/><rect class="px-lit" x="9" y="8" width="1" height="1"/><rect class="px-lit" x="3" y="9" width="1" height="1"/><rect class="px-lit" x="0" y="14" width="16" height="2"/></svg>`;

export const wordmark = (lang) => `<a class="wordmark" href="${pathFor(lang, 'home')}">${MARK}<span>Jobs</span></a>`;

/** 确定性的伪随机数（同一份源码永远生成同一条街）。 */
function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HORIZON_W = 360; // 页脚那一块街道的宽（像素格）；按 4 倍画出来是 1440px，横向平铺
export const HORIZON_H = 24;

/**
 * 一段侧视的像素街道：一排楼，几扇亮着的窗，一条琥珀色的地平线。返回 <rect> 列表（一格一个单位，高 HORIZON_H 格）。
 * litClass：给第 n 扇亮着的窗（从 1 起）追加类名用的，页脚不用，README 的条幅用它让几扇窗明灭。
 */
export function horizonRects(width, seed, litClass = () => '') {
  const rand = prng(seed);
  const rects = [];
  let lit = 0;
  let x = 2;
  while (x < width - 12) {
    const w = 8 + Math.floor(rand() * 5) * 2; // 8–16
    if (x + w > width - 2) break;
    const h = 7 + Math.floor(rand() * 13); // 7–19
    const top = HORIZON_H - 2 - h;
    const tone = rand() < 0.45 ? 'px-b' : 'px-a';
    rects.push(`<rect class="${tone}" x="${x}" y="${top}" width="${w}" height="${h}"/>`);
    // 楼层线与窗：每 3 格一层，窗隔一格一扇；少数亮着
    for (let fy = top + 2; fy < HORIZON_H - 4; fy += 3) {
      for (let fx = x + 1; fx < x + w - 1; fx += 2) {
        const r = rand();
        if (r < 0.1) rects.push(`<rect class="px-lit${litClass(++lit)}" x="${fx}" y="${fy}" width="1" height="1"/>`);
        else if (r < 0.62) rects.push(`<rect class="px-dim" x="${fx}" y="${fy}" width="1" height="1"/>`);
      }
    }
    x += w + (rand() < 0.3 ? 5 + Math.floor(rand() * 8) : 1 + Math.floor(rand() * 2));
  }
  rects.push(`<rect class="px-lit" x="0" y="${HORIZON_H - 2}" width="${width}" height="2"/>`);
  return rects;
}

/** 页脚的像素街道：一块 HORIZON_W 格宽的街道横向平铺。 */
function horizon() {
  const rects = horizonRects(HORIZON_W, 20261115);
  // 亮着的窗与地平线单独一层，好让它们像首页那幅画里的窗一样微微发光（.horizon-lit 的 drop-shadow）
  const lit = rects.filter((r) => r.includes('px-lit'));
  const rest = rects.filter((r) => !r.includes('px-lit'));
  const pattern = (id, body) => `<pattern id="${id}" width="${HORIZON_W * 4}" height="${HORIZON_H * 4}" patternUnits="userSpaceOnUse"><g transform="scale(4)">${body.join('')}</g></pattern>`;
  return `<svg class="horizon" width="100%" height="${HORIZON_H * 4}" aria-hidden="true" focusable="false" shape-rendering="crispEdges">
    <defs>${pattern('street', rest)}${pattern('street-lit', lit)}</defs>
    <rect width="100%" height="${HORIZON_H * 4}" fill="url(#street)"/>
    <rect class="horizon-lit" width="100%" height="${HORIZON_H * 4}" fill="url(#street-lit)"/>
  </svg>`;
}

/* ---------------------------------------------------------------- <head> */

export function head({ lang, page, title, description, inlineScript, assets, robots }) {
  const t = shell[lang];
  const l = langOf(lang);
  const canonical = page ? `${ORIGIN}${pathFor(lang, page)}` : null;
  const alternates = page
    ? [
        ...LANGS.map((x) => `<link rel="alternate" hreflang="${x.htmlLang}" href="${ORIGIN}${pathFor(x.code, page)}">`),
        `<link rel="alternate" hreflang="x-default" href="${ORIGIN}${pathFor(DEFAULT_LANG, page)}">`,
      ]
    : [];
  const og = page
    ? [
        '<meta property="og:type" content="website">',
        `<meta property="og:site_name" content="${esc(t.siteName)}">`,
        `<meta property="og:url" content="${canonical}">`,
        `<meta property="og:title" content="${esc(title)}">`,
        `<meta property="og:description" content="${esc(description)}">`,
        `<meta property="og:locale" content="${l.ogLocale}">`,
        ...LANGS.filter((x) => x.code !== lang).map((x) => `<meta property="og:locale:alternate" content="${x.ogLocale}">`),
        `<meta property="og:image" content="${ORIGIN}/og.png">`,
        '<meta property="og:image:width" content="1200">',
        '<meta property="og:image:height" content="630">',
        `<meta property="og:image:alt" content="${esc(t.ogImageAlt)}">`,
        '<meta name="twitter:card" content="summary_large_image">',
      ]
    : [];
  const lines = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}">`,
    robots ? `<meta name="robots" content="${robots}">` : '',
    '<meta name="color-scheme" content="dark light">',
    `<meta name="theme-color" content="${assets.themeDark}" media="(prefers-color-scheme: dark)">`,
    `<meta name="theme-color" content="${assets.themeLight}" media="(prefers-color-scheme: light)">`,
    canonical ? `<link rel="canonical" href="${canonical}">` : '',
    ...alternates,
    ...og,
    '<link rel="icon" type="image/svg+xml" href="/favicon.svg">',
    `<link rel="preload" href="${assets.inter}" as="font" type="font/woff2" crossorigin>`,
    `<link rel="stylesheet" href="${assets.tokensCss}">`,
    `<link rel="stylesheet" href="${assets.siteCss}">`,
    `<script>${inlineScript}</script>`,
    `<script src="${assets.siteJs}" defer></script>`,
  ].filter(Boolean);
  return `<!doctype html>
<html lang="${l.htmlLang}" data-lang="${lang}"${l.spaced ? ' data-spaced' : ''}>
<head>
  ${lines.join('\n  ')}
</head>`;
}

/* ---------------------------------------------------------------- 页眉 */

export function header({ lang, page }) {
  const t = shell[lang];
  const cur = langOf(lang);
  const current = (p) => (page === p ? ' aria-current="page"' : '');
  // 语言菜单：每种语言一项，指向当前页面的那种语言版本（404 没有对应页面，回各语言的首页）
  const langItems = LANGS.map(
    (x) =>
      `<li><a href="${pathFor(x.code, page ?? 'home')}" hreflang="${x.htmlLang}" lang="${x.htmlLang}" data-set-lang="${x.code}"${x.code === lang ? ' aria-current="true"' : ''}>${esc(x.label)}</a></li>`,
  ).join('');
  return `<header class="site-header">
  <a class="skip-link" href="#main">${esc(t.skip)}</a>
  <div class="col site-header-row">
    ${wordmark(lang)}
    <nav class="site-nav" id="site-nav" aria-label="${esc(t.navLabel)}">
      <ul>
        <li><a href="${pathFor(lang, 'home')}#install">${esc(t.nav.install)}</a></li>
        <li><a href="${pathFor(lang, 'about')}"${current('about')}>${esc(t.nav.about)}</a></li>
        <li><a href="${GITHUB_REPO}" target="_blank" rel="noreferrer noopener">${esc(t.nav.source)}${ICON.external}</a></li>
      </ul>
    </nav>
    <div class="site-tools">
      <details class="lang-menu">
        <summary aria-label="${esc(t.langLabel)}">${ICON.globe}<span>${esc(cur.label)}</span>${ICON.chevron}</summary>
        <ul>${langItems}</ul>
      </details>
      <button type="button" class="icon-button theme-toggle" data-theme-toggle hidden data-label="${esc(t.theme.label)}" data-label-system="${esc(t.theme.system)}" data-label-light="${esc(t.theme.light)}" data-label-dark="${esc(t.theme.dark)}">${ICON.system}${ICON.light}${ICON.dark}</button>
      <button type="button" class="icon-button menu-toggle" data-menu-toggle hidden aria-expanded="false" aria-controls="site-nav" aria-label="${esc(t.menuOpen)}" data-label-open="${esc(t.menuOpen)}" data-label-close="${esc(t.menuClose)}">${ICON.menu}${ICON.close}</button>
    </div>
  </div>
</header>`;
}

/* ---------------------------------------------------------------- 页脚 */

export function footer({ lang, year }) {
  const t = shell[lang];
  const f = t.footer;
  const group = (id, label, items) => `
      <nav class="footer-group" aria-labelledby="${id}">
        <h2 id="${id}">${esc(label)}</h2>
        <ul>
          ${items.map((i) => `<li>${i}</li>`).join('\n          ')}
        </ul>
      </nav>`;
  const item = (href, label) => link(href, label, '');
  return `<footer class="site-footer">
  ${horizon()}
  <div class="col footer-grid">
    <div class="footer-brand">
      ${wordmark(lang)}
      <p class="footer-tagline">${esc(f.tagline)}</p>
      <p>© ${year} ${esc(OPERATOR)} · ${esc(f.license)}</p>
      <p>${esc(f.operator)}</p>
    </div>
    <div class="footer-groups">${group('footer-product', f.product, [
      item(`${pathFor(lang, 'home')}#install`, f.install),
      item(DOCS_INSTALL, f.docs),
      item(GITHUB_RELEASES, f.releases),
    ])}${group('footer-project', f.project, [item(GITHUB_REPO, f.source), item(GITHUB_ISSUES, f.issues), item(`mailto:${CONTACT_EMAIL}`, f.contact)])}${group('footer-legal', f.legal, [
      item(pathFor(lang, 'about'), f.about),
      item(pathFor(lang, 'terms'), f.terms),
      item(pathFor(lang, 'privacy'), f.privacy),
    ])}
    </div>
  </div>
</footer>`;
}

/* ---------------------------------------------------------------- 长文版式（关于 / 条款 / 隐私） */

export function article({ lang, heading, lead, meta, sections, town }) {
  // 章节多的页面（条款、隐私）在宽屏右侧放一份本页目录
  const toc =
    sections.length >= 6
      ? `<nav class="toc panel-night" aria-labelledby="toc-heading">
      <h2 id="toc-heading">${esc(shell[lang].toc)}</h2>
      <ol>
        ${sections.map((s, i) => `<li><a href="#s${i + 1}">${esc(s.heading)}</a></li>`).join('\n        ')}
      </ol>
    </nav>`
      : '';
  const body = sections
    .map((s, i) => {
      const id = `s${i + 1}`;
      const paragraphs = (s.paragraphs ?? []).map((p) => `<p>${inline(p)}</p>`).join('\n        ');
      const bullets = s.bullets?.length ? `<ul>\n          ${s.bullets.map((b) => `<li>${inline(b)}</li>`).join('\n          ')}\n        </ul>` : '';
      return `<section aria-labelledby="${id}">
        ${[`<h2 id="${id}">${esc(s.heading)}</h2>`, paragraphs, bullets].filter(Boolean).join('\n        ')}
      </section>`;
    })
    .join('\n      ');
  // 页面开头一条夜色：首页那座城的一截（同一幅画），标题压在它的下沿上
  const band = town
    ? `<div class="page-band night" aria-hidden="true">
    <picture>
      <source srcset="${town.webp}" type="image/webp">
      <img src="${town.png}" width="3168" height="1344" alt="" decoding="async">
    </picture>
  </div>
  `
    : '';
  return `<main id="main">
  ${band}<article class="col article${town ? ' has-band' : ''}">
    <header class="article-head">
      <h1>${esc(heading)}</h1>
      ${lead ? `<p class="article-lead">${inline(lead)}</p>` : ''}
      ${meta ? `<p class="article-meta">${esc(meta)}</p>` : ''}
    </header>
    <div class="prose">
      ${body}
    </div>
    ${toc}
  </article>
</main>`;
}

/* ---------------------------------------------------------------- 文案键核对 */

/**
 * 校验一种语言的文案与默认语言的键、数组长度一致；不一致时抛出带路径的错误。
 * freeLines：全是字符串的数组算「一段多行文字」，各语言行数可以不同（示意图里的文字靠文案自己断行）。
 */
export function assertSameShape(base, other, path, lang, { freeLines = false } = {}) {
  if (other === undefined) throw new Error(`缺少文案 ${path}（语言 ${lang}）`);
  if (Array.isArray(base)) {
    const isLines = (a) => Array.isArray(a) && a.every((v) => typeof v === 'string');
    if (freeLines && isLines(base) && isLines(other)) return;
    if (!Array.isArray(other) || base.length !== other.length) throw new Error(`文案数组长度不一致 ${path}（语言 ${lang}）：${base.length} ≠ ${other?.length}`);
    base.forEach((v, i) => assertSameShape(v, other[i], `${path}[${i}]`, lang, { freeLines }));
    return;
  }
  if (base && typeof base === 'object') {
    const ka = Object.keys(base).sort();
    const kb = Object.keys(other ?? {}).sort();
    if (ka.join() !== kb.join()) throw new Error(`文案键不一致 ${path}（语言 ${lang}）：[${ka}] ≠ [${kb}]`);
    for (const k of ka) assertSameShape(base[k], other[k], `${path}.${k}`, lang, { freeLines });
    return;
  }
  if (typeof base !== typeof other) throw new Error(`文案类型不一致 ${path}（语言 ${lang}）`);
}
