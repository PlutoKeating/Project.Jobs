# @pux/demos（内置被测 Demo）

`pnpm demos` 启动全部 11 个 Demo，每个两个实例：干净版 `5400+i`、植入缺陷版 `5500+i`。所有 Demo 都需要注册/登录（由 Persona 自己完成）。

| id | 名称 | 类型 | 已知缺陷 |
|---|---|---|---|
| assistant | 小智助手 | 类豆包 AI 工作助手（Gemini 流式对话、语音、拍照、文件、文档导出、会员） | 11 |
| ledger | 随手记账 | 记账 | 8 |
| planner | 轻计划 | 待办/日程/提醒 | 7 |
| shop | 饱了么外卖 | 外卖（定位、优惠券、沙箱支付，H5） | 8 |
| game | 翻翻乐 | 记忆翻牌游戏 | 4 |
| reader | 每日看点 | 资讯阅读 + AI 总结 | 4 |
| fitness | 动起来 | 健身打卡 | 3 |
| notes | 闪念笔记 | 笔记 | 3 |
| weather | 出门看天 | 天气出行 | 3 |
| recipe | 今天吃啥 | 菜谱 + AI 推荐 + 拍照识别 | 3 |
| kids | 小熊识字 | 儿童识字（儿童安全策略的被测对象） | 4 |

缺陷清单在各 App 定义的 `defects` 中（类别、严重度、位置、关键词），通过 `GET /__pux/manifest.json` 暴露、由 `pux init`/`pux demo register` 写入 `app_versions.seeded_defects`。`/__pux/*` 仅供体验官使用，爬虫与 Persona 不会访问。

新增 Demo：在 `src/apps/` 中实现 `DemoAppDef` 并加入 `src/catalog.ts`。
