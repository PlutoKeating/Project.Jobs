# JobsWorld：可视化工作台与 Terraria 世界（计划与决策）

> 状态：实施中（分支 `feature/jobsworld`）。本文是 JobsWorld 的唯一计划与决策记录；实现与本文不一致时以代码为准并回写本文。

## 1. 目标

把 pux 的数据变成**可以看、可以走进去**的东西，而不是文字日志：

1. **Persona 管理**：世界里都有哪些人？点进去：他是谁、做什么工作、有哪些记忆、做过什么事。
2. **实时观察（JobsWorld）**：一个虚拟城市。走到公园、地铁站，看到谁正在用哪个软件、在操作什么、在想什么、刚才做了什么、用完之后本来要去哪（接孩子？开车回家？）。可以用 Terraria 客户端（原版或 tModLoader）进入，也可以在浏览器里看实时小地图。
3. **软件报告汇总**：每个被测软件有多少人用过、原本的目标客户是谁、实际哪类人更用得上/更喜欢、总体反馈、典型反馈、一句话结论（附可信度）。

## 2. 已确认的决策（2026-11-14，用户逐项选择）

| 主题 | 决定 |
|---|---|
| 游戏服务端 | **TShock（原版 1.4.5.x 客户端）与 tModLoader（稳定版 1.4.4）都做**，共用同一个世界状态源，各自生成地图 |
| 人物在游戏里的形态 | **假玩家**（出现在玩家列表、外观可定制）。坚持假玩家；若槽位同步方案不稳定，改用无界面协议客户端真连服务器，不退回 NPC |
| 浏览器里的世界 | 网页实时小地图（PixiJS），与游戏共用同一份地点与坐标数据；点人物打开同一个详情面板 |
| 入口地址 | **单端口协议复用**：HTTP → 网页/API；握手版本串为原版 → TShock；为 tModLoader → tML 服务端 |
| 访问范围 | 局域网（0.0.0.0）+ 网页共享口令；游戏服设密码；管理员命令单独口令 |
| 世界运行方式 | 混合式：正在运行的 Session 实时直播；其他人按日程做规则驱动的轻量活动（不调模型）；已结束的 Session 可在原地点回放 |
| 人物日程 | 模板骨架 + `mind.slow` 补全，每个模拟日生成一次并入库 |
| 地图 | YAML 描述布局，程序化积木生成；自制地标 `.TEditSch` V5 蓝图入库；社区城市地图/蓝图通过下载脚本拉到 `data/`（不入库，仅本机使用） |
| 时钟 | 由世界服务驱动，可暂停/调速，默认与现实 1:1 |
| 事件总线 | NATS JetStream（docker compose） |
| 前端 | Vite + React 19 + TypeScript + Tailwind v4 + TanStack Router/Query + ECharts + PixiJS；设计系统沿用 PlutoKeating design system（暖橙强调色、Inter + 思源黑体、明暗双主题） |
| 后端 | 新建 `apps/api`（Fastify，`/api/v1`，WebSocket 推送）与 `apps/web`；`apps/console` 的功能迁入后删除 |
| 报告汇总内容 | 人群适配度分析、典型反馈墙（可跳证据）、一句话总评 + 可信度、问题与版本趋势（全部） |
| Persona 管理权限 | 浏览 + 按分布生成；冻结版本不在线编辑 |
| 游戏内交互 | 旁观 + 传送/跟随、查看人物详情、Session 结束后与人物对话（走追问访谈）、管理员控制世界（暂停/倍速/制造事件/发起 Study） |
| 人口 | 全部入库人物都住在世界里，同屏上限可配（默认 60），正在跑 Session 的人优先 |
| 人物形象 | 游戏内按年龄/性别/职业规则映射发型、肤色、服装；网页头像优先 `image.gen` 生成的像素风头像（缓存到 MinIO），失败时用确定性像素头像 |
| 游戏服务端部署 | docker compose（插件/mod 在构建镜像时编译） |
| 界面语言 | 中英双语可切换，默认中文；人物独白保持 Persona 原语言 |
| 交付顺序 | 游戏世界优先（但每个阶段都可独立运行验证） |
| 前端文案原则 | 不在功能旁加说明性小字；让布局、图标、交互解释功能 |

### 调研结论（决定依据）

- TShock 6.2.x 支持原版 1.4.5.8；tModLoader 稳定版仍是 1.4.4，1.4.5 只在 beta 分支。两种客户端都需要正版 Terraria。
- 没有找到现成的 TShock/tModLoader 假玩家实现，需要自己同步玩家槽位（PlayerInfo/PlayerActive/PlayerUpdate）。原版客户端会把玩家发出的聊天显示在其头顶，可直接作为“想法气泡”。
- 社区几乎没有许可证干净的现代城市蓝图；TEdit（MS-PL）的 `.TEditSch` V5 已支持 1.4.5.8 与 tModLoader，作为唯一蓝图格式。WorldEdit（MIT）可作 TShock 侧参考。无许可证代码只作为运行依赖或思路参考，不复制进仓库。
- 法律上“无许可证 = 保留所有权利”；按用户决定，社区素材只由下载脚本拉到本机 `data/` 使用，不提交、不分发。

## 3. 架构

```
                         ┌─────────────── 0.0.0.0:7777（单端口）───────────────┐
 浏览器 ── HTTP/WS ──▶   │ apps/gateway  首包嗅探：HTTP → api；"Terraria…" →   │
 Terraria 原版 ───────▶  │               TShock；"tModLoader…" → tML           │
 tModLoader ─────────▶   └──────┬───────────────────┬─────────────────┬───────┘
                                │                   │                 │
                     apps/api (5320)        tshock (容器 57777)   tml (容器 57778)
                     /api/v1 + WS + 静态      JobsWorld 插件        JobsWorld mod
                     apps/web 构建产物          │                     │
                                │               └──── NATS ───────────┘
                                │                      ▲
                                └──── NATS (54222) ────┤
                                                       │
                     apps/world（世界服务）：时钟、城镇布局、日程、位置模拟、
                     Session 跟踪（只读轮询 Postgres）、回放 → 发布 jw.* 事件
                                │
                     Postgres（权威数据，只读跟踪 + 新增 jobsworld 表）/ MinIO（截图）
```

- **解耦原则**：引擎（`packages/engine`）不知道世界的存在。世界服务只读 Postgres 中的 sessions/steps/observations/events 来获取实时进展，所以无论 Study 由 CLI、API 还是 Temporal 运行，都能被看到。
- **所有游戏端只依赖 NATS 上的 JSON 消息**（C# 侧内置一个极简 NATS 文本协议客户端，不引入 NuGet 依赖，避免 tModLoader 打包问题）。

### 3.1 新增模块

| 路径 | 说明 |
|---|---|
| `packages/jobsworld` | 世界契约：城镇布局 schema、日程 schema、NATS 主题与消息类型、地点匹配规则、外观映射、确定性像素头像 |
| `apps/world` | 世界服务：时钟、日程生成（骨架 + `mind.slow` 补全）、位置模拟、Session 跟踪与回放、命令处理 |
| `apps/api` | REST `/api/v1` + WebSocket `/api/v1/stream`（转发 NATS）+ 托管 `apps/web/dist`；吸收原 console 的全部功能 |
| `apps/web` | 可视化工作台（Persona、世界、软件报告、Study/Session、人工接管） |
| `apps/gateway` | 单端口 TCP 复用 |
| `game/shared` | C# 共享源码：NATS 客户端、城镇构建（积木 + `.TEditSch` V5 读取）、假玩家控制器、外观映射 |
| `game/tshock` | TShock 6.x 插件 |
| `game/tmodloader` | tModLoader 1.4.4 mod（含可点击人物面板） |
| `infra/game/*` | 两个游戏服务端的 Dockerfile |
| `config/jobsworld/` | `town.yaml`（城镇布局）、`agenda.yaml`（日程骨架规则） |
| `scripts/download-community-assets.sh` | 社区地图/蓝图下载到 `data/community/`（不入库） |

### 3.2 NATS 主题

| 主题 | 方向 | 内容 |
|---|---|---|
| `jw.clock` | world → * | `{ day, minute, clock, speed, paused }`，每真实秒一次 |
| `jw.snapshot` | world → * | 全部可见人物的位置/状态，每真实秒一次（同时写入 KV `jobsworld.snapshot`） |
| `jw.persona.<id>.live` | world → * | 实时 Session 步骤：独白、意图、动作、决策、截图证据 id、情绪 |
| `jw.persona.<id>.say` | world → 游戏 | 头顶气泡文本（想法摘要、骂人时刻） |
| `jw.town` | 请求/应答 | 城镇布局 JSON（游戏端启动时拉取） |
| `jw.cmd.clock` / `jw.cmd.event` / `jw.cmd.replay` | 网页/游戏 → world | 暂停/倍速、制造事件、回放 Session |

JetStream 流 `JW_LIVE` 保留 `jw.persona.*.live` 24 小时，用于断线补齐与回放。

### 3.3 新增数据表（迁移只新增，不修改已有表）

- `persona_agendas(persona_id, sim_date, items jsonb, source, created_at)`
- `persona_avatars(persona_id, storage_ref, mime, source, created_at)`
- `app_verdicts(app_id, summary jsonb, created_at)`（一句话总评缓存）

### 3.4 端口

| 服务 | 端口 |
|---|---|
| gateway（对外唯一入口） | `0.0.0.0:7777`（`JW_PORT`） |
| api | `127.0.0.1:5320` |
| web 开发服务器 | `127.0.0.1:5321` |
| NATS | `127.0.0.1:54222`（监控 `58222`） |
| TShock / tML 容器 | `127.0.0.1:57777` / `127.0.0.1:57778` |

## 4. 时钟与“他接下来去哪”

- 世界时钟默认与现实 1:1，可暂停或调到 10×/60×。正在运行的 Session 有自己的模拟时钟（来自世界模板），详情面板同时显示两者。
- 每个人物每个模拟日有一份日程：先按身份（职业、家庭、年龄段）由规则生成骨架（起床、通勤、工作、午饭、接孩子、回家…），再由 `mind.slow` 补全每段的意图和前后因果；模型不可用时保留骨架。
- 正在跑 Session 的人物，被放到 Session 世界模板对应的地点（“地铁车厢里站着” → 地铁），日程里的“上一段/下一段”就是“刚才做了什么 / 用完要去哪”。

## 5. 交付阶段

1. **基础契约 + 世界服务**：`packages/jobsworld`、`config/jobsworld`、NATS、`apps/world`（时钟、日程、位置、Session 跟踪、回放）。
2. **游戏端**：C# 共享库、TShock 插件、tModLoader mod、Dockerfile、城镇生成、假玩家、头顶气泡、`/goto` `/follow` `/who` `/ask` 与管理员命令。
3. **API + 网页**：`apps/api`（含 console 迁移）、`apps/web`（Persona、世界小地图、软件报告、Study/Session、人工接管）。
4. **单端口复用**：`apps/gateway`。
5. **收尾**：删除 `apps/console`、文档、端到端验证。

## 6. 与他人并行工作的约束

另一个会话正在 `main` 上进行后端开发与压测。本分支：不重置共享 Postgres、不调用 Demo 重置接口、不重启已有容器（只单独 `up` 新服务）、不占用已有端口；数据库迁移只新增表。
