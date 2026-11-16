# @pux/llm

应用内的模型路由：多供应商、多凭证、多模型的运行时配置与失败接替。设计、数据概念、错误决策表与验证记录见 [`docs/MODELS.md`](../../../docs/MODELS.md)。

| 文件 | 说明 |
|---|---|
| `src/config.ts` | 纯规则（不碰数据库与网络）：配置的数据结构、`normalizeConfig`、角色 → 模型组（`useOfRole`）、候选与跳过原因（`candidates`）、错误归类（`classifyError`）与处理方向（`reaction`）、定位家族（`locateFamily`）、发布前差异（`diffConfig`） |
| `src/store.ts` | 配置版本的读取与保存：`snapshot()`（每 5 秒核对版本号）、`publish()`（同一事务内的冲突保护、凭证写入与撤销）、`rollback()`、`instances()`、进程内的健康状态 `health` |
| `src/secrets.ts` | 凭证的 AES-256-GCM 加密（密文绑定所属连接；主密钥来自 `JOBS_SECRET_KEY`） |
| `src/catalog.ts` | models.dev 目录的拉取、收敛与缓存；随包快照 `config/models/catalog.json`（`npx tsx scripts/update-model-catalog.ts` 更新） |
| `src/adapters.ts` | 上游协议：OpenAI 兼容、Anthropic Messages、Vertex（Google 凭证 JSON，或引用——`{ gcloud: "auto" }` 这台机器的 gcloud 登录、`{ file }` 凭证文件，每次换令牌前现读——换访问令牌）；对话、向量、画图；出站地址检查 |
| `src/gcloud.ts` | 「这台机器的 gcloud 登录」：找 gcloud 配置目录（`gcloudDirs`），读当前账号、默认项目与 `credentials.db` 里的凭证（`readGcloud`，按修改时间缓存），给界面的探测（`probeGcloud`） |
| `src/endpoint.ts` | OpenAI 兼容入口（给 Midscene 与示例产品）：`proxyChat`、`handleProxy`、`startLocalEndpoint` |
| `src/index.ts` | `gateway()`：`chat`（固定快照 → 候选 → 尝试 → 记录）、`embed`、`generateImage`、`ping`；`testTarget`；`modelsReady`；`vertexAccess`；`checkVendorIsolation` |

调用方式不变：`gateway().chat('mind_fast', { messages, schema })`。结果里的 `model` 是实际调用的上游模型，`version` 是这次请求采用的配置版本。
