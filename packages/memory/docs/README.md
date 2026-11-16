# @pux/memory（人物记忆：ewave 适配层）

每个人一棵记忆树，数据结构用已发布的 [`@plutokeating/ewave`](https://www.npmjs.com/package/@plutokeating/ewave)（原样作为依赖，不修改它）。包里没有的能力都做在这一层：

| 能力 | 做法 |
|---|---|
| 持久化 | 表 `persona_memory_trees`：`snapshot`（ewave 的 `toJSON()`）、`leaves`、`version` |
| 单写者 | 同一进程内对同一个人串行（`withTree`）；跨进程用 `version` 乐观锁，冲突时重读重做 |
| 规模 | 向量截断到 256 维并保留 4 位小数（`compact`）；每人最多 240 条记忆（`MAX_LEAVES`），超出时忘掉最不重要、最久远的 |
| 旧数据 | 首次访问某个人时建树，并把旧表 `persona_memories` 的记忆（沿用原向量）迁入；之后旧表不再读写 |

## 树的形状

根下面按 `meta.key` 分支：

| 分支 | 内容 |
|---|---|
| `core` | 身份里钉住不动的部分（价值观、看法、底线、动机）。写入后加 `read_only` 锁，一次经历改不动它 |
| `self` | 对一类事物的一般看法（例如对 AI 产品整体的感受） |
| `life` | 生活经历（世界里发生的事、两次使用之间的事） |
| `people` | 听别人说的（口碑） |
| `app:<appId>` | 对某个产品的经历与态度 |

叶子是一条记忆：`text` 是内容，`meta` 是 `{ kind, valence, importance, app_id, session_id, sim_day, sim_time, created_at }`，时间切片 `sliceId = day-<sim_day>`。

写入时与同一分支里语义相近（余弦 ≥ 0.55）的旧记忆连逻辑边：看法一致是 `+1 supports`，相反是 `-1 contradicts`。不使用 `observe()` 的自动聚类。

## 检索（`MemoryTree.recall`）

相关性 × 时效性 × 重要性加权（Generative Agents 式），只在 `core / self / life / people` 和当前产品的分支里找；几乎一样的记忆只想起一条；排在前面的记忆如果有 `-1` 边连着的相反经历，一并带出（`conflicts_with`）。

## 对外

`withTree(personaId, fn)`、`loadTree`、`listMemories`、`memoryCounts`、`MemoryTree`（`add / seedCore / recall / list / stats / enforceCap / forgetApp`）、`BRANCH`、`compact`。

态度更新规则（对某个产品的态度有界可变；全局信念要多次独立经历才动）在 `@pux/engine` 的 `human/memory.ts`（`updateAttitudes`）。

## 忘掉一个产品（`MemoryTree.forgetApp`）

产品被清零、或下线并删除经历时，每个人的树上：`app:<appId>` 分支整枝删掉；其他分支里 `meta.app_id` 是它（例如 `people` 里听来的口碑）或 `meta.session_id` 属于它那几次使用（例如那次使用后写进 `self` 的对 AI 的一般感受）的记忆逐条删掉。`core` 分支不动。没有可删的时候不标脏，不写库。

## 向量从哪来

记忆的向量由 `@pux/llm` 的 `gateway().embed()` 给出：接入了向量模型时用它，没接入时用本地的字符哈希向量。两种向量不在同一个空间里，所以中途接入或更换向量模型后，旧记忆被想起来的概率会下降（旧向量不会重算）。
