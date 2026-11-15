# 快速开始（从源码运行）

## 0. 前置条件

- Node ≥ 22（推荐 24）、pnpm ≥ 10、Docker（Compose v2）、ffmpeg
- 至少一家模型供应商的凭证（OpenAI、Anthropic、Google、OpenRouter、DeepSeek、通义、豆包…任何 OpenAI 兼容的入口都行）。其中要有一个能看图的模型；在截图上定位目前支持 Gemini、GPT-5、Qwen-VL、豆包、GLM-V、UI-TARS 这几个家族

## 1. 配置

```bash
cp .env.example .env        # 默认值即可运行
pnpm install
npx playwright install chromium
```

端口（除网关外均只绑定 127.0.0.1，可在 `.env` 覆盖）：Postgres 55432 · MinIO 59000/59001 · NATS 54222（监控 58222）· API 5320 · 网页开发服务器 5321 · **网关 0.0.0.0:7777**（网页 + 游戏共用）· 示例产品 5401–5411（干净版）/ 5501–5511（植入缺陷版）。

## 2. 启动依赖并初始化

```bash
docker compose up -d       # Postgres+pgvector / MinIO / NATS
pnpm jobs init             # 数据库迁移 + 导入手写人物与随包自带的 185 位居民（新库共 199 人住进城里）+ 注册示例产品
```

## 3. 启动 Jobs

```bash
pnpm jobsworld             # 世界服务 + API（含网页）+ 单端口网关；首次会自动构建网页
```

浏览器打开 `http://<本机 IP>:7777/`（本机为 `http://127.0.0.1:7777/`）。

**第一次打开会被带到「模型」页**：在「添加供应商」里选一家 → 粘贴凭证 → 勾选模型 → 「保存」。页面上方的「每一步 / 归纳 / 定位」三项都有了目标，城里的人才能做决定、才能用产品。之后可以随时增删供应商、调顺序，保存后几秒生效，不用重启。详见 [`MODELS.md`](MODELS.md)。`pnpm jobs doctor` 可以检查全部依赖。

回到「城」。第一眼是城：点人物看他此刻在做什么、在用什么、在想什么；点建筑看里面的人。

## 4. 发布第一个产品

没有现成产品时，先起示例产品：`pnpm demos`（另开终端；也可以用 `JOBS_DEMOS=1 pnpm jobsworld` 一起启动）。`http://127.0.0.1:5508/` 是一个「显示已自动保存但其实没存」的笔记应用。示例在跑的时候，发布对话框左下角有「示例」可选。

网页右上角「发布」，或者：

```bash
pnpm jobs publish http://127.0.0.1:5508/ --name 闪念笔记 --tagline "想到什么，马上记下，自动保存" --intensity 0.5
pnpm jobs status 闪念笔记          # 看到 / 注意到 / 有兴趣 / 打开过 / 回来再用
pnpm jobs invite 闪念笔记 -n 3     # 想马上得到反馈：把手机递给三个人
pnpm jobs report 闪念笔记 --eng    # 一页结论 + 亲历的问题（含复现步骤）+ 工程附录
```

居民是按自己的日程遇到产品的，自然流量需要时间。想快一点：`pnpm jobs clock --speed 20`（有人正在使用产品时，时钟自动不超过 4 倍速，免得他被生活催着走）。

产品地址只要这台机器能访问即可（本地开发服务器也行）。产品需要邮箱或短信验证码时，把测试环境的发信地址指到 `POST /api/v1/inbox/email`、`/inbox/sms`（见 [`API.md`](API.md)），对应的居民会真的收到。

## 5. 接入 coding agent（MCP）

```bash
claude mcp add jobs -- pnpm --dir /path/to/Project.Jobs -s jobs mcp
```

服务不在默认地址时设置 `JOBS_API`（默认 `http://127.0.0.1:7777`）；设置了管理员口令时把它放进 `JOBS_KEY`。

## 6. 访问控制

`.env`：`JW_PASSCODE`（访客口令：只能看）、`JW_ADMIN_PASSCODE`（管理员口令：发布、调宣发、接入模型、控制世界）。都不设置时，能访问这个端口的任何人都是管理员。命令行与 MCP 用 `Authorization: Bearer <口令>`（环境变量 `JOBS_KEY`）。

## 7. 飞书（可选）

管理员在网页右上角点对话气泡图标，用飞书扫码接入；之后可以在飞书里发布、看状况、要结论、向居民追问，并收到进展推送。说明见 [`INSTALL.md`](INSTALL.md) 的「飞书」一节。

## 8. 用 Terraria 进入同一座城（可选）

```bash
docker compose --profile game up -d --build --no-deps tshock   # 原版 Terraria 1.4.5.x 客户端
docker compose --profile game up -d --build --no-deps tml      # tModLoader（稳定版 1.4.4，带可点击的人物面板）
```

在游戏里「加入 → 通过 IP 加入」，地址与网页相同（端口 `7777`），网关按客户端类型自动分流。服务器密码为 `.env` 的 `JW_GAME_PASSWORD`（留空则无）。从源码运行时，网页手柄里的开关不会替你启动游戏服，它会给出上面这条命令。

游戏内：`/jw who`、`/jw goto 地铁站`、`/jw follow 林薇`、`/jw info 林薇`、`/jw ask 林薇 你刚才为什么关掉了？`、`/jw launches`。管理员先 `/jw login <JW_ADMIN_PASSCODE>`，再用 `/jw publish <网址> <名字> <一句话>`、`/jw promote <产品> <0-100|pause|resume|end>`、`/jw invite <产品> [人数]`、`/jw clock`、`/jw event`、`/jw replay`。详见 [`game/README.md`](../game/README.md)。

没有游戏客户端也能验证：`npx tsx scripts/jw-probe.ts --port 7777 --secs 15`。

## 9. 常用命令

| 命令 | 作用 |
|---|---|
| `pnpm jobs ls` | 已发布的产品与各自的人数 |
| `pnpm jobs promote <产品> --intensity 0.8` / `--pause` / `--resume` / `--end` | 调宣发 |
| `pnpm jobs people --using` | 此刻正在用产品的人 |
| `pnpm jobs ask <人物 id> <问题>` | 向用过产品的居民追问 |
| `pnpm jobs clock --pause` / `--resume` / `--speed 20` / `--jump 19:30` | 世界时钟 |
| `pnpm jobs world populate -n 20` | 生成新居民并住进城里（中国按抽样表，英语区从 Nemotron-Personas-USA 抽样；需要联网） |
| `pnpm jobs world settle` / `import-residents` / `export-residents` | 安置已有人物 / 导入、导出随包居民 |
| `pnpm jobs dev …` | 内部与校准用的指派式批次（已知缺陷检出率、回归），见 [`CALIBRATION.md`](CALIBRATION.md) |
| `pnpm typecheck` / `pnpm test` / `PUX_INTEGRATION=1 pnpm test` | 类型检查 / 单元测试 / 含浏览器的集成测试 |

开发网页：`pnpm world`、`pnpm api` 后 `pnpm web`（Vite，`http://127.0.0.1:5321/`，代理到 API）。

## 10. 故障排查

- 城里一直没人用产品、世界服务日志里有「还没有接入可用的模型」：到「模型」页看上方三项哪一项标红。
- 模型调用报凭证无效：到「模型」页给对应连接换一把凭证并保存（旧的删掉）。用 gcloud 的 ADC 文件做凭证时它会过期，过期后重新粘贴。
- 城里没有人在动 / 时钟显示 `--:--`：确认 NATS 容器在运行、世界服务在运行。
- 发布之后一直没人打开：看 `pnpm jobs status <产品>` 里路过的人怎么想；提高宣发强度、换一句话介绍，或 `pnpm jobs invite <产品>`。世界服务以 `JW_RUNNER=0` 启动时不会驱动发布引擎。
- 浏览器启动失败：`npx playwright install chromium`。
