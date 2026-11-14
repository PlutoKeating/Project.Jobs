# @pux/engine

模拟引擎：发布主线、人、使用过程、事后评估。对外入口见 `src/index.ts`。

| 目录 | 职责 | 主要导出 |
|---|---|---|
| `launch/` | **发布主线**：发布与商店页、曝光与注意（规则）、注意到之后由人物自己决定（模型）、把处境定下来开始使用、用完后的评论 / 动态 / 口碑 / 回访念头、虚拟身份（邮箱、手机号、钱包、收件箱）、一页结论与工程附录。流程见 `docs/ARCHITECTURE.md` §1.1 | `publishProduct` `setPromotion` `launchFunnel` `LaunchEngine` `decide` `startUsage` `inviteToLaunch` `afterUse` `deliverMail` `launchReport` `experiencedIssues` `engineeringAppendix` |
| `human/` | 六层 Persona 导入/冻结、MotorProfile、Dynamic State 规则、感知滤镜（注意力与阅读预算、视力、识字量、凑近看）、识字量模型、记忆检索与整理（ewave 记忆树）与态度规则、人口合成（`population.ts` 统计骨架与规则推导，`populate.ts` 抽样、叙事、入库、入住） | `importPersonas` `motorProfile` `updateState` `perceive` `recall` `consolidate` `generatePersonas` |
| `world/` | World Simulator（时钟、时间线、规则事件、社交、资源、约束）；`live.ts` 是合并世界的入口：一次使用发生在人物此时此地的处境里（处境由 `@pux/jobsworld` 计算） | `WorldSimulator` `nextFreeContext` `contextRecord` `worldOfSession` |
| `exploration/` | 生活目标；校准批次的覆盖率与自适应采样 | `makeLifeGoal` `touch` `planRound` |
| `product/` | 爬取、归纳、ProductSpec 导入、任务成功信号 | `crawl` `induceProductSpec` `importProductSpec` `taskCompleted` |
| `runtime/` | 人物的想法（只看截图，输出手上的一个动作）、Session 运行器 | `SessionRunner` `runMind` `mindSystemPrompt` |
| `evaluation/` | 客观评估、候选（分「亲历」与「工程附录」两路）、评审团、AI 质量、访谈、重放、归因、问题合成、假设、分数、模拟质量 | `evaluateSessionPost`（在 control）`synthesizeIssues` `simQuality` |
| `calibration/` | 已知缺陷、真人基准、漏斗、评论、Learning、校准卡 | `calibrateSeeded` `calibrateHuman` `calibrationCard` |
| `intelligence/` | 校准批次的报告（Markdown 中英 + HTML 查看器） | `generateReport` |
| `control/` | 产品注册；内部校准用的指派式批次（创建、规划、进程内编排、收尾）。发布主线复用其中的单次使用运行与事后评估 | `createStudy` `runStudyInline` `finalizeStudy` |

依赖：`@pux/core`、`@pux/db`、`@pux/storage`、`@pux/llm`、`@pux/memory`、`@pux/jobsworld`、`@pux/executor`、`@pux/demos`（仅用于注册内置 Demo）。
