# 安装与运维

> **现状（2026-11-17）**：最新是 `v0.6.0`（飞书重做成一个能直接说话的 Jobs Agent：回答边做边出现在卡片里，清零、下线要点确认，能看图片、转发与文件，可以跟居民连续聊天、把结论导出成云文档；推送只在严重问题第一次出现、结论变了、需要你介入时马上说，其余合并，另有早报晚报与每个产品的看板卡；同一个 agent 也在网页右下角的「问 Jobs」和 `jobsworld chat` 里；问题可以生成修复任务、开成 GitHub issue，关闭后自动请人验证；模型设置多了「对话」组。从旧版本升上来、之前接入过飞书的，到「设置 › 飞书」点「扫码补权限」再扫一次。重写后的飞书渠道只在模拟的飞书接口上测过，还没有用真实账号扫码用过；`v0.5.1` 起对模型一律流式接收：出口经过代理（例如 Clash）时，想得久的调用不再在两分钟左右被掐断（`fetch failed`），一页结论、问题归并与评审恢复正常；有人用过之后结论页不会再显示「还没有人点开」，归纳没有成功时写明原因；产品页最上面是「此刻在用」，城首页右栏按产品列出此刻在用的人，排队的不算在用；`v0.5.0` 起产品可以清零（城里关于它的经历归零、产品留着重新上线）与下线（可选是否连经历一起删），网页、命令行（`jobsworld reset` / `remove`）和 coding agent（`reset_product` / `remove_product`）都能做；所有配置集中到网页的「设置」，按二级标签分类，原来的「模型」页是其中一个标签；`v0.4.2` 起居民的收信规则在开通后与每次启动时预先建好：Cloudflare 上新建的规则要一两分钟才生效，等到要验证码时才建就来不及；`v0.4.1` 起升级先比较版本：`jobsworld update` 和重新运行安装那一行只在确实有新版本时才拉镜像、备份、重建，`--check` 只看、`--force` 强制；`v0.4.0` 起有居民邮箱：在网页「设置」里填公网链接、贴一枚 Cloudflare API Token 一键开通，真实产品的验证邮件就能送到居民手里，见下面「居民邮箱」；整条收信的路已经在一个真实的 Cloudflare 域名（Cloudflare Tunnel 的主机名）上从外部邮箱收到过测试信；居民在真实产品里收验证码走完全程的情况还没观察过；GitHub Release 与三个镜像的版本号 / `latest` 标签在 CI 跑完后公开，匿名可拉取；从 `v0.2.1` 起三个镜像都同时有 `linux/amd64` 与 `linux/arm64`，arm64 的镜像只在 GitHub 的 arm64 机器上构建过、两个游戏服在 QEMU 下启动过，还没在 arm64 真机上装过），`jobs.plutokeating.beer/install` 放的就是仓库里的安装脚本。下面这一行在一个全新的、没有登录任何镜像仓库的 Docker 环境（Linux）里装成功过（`v0.1.0` 时；`v0.2.0` 的升级流程在本机用隔离的安装目录端到端验证过，没有在一台全新机器上重新装过）。macOS / Windows 的安装路径只有单元测试，没有在真机上装过。

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

可用的环境变量（写在这一行前面）：`JOBS_HOME`（安装目录，默认 `~/.jobs`）、`JOBS_PORT`（默认 7777）、`JOBS_BIND`（默认 `0.0.0.0`；只想本机访问设为 `127.0.0.1`）、`JOBS_IMAGE`（已经装过时默认沿用 `.env` 里的；显式给出时会写回 `.env`）、`JOBS_PUBLIC_URL`（反向代理之后对外的 https 地址，coding agent 用 `<它>/mcp` 接入；显式给出时会写回 `.env`；装好后也可以在网页「设置」里填）、`JOBS_SKIP_PULL=1`、`JOBS_NO_DOCKER_INSTALL=1`、`JOBS_SKIP_BACKUP=1`（升级前不备份数据库）。

## 装好之后

打开 `http://<这台机器的地址>:7777/`，用**管理员口令**进去。

1. 第一次会被带到「设置 › 模型」：选一家供应商 → 粘贴 Key → 勾选模型 → 保存。上方「每一步 / 归纳 / 定位」三项都有了目标就行了。见 [`MODELS.md`](MODELS.md)。
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
jobsworld update --check                                 # 只看本机版本和可升级到的版本，不动任何东西
```

动手之前都先比较版本：本机正在运行的版本，和要升级到的版本（镜像是 `latest` 时取 GitHub 上最新的正式 Release——CI 在三个镜像都推上去之后才建它，所以刚打完标签、镜像还在构建时不会被当成新版本；`.env` 里锁定了版本号时取那个版本；`JOBS_SKIP_PULL=1` 时取本机镜像里的版本）。已经是这个版本、本机比最新发布还新、或者查不到要升级到的版本（例如访问不了 GitHub、用的是自己指定的其他镜像）时，什么都不做，只说明原因。要强制重新拉取并重建：`jobsworld update --force`（或 `JOBS_FORCE_UPDATE=1`），重新运行安装那一行时用 `curl -fsSL https://jobs.plutokeating.beer/install | JOBS_FORCE=1 bash`。重新运行安装那一行时显式给出了与 `.env` 不同的 `JOBS_IMAGE` 或 `JOBS_PUBLIC_URL`，也照常重装。

确实要升级时，依次：拉取新镜像 → 从新镜像里取出编排文件和 `jobsworld` 命令本身 → 把数据库导出到 `~/.jobs/backups/`（`pg_dump` 自定义格式，文件名带时间和升级前的版本，只留最近 5 份；备份失败就不升级）→ 重建容器（新版本启动时自动迁移数据库）→ 装过的游戏服也拉新镜像，正在运行的换上新镜像 → 等服务就绪并报告版本。口令、密钥和数据都不变。

- **检查新版本**：服务每小时匿名读一次 GitHub 上本项目最新的正式 Release，管理员打开网页时上次结果超过 15 分钟也会当场重查（不带任何本机信息；预发布不算）。关闭：在 `~/.jobs/.env` 里加 `JOBS_UPDATE_CHECK=0`，运行 `jobsworld up`。`JOBS_UPDATE_URL` 可以换成返回同样格式（`tag_name`、`html_url`、`published_at`）的其他地址，比如访问不了 GitHub 时的镜像。
- **一键升级怎么做到的**：和开关游戏服一样，容器不接触 Docker，只往 `~/.jobs/control/requests/` 放一个名为 `update` 的请求，由宿主机上的监视单元调用 `jobsworld _control` 执行 `jobsworld update`；进度与结果写回 `control/update-status`，输出写在 `control/update.log`（失败时网页上显示最后 20 行）。从 0.1.0 升上来的安装，第一次要用命令或重新运行安装的那一行；之后网页就能一键升级。
- **锁定版本**：`.env` 里把 `JOBS_IMAGE` 写成 `ghcr.io/plutokeating/jobs:0.1.0` 这样的版本号标签，升级时就一直用它。网页上仍会提示有新版本，但正在运行的已经是锁定的版本时「立即升级」什么都不做；要换版本，改这一行再运行 `jobsworld update`。
- **回退**：数据库迁移只往前走，所以回退要连数据一起：

  ```bash
  cd ~/.jobs
  sed -i 's#^JOBS_IMAGE=.*#JOBS_IMAGE=ghcr.io/plutokeating/jobs:0.1.0#' .env   # 换回旧版本号
  docker compose stop jobs
  docker compose exec -T postgres pg_restore -U jobs -d jobs --clean --if-exists < backups/jobs-<时间>-v0.1.0.dump
  jobsworld up
  ```

### 用这台机器的 gcloud 登录接入 Vertex

如果这台机器上已经 `gcloud auth login` 过，Vertex 不用粘贴任何凭证：「设置 › 模型」里 Vertex 连接的凭证下面有「使用这台机器的 gcloud 登录」按钮，点一下、保存就行。Jobs 保存的只是「用 gcloud 的登录」这一句话（`{"gcloud": "auto"}`），每次换访问令牌前直接读 gcloud 自己的配置目录：当前账号与默认项目（`gcloud config set project`）、以及 `gcloud auth login` 存下的凭证。所以组织策略要求每天重新登录时，每天只需要在这台机器上 `gcloud auth login`，不用回到「模型」页；换账号、换默认项目也一样直接生效。

装好的 Jobs 跑在容器里，所以安装脚本会把这台机器的 gcloud 配置目录只读挂进去：`~/.jobs/.env` 里的 `JOBS_GCLOUD_DIR`（默认 `~/.config/gcloud`，设了 `CLOUDSDK_CONFIG` 时用它），编排把它挂到容器里的 `/root/.config/gcloud`。这个目录还不存在时会先建一个空的（属于你自己），以后再装 gcloud、再登录，容器里直接看得到。挂整个目录而不是单个文件，是因为 gcloud 写文件时会整份替换，单个文件的挂载会一直停在旧内容上。容器只读这个目录，只有你在「模型」页加了 gcloud 登录这把凭证时才会用到。

从 0.3.3 及更早版本升上来的安装还没有这一项：在网页上点按钮时，Linux 上（有网页一键升级的那个监视单元）会请宿主机自动补上并重建 `jobs` 容器，等大约半分钟按钮就接着完成；没有监视单元的机器（macOS / Windows）按提示在这台机器上运行一次 `jobsworld up`。`jobsworld up`、`jobsworld update` 和重新运行安装的那一行都会补上它。Windows 上 gcloud 装在 Windows 侧（`%APPDATA%\gcloud`）而不是 WSL 里时，把 `.env` 里的 `JOBS_GCLOUD_DIR` 改成那个目录（例如 `/mnt/c/Users/<你>/AppData/Roaming/gcloud`）再 `jobsworld up`。

从源码运行（`pnpm jobsworld`）时服务就在这台机器上，按钮直接可用。gcloud 没有默认项目时按钮会提示先 `gcloud config set project <项目 ID>`。登录过期的那段时间里模型调用会失败、这把凭证暂时跳过 10 分钟，所以重新登录后最迟约 10 分钟恢复。细节见 [`MODELS.md`](MODELS.md)。

### Coding agent（MCP）

agent 只要一个链接，第一次连接时在浏览器里输口令授权（管理员口令能发布，访客口令只能看）：

```bash
claude mcp add --transport http jobs https://jobs.example.com/mcp     # Claude Code
codex mcp add jobs --url https://jobs.example.com/mcp                   # Codex
```

网页右上角的机器人图标里有这台 Jobs 的链接、各家 agent 的写法，以及已经授权的 agent（可以撤销）。没设置公网链接（网页「设置」或 `JOBS_PUBLIC_URL`）时链接是 `http://127.0.0.1:7777/mcp`，只有这台机器上的 agent 能用；让别处的 agent 接入见下面的「对外访问与口令」。同一台机器上也可以用 stdio：`claude mcp add jobs -- jobsworld mcp`。

发布的产品地址必须是 Jobs 所在的机器能打开的：Jobs 在云端时，`localhost` 和内网地址都打不开，先把产品部署到公网（预览环境也可以）。

### 飞书

管理员打开「设置 › 飞书」→「用飞书扫码接入」→ 用飞书扫二维码并确认。这一步用的是飞书的「一键创建应用」：它在你的飞书里创建一个只属于你的机器人，并预先勾好 Jobs 需要的权限（收发消息、读取图片与文件、流式卡片、卡片按钮回调、应用内加急、云文档），Jobs 拿到的应用凭证加密存在数据库里；事件和卡片回调都走长连接，不需要公网地址。从旧版本升上来、之前已经接入过的，页面会提示「扫码补权限」：再扫一次，给原来的应用补上新权限（还是同一个应用，绑定的人与推送设置不变）；补之前流式卡片、按钮等用不了。

接入之后直接跟机器人说话，不用记命令：「随手记账现在怎么样」「请三个不太会用手机的老人试试」「让我跟赵红梅聊聊」「把最严重的问题写成修复任务」「把结论导出成文档发给团队」。回答边做边出现在一张卡片里（做了哪几步、逐字出现的回答、「停止」按钮）；干活时再说一句会插进去一起考虑。清零、下线会先发一张确认卡片，只有管理员能点，30 分钟内有效。图片、截图、转发的消息、合并转发、文本文件都能看懂；语音和视频不行。`/new` 重新开始，`/stop` 停下。

- **谁能用**：扫码的人是管理员；同一飞书组织的其他人默认是访客（只能看）；其他人私聊把口令发给机器人配对（管理员口令 → 管理员，访客口令 → 访客；建议发完撤回那条消息）。「设置 › 飞书 › 谁能用」可以改角色、撤销；换了口令，配对得来的身份全部失效。
- **群聊**：把机器人拉进群，@ 它才回；一个群共用一段对话，话题群里每个话题是一段。在群里 @ 它说「以后往这里推」就把这个群设为推送去处。
- **推送**：严重问题（P0、P1）第一次出现（附当时的截图）、结论有实质变化（标过新版本时附上新旧版本的对比）、需要你介入（应用内加急）会马上发；其余的事（有人用完、次要问题）每 30 分钟合并成一条；每天 8:30 早报、19:00 晚报；每个产品一张会自己刷新的看板卡。说一句「以后只在严重问题时叫我」「晚报改到九点」就能改，也可以在「设置 › 飞书 › 推送」里改。
- **网页链接**：卡片里的链接是一次性的只读链接：在手机的飞书里点开就能看那一页，不用输口令；只能打开一次，24 小时过期。要让链接从外面能打开，先在「设置 › 公网链接」里填好地址。
- **云文档**：导出的文档由机器人创建，然后把所有权转给扫码接入的人；在群里导出时可以给群成员加查看权限。

### Terraria

游戏服默认不装。管理员在网页右上角点手柄图标，打开「Terraria（原版）」或「tModLoader」的开关（或 `jobsworld game on tshock` / `jobsworld game on tml`）；第一次会拉取游戏服镜像。之后在游戏里「加入 → 通过 IP 加入」，地址和网页是同一个（同一个端口），进服密码见 `jobsworld passcode`。

## 目录与数据

| 位置 | 内容 |
|---|---|
| `~/.jobs/.env` | 配置：端口、监听地址、口令、密钥、只读挂进容器的 gcloud 配置目录（`JOBS_GCLOUD_DIR`）。改完运行 `jobsworld up` |
| `~/.jobs/compose*.yml`、`~/.jobs/jobs` | 编排文件与命令入口。它们随镜像发布，`jobsworld update` 会重新取一遍，不要手改 |
| `~/.jobs/compose.local.yml`（可选） | 你自己的补充编排，要在 `.env` 的 `COMPOSE_FILE` 里列上才生效；升级不会动它 |
| `~/.jobs/control/` | 网页向宿主机提出的请求（只有「开 / 关某个游戏服」「升级」「把 gcloud 配置目录挂进容器」这几种）、升级的进度与输出（`update-status`、`update.log`）、宿主机命令认得哪些动作（`host-features`） |
| `~/.jobs/backups/` | 每次升级前自动导出的数据库（`jobs-<时间>-v<版本>.dump`，最近 5 份）；`jobsworld backup` 手动导出一份 |
| Docker 卷 `jobs_pgdata` | 数据库：居民、记忆、发布、使用过程、模型配置（凭证是密文） |
| Docker 卷 `jobs_s3data` | 截图、录像等证据 |
| Docker 卷 `jobs_jobsdata` | 运行时文件 |

**`JOBS_SECRET_KEY` 要留好**：它用来加密你在「设置 › 模型」里填的凭证和飞书的应用凭证。丢了它，这些凭证就解不开，需要重新填。

备份：数据库用 `jobsworld backup`（导出到 `~/.jobs/backups/`）；截图录像等证据：`docker run --rm -v jobs_s3data:/d -v "$PWD":/o alpine tar czf /o/jobs-s3.tgz -C /d .`。连同 `~/.jobs/.env` 一起存好。

## 镜像

| 镜像 | 内容 |
|---|---|
| `ghcr.io/plutokeating/jobs` | 我们自己的全部代码：世界服务、接口、网页、单端口网关、命令行，以及它驱动的 Chromium、ffmpeg、字体。由仓库根的 `Dockerfile` 构建。pnpm（含它的原生二进制）在构建时就装进镜像（`COREPACK_HOME=/corepack`），运行时禁止 corepack 联网：容器启动不需要访问 npm |
| `pgvector/pgvector`、`pgsty/minio`、`nats` | 数据库、对象存储、事件总线：各自的标准镜像，原样引用 |
| `ghcr.io/plutokeating/jobs-tshock`、`jobs-tml` | 可选的两个 Terraria 游戏服（第三方服务端 + 我们的插件 / 模组），按需拉取。由 `infra/game/*/Dockerfile` 构建；TShock 按构建架构下载对应的发布包（`linux-x64` / `linux-arm64`） |

我们的三个镜像都同时发布 `linux/amd64` 与 `linux/arm64`（同一个标签下的多架构清单，拉取时 Docker 自动选本机的架构）；引用的三个标准镜像本身也都有这两种架构。`v0.2.0` 及更早的版本只有 `linux/amd64`，arm64 机器从 `v0.2.1` 开始能装。

Linux 上 `jobs` 容器用宿主机网络（`compose.host.yml`），数据库等只监听本机回环地址上的高位端口（55432、59000、54222，可在 `.env` 里改）；其他系统用端口映射（`compose.bridge.yml`）。对外只有一个端口（默认 7777）：网页、接口、WebSocket 和 Terraria 都走它。

## 对外访问与口令

默认监听 `0.0.0.0`，也就是局域网里（如果机器有公网地址，就是公网上）都能打开。保护它的是两个口令：访客口令只能看；管理员口令可以发布、调宣发、接入模型、控制世界。口令在 `~/.jobs/.env`，改完 `jobsworld up`。

两点要知道：

- 流量是明文 HTTP。要放到公网上，请在前面加一层带 TLS 的反向代理（Caddy、Nginx、Cloudflare Tunnel），并把 `JOBS_BIND` 改成 `127.0.0.1`。
- 放到反向代理后面之后，在网页右上角齿轮「设置 › 公网链接」里填好对外的地址（例如 `https://jobs.example.com`，不带路径），保存后几秒内生效；也可以写进 `.env` 的 `JOBS_PUBLIC_URL` 再 `jobsworld up`（网页上填的优先）。coding agent 的链接就是 `<它>/mcp`；OAuth 要求 https，所以这里填 http 的公网地址时远程 MCP 不会启用。也可以在安装那一行前面加 `JOBS_PUBLIC_URL=https://…`，会写回 `.env`。目前只支持挂在域名根路径下（不支持 `https://example.com/jobs` 这样的子路径）。

  Caddy（自动申请证书），`/etc/caddy/Caddyfile`：

  ```
  jobs.example.com {
      reverse_proxy 127.0.0.1:7777
  }
  ```

  Cloudflare Tunnel（不用开端口、不用公网 IP）：`cloudflared tunnel create jobs`，在 Cloudflare 里把 `jobs.example.com` 指到这个隧道，配置里 `service: http://127.0.0.1:7777`，再 `cloudflared tunnel run jobs`。Terraria 游戏服走的是同一个端口的 TCP，HTTP 反向代理转发不了；要从外面进游戏，需要另外放行这个端口。
- `POST /api/v1/inbox/email` 与 `/inbox/sms` 不需要登录（被测产品的测试环境要往这里投递验证码）。它们只能给居民的收件箱塞消息，读不到任何东西。

## 居民邮箱

很多产品要用邮箱注册或收验证码。居民默认的地址是 `…@jobsworld.test`，真实的信到不了；给他们真实的邮箱只要两样东西：

1. 一个能从外网访问这台 Jobs 的 https 链接，域名托管在 Cloudflare（例如用 Cloudflare Tunnel 把 `jobs.example.com` 指到 `http://127.0.0.1:7777`）。怎么做到由维护者自己决定。
2. 一枚 Cloudflare API Token（[在这里创建](https://dash.cloudflare.com/profile/api-tokens)，选「创建自定义令牌」），权限：`Zone › Zone › Read`、`Zone › Zone Settings › Edit`、`Zone › Email Routing Rules › Edit`、`Account › Workers Scripts › Edit`，区域资源包含这个域名。

在网页的「设置」里填好公网链接、贴上令牌，点「开通」。Jobs 会确认链接能回到自己、上传一个只转发的 Worker（`jobsworld-mail`）、在 `jobs.example.com` 上开启 Email Routing（Cloudflare 自动加 MX、SPF、DKIM 记录），然后把每位居民的地址换成 `<像真人的用户名>@jobs.example.com`。Cloudflare Tunnel 的主机名上本来就有一条 CNAME，实测它和 Email Routing 加的 MX 可以共存；万一 Cloudflare 不接受，会改用 `mail.jobs.example.com`，设置页上会写明。开通后，后台会把居民的收信规则预先建好。

Cloudflare 上新建的东西要过一两分钟才在它的收信服务器上生效，这期间发来的信会被退回：新开的子域退回 `550 5.1.1 Domain does not exist`，新建的地址退回 `550 5.1.1 Address does not exist`。所以开通后先等几分钟（设置页上有提示），再用「给一个临时地址发测试信」：建好临时地址后等一两分钟，从你自己的邮箱发一封，看到「收到了」就说明整条路通了。

- 收信不需要 25 端口，也不需要公网 IP：信先到 Cloudflare，Worker 再用 https 把原始邮件（带签名）送回 `<公网链接>/inbound/email`。只收不发。
- 子域不能用通配规则，每个域最多 200 条规则：Jobs 开通后（以及每次启动时）在后台把规则预先建到上限（默认 190 条，`JOBS_MAIL_RULE_CAP` 可改；最近用过产品的人优先），新装的城 242 人里绝大多数一开始就能收信。其余的人在开始用产品时才建；新规则要一两分钟才生效，这时候来的第一封信可能被退回。名额不够时先回收从没收到过真实邮件的人，被回收的人地址不变，下次用产品时自动重建。
- 改了公网链接后要点「重新部署」，居民的地址会跟着变，之前用旧地址注册的账号就收不到信了。
- 「关闭」会删掉 Worker 和收信规则，居民地址回到 `jobsworld.test`；Cloudflare 上的 MX 记录留着，要删在 Cloudflare 里删。
- 原始邮件存在 MinIO（证据），正文与仪器提取的验证码、链接存在 Postgres，永久保留；网页「人」页有每个人的收件箱。

## 自己构建

在哪种架构的机器上构建，就得到哪种架构的镜像（x86_64 与 arm64 都行）。要在 x86_64 上构建 arm64 镜像，先装好 QEMU（`docker run --privileged --rm tonistiigi/binfmt --install arm64`），再用 `docker buildx build --platform linux/arm64 --load ...`，会慢很多。

```bash
docker build -t jobs:local .
JOBS_IMAGE=jobs:local JOBS_SKIP_PULL=1 bash deploy/install.sh
```

之后重新构建了同名镜像，用 `JOBS_SKIP_PULL=1 jobsworld update` 换上它（不去镜像仓库拉取，其余步骤照常，包括备份数据库）。它比较的是镜像里 `package.json` 的版本：没改版本号就重新构建时，加 `--force`。

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
