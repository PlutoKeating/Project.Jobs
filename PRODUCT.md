# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack
Vite + React 19 + TypeScript + Tailwind v4 + TanStack Router/Query + ECharts + PixiJS（`apps/web`），后端 `apps/api`（Fastify）。由用户在 2026-11-14 的决策问答中选定。

## Users
- 主要用户：产品负责人/产品经理本人（仓库所有者）与其团队同事、评审。他们在局域网里打开工作台，想**直接看到**模拟用户怎么用自家软件，而不是读日志。
- 场景：评测跑完后复盘一个软件到底怎么样；评测进行中实时围观「世界里的人」正在怎么用；挑选/了解模拟人群。

## Product Purpose
pux（AI 产品体验官）让模拟真人在模拟世界里使用真实产品。JobsWorld 是它的可视化工作台：
1. Persona 管理：都有哪些人、他是谁、做什么工作、有哪些记忆、做过什么。
2. 实时观察：一座侧视像素小城（与 Terraria 世界共用同一份地点与坐标），点人物即可看到他正在用什么软件、在操作什么、在想什么、刚才做了什么、接下来要去哪。
3. 软件报告汇总：多少人用过、原本的目标客户是谁、实际哪类人更适配/更喜欢、总体与典型反馈、一句话结论。
成功 = 不读文字日志也能在一两分钟内回答「这个软件怎么样、谁喜欢、哪里让人骂」。

## Positioning
结论来自「住在一座城里、有日程有记忆的模拟人」的真实操作证据：每条反馈都能跳回当时的截图、地点与心理状态。

## Operating Context
- 同一个地址同时承载网页与 Terraria（原版走 TShock、tModLoader 走 tML 服务端），局域网访问，共享口令 + 管理员口令。
- 评测由 CLI/API/Temporal 运行；工作台只读跟踪数据库实时呈现。
- 中英双语，默认中文；人物独白保持原语言。

## Capabilities and Constraints
- Persona：浏览 + 按分布生成；冻结版本不在线编辑。
- 世界：时钟默认 1:1，可暂停/调速；管理员可制造事件、回放 Session、发起 Study。
- 所有主观指标是「模拟估计」，必须带可信度标签；未校准的结论标为假设。
- 旧 console 的功能（发起 Study、灌入项目、Session 时间线、追问访谈、问题分诊、人工接管）全部迁入工作台。

## Brand Commitments
- 视觉体系沿用用户指定的 PlutoKeating design system（`~/profile-readme/site/design-system/tokens.generated.css`：暖炭黑底 + 琥珀强调色，Inter + 思源黑体，明暗双主题）。
- 用户硬性要求：**不在功能旁加说明性小字**，让布局、图标、交互解释功能。

## Evidence on Hand
真实数据在 Postgres：16 个人物、151 个 Session、约 1500 步独白与截图、140 个问题、访谈与 SUS 模拟估计、校准结果。不得编造客户或指标。

## Product Principles
1. 看见，而不是读：先画面，后数字，文字最少。
2. 每个结论可追到证据（截图、地点、当时的心情）。
3. 诚实标注可信度，模拟估计不冒充真实测量。
4. 世界是活的：时间在走，人在动。
