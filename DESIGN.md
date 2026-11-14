---
name: JobsWorld
description: Jobs 的网页：一座侧视像素小城，把产品发布进去，看住在里面的人怎么对待它
colors:
  charcoal-night: "#0e0f11"
  charcoal-raised: "#131417"
  charcoal-surface: "#17181c"
  charcoal-hover: "#1d1e23"
  hairline: "rgb(232 228 221 / 0.08)"
  hairline-strong: "rgb(232 228 221 / 0.18)"
  bone-text: "#e8e4dd"
  ash-muted: "#a9a49c"
  ash-subtle: "#6f6b65"
  lichen-link: "#cfd8d5"
  lamplight-amber: "#f0a35e"
  lamplight-amber-hover: "#f5b67c"
  ember-ink: "#1a120a"
  amber-wash: "rgb(240 163 94 / 0.12)"
  slate-sage: "#7d8f8a"
  slate-sage-pale: "#c2cfcb"
  moss-success: "#7fb08f"
  straw-warning: "#d9b96a"
  dusty-rose-danger: "#c97c7c"
  ink-well: "#111215"
  series-river-dark: "#3d9cc4"
  series-clay-dark: "#c9792f"
  paper-bg-light: "#f7f3ec"
  paper-surface-light: "#fdfbf8"
  paper-hover-light: "#f1ece3"
  umber-text-light: "#26221e"
  umber-display-light: "#16130f"
  umber-muted-light: "#625b53"
  terracotta-accent-light: "#a5623f"
  slate-sage-light: "#5f726d"
  series-river-light: "#1f7fae"
  series-clay-light: "#b0602e"
typography:
  verdict:
    fontFamily: "Inter, Noto Sans SC, Source Han Sans SC, sans-serif"
    fontSize: "2rem"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Inter, Noto Sans SC, Source Han Sans SC, sans-serif"
    fontSize: "1.625rem"
    fontWeight: 700
    lineHeight: "2.15rem"
    letterSpacing: "-0.02em"
  stat:
    fontFamily: "Inter, Noto Sans SC, Source Han Sans SC, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 700
    lineHeight: "2rem"
    fontFeature: "tnum"
  title:
    fontFamily: "Inter, Noto Sans SC, Source Han Sans SC, sans-serif"
    fontSize: "1.1875rem"
    fontWeight: 700
    lineHeight: "1.9rem"
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Inter, Noto Sans SC, Source Han Sans SC, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 450
    lineHeight: "1.5rem"
  label:
    fontFamily: "Inter, Noto Sans SC, Source Han Sans SC, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 450
    lineHeight: "1.2rem"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "0.8125rem"
    fontWeight: 450
    lineHeight: 1.625
rounded:
  sm: "6px"
  md: "10px"
  lg: "14px"
  xl: "20px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  section: "40px"
components:
  button-primary:
    backgroundColor: "{colors.bone-text}"
    textColor: "{colors.charcoal-night}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "36px"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.bone-text}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "36px"
  button-quiet-hover:
    backgroundColor: "{colors.charcoal-hover}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ash-muted}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "28px"
  button-ghost-hover:
    backgroundColor: "{colors.charcoal-hover}"
    textColor: "{colors.bone-text}"
  button-danger:
    backgroundColor: "transparent"
    textColor: "{colors.dusty-rose-danger}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "36px"
  field:
    backgroundColor: "{colors.charcoal-raised}"
    textColor: "{colors.bone-text}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  chip:
    backgroundColor: "transparent"
    textColor: "{colors.ash-muted}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "2px 8px"
  chip-selected:
    backgroundColor: "{colors.amber-wash}"
    textColor: "{colors.bone-text}"
    rounded: "{rounded.full}"
    padding: "4px 12px"
  segmented:
    backgroundColor: "{colors.charcoal-raised}"
    textColor: "{colors.ash-muted}"
    rounded: "{rounded.md}"
    padding: "2px"
  segmented-selected:
    backgroundColor: "{colors.charcoal-hover}"
    textColor: "{colors.bone-text}"
  nav-link:
    textColor: "{colors.ash-muted}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
  nav-link-active:
    textColor: "{colors.bone-text}"
  live-tag:
    backgroundColor: "{colors.amber-wash}"
    textColor: "{colors.lamplight-amber}"
    padding: "0 6px"
  panel:
    backgroundColor: "{colors.charcoal-surface}"
    rounded: "{rounded.xl}"
    padding: "20px"
  meter:
    backgroundColor: "{colors.slate-sage}"
    rounded: "{rounded.full}"
    height: "6px"
---

# Design System: JobsWorld

## Overview

**Creative North Star: "灯下的街区"**

JobsWorld 是夜里一条有人走动的街：暖炭黑的底色像天黑后的城市，琥珀色是窗里亮着的灯，只照在「此刻正在发生」的人和事上。界面本身退到后面，是干净的细线、10px 圆角和一套继承自 PlutoKeating 设计系统的克制字号；画面的主角永远是那座侧视像素小城和城里的人。

信息密度偏中高：列表、表格和量条承载真实数据，但不堆卡片墙，不做左侧栏后台模板。导航由两层承担：顶部玻璃质感的细导航条，和每一页页脚的像素街道地平线；点街上的人就进人物，点建筑就进地点。明暗两套主题完全由 token 切换，城市天空则跟随模拟时钟，与界面主题无关。

文字尽可能少：功能由布局、图标、状态色和交互解释，控件旁边不放说明性小字（PRODUCT.md 的硬性品牌承诺）。

**Key Characteristics:**
- 暖炭黑底 + 琥珀只标「此刻」与选中，次要数据用石板灰绿。
- Inter + 思源黑体，中英混排，数字一律等宽数字（tabular）。
- 像素颗粒（crispEdges / pixelated）只属于城市、头像与 Wordmark；界面是细线与圆角。
- 平面为主，深度靠色阶叠层；阴影只给浮在画布上的东西。
- 像素街道出现在每一页的页脚，是导航也是签名；它跟在内容后面，不盖住内容。

## Colors

暖炭与骨白构成中性主体，一盏琥珀灯负责「现在」，一抹石板灰绿负责「其余的数据」。所有颜色以 `apps/web/src/design-system/tokens.css`（PlutoKeating 设计系统副本，整体替换、不手改）为唯一来源，暗色为默认，亮色为同角色的另一组值。

### Primary
- **灯下琥珀 Lamplight Amber**（`lamplight-amber`，亮色主题为 `terracotta-accent-light`）：在线小圆点（呼吸闪烁）、「正在用某软件」标签与人物气泡的应用名、导航当前页下划线、「此刻」列表的计数徽标与变化行闪烁、选中人物的头像描边、键盘焦点环、日程条上的「现在」竖线。可点击的人名、应用名与「打开」类链接在悬停时转为琥珀，表示「指向的就是它」。
- **琥珀薄雾 Amber Wash**（`amber-wash`）：琥珀的低透明铺底，用于选中的筛选胶囊、实时标签底、「此刻」列表行变化时 2.4 秒的闪烁底色。
- **余烬墨 Ember Ink**（`ember-ink`）：放在实心琥珀上的文字色。

### Secondary
- **石板灰绿 Slate Sage**（`slate-sage`，亮色 `slate-sage-light`）：量条、OCEAN 人格柱、不在线状态点、Wordmark 楼体等一切「次要但需要被看见」的数据。
- **淡石板 Slate Sage Pale**（`slate-sage-pale`）：Wordmark 高楼等需要更亮一档的次要色。

### Tertiary
- **数据双色：河蓝 + 陶土**（暗色 `series-river-dark` / `series-clay-dark`，亮色 `series-river-light` / `series-clay-light`）：留给双系列图表，经 dataviz 调色校验，随主题切换（当前界面没有图表：人数用石板灰绿横条）。不要拿来做界面强调色。

### Neutral
- **夜炭 Charcoal Night**（`charcoal-night`，亮色 `paper-bg-light`）：页面底色；也是主按钮上的文字色。
- **抬升炭 Charcoal Raised**（`charcoal-raised`）：输入框、分段控件、世界页卡片的底。
- **炭面 Charcoal Surface**（`charcoal-surface`，亮色 `paper-surface-light`）：面板、人物卡片底图。
- **悬停炭 Charcoal Hover**（`charcoal-hover`，亮色 `paper-hover-light`）：行与幽灵按钮悬停、分段控件选中项、骨架屏、头像底。
- **细线 / 强细线**（`hairline` / `hairline-strong`）：所有分隔线与边框；强细线用于次级按钮描边与滚动条。
- **骨白 Bone Text**（`bone-text`，亮色 `umber-text-light` 正文、`umber-display-light` 标题）：正文与标题；也是主按钮底色。
- **灰烬 Ash Muted / Ash Subtle**（`ash-muted` / `ash-subtle`，亮色 `umber-muted-light`）：次要文字、标签、时间戳、坐标轴。
- **地衣链接 Lichen Link**（`lichen-link`）：「打开 Session / 打开人物」这类带箭头的文字链接。
- **墨井 Ink Well**（`ink-well`）：任务日志等等宽代码块的底。
- **状态三色**（`moss-success` / `straw-warning` / `dusty-rose-danger`）：成功/完成、暂停与事件、失败/放弃与危险操作；人物气泡按情绪（开心/困惑/生气）同样取这三色。

### Named Rules
**琥珀即此刻 Rule。** 琥珀只出现在「此刻正在发生」「当前选中」「当前指向（悬停/焦点）」三件事上。静态分类、严重度、品牌装饰一律不用琥珀。审查方法：截一张静止无悬停的图，琥珀应该只落在在线的人、正在用的软件和当前页上。

**中性主按钮 Rule。** 主操作按钮是骨白底夜炭字（亮色下反转为深字色底），不是琥珀。琥珀按钮会和「此刻」信号抢语义。

**数据不借强调色 Rule。** 量条默认石板灰绿；图表用独立的河蓝/陶土双色。只有当一条量值本身就是「此刻」或被选中时才换琥珀。

## Typography

**Display Font:** Inter（回退 Noto Sans SC / 思源黑体 / sans-serif）
**Body Font:** 同上，单一无衬线家族
**Label/Mono Font:** ui-monospace 系列，仅用于日志与代码块

**Character:** 一套家族撑起全部层级，靠字重（450 / 600 / 700）与 -0.02em 的标题字距拉开层次。中文与英文同栏混排时字形稳重，不抢城市画面的戏。

### Hierarchy
- **Verdict**（700，1.875rem，≥640px 时 2.25rem，行高约 1.25，限宽 40ch）：产品页「结论」顶部的一句话，全站最大的字，一页最多一处。
- **Headline**（700，1.625rem / 2.15rem）：每页页头标题（人名、产品名、页名）。
- **Stat**（700，1.375rem，等宽数字）：页头右侧与报告横条里的关键数字，上方配 label 级小字说明是什么数。
- **Title**（700，1.1875rem / 1.9rem）：页内分节标题（今天的日程、记忆、用过的产品、最让人难受的地方）。产品页右栏的块标题（人数、宣发强度、投给谁）用 body 字号 700。世界页「此刻」面板标题降到 body 字号 700。
- **Body**（450，0.9375rem / 1.5rem）：正文、列表项、按钮与导航文字；长段落限宽 70ch。强调用 600（font-medium）。
- **Label**（450，0.8125rem / 1.2rem）：时间戳、地点、元数据、胶囊与小按钮文字；颜色多为灰烬。

### Named Rules
**等宽数字 Rule。** 时钟、计数、百分比、日期、版本号一律加 tabular（`font-variant-numeric: tabular-nums`），让实时跳动的数字不抖。

**没有眉题 Rule。** 不用全大写小字眉题、不加字距标签；层级只靠字号与字重。

## Layout

两种页面骨架：

- **世界页**：全高（视口减去 60px 页头）分栏。左侧是可拖动、可缩放的城市画布，左上角浮一块时间控制（暂停 + 1×/10×/60× 分段控件）；右侧是 400px 宽的面板（≥1024px 时在右，较窄时落到画布下方、最高 60dvh）：先是「产品」（每行：名字、此刻在用的人数、打开过 / 看到的人数），再是「此刻」列表。世界页本身不显示页脚地平线。
- **其他页面**：内容居中，最大宽 88rem（`container-wide`），左右内边距 16px（≥640px 时 24px），顶部 32px、底部 64px；页脚是 132px 高的像素街道地平线（≤640px 时 84px），随内容滚动，内容不足一屏时贴在视口底部。
- **产品页**：页头（名字、一句话、网址、发布时间、已花费；右侧暂停 / 结束）下分两栏。主栏是标签（结论 / 人 / 口碑，右端单独一个「工程附录」）与内容；右栏 21rem，从上到下是人数（五层横条，标注「模拟」）、宣发强度（滑杆）、投给谁、把手机递给几个人，≥1024px 时后三块吸顶。较窄时顺序为：人数 → 标签与内容 → 宣发与递手机。

页内常见二栏：主列 + 320px 侧栏（人物页），或 18rem 筛选列 + 主列（报告页），均在 ≥1024px 展开，较窄时堆叠。人群页是 `minmax(168px, 1fr)` 自动填充网格，横向间距 20px、纵向 32px。

间距节奏以 4px 为基数：元素内 4–8px，行内组 8–12px，块与块 16–24px，分节之间 40px（`section`）。页头标题与内容之间 24px。

导航在 <640px 时折到第二行并可横向滚动，游戏地址按钮收起；页头高度 60px（`--ds-header-height`）。

## Elevation & Depth

整体是平面的，深度靠色阶叠层：夜炭底 → 抬升炭（输入、控件）→ 炭面（面板）→ 悬停炭（悬停与选中）。分隔靠 1px 细线，不靠阴影。阴影只给「浮在城市画布上方」的东西：时间控制、人物气泡、事件图钉。页头是半透明玻璃（`surface-glass` + 12px 背景模糊），内容从下面滑过。

### Shadow Vocabulary
- **浮层 Float**（`box-shadow: 0 8px 24px -12px rgb(0 0 0 / 0.4)`）：画布上的时间控制、对话气泡、事件图钉。
- **分段选中 Lift**（`box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.18)`）：分段控件里被选中的那一格。
- **此刻光晕 Now Glow**（`box-shadow: 0 0 10px <accent>`）：仅日程条上表示「现在」的 2px 琥珀竖线。

### Named Rules
**只有画布上的东西会浮起来 Rule。** 卡片、列表、面板一律不带阴影；需要分区就用细线或色阶。

## Shapes

圆角统一来自设计系统：控件（按钮、输入框、分段控件、导航项、小头像）10px；卡片、气泡、浮层、世界页人物卡 14px；大头像、发布对话框、人工接管条目 20px；胶囊、量条、状态圆点全圆。分段控件内部选中格用 5px，贴合外框。边框一律 1px 细线；空状态的「去发起」区块用虚线强细线。

像素形状只在三处出现：城市画布（PixiJS 按图格绘制）、像素头像（`image-rendering: pixelated`）、Wordmark（16×16 `crispEdges` SVG，石板灰绿楼体 + 琥珀窗与地平线）。这三处之外的界面不画像素块。

## Components

### Buttons
干净、安静，靠描边与色阶而不是颜色说话。
- **Shape:** 10px 圆角；常规高 36px、左右 14px，小号高 28px、左右 10px，字重 600，图标与文字间距 8px（小号 6px）。
- **Primary:** 骨白底夜炭字（亮色主题下深字色底浅字），悬停降到 90% 不透明度。每个视图至多一个。
- **Quiet（默认）:** 透明底 + 强细线描边，悬停铺悬停炭、描边加深到灰烬。
- **Ghost:** 无边框灰烬字，悬停变正文色并铺悬停炭；页头工具按钮（语言、主题、游戏地址、退出）全部用它，图标 15–16px。
- **Danger:** Quiet 的形，文字用玫瑰红。
- **Hover / Focus:** 颜色过渡 150ms；键盘焦点是 2px 琥珀外描边、2px 偏移。禁用为 45% 不透明度。

### Chips
- **Style:** 全圆胶囊，1px 细线描边，label 字号，灰烬字；版本号、报告链接、Study 趋势都用它，悬停描边转琥珀、文字转正文色。
- **State:** 筛选胶囊选中时为琥珀描边 + 琥珀薄雾底 + 标题色字；未选中细线描边灰烬字。

### Segmented Control
- 抬升炭底、细线描边、10px 圆角、2px 内边距；选中格悬停炭底 + 标题色字 + Lift 阴影，未选中灰烬字。用于速度切换、「正在用 / 所有人」、记忆分类。

### Cards / Containers
- **Corner Style:** 14px（卡片）/ 20px（面板）。
- **Background:** 炭面或抬升炭；人工接管等「此刻需要人」的条目用半透明琥珀描边 + 极淡琥珀底。
- **Shadow Strategy:** 无，见 Elevation & Depth。
- **Border:** 1px 细线。
- **Internal Padding:** 12–20px。人群网格里的人物卡片是无框的头像图块，悬停整体上移 4px、名字转琥珀。

### Inputs / Fields
- **Style:** 抬升炭底、1px 细线、10px 圆角、8px × 12px 内边距、body 字号，占位符用灰烬浅色。
- **Focus:** 描边转琥珀，颜色过渡。
- **Error / Disabled:** 错误时下方一行玫瑰红 label 字（仅错误本身，不是说明文字）；禁用 45% 不透明度。

### Navigation
- 页头：玻璃底、细线下边框、60px 高；左 Wordmark（Jobs），中间三个文字导航（城 / 产品 / 人；有待人工处理的任务时多一个带琥珀计数的「接管」），右侧时钟胶囊 + Ghost 工具按钮 + 骨白主按钮「发布」。「发布」是全站唯一的主按钮，打开发布对话框（网址、名字、一句话）。
- 导航项灰烬字，悬停正文色，当前页标题色字 + 贴页头底边的 2px 琥珀下划线。
- 时钟胶囊：细线描边、标题色时间、左侧在线圆点（连上实时流时琥珀呼吸，断开时灰）。

### Lists and Tables
- 行之间用细线分隔，行高靠上下 10–12px 内边距；悬停铺悬停炭或炭面，可点的名字悬停转琥珀。
- 世界页「此刻」列表：头像 + 名字 + 实时标签 + 一行动态 + 右侧地点；行原地重排，有变化的行琥珀薄雾闪烁 2.4 秒，选中行常驻悬停炭底。

### Meters
- 6px 高全圆轨道（细线色），石板灰绿填充，左侧 label、右侧等宽数值。OCEAN 用同样语言的竖向柱。

### Pixel Horizon（签名组件）
- 每页页脚是一条侧视像素街道（与世界页同一份 town 布局），人物实时在上面走；点人进入人物卡，点建筑进入地点。它在文档流里，不吸附、不遮挡内容。天空颜色随模拟时钟从夜到晨到黄昏插值，不随界面主题变化。

### Cited Sentence（结论里的一句话）
- 一行：句子（标题色，0.9375rem，行高宽松）+ 右侧叠放的当事人小头像（最多 4 个）+ 展开箭头；行间细线。
- 展开后是证据：头像、名字与身份、原话（弯引号）、「看这次使用」链接、右侧 4:3 的当时截图（点进那一步）。路过的人只有名字、渠道与当时的想法。

### Funnel（人数）
- 五行横条：左 label、中间石板灰绿条（长度按「看到」的人数等比，非零至少 2px）、右等宽数字（为零时用灰烬浅色）。标题旁是「模拟」胶囊；有人正在用时右上角是琥珀呼吸点 + 人数。

### Range（宣发强度）
- 2px 细线轨道，已选段标题色，16px 骨白圆滑块带夜炭描边；数值在块标题右侧。松手才提交。

### Toggle Chips（投给谁）
- 全圆胶囊：未选为细线描边灰烬字，选中为骨白底夜炭字（与主按钮同色系，不用琥珀）。

### Thought Bubbles
- 人物头顶的对话气泡：14px 圆角、label 字号、最大宽 15rem、Float 阴影，220ms 放大淡入；底色按情绪取状态色（生气玫瑰红、开心苔绿、困惑麦黄、平常骨白）。

## Do's and Don'ts

### Do:
- **Do** 让琥珀只落在「此刻 / 选中 / 指向」上，静止截图里一眼就能找到谁在线。
- **Do** 主按钮用骨白底夜炭字（`button-primary`），每个视图至多一个。
- **Do** 所有数字加 tabular 等宽数字。
- **Do** 用 1px 细线和色阶分区；阴影只给浮在城市画布上的元素。
- **Do** 人数一律标注「模拟」；技术信号只放在「工程附录」。
- **Do** 颜色只通过 token 使用，`tokens.css` 整体替换不手改，明暗两套必须同时成立。
- **Do** 遵守 `prefers-reduced-motion`：呼吸、闪烁、气泡动画全部降到瞬时。

### Don't:
- **Don't** 在控件或功能旁加说明性小字；用布局、图标、状态与交互解释功能（用户硬性要求）。
- **Don't** 做「左侧栏 + KPI 卡片墙」的后台模板；关键数字放在细线分隔的横条或页头右侧。
- **Don't** 用琥珀表示分类、严重度或装饰，也不要做琥珀主按钮。
- **Don't** 把像素块用到城市、头像和 Wordmark 以外的界面上。
- **Don't** 加全大写眉题或字距标签。
- **Don't** 给卡片、列表、面板加阴影。
- **Don't** 让城市天空跟随界面明暗主题；它只跟随模拟时钟。
