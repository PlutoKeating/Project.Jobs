# JobsWorld TShock 服务端（原版 Terraria 1.4.5.8 客户端可连）
# 构建上下文为仓库根目录：docker compose --profile game build tshock
#
# 阶段 1：下载 TShock 发布包并编译 game/tshock 插件（引用发布包中的 TShockAPI / OTAPI / TerrariaServer）
FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
ARG TSHOCK_VERSION=6.2.1
ARG TERRARIA_VERSION=1.4.5.8
# 构建平台由 buildx 给出（amd64 / arm64），对应 TShock 发布包里的 linux-x64 / linux-arm64
ARG TARGETARCH
RUN apt-get update && apt-get install -y --no-install-recommends unzip && rm -rf /var/lib/apt/lists/*
WORKDIR /tshock
RUN case "${TARGETARCH:-$(dpkg --print-architecture)}" in amd64) RID=linux-x64;; arm64) RID=linux-arm64;; *) echo "不支持的架构 ${TARGETARCH}" >&2; exit 1;; esac \
 && curl -fsSL --retry 5 -o tshock.zip "https://github.com/Pryaxis/TShock/releases/download/v${TSHOCK_VERSION}/TShock-${TSHOCK_VERSION}-for-Terraria-${TERRARIA_VERSION}-${RID}-Release.zip" \
 && unzip -q tshock.zip && tar -xf TShock-*-${RID}-Release.tar && rm -f tshock.zip TShock-*-${RID}-Release.tar \
 && test -f ServerPlugins/TShockAPI.dll && test -f bin/OTAPI.dll
WORKDIR /src
COPY game/shared game/shared
COPY game/tshock game/tshock
RUN rm -rf game/tshock/bin game/tshock/obj \
 && dotnet build game/tshock/JobsWorld.TShock.csproj -c Release -p:TShockDir=/tshock/ -o /out

# 阶段 2：运行时（TShock.Server 为依赖 .NET 9 运行时的单文件程序）
FROM mcr.microsoft.com/dotnet/runtime:9.0
WORKDIR /server
COPY --from=build /tshock/ ./
COPY --from=build /out/JobsWorld.dll ./ServerPlugins/
COPY game/schematics/ ./schematics/
COPY infra/game/tshock/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh ./TShock.Server && mkdir -p /data
ENV JW_SCHEMATICS_DIR=/server/schematics \
    DOTNET_gcServer=0
VOLUME ["/data"]
EXPOSE 7777
ENTRYPOINT ["/entrypoint.sh"]
