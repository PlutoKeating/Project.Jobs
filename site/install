#!/usr/bin/env bash
# Jobs 一行安装：
#   curl -fsSL https://jobs.plutokeating.beer/install | bash
#
# 它做的事：确认有 Docker（Linux 上没有就装）→ 拉取镜像 → 在 ~/.jobs 写好编排文件和带随机口令的 .env
#           （连同这台机器的 gcloud 配置目录，只读挂进容器，「模型」页一键使用 gcloud 登录）→ 启动
#           → 装好 jobsworld 命令。服务随 Docker 开机自启、异常自动重启。
#           重复运行就是升级：已有的 .env 和数据原样保留，换上新镜像之前先把数据库备份到 ~/.jobs/backups。
# 可用的环境变量：JOBS_HOME（安装目录，默认 ~/.jobs）、JOBS_PORT（默认 7777）、JOBS_BIND（默认 0.0.0.0，只想本机访问设为 127.0.0.1）、
#                 JOBS_IMAGE（镜像；已经装过时默认沿用 .env 里的，显式给出时会写回 .env）、
#                 JOBS_PUBLIC_URL（反向代理之后对外的 https 地址，coding agent 用 <它>/mcp 接入；显式给出时会写回 .env）、JOBS_SKIP_PULL=1（镜像已在本机）、
#                 JOBS_NO_DOCKER_INSTALL=1（不要替我装 Docker）、JOBS_SKIP_BACKUP=1（升级前不备份数据库）
set -euo pipefail
# 整个脚本包在一对花括号里：bash 要先读完到收尾的 } 才开始执行。用 curl … | bash 运行时，脚本本身就是标准输入，
# 如果边读边执行，中途任何读标准输入的命令（例如 docker compose exec）都会把还没执行的部分吃掉，脚本就会悄悄提前结束。
{

JOBS_HOME="${JOBS_HOME:-$HOME/.jobs}"
ENV_FILE="$JOBS_HOME/.env"
envv() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- || true; }
# 镜像：显式给出的 > 已有 .env 里的（锁定了某个版本就一直用它）> 最新版
IMAGE="${JOBS_IMAGE:-$(envv JOBS_IMAGE)}"; IMAGE="${IMAGE:-ghcr.io/plutokeating/jobs:latest}"
PORT="${JOBS_PORT:-7777}"
BIND="${JOBS_BIND:-0.0.0.0}"
OS="$(uname -s)"

say() { printf '\033[1m%s\033[0m\n' "$*"; }
die() { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }
rand() { LC_ALL=C tr -dc "${2:-a-z0-9}" < /dev/urandom | head -c "$1" || true; }
SUDO=""; if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then SUDO="sudo"; fi

# ---- 1. Docker ----
if ! command -v docker >/dev/null 2>&1; then
  if [ "$OS" = "Linux" ] && [ -z "${JOBS_NO_DOCKER_INSTALL:-}" ]; then
    say "没有找到 Docker，正在用官方脚本安装（需要管理员权限）…"
    curl -fsSL https://get.docker.com | $SUDO sh
    $SUDO systemctl enable --now docker >/dev/null 2>&1 || true
  else
    die "需要先装好 Docker（macOS / Windows 可以用 Docker Desktop 或 OrbStack），装好并启动后重新运行这一行。"
  fi
fi
if docker info >/dev/null 2>&1; then DOCKER=(docker)
elif [ -n "$SUDO" ] && $SUDO docker info >/dev/null 2>&1; then DOCKER=($SUDO docker)
else die "Docker 没在运行，或者当前用户没有权限使用它。启动 Docker（或把自己加进 docker 用户组）后重新运行。"; fi
"${DOCKER[@]}" compose version >/dev/null 2>&1 || die "需要 Docker Compose v2（docker compose）。请升级 Docker。"
[ "$OS" = "Linux" ] && { $SUDO systemctl enable docker >/dev/null 2>&1 || true; }

# ---- 2. 镜像与文件 ----
if [ -z "${JOBS_SKIP_PULL:-}" ]; then say "拉取镜像 $IMAGE …"; "${DOCKER[@]}" pull "$IMAGE"; fi
"${DOCKER[@]}" image inspect "$IMAGE" >/dev/null 2>&1 || die "本机没有镜像 $IMAGE。"
mkdir -p "$JOBS_HOME/control/requests"
for f in compose.yml compose.host.yml compose.bridge.yml jobs; do
  "${DOCKER[@]}" run --rm --entrypoint cat "$IMAGE" "/app/deploy/$f" > "$JOBS_HOME/$f.new" && mv "$JOBS_HOME/$f.new" "$JOBS_HOME/$f"
done
chmod +x "$JOBS_HOME/jobs"

# ---- 3. 配置（只在第一次生成；口令都是随机的）----
if [ ! -f "$ENV_FILE" ]; then
  # Linux 用宿主机网络（本机 127.0.0.1 上的开发服务器直接可达）；其他系统用端口映射
  if [ "$OS" = "Linux" ]; then MODE="compose.yml:compose.host.yml"; else MODE="compose.yml:compose.bridge.yml"; fi
  umask 077
  cat > "$ENV_FILE" <<ENV
# Jobs 的配置。改完后运行：jobsworld up
COMPOSE_FILE=$MODE
JOBS_IMAGE=$IMAGE
JOBS_PORT=$PORT
# 0.0.0.0 = 局域网 / 公网都能访问（靠下面的口令保护）；只想本机访问改成 127.0.0.1
JOBS_BIND=$BIND

# 对外的 https 地址（Jobs 放在 Caddy、Nginx 或 Cloudflare Tunnel 后面时填，例如 https://jobs.example.com）。
# coding agent 只要一个链接 <这个地址>/mcp 就能接入（浏览器里输口令授权）；不填时只有这台机器上的 agent 能用
JOBS_PUBLIC_URL=${JOBS_PUBLIC_URL:-}

# 管理员口令：发布、调宣发、接入模型。命令行与 coding agent 授权也用它
JW_ADMIN_PASSCODE=$(rand 4)-$(rand 4)-$(rand 4)
# 访客口令：只能看
JW_PASSCODE=$(rand 4)-$(rand 4)
# Terraria 游戏服的进服密码
JW_GAME_PASSWORD=$(rand 6)

# 以下不用改。JOBS_SECRET_KEY 用来加密你在「模型」里填的凭证：丢了它，已保存的凭证就解不开了
JOBS_SECRET_KEY=$(rand 43 'A-Za-z0-9')
JW_SESSION_SECRET=$(rand 32 'A-Za-z0-9')
PG_PASSWORD=$(rand 24 'A-Za-z0-9')
S3_ACCESS_KEY=jobs
S3_SECRET_KEY=$(rand 32 'A-Za-z0-9')
ENV
  umask 022
else
  say "沿用已有的配置：$ENV_FILE"
  if [ -n "${JOBS_IMAGE:-}" ] && [ "$(envv JOBS_IMAGE)" != "$IMAGE" ]; then
    if grep -qE '^JOBS_IMAGE=' "$ENV_FILE"; then
      awk -v img="$IMAGE" '/^JOBS_IMAGE=/{print "JOBS_IMAGE=" img; next} {print}' "$ENV_FILE" > "$ENV_FILE.new" && cat "$ENV_FILE.new" > "$ENV_FILE" && rm -f "$ENV_FILE.new"
    else echo "JOBS_IMAGE=$IMAGE" >> "$ENV_FILE"; fi
    echo "镜像改为 $IMAGE（已写进 .env）"
  fi
  if [ -n "${JOBS_PUBLIC_URL:-}" ] && [ "$(envv JOBS_PUBLIC_URL)" != "$JOBS_PUBLIC_URL" ]; then
    if grep -qE '^JOBS_PUBLIC_URL=' "$ENV_FILE"; then
      awk -v u="$JOBS_PUBLIC_URL" '/^JOBS_PUBLIC_URL=/{print "JOBS_PUBLIC_URL=" u; next} {print}' "$ENV_FILE" > "$ENV_FILE.new" && cat "$ENV_FILE.new" > "$ENV_FILE" && rm -f "$ENV_FILE.new"
    else echo "JOBS_PUBLIC_URL=$JOBS_PUBLIC_URL" >> "$ENV_FILE"; fi
    echo "对外地址改为 $JOBS_PUBLIC_URL（已写进 .env）"
  fi
fi
# 这台机器的 gcloud 配置目录只读挂进容器（.env 里的 JOBS_GCLOUD_DIR）：「模型」页点一下「使用这台机器的 gcloud 登录」就能用
JOBS_HOME="$JOBS_HOME" "$JOBS_HOME/jobs" _ensure-gcloud || true
# 以前有没有完整装好过（上一次如果半路失败，这次仍然算第一次）
FIRST=""; [ -f "$JOBS_HOME/.installed" ] || FIRST=1
PORT="$(envv JOBS_PORT)"; PORT="${PORT:-7777}"

# ---- 4. 启动（已经在运行时，换上新镜像之前先备份数据库）----
if [ -z "$FIRST" ] && [ -z "${JOBS_SKIP_BACKUP:-}" ]; then
  JOBS_HOME="$JOBS_HOME" "$JOBS_HOME/jobs" backup || die "升级前备份数据库失败，没有继续（数据没有动）。确定不要备份：在这一行前面加 JOBS_SKIP_BACKUP=1"
fi
say "启动 Jobs …"
# 第一次要拉取数据库、对象存储、事件总线的标准镜像；网络抖动时多试几次（已经拉到的不会重来）
started=""
for attempt in 1 2 3 4; do
  if (cd "$JOBS_HOME" && "${DOCKER[@]}" compose up -d); then started=1; break; fi
  [ "$attempt" -lt 4 ] && { echo "没有启动成功（多半是拉取镜像时网络中断），10 秒后重试（$attempt/3）…"; sleep 10; }
done
[ -n "$started" ] || die "启动失败。检查这台机器能不能访问 Docker Hub，然后重新运行这一行安装命令（已经完成的部分不会重来，口令也不会变）。"
# 游戏服在 profile 里，上面的 up 不会碰它们：装过的拉新镜像，正在运行的换上新镜像
if [ -z "$FIRST" ] && [ -z "${JOBS_SKIP_PULL:-}" ]; then JOBS_HOME="$JOBS_HOME" "$JOBS_HOME/jobs" _refresh-games || echo "游戏服没有更新成功（不影响 Jobs 本身）：jobsworld game on tshock|tml 重试"; fi

# ---- 5. jobsworld 命令 ----
# 命令叫 jobsworld。同时留一个 jobs 的别名（同一个东西）：它能被直接执行（比如写在 MCP 配置里），
# 但在终端里直接敲 jobs 会被 shell 的内建命令截走，所以文档和提示一律写 jobsworld。
LAUNCH="$JOBS_HOME/jobs"
if [ "$JOBS_HOME" != "$HOME/.jobs" ]; then
  printf '#!/usr/bin/env bash\nJOBS_HOME=%q exec %q "$@"\n' "$JOBS_HOME" "$JOBS_HOME/jobs" > "$JOBS_HOME/jobs-launch" && chmod +x "$JOBS_HOME/jobs-launch"
  LAUNCH="$JOBS_HOME/jobs-launch"
fi
BIN=""
if [ -w /usr/local/bin ]; then ln -sf "$LAUNCH" /usr/local/bin/jobsworld && ln -sf "$LAUNCH" /usr/local/bin/jobs && BIN=/usr/local/bin
elif [ -n "$SUDO" ] && $SUDO -n true 2>/dev/null; then $SUDO ln -sf "$LAUNCH" /usr/local/bin/jobsworld && $SUDO ln -sf "$LAUNCH" /usr/local/bin/jobs && BIN=/usr/local/bin
else mkdir -p "$HOME/.local/bin" && ln -sf "$LAUNCH" "$HOME/.local/bin/jobsworld" && ln -sf "$LAUNCH" "$HOME/.local/bin/jobs" && BIN="$HOME/.local/bin"; fi

# ---- 6. 让网页能一键开启游戏服（Linux + systemd；容器只能提出请求，真正执行的是宿主机上的 jobsworld 命令）----
if [ "$OS" = "Linux" ] && command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ] && { [ "$(id -u)" -eq 0 ] || { [ -n "$SUDO" ] && $SUDO -n true 2>/dev/null; }; }; then
  U="$(id -un)"
  $SUDO tee /etc/systemd/system/jobs-control.service >/dev/null <<UNIT
[Unit]
Description=Jobs: carry out requests made from the web page (game servers on/off)
[Service]
Type=oneshot
User=$U
Environment=JOBS_HOME=$JOBS_HOME
ExecStart=$JOBS_HOME/jobs _control
UNIT
  $SUDO tee /etc/systemd/system/jobs-control.path >/dev/null <<UNIT
[Unit]
Description=Jobs: watch for requests made from the web page
[Path]
PathExistsGlob=$JOBS_HOME/control/requests/*
[Install]
WantedBy=multi-user.target
UNIT
  $SUDO systemctl daemon-reload && $SUDO systemctl enable --now jobs-control.path >/dev/null 2>&1 && touch "$JOBS_HOME/control/watcher" && echo "update" > "$JOBS_HOME/control/host-features"
fi

# ---- 7. 等它起来 ----
printf '等待服务就绪'
ok=""
for _ in $(seq 1 120); do
  if curl -fsS -m 3 "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then ok=1; break; fi
  printf '.'; sleep 3
done
echo
[ -n "$ok" ] || die "服务没有在预期时间内就绪。看日志：cd $JOBS_HOME && docker compose logs --tail 100 jobs"

date -u +%FT%TZ > "$JOBS_HOME/.installed"

IP="$( (hostname -I 2>/dev/null | awk '{print $1}') || (ipconfig getifaddr en0 2>/dev/null) || true)"
echo
say "Jobs 装好了。"
echo "  打开：        http://127.0.0.1:$PORT/${IP:+    （局域网：http://$IP:$PORT/）}"
echo "  管理员口令：  $(envv JW_ADMIN_PASSCODE)"
echo "  访客口令：    $(envv JW_PASSCODE)"
PUB="$(envv JOBS_PUBLIC_URL)"
echo "  coding agent：claude mcp add --transport http jobs ${PUB:-http://127.0.0.1:$PORT}/mcp"
[ -n "$PUB" ] || echo "                （只有这台机器上的 agent 能用；要让别处接入，见 https://github.com/PlutoKeating/Project.Jobs/blob/main/docs/INSTALL.md 的「对外访问」）"
echo
if [ -n "$FIRST" ]; then
  echo "  第一次打开，用管理员口令进去，在「模型」里接入一家模型供应商（粘贴 Key、勾选模型、保存）。"
  echo "  然后点右上角「发布」，或者：jobsworld publish <网址> --name <名字> --tagline <一句话>"
fi
case ":$PATH:" in *":$BIN:"*) ;; *) echo "  （jobsworld 命令装在 $BIN，它不在你的 PATH 里：把它加进去，或直接用 $LAUNCH）";; esac
V="$(curl -fsS -m 3 "http://127.0.0.1:$PORT/healthz" 2>/dev/null | sed -n 's/.*"version":"\([^"]*\)".*/\1/p' || true)"
[ -n "$V" ] && echo "  版本：        $V"
[ -n "$FIRST" ] || echo "  这是一次重装 / 升级：口令和数据都没有变（升级前的数据库备份在 $JOBS_HOME/backups）。"
exit 0
}
