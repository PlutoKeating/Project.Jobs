# JobsWorld tModLoader 服务端（tModLoader 稳定版，Terraria 1.4.4 客户端 + tModLoader 可连）
# 构建上下文为仓库根目录：docker compose --profile game build tml
#
# 阶段 1：下载 tModLoader 发布包，用它自带的 Roslyn 编译 mod（-build 会把源码目录里的全部 .cs 编译进 JobsWorld.tmod，
#        所以先把 game/shared 复制到 mod 源码目录的 Shared/ 下；不需要 .NET SDK）
FROM mcr.microsoft.com/dotnet/runtime:8.0 AS build
ARG TML_VERSION=v2026.09.3.1
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl unzip && rm -rf /var/lib/apt/lists/*
WORKDIR /tml
RUN curl -fsSL --retry 5 -o /tmp/tml.zip "https://github.com/tModLoader/tModLoader/releases/download/${TML_VERSION}/tModLoader.zip" \
 && unzip -q /tmp/tml.zip -d /tml && rm -f /tmp/tml.zip \
 && rm -rf /tml/DedicatedServerUtils /tml/*.bat /tml/LaunchUtils/*.exe /tml/LaunchUtils/*.bat \
 && test -f /tml/tModLoader.dll
COPY game/tmodloader/JobsWorld /src/JobsWorld
COPY game/shared /src/JobsWorld/Shared
RUN find /src/JobsWorld -type d \( -name bin -o -name obj \) -prune -exec rm -rf {} + \
 && dotnet tModLoader.dll -server -build /src/JobsWorld -tmlsavedirectory /build-save 2>&1 | grep -v CS8632 \
 && test -f /build-save/Mods/JobsWorld.tmod

# 阶段 2：运行时
FROM mcr.microsoft.com/dotnet/runtime:8.0
WORKDIR /tml
COPY --from=build /tml/ /tml/
COPY --from=build /build-save/Mods/JobsWorld.tmod /opt/jobsworld/JobsWorld.tmod
COPY game/schematics/ /opt/jobsworld/schematics/
COPY infra/game/tmodloader/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && mkdir -p /data
ENV JW_SCHEMATICS_DIR=/opt/jobsworld/schematics \
    DOTNET_gcServer=0
VOLUME ["/data"]
EXPOSE 7777
ENTRYPOINT ["/entrypoint.sh"]
