# @pux/engine 架构

## Session 一步（`runtime/session-runner.ts`）

1. `WorldSimulator.advance(上一步模拟耗时)`：时间线、社交请求、概率规则、电量/时间结算、LLM 补充事件。
2. 打断：`switch_away / lock / close_tab` 通过 UAP 真实执行；工作记忆按打断时长与 `working_memory` 衰减（历史截断 + 提示「想不起做到哪」）。
3. 弱网：网络画像变化时用 CDP 限速并标记 injected。
4. `observe`：元素、截图、a11y、axe（新状态）、rrweb。验证码 → `needs_human`。
5. `perceive`：扫读、瞥一眼、视力、识字量 → 过滤后的元素与截图（只给 Mind）。
6. `runMind`（mind.fast，多模态）：独白、上一步预期是否满足、决定、意图、预期。
7. 预期违背（客观失败或 Mind 自述，模拟器/执行器层错误除外）→ `updateState` 规则引擎。
8. 结束条件：done / give_up / 耐心耗尽 / 连续预期违背 / step_away 后不回来（概率由状态决定）/ 资源耗尽 / token 预算。
9. `runOperator`（operator.plan，独立调用）：只能选择感知列表中的 ref；不可行时区分「目标存在但未被感知」（可发现性候选）与「意图幻觉」（SIM_INVALID_INTENT）。
10. `BrowserSession.act`：Policy Gate → MotorProfile 执行 → 成功标准 → 错误分层。
11. 护栏：同状态同动作重复 N 次 → SIM_LOOP（第二次即 stalled）；连续 K 步无新状态 → stalled。
12. 模拟耗时 = 阅读（字数/阅读速度，扫读打折）+ 思考 + 动作耗时 + 打字（字数/typing_cps）。

## 评估流水线（Session 结束后）

`objectiveMetrics` → `extractCandidates`（UAP 产品层错误、预期违背、放弃点、Policy 拦截、axe）→ `judgeSession`（每位评审两阶段：只看客观证据 → 再看独白修订）→ `evaluateAiQuality`（抽取 AI 轮次 + rubric + 链接 HEAD 检查）→ `postSessionInterview`（回忆口吻 + SUS/UMUX-Lite 模拟估计）→ 覆盖率回写。

每轮结束：`synthesizeIssues`（judge.meta 聚类 → fingerprint → 干净重放 → 专家对照 → 复核归因 → 严重度规则 → 可信度 → 折叠）。Study 结束：假设判定 → 已知缺陷校准 → Learning → 分数聚合 → 报告。

## 可信度传播

`calibration_results`（app × segment × scenario × dimension × metric）→ Issue.trust_level（按类别的 issue_recall）与 Score.trust_level → 报告校准卡；厂商隔离未满足时 high 降为 medium。
