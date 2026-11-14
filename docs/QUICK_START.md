# 快速开始（本地）

## 0. 前置条件

- Node ≥ 22（推荐 24）、pnpm ≥ 10、Docker（Compose v2）、ffmpeg、gcloud CLI
- `gcloud auth application-default login`（ADC 凭据，LiteLLM 与 TTS 使用；每天需重新登录时重新执行）
- 能访问 Vertex AI 上的 `gemini-4-hydrogen / argon / carbon` 的 GCP 项目

## 1. 配置

```bash
cp .env.example .env
# 必填：VERTEX_PROJECT=<你的 GCP 项目 ID>
#       GOOGLE_ADC_FILE=/home/<you>/.config/gcloud/application_default_credentials.json
pnpm install
npx playwright install chromium
```

端口（除 JobsWorld 网关外均只绑定 127.0.0.1，可在 `.env` 覆盖）：Postgres 55432 · MinIO 59000/59001 · LiteLLM 54000 · Temporal 57233（UI 58233）· NATS 54222（监控 58222）· API 5320 · 网页开发服务器 5321 · **JobsWorld 网关 0.0.0.0:7777**（网页 + 游戏共用）· Demo 5401–5411（干净版）/ 5501–5511（植入缺陷版）。

## 2. 启动依赖并初始化

```bash
docker compose up -d
pnpm pux doctor        # 全部 ✅ 再继续
pnpm pux init          # 数据库迁移 + 导入 39 个手写 Persona（含职业人群、硅谷 AI 精英 / AI Native Vibe Coder / OPC 创业青年、审美与设计评审团与 Steve Jobs 模拟人物） + 9 个世界模板 + 注册 11 个 Demo
pnpm demos             # 另开终端，启动全部 Demo（22 个实例）
```

可选：下载 PersonaHub 子集用于 Persona 生成流水线：`./scripts/download-personahub.sh 10000`，然后 `pnpm pux persona generate -n 5 --locale zh-CN`。

## 3. 对内置 Demo 跑一次完整闭环

```bash
pnpm pux product crawl --app demo-assistant@seeded          # 爬取 + LLM 归纳 → data/apps/demo-assistant/seeded/product.yaml
# 打开 YAML 检查，把 confirmed 改为 true（或直接用 --auto-confirm）
pnpm pux product import data/apps/demo-assistant/seeded/product.yaml --auto-confirm
pnpm pux study create --app demo-assistant@seeded --sessions 6 --steps 30
pnpm pux study run <study_id>                                # 进程内编排；结束后自动生成报告
```

`seeded` 版本带有已知缺陷清单，结束时会自动计算**检出率 / 误报率**并写入校准卡。

## 4. 灌入任意新项目（全自动）

```bash
pnpm pux auto --url https://your-test-env.example.com/ --name your-app --version v1 \
  --sessions 8 --steps 40 [--form h5] [--prd prd.md] [--user test --password xxx] [--executor midscene] [--revisits 1,7]
```

或在工作台「评测 → 灌入新项目」填写 URL。流程：注册 → 爬取 → 归纳（自动确认）→ 多轮自适应采样 → 模拟 → 评估 → 校准 → 报告。

## 5. JobsWorld 工作台（可视化）

```bash
docker compose up -d nats            # 事件总线（第 2 步已全部启动时可跳过）
pnpm jobsworld                       # 世界服务 + API（含网页）+ 单端口网关；首次会自动构建网页
```

浏览器打开 `http://<本机局域网 IP>:7777/`（本机为 `http://127.0.0.1:7777/`）：

- **世界**：侧视像素小城。点人物看他正在用什么软件、在想什么、刚才做了什么、接下来去哪；点建筑看里面的人。管理员可暂停/调速时钟、在地点制造事件、回放 Session。
- **人**：全部人物、画像、今天的日程、记忆、用过的软件；管理员可按分布生成新人物。
- **软件**：每个软件的汇总报告（结论 + 可信度、目标客户 vs 实际适配人群、典型反馈、问题、走势）。
- **评测 / 接管**：原控制台的全部功能（发起 Study、灌入新项目、Session 时间线、追问访谈、分诊、人工接管）。

访问控制（`.env`）：`JW_PASSCODE`（网页共享口令）、`JW_ADMIN_PASSCODE`（管理员口令，可发起评测、控制世界）；都不设置时局域网内任何人都是管理员。

**用 Terraria 进入同一个世界**（游戏服在 docker compose 的 `game` profile 中，首次构建会下载服务端）：

```bash
docker compose --profile game up -d --build --no-deps tshock   # 原版 Terraria 1.4.5.x 客户端
docker compose --profile game up -d --build --no-deps tml      # tModLoader（稳定版 1.4.4，带可点击的人物面板）
```

在游戏里「加入 → 通过 IP 加入」，地址与网页相同（`<本机 IP>`，端口 `7777`）：网关会按客户端类型自动分流。服务器密码为 `.env` 的 `JW_GAME_PASSWORD`（留空则无）。游戏内输入 `/jw who`、`/jw goto 地铁站`、`/jw follow 林薇`、`/jw info 林薇`、`/jw ask 林薇 你刚才为什么生气？`；管理员先 `/jw login <JW_ADMIN_PASSCODE>`，再用 `/jw clock`、`/jw event`、`/jw replay`。详见 [`game/README.md`](../game/README.md)。

没有游戏客户端也能验证：`npx tsx scripts/jw-probe.ts --port 7777 --secs 15`（列出假玩家、气泡、告示牌与时间同步）。

开发网页：`pnpm world`、`pnpm api` 后 `pnpm web`（Vite，`http://127.0.0.1:5321/`，代理到 API）。

## 6. 使用 Temporal 编排（可选）

```bash
pnpm worker                                   # 终端 A：启动 worker
pnpm pux study run <study_id> --temporal      # 终端 B：提交工作流；进度在 http://127.0.0.1:58233
```

## 7. 常用命令

| 命令 | 作用 |
|---|---|
| `pnpm pux study status <id>` / `pnpm pux issues <id>` | 查看 Session 与问题 |
| `pnpm pux report <id>` | 重新生成报告 |
| `pnpm pux study finalize <id>` | 重新合成问题、去重、校准并生成报告 |
| `pnpm pux issue confirm <issue>` / `pnpm pux issue reject <issue>` | 人工分诊（影响误报率与基线） |
| `PUX_INTEGRATION=1 pnpm test` | 含模态注入/打断/弱网的集成测试 |
| `pnpm pux interview <session_id>` | 可追问访谈（交互式） |
| `pnpm pux human list` / `pnpm pux human resolve <task>` | 人工接管（验证码等） |
| `pnpm pux calibrate human <study> examples/calibration/human-benchmark.example.yaml` | 导入真人基准 |
| `pnpm pux m0 --app demo-assistant@seeded` | M0：Stagehand vs Midscene 定位对比 |
| `pnpm pux persona generate -n 5` | 生成 synthetic Persona |
| `pnpm typecheck` / `pnpm test` | 类型检查 / 单元测试 |

## 8. 儿童 Persona

默认关闭。安全 rubric（`config/rubrics/child_safety.yaml`）经人工审核后，在 `config/pux.config.local.yaml` 中设置 `safety.child_personas_enabled: true`，并在 Study 中加 `--children`。无论是否开启，Policy Gate 对所有 Persona 都生效。

## 9. 故障排查

- LiteLLM 报 401/403 或「Reauthentication is needed」：ADC 过期，重新 `gcloud auth application-default login` 后 `docker compose restart litellm`。运行中的 Study 会在每轮开始前预检并暂停等待（最多 60 分钟）；已经失败的 Study 可用 `pnpm pux study resume <id>` 继续。
- `pux doctor` 中 Temporal ❌：只影响 `--temporal` 模式，进程内编排不依赖它。
- 工作台世界页没有人在动 / 时钟显示 `--:--`：确认 `docker compose up -d nats` 且 `pnpm world` 在运行。
- 浏览器启动失败：`npx playwright install chromium`；无图形环境时保持 headless（默认）。
