# @pux/demos（示例产品）

11 个小的网页产品，用来演示和校准。`pnpm demos` 启动全部，每个两个实例：干净版在 `5400+i`、带着已知毛病的版本在 `5500+i`（i 从 1 起，顺序见下表）。所有示例都需要注册或登录，由居民自己完成。装好的 Jobs 默认把它们一起跑起来（`JOBS_DEMOS=1`），发布对话框里的「示例」选的是带毛病的版本（儿童识字除外）。

| id | 名称 | 类型 | 已知缺陷 |
|---|---|---|---|
| assistant | 小智助手 | AI 工作助手（流式对话、语音、拍照、文件、文档导出、会员） | 11 |
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

示例里的 AI 功能（助手的对话与转写、资讯的总结、菜谱的推荐与识图）经 Jobs 自己的 OpenAI 兼容入口调用已接入的模型（`src/llm.ts`：`JOBS_API` 下的 `/api/v1/llm/step/v1`，带管理员口令），所以要先在「设置 › 模型」里接入模型并启动接口服务。

缺陷清单在各示例定义的 `defects` 里（类别、严重度、位置、关键词），通过 `GET /__pux/manifest.json` 暴露，由 `pnpm jobs init` 或 `pnpm jobs dev demo register` 写入 `app_versions.seeded_defects`，只在校准时用（见 `docs/CALIBRATION.md`）。`/__pux/*`（清单、重置）是给工具用的，居民不会访问。

新增示例：在 `src/apps/` 里实现 `DemoAppDef` 并加入 `src/catalog.ts`。
