/**
 * site.mjs — 站点常量、语言注册表与路由契约。
 * 页面集合是契约：scripts/build.mjs 据此生成（每种语言 × 每个页面 + 404.html），测试据此核对产物。
 */
export const ORIGIN = 'https://jobs.plutokeating.beer';

/**
 * 语言注册表。加一种语言只做两件事：
 *   1. 在这里加一项（prefix 是它的路径前缀，默认语言为空）；
 *   2. 在 src/shell.mjs 与 src/pages/*.mjs 的文案对象里补上同名的键。
 * 缺了哪一页的哪种语言，或者键对不上默认语言，构建会直接报错并指出位置。
 * accepts：浏览器语言以其中任何一项开头就算这种语言；spaced：词与词之间用空格（决定标题分段之间放空格还是换行点）。
 */
export const LANGS = [
  { code: 'zh', prefix: '', htmlLang: 'zh-CN', ogLocale: 'zh_CN', label: '中文', accepts: ['zh'], spaced: false },
  { code: 'en', prefix: '/en', htmlLang: 'en', ogLocale: 'en_US', label: 'English', accepts: ['en'], spaced: true },
];
export const DEFAULT_LANG = LANGS[0].code;
/** 访客的浏览器语言不在任何一种语言的 accepts 里时，带到这种语言。 */
export const FALLBACK_LANG = 'en';
export const langOf = (code) => LANGS.find((l) => l.code === code);

export const PAGES = ['home', 'about', 'terms', 'privacy'];

/** 页面路径：默认语言在根，其他语言加前缀；一律不带尾斜杠（根路径除外）。 */
export function pathFor(lang, page) {
  const base = langOf(lang).prefix;
  if (page === 'home') return base || '/';
  return `${base}/${page}`;
}

/** 路径 → 产物文件（相对 site/）。 */
export const fileFor = (path) => (path === '/' ? 'index.html' : `${path.slice(1)}/index.html`);

export const OPERATOR = 'PlutoKeating';
/** 页脚的版权年份。写死而不是取构建当天的年份：产物要能逐字节重现（测试会重新生成并比对）。 */
export const COPYRIGHT_YEAR = 2026;
export const CONTACT_EMAIL = 'PlutoKeating@outlook.com';
export const GITHUB_REPO = 'https://github.com/PlutoKeating/Project.Jobs';
export const GITHUB_ISSUES = `${GITHUB_REPO}/issues`;
export const GITHUB_RELEASES = `${GITHUB_REPO}/releases`;
export const GITHUB_LICENSE = `${GITHUB_REPO}/blob/main/LICENSE`;
export const DOCS_INSTALL = `${GITHUB_REPO}/blob/main/docs/INSTALL.md`;
export const INSTALL_COMMAND = `curl -fsSL ${ORIGIN}/install | bash`;

/** 条款与隐私政策的日期与版本：改了这两页的任何一句，都要一起改这里。 */
export const POLICY_UPDATED = '2026-11-15';
export const POLICY_VERSION = '1.3';

/** 浏览器里只存这两项（localStorage）；隐私政策里写的就是它们。 */
export const STORAGE_THEME = 'jobs.theme';
export const STORAGE_LANG = 'jobs.lang';
