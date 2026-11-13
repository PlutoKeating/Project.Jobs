# M0 技术验证记录

> 由 `pnpm pux m0 --app demo-shop@clean` 于 2026-11-14 在本机生成（定位模型：operator.locate → gemini-4-hydrogen）。可对任意被测 App 重跑。


动作集：7 个自然语言定位（真值来自 Playwright DOM/a11y）

| 执行器 | 成功率 | 平均耗时 | 失败分类 |
|---|---|---|---|
| stagehand | 100% | 2979ms | {} |
| midscene | 100% | 3782ms | {} |

结论建议：成功率接近时优先选择耗时更低者；canvas/富文本等 DOM 不可靠的界面以 Midscene 视觉定位为准。数据保存在 executor_comparisons 表。
选型结论：默认执行器为 Stagehand（用户决定，且 DOM 型界面上更快）；Midscene 作为可选的纯视觉执行器（canvas、富文本、AI 对话流等 DOM 不可靠场景），按 Study 选择，不做自动切换。
