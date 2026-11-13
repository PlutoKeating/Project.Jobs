# @pux/console

本地 Web 控制台与 REST API（Fastify，服务端渲染，无构建步骤）。启动：`pnpm console`（`CONSOLE_PORT`，默认 5300）。

页面：总览（Study、被测应用、一键运行）、灌入新项目（全自动评测）、Study 详情（运行日志、Session、问题、报告链接）、Session 详情（录像、时间线、评审原始分、可追问访谈）、人工接管队列。API 见 `docs/API.md`。

inline 模式下 Study 在控制台进程内运行（关闭控制台会中断）；需要持久化编排时勾选 Temporal 并运行 `pnpm worker`。
