# site — Jobs 官网

`https://jobs.plutokeating.beer`：落地页、关于、条款与条件、隐私政策（每页中英两种语言）、404，以及安装脚本 `/install`。

静态多页站：HTML + 一份手写 CSS + 一小段原生 JS，没有框架。页面由 `scripts/build.mjs` 从 `src/` 生成，**全部产物提交进仓库**——线上没有构建步骤，Cloudflare 直接把这个目录作为 Worker「jobs-site」的静态资源发布（`wrangler.jsonc`），每次推送 `main` 自动部署。`src/`、`scripts/`、`docs/` 与部署配置被 `.assetsignore` 排除，不会上线。部署方式见 [`docs/INSTALL.md`](../../docs/INSTALL.md)「对外发布（维护者）」。

## 目录

```
site/
├── src/                       # 源：改文案、改结构、改样式只改这里
│   ├── site.mjs               # 站点常量、语言注册表 LANGS、页面集合 PAGES、路径规则、联系方式、政策日期与版本
│   ├── shell.mjs              # 页眉、页脚、404 的文案（每种语言一套）
│   ├── render.mjs             # 渲染函数：<head>、页眉、页脚（含像素街道）、长文版式、图标、文案键核对
│   ├── site.css               # 样式源文件：只引用 design system 的变量
│   └── pages/                 # 每页一个文件，文案按语言分组
│       ├── home.mjs           # 首页
│       ├── about.mjs / terms.mjs / privacy.mjs
│       └── not-found.mjs      # 404
├── scripts/                   # 只用 Node 内置模块（配图脚本另用仓库里的 playwright 与 sharp）
│   ├── build.mjs              # src/ → 全部页面、css、favicon、robots、sitemap、_headers；--check 只比对
│   ├── build-fonts.mjs        # 按文案用字切出思源黑体子集
│   └── build-shots.mjs        # 给首页配图截图（每种语言 × 明暗）与分享图
├── js/site.js                 # 手写：外观切换、语言记忆、语言菜单、窄屏菜单、复制安装命令
├── css/tokens.css css/site.css        # 生成物
├── fonts/                     # InterVariable.woff2、思源黑体子集（生成物）与子集清单、两份 OFL 许可
├── shots/ og.png              # 首页配图与分享图（build-shots.mjs 生成）
├── index.html about/ terms/ privacy/ 404.html en/…   # 生成物：每种语言 4 个页面 + 404
├── favicon.svg robots.txt sitemap.xml _headers       # 生成物
├── install                    # deploy/install.sh 的原样副本（node scripts/sync-install.mjs 同步）
├── wrangler.jsonc .assetsignore
└── docs/README.md             # 本文
```

**生成物清单**（不手改；改了源之后重新生成并一起提交）：全部 `*.html`、`css/tokens.css`、`css/site.css`、`favicon.svg`、`robots.txt`、`sitemap.xml`、`_headers`、`fonts/NotoSansSC-*.subset.woff2`、`fonts/NotoSansSC.subset.txt`、`shots/*.webp`、`og.png`。

## 改完之后

```bash
pnpm site:build      # = node site/scripts/build.mjs：改了 src/ 或 js/ 之后
pnpm site:check      # 只比对；产物不是最新的就失败（pnpm test 里也会跑）
node site/scripts/build-fonts.mjs    # 文案里出现了新的汉字之后（build.mjs 会提示缺哪些字），然后再 site:build
node site/scripts/build-shots.mjs    # 界面变了、想换首页配图时（需要一台正在运行的 Jobs），然后再 site:build
```

`build-fonts.mjs` 需要本机 `python3` 的 fontTools 与 brotli，以及 Debian / Ubuntu 的 `fonts-noto-cjk`。

本地预览（与线上一致，含安全响应头、404 页、无尾斜杠）：`cd site && npx wrangler dev`。

## 多语言

语言注册在 `src/site.mjs` 的 `LANGS`。默认语言（第一项，中文）在根路径，其他语言加前缀（英文 `/en/…`）；每个页面都有全部语言的版本，`<head>` 里互相声明 `hreflang`，页眉的语言菜单指向当前页面的其他语言版本。

**加一种语言**：

1. 在 `LANGS` 里加一项（`code`、路径前缀 `prefix`、`htmlLang`、`ogLocale`、菜单里显示的 `label`、浏览器语言匹配规则 `accepts`、词间是否用空格 `spaced`）。
2. 在 `src/shell.mjs` 和 `src/pages/` 的每个文案对象里补上同名的键。
3. `pnpm site:build`。缺了哪一页的哪种语言、哪个键对不上默认语言、数组长度不一致，构建都会报错并指出位置；页面、404、站点地图、语言菜单、首页的语言跳转都自动带上新语言。新语言用到新的汉字时再跑一次 `build-fonts.mjs`。

访客的语言选择记在浏览器的 `localStorage["jobs.lang"]`（点语言菜单时写入）。只有默认语言的首页会跳转：记住的语言不是中文就去那种语言的首页；没记住时按浏览器的语言偏好挑第一个认识的，都不认识就去 `FALLBACK_LANG`（英文）。其他页面不跳转，分享出去的链接是哪种语言就是哪种语言。

## 外观

颜色、圆角、字号、时长全部来自 PlutoKeating design system：`css/tokens.css` 是 `apps/web/src/design-system/tokens.css` 的变量部分（构建时取出，不手改）。暗色是默认，访客的系统是亮色时用亮色；页眉右侧的按钮在「跟随系统 / 明亮 / 暗黑」之间切换，选择记在 `localStorage["jobs.theme"]`，由 `<head>` 里的内联脚本在首帧之前应用。首页配图按语言与外观各有一张。

设计规则沿用仓库根的 `DESIGN.md`：琥珀只表示「此刻 / 选中 / 指向」，主按钮是骨白底，不用眉题，像素图形只有字标与页脚的街道。

## 合规

- **不向任何第三方请求资源**：字体自托管，没有统计、广告或外部脚本。`_headers` 里的内容安全策略只允许本站来源；页面没有 `style` 属性和 `<style>` 块，唯一的内联脚本按 sha256 列入策略（由 `build.mjs` 计算）。
- **不设 Cookie**：浏览器里只存 `jobs.theme` 与 `jobs.lang` 两项，隐私政策里写的就是它们。
- **条款与隐私政策按实际代码写**（`src/pages/terms.mjs`、`privacy.mjs` 开头列了每一段对应的代码位置）。功能变了要同步改，并同时改 `src/site.mjs` 的 `POLICY_UPDATED` 与 `POLICY_VERSION`。
- 页脚固定带：版权与许可证、运营主体，以及关于 / 条款 / 隐私 / 联系方式的链接。模拟声明与商标声明写在条款与条件里（第 2、5 节），关于页也说明了它不是什么；不放在页脚。

## 验证

`tests/site.test.ts`：产物与源一致；每种语言的每个页面都在、互相声明 `hreflang`；页面不引用任何外部资源、不含内联样式；内联脚本的哈希都在内容安全策略里；源码与脚本不会被发布。
