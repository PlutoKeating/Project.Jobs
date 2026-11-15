# site — Jobs 官网

`https://jobs.plutokeating.beer`：落地页、关于、条款与条件、隐私政策（每页中英两种语言）、404，以及安装脚本 `/install`。仓库首页两份 README（`README.md` 英文、`README.zh-CN.md` 中文）里的示意图也从这里生成。

静态多页站：HTML + 一份手写 CSS + 一小段原生 JS，没有框架。页面由 `scripts/build.mjs` 从 `src/` 生成，**全部产物提交进仓库**——线上没有构建步骤，Cloudflare 直接把这个目录作为 Worker「jobs-site」的静态资源发布（`wrangler.jsonc`），每次推送 `main` 自动部署。`src/`、`scripts/`、`docs/` 与部署配置被 `.assetsignore` 排除，不会上线。部署方式见 [`docs/INSTALL.md`](../../docs/INSTALL.md)「对外发布（维护者）」。

## 目录

```
site/
├── src/                       # 源：改文案、改结构、改样式只改这里
│   ├── site.mjs               # 站点常量、语言注册表 LANGS、页面集合 PAGES、路径规则、联系方式、政策日期与版本
│   ├── shell.mjs              # 页眉、页脚、404 的文案（每种语言一套）
│   ├── render.mjs             # 渲染函数：<head>、页眉、页脚（含像素街道）、长文版式、图标、文案键核对
│   ├── figures.mjs            # 示意图：文案（每种语言一套）与绘制；首页内联，也另存成 README 用的独立 SVG
│   ├── site.css               # 样式源文件：只引用 design system 的变量；两行 @figures 标记之间是示意图的样式
│   └── pages/                 # 每页一个文件，文案按语言分组
│       ├── home.mjs           # 首页：开头、配图、三章（各一幅示意图）、终端与 coding agent、结构、结尾
│       ├── about.mjs / terms.mjs / privacy.mjs
│       └── not-found.mjs      # 404
├── scripts/                   # 只用 Node 内置模块（配图脚本另用仓库里的 playwright 与 sharp）
│   ├── build.mjs              # src/ → 全部页面、css、favicon、robots、sitemap、_headers；--check 只比对
│   ├── build-figures.mjs      # src/figures.mjs → ../docs/images/*.svg（README 用，每幅图 × 语言 × 明暗）；--check 只比对
│   ├── build-fonts.mjs        # 按文案用字（含示意图里的字）切出思源黑体子集
│   └── build-shots.mjs        # 给首页配图截图（每种语言 × 明暗）与分享图
├── js/site.js                 # 手写：外观切换、语言记忆、语言菜单、窄屏菜单、复制安装命令、示意图滑进视口才动
├── css/tokens.css css/site.css        # 生成物
├── fonts/                     # InterVariable.woff2、思源黑体子集（生成物）与子集清单、两份 OFL 许可
├── shots/ og.png              # 首页配图与分享图（build-shots.mjs 生成）
├── index.html about/ terms/ privacy/ 404.html en/…   # 生成物：每种语言 4 个页面 + 404
├── favicon.svg robots.txt sitemap.xml _headers       # 生成物
├── install                    # deploy/install.sh 的原样副本（node scripts/sync-install.mjs 同步）
├── wrangler.jsonc .assetsignore
└── docs/README.md             # 本文
```

**生成物清单**（不手改；改了源之后重新生成并一起提交）：全部 `*.html`、`css/tokens.css`、`css/site.css`、`favicon.svg`、`robots.txt`、`sitemap.xml`、`_headers`、`fonts/NotoSansSC-*.subset.woff2`、`fonts/NotoSansSC.subset.txt`、`shots/*.webp`、`og.png`；以及 `site/` 之外的 `docs/images/*.svg`（README 的示意图）。

## 改完之后

```bash
pnpm site:build      # = build.mjs + build-figures.mjs：改了 src/ 或 js/ 之后（页面与 README 的示意图一起重新生成）
pnpm site:check      # 只比对；产物不是最新的就失败（pnpm test 里也会跑）
node site/scripts/build-fonts.mjs    # 文案里出现了新的汉字之后（build.mjs 会提示缺哪些字），然后再 site:build
node site/scripts/build-shots.mjs    # 界面变了、想换首页配图时（需要一台正在运行的 Jobs），然后再 site:build
```

`build-fonts.mjs` 需要本机 `python3` 的 fontTools 与 brotli，以及 Debian / Ubuntu 的 `fonts-noto-cjk`。

本地预览（与线上一致，含安全响应头、404 页、无尾斜杠）：`cd site && npx wrangler dev`。

## 示意图

五幅图讲五件事，首页每章一幅：`journey`（发布之后发生什么）、`screen`（居民只看得到屏幕）、`verdict`（一页结论长什么样）、`loop`（coding agent 的循环）、`stack`（结构）。另有一幅只给 README 用的字标条幅 `banner`。

- **一份源，两个去处。** `src/figures.mjs` 里每幅图是一个函数，只输出带类名的 SVG 图元，不写颜色。首页把它内联进页面（`renderFigure`），颜色由 `src/site.css` 里 `@figures:start` / `@figures:end` 之间的样式按页面的明暗给出。`scripts/build-figures.mjs` 把同一段样式里的变量换成具体的值，嵌进独立的 SVG 文件，写到 `docs/images/<名字>.<语言>.<dark|light>.svg`；README 用 `<picture>` 按读者的外观挑一份。所以那一段样式里不要写依赖页面其他部分的选择器。
- **字号按 README 里的大小来定。** 图的画布宽 960，README 里只有约 850px 宽（缩到 0.88 倍），官网上则放大到约 1.2 倍。所以图里承载内容的字最小 13px、说明文字 14px、正文 15px，缩小后仍在 11px 以上；只有手机示意和缩略图里画的界面文字更小。加字、改字时守住这条下限，放不下就改断行或删字，不要缩字号。字号类（`t-13`、`t-14`…）在 `src/site.css` 的示意图样式里，用到哪个就定义哪个。
- **图里的文字自己断行。** SVG 不会折行，每一行是文案数组里的一项，各语言行数可以不同。改了文案要看图：`pnpm site:build` 之后打开 `docs/images/` 里对应的文件，确认没有出框、没有压到别的东西（独立文件用的是读者系统里的字体，比官网的 Inter 略宽，留些余量）。
- **动画只有一种。** 静止状态就是完整的图；动的只有一个琥珀色的「此刻」依次停在每一步上（类名 `now now-N`，每步 2.6 秒），与界面里「琥珀只表示此刻」是同一条规则。另有三处小动作：手指落点的涟漪、世界服务那盏一直亮着的灯、条幅里明灭的窗。`prefers-reduced-motion` 下全部静止。首页上图滑进视口才开始动（`js/site.js`）；窄屏上图不缩小，在自己的框里横向滑动。
- **图里的内容是真的。** 人、原话、处境、人数、问题与复现步骤都取自开发实例里的真实运行（示例产品「闪念笔记」「今天吃啥」），写在 `figures.mjs` 的文案与常量里；英文版里的中文原话是翻译，图的说明文字里写明。换数据时两种语言一起换，不要编。

## 多语言

语言注册在 `src/site.mjs` 的 `LANGS`。默认语言（第一项，中文）在根路径，其他语言加前缀（英文 `/en/…`）；每个页面都有全部语言的版本，`<head>` 里互相声明 `hreflang`，页眉的语言菜单指向当前页面的其他语言版本。

**加一种语言**：

1. 在 `LANGS` 里加一项（`code`、路径前缀 `prefix`、`htmlLang`、`ogLocale`、菜单里显示的 `label`、浏览器语言匹配规则 `accepts`、词间是否用空格 `spaced`）。
2. 在 `src/shell.mjs` 和 `src/pages/` 的每个文案对象里补上同名的键。
3. `pnpm site:build`。缺了哪一页的哪种语言、哪个键对不上默认语言、数组长度不一致，构建都会报错并指出位置；页面、404、站点地图、语言菜单、首页的语言跳转都自动带上新语言。新语言用到新的汉字时再跑一次 `build-fonts.mjs`。

访客的语言选择记在浏览器的 `localStorage["jobs.lang"]`（点语言菜单时写入）。只有默认语言的首页会跳转：记住的语言不是中文就去那种语言的首页；没记住时按浏览器的语言偏好挑第一个认识的，都不认识就去 `FALLBACK_LANG`（英文）。其他页面不跳转，分享出去的链接是哪种语言就是哪种语言。

## 外观

颜色、圆角、字号、时长全部来自 PlutoKeating design system：`css/tokens.css` 是 `apps/web/src/design-system/tokens.css` 的变量部分（构建时取出，不手改）。暗色是默认，访客的系统是亮色时用亮色；页眉右侧的按钮在「跟随系统 / 明亮 / 暗黑」之间切换，选择记在 `localStorage["jobs.theme"]`，由 `<head>` 里的内联脚本在首帧之前应用。首页配图按语言与外观各有一张。

设计规则沿用仓库根的 `DESIGN.md`：琥珀只表示「此刻 / 选中 / 指向」，主按钮是骨白底，不用眉题，像素图形只有字标与页脚的街道（README 的条幅用的也是这条街）。示意图是细线与圆角，不画像素块。

## 合规

- **不向任何第三方请求资源**：字体自托管，没有统计、广告或外部脚本。`_headers` 里的内容安全策略只允许本站来源；页面没有 `style` 属性和 `<style>` 块，唯一的内联脚本按 sha256 列入策略（由 `build.mjs` 计算）。
- **不设 Cookie**：浏览器里只存 `jobs.theme` 与 `jobs.lang` 两项，隐私政策里写的就是它们。
- **条款与隐私政策按实际代码写**（`src/pages/terms.mjs`、`privacy.mjs` 开头列了每一段对应的代码位置）。功能变了要同步改，并同时改 `src/site.mjs` 的 `POLICY_UPDATED` 与 `POLICY_VERSION`。
- 对 Steve Jobs 的致敬只有一句（`src/shell.mjs` 的 `tribute`），出现在两处：首页配图下面、关于页的页头；条款第 2 节写明本项目与 Apple 及其家人、遗产管理方无关。
- 页脚固定带：版权与许可证、运营主体，以及关于 / 条款 / 隐私 / 联系方式的链接。模拟声明与商标声明写在条款与条件里（第 2、5 节），关于页也说明了它不是什么；不放在页脚。

## 验证

`tests/site.test.ts`：产物与源一致；每种语言的每个页面都在、互相声明 `hreflang`；页面不引用任何外部资源、不含内联样式；内联脚本的哈希都在内容安全策略里；源码与脚本不会被发布；首页内联了五幅示意图且图里不带颜色；README 的示意图与源一致、不引用外部资源，两份 README 引用的本地图片都在仓库里。
