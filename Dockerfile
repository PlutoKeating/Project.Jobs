# Jobs：我们自己的代码都在这一个镜像里（世界服务 + 接口 + 网页 + 单端口网关 + 命令行），外加它驱动的浏览器。
# 数据库、对象存储、事件总线用各自的标准镜像，见 deploy/compose.yml。
#   docker build -t jobs:local .
FROM node:24-bookworm-slim

# corepack 把 pnpm 放在 COREPACK_HOME：不放在 /root/.cache 下面（下面会清掉它），否则每次启动容器都要重新从 npm 下载 pnpm
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH \
    COREPACK_HOME=/corepack COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PUX_DATA_DIR=/data \
    JOBS_IN_CONTAINER=1

# ffmpeg：录像与摄像头 / 麦克风素材；espeak-ng：没有接入语音合成模型时的本机合成；中文与表情字体：截图里的字要和真人看到的一样
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl tini ffmpeg espeak-ng fonts-noto-cjk fonts-noto-color-emoji \
 && (command -v espeak >/dev/null || ln -s "$(command -v espeak-ng)" /usr/local/bin/espeak) \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable

WORKDIR /app
# 先只拿锁文件：依赖和浏览器各占一层，只改代码时这两层不用重来
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# pnpm 12 第一次运行时还会下载自己的原生二进制（也放在 COREPACK_HOME 里），所以这里先跑一次
RUN corepack install && pnpm --version \
 && pnpm fetch \
 && PW="$(grep -oE "^ +'?playwright@[0-9]+\.[0-9]+\.[0-9]+" pnpm-lock.yaml | grep -oE 'playwright@.*' | head -1)" && test -n "$PW" \
 && npx -y "$PW" install --with-deps chromium \
 && rm -rf /root/.npm /var/lib/apt/lists/*

COPY . .
RUN pnpm install --offline --frozen-lockfile \
 && pnpm web:build \
 && chmod +x deploy/entrypoint.sh deploy/jobs \
 && rm -rf /root/.cache \
 && mkdir -p /data

# 运行时不许 corepack 联网：pnpm 已经在镜像里了，缺了就该在这里失败，而不是启动时悄悄去下载
ENV COREPACK_ENABLE_NETWORK=0
RUN pnpm --version

VOLUME ["/data"]
EXPOSE 7777
HEALTHCHECK --interval=15s --timeout=5s --start-period=120s --retries=8 CMD curl -fsS "http://127.0.0.1:${API_PORT:-5320}/healthz" || exit 1
ENTRYPOINT ["tini", "--", "/app/deploy/entrypoint.sh"]
