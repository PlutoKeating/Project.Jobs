# AI 产品体验官（pux）

让**模拟真人**在**模拟世界**里使用**真实产品**，发现可用性问题、流程断点、「突然不对劲」时刻和 AI 回答质量问题；每条结论都有独立证据链、复现路径、受影响人群和**可信度标签**。

> **重塑决策（2026-11-15，最新，冲突时以它为准）**：[`docs/DECISIONS_2026-11-15.md`](docs/DECISIONS_2026-11-15.md)
>
> 设计文档：[`docs/SPEC_v0.2.md`](docs/SPEC_v0.2.md) · JobsWorld：[`docs/JOBSWORLD.md`](docs/JOBSWORLD.md) · 实现架构：[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · 快速开始：[`docs/QUICK_START.md`](docs/QUICK_START.md) · API：[`docs/API.md`](docs/API.md) · 校准：[`docs/CALIBRATION.md`](docs/CALIBRATION.md)

## 它做什么

```
灌入一个 Web App（URL）
  → Product Intelligence：爬取页面、LLM 归纳功能/任务/假设（YAML 可人工确认）
  → Exploration：按覆盖缺口、未验证假设、低可信区域自适应采样「谁 × 在什么世界 × 带着什么生活目标 × 哪种模式」
  → Simulation：每个 Session 一个独立浏览器沙箱；World Simulator 推进时钟、制造打断/弱网/社交压力；
                Persona Mind（第一人称、不知道自己在被测试）决定意图；Operator 把意图落成 UAP 动作；Policy Gate 拦截高风险动作
  → Evidence：截图、感知过滤后截图、a11y、axe、rrweb、录像、网络日志、独白、世界事件，全部内容寻址入库
  → Evaluation（Session 结束后）：客观指标 → 问题候选 → 两阶段评审团 → AI 回答质量 → 事后访谈（SUS/UMUX-Lite 模拟估计）
                → 问题合成 → 干净重放 + 专家对照 + 复核归因 → 假设判定
  → Calibration：已知缺陷注入版本的检出率/误报率、真人基准、埋点漏斗、评论 → 可信度（high/medium/low/unknown）
  → Report：中英双语 Markdown + 离线 HTML 查看器（截图时间线、rrweb 回放、录像、校准卡、热力矩阵、版本对比）
```

## 一分钟开始

```bash
cp .env.example .env               # 填 VERTEX_PROJECT 与 GOOGLE_ADC_FILE
pnpm install && npx playwright install chromium
docker compose up -d               # Postgres+pgvector / MinIO / LiteLLM / Temporal
pnpm pux doctor                    # 检查全部依赖
pnpm pux init                      # 迁移 + 导入 Persona/世界模板 + 注册内置 Demo
pnpm demos &                       # 启动 11 个 Demo × (干净版 + 植入缺陷版)

# 全自动评测任意 Web App（新项目一步到位）
pnpm pux auto --url http://127.0.0.1:5501/ --name my-app --sessions 6 --steps 30

# 可视化工作台 JobsWorld（网页 + Terraria 共用一个端口，局域网可访问）
pnpm jobsworld                     # http://<本机 IP>:7777/
```

报告输出在 `data/reports/<study_id>/`（`report.zh.md`、`report.en.md`、`index.html`）。

## 仓库结构

| 路径 | 说明 |
|---|---|
| `apps/cli` | `pux` 命令行（主入口） |
| `apps/api` | JobsWorld API：REST `/api/v1`（人物、世界、软件汇总、Study/Session/问题/人工接管，`POST /studies` 支持 `Idempotency-Key`）+ WebSocket 实时推送 + 托管网页 |
| `apps/web` | 可视化工作台（React）：侧视像素城市实时观察、人物管理、软件汇总报告、评测与接管 |
| `apps/world` | 世界服务：世界时钟、人物日程、位置模拟、只读跟踪正在运行的 Session、回放 → NATS |
| `apps/gateway` | 单端口复用网关：HTTP → API，原版 Terraria → TShock，tModLoader → tML |
| `packages/jobsworld` | 世界契约：城镇布局、日程、NATS 主题与消息、外观映射、共用查询 |
| `apps/worker` | Temporal worker（Study=工作流，Session=子工作流，Step=Activity，人工接管=Signal） |
| `packages/core` | UAP v0.2 类型、领域 schema（六层 Persona、世界模板、ProductSpec、Study）、配置 |
| `packages/db` | Drizzle schema（spec §16 全部实体）与迁移 |
| `packages/storage` | MinIO/S3 证据存储（内容寻址） |
| `packages/llm` | LiteLLM 角色别名网关、结构化输出、trace、厂商隔离校验 |
| `packages/executor` | UAP 执行层：浏览器沙箱、成功标准、错误分层、Policy Gate、模态注入、录像/rrweb/axe |
| `packages/engine` | Human / World / Exploration / Product / Runtime / Evaluation / Calibration / Report / Control |
| `demos/kit` | 11 个被测 Demo（AI 助手、记账、待办、外卖、游戏、资讯、健身、笔记、天气、菜谱、儿童识字），每个都有干净版与植入缺陷版 |
| `config/` | 全局配置、Persona、世界模板、人口分布、规则、JobsWorld 城镇布局与日程骨架（`config/jobsworld/`） |
| `infra/` | LiteLLM 角色别名配置、Postgres 初始化 |
| `examples/calibration` | 真人基准 / 漏斗 / 评论的示例文件 |
| `data/` | 运行时数据（不入库）：报告、产品理解草稿、生成的 Persona、学习参数 |

## 本机模型

本机只配置了 Vertex AI 上的 Gemini（经 LiteLLM 代理，ADC 鉴权）：`gemini-4-hydrogen`（≈flash，用于 Mind/Operator）、`gemini-4-argon`（≈pro，用于记忆整理/访谈/评审）、`gemini-4-carbon`（≈ultra，用于评审/归因复核）。由于只有一家厂商，厂商隔离为 `warn` 模式：报告会标注并把相关结论可信度降一级。新增厂商只需修改 `infra/litellm/config.yaml` 与 `config/pux.config.yaml` 的 `roles`。

## 定位声明

合成用户的反馈偏浅、偏正面、缺少长尾（NN/g、ACM 2025）。本系统**不取代真人用户研究**：所有主观指标都是「模拟估计」；没有校准数据的结论一律标为「未校准（仅作假设）」。已知缺陷注入版本是早期最主要的客观校准源。

## 本机验证记录（2026-11-14）

| 验证项 | 结果 |
|---|---|
| 单元测试（`pnpm test`） | 18 项通过：UAP 抽象、Policy Gate、动作精度/状态规则、识字量、§7.2 因果链、任务信号、校准统计、schema |
| 集成测试（`PUX_INTEGRATION=1 pnpm test`） | 6 项通过：TTS 语音 → 假麦克风、图片 → 假摄像头、定位、通知拦截、可见性打断、下载反馈与长文本粘贴、弱网注入 |
| 端到端（inline） | 助手 / 记账 / 外卖（H5，中英混合，压力与对抗模式，第 1 天回访）/ 儿童识字（儿童 Persona + Policy Gate）/ 天气（REST API 创建） |
| 端到端（Temporal） | 记账 Demo（Stagehand）、翻牌游戏（Midscene 纯视觉）；幂等键重复提交返回同一 Study |
| 全自动灌入新项目 | `pux auto`（CLI）与控制台 `POST /api/projects`：爬取 → 归纳 → 自动确认 → 多轮采样 → 评估 → 校准 → 报告 |
| 人工接管 | 验证码检测 → 挂起 → DevTools 远程接管地址 → `pux human resolve` → 继续 |
| M0 执行器对比 | Stagehand 100% / 2979ms，Midscene 100% / 3782ms（见 `docs/M0_EXECUTOR_COMPARISON.md`） |
| 校准验收（助手 Demo 植入缺陷版，16 Session + D1/D7 回访） | 最终运行检出率 72.7%（8/11，CI 0.43–0.90）≥ 60% ✅，误报率 7.7%（CI 0.01–0.33）≤ 30% ✅；两次完整运行合计 72.7%，四次运行合计 65.9%，11 个缺陷均至少检出一次。详见 `docs/CALIBRATION_RECORD.md` |
| JobsWorld 工作台 | 世界服务 + API + 网页 + 单端口网关 + TShock/tModLoader 游戏服，均在本机实测（详见 `docs/JOBSWORLD.md` §7） |

已知局限：本机只有一家模型厂商（Gemini），评审与 Mind 未做到厂商隔离（报告已标注并降级）；单次 Study 的检出率存在抽样波动（n=11，置信区间较宽），需要较深使用才会暴露的缺陷（例如第 3 次提问才出现的弹窗）依赖留存回访与更多轮次；真人基准、埋点、评论校准需要导入真实数据才有意义（已提供示例与命令）；儿童 Persona 的安全 rubric 仍需人工审核后才能在正式环境开启。
