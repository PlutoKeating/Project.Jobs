# API 与接口约定

## 1. REST API（`apps/api`，默认 `http://127.0.0.1:5320`，对外经网关 `:7777`）

前缀统一为 `/api/v1`。带「管理员」标记的接口在设置了 `JW_ADMIN_PASSCODE` 时需要管理员身份（否则 403）。设置 `JW_PASSCODE` 后，除 `/me`、`/auth/*`、`/inbox/*`、`/healthz` 外都需要登录（否则 401）。身份有两种带法：网页登录后的 HttpOnly Cookie；命令行、MCP 与脚本用 `Authorization: Bearer <口令>`。

### 身份

| 方法 路径 | 说明 |
|---|---|
| `GET /me` | `{ viewer, admin, auth_required, game_port }` |
| `POST /auth/login` `{ passcode }` | 共享口令或管理员口令；写入 HttpOnly Cookie |
| `POST /auth/logout` | 清除登录 |

### 发布

| 方法 路径 | 说明 |
|---|---|
| `GET /launches` | 已发布的产品：`id`、`name`、`tagline`、`description`、`url`、`landing_url`、`form`、`shots`（商店页截图的证据 id）、`ad_text`、`intensity`、`audience`、`status`（`live` / `paused` / `ended`）、`funnel`、`spend`（`usd`、`tokens`） |
| `POST /launches`（管理员） | 发布。必填 `name`、`tagline`、`url`；可选 `landing_url`、`description`、`ad_text`、`intensity`（0–1，默认 0.3）、`audience`、`form`（`web` 电脑和手机都能开 / `h5` 只在手机上开）。返回同上的一行 |
| `GET /launches/:id` | 上面的一行，加上 `uses`（每次使用：谁、在哪、什么时候、什么设备、怎么遇到的、是否受邀、第几次、结局、离开时的原话）、`passersby`（注意到了没点开的人和当时的想法）、`reviews`（商店评论）、`posts`（公开动态）。`:id` 也可以写产品名 |
| `GET /launches/:id/report?lang=zh\|en[&force=1]` | 一页结论：`verdict`（`works` / `mixed` / `not_yet` / `too_early`）、`headline`、`summary`、`hurts`、`delights`、`who_stays`、`who_leaves`、`why_not_opened`、`next`、`funnel`、`people_used`。每一条是 `{ text, moments[], passersby[] }`：`moments` 带当事人、原话、`session_id`、`step_idx`、`screenshot_ev`。有人用完、有了新评论或路过的人明显变多时重新归纳，否则读缓存（人数始终是最新的）；`force=1` 强制重算 |
| `GET /launches/:id/engineering` | `experienced`：虚拟人亲身遇到的问题（严重度、受影响人数、是否已复现、复现步骤）；`appendix`：工程附录（无障碍扫描、接口与脚本错误、专家检查等用户看不到的技术信号，带修改建议） |
| `POST /launches/:id/promotion`（管理员） | 调宣发：`intensity`、`audience`、`status`、`ad_text`、`tagline`，只改传了的字段 |
| `POST /launches/:id/invite`（管理员） | 把手机递给人：`n`（1–20，默认 3）、`segment`、`locale`、`persona_ids`、`want`（希望他们做的一件事）。返回 `{ invited, session_ids }` |
| `GET /store` | 城里的人看到的应用商店：每个上架产品的介绍、截图、评分与评论 |
| `GET /feed[?launch_id=]` | 城里的公开动态 |

`funnel`：`reached`（看到）、`noticed`（注意到）、`interested`（有兴趣）、`opened`（打开过）、`came_back`（回来再用）、`using_now`（此刻在用）、`sessions`、`reviews`、`rating`、`by_channel`。按人去重，是这座城里实际发生的人数（模拟）。

`audience`（投给谁，空 = 所有人）：`locales`（`zh-CN` / `en-US`）、`age_min`、`age_max`、`segments`、`tags`。不在投放范围内的人也可能看到，只是少得多。

### 虚拟身份的收件箱（免登录）

每位居民有城里发的邮箱（`…@jobsworld.test`）和手机号。把被测产品测试环境的发信、发短信地址指到这里，对应的人会在使用过程中真的收到：

| 方法 路径 | 说明 |
|---|---|
| `POST /inbox/email` `{ to, from?, subject?, body }` | 投递一封邮件 |
| `POST /inbox/sms` `{ to, from?, body }` | 投递一条短信 |
| `GET /personas/:id/inbox` | 这个人收到的邮件与短信（需登录） |

### 人物

| 方法 路径 | 说明 |
|---|---|
| `GET /personas` | 每个人物的最新版本 + 使用统计（次数、用过的产品、记忆数）+ 此刻位置、需求、手机在不在手边、所在家庭 |
| `GET /personas/:id` | 画像、今天的日程、记忆（最近 120 条，来自他的记忆树）、使用历史（`sessions`；`launch_of` 把 `app_id` 对到发布 id）、信任状态、实时状态与世界时钟；`resident`（家庭、工作地点、收入、钱包、近况）、`ties`（关系网）、`here`（此时此地的处境） |
| `GET /personas/:id/avatar` | 头像：`image.gen` 生成后缓存到 MinIO；生成前返回确定性像素头像 SVG |
| `POST /personas/generate`（管理员） `{ n, locale }` | 生成新居民并住进城里（1–12 人） |

### 世界

| 方法 路径 | 说明 |
|---|---|
| `GET /overview` | 人数、使用次数、已发布产品数、待人工处理的任务数、最近一次快照 |
| `GET /world/town` | 城镇布局（图元、地点、落脚点） |
| `GET /world/snapshot` | 最近一次世界快照（时钟、人物位置与状态、世界事件） |
| `POST /world/clock`（管理员） `{ paused?, speed?, jump_to? }` | 控制世界时钟 |
| `POST /world/events`（管理员） `{ place_id, kind, minutes }` | 制造事件：`weak_network` `crowd` `rain` `power_cut` `noise`；正在该地点使用产品的人会真的受到影响 |
| `POST /world/replay` `{ session_id, speed? }` | 在原地点回放一次使用 |
| `POST /world/ask` `{ persona_id, question }` | 向人物追问（基于他最近一次已结束的使用；正在使用时返回 `busy`） |
| `GET /stream`（WebSocket） | 实时推送 `{ type, data }`：`snapshot`（世界快照）、`live`（某人使用中的一步）、`say`（气泡）、`launches`（各产品的漏斗人数） |

### 使用过程、证据、人工接管

| 方法 路径 | 说明 |
|---|---|
| `GET /sessions/:id` | 一次使用：人物、所属发布（`launch`）、逐步时间线（截图证据、想法、动作、地点、资源）、世界事件、事后访谈 |
| `POST /sessions/:id/ask` `{ q }` | 追问这次使用 → `{ answer }` |
| `POST /issues/:id/triage`（管理员） `{ status }` | `confirmed` / `rejected` / `open` |
| `GET /human`、`POST /human/:id/resolve`（管理员） | 需要人介入的任务（例如验证码） |
| `GET /evidence/:id` | 证据原文件（MinIO）或内联 JSON。设置了 `JW_PASSCODE` 时，游戏内面板用 `?k=<sha256("jw-evidence:"+JW_PASSCODE) 前 32 位十六进制>` 访问（只对本接口有效） |

### 游戏服、示例产品、飞书

| 方法 路径 | 说明 |
|---|---|
| `GET /game` | 两个 Terraria 游戏服的状态：`tshock` / `tml` 各有 `up`、`pending`；`can_toggle`（宿主机上有监视单元，网页可以一键开关）、`port`、`password`（是否设了进服密码） |
| `POST /game`（管理员） `{ kind: "tshock" \| "tml", on }` | 开关游戏服。能一键开关时返回 `{ requested: true }`：服务只往 `control/requests/` 放一个只含动作名的文件，真正执行的是宿主机上的 `jobsworld _control`。不能时返回 409 `{ error: "manual", command }`，`command` 是要在宿主机上运行的命令 |
| `GET /demos` | 随包的示例产品（在跑的时候）：`id`、`name`、`tagline`、`url`（干净版）、`flawed_url`（带着真实小毛病的版本） |
| `GET /feishu`（管理员） | 飞书机器人的状态：`connected`、`app_id`、`brand`、`pending`（等待扫码时的 `url`、`qr_svg`、`expires_at`）、`error` |
| `POST /feishu/connect`（管理员） | 开始扫码接入（飞书的一键创建应用）；返回带二维码的状态。扫码确认后在后台完成接入，并给扫码的人发一条消息 |
| `POST /feishu/test`、`POST /feishu/disconnect`（管理员） | 发一条测试消息；断开并删除保存的应用凭证 |

### 单端口网关（`apps/gateway`，`JW_PORT`，默认 `0.0.0.0:7777`）

按首包分流：HTTP/WebSocket → API；Terraria `ConnectRequest` 版本串以 `Terraria` 开头 → TShock（`TSHOCK_PORT`，默认 57777）；以 `tModLoader` 开头 → tML 服务端（`TML_PORT`，默认 57778）。不终止 TLS。

### NATS（JobsWorld 事件总线）

主题与消息格式见 `packages/jobsworld/src/protocol.ts` 与 [`JOBSWORLD.md`](JOBSWORLD.md) §3.2。发布相关：`jw.launches`（广播各产品的人数）、`jw.launches.get`、`jw.cmd.publish`、`jw.cmd.promote`、`jw.cmd.invite`（请求/应答；游戏端与 API 共用）。

## 2. 命令行与 MCP

`jobs`（仓库内为 `pnpm jobs`）通过上面的 REST 接口工作：`publish`、`ls`、`status`、`report`、`promote`、`invite`、`people`、`ask`、`clock`；`jobsworld mcp` 以 stdio 启动 MCP 服务，工具为 `publish_product`、`list_products`、`product_status`、`product_report`、`set_promotion`、`invite_people`、`ask_person`。环境变量：`JOBS_API`（服务地址，默认 `http://127.0.0.1:7777`）、`JOBS_KEY`（管理员口令）。`doctor`、`init`、`db`、`world`、`persona`、`dev` 直接访问数据库，只在服务所在的机器上用。详见 [`QUICK_START.md`](QUICK_START.md)。

## 3. UAP v0.2（执行层接口）

定义：`packages/core/src/types/uap.ts`（在 spec §10 基础上扩展了 `visual` 定位方式（`TargetRef.text` + `value`）、`risk_tags`、`injected`、`effects.visible_change`，以及 `PRODUCT_SMALL_TARGET`、`SIM_MOTOR_MISS` 错误码）。人物可用的动词不含 `navigate`。

```ts
interface Executor {
  observe(session_id: string): Promise<Observation>;
  act(req: ActionRequest): Promise<ActionResult>;
}
```

实现：`packages/executor/src/session.ts`（`BrowserSession`）。执行器名：`midscene`（人物使用：目标是 `{ by: 'visual', text, value }`，看截图定位）、`playwright`（只用于干净重放，按选择器，不调用模型）。动作结果的 `status` 按屏幕上有没有肉眼可见的变化判定（`effects.visible_change`）。

错误分层与默认归因（spec §10.2）：`product` → 产品问题候选；`environment` / `simulator` → 不计入产品问题；`executor` → 不计入产品问题（人物眼里是「在屏幕上没找到想点的东西」）；`policy` → 记录并检查产品保护机制；`injected` → 只评估产品如何应对。

## 4. 模型

### 模型组与角色

代码里的调用点用角色名调用网关（`gateway().chat(role, …)`），角色归到模型组；每个组实际用哪家的哪个模型，由已保存的模型配置决定（见 [`MODELS.md`](MODELS.md)）。

| 模型组 | 角色 | 用途 |
|---|---|---|
| `step` 每一步（必须能看图） | `mind_fast`、`world_sim`、`judge_2` | 人物使用时的每一步；注意到产品后要不要点开；补充世界事件 |
| `think` 归纳与判断 | `mind_slow`、`judge_0`、`judge_1`、`judge_meta`、`interview`、`gen_persona`、`product_induce` | 记忆整理、用完之后怎么评价与跟谁说、一页结论、问题合成、访谈与追问、生成居民的叙事 |
| `locate` 在截图上定位 | `operator_locate`（Midscene 经本地兼容入口） | 把人物说的目标换成屏幕坐标 |
| `embed` 向量（可选） | `embed` | 记忆检索与问题去重；没接入时用本地哈希向量 |
| `image` 画图（可选） | `image_gen` | 头像与相机素材；没接入时用像素头像 |

### 管理接口（全部需要管理员）

| 方法 路径 | 说明 |
|---|---|
| `GET /models` | 当前状态：`version`、`config`（连接、凭证的脱敏提示、已选模型、全局顺序；不含任何凭证正文）、`instances`（各在线实例用的是第几版、各自暂时跳过了谁）、`tests`（每个目标每项能力最近一次测试）、`catalog`（目录来源、更新时间、供应商清单）、`ready` / `missing`（每一步、归纳、定位是否各有可用目标）、`poll_ms` |
| `GET /models/catalog/:id` | 目录里一家供应商的模型：标识、名字、类型、能力、价格、能否用于定位 |
| `POST /models/catalog/refresh` | 重新拉取目录；失败返回 502，旧目录与已保存的配置不受影响 |
| `POST /models/publish` `{ base_version, submit_id?, config, new_secrets?, note? }` | 保存一份完整配置。`base_version` 是编辑起点的版本，线上已经变了返回 409 `{ error: "conflict", version, config }`；`submit_id` 相同的重复提交返回同一结果（`replay: true`）；`new_secrets` 是 `凭证 id → 明文`，只在这一次请求里出现；校验不过返回 422 |
| `GET /models/versions` | 最近 30 个版本 |
| `POST /models/rollback` `{ version }` | 把旧版本的内容作为新版本保存；返回里的 `dropped_credentials` 是因已撤销而被去掉的凭证数 |
| `POST /models/test` `{ target_id, credential_id?, capability? }` | 对已保存的配置测一个目标：`text` / `vision` / `json` / `embed` / `image`。返回 `ok`、`latency_ms`、`error_class`、`detail`、`version`、`cred` |
| `POST /models/preview` `{ config?, use?, vision? }` | 路由预览（不发真实请求）：每个模型组按顺序会试哪些目标、哪些被跳过及原因。传 `config` 时预览草稿，并返回与线上配置的 `diff` |

`GET /me` 的 `models_ready` 表示发布主线此刻是否跑得起来。

### OpenAI 兼容入口

`POST /llm/<step|think|locate>[/<定位家族>]/v1/chat/completions`（需登录；Bearer 口令即可）：请求体按 OpenAI 的 chat/completions 格式，`model` 字段会被换成实际目标的上游模型名，支持流式。示例产品里的 AI 功能用它。

## 5. 数据文件格式

- Persona：`config/personas/**/*.yaml`（`PersonaSpecSchema`）
- 场景模板：`config/worlds/*.yaml`（`WorldTemplateSchema`，`when` 为本地可信表达式）。默认不用：每次使用发生在人物此时此地的处境里（`sessions.world_context`，`world_template_id = 'live'`）；只有内部校准批次显式指定 `world_ids` 时才用模板
- 人口抽样表：`config/population/{zh-CN,en-US}.json`；随包居民：`config/population/residents.jsonl`（每行 `{ spec, household, skeleton }`）
- ProductSpec：`data/apps/<app>/<version>/product.yaml`（`ProductSpecSchema`）
- 测试环境重置（`jobsworld dev app add --reset-url`）：每个校准批次开始时 GET 该地址，让被测环境回到初始状态（内置 Demo 为 `/__pux/reset`）。
- 已知缺陷清单（`jobsworld dev app add --seeded`）：`[{ id, category, title, description, location, keywords[] }]`
- 校准输入：见 [`CALIBRATION.md`](CALIBRATION.md)
