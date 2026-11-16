# @pux/web

Jobs 的网页（Vite + React 19 + TypeScript + Tailwind v4 + TanStack Router/Query + PixiJS）。第一眼是城；结论在第二层。

- 开发：先 `pnpm world`、`pnpm api`，再 `pnpm web`（`http://127.0.0.1:5321/`，代理 `/api`、`/evidence`、`/reports` 与 WebSocket 到 API）。
- 构建：`pnpm web:build` → `apps/web/dist`，由 API 托管（`pnpm jobsworld` 首次启动会自动构建）。

## 页面

| 路径 | 页面 |
|---|---|
| `/` | 城：侧视像素城市 + 右侧「产品」（各产品打开过 / 看到的人数）与「此刻」列表；点人看他在做什么、在用什么、在想什么，可追问 |
| `/products` | 已发布的产品：每行是它此刻的五层人数与评分 |
| `/products/:id` | 一个产品：`结论`（标题、现状、如果只改一件事、最让人难受 / 让人高兴 / 会留下的人 / 会走的人 / 看到了却没点开——每一句可展开看是谁、原话、当时的屏幕）、`人`（用过的人与注意到了没点开的人）、`口碑`（商店页、评论、动态）、`工程附录`（亲历的问题含复现步骤；用户看不到的技术信号）。右栏：人数（标注「模拟」）、宣发强度、投给谁、把手机递给几个人。页头右侧（仅管理员）：暂停 / 继续、结束、`清零`（确认后城里关于它的经历全部归零，产品留着、此刻重新上线）、`下线`（确认时选「保留城里的经历」或「连同经历一起删除」，下线后回到产品列表） |
| `/people`、`/people/:id` | 居民列表；一个人的画像、此刻、今天的日程、家人与熟人、记忆、用过的产品、收件箱（邮件与短信，点开看全文，HTML 邮件在不执行脚本的沙箱里，可下载原始邮件；眼睛图标表示他在邮箱里点开过） |
| `/sessions/:id` | 一次使用的逐步回看：截图、想法、动作（含在产品和邮箱之间切换）、世界事件、这次收到的信、事后追问 |
| `/human` | 需要人介入的任务（有待处理时导航里才出现） |
| `/settings` | 设置（仅管理员；顶栏右侧的齿轮图标）：公网链接（保存后几秒内生效，标出来自环境变量还是只有本机能访问）；居民邮箱：现在的域名与能不能收真实邮件、贴 Cloudflare API Token 一键开通 / 重新部署 / 关闭、令牌需要的权限、收信规则用了多少、测试信（给临时地址发一封，等它到）；没有对应居民的信。这一页不显示「发布」 |
| `/models` | 模型接入（仅管理员；顶栏右侧的滑杆图标）：添加供应商、凭证（Vertex 另有「使用这台机器的 gcloud 登录」按钮：容器里还没挂 gcloud 配置目录时先请宿主机补上并等服务重启，做不到时提示运行一次 `jobsworld up`；没登录时提示 `gcloud auth login`）、勾选模型与用途、全局顺序（拖动 / 按钮 / 键盘）、保存前差异、测试、版本与回滚。还没接入模型的管理员第一次打开会被带到这里 |

## 结构

| 路径 | 说明 |
|---|---|
| `src/components/city/` | 侧视像素城市（PixiJS）：`draw.ts` 把 `TownLayout` 图元与人物外观画成像素，`palette.ts` 天空随模拟时钟变化，`CityCanvas.tsx` 负责拖拽、缩放、聚焦与 HTML 叠加层（气泡、名牌、地名）。`mode="horizon"` 是其他页面页脚的街道 |
| `src/components/Shell.tsx` | 顶栏（城 / 产品 / 人、累计花费、有新版本时的升级浮层（仅管理员：当前与最新版本、改了什么、「立即升级」或要运行的命令、升级中与失败的状态；新版本起来后自动刷新）、世界时钟、Terraria 浮层：地址与两个游戏服的开关、接入 coding agent 浮层（仅管理员，机器人图标：远程 MCP 链接、Claude Code / Codex / Cursor 的接入命令（点一下复制）、没设置公网链接时的提示、已授权的 agent 与撤销）、飞书浮层：扫码接入、语言、明暗主题、模型入口、「发布」）、登录页（标志的悬停提示是当前版本）、页脚街道（跟在内容后面，不盖住内容） |
| `src/components/Mail.tsx` | 收件箱列表（人物页、使用过程、设置页的无主信共用） |
| `src/components/Publish.tsx` | 发布对话框：网址、名字、一句话（`openPublish()` 可从任意页面打开）；居民还收不到真实邮件时提醒一句（管理员可以直接去设置）；有随包示例产品在跑时，左下角的「示例」可以一键填好 |
| `src/pages/` | `World`、`Products`（含 `useLiveFunnel`：接口人数 + 实时帧）、`Launch`（含清零 / 下线的确认对话框 `Lifecycle`）、`People`、`Person`、`Session`、`Human`、`Models`、`Settings` |
| `src/lib/` | API 客户端与查询（`useLaunches`、`useLaunch`、`useLaunchReport`、`useEngineering` …）、WebSocket 实时 store（`snapshot`、`live`、`say`、`launches`）、中英双语文案与标签；`clipboard.ts` 复制到剪贴板（局域网 IP 走纯 http 时 `navigator.clipboard` 不存在，退回 `execCommand`）|
| `src/design-system/tokens.css` | PlutoKeating design system token 副本（整体替换更新） |
| `.impeccable/surfaces/apps-web.md` | 设计方向契约（开发用，不打包） |

## 约定

- 不在功能旁加说明性小字；用布局、图标、交互表达。
- 颜色只来自 token，两处例外：城市画布上的地名用固定的浅色（天空只跟世界时钟走，不跟界面主题）；飞书二维码用白底（为了能扫）。琥珀只用于「此刻 / 正在发生 / 指向的就是它」；每个视图至多一个骨白主按钮（顶栏的「发布」；「模型」页上是「保存」、「设置」页上是「开通」，这两页不显示「发布」）。
- 人数一律标注「模拟」；技术信号只出现在「工程附录」。
