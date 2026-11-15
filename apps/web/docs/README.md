# @pux/web

Jobs 的网页（Vite + React 19 + TypeScript + Tailwind v4 + TanStack Router/Query + PixiJS）。第一眼是城；结论在第二层。

- 开发：先 `pnpm world`、`pnpm api`，再 `pnpm web`（`http://127.0.0.1:5321/`，代理 `/api`、`/evidence`、`/reports` 与 WebSocket 到 API）。
- 构建：`pnpm web:build` → `apps/web/dist`，由 API 托管（`pnpm jobsworld` 首次启动会自动构建）。

## 页面

| 路径 | 页面 |
|---|---|
| `/` | 城：侧视像素城市 + 右侧「产品」（各产品打开过 / 看到的人数）与「此刻」列表；点人看他在做什么、在用什么、在想什么，可追问 |
| `/products` | 已发布的产品：每行是它此刻的五层人数与评分 |
| `/products/:id` | 一个产品：`结论`（标题、现状、如果只改一件事、最让人难受 / 让人高兴 / 会留下的人 / 会走的人 / 看到了却没点开——每一句可展开看是谁、原话、当时的屏幕）、`人`（用过的人与注意到了没点开的人）、`口碑`（商店页、评论、动态）、`工程附录`（亲历的问题含复现步骤；用户看不到的技术信号）。右栏：人数（标注「模拟」）、宣发强度、投给谁、把手机递给几个人 |
| `/people`、`/people/:id` | 居民列表；一个人的画像、此刻、今天的日程、家人与熟人、记忆、用过的产品 |
| `/sessions/:id` | 一次使用的逐步回看：截图、想法、动作、世界事件、事后追问 |
| `/human` | 需要人介入的任务（有待处理时导航里才出现） |
| `/models` | 模型接入（仅管理员；顶栏右侧的滑杆图标）：添加供应商、凭证、勾选模型与用途、全局顺序（拖动 / 按钮 / 键盘）、保存前差异、测试、版本与回滚。还没接入模型的管理员第一次打开会被带到这里 |

## 结构

| 路径 | 说明 |
|---|---|
| `src/components/city/` | 侧视像素城市（PixiJS）：`draw.ts` 把 `TownLayout` 图元与人物外观画成像素，`palette.ts` 天空随模拟时钟变化，`CityCanvas.tsx` 负责拖拽、缩放、聚焦与 HTML 叠加层（气泡、名牌、地名）。`mode="horizon"` 是其他页面页脚的街道 |
| `src/components/Shell.tsx` | 顶栏（城 / 产品 / 人、累计花费、世界时钟、Terraria 浮层：地址与两个游戏服的开关、飞书浮层：扫码接入、语言、明暗主题、模型入口、「发布」）、登录页、页脚街道（跟在内容后面，不盖住内容） |
| `src/components/Publish.tsx` | 发布对话框：网址、名字、一句话（`openPublish()` 可从任意页面打开）；有随包示例产品在跑时，左下角的「示例」可以一键填好 |
| `src/pages/` | `World`、`Products`（含 `useLiveFunnel`：接口人数 + 实时帧）、`Launch`、`People`、`Person`、`Session`、`Human`、`Models` |
| `src/lib/` | API 客户端与查询（`useLaunches`、`useLaunch`、`useLaunchReport`、`useEngineering` …）、WebSocket 实时 store（`snapshot`、`live`、`say`、`launches`）、中英双语文案与标签 |
| `src/design-system/tokens.css` | PlutoKeating design system token 副本（整体替换更新） |
| `.impeccable/surfaces/apps-web.md` | 设计方向契约（开发用，不打包） |

## 约定

- 不在功能旁加说明性小字；用布局、图标、交互表达。
- 颜色只来自 token，两处例外：城市画布上的地名用固定的浅色（天空只跟世界时钟走，不跟界面主题）；飞书二维码用白底（为了能扫）。琥珀只用于「此刻 / 正在发生 / 指向的就是它」；每个视图至多一个骨白主按钮（顶栏的「发布」；「模型」页上是「保存」，这一页不显示「发布」）。
- 人数一律标注「模拟」；技术信号只出现在「工程附录」。
