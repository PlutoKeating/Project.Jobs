# @pux/engine

模拟与评估引擎，包含 spec 十层逻辑分层中除 UAP 执行层以外的全部逻辑层。对外入口见 `src/index.ts`。

| 目录 | 职责 | 主要导出 |
|---|---|---|
| `human/` | 六层 Persona 导入/冻结、MotorProfile、Dynamic State 规则、感知滤镜（注意力与阅读预算、视力、识字量、凑近看）、识字量模型、记忆检索与整理、生成流水线 | `importPersonas` `motorProfile` `updateState` `perceive` `recall` `consolidate` `generatePersonas` |
| `world/` | World Simulator（时钟、时间线、规则事件、社交、资源、约束、矩阵初始化、LLM 补充事件） | `WorldSimulator` `importWorldTemplates` |
| `exploration/` | 生活目标、覆盖率、自适应采样 | `makeLifeGoal` `touch` `planRound` |
| `product/` | 爬取、归纳、ProductSpec 导入、任务成功信号 | `crawl` `induceProductSpec` `importProductSpec` `taskCompleted` |
| `runtime/` | 人物的想法（只看截图，输出手上的一个动作）、Session 运行器 | `SessionRunner` `runMind` `mindSystemPrompt` |
| `evaluation/` | 客观评估、候选（分「亲历」与「工程附录」两路）、评审团、AI 质量、访谈、重放、归因、问题合成、假设、分数、模拟质量 | `evaluateSessionPost`（在 control）`synthesizeIssues` `simQuality` |
| `calibration/` | 已知缺陷、真人基准、漏斗、评论、Learning、校准卡 | `calibrateSeeded` `calibrateHuman` `calibrationCard` |
| `intelligence/` | 报告（Markdown 中英 + HTML 查看器） | `generateReport` |
| `control/` | App 注册、Study 创建（幂等）、规划、inline 编排、收尾 | `createStudy` `runStudyInline` `finalizeStudy` |

依赖：`@pux/core`、`@pux/db`、`@pux/storage`、`@pux/llm`、`@pux/executor`、`@pux/demos`（仅用于注册内置 Demo）。
