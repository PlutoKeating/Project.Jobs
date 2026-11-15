# 校准验收记录（2026-11-14；助手 Demo · 植入缺陷版，11 个已知缺陷）

> **历史记录。** 下面的数字来自 2026-11-14、重塑之前的系统：那时虚拟人读的是从页面结构里抽出的元素文字，点击由 Stagehand 执行，模型经 LiteLLM 调用。这三样现在都换掉了（只看截图、Midscene 定位、应用内模型路由），**这些检出率与误报率没有在当前代码上重跑过，不代表现在的系统**。文中的命令是当时的写法；现在对应 `pnpm jobs dev study create …`、`pnpm jobs dev study run <id>`（见 [`../CALIBRATION.md`](../CALIBRATION.md)）。文中的「spec §」指 [`SPEC_v0.2.md`](SPEC_v0.2.md)。

基线：干净版 Study `std_uq0x8lp3uo15`（6 个 Session）+ 未匹配问题在干净版本上的自动重放。
阈值：检出率 ≥ 60%，误报率 ≤ 30%（`config/pux.config.yaml` → `thresholds`）。

## 最终验收运行

- Study：`std_j2kt5k3fvqqe`（16 个 Session × 30 步 + 第 1/7 天留存回访，Stagehand，judges=2，测试环境在开始时重置）
- 命令：`pnpm pux study create --app demo-assistant@seeded --sessions 16 --steps 30 --round 4 --concurrency 4 --mix 0.6,0.1,0.2,0.1 --revisits 1,7` → `pnpm pux study run <id>`

| 指标 | 值 | 95% CI | n | 阈值 |
|---|---|---|---|---|
| 植入缺陷检出率 | **72.7%**（8/11） | 0.43–0.90 | 11 | ≥ 60% ✅ |
| 误报率（未分诊上界） | **7.7%**（1/13） | 0.01–0.33 | 13 | ≤ 30% ✅ |

检出：AS-01、AS-02、AS-03、AS-04、AS-06、AS-09、AS-10、AS-11。未检出：AS-05、AS-07、AS-08。

分诊（spec §12.1 ⑤）：唯一未匹配问题「会话过早失效无状态说明且缺乏保持登录」被**驳回为模拟器问题**——同一 Persona 在本 Study 内第二次使用时启动的是全新浏览器（Cookie 不延续），Persona 依据记忆误以为会话失效。已修复：同一 Persona 在同一 Study 内复用设备 Cookie（验证 Study `std_v6gscgoeof0b`：第 2 个 Session 直接以登录态进入首页）。驳回后误报率仍为 1/13。

## 全部校准运行（同一植入缺陷版本）

| Study | 配置 | 检出率 | 误报率 | 备注 |
|---|---|---|---|---|
| `std_h04vy00mb6c4` | 16 Session + D1/D7 | 72.7%（8/11） | 上界 33% → 分诊后 9.1% | 分诊：驳回 1（旧版执行器下载问题遗留标题），确认 4（依据见下） |
| `std_2k4csu7ul8xv` | 16 Session（复现，回访因环境被并发重置而取消） | 54.5%（6/11） | 上界 20% | judge.meta 超时导致中断，已加降级 |
| `std_z67052j6v0d0` | 4 Session + D1，专项任务（严重困扰 / 连续多问） | 63.6%（7/11） | 20% | 验证 AS-09、AS-07 可检出 |
| `std_j2kt5k3fvqqe` | 16 Session + D1/D7（最终） | **72.7%（8/11）** | **7.7%** | 见上 |

两次完整正式运行（含回访）合计检出 16/22 = **72.7%**；四次合计 29/44 = 65.9%。11 个植入缺陷在各次运行中均至少被检出一次（AS-08 见 `std_igzk5my76nrk`）。单次 n=11，置信区间约 ±25 个百分点，单次结果在 55%–73% 之间波动属正常抽样误差。

### `std_h04vy00mb6c4` 的分诊依据

| 问题 | 结论 | 依据 |
|---|---|---|
| 「导出 Markdown」功能完全失效（P0） | ❌ 驳回 | 本 Study 会话 `ses_evlz1qzf04xl` 第 19 步观察到「浏览器下载完成」；该条目标题来自执行器支持下载之前（commit b82f2d8 前）的旧 Study，经跨 Study 合并带入。已修复为合并时采用最新措辞 |
| 快捷指令视觉反馈微弱 | ✅ 确认 | `assistant.ts` 快捷按钮仅设置输入框文字 |
| 文档残留 ```markdown 围栏 | ✅ 确认 | `POST /docs/new` 原样保存 LLM 输出 |
| 首页强制登录墙 | ✅ 确认 | `app.get('/')` 首先 `requireUser` |
| 缺失隐私政策与用户协议 | ✅ 确认 | `framework.ts` 的 `authForm` 无协议链接 |

## 校准过程中发现并修复的模拟器问题

浏览器下载无反馈；长文本无粘贴语义；模拟时钟与真实时间不一致被误判；页面被扩展后台页劫持；瞥一眼感知与截图不一致；跨 Study 合并导致问题归属丢失与旧措辞残留；环境重置后 Persona 记忆错位；同一 Persona 跨 Session 设备状态不延续；弱网密码 Persona 的恢复行为不自然（改为依据页面反馈自然调整，不预置答案）；反复尝试被当作模拟器噪声（改为交互问题证据交由归因判断）；judge.meta 超时拖垮 Study（降级 + 单轮失败不中断）；凭据过期（预检暂停 + `study resume`）。
