#!/bin/sh
# 生成 TShock 配置（每次启动按环境变量覆盖），首次启动自动生成小世界
set -e
DATA=/data
mkdir -p "$DATA/tshock" "$DATA/worlds" "$DATA/logs"
WORLD_NAME="${JW_WORLD_NAME:-JobsWorld}"
WORLD_FILE="$DATA/worlds/${JW_WORLD_FILE:-jobsworld}.wld"
# JSON 字符串转义（口令里可能有引号或反斜杠）
esc() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

cat > "$DATA/tshock/config.json" <<JSON
{
  "Settings": {
    "ServerPassword": "$(esc "${JW_GAME_PASSWORD:-}")",
    "ServerPort": 7777,
    "MaxSlots": ${JW_MAX_PLAYERS:-16},
    "ReservedSlots": 0,
    "ServerName": "$(esc "$WORLD_NAME")",
    "UseServerName": true,
    "AutoSave": true,
    "AnnounceSave": false,
    "ShowBackupAutosaveMessages": false,
    "BackupInterval": 0,
    "DefaultMaximumSpawns": 0,
    "DefaultSpawnRate": 2000000,
    "PvPMode": "disabled",
    "SpawnProtection": false,
    "DisableBuild": true,
    "DisableHardmode": true,
    "DisableDungeonGuardian": true,
    "DisableTombstones": true,
    "DisableClownBombs": true,
    "DisableInvisPvP": true,
    "AllowCrimsonCreep": false,
    "AllowCorruptionCreep": false,
    "AllowHallowCreep": false,
    "EnableGeoIP": false,
    "KickProxyUsers": false,
    "RestApiEnabled": false
  }
}
JSON

exec /server/TShock.Server \
  -configpath "$DATA/tshock" \
  -logpath "$DATA/logs" \
  -crashdir "$DATA/logs" \
  -worldselectpath "$DATA/worlds" \
  -world "$WORLD_FILE" \
  -autocreate "${JW_WORLD_SIZE:-1}" \
  -worldname "$WORLD_NAME" \
  -port 7777 \
  "$@"
