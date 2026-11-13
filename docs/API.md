# API 与接口约定

## 1. REST API（`apps/console`，默认 `http://127.0.0.1:5300`）

所有入口（CLI / 控制台 / API / CI）最终都调用同一个 `createStudy()`（`packages/engine/src/control/study.ts`），用**幂等键**防止重复运行。

### `POST /api/studies`

创建并启动一个 Study。请求头 `Idempotency-Key: <key>`（可选）；同一键再次提交只会返回已有 Study，不会重复运行。

```json
{
  "app_version_id": "av_xxx",
  "sessions": 6, "steps": 30, "concurrency": 3, "round": 4,
  "executor": "stagehand",            // stagehand | midscene
  "locale": "zh-CN",                  // zh-CN | en-US | mixed
  "temporal": false,                  // true：提交到 Temporal 工作流
  "config": { "revisits": [1, 7], "judges": 2, "mode_mix": { "goal": 0.4, "curiosity": 0.25, "stress": 0.2, "adversarial": 0.15 } }
}
```

响应：`{ "id": "std_xxx", "existing": false, "isolation_warning": "…" }`

`config` 可覆盖 `StudyInputSchema`（`packages/core/src/types/domain.ts`）的任意字段：`persona_ids`、`world_ids`、`include_children`、`expert_baseline`、`clean_replay`、`interview`、`saturation_m`、`report_lang`、`headed`、`budget.max_tokens` 等。

### `GET /api/studies/:id`

返回 Study、Session 列表、问题摘要和最近的运行日志（inline 模式）。

### `POST /api/projects`（表单或 JSON）

灌入新项目并全自动评测：`name`、`url`、`version`、`form`（web/h5）、`prd`、`user`/`password`（可选测试账号）、`sessions`、`steps`、`executor`、`temporal`。返回 `{ study_id }`（`Accept: application/json` 时）。

### 其他

| 路径 | 说明 |
|---|---|
| `GET /evidence/:id` | 证据原文件（截图/视频/rrweb 等，从 MinIO 读取）或内联 JSON |
| `GET /reports/<study>/index.html` | 离线 HTML 报告 |
| `POST /sessions/:id/ask` | 可追问访谈（表单字段 `q`） |
| `POST /human/:id/resolve` | 标记人工接管完成（Temporal 模式下同时发送 Signal） |
| `GET /healthz` | 健康检查 |

## 2. CLI

见 `pnpm pux --help` 与 [`QUICK_START.md`](QUICK_START.md)。

## 3. UAP v0.2（执行层接口）

定义：`packages/core/src/types/uap.ts`（与 spec §10 一致，扩展了 `ref` 定位方式、`risk_tags`、`injected`、`content_appeared`/`viewport_changed`/`file_attached` 成功标准，以及 `PRODUCT_SMALL_TARGET`、`SIM_MOTOR_MISS` 错误码）。

```ts
interface Executor {
  observe(session_id: string): Promise<Observation>;
  act(req: ActionRequest): Promise<ActionResult>;
}
```

实现：`packages/executor/src/session.ts`（`BrowserSession`）。执行器名：`stagehand`（默认，DOM/a11y 元素 ref + Stagehand observe 兜底）、`midscene`（全部视觉定位）、`playwright`（只用于干净重放与 M0 真值，不调用模型）。

错误分层与默认归因（spec §10.2）：`product` → 产品问题候选；`environment` / `simulator` → 不计入产品问题；`executor` → 归因复核（目标存在但未被感知 → 可发现性问题候选）；`policy` → 记录并检查产品保护机制；`injected` → 只评估产品如何应对。

## 4. 模型角色（LiteLLM 别名）

| 角色键（pux.config.yaml） | 别名 | 用途 |
|---|---|---|
| mind_fast | mind.fast | Persona Mind 每一步 |
| mind_slow | mind.slow | 记忆整理、生活目标、回访间生活 |
| operator_plan / operator_locate | operator.plan / operator.locate | 意图 → UAP 动作；Stagehand/Midscene 定位 |
| world_sim | world.sim | LLM 补充世界事件（规则优先） |
| judge_0..2 | judge.panel.0..2 | 主观模拟评估、AI 质量（不同档位 + 不同视角） |
| judge_meta | judge.meta | 问题合成、归因复核、假设判定、校准匹配 |
| interview | interview | 事后访谈、可追问访谈 |
| gen_persona / product_induce | gen.persona / product.induce | Persona 生成、产品理解 |
| embed / image_gen | embed / image.gen | 记忆与去重向量 / 相机注入素材 |

## 5. 数据文件格式

- Persona：`config/personas/**/*.yaml`（`PersonaSpecSchema`）
- 世界模板：`config/worlds/*.yaml`（`WorldTemplateSchema`，`when` 为本地可信表达式）
- ProductSpec：`data/apps/<app>/<version>/product.yaml`（`ProductSpecSchema`）
- 已知缺陷清单（`pux app add --seeded`）：`[{ id, category, title, description, location, keywords[] }]`
- 校准输入：见 [`CALIBRATION.md`](CALIBRATION.md)
