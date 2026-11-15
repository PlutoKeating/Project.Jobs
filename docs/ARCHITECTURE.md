# 架构

> 本文描述当前代码的实际实现。产品决策见 [`DECISIONS_2026-11-15.md`](DECISIONS_2026-11-15.md)；城见 [`JOBSWORLD.md`](JOBSWORLD.md)；模型接入见 [`MODELS.md`](MODELS.md)；安装形态见 [`INSTALL.md`](INSTALL.md)。

## 1. 部署形态

```
宿主机（pnpm / Node 24 原生运行）                     docker compose（只跑依赖）
┌──────────────────────────────────────────┐        ┌──────────────────────────────┐
│ apps/cli      命令行 + MCP 服务             │        │ postgres  pgvector/pg17      │ 55432
│ apps/api      接口 + 网页 + 飞书机器人      │──────▶ │ minio     S3 兼容证据存储     │ 59000/59001
│ apps/world    世界服务 + 发布引擎           │        │ nats      事件总线            │ 54222/58222
│ apps/gateway  单端口网关 0.0.0.0:7777       │        │ tshock/tml 游戏服（profile game）│ 57777/57778
│ demos/kit     11 个示例产品（22 个实例）     │        └──────────────────────────────┘
│ packages/llm  应用内模型路由 ───────────────┼──▶ 各家模型供应商（管理员在网页里接入）
└──────────────────────────────────────────┘
```

- **唯一权威数据源**：Postgres（结构化数据）+ MinIO（截图、录像等大文件，按内容哈希寻址、只追加）。
- **谁在驱动**：世界服务。它推进时钟、日程与需求，并每 10 秒让发布引擎算一遍「这段时间里谁遇到了什么」；使用过程（浏览器会话）在世界服务进程内并发运行（`JW_CONCURRENCY`，默认 3；`JW_RUNNER=0` 关闭）。API 只读写数据库并经 NATS 向世界服务发命令。
- **模型**：应用内路由（`packages/llm`）。代码里的调用点只说自己是哪个角色，角色归到五个模型组（每一步、归纳、定位、向量、画图）；用哪家的哪个模型、按什么顺序接替，由管理员在网页的「模型」里配置并保存，几秒内生效。见 [`MODELS.md`](MODELS.md)。

上图是从源码运行时的形态。**装好的 Jobs**（[`INSTALL.md`](INSTALL.md)）把左边一列全部打进一个镜像，由 `deploy/entrypoint.sh` 先迁移数据库、让随包居民入住，再启动世界服务、接口、网关和示例产品；右边仍是各自的标准镜像（`deploy/compose.yml`）。Linux 上 `jobs` 容器用宿主机网络（本机回环地址上的开发服务器原样可达），其他系统用端口映射并把本机地址换成 `host.docker.internal`（`reachableUrl`）。网页上的「一键开启游戏服」不让容器接触 Docker：容器只写一个请求文件，由宿主机上的 `jobsworld _control`（systemd 监视单元触发）执行。

## 2. 发布主线（`packages/engine/src/launch/`）

```mermaid
flowchart LR
  P[发布 publishProduct] --> S[商店页截图 + 上架]
  S --> T{世界每走一段时间<br/>LaunchEngine.tick}
  T -->|规则| E[出现在某人面前<br/>store / ad / billboard / feed / 熟人 / 自己想起]
  E -->|规则：多数没注意到| N[注意到]
  N -->|一次模型调用 decide| D{他自己说}
  D -->|划过去 / 不适合我| X[记下想法]
  D -->|以后再看| I[留下念头 intentions]
  D -->|现在点开| U[排队使用 startUsage]
  I -.有空时想起.-> E
  U --> R[一次使用：浏览器会话<br/>此时此地的处境]
  R --> A[事后：记忆整理 + 评估]
  A --> W[afterUse：商店评论 / 公开动态 / 跟熟人说 / 回不回来]
  W -.口碑沿关系网.-> I
  A --> C[launchReport：一页结论]
```

| 模块 | 做什么 |
|---|---|
| `launch.ts` | `publishProduct`（建产品、拍商店页截图、建内部容器）、`setPromotion`、`launchFunnel`（按人去重的五层人数）、`storeListing` |
| `exposure.ts` | `audienceMatch`（投给谁）、`exposureChance`（每个渠道在这段时间里遇到的概率：宣发强度 × 手机在不在手边 × 是否投放对象 × 看腻了没有）、`notices`（注意到的概率）、`whatTheySee`（他在那个渠道里实际看到的样子）、`normFor`（每个渠道的常态）、`decide`（注意到之后由他自己说） |
| `engine.ts` | `LaunchEngine.tick`：先处理之前留下的念头（熟人提过、想以后看看、用过想再用），再算新的曝光；决定与使用都有并发上限；每累计几次使用后重新合成问题 |
| `usage.ts` | `startUsage`（把这个人此时此地的处境定下来，建一次使用）、`inviteToLaunch`（把手机递给人，标记为受邀）、`afterUse`（把用完后的打算落成评论、动态、口碑和回访念头） |
| `identity.ts` | 城里发的邮箱、手机号、惯用的用户名与密码、钱包；`deliverMail` 把验证邮件与短信送到对应的人；`payFromWallet` |
| `report.ts` | `gatherMoments`（每个人的关键时刻：第一眼、卡住、离开、办成、用完后说的话、评论与动态；路过没点开的人的想法）→ `launchReport`（用「归纳」模型组写成一页，每条必须引用痕迹）；`experiencedIssues`、`engineeringAppendix` |

规则决定「遇没遇到、注没注意」，模型只在决定点出场：要不要点开、使用时的每一步、用完之后怎么说。数据：`launches`、`exposures`、`intentions`、`store_reviews`、`posts`、`mailbox`、`launch_reports`（迁移 `0007`）。每次发布内部对应一个 `studies` 行，作为使用过程、证据与花费的容器（`trigger = 'launch'`）。

规则参数：每小时遇到的次数上限（广告 2.2、广告牌 0.9、动态 0.5、逛商店 0.14、自己想起 0.2，都还要乘上宣发强度、手机在不在手边等系数）和注意到的概率（广告 0.22、广告牌 0.1、商店 0.6、动态 0.45、熟人当面说 0.95）写在 `exposure.ts` 的 `RATE_PER_HOUR` 与 `NOTICE` 里。它们是手工设定的量级，没有用真实数据校准过。

## 3. 代码结构

| 部分 | 代码位置 | 说明 |
|---|---|---|
| 发布主线 | `packages/engine/src/launch/`、`apps/world`、`apps/api`、`apps/cli` | 见 §2 |
| 人 | `packages/engine/src/human/` | 人物的六层描述（YAML + zod 校验 + 版本哈希）、手的能力（`motorProfile`）、身心状态的规则（`updateState`）、感知滤镜、识字量、记忆（每人一棵 ewave 记忆树，`packages/memory`：身份钉住、对某个产品的态度有界可变、对一类事物的看法要多次独立经历才动）、人口合成 |
| 世界 | `packages/jobsworld/`、`packages/engine/src/world/` | 城镇、日程、需求、居民与关系网、此时此地的处境（`liveContextFor`）；`WorldSimulator` 在一次使用期间运行这份处境生成的世界模板：模拟时钟、时间线、概率事件、资源（时间、电量、钱、注意力、网络）与约束 |
| 一次使用 | `packages/engine/src/runtime/` | 每一步：世界推进 → 打断与弱网 → 截图 → 感知滤镜 → 想法（只看图，说出手上的一个动作）→ 预期有没有落空 → 身心状态更新 → 落点 → Policy Gate → 按这个人的手去做 → 护栏 |
| 执行层 | `packages/executor/` | UAP 接口（`packages/core/src/types/uap.ts`）的浏览器实现：一个会话一个独立的 Chromium、看截图定位、人类化的手、六层错误分类、Policy Gate、语音与摄像头注入、录像、rrweb、无障碍扫描 |
| 证据 | `packages/executor/src/evidence.ts`；`evidence`、`evidence_links`、`repro_paths` 表 | 所有截图、录像、日志按内容哈希登记，并与步骤、问题关联；复现路径可以干净重放 |
| 事后评估 | `packages/engine/src/evaluation/` | 客观指标、问题候选（分「亲历」与「工程」两路）、评审、被测产品里 AI 回答的质量、事后访谈、干净重放、归因复核、问题合成与去重 |
| 结论 | `packages/engine/src/launch/report.ts`、`launch/text.ts` | 一页结论与工程附录；纯文本排版（命令行、MCP、飞书共用） |
| 模型 | `packages/llm/` | 见 [`MODELS.md`](MODELS.md) |
| 接口与网页 | `apps/api/`、`apps/web/` | 见 [`API.md`](API.md)、`apps/web/docs/README.md` |
| 内部校准 | `packages/engine/src/{control,exploration,product,calibration,intelligence}/` | 见 §9 |

## 4. 一次使用里的一步

```mermaid
sequenceDiagram
  participant W as WorldSimulator
  participant B as BrowserSession
  participant P as 感知滤镜
  participant M as 这个人的想法（「每一步」模型组）
  participant L as Midscene 定位（「定位」模型组）
  W->>W: 推进上一步花掉的时间：时间线、概率事件、身边的人，结算时间与电量
  W-->>B: 打断（切走、锁屏、关掉标签页）、弱网（限速）
  B->>B: 截图；元素的位置与字号、无障碍树、rrweb 只作仪器与工程证据
  B->>P: 截图 + 元素几何
  P->>M: 这一眼看到的画面（超出阅读预算、看不清、读不懂的区域是模糊的）+ 处境 + 记忆 + 感受
  M->>M: 心里的话、上一步的预期有没有落空、决定（继续 / 办成了 / 不用了 / 等一下 / 走开）
  M->>B: 手上的一个动作 + 对目标的描述（照抄写在上面的字、它的样子和位置）
  B->>L: 照抄的字在屏幕上不唯一或目标上没有字时，看截图找位置
  B->>B: Policy Gate → 按这个人的手去做（轨迹、落点、打字节奏、触屏）→ 比较动作前后的截图
```

详细步骤见 `packages/engine/docs/ARCHITECTURE.md`。

## 5. 信息隔离

| 谁 | 怎么保证 |
|---|---|
| 人物的想法 | 输入只有「这一眼看到的画面」（感知滤镜处理后的截图）、地址栏、他是谁、此刻的处境、他想做的事、自己的记忆与刚才做过的事。没有页面结构、元素列表或任何技术信号。提示词写明：不懂也不关心软件内部怎么运作，不改网址，不开开发者工具，不机械重试 |
| 落点 | 执行层只拿到人物对目标的描述。元素几何只用来把他已经从画面里认出的目标换算成坐标（照抄的字在屏幕上恰好对应唯一一个可点的东西时），其余由 Midscene 看截图定位。不会替人滚动到目标 |
| 遇到产品 | 他看到的只是那个渠道里的样子（商店卡片、广告、熟人的话），没有「测试、评估、体验官」之类的词；受邀时也只是「有人把手机递给你」 |
| Policy Gate | 在执行层硬拦截（付款、公开发布、上传人脸等），不依赖提示词 |
| 评估 | 全部在一次使用结束之后运行；评审先只看客观的时间线与截图，再看他心里的话 |

## 6. 几个关键做法

| 事项 | 做法 | 为什么 |
|---|---|---|
| 人物看什么 | 只看截图。页面里的文字（包括屏幕阅读器专用的隐藏文字、图片替代文字、悬停才出现的提示）不进入想法 | 真人看不到页面结构 |
| 定位 | 只用 Midscene 的 `aiLocate` 看截图找位置；按选择器的 `playwright` 执行器只用于干净重放 | 落点不能泄漏页面结构 |
| 动作成没成 | 比较动作前后的截图：有肉眼可见的变化或换了页面才算成功。接口报错、脚本错误是工程信号，只挂在结果上 | 人只知道屏幕上发生了什么 |
| 问题 | 分两路：虚拟人亲身遇到的（预期落空、反复尝试、放弃、卡住）进体验结论；无障碍扫描、接口与脚本错误、评审的专家式检查进工程附录。两路互不合并 | 体验结论只说人经历了什么 |
| 设备 | 同一个网页产品，在办公桌前用电脑开，在路上、沙发上、单手时用手机开（真正的移动端上下文：触屏事件、2 倍屏、390×844） | 处境决定设备 |
| 下拉框与系统弹窗 | 系统级的选项列表和 alert / confirm 在无界面浏览器里拍不到：前者在页面里画一个样子相同的列表，后者画到截图上 | 否则人物看不见它们 |
| 录像与日志 | 屏幕帧合成 mp4；自己采集网络请求日志；rrweb 录制页面变化 | 帧率与体积可控 |
| 语音与摄像头 | 语音写进假麦克风：接入了 Vertex 连接时用 Gemini 语音合成，否则用本机的 espeak。摄像头画面来自图片或画图模型 | 语音合成没有通用的兼容接口 |
| 切到后台 | 覆盖页面的可见性状态并冻结页面生命周期 | 无界面浏览器里切标签页不会改变可见性 |
| 对象存储 | `elestio/minio` 镜像 | 官方 MinIO 镜像已不在 Docker Hub 发布 |
| 模型调用记录 | Postgres 的 `llm_traces`：每一次尝试一行（角色、模型组、实际目标、配置版本、凭证脱敏标识、第几次、错误类别、用量、耗时、费用估计） | 单机部署，够用 |

其他机制：

- **感知滤镜**只作用在图上。每一眼有阅读预算；超出预算、字太小、对比度太低、认不全的区域被模糊；「瞥一眼」时屏幕下方约 45% 是余光；「凑近看」让一块区域清晰并附放大图。
- **处境**：`liveContextFor(personaId)` 依次算出世界时钟 → 当天日程的当前段 → 需求（从上次结算按日程推进到现在）→ 同一地点的家人、同事、朋友 → 设备与手眼耳嘴的占用 → 还能用多久（到下一件不能耽误的事）→ 该地点正在发生的事件 → 世界模板。
- **把手机递给谁**：随机抽一批居民看各自的处境；此刻有空的用此刻，没空的（睡觉、开车、上课）取他接下来第一个有空的时刻。
- **城里的事件**与使用时间重叠时进入该次使用：弱网（限速）、停电（断网并打断）、噪音与拥挤（分心）、下雨（户外的人去躲雨）。
- **时间**：世界服务驱动，默认 1:1；有人正在使用产品时最多 4 倍。一次使用内部的时间按这个人的阅读、思考、操作耗时推进。记忆里的「第几天」用世界的日子（自 2026-01-01 起的天数）。
- **问题去重**：同一条无障碍规则加同一个页面模板的候选先确定性合并；创建问题前与同版本、同类别的已有问题比较向量（余弦 ≥ 0.86）；收尾时再做一次全量去重。
- **模拟器的错不算在人头上**：模拟器或执行层的失败不计入预期落空，也不消耗耐心；给人物看的产品介绍会剔除带有测试、缺陷字样的句子。
- **定位权限**：默认给出人物所在城市的坐标加随机偏移；隐私敏感度高（≥ 0.75）的人拒绝授权。

## 7. 数据模型

全部表定义在 `packages/db/src/schema.ts`，迁移在 `packages/db/migrations/`。

| 组 | 表 |
|---|---|
| 发布 | `launches`、`exposures`、`intentions`、`store_reviews`、`posts`、`mailbox`、`launch_reports` |
| 人与城 | `personas`、`persona_memory_trees`、`persona_global_state`、`persona_agendas`、`persona_avatars`、`households`、`residents`、`relations`、`world_events`、`world_kv` |
| 一次使用 | `sessions`（含 `world_context`）、`steps`、`observations`、`world_states`、`events`、`goals`、`interviews`、`human_tasks` |
| 证据与问题 | `evidence`、`evidence_links`、`repro_paths`、`issue_candidates`、`issues`（两者都有 `track`：`experience` 亲历 / `engineering` 工程）、`judgments` |
| 模型 | `llm_config_versions`、`llm_secrets`、`llm_instances`、`llm_tests`、`llm_traces` |
| 产品与容器 | `apps`、`app_versions`、`studies`（每次发布对应一行，`trigger = 'launch'`） |
| 只有内部校准批次在用 | `features`、`task_defs`、`hypotheses`、`world_templates`、`exploration_coverage`、`scores`、`calibration_sets`、`calibration_results`、`reports` |
| 不再写入 | `persona_memories`（首次访问某人时迁入记忆树）、`executor_comparisons`、`app_verdicts` |

## 8. 城

见 [`JOBSWORLD.md`](JOBSWORLD.md)。与本文相关的要点：处境由 `packages/jobsworld` 的纯规则计算，世界服务和引擎用同一套函数；引擎从 Postgres 读时钟、日程、需求和事件。同一份城镇布局同时供网页、TShock 插件和 tModLoader 模组渲染。

## 9. 内部校准批次

发布之前的做法——指派一批人带着任务去用一个产品——还留在代码里，只作为内部工具（`pnpm jobs dev …`），用来在植入了已知缺陷的示例产品上量检出率与误报率：

- `control/study.ts`：批次的创建、分轮规划、进程内运行（`runStudyInline`）、收尾（`finalizeStudy`）。发布主线复用其中的「运行一次使用」（`runSessionInline`）与「事后评估」（`evaluateSessionPost`）。
- `exploration/`：把任务改写成生活里的目标、覆盖率、按覆盖缺口采样「谁 × 目标 × 模式」。
- `product/intelligence.ts`：爬取产品并归纳功能、任务、假设。
- `calibration/`、`intelligence/report.ts`：已知缺陷、真人基准、埋点漏斗、评论的校准；批次的 Markdown 与离线 HTML 报告（写到 `data/reports/`，由接口服务在 `/reports/` 下提供）。

用法见 [`CALIBRATION.md`](CALIBRATION.md)。产品决策是校准「先不管」：这些工具在重塑之后没有重新跑过，对外的人数一律标注为模拟。
