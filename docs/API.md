# API 与接口约定

## 1. REST API（`apps/api`，默认 `http://127.0.0.1:5320`，对外经网关 `:7777`）

所有入口（CLI / 工作台 / API / CI）最终都调用同一个 `createStudy()`（`packages/engine/src/control/study.ts`），用**幂等键**防止重复运行。前缀统一为 `/api/v1`；带「管理员」标记的接口在设置了 `JW_ADMIN_PASSCODE` 时需要管理员登录（否则 403）。设置 `JW_PASSCODE` 后，除 `/api/v1/me`、`/api/v1/auth/*`、`/healthz` 外都需要登录（否则 401）。

### 身份

| 方法 路径 | 说明 |
|---|---|
| `GET /me` | `{ viewer, admin, auth_required, game_port }` |
| `POST /auth/login` `{ passcode }` | 共享口令或管理员口令；写入 HttpOnly Cookie |
| `POST /auth/logout` | 清除登录 |

### Study（管理员可写）

`POST /studies`（管理员）：请求头 `Idempotency-Key: <key>`（可选）；同一键再次提交只会返回已有 Study。

```json
{
  "app_version_id": "av_xxx",
  "sessions": 6, "steps": 30, "concurrency": 3, "round": 4,
  "locale": "zh-CN",                  // zh-CN | en-US | mixed
  "temporal": false,
  "config": { "revisits": [1, 7], "judges": 2, "mode_mix": { "goal": 0.4, "curiosity": 0.25, "stress": 0.2, "adversarial": 0.15 } }
}
```

响应：`{ "id": "std_xxx", "existing": false, "isolation_warning": "…" }`。`config` 可覆盖 `StudyInputSchema` 的任意字段。

| 方法 路径 | 说明 |
|---|---|
| `GET /studies` | 最近 200 个 Study（含应用、Session 数、是否有报告、是否在本进程运行） |
| `GET /studies/:id` | Study、Session（含人物名）、问题、运行日志（inline 模式） |
| `POST /projects`（管理员） | 灌入新项目并全自动评测：`name`、`url`、`version`、`form`、`prd`、`user`/`password`、`sessions`、`steps`、`temporal` → `{ study_id }` |
| `GET /app-versions` | 可发起评测的应用版本 |
| `GET /sessions/:id` | Session、人物、软件、逐步时间线（截图证据、地点、资源、动作结果）、世界事件、访谈、评审 |
| `POST /sessions/:id/ask` `{ q }` | 可追问访谈 → `{ answer }` |
| `POST /issues/:id/triage`（管理员） `{ status }` | `confirmed` / `rejected` / `open` |
| `GET /human`、`POST /human/:id/resolve`（管理员） | 人工接管队列；Temporal 模式下同时发送 Signal |
| `GET /evidence/:id` | 证据原文件（MinIO）或内联 JSON（旧路径 `/evidence/:id` 仍可用）。设置了 `JW_PASSCODE` 时，游戏内面板用 `?k=<sha256("jw-evidence:"+JW_PASSCODE) 前 32 位十六进制>` 访问（只对本接口有效） |
| `GET /reports/<study>/index.html` | 离线 HTML 报告 |

兼容旧控制台：`POST /api/studies`（同 `/api/v1/studies`）、`GET /api/studies/:id`（307 到 v1）。

### 人物

| 方法 路径 | 说明 |
|---|---|
| `GET /personas` | 每个人物的最新版本 + 使用统计（Session 数、用过的软件、记忆数）+ 此刻位置、需求（`live.needs`）、手机在不在手边（`live.phone`）、所在家庭 |
| `GET /personas/:id` | 六层画像、今天的日程、记忆（最近 120 条，来自他的记忆树）、历史 Session、信任状态、实时状态与世界时钟；`resident`（家庭、职业大类、工作地点、收入、钱包、近况）、`ties`（关系网）、`here`（此时此地的处境：地点、姿势、设备、需求、身边的人、是否有空、还能用多久） |
| `GET /personas/:id/avatar` | 头像：`image.gen` 生成后缓存到 MinIO；生成前返回确定性像素头像 SVG |
| `POST /personas/generate`（管理员） `{ n, locale }` | 生成新居民并住进城里（1–12 人；`locale`：`zh-CN` 中国、`en-US` 英语区、`mixed` 各半） |

### 世界

| 方法 路径 | 说明 |
|---|---|
| `GET /world/town` | 城镇布局（图元、地点、落脚点，`packages/jobsworld/src/town.ts`） |
| `GET /world/snapshot` | 最近一次世界快照（时钟、人物位置/状态、世界事件） |
| `POST /world/clock`（管理员） `{ paused?, speed?, jump_to? }` | 控制世界时钟 |
| `POST /world/events`（管理员） `{ place_id, kind, minutes }` | 制造事件：`weak_network` `crowd` `rain` `power_cut` `noise`。写入 `world_events`；正在该地点使用产品的人会真的受到影响 |
| `POST /world/replay` `{ session_id, speed? }` | 在原地点回放一个 Session |
| `POST /world/ask` `{ persona_id, question }` | 和人物聊聊（基于最近一次已结束的 Session；正在使用软件时返回 `busy`） |
| `GET /stream`（WebSocket） | 实时推送：`{ type: "snapshot" \| "live" \| "say", data }` |

### 软件

| 方法 路径 | 说明 |
|---|---|
| `GET /apps` | 全部软件的简要汇总（用过的人数、Session 数、完成率、SUS 模拟估计、P0/P1） |
| `GET /apps/:id/report` | 汇总报告：概览、原本的目标客户、按人群/年龄/数字素养/AI 熟悉度/场景/模式/目标与否分组的适配度、用过的人、典型反馈（吐槽/称赞/访谈，带截图与 Session 链接）、问题（`issues`：只含虚拟人亲历的；`engineering`：工程附录）、走势、可信度 |
| `GET /apps/:id/verdict?lang=zh\|en` | 最近一次一句话总评 |
| `POST /apps/:id/verdict`（管理员） `{ lang }` | 用 `judge.meta` 基于汇总数据生成总评（缓存到 `app_verdicts`） |

适配度 = 0.30×完成率 + 0.30×SUS/100 + 0.25×还会再用比例 + 0.15×(满意度−1)/6（缺项按剩余权重归一化）；专家基线 Session 不计入。所有主观指标均为模拟估计。

### 单端口网关（`apps/gateway`，`JW_PORT`，默认 `0.0.0.0:7777`）

按首包分流：HTTP/WebSocket → API；Terraria `ConnectRequest` 版本串以 `Terraria` 开头 → TShock（`TSHOCK_PORT`，默认 57777）；以 `tModLoader` 开头 → tML 服务端（`TML_PORT`，默认 57778）。不终止 TLS。

### NATS（JobsWorld 事件总线）

主题与消息格式见 `packages/jobsworld/src/protocol.ts` 与 [`JOBSWORLD.md`](JOBSWORLD.md) §3.2。

## 2. CLI

见 `pnpm pux --help` 与 [`QUICK_START.md`](QUICK_START.md)。

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

## 4. 模型角色（LiteLLM 别名）

| 角色键（pux.config.yaml） | 别名 | 用途 |
|---|---|---|
| mind_fast | mind.fast | Persona Mind 每一步 |
| mind_slow | mind.slow | 记忆整理、生活目标、回访间生活 |
| operator_locate | operator.locate | Midscene 看截图定位目标 |
| world_sim | world.sim | LLM 补充世界事件（规则优先） |
| judge_0..2 | judge.panel.0..2 | 主观模拟评估、AI 质量（不同档位 + 不同视角） |
| judge_meta | judge.meta | 问题合成、归因复核、假设判定、校准匹配 |
| interview | interview | 事后访谈、可追问访谈 |
| gen_persona / product_induce | gen.persona / product.induce | Persona 生成、产品理解 |
| embed / image_gen | embed / image.gen | 记忆与去重向量 / 相机注入素材 |

## 5. 数据文件格式

- Persona：`config/personas/**/*.yaml`（`PersonaSpecSchema`）
- 场景模板：`config/worlds/*.yaml`（`WorldTemplateSchema`，`when` 为本地可信表达式）。默认不用：每次使用发生在人物此时此地的处境里（`sessions.world_context`，`world_template_id = 'live'`）；只有 Study 显式指定 `world_ids` 时才用模板
- 人口抽样表：`config/population/{zh-CN,en-US}.json`；随包居民：`config/population/residents.jsonl`（每行 `{ spec, household, skeleton }`）
- ProductSpec：`data/apps/<app>/<version>/product.yaml`（`ProductSpecSchema`）
- 测试环境重置（`pux app add --reset-url`）：每次 Study 开始时 GET 该地址，让被测环境回到初始状态（内置 Demo 为 `/__pux/reset`）。注意：同一环境上并发运行多个 Study 会互相干扰。
- 已知缺陷清单（`pux app add --seeded`）：`[{ id, category, title, description, location, keywords[] }]`
- 校准输入：见 [`CALIBRATION.md`](CALIBRATION.md)
