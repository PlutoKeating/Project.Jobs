# 安装与运维

## 一行安装

```bash
curl -fsSL https://jobs.plutokeating.beer/install | bash
```

需要一台能跑 Docker 的机器（Linux、macOS、Windows 的 WSL2 都行；建议 4 核 8 G 以上，因为要同时开几个浏览器）。脚本做的事：

1. 确认有 Docker 和 Compose v2。Linux 上没有 Docker 时用官方脚本安装（需要管理员权限；不想让它装就设 `JOBS_NO_DOCKER_INSTALL=1`）。macOS / Windows 请先装好 Docker Desktop 或 OrbStack。
2. 拉取镜像，在 `~/.jobs/` 写好编排文件和 `.env`。`.env` 里的口令和密钥都是随机生成的，文件只有你自己能读。
3. 启动。服务随 Docker 开机自启、异常退出自动重启（`restart: unless-stopped`）。
4. 把 `jobsworld` 命令放进 `/usr/local/bin`（没有权限时放 `~/.local/bin`）。同一个位置还有一个叫 `jobs` 的别名，是同一个东西：它可以被直接执行（比如写进 MCP 配置），但在终端里直接敲 `jobs` 会被 shell 的内建命令（列出后台任务）截走，所以平时请用 `jobsworld`。安装脚本不会改动你的 shell 启动文件。
5. Linux + systemd 上再装一个小的监视单元（`jobs-control.path`），这样网页里才能一键开关游戏服。

装完会打印访问地址、管理员口令和访客口令。重复运行这一行是安全的：已有的 `.env` 和数据原样保留，只会更新镜像和编排文件。

可用的环境变量（写在这一行前面）：`JOBS_HOME`（安装目录，默认 `~/.jobs`）、`JOBS_PORT`（默认 7777）、`JOBS_BIND`（默认 `0.0.0.0`；只想本机访问设为 `127.0.0.1`）、`JOBS_IMAGE`、`JOBS_SKIP_PULL=1`、`JOBS_NO_DOCKER_INSTALL=1`。

## 装好之后

打开 `http://<这台机器的地址>:7777/`，用**管理员口令**进去。

1. 第一次会被带到「模型」页：选一家供应商 → 粘贴 Key → 勾选模型 → 保存。上方「每一步 / 归纳 / 定位」三项都有了目标就行了。见 [`MODELS.md`](MODELS.md)。
2. 回到「城」，点右上角「发布」：粘贴产品的网址、名字、一句话。没有现成的产品时，对话框左下角的「示例」里有十个带着真实小毛病的示例产品。
3. 居民会按自己的日子遇到它。想马上得到反馈，在产品页右栏「把手机递给几个人」。

你在这台机器上跑的本地开发服务器（`http://127.0.0.1:3000/` 之类）可以直接发布：Linux 上 Jobs 用的是宿主机网络，原样可达；macOS / Windows 上会自动换成 `host.docker.internal`（这时开发服务器要监听在所有网卡上，或者用 Docker Desktop——它会把这个名字转到本机回环地址）。

### 命令行

```bash
jobsworld publish http://127.0.0.1:3000/ --name 闪念笔记 --tagline "想到什么，马上记下"
jobsworld status 闪念笔记
jobsworld invite 闪念笔记 -n 3
jobsworld report 闪念笔记 --eng

jobsworld url | passcode | ps | logs | restart | up | down     # 服务本身
jobsworld game on tshock | jobsworld game off tml                    # Terraria 游戏服
jobsworld update                                                 # 升级到最新版本
jobsworld uninstall [--purge]                                    # 停止；--purge 连数据一起删
```

`jobsworld` 是一个很薄的壳：管理服务的几个子命令在宿主机上直接调 `docker compose`，其余的原样交给容器里的 Jobs 命令行。

### Coding agent（MCP）

```bash
claude mcp add jobs -- jobsworld mcp        # Claude Code；Codex、opencode 等同理：命令是 `jobsworld mcp`，走 stdio
```

### 飞书

管理员在网页右上角点飞书图标 →「用飞书扫码接入」→ 用飞书扫二维码并确认。这一步用的是飞书的「一键创建应用」：它在你的飞书里创建一个只属于你的机器人，Jobs 拿到的应用凭证加密存在数据库里；事件走长连接，不需要公网地址。

接入之后，在飞书里跟机器人说：`发布 <网址> <名字> <一句话>`、`产品`、`状况 [产品]`、`结论 [产品]`、`邀请 [产品] [人数]`、`宣发 <产品> <0-100 | 暂停 | 继续 | 结束>`、`问 <居民的名字> <问题>`。有人用完了、用过的人数到了 3 / 6 / 12 / 24… 时的结论、需要你介入的事（比如验证码），机器人会主动发给你。发布、调宣发、递手机只听扫码接入的那个人的。

### Terraria

游戏服默认不装。管理员在网页右上角点手柄图标，打开「Terraria（原版）」或「tModLoader」的开关（或 `jobsworld game on tshock` / `jobsworld game on tml`）；第一次会拉取游戏服镜像。之后在游戏里「加入 → 通过 IP 加入」，地址和网页是同一个（同一个端口），进服密码见 `jobsworld passcode`。

## 目录与数据

| 位置 | 内容 |
|---|---|
| `~/.jobs/.env` | 配置：端口、监听地址、口令、密钥。改完运行 `jobsworld up` |
| `~/.jobs/compose*.yml`、`~/.jobs/jobs` | 编排文件与命令入口。它们随镜像发布，`jobsworld update` 会重新取一遍，不要手改 |
| `~/.jobs/control/` | 网页向宿主机提出的请求（只有「开 / 关某个游戏服」这几种） |
| Docker 卷 `jobs_pgdata` | 数据库：居民、记忆、发布、使用过程、模型配置（凭证是密文） |
| Docker 卷 `jobs_s3data` | 截图、录像等证据 |
| Docker 卷 `jobs_jobsdata` | 运行时文件 |

**`JOBS_SECRET_KEY` 要留好**：它用来加密你在「模型」里填的凭证和飞书的应用凭证。丢了它，这些凭证就解不开，需要重新填。

备份：`docker run --rm -v jobs_pgdata:/d -v "$PWD":/o alpine tar czf /o/jobs-pg.tgz -C /d .`（`jobs_s3data` 同理），连同 `~/.jobs/.env` 一起存好。

## 镜像

| 镜像 | 内容 |
|---|---|
| `ghcr.io/plutokeating/jobs` | 我们自己的全部代码：世界服务、接口、网页、单端口网关、命令行，以及它驱动的 Chromium、ffmpeg、字体。由仓库根的 `Dockerfile` 构建 |
| `pgvector/pgvector`、`elestio/minio`、`nats` | 数据库、对象存储、事件总线：各自的标准镜像，原样引用 |
| `ghcr.io/plutokeating/jobs-tshock`、`jobs-tml` | 可选的两个 Terraria 游戏服（第三方服务端 + 我们的插件 / 模组），按需拉取。由 `infra/game/*/Dockerfile` 构建 |

Linux 上 `jobs` 容器用宿主机网络（`compose.host.yml`），数据库等只监听本机回环地址上的高位端口（55432、59000、54222，可在 `.env` 里改）；其他系统用端口映射（`compose.bridge.yml`）。对外只有一个端口（默认 7777）：网页、接口、WebSocket 和 Terraria 都走它。

## 对外访问与口令

默认监听 `0.0.0.0`，也就是局域网里（如果机器有公网地址，就是公网上）都能打开。保护它的是两个口令：访客口令只能看；管理员口令可以发布、调宣发、接入模型、控制世界。口令在 `~/.jobs/.env`，改完 `jobsworld up`。

两点要知道：

- 流量是明文 HTTP。要放到公网上，请在前面加一层带 TLS 的反向代理（Caddy、Nginx、Cloudflare Tunnel），并把 `JOBS_BIND` 改成 `127.0.0.1`。
- `POST /api/v1/inbox/email` 与 `/inbox/sms` 不需要登录（被测产品的测试环境要往这里投递验证码）。它们只能给居民的收件箱塞消息，读不到任何东西。

## 自己构建

```bash
docker build -t jobs:local .
JOBS_IMAGE=jobs:local JOBS_SKIP_PULL=1 bash deploy/install.sh
```

发布新版本（维护者）：打 `v*` 标签后由 `.github/workflows/release.yml` 构建并推送三个镜像；`deploy/install.sh` 需要放到 `https://jobs.plutokeating.beer/install` 能取到的位置。
