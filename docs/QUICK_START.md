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

端口（均只绑定 127.0.0.1，可在 `.env` 覆盖）：Postgres 55432 · MinIO 59000/59001 · LiteLLM 54000 · Temporal 57233（UI 58233）· 控制台 5300 · Demo 5401–5411（干净版）/ 5501–5511（植入缺陷版）。

## 2. 启动依赖并初始化

```bash
docker compose up -d
pnpm pux doctor        # 全部 ✅ 再继续
pnpm pux init          # 数据库迁移 + 导入 14 个精品 Persona + 9 个世界模板 + 注册 11 个 Demo
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

或在控制台 `http://127.0.0.1:5300/new` 填写 URL。流程：注册 → 爬取 → 归纳（自动确认）→ 多轮自适应采样 → 模拟 → 评估 → 校准 → 报告。

## 5. 使用 Temporal 编排（可选）

```bash
pnpm worker                                   # 终端 A：启动 worker
pnpm pux study run <study_id> --temporal      # 终端 B：提交工作流；进度在 http://127.0.0.1:58233
```

## 6. 常用命令

| 命令 | 作用 |
|---|---|
| `pnpm pux study status <id>` / `pnpm pux issues <id>` | 查看 Session 与问题 |
| `pnpm pux report <id>` | 重新生成报告 |
| `pnpm pux interview <session_id>` | 可追问访谈（交互式） |
| `pnpm pux human list` / `pnpm pux human resolve <task>` | 人工接管（验证码等） |
| `pnpm pux calibrate human <study> examples/calibration/human-benchmark.example.yaml` | 导入真人基准 |
| `pnpm pux m0 --app demo-assistant@seeded` | M0：Stagehand vs Midscene 定位对比 |
| `pnpm pux persona generate -n 5` | 生成 synthetic Persona |
| `pnpm typecheck` / `pnpm test` | 类型检查 / 单元测试 |

## 7. 儿童 Persona

默认关闭。安全 rubric（`config/rubrics/child_safety.yaml`）经人工审核后，在 `config/pux.config.local.yaml` 中设置 `safety.child_personas_enabled: true`，并在 Study 中加 `--children`。无论是否开启，Policy Gate 对所有 Persona 都生效。

## 8. 故障排查

- LiteLLM 报 401/403：ADC 过期，重新 `gcloud auth application-default login` 后 `docker compose restart litellm`。
- `pux doctor` 中 Temporal ❌：只影响 `--temporal` 模式，进程内编排不依赖它。
- 浏览器启动失败：`npx playwright install chromium`；无图形环境时保持 headless（默认）。
