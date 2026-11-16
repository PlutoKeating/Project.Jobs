# @pux/api

Jobs 的 HTTP 接口（Fastify）。启动：`pnpm api`（`API_PORT`，默认 5320，只监听本机；对外经 `apps/gateway`）。

- `src/server.ts`：启动、登录守卫、WebSocket、静态文件。REST `/api/v1/*`：身份、总览（含累计花费）、发布（`src/launches.ts`：发布、状况、一页结论、工程附录、调宣发、递手机、商店与动态、投递验证邮件与短信）、人物、世界、使用过程、问题分诊、人工接管、证据（`src/routes.ts`）。完整列表见 `docs/API.md`。
- WebSocket `/api/v1/stream`：服务端订阅 NATS（`jw.snapshot`、`jw.persona.*.live`、`jw.persona.*.say`、`jw.launches`）后扇出给浏览器。
- 托管网页构建产物 `apps/web/dist`（非接口的 GET 都回到 `index.html`）；`/reports/` 下提供内部校准批次的离线报告（`data/reports/`）。
- 访问控制（`src/auth.ts`）：`JW_PASSCODE` 共享口令、`JW_ADMIN_PASSCODE` 管理员口令；网页用 HMAC 签名 Cookie，命令行与本机 MCP 用 `Authorization: Bearer <口令>`；远程 MCP 用 OAuth 授权发出的访问令牌（`onRequest` 里查库后挂到请求上，`roleOf` 认它）；未设置时对应限制关闭。`/inbox/email`、`/inbox/sms` 免登录（供被测产品的测试环境投递验证邮件与短信）；`/inbound/email`、`/inbound/ping` 在 `/api` 之外、不需要登录，靠 HMAC 签名。
- 头像（`src/avatars.ts`）：启动后为没有头像的人物排队调用画图模型（没接入画图模型时不生成，网页用确定性的像素头像；`JW_AVATAR_GEN=0` 关闭），存 MinIO 与 `persona_avatars`。
- 模型接入（`src/models.ts`）：目录、整份草稿一次保存（版本冲突保护）、单目标测试、路由预览、版本与回滚；`/api/v1/llm/*` 是 OpenAI 兼容入口（仅管理员，因为它花的是真钱）；`/models/gcloud` 与 `/models/gcloud/connect` 给「使用这台机器的 gcloud 登录」用（后者向宿主机提出 `gcloud` 请求，把 gcloud 配置目录挂进容器）。见 `docs/MODELS.md`。
- 游戏服与示例产品（`src/game.ts`）：两个 Terraria 游戏服的状态与一键开关（只向宿主机提出请求，不直接操作 Docker）、随包示例产品的清单。
- 版本与升级（`src/update.ts`）：`/api/v1/version`（当前版本、GitHub 上最新的 Release、是否能一键升级、宿主机写回的升级进度）、`/version/check`、`/update`（只向宿主机提出 `update` 请求）。后台每小时检查一次新版本，管理员看版本时结果超过 15 分钟就当场重查（`JOBS_UPDATE_CHECK=0` 关闭，`JOBS_UPDATE_URL` 换地址）；宿主机上的命令认得哪些动作（`update`、`gcloud`），靠放一个 `ping` 请求、看它写不写 `control/host-features` 来判断。`/healthz` 与 `/me` 也带版本号。
- 飞书机器人（`src/feishu.ts`）：扫码接入（`@larksuiteoapi/node-sdk` 的 `registerApp`）、长连接收消息、把一句话变成一件事（`parseCommand`）、进展 / 结论 / 需介入的推送。应用凭证加密后存在 `world_kv['feishu']`。
- 设置与居民邮箱（`src/mail.ts`）：`/api/v1/settings`（公网链接、居民邮箱状态，仅管理员）、`/settings/mail`（一键开通 / 重新部署 / 关闭）、`/settings/mail/check`（测试信）、`/settings/mail/unowned`；收信入口 `POST /inbound/email`（Cloudflare 上的转发 Worker 调用：原始邮件 + HMAC 签名，`message/rfc822`，≤ 12 MB）与 `GET /inbound/ping`；收件箱 `/personas/:id/inbox`、`/sessions/:id/mail`、`/mail/:id`、`/mail/status`。逻辑都在 `@pux/engine` 的 `mail/`。
- 远程 MCP（`src/mcp.ts`、`src/oauth.ts`）：`<公网链接>/mcp`（公网链接来自设置页，其次是 `JOBS_PUBLIC_URL`；改了之后下一个请求按新地址重建授权元数据），Streamable HTTP（无状态）+ OAuth 2.1。协议都用 MCP SDK（`mcpAuthRouter`、`requireBearerAuth`、`StreamableHTTPServerTransport`），它们是 Express 中间件：一个小的 Express 应用挂在 Fastify 的这几个路径上（这些路径的正文 Fastify 不解析，原样交给 Express）。授权页输入口令（管理员 → 全部工具，访客 → 只读工具）；令牌落库只存哈希，访问 1 小时、刷新 30 天并轮换，换口令全部失效。工具来自 `@pux/engine/launch/tools`，执行时用 `app.inject` 在进程内转发到 `/api/v1`，带着这次的令牌；长调用每 25 秒推一条 debug 日志通知当心跳。`/api/v1/agents`（链接、已授权的 agent、撤销）给网页用。公网链接没设置时是本机地址；设置成非本机的 http 地址时这些路径返回 503。见 `docs/API.md` §2。
- 发布、调宣发直接写库；「把手机递给人」经 NATS（`jw.cmd.invite`）交给世界服务，因为使用过程在世界服务里运行。清零（`POST /launches/:id/reset`）与下线（`DELETE /launches/:id[?history=delete]`）也经 NATS（`jw.cmd.lifecycle`）交给世界服务，让它先作废进行中的使用再清库；世界服务没在跑（没有应答者）或没开发布引擎时，接口直接调 `@pux/engine` 的 `resetLaunch` / `removeLaunch`。
