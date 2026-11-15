# 安装与运维

> **现状（2026-11-16）**：最新是 `v0.2.2`（修复用局域网 IP 走纯 http 打开网页时「模型」页崩溃、复制按钮无效；GitHub Release 与三个镜像的 `0.2.2` / `latest` 标签都已公开，匿名可拉取；从 `v0.2.1` 起三个镜像都同时有 `linux/amd64` 与 `linux/arm64`，arm64 的镜像只在 GitHub 的 arm64 机器上构建过、两个游戏服在 QEMU 下启动过，还没在 arm64 真机上装过），`jobs.plutokeating.beer/install` 放的就是仓库里的安装脚本。下面这一行在一个全新的、没有登录任何镜像仓库的 Docker 环境（Linux）里装成功过（`v0.1.0` 时；`v0.2.0` 的升级流程在本机用隔离的安装目录端到端验证过，没有在一台全新机器上重新装过）。macOS / Windows 的安装路径只有单元测试，没有在真机上装过。

## 一行安装

```bash
curl -fsSL https://jobs.plutokeating.beer/install | bash
```

需要一台能跑 Docker 的机器（Linux、macOS、Windows 的 WSL2；x86_64 或 arm64（aarch64，比如 Apple 芯片的 Mac、树莓派 5、RDK X5 这类开发板），镜像会自动选对架构；建议 4 核 8 G 内存以上，因为要同时开几个浏览器；主镜像约 3.4 GB）。脚本做的事：

1. 确认有 Docker 和 Compose v2。Linux 上没有 Docker 时用官方脚本安装（需要管理员权限；不想让它装就设 `JOBS_NO_DOCKER_INSTALL=1`）。macOS / Windows 请先装好 Docker Desktop 或 OrbStack。
2. 拉取镜像，在 `~/.jobs/` 写好编排文件和 `.env`。`.env` 里的口令和密钥都是随机生成的，文件只有你自己能读。
3. 启动。第一次要拉取数据库、对象存储、事件总线的标准镜像，拉取失败会自动重试几次。服务随 Docker 开机自启、异常退出自动重启（`restart: unless-stopped`）；没有另外安装系统服务。
4. 把 `jobsworld` 命令放进 `/usr/local/bin`（没有权限时放 `~/.local/bin`）。同一个位置还有一个叫 `jobs` 的别名，是同一个东西：它可以被直接执行（比如写进 MCP 配置），但在终端里直接敲 `jobs` 会被 shell 的内建命令（列出后台任务）截走，所以平时请用 `jobsworld`。安装脚本不会改动你的 shell 启动文件。
5. Linux + systemd、并且能免密使用管理员权限时，再装一个小的监视单元（`jobs-control.path`），这样网页里才能一键开关游戏服。没有它时，网页上的开关会给出要在这台机器上运行的命令。

装完会打印访问地址、版本、管理员口令和访客口令。重复运行这一行是安全的，也就是升级（见下面的「升级」）：已有的 `.env` 和数据原样保留，先备份数据库，再换上新镜像和编排文件；上一次半路失败的话，再运行一次会接着做完。

可用的环境变量（写在这一行前面）：`JOBS_HOME`（安装目录，默认 `~/.jobs`）、`JOBS_PORT`（默认 7777）、`JOBS_BIND`（默认 `0.0.0.0`；只想本机访问设为 `127.0.0.1`）、`JOBS_IMAGE`（已经装过时默认沿用 `.env` 里的；显式给出时会写回 `.env`）、`JOBS_SKIP_PULL=1`、`JOBS_NO_DOCKER_INSTALL=1`、`JOBS_SKIP_BACKUP=1`（升级前不备份数据库）。

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
jobsworld update                                                 # 升级到最新版本（先自动备份数据库）
jobsworld version | backup                                       # 当前版本 | 手动备份数据库
jobsworld uninstall [--purge]                                    # 停止；--purge 连数据一起删
```

`jobsworld` 是一个很薄的壳：管理服务的几个子命令在宿主机上直接调 `docker compose`，其余的原样交给容器里的 Jobs 命令行（`jobsworld --help-all` 列出全部，包括 `doctor`、`people`、`ask`、`clock`、`world`）。

### 升级

有新版本时，管理员在网页右上角会看到「新版本 x.y.z」。点开能看到改了什么；能一键升级时点「立即升级」，页面会在新版本起来之后自动刷新。不能一键升级时（不是 Linux + systemd，或安装时没有免密的管理员权限），它给出要在这台机器上运行的那一行命令。三种升级方式效果相同：

```bash
jobsworld update                                         # 或者网页上的「立即升级」
curl -fsSL https://jobs.plutokeating.beer/install | bash  # 重新运行安装的那一行
```

都会依次：拉取新镜像 → 从新镜像里取出编排文件和 `jobsworld` 命令本身 → 把数据库导出到 `~/.jobs/backups/`（`pg_dump` 自定义格式，文件名带时间和升级前的版本，只留最近 5 份；备份失败就不升级）→ 重建容器（新版本启动时自动迁移数据库）→ 装过的游戏服也拉新镜像，正在运行的换上新镜像 → 等服务就绪并报告版本。口令、密钥和数据都不变。

- **检查新版本**：服务每 6 小时匿名读一次 GitHub 上本项目最新的正式 Release（不带任何本机信息；预发布不算）。关闭：在 `~/.jobs/.env` 里加 `JOBS_UPDATE_CHECK=0`，运行 `jobsworld up`。`JOBS_UPDATE_URL` 可以换成返回同样格式（`tag_name`、`html_url`、`published_at`）的其他地址，比如访问不了 GitHub 时的镜像。
- **一键升级怎么做到的**：和开关游戏服一样，容器不接触 Docker，只往 `~/.jobs/control/requests/` 放一个名为 `update` 的请求，由宿主机上的监视单元调用 `jobsworld _control` 执行 `jobsworld update`；进度与结果写回 `control/update-status`，输出写在 `control/update.log`（失败时网页上显示最后 20 行）。从 0.1.0 升上来的安装，第一次要用命令或重新运行安装的那一行；之后网页就能一键升级。
- **锁定版本**：`.env` 里把 `JOBS_IMAGE` 写成 `ghcr.io/plutokeating/jobs:0.1.0` 这样的版本号标签，升级时就一直用它。网页上仍会提示有新版本，但「立即升级」只会重新拉取你锁定的那个版本；要换版本，改这一行再运行 `jobsworld update`。
- **回退**：数据库迁移只往前走，所以回退要连数据一起：

  ```bash
  cd ~/.jobs
  sed -i 's#^JOBS_IMAGE=.*#JOBS_IMAGE=ghcr.io/plutokeating/jobs:0.1.0#' .env   # 换回旧版本号
  docker compose stop jobs
  docker compose exec -T postgres pg_restore -U jobs -d jobs --clean --if-exists < backups/jobs-<时间>-v0.1.0.dump
  jobsworld up
  ```

### 用本机 gcloud 登录的 Vertex 凭证

如果这台机器上已经用 gcloud 登录了 Google Cloud，可以让 Jobs 直接读 gcloud 的凭证文件，而不是粘贴一份副本。组织策略要求每天重新登录时尤其合适：每天在宿主机上重新登录一次，Jobs 下一次换访问令牌就用上新的凭证，不用回到「模型」页。

1. 把 gcloud 的配置目录**按原路径**、只读地挂进 `jobs` 容器。在 `~/.jobs/` 下新建 `compose.local.yml`（`jobsworld update` 和重新运行安装脚本都不会动它；路径写成绝对路径，不要用 `~` 或 `$HOME`，网页上的一键升级由 systemd 执行，那里不一定有 `HOME`）：

   ```yaml
   services:
     jobs:
       volumes:
         - /home/<你>/.config/gcloud:/home/<你>/.config/gcloud:ro
   ```

   按原路径挂载是因为 `application_default_credentials.json` 常常是指向同目录下其他文件的绝对路径符号链接（比如指向 `legacy_credentials/<账号>/adc.json`）；挂整个目录而不是单个文件，是因为 gcloud 写文件时会整份替换，单个文件的挂载会一直停在旧内容上。

2. 在 `~/.jobs/.env` 的 `COMPOSE_FILE` 末尾加上 `:compose.local.yml`（例如 Linux 上是 `COMPOSE_FILE=compose.yml:compose.host.yml:compose.local.yml`），运行 `jobsworld up`。
3. 「模型」页里 Vertex 连接的凭证框粘贴：

   ```json
   {"file": "/home/<你>/.config/gcloud/application_default_credentials.json", "project_id": "<你的项目>"}
   ```

   `gcloud auth login` 写出的用户凭证里没有项目，所以要写 `project_id`；文件里有 `quota_project_id` 时可以省略。保存后点「测试」确认。

之后每天只需要在宿主机上重新登录（让上面那个文件更新：`gcloud auth application-default login`，或者像上面那样把它链接到 `gcloud auth login` 写出的文件）。登录过期的那段时间里模型调用会失败、这把凭证暂时跳过 10 分钟，所以重新登录后最迟约 10 分钟恢复。细节见 [`MODELS.md`](MODELS.md)。

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
| `~/.jobs/compose.local.yml`（可选） | 你自己的补充编排（比如把 gcloud 的配置目录挂进容器），要在 `.env` 的 `COMPOSE_FILE` 里列上才生效；升级不会动它 |
| `~/.jobs/control/` | 网页向宿主机提出的请求（只有「开 / 关某个游戏服」「升级」这几种）、升级的进度与输出（`update-status`、`update.log`）、宿主机命令认得哪些动作（`host-features`） |
| `~/.jobs/backups/` | 每次升级前自动导出的数据库（`jobs-<时间>-v<版本>.dump`，最近 5 份）；`jobsworld backup` 手动导出一份 |
| Docker 卷 `jobs_pgdata` | 数据库：居民、记忆、发布、使用过程、模型配置（凭证是密文） |
| Docker 卷 `jobs_s3data` | 截图、录像等证据 |
| Docker 卷 `jobs_jobsdata` | 运行时文件 |

**`JOBS_SECRET_KEY` 要留好**：它用来加密你在「模型」里填的凭证和飞书的应用凭证。丢了它，这些凭证就解不开，需要重新填。

备份：数据库用 `jobsworld backup`（导出到 `~/.jobs/backups/`）；截图录像等证据：`docker run --rm -v jobs_s3data:/d -v "$PWD":/o alpine tar czf /o/jobs-s3.tgz -C /d .`。连同 `~/.jobs/.env` 一起存好。

## 镜像

| 镜像 | 内容 |
|---|---|
| `ghcr.io/plutokeating/jobs` | 我们自己的全部代码：世界服务、接口、网页、单端口网关、命令行，以及它驱动的 Chromium、ffmpeg、字体。由仓库根的 `Dockerfile` 构建。pnpm（含它的原生二进制）在构建时就装进镜像（`COREPACK_HOME=/corepack`），运行时禁止 corepack 联网：容器启动不需要访问 npm |
| `pgvector/pgvector`、`elestio/minio`、`nats` | 数据库、对象存储、事件总线：各自的标准镜像，原样引用 |
| `ghcr.io/plutokeating/jobs-tshock`、`jobs-tml` | 可选的两个 Terraria 游戏服（第三方服务端 + 我们的插件 / 模组），按需拉取。由 `infra/game/*/Dockerfile` 构建；TShock 按构建架构下载对应的发布包（`linux-x64` / `linux-arm64`） |

我们的三个镜像都同时发布 `linux/amd64` 与 `linux/arm64`（同一个标签下的多架构清单，拉取时 Docker 自动选本机的架构）；引用的三个标准镜像本身也都有这两种架构。`v0.2.0` 及更早的版本只有 `linux/amd64`，arm64 机器从 `v0.2.1` 开始能装。

Linux 上 `jobs` 容器用宿主机网络（`compose.host.yml`），数据库等只监听本机回环地址上的高位端口（55432、59000、54222，可在 `.env` 里改）；其他系统用端口映射（`compose.bridge.yml`）。对外只有一个端口（默认 7777）：网页、接口、WebSocket 和 Terraria 都走它。

## 对外访问与口令

默认监听 `0.0.0.0`，也就是局域网里（如果机器有公网地址，就是公网上）都能打开。保护它的是两个口令：访客口令只能看；管理员口令可以发布、调宣发、接入模型、控制世界。口令在 `~/.jobs/.env`，改完 `jobsworld up`。

两点要知道：

- 流量是明文 HTTP。要放到公网上，请在前面加一层带 TLS 的反向代理（Caddy、Nginx、Cloudflare Tunnel），并把 `JOBS_BIND` 改成 `127.0.0.1`。
- `POST /api/v1/inbox/email` 与 `/inbox/sms` 不需要登录（被测产品的测试环境要往这里投递验证码）。它们只能给居民的收件箱塞消息，读不到任何东西。

## 自己构建

在哪种架构的机器上构建，就得到哪种架构的镜像（x86_64 与 arm64 都行）。要在 x86_64 上构建 arm64 镜像，先装好 QEMU（`docker run --privileged --rm tonistiigi/binfmt --install arm64`），再用 `docker buildx build --platform linux/arm64 --load ...`，会慢很多。

```bash
docker build -t jobs:local .
JOBS_IMAGE=jobs:local JOBS_SKIP_PULL=1 bash deploy/install.sh
```

之后重新构建了同名镜像，用 `JOBS_SKIP_PULL=1 jobsworld update` 换上它（不去镜像仓库拉取，其余步骤照常，包括备份数据库）。

装游戏服也一样先在本机构建并打上编排文件里的名字：`docker build -f infra/game/tshock/Dockerfile -t ghcr.io/plutokeating/jobs-tshock:latest .`（tModLoader 换成 `infra/game/tmodloader/Dockerfile` 与 `jobs-tml`）。

## 对外发布（维护者）

1. 版本号只有一个来源：仓库根 `package.json` 的 `version`（命令行 `jobsworld -V`、MCP、`/healthz`、`/api/v1/version` 和网页都读它）。发版时先把它改成新版本并提交到 `main`，再打同名的 `v*` 标签（例如 `0.2.0` 对应 `v0.2.0`）：`.github/workflows/release.yml` 先检查标签与 `package.json` 一致，然后构建并推送三个镜像到 GHCR（`jobs`、`jobs-tshock`、`jobs-tml`，现在都是 Public；标签为版本号与 `latest`）。每个镜像的 amd64 与 arm64 分别在 GitHub 的 x64 与 arm64 原生机器上构建（不用 QEMU 模拟），先只按摘要推送，再合成一个多架构清单打上标签，并检查两个架构都在；**三个镜像都推上去之后**才建 GitHub Release（说明自动从提交生成）。装好的 Jobs 看到的是这个 Release，所以提示出现时新镜像一定已经能拉取。标签带 `-`（如 `v0.3.0-rc.1`）是预发布：不打 `latest`，Release 标为预发布，已装好的 Jobs 不会被提示。新建的包默认是私有的，可见性只能在 GitHub 网页的 Packages 设置里改，没有接口；以后如果新增镜像，要记得把它也设为 Public，匿名用户才能拉取。
2. 把仓库里的 `site/` 部署到 Cloudflare 并绑定 `jobs.plutokeating.beer`（见下）。`site/install` 是 `deploy/install.sh` 的原样副本（改了安装脚本后运行 `node scripts/sync-install.mjs`，测试会检查两者一致），`site/_headers` 让它以纯文本返回。官网的页面（落地页、关于、条款与条件、隐私政策，中英两种语言）由 `pnpm site:build` 从 `site/src/` 生成后提交进仓库，线上没有构建步骤，见 [`site/docs/README.md`](../site/docs/README.md)。同一条命令也生成两份 README 里的示意图（`docs/images/`）。

### 在 Cloudflare 上部署 `site/`（连接 GitHub 仓库创建 Worker）

`site/` 是一个纯静态的 Worker（Workers 静态资源，没有脚本）：配置在 `site/wrangler.jsonc`，`site/.assetsignore` 把配置文件、页面源码（`src/`）、生成脚本与说明文档排除在发出去的内容之外。对外发出去的只有 `site/` 里已经生成好的页面、样式、脚本、字体、图片和安装脚本；构建时 Cloudflare 会克隆整个仓库，但仓库其余部分不会被公开。

入口：Cloudflare 控制台 → **Workers & Pages** → **Create application** → 选 **GitHub**（Import a repository）。

| 表单项 | 填什么 | 说明 |
|---|---|---|
| Git account | 你的 GitHub 账号 | 第一次会跳到 GitHub 安装「Cloudflare Workers and Pages」应用：选 **Only select repositories**，只勾这个仓库。私有仓库可以用 |
| Repository | `Project.Jobs` | |
| Project name（Worker 名字） | `jobs-site` | 要与 `site/wrangler.jsonc` 里的 `name` 相同 |
| Production branch（Git branch） | `main` | 默认就是仓库的默认分支 |
| Build command | 留空 | 没有构建步骤 |
| Deploy command | `npx wrangler deploy` | 默认值，不用改 |
| Preview command（非生产分支用） | 保持默认 | 下面会把预览构建关掉，用不到 |
| Root directory（Path） | `site` | **必填**。不填会在仓库根目录找配置，找不到 |
| API token | Create new token（默认） | 让 Cloudflare 自动生成 |
| Build variables and secrets | 名称 `SKIP_DEPENDENCY_INSTALL`，值 `1` | 跳过依赖安装：这个站点不需要仓库里的任何 npm 包 |

点 **Save and Deploy**。构建成功后先打开它给的 `*.workers.dev` 地址确认落地页正常，再做下面两件事（都在这个 Worker 的 **Settings** 里）：

| 位置 | 填什么 | 说明 |
|---|---|---|
| Domains & Routes → Add → Custom Domain | `jobs.plutokeating.beer` | 域名的解析已经在 Cloudflare 上，`jobs` 这个子域名目前没有任何记录，Cloudflare 会自动建解析记录并签发证书 |
| Build → Branch control → Enable Preview Builds（非生产分支构建） | 取消勾选 | 否则每个分支的每次推送都会构建一次 |
| Build → Build watch paths → Include paths | `site/*` | 只有 `site/` 下的文件变了才重新部署 |

验证：

```bash
curl -sI https://jobs.plutokeating.beer/install | grep -i content-type    # text/plain; charset=utf-8
curl -fsSL https://jobs.plutokeating.beer/install | head -3               # 安装脚本的开头
```

本机预览或试部署（不上传）：`cd site && npx wrangler dev`、`npx wrangler deploy --dry-run`。

现在线上的就是这样部署的（2026-11-15）：Worker 名 `jobs-site`，跟随 `main`；推送到 `main` 后约半分钟构建并上线，构建结果会作为一条检查（Workers Builds: jobs-site）出现在那次提交上。
