#!/bin/sh
# 每次启动：安装镜像里的 JobsWorld.tmod 并启用，按环境变量生成 serverconfig，首次启动自动生成小世界（mod 的平坦世界生成）
set -e
DATA=/data
SAVE="$DATA/tModLoader"
mkdir -p "$SAVE/Mods" "$SAVE/Worlds" "$DATA/logs"
cp -f /opt/jobsworld/JobsWorld.tmod "$SAVE/Mods/JobsWorld.tmod"
echo '["JobsWorld"]' > "$SAVE/Mods/enabled.json"

WORLD_NAME="${JW_WORLD_NAME:-JobsWorld}"
WORLD_FILE="$SAVE/Worlds/${JW_WORLD_FILE:-jobsworld}.wld"
# serverconfig 为逐行 key=value，去掉口令里的换行
PASS="$(printf '%s' "${JW_GAME_PASSWORD:-}" | tr -d '\r\n')"

cat > "$DATA/serverconfig.txt" <<CFG
world=$WORLD_FILE
worldpath=$SAVE/Worlds
autocreate=${JW_WORLD_SIZE:-1}
worldname=$WORLD_NAME
difficulty=0
maxplayers=${JW_MAX_PLAYERS:-16}
port=7777
password=$PASS
motd=JobsWorld
secure=0
upnp=0
npcstream=60
priority=1
CFG

# 日志写到数据卷
ln -sfn "$DATA/logs" /tml/tModLoader-Logs 2>/dev/null || true

exec dotnet /tml/tModLoader.dll -server \
  -config "$DATA/serverconfig.txt" \
  -tmlsavedirectory "$SAVE" \
  "$@"
