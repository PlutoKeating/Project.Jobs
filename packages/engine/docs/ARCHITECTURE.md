# @pux/engine 架构

## Session 一步（`runtime/session-runner.ts`）

1. `WorldSimulator.advance(上一步模拟耗时)`：时间线、社交请求、概率规则、电量/时间结算、LLM 补充事件。
2. 打断：`switch_away / lock / close_tab` 通过 UAP 真实执行；工作记忆按打断时长与 `working_memory` 衰减（历史截断 + 提示「想不起做到哪」）。
3. 弱网：网络画像变化时用 CDP 限速并标记 injected。
4. `observe`：视口截图（人物唯一的输入）；元素几何、a11y、axe（新状态）、rrweb 是仪器与工程证据。验证码 → `needs_human`。
5. `perceive`（感知滤镜）：把真实截图变成「这个人这一眼看到的画面」。超出阅读预算的区域是模糊的（扫读的人预算小，走神、着急、只能瞥一眼时更小）；视力差的人看不清小字与低对比度的字；识字量不够的孩子读不懂超纲的字；上一步「凑近看」的区域清晰并附局部放大图。元素几何只决定滤镜落在哪里，文字不交给人物。
6. `runMind`（mind.fast，多模态，只有图）：独白、上一步预期是否满足、决定、手上的一个动作（`tap / type / scroll / go_back / press_key / long_press / hover / drag / look_closer / speak / show_camera / refresh`）、对目标的描述（`target_text` 照抄写在上面的字，`target_look` 它的样子和位置）、预期。系统提示词写明：不懂也不关心软件内部怎么运作，不改网址，不开开发者工具，不机械重试。
7. 预期违背（屏幕没有可见变化、没找到目标，或人物自述不符合预期；模拟器/执行器层错误除外）→ `updateState` 规则引擎。
8. 结束条件：done / give_up（可以第一眼就走）/ 耐心耗尽 / 连续预期违背 / step_away 后不回来（概率由状态决定）/ 资源耗尽 / token 预算。
9. 想法直接落成 UAP 动作（没有中间的 Operator 调用）。`look_closer` 不碰屏幕，只让下一眼那一块清晰，照常花时间；`refresh` 每个 Session 最多一次。
10. `BrowserSession.act`：目标 → 落点（借 DOM 换算或 Midscene 看截图定位）→ Policy Gate → 按人物的手注入 → 比较动作前后截图。
11. 护栏：同状态同动作重复 N 次 → SIM_LOOP（第二次即 stalled）；连续 K 步无新状态 → stalled。
12. 模拟耗时 = 阅读（这一眼实际读到的字数/阅读速度）+ 思考 + 动作耗时 + 打字（字数/typing_cps）。

## 评估流水线（Session 结束后）

`objectiveMetrics` → `extractCandidates`（每个候选带 `track`：预期落空、反复尝试、放弃、卡住是**亲历**；UAP 产品层错误、Policy 拦截、axe 是**工程附录**）→ `judgeSession`（每位评审两阶段：只看客观证据 → 再看独白修订）→ `evaluateAiQuality`（抽取 AI 轮次 + rubric + 链接 HEAD 检查）→ `postSessionInterview`（回忆口吻 + SUS/UMUX-Lite 模拟估计）→ 覆盖率回写。

评审团与 AI 质量评估产生的候选一律进工程附录。

每轮结束：`synthesizeIssues` 两路分开合成、互不合并。亲历一路：judge.meta 聚类（用用户的话描述）→ fingerprint → 干净重放 → 专家对照 → 复核归因（同一步的技术信号作为幕后旁证）→ 严重度规则 → 可信度 → 折叠；工程附录一路不做干净重放。Study 结束：假设判定 → 已知缺陷校准 → Learning → 分数聚合 → 报告。

## 可信度传播

`calibration_results`（app × segment × scenario × dimension × metric）→ Issue.trust_level（按类别的 issue_recall）与 Score.trust_level → 报告校准卡；厂商隔离未满足时 high 降为 medium。
