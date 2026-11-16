# @pux/engine

模拟引擎：发布主线、人、使用过程、事后评估。对外入口见 `src/index.ts`。

| 目录 | 职责 | 主要导出 |
|---|---|---|
| `launch/` | **发布主线**：发布与商店页、曝光与注意（规则）、注意到之后由人物自己决定（模型）、把处境定下来开始使用、用完后的评论 / 动态 / 口碑 / 回访念头、虚拟身份（邮箱、手机号、钱包、收件箱）、一页结论与工程附录、版本点（开发者标记「改好了」，问题清单据此分出修复前后）、给 coding agent 的 MCP 工具定义（`tools.ts`：远程 `/mcp` 与本机 stdio 共用，只经 REST 工作，不依赖 MCP SDK）。流程见 `docs/ARCHITECTURE.md` §1.1 | `publishProduct` `setPromotion` `launchVersionList` `markLaunchVersion` `JOBS_TOOLS` `launchFunnel` `LaunchEngine` `decide` `startUsage` `inviteToLaunch` `afterUse` `deliverMail` `payFromWallet` `reachableUrl` `launchReport` `experiencedIssues` `engineeringAppendix` `funnelLine` `reportText` |
| `human/` | 人物六层描述的导入与版本、手的能力、身心状态规则、感知滤镜（注意力与阅读预算、视力、识字量、凑近看）、识字量模型、记忆检索与整理（ewave 记忆树）与态度规则、人口合成（`population.ts` 统计骨架与规则推导，`populate.ts` 抽样、叙事、入库、入住） | `importPersonas` `motorProfile` `updateState` `perceive` `recall` `consolidate` `updateAttitudes` `generatePopulation` `importResidents` `settleExisting` |
| `world/` | `WorldSimulator`（一次使用期间的时钟、时间线、概率事件、身边的人、资源、约束）；`live.ts` 把居民此时此地的处境接到一次使用上（处境由 `@pux/jobsworld` 计算） | `WorldSimulator` `nextFreeContext` `contextRecord` `worldOfSession` |
| `exploration/` | 把一件要做的事写成生活里的话（发布主线的受邀使用也用它）；校准批次的覆盖率与自适应采样 | `makeLifeGoal` `touch` `planRound` |
| `product/` | 只有校准批次在用：爬取产品、归纳功能与任务、ProductSpec 导入、任务成功信号 | `crawl` `induceProductSpec` `importProductSpec` `taskCompleted` |
| `runtime/` | 人物的想法（只看截图，说出手上的一个动作）、一次使用的运行器 | `SessionRunner` `runMind` `mindSystemPrompt` |
| `evaluation/` | 一次使用结束后的评估：客观指标、问题候选（分「亲历」与「工程附录」两路）、评审、被测产品里 AI 回答的质量、访谈、干净重放、归因、问题合成与去重、模拟质量 | `evaluateSessionPost`（在 `control/`）`synthesizeIssues` `askPersona` `simQuality` |
| `calibration/` | 只有校准批次在用：已知缺陷、真人基准、漏斗、评论、学习回路、校准卡 | `calibrateSeeded` `calibrateHuman` `calibrateFunnel` `calibrateReviews` `learnFromCalibration` `calibrationCard` |
| `intelligence/` | 校准批次的报告（Markdown 中英 + HTML 查看器） | `generateReport` |
| `control/` | 产品与版本的登记；内部校准用的指派式批次（创建、分轮规划、进程内运行、收尾）。发布主线复用其中的「运行一次使用」与「事后评估」 | `addApp` `addVersion` `registerDemos` `createStudy` `runStudyInline` `finalizeStudy` `runSessionInline` `evaluateSessionPost` |

依赖：`@pux/core`、`@pux/db`、`@pux/storage`、`@pux/llm`、`@pux/memory`、`@pux/jobsworld`、`@pux/executor`、`@pux/demos`（只用于登记示例产品）。
