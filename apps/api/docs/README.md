# @pux/api

JobsWorld API（Fastify）。启动：`pnpm api`（`API_PORT`，默认 5320，只监听本机；对外经 `apps/gateway`）。也可 `pnpm pux console`。

- REST `/api/v1/*`：身份、人物、世界、软件汇总报告、Study/Session/问题/人工接管/证据（取代原 `apps/console`），完整列表见 `docs/API.md`。
- WebSocket `/api/v1/stream`：服务端订阅 NATS（`jw.snapshot`、`jw.persona.*.live`、`jw.persona.*.say`）后扇出给浏览器。
- 托管网页构建产物 `apps/web/dist`（SPA 回退到 `index.html`）与离线报告 `/reports/*`。
- 访问控制（`src/auth.ts`）：`JW_PASSCODE` 共享口令、`JW_ADMIN_PASSCODE` 管理员口令（HMAC 签名 Cookie）；未设置时对应限制关闭。
- 软件汇总（`src/rollup.ts`）：跨 Study 聚合 Session 事实（完成、SUS/UMUX 模拟估计、还会再用、评审满意度）→ 分组适配度、典型反馈墙、问题走势、可信度；`judge.meta` 生成一句话总评（缓存到 `app_verdicts`）。
- 头像（`src/avatars.ts`）：启动后为没有头像的人物排队调用 `image.gen`（`JW_AVATAR_GEN=0` 关闭），存 MinIO 与 `persona_avatars`。
- inline 模式下由 API 发起的 Study 在 API 进程内运行（关闭 API 会中断）；需要持久化编排时选 Temporal 并运行 `pnpm worker`。
