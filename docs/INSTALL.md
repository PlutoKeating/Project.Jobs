# 安装与运维

> **现状（2026-11-15）**：安装脚本、镜像构建文件和编排文件都在仓库里，并且在一个全新的 Docker 环境（Linux）里用本机构建的镜像完整装过、用过。但三个镜像还没有推到公开的镜像仓库，`jobs.plutokeating.beer/install` 上也还没有放安装脚本——**在那之前，下面这一行在别人的机器上跑不通**，要用文末「自己构建」的方式。macOS / Windows 的安装路径只有单元测试，没有在真机上装过。

## 一行安装

```bash
curl -fsSL https://jobs.plutokeating.beer/install | bash
```

需要一台能跑 Docker 的机器（Linux、macOS、Windows 的 WSL2；建议 4 核 8 G 内存以上，因为要同时开几个浏览器；主镜像约 3.4 GB）。脚本做的事：

1. 确认有 Docker 和 Compose v2。Linux 上没有 Docker 时用官方脚本安装（需要管理员权限；不想让它装就设 `JOBS_NO_DOCKER_INSTALL=1`）。macOS / Windows 请先装好 Docker Desktop 或 OrbStack。
2. 拉取镜像，在 `~/.jobs/` 写好编排文件和 `.env`。`.env` 里的口令和密钥都是随机生成的，文件只有你自己能读。
3. 启动。第一次要拉取数据库、对象存储、事件总线的标准镜像，拉取失败会自动重试几次。服务随 Docker 开机自启、异常退出自动重启（`restart: unless-stopped`）；没有另外安装系统服务。
4. 把 `jobsworld` 命令放进 `/usr/local/bin`（没有权限时放 `~/.local/bin`）。同一个位置还有一个叫 `jobs` 的别名，是同一个东西：它可以被直接执行（比如写进 MCP 配置），但在终端里直接敲 `jobs` 会被 shell 的内建命令（列出后台任务）截走，所以平时请用 `jobsworld`。安装脚本不会改动你的 shell 启动文件。
5. Linux + systemd、并且能免密使用管理员权限时，再装一个小的监视单元（`jobs-control.path`），这样网页里才能一键开关游戏服。没有它时，网页上的开关会给出要在这台机器上运行的命令。

装完会打印访问地址、管理员口令和访客口令。重复运行这一行是安全的：已有的 `.env` 和数据原样保留，只会更新镜像和编排文件；上一次半路失败的话，再运行一次会接着做完。

可用的环境变量（写在这一行前面）：`JOBS_HOME`（安装目录，默认 `~/.jobs`）、`JOBS_PORT`（默认 7777）、`JOBS_BIND`（默认 `0.0.0.0`；只想本机访问设为 `127.0.0.1`）、`JOBS_IMAGE`、`JOBS_SKIP_PULL=1`、`JOBS_NO_DOCKER_INSTALL=1`。

## 装好之后

打开 `http://<这台机器的地址>:7777/`，用**管理员口令**进去。

1. 第一次会被带到「模型」页：选一家供应商 → 粘贴 Key → 勾选模型 → 保存。上方「每一步 / 归纳 / 定位」三项都有了目标就行了。见 [`MODELS.md`](MODELS.md)。
2. 回到「城」，点右上角「发布」：粘贴产品的网址、名字、一句话。没有现成的产品时，对话框左下角的「示例」里有十个带着真实小毛病的示例产品。
3. 居民会按自己的日子遇到它。想马上得到反馈，在产品页右栏「把手机递给几个人」。

你在这台机器上跑的本地开发服务器（`http://127.0.0.1:3000/` 之类）可以直接发布：Linux 上 Jobs 用的是宿主机网络，原样可达；macOS / Windows 上发布时会自动把 `localhost` / `127.0.0.1` 换成 `host.docker.internal`（Docker Desktop 与 OrbStack 会把这个名字转到你的电脑上；如果连不上，让开发服务器监听所有网卡）。

### 命令行

```bash
jobsworld publish http://127.0.0.1:3000/ --name 闪念笔记 --tagline "想到什么，马上记下"
jobsworld status 闪念笔记
jobsworld invite 闪念笔记 -n 3
jobsworld report 闪念笔记 --eng

jobsworld url | passcode | ps | logs | restart | up | down     # 服务本身
jobsworld game on tshock          # 开原版 Terraria 的游戏服；game off tshock 关掉；tml 是 tModLoader
jobsworld update                                                 # 升级到最新版本
jobsworld uninstall [--purge]                                    # 停止；--purge 连数据一起删
```

`jobsworld` 是一个很薄的壳：管理服务的几个子命令在宿主机上直接调 `docker compose`，其余的原样交给容器里的 Jobs 命令行（`jobsworld --help-all` 列出全部，包括 `doctor`、`people`、`ask`、`clock`、`world`）。

### Coding agent（MCP）

```bash
claude mcp add jobs -- jobsworld mcp        # Claude Code；Codex、opencode 等同理：命令是 `jobsworld mcp`，走 stdio
```

### 飞书

管理员在网页右上角点对话气泡图标 →「用飞书扫码接入」→ 用飞书扫二维码并确认。这一步用的是飞书的「一键创建应用」：它在你的飞书里创建一个只属于你的机器人，Jobs 拿到的应用凭证加密存在数据库里；事件走长连接，不需要公网地址。

接入之后，在飞书里跟机器人说：`发布 <网址> <名字> <一句话>`、`产品`、`状况 [产品]`、`结论 [产品]`、`邀请 [产品] [人数]`、`宣发 <产品> <0-100 | 暂停 | 继续 | 结束>`、`问 <居民的名字> <问题>`。有人用完了、用过的人数到了 3 / 6 / 12 / 24… 时的结论、需要你介入的事（比如验证码），机器人会主动发给你。发布、调宣发、递手机只听扫码接入的那个人的。（扫码之后的环节——收消息、回消息、主动推送——还没有用真实的飞书账号验证过。）

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

装游戏服也一样先在本机构建并打上编排文件里的名字：`docker build -f infra/game/tshock/Dockerfile -t ghcr.io/plutokeating/jobs-tshock:latest .`（tModLoader 换成 `infra/game/tmodloader/Dockerfile` 与 `jobs-tml`）。

## 对外发布（维护者）

1. 打 `v*` 标签：`.github/workflows/release.yml` 构建并推送三个镜像到 GHCR。第一次推送后，在 GitHub 的 Packages 设置里把这三个包设为 Public，匿名用户才能拉取。主镜像里是全部源码，公开镜像等于公开源码。
2. 把仓库里的 `site/` 作为静态站点部署并绑定 `jobs.plutokeating.beer`：`site/install` 是 `deploy/install.sh` 的原样副本（改了安装脚本后运行 `node scripts/sync-install.mjs`，测试会检查两者一致），`site/_headers` 让它以纯文本返回，`site/index.html` 是落地页。
