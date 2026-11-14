#!/usr/bin/env bash
# Jobs 一行安装：
#   curl -fsSL https://jobs.plutokeating.beer/install | bash
#
# 它做的事：确认有 Docker（Linux 上没有就装）→ 拉取镜像 → 在 ~/.jobs 写好编排文件和带随机口令的 .env → 启动
#           → 装好 jobs / jobsworld 命令。服务随 Docker 开机自启、异常自动重启。重复运行是安全的：已有的 .env 和数据原样保留。
# 可用的环境变量：JOBS_HOME（安装目录，默认 ~/.jobs）、JOBS_PORT（默认 7777）、JOBS_BIND（默认 0.0.0.0，只想本机访问设为 127.0.0.1）、
#                 JOBS_IMAGE（镜像）、JOBS_SKIP_PULL=1（镜像已在本机）、JOBS_NO_DOCKER_INSTALL=1（不要替我装 Docker）、
#                 JOBS_NO_SHELL_HOOK=1（不要动我的 shell 启动文件）
set -euo pipefail

JOBS_HOME="${JOBS_HOME:-$HOME/.jobs}"
IMAGE="${JOBS_IMAGE:-ghcr.io/plutokeating/jobs:latest}"
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
if [ ! -f "$JOBS_HOME/.env" ]; then
  # Linux 用宿主机网络（本机 127.0.0.1 上的开发服务器直接可达）；其他系统用端口映射
  if [ "$OS" = "Linux" ]; then MODE="compose.yml:compose.host.yml"; else MODE="compose.yml:compose.bridge.yml"; fi
  umask 077
  cat > "$JOBS_HOME/.env" <<ENV
# Jobs 的配置。改完后运行：jobs up
COMPOSE_FILE=$MODE
JOBS_IMAGE=$IMAGE
JOBS_PORT=$PORT
# 0.0.0.0 = 局域网 / 公网都能访问（靠下面的口令保护）；只想本机访问改成 127.0.0.1
JOBS_BIND=$BIND

# 管理员口令：发布、调宣发、接入模型。命令行与 MCP 也用它
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
  FIRST=1
else
  FIRST=""
  say "沿用已有的配置：$JOBS_HOME/.env"
fi
envv() { grep -E "^$1=" "$JOBS_HOME/.env" | head -1 | cut -d= -f2-; }
PORT="$(envv JOBS_PORT)"; PORT="${PORT:-7777}"

# ---- 4. 启动 ----
say "启动 Jobs …"
(cd "$JOBS_HOME" && "${DOCKER[@]}" compose up -d)

# ---- 5. jobs 命令 ----
# 命令有两个名字：jobs 和 jobsworld（同一个东西）。
# jobs 在 bash / zsh / fish 里本来是内建命令（列出后台任务），直接敲会被 shell 截走；所以再往 shell 的启动文件里加一个很小的函数：
# 带着 Jobs 的子命令（publish、status…）时交给 Jobs，不带参数或带 -l、%1 这类参数时照旧是内建命令。脚本里请用 jobsworld。
LAUNCH="$JOBS_HOME/jobs"
if [ "$JOBS_HOME" != "$HOME/.jobs" ]; then
  printf '#!/usr/bin/env bash\nJOBS_HOME=%q exec %q "$@"\n' "$JOBS_HOME" "$JOBS_HOME/jobs" > "$JOBS_HOME/jobs-launch" && chmod +x "$JOBS_HOME/jobs-launch"
  LAUNCH="$JOBS_HOME/jobs-launch"
fi
BIN=""
if [ -w /usr/local/bin ]; then ln -sf "$LAUNCH" /usr/local/bin/jobs && ln -sf "$LAUNCH" /usr/local/bin/jobsworld && BIN=/usr/local/bin
elif [ -n "$SUDO" ] && $SUDO -n true 2>/dev/null; then $SUDO ln -sf "$LAUNCH" /usr/local/bin/jobs && $SUDO ln -sf "$LAUNCH" /usr/local/bin/jobsworld && BIN=/usr/local/bin
else mkdir -p "$HOME/.local/bin" && ln -sf "$LAUNCH" "$HOME/.local/bin/jobs" && ln -sf "$LAUNCH" "$HOME/.local/bin/jobsworld" && BIN="$HOME/.local/bin"; fi

HOOKED=""
if [ -z "${JOBS_NO_SHELL_HOOK:-}" ]; then
  for rc in "$HOME/.bashrc" "$HOME/.zshrc"; do
    case "$rc" in *.zshrc) [ -f "$rc" ] || [ "$(basename "${SHELL:-}")" = "zsh" ] || continue ;; *) [ -f "$rc" ] || [ "$(basename "${SHELL:-}")" = "bash" ] || continue ;; esac
    grep -q '# >>> jobs >>>' "$rc" 2>/dev/null && { HOOKED=1; continue; }
    cat >> "$rc" <<HOOK

# >>> jobs >>>
# jobs 本来是 shell 的内建命令（列出后台任务）：带着 Jobs 的子命令时交给 Jobs，其余照旧。由 Jobs 的安装脚本添加
jobs() { case "\${1:-}" in ''|-*|%*) builtin jobs "\$@" ;; *) "$LAUNCH" "\$@" ;; esac; }
# <<< jobs <<<
HOOK
    HOOKED=1
  done
  if [ -d "$HOME/.config/fish" ]; then
    mkdir -p "$HOME/.config/fish/functions"
    cat > "$HOME/.config/fish/functions/jobs.fish" <<HOOK
# 由 Jobs 的安装脚本添加：带着 Jobs 的子命令时交给 Jobs，其余照旧是 fish 的内建命令
function jobs --wraps jobs
    if test (count \$argv) -gt 0; and not string match -q -- '-*' \$argv[1]; and not string match -q -- '%*' \$argv[1]
        "$LAUNCH" \$argv
    else
        builtin jobs \$argv
    end
end
HOOK
    HOOKED=1
  fi
fi

# ---- 6. 让网页能一键开启游戏服（Linux + systemd；容器只能提出请求，真正执行的是宿主机上的 jobs 命令）----
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
  $SUDO systemctl daemon-reload && $SUDO systemctl enable --now jobs-control.path >/dev/null 2>&1 && touch "$JOBS_HOME/control/watcher"
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

IP="$( (hostname -I 2>/dev/null | awk '{print $1}') || (ipconfig getifaddr en0 2>/dev/null) || true)"
echo
say "Jobs 装好了。"
echo "  打开：        http://127.0.0.1:$PORT/${IP:+    （局域网：http://$IP:$PORT/）}"
echo "  管理员口令：  $(envv JW_ADMIN_PASSCODE)"
echo "  访客口令：    $(envv JW_PASSCODE)"
echo
if [ -n "$FIRST" ]; then
  echo "  第一次打开，用管理员口令进去，在「模型」里接入一家模型供应商（粘贴 Key、勾选模型、保存）。"
  echo "  然后点右上角「发布」，或者：jobsworld publish <网址> --name <名字> --tagline <一句话>"
fi
case ":$PATH:" in *":$BIN:"*) ;; *) echo "  （命令装在 $BIN，它不在你的 PATH 里：把它加进去，或直接用 $LAUNCH）";; esac
if [ -n "$HOOKED" ]; then echo "  jobs 是 shell 的内建命令，所以往你的 shell 启动文件里加了一个小函数来分流；开一个新终端后生效。脚本里请用 jobsworld。"
else echo "  jobs 是 shell 的内建命令：在终端里请用 jobsworld（两个名字是同一个东西）。"; fi
[ -n "$FIRST" ] || echo "  这是一次重装 / 升级：口令和数据都没有变。"
