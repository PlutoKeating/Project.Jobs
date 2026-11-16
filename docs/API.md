# API 与接口约定

## 1. REST API（`apps/api`，默认 `http://127.0.0.1:5320`，对外经网关 `:7777`）

下面的路径都省略了前缀 `/api/v1`。带「管理员」标记的接口在设置了 `JW_ADMIN_PASSCODE` 时需要管理员身份（否则 403）；没设置管理员口令时，能进来的人都是管理员。设置 `JW_PASSCODE`（访客口令）后，除 `/me`、`/auth/*`、`/inbox/*` 外都需要登录（否则 401）；`/inbound/*` 不在 `/api/v1` 下，不需要登录（靠签名）。身份有三种带法：网页登录后的 HttpOnly Cookie；命令行、本机 MCP、示例产品与脚本用 `Authorization: Bearer <口令>`；远程 MCP 授权发出的访问令牌（`Bearer jwa_…`，身份是授权时输入的那个口令对应的身份，见 §2）。装好的 Jobs 两个口令都在安装时随机生成。

不在 `/api/v1` 下的：`GET /healthz`（`{ ok, version, nats }`，免登录）；`/reports/…`（内部校准批次的离线报告，需登录）；远程 MCP 与它的 OAuth 路径（`/mcp`、`/authorize`、`/token`、`/register`、`/revoke`、`/oauth/login`、`/.well-known/oauth-*`，见 §2）；其余 GET 返回网页。

### 身份

| 方法 路径 | 说明 |
|---|---|
| `GET /me` | `{ viewer, admin, auth_required, version, game_port, models_ready }`（`version` 只给登录了的人）。`models_ready`：每一步、归纳、定位三个模型组此刻是否各有可用的模型 |
| `POST /auth/login` `{ passcode }` | 访客口令或管理员口令；写入 HttpOnly Cookie（30 天） |
| `POST /auth/logout` | 清除登录 |

### 发布

| 方法 路径 | 说明 |
|---|---|
| `GET /launches` | 已发布的产品：`id`、`name`、`tagline`、`description`、`url`、`landing_url`、`form`、`shots`（商店页截图的证据 id）、`ad_text`、`intensity`、`audience`、`status`（`live` / `paused` / `ended`）、`funnel`、`spend`（`usd`、`tokens`） |
| `POST /launches`（管理员） | 发布。必填 `name`、`tagline`、`url`；可选 `landing_url`、`description`、`ad_text`、`intensity`（0–1，默认 0.3）、`audience`、`form`（`web` 电脑和手机都能开 / `h5` 只在手机上开）。返回同上的一行 |
| `GET /launches/:id` | 上面的一行，加上 `uses`（每次使用：谁、在哪、什么时候、什么设备、怎么遇到的、是否受邀、第几次、结局、离开时的原话）、`passersby`（注意到了没点开的人和当时的想法）、`reviews`（商店评论）、`posts`（公开动态）。`:id` 也可以写产品名 |
| `GET /launches/:id/report?lang=zh\|en[&force=1]` | 一页结论：`verdict`（`works` / `mixed` / `not_yet` / `too_early`）、`headline`、`summary`、`hurts`、`delights`、`who_stays`、`who_leaves`、`why_not_opened`、`next`、`funnel`、`people_used`。每一条是 `{ text, moments[], passersby[] }`：`moments` 带当事人、原话、`session_id`、`step_idx`、`screenshot_ev`。有人用完、有了新评论或路过的人明显变多时重新归纳，否则读缓存（人数始终是最新的）。重新归纳要几分钟：有上一版时先返回上一版并带 `refreshing: true`，新的在后台写（同一产品同一语言只写一份；失败后 10 分钟内不自动重试，照常给上一版）；从没写过或 `force=1` 时等它写完 |
| `GET /launches/:id/versions` | 版本点：`[{ n, note, at }]`，发布那一刻是第 1 版 |
| `POST /launches/:id/versions`（管理员） | 标记新版本（「我改好了，线上已经是新版本」）：`{ note? }`，返回 `{ n, note, at }`。之后开始的使用算新版本；产品地址不变时不用重新发布 |
| `GET /launches/:id/engineering` | `version`：最新的版本点和它之后开始的使用次数 `{ n, note, at, sessions, finished }`（还没标过新版本时为 `null`）；`experienced`：虚拟人亲身遇到的问题（严重度、受影响人数、是否已复现、复现步骤；标过新版本时还有 `sessions_since_version`：这个问题在最新版本之后开始的使用里出现了几次。问题清单每累计几次使用重新归并一次，最新的使用可能还没算进去）；`appendix`：工程附录（无障碍扫描、接口与脚本错误、专家检查等用户看不到的技术信号，带修改建议）；`mail`：验证邮件的仪器读数（没有邮件时为 `null`）`{ mails, sessions, opened, median_delay_s, max_delay_s, switches, forgot, mistyped }`：收到几封、点开几封、从居民填好邮箱到信到达的中位与最慢秒数、在产品和邮箱之间切了几次、几次切回来记不清验证码、几次输入的码与邮件里的不一致 |
| `POST /launches/:id/promotion`（管理员） | 调宣发：`intensity`、`audience`、`status`、`ad_text`、`tagline`，只改传了的字段 |
| `POST /launches/:id/reset`（管理员） | 清零：城里关于这个产品（同名产品发布过的每一版）的一切经历归零——使用过程、曝光、念头、评论、动态、一页结论、版本点、问题、使用期间收到的信，以及居民记忆里关于它的部分与对它的信任；产品本身（地址、介绍、商店截图、宣发设置）不动，状态回到 `live`，发布时刻与花费归零，等于此刻重新发布。正在进行的使用被作废。返回同 `GET /launches` 的一行，另有 `cleared`：`{ sessions, exposures, reviews, posts, memories, people }`（删掉的条数；`people` 是忘掉它的居民数）。模型调用记录不删 |
| `DELETE /launches/:id[?history=delete]`（管理员） | 下线：从城里拿掉这个产品（发布过的每一版），商店、广告、念头里都不再有它，`GET /launches` 里也没有了；正在进行的使用被作废。默认保留经历（用过的人的使用、评论、动态与记忆都留着，人物页还能看到，同名产品再次发布时居民认得它）；`history=delete` 时连同上面清零会删的全部经历和产品记录一起删掉。返回 `{ removed: true, kept, sessions, exposures, reviews, posts, memories, people }` |
| `POST /launches/:id/invite`（管理员） | 把手机递给人：`n`（1–20，默认 3）、`segment`、`locale`、`persona_ids`、`want`（希望他们做的一件事）。返回 `{ invited, session_ids }` |
| `GET /store` | 城里的人看到的应用商店：每个上架产品的介绍、截图、评分与评论 |
| `GET /feed[?launch_id=]` | 城里的公开动态 |

`funnel`：`reached`（看到）、`noticed`（注意到）、`interested`（有兴趣）、`opened`（打开过）、`came_back`（回来再用）、`using_now`（此刻在用）、`sessions`、`reviews`、`rating`、`by_channel`。按人去重，是这座城里实际发生的人数（模拟）。

`audience`（投给谁，空 = 所有人）：`locales`（`zh-CN` / `en-US`）、`age_min`、`age_max`、`segments`、`tags`。不在投放范围内的人也可能看到，只是少得多。

### 居民邮箱与设置

每位居民有城里发的邮箱和手机号。邮箱的用户名像真人自己起的（`chenbq168`、`emilyjohnson`，只有小写字母和数字）；域名在没开通真实邮箱时是 `jobsworld.test`，在「设置」里开通后是公网链接的主机名（Cloudflare 不接受时是 `mail.<主机名>`），真实产品发的验证邮件会进到对应居民的收件箱。

收信的路：产品的邮件服务器 → 那个主机名的 MX（Cloudflare Email Routing，每个居民一条收信规则，按需建）→ Cloudflare 上的转发 Worker（`jobsworld-mail`，只转发不存）→ `POST /inbound/email`（这台 Jobs，验签、解析、存证据、放进收件箱）。

| 方法 路径 | 说明 |
|---|---|
| `POST /inbound/email`（不带 `/api/v1` 前缀，免登录） | 转发 Worker 调用。正文是原始邮件（`message/rfc822`，≤ 10 MB）；请求头 `x-jobs-timestamp`、`x-jobs-to`（信封收件人）、`x-jobs-from`、`x-jobs-signature` = HMAC-SHA256(签名密钥, `${timestamp}.${to}.` + 原始邮件) 的十六进制。时间戳与现在相差超过 10 分钟、签名不对 → 401（Worker 退信）；还没开通 → 503（Worker 抛错，对方稍后重投）。同一封信（Message-ID 相同）重复投递只收一次 |
| `GET /inbound/ping`（不带前缀，免登录） | `{ jobs: true }`。开通时从这台机器访问公网链接上的它，确认链接能回到自己 |
| `GET /settings[?live=1]`（管理员） | `public_url`（网页上填的）、`public_url_env`（`JOBS_PUBLIC_URL`）、`public_url_effective`（实际用的：网页上填的 > 环境变量 > 本机地址）、`mail`：`status`（`off` / `deploying` / `ready` / `error`）、`domain`、`real`（居民能不能收真实邮件）、`token_hint`、`zone`、`note`、`error`、`routes`（`used` / `cap`）、`unowned`（没有对应居民的信）、`check`（测试信）、`permissions`（令牌需要的权限）、`warming`（开通后 10 分钟内：Cloudflare 还在生效，这期间的信可能被退回）；`live=1` 时顺便问 Cloudflare 现在的收信状态（`cloudflare`） |
| `PUT /settings` `{ public_url }`（管理员） | 保存公网链接（补全 https、去掉结尾斜杠；空串 = 清除，回到环境变量）。几秒内接口与世界服务都按新地址；远程 MCP 在下一个请求时按新地址重建授权元数据 |
| `POST /settings/mail` `{ token? }`（管理员） | 一键开通（或重新部署）居民邮箱：确认公网链接从外网能回到这台 Jobs → 验证令牌 → 找到主机名所在的区 → 上传转发 Worker → 在主机名上开启 Email Routing（Cloudflare 自动加 MX、SPF、DKIM）→ 居民地址换成这个域名 → 后台把居民的收信规则预先建到上限（Cloudflare 上新建的规则要一两分钟才生效）。`token` 不给时用上次保存的。令牌需要：Zone › Zone › Read、Zone › Zone Settings › Edit、Zone › Email Routing Rules › Edit、Account › Workers Scripts › Edit。令牌与签名密钥加密存库 |
| `DELETE /settings/mail`（管理员） | 关闭：删掉自己建的收信规则与 Worker，居民地址回到 `jobsworld.test`（Cloudflare 上的 MX 记录留着） |
| `POST /settings/mail/check` / `DELETE /settings/mail/check`（管理员） | 测试信：建一个 `check…@<域名>` 的临时地址，维护者从自己的邮箱给它发一封，`GET /settings` 的 `check.received_at` 有值就说明整条路通了 / 结束并删掉临时地址 |
| `GET /settings/mail/unowned`（管理员） | 发到没有对应居民的地址的信（最近 50 封） |
| `GET /mail/status` | `{ real, domain }`：发布对话框据此提醒「居民还收不到真实邮件」 |
| `GET /personas/:id/inbox` | 这个人收到的邮件与短信（最近 50 封）：`sender`、`subject`、`body`（纯文本）、`has_html`、`opened_at`（他在邮箱里点开的时间）、`session_id`（到达时他正在进行的那次使用）、`real`（真实邮件）、`codes`（仪器提取的验证码） |
| `GET /sessions/:id/mail` | 一次使用期间到达的信 |
| `GET /mail/:id` | 一封信的全文：另有 `html`、`links`（仪器提取的链接）、`raw_ev`（原始邮件的证据 id，`GET /evidence/:id` 下载 `.eml`） |
| `POST /inbox/email` `{ to, from?, subject?, body }`（免登录） | 不经 Cloudflare、直接投递一封邮件（给自己搭的测试环境用） |
| `POST /inbox/sms` `{ to, from?, body }`（免登录） | 投递一条短信 |

居民在使用过程里怎么收信：新邮件像手机推送一样只告诉他发件人和标题；要看正文得自己切到邮箱（人物动作 `check_mail` / `back_to_app`）。验证码和链接由仪器提取，只用于工程附录，从不交给居民。

### 人物

| 方法 路径 | 说明 |
|---|---|
| `GET /personas` | 每个人物的最新版本 + 使用统计（次数、用过的产品、记忆数）+ 此刻位置、需求、手机在不在手边、所在家庭 |
| `GET /personas/:id` | 画像、今天的日程、记忆（最近 120 条，来自他的记忆树）、使用历史（`sessions`；`launch_of` 把 `app_id` 对到发布 id）、信任状态、实时状态与世界时钟；`resident`（家庭、工作地点、收入、钱包、近况）、`ties`（关系网）、`here`（此时此地的处境） |
| `GET /personas/:id/avatar` | 头像：接入了画图模型时生成并缓存到 MinIO；还没有生成的（或没接入画图模型时）返回确定性的像素头像 SVG |
| `POST /personas/generate`（管理员） `{ n, locale }` | 生成新居民并住进城里（1–12 人） |

### 世界

| 方法 路径 | 说明 |
|---|---|
| `GET /overview` | `personas`（居民数）、`sessions`（使用次数）、`issues`、`live`（此刻进行中的使用）、`launches`（已发布产品数）、`spend_usd`（模型调用累计花费的估算；目录里没有价格的模型按 0 计）、`human_pending`（待人介入的任务数）、`snapshot`（最近一次快照） |
| `GET /world/town` | 城镇布局（图元、地点、落脚点） |
| `GET /world/snapshot` | 最近一次世界快照（时钟、人物位置与状态、世界事件） |
| `POST /world/clock`（管理员） `{ paused?, speed?, jump_to? }` | 控制世界时钟 |
| `POST /world/events`（管理员） `{ place_id, kind, minutes }` | 制造事件：`weak_network` `crowd` `rain` `power_cut` `noise`；正在该地点使用产品的人会真的受到影响 |
| `POST /world/replay` `{ session_id, speed? }` | 在原地点回放一次使用 |
| `POST /world/ask` `{ persona_id, question }` | 向人物追问（基于他最近一次已结束的使用；正在使用时返回 `busy`） |
| `GET /stream`（WebSocket） | 实时推送 `{ type, data }`：`snapshot`（世界快照）、`live`（某人使用中的一步）、`say`（气泡）、`launches`（各产品的漏斗人数） |

### 使用过程、证据、人工接管

| 方法 路径 | 说明 |
|---|---|
| `GET /sessions/:id` | 一次使用：人物、所属发布（`launch`）、逐步时间线（截图证据、想法、动作、地点、资源）、世界事件、事后访谈 |
| `POST /sessions/:id/ask` `{ q }` | 追问这次使用 → `{ answer }` |
| `POST /issues/:id/triage`（管理员） `{ status }` | `confirmed` / `rejected` / `open` |
| `GET /human`、`POST /human/:id/resolve`（管理员） | 需要人介入的任务（例如验证码） |
| `GET /evidence/:id` | 证据原文件（MinIO）或内联 JSON。设置了 `JW_PASSCODE` 时，游戏内面板用 `?k=<sha256("jw-evidence:"+JW_PASSCODE) 前 32 位十六进制>` 访问（只对本接口有效） |

### 游戏服、示例产品、飞书

| 方法 路径 | 说明 |
|---|---|
| `GET /game` | 两个 Terraria 游戏服的状态：`tshock` / `tml` 各有 `up`、`pending`；`can_toggle`（宿主机上有监视单元，网页可以一键开关）、`port`、`password`（是否设了进服密码） |
| `POST /game`（管理员） `{ kind: "tshock" \| "tml", on }` | 开关游戏服。能一键开关时返回 `{ requested: true }`：服务只往 `control/requests/` 放一个只含动作名的文件，真正执行的是宿主机上的 `jobsworld _control`。不能时返回 409 `{ error: "manual", command }`，`command` 是要在宿主机上运行的命令 |
| `GET /demos` | 随包的示例产品（在跑的时候）：`id`、`name`、`tagline`、`url`（干净版）、`flawed_url`（带着真实小毛病的版本） |
| `GET /feishu`（管理员） | 飞书机器人的状态：`connected`、`app_id`、`brand`、`pending`（等待扫码时的 `url`、`qr_svg`、`expires_at`）、`error` |
| `POST /feishu/connect`（管理员） | 开始扫码接入（飞书的一键创建应用）；返回带二维码的状态。扫码确认后在后台完成接入，并给扫码的人发一条消息 |
| `POST /feishu/test`、`POST /feishu/disconnect`（管理员） | 发一条测试消息；断开并删除保存的应用凭证 |

### 版本与升级

| 方法 路径 | 说明 |
|---|---|
| `GET /version` | `version`（当前版本，来自根 `package.json`）、`check`（是否在检查新版本，`JOBS_UPDATE_CHECK=0` 关闭）、`latest`（GitHub 上最新的正式 Release：`version`、`url`、`published_at`；还没有时为空）、`checked_at`、`error`、`update_available`。管理员另有：`can_update`（能一键升级：在容器里运行，且宿主机上的监视单元与 `jobsworld` 命令认得 `update`）、`command`（不能一键升级时要运行的命令）、`update`（`requested`；`host`：宿主机写回的 `{ state: running \| ok \| failed, at }`；`log`：失败时输出的最后 20 行） |
| `POST /version/check`（管理员） | 立刻检查一次新版本（平时后台每小时一次；管理员打开网页时结果超过 15 分钟也会当场重查） |
| `POST /update`（管理员） | 一键升级。能一键升级时返回 `{ requested: true }`：服务只往 `control/requests/` 放一个名为 `update` 的请求，由宿主机上的 `jobsworld _control` 执行 `jobsworld update`（先比较版本，确实有新版本才拉取 → 备份数据库 → 重建）；正在升级时返回 `{ requested: true, already: true }`。不能时返回 409 `{ error: "manual", command }` |

### 单端口网关（`apps/gateway`，`JW_PORT`，默认 `0.0.0.0:7777`）

按首包分流：HTTP/WebSocket → API；Terraria `ConnectRequest` 版本串以 `Terraria` 开头 → TShock（`TSHOCK_PORT`，默认 57777）；以 `tModLoader` 开头 → tML 服务端（`TML_PORT`，默认 57778）。不终止 TLS。

### NATS（JobsWorld 事件总线）

主题与消息格式见 `packages/jobsworld/src/protocol.ts` 与 [`JOBSWORLD.md`](JOBSWORLD.md) §3。

## 2. 命令行与 MCP

装好之后的命令是 `jobsworld`（仓库内为 `pnpm jobs`）。日常命令通过上面的 REST 接口工作：`publish`、`ls`、`status`、`report`、`promote`、`invite`、`people`、`ask`、`clock`。环境变量：`JOBS_API`（服务地址，默认 `http://127.0.0.1:7777`）、`JOBS_KEY`（管理员口令）。`doctor`、`init`、`db`、`world`、`persona`、`dev` 直接访问数据库，只在服务所在的机器上用。详见 [`QUICK_START.md`](QUICK_START.md)。

### MCP 工具

工具只定义一次（`packages/engine/src/launch/tools.ts`），远程与本机两种接法注册的是同一份，都只经 REST 接口工作，权限检查只在接口那一层。

| 工具 | 身份 | 做什么 |
|---|---|---|
| `publish_product` | 管理员 | 发布：`name`、`tagline`、`url`（Jobs 服务能打开的真实地址），可选 `landing_url`、`description`、`ad_text`、`intensity`、`form` |
| `list_products` | 访客 | 已发布的产品和漏斗人数 |
| `product_status` | 访客 | 一个产品此刻的状况：漏斗、谁在用（带 `persona_id`）、路过的人怎么想 |
| `product_report` | 访客 | 一页结论 + 亲历的问题（复现步骤；标过新版本时注明新版本里还在不在）+ 工程附录（含验证邮件的仪器读数）。`refresh: true` 强制重新归纳（等它写完，可能几分钟） |
| `invite_people` | 管理员 | 把手机递给 `n` 个人（可选 `segment`、`locale`、`want`），返回 `session_ids` |
| `wait_for_people` | 访客 | 等受邀的使用结束（默认这个产品所有没用完的受邀使用，或指定 `session_ids`），每 10 秒查一次，最多 `max_minutes`（默认 5，最多 15）分钟；客户端带了 `progressToken` 时推送进度 |
| `mark_new_version` | 管理员 | 标记新版本（`note`），见 `POST /launches/:id/versions` |
| `set_promotion` | 管理员 | 宣发强度、暂停 / 恢复 / 结束、广告文案 |
| `ask_person` | 访客 | 向用过产品的居民追问（`persona_id`、`question`） |
| `person_inbox` | 访客 | 一位居民收到的邮件和短信（`persona_id`）：验证邮件有没有到、什么时候到、他点没点开；居民邮箱还没开通时会说明 |

访客身份连接时，管理员工具不出现在工具列表里。

### 远程 MCP（Streamable HTTP + OAuth 2.1）

coding agent 只要一个链接：`<公网链接>/mcp`（公网链接在网页的「设置」里填，其次是 `JOBS_PUBLIC_URL`）。

```bash
claude mcp add --transport http jobs https://jobs.example.com/mcp     # Claude Code
codex mcp add jobs --url https://jobs.example.com/mcp                   # Codex（然后 codex mcp login jobs）
# Cursor 等：{"mcpServers":{"jobs":{"url":"https://jobs.example.com/mcp"}}}
```

第一次连接时 agent 打开浏览器，到 Jobs 的授权页输入口令：管理员口令 → 全部工具，访客口令 → 只读工具。之后 agent 自己刷新令牌，不再弹出。

- **传输**：Streamable HTTP，无状态（每个 `POST /mcp` 一个 `McpServer`，没有会话）；`GET`/`DELETE /mcp` 返回 405。实现用 MCP SDK（`@modelcontextprotocol/sdk` 的 `StreamableHTTPServerTransport`），见 `apps/api/src/mcp.ts`。
- **授权**：只接受 OAuth 访问令牌，不接受把口令直接放进请求头。不带令牌时返回 `401`，`WWW-Authenticate` 里有 `resource_metadata`，客户端据此自动发现授权服务。协议部分（元数据、动态注册、PKCE S256、令牌接口、限流）用 SDK 的 `mcpAuthRouter`，Jobs 只实现 provider（`apps/api/src/oauth.ts`）。

| 路径 | 说明 |
|---|---|
| `GET /.well-known/oauth-protected-resource/mcp` | RFC 9728 资源元数据：`resource` = `<公网链接>/mcp`，授权服务 = `<公网链接>` |
| `GET /.well-known/oauth-authorization-server` | RFC 8414 授权服务元数据 |
| `POST /register` | RFC 7591 动态注册（公开客户端，`token_endpoint_auth_method: none`） |
| `GET /authorize` | 授权页（输入口令；没有设置任何口令时只有「授权 / 拒绝」） |
| `POST /oauth/login` | 授权页提交：口令对了发授权码（10 分钟、只能用一次）并跳回 agent；同一来源 10 分钟内最多输错 10 次 |
| `POST /token` | `authorization_code`（校验 PKCE）与 `refresh_token` |
| `POST /revoke` | 撤销令牌（整次授权一起撤销） |

- **令牌**：访问令牌 1 小时，刷新令牌 30 天，每次刷新都换一对新的；用过的刷新令牌再次出现时，整次授权作废（可能被人拿走了）。数据库只存哈希（`oauth_tokens`）。任何一个口令换了，之前发出的令牌全部失效。访问令牌也能直接调 REST（身份同上）。
- **对外地址**：网页「设置」里填的公网链接，没填时用 `JOBS_PUBLIC_URL`（https；放在反向代理后面，见 [`INSTALL.md`](INSTALL.md)「对外访问」）。网页上改了之后，下一个请求就按新地址重建授权元数据（之前授权的 agent 需要重新授权）。都不设置时是 `http://127.0.0.1:<JW_PORT>`，只有同一台机器上的 agent 能用；设置成非本机的 http 地址时远程 MCP 不启用（这些路径返回 503），因为 OAuth 要求 https。
- **产品地址**：Jobs 在云端时，城里的人是在那台机器上打开你的产品的，`localhost`、内网地址都打不开。JobsWorld 用来体验真实产品：先部署到公网（预览环境也可以）再发布。

| 管理接口（管理员） | 说明 |
|---|---|
| `GET /agents` | `{ mcp_url, enabled, public_url_set, grants }`：远程 MCP 的链接、是否启用、是否设置了公网链接（网页上或 `JOBS_PUBLIC_URL`），以及已授权的 agent（每次授权一行：`id`、`client`、`role`、`authorized_at`、`last_used_at`） |
| `DELETE /agents/:id` | 撤销一次授权（它的访问令牌与刷新令牌立即失效） |

### 本机 MCP（stdio）

和 Jobs 在同一台机器上（或能直接访问它的 REST 接口）时，也可以用 `jobsworld mcp`（stdio）：`claude mcp add jobs -- jobsworld mcp`。它用 `JOBS_API`、`JOBS_KEY` 调接口；装好的 `jobsworld` 在容器里执行，不用另外设置。

## 3. UAP v0.2（执行层接口）

UAP 是「人物的手」与被测产品之间的统一接口。定义：`packages/core/src/types/uap.ts`（出自早期设计稿 [`history/SPEC_v0.2.md`](history/SPEC_v0.2.md) §10，后来加了 `visual` 定位方式（`TargetRef.text` + `value`）、`risk_tags`、`injected`、`effects.visible_change`，以及 `PRODUCT_SMALL_TARGET`、`SIM_MOTOR_MISS` 错误码）。人物可用的动词不含 `navigate`（真人不会凭空改网址）。

```ts
interface Executor {
  observe(session_id: string): Promise<Observation>;
  act(req: ActionRequest): Promise<ActionResult>;
}
```

实现：`packages/executor/src/session.ts`（`BrowserSession`）。执行器名：`midscene`（人物使用：目标是 `{ by: 'visual', text, value }`，看截图定位）、`playwright`（只用于干净重放，按选择器，不调用模型）。动作结果的 `status` 按屏幕上有没有肉眼可见的变化判定（`effects.visible_change`）。

错误分层与默认归因：`product` → 产品问题候选；`environment` / `simulator` → 不计入产品问题；`executor` → 不计入产品问题（人物眼里是「在屏幕上没找到想点的东西」）；`policy` → 记录并检查产品保护机制；`injected` → 只评估产品如何应对。

## 4. 模型

### 模型组与角色

代码里的调用点用角色名调用网关（`gateway().chat(role, …)`），角色归到模型组；每个组实际用哪家的哪个模型，由已保存的模型配置决定（见 [`MODELS.md`](MODELS.md)）。

| 模型组 | 角色 | 用途 |
|---|---|---|
| `step` 每一步（必须能看图） | `mind_fast`、`world_sim`、`judge_2` | 人物使用时的每一步；注意到产品后要不要点开；补充世界事件 |
| `think` 归纳与判断 | `mind_slow`、`judge_0`、`judge_1`、`judge_meta`、`interview`、`gen_persona`、`product_induce` | 记忆整理、用完之后怎么评价与跟谁说、一页结论、问题合成、访谈与追问、生成居民的叙事 |
| `locate` 在截图上定位 | `operator_locate`（Midscene 经本地兼容入口） | 把人物说的目标换成屏幕坐标 |
| `embed` 向量（可选） | `embed` | 记忆检索与问题去重；没接入时用本地哈希向量 |
| `image` 画图（可选） | `image_gen` | 头像与相机素材；没接入时用像素头像 |

### 管理接口（全部需要管理员）

| 方法 路径 | 说明 |
|---|---|
| `GET /models` | 当前状态：`version`、`config`（连接、凭证的脱敏提示、已选模型、全局顺序；不含任何凭证正文）、`instances`（各在线实例用的是第几版、各自暂时跳过了谁）、`tests`（每个目标每项能力最近一次测试）、`catalog`（目录来源、更新时间、供应商清单）、`ready` / `missing`（每一步、归纳、定位是否各有可用目标）、`poll_ms` |
| `GET /models/gcloud` | 「使用这台机器的 gcloud 登录」按钮用：`found`、`dir`、`account`、`project`、`error`（没登录、没有默认项目、目录没挂进来）、`tried`（找过的目录）、`in_container`、`host_dir`（挂进来的宿主机目录）、`mounted`（从源码运行时恒为真）、`can_connect`（还没挂、宿主机能一键补上）。不返回任何凭证内容 |
| `POST /models/gcloud/connect` | 请宿主机把 gcloud 配置目录挂进容器：往 `control/requests/` 放一个 `gcloud` 请求，宿主机上的 `jobsworld _control` 写好 `JOBS_GCLOUD_DIR` 并重建 `jobs` 容器（服务会重启）。已经挂好时返回 `{ requested: false, mounted: true }`；宿主机做不到时返回 409 `{ error: "manual", command: "jobsworld up" }` |
| `GET /models/catalog/:id` | 目录里一家供应商的模型：标识、名字、类型、能力、价格、能否用于定位 |
| `POST /models/catalog/refresh` | 重新拉取目录；失败返回 502，旧目录与已保存的配置不受影响 |
| `POST /models/publish` `{ base_version, submit_id?, config, new_secrets?, note? }` | 保存一份完整配置。`base_version` 是编辑起点的版本，线上已经变了返回 409 `{ error: "conflict", version, config }`；`submit_id` 相同的重复提交返回同一结果（`replay: true`）；`new_secrets` 是 `凭证 id → 明文`，只在这一次请求里出现；校验不过返回 422 |
| `GET /models/versions` | 最近 30 个版本 |
| `POST /models/rollback` `{ version }` | 把旧版本的内容作为新版本保存；返回里的 `dropped_credentials` 是因已撤销而被去掉的凭证数 |
| `POST /models/test` `{ target_id, credential_id?, capability? }` | 对已保存的配置测一个目标：`text` / `vision` / `json` / `embed` / `image`。返回 `ok`、`latency_ms`、`error_class`、`detail`、`version`、`cred` |
| `POST /models/preview` `{ config?, use?, vision? }` | 路由预览（不发真实请求）：每个模型组按顺序会试哪些目标、哪些被跳过及原因。传 `config` 时预览草稿，并返回与线上配置的 `diff` |

`GET /me` 的 `models_ready` 表示发布主线此刻是否跑得起来。

### OpenAI 兼容入口

`POST /llm/<step|think|locate>[/<定位家族>]/v1/chat/completions`（仅管理员，因为它花的是真钱；带 `Authorization: Bearer <管理员口令>`）：请求体按 OpenAI 的 chat/completions 格式，`model` 字段会被换成实际目标的上游模型名，支持流式。示例产品里的 AI 功能用它。

## 5. 数据文件格式

- 手写人物：`config/personas/{hero,child}/*.yaml`（`PersonaSpecSchema`，共 14 位）
- 场景模板：`config/worlds/*.yaml`（`WorldTemplateSchema`，`when` 为本地可信表达式）。默认不用：每次使用发生在人物此时此地的处境里（`sessions.world_context`，`world_template_id = 'live'`）；只有内部校准批次显式指定 `world_ids` 时才用模板
- 人口抽样表：`config/population/{zh-CN,en-US}.json`；随包居民：`config/population/residents.jsonl`（每行 `{ spec, household, skeleton }`）
- 城镇与日程：`config/jobsworld/town.yaml`、`agenda.yaml`
- 模型目录的随包快照：`config/models/catalog.json`（`npx tsx scripts/update-model-catalog.ts` 更新）
- 全局参数：`config/pux.config.yaml`（预算、护栏、阈值、记忆检索权重等；可在不入库的 `config/pux.config.local.yaml` 里覆盖）
- 产品理解草稿（只有校准批次在用）：`data/apps/<app>/<version>/product.yaml`（`ProductSpecSchema`）
- 测试环境重置（`pnpm jobs dev app add --reset-url`）：每个校准批次开始时 GET 该地址，让被测环境回到初始状态（内置 Demo 为 `/__pux/reset`）。
- 已知缺陷清单（`pnpm jobs dev app add --seeded`）：`[{ id, category, title, description, location, keywords[] }]`
- 校准输入：见 [`CALIBRATION.md`](CALIBRATION.md)
