# @pux/api

Jobs 的 HTTP 接口（Fastify）。启动：`pnpm api`（`API_PORT`，默认 5320，只监听本机；对外经 `apps/gateway`）。

- `src/server.ts`：启动、登录守卫、WebSocket、静态文件。REST `/api/v1/*`：身份、总览（含累计花费）、发布（`src/launches.ts`：发布、状况、一页结论、工程附录、调宣发、递手机、商店与动态、虚拟身份的收件箱）、人物、世界、使用过程、问题分诊、人工接管、证据（`src/routes.ts`）。完整列表见 `docs/API.md`。
- WebSocket `/api/v1/stream`：服务端订阅 NATS（`jw.snapshot`、`jw.persona.*.live`、`jw.persona.*.say`、`jw.launches`）后扇出给浏览器。
- 托管网页构建产物 `apps/web/dist`（非接口的 GET 都回到 `index.html`）；`/reports/` 下提供内部校准批次的离线报告（`data/reports/`）。
- 访问控制（`src/auth.ts`）：`JW_PASSCODE` 共享口令、`JW_ADMIN_PASSCODE` 管理员口令；网页用 HMAC 签名 Cookie，命令行与 MCP 用 `Authorization: Bearer <口令>`；未设置时对应限制关闭。`/inbox/email`、`/inbox/sms` 免登录（供被测产品的测试环境投递验证邮件与短信）。
- 头像（`src/avatars.ts`）：启动后为没有头像的人物排队调用画图模型（没接入画图模型时不生成，网页用确定性的像素头像；`JW_AVATAR_GEN=0` 关闭），存 MinIO 与 `persona_avatars`。
- 模型接入（`src/models.ts`）：目录、整份草稿一次保存（版本冲突保护）、单目标测试、路由预览、版本与回滚；`/api/v1/llm/*` 是 OpenAI 兼容入口（仅管理员，因为它花的是真钱）。见 `docs/MODELS.md`。
- 游戏服与示例产品（`src/game.ts`）：两个 Terraria 游戏服的状态与一键开关（只向宿主机提出请求，不直接操作 Docker）、随包示例产品的清单。
- 飞书机器人（`src/feishu.ts`）：扫码接入（`@larksuiteoapi/node-sdk` 的 `registerApp`）、长连接收消息、把一句话变成一件事（`parseCommand`）、进展 / 结论 / 需介入的推送。应用凭证加密后存在 `world_kv['feishu']`。
- 发布、调宣发直接写库；「把手机递给人」经 NATS（`jw.cmd.invite`）交给世界服务，因为使用过程在世界服务里运行。
