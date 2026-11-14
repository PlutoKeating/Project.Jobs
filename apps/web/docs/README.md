# @pux/web

JobsWorld 可视化工作台（Vite + React 19 + TypeScript + Tailwind v4 + TanStack Router/Query + PixiJS + ECharts）。

- 开发：先 `pnpm world`、`pnpm api`，再 `pnpm web`（`http://127.0.0.1:5321/`，代理 `/api`、`/evidence`、`/reports` 与 WebSocket 到 API）。
- 构建：`pnpm web:build` → `apps/web/dist`，由 API 托管（`pnpm jobsworld` 首次启动会自动构建）。

## 结构

| 路径 | 说明 |
|---|---|
| `src/components/city/` | 侧视像素城市（PixiJS）：`draw.ts` 把 `TownLayout` 图元与人物外观画成像素，`palette.ts` 天空随模拟时钟变化，`CityCanvas.tsx` 负责拖拽/缩放/聚焦与 HTML 叠加层（气泡、名牌、地名）。`mode="horizon"` 是每页底部常驻的街道地平线 |
| `src/components/Shell.tsx` | 顶栏（导航、世界时钟、游戏地址、语言、明暗主题）、登录页、底部地平线 |
| `src/pages/` | 世界、人（列表/详情）、软件（列表/汇总报告）、评测（列表/详情/发起/灌入）、Session 时间线、人工接管 |
| `src/lib/` | API 客户端与查询、WebSocket 实时 store、中英双语文案与标签 |
| `src/design-system/tokens.css` | PlutoKeating design system token 副本（整体替换更新） |
| `.impeccable/surfaces/apps-web.md` | 设计方向契约（开发用，不打包） |

## 约定

- 不在功能旁加说明性小字；用布局、图标、交互表达。
- 颜色只来自 token；图表双系列配色经 dataviz `validate_palette.js` 校验（`src/components/Chart.tsx` 的 `SERIES`）。
- 所有主观指标显示「模拟估计」与可信度标签。
