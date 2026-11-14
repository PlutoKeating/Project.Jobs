#!/usr/bin/env bash
# 下载社区 Terraria 蓝图 / 地图到 data/community/（已被 .gitignore 忽略，不入库、不分发）。
# 这些素材大多没有明确许可证（法律上即“保留所有权利”）。按项目决定：只允许在本机下载使用，
# 不得提交到仓库、不得打进镜像、不得对外分发。需要入库的地标请自制后放到 game/schematics/。
#
# 用法：scripts/download-community-assets.sh [all|tedit|ceteris]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$ROOT/data/community"
WHAT="${1:-all}"
mkdir -p "$DEST"

need() { command -v "$1" >/dev/null 2>&1 || { echo "缺少命令：$1" >&2; exit 1; }; }
need git

# 浅克隆 + 稀疏检出，只拉需要的目录；已存在则更新
sparse_clone() {
  local url="$1" dir="$2"; shift 2
  if [ -d "$dir/.git" ]; then
    git -C "$dir" pull --ff-only --depth 1 >/dev/null 2>&1 || echo "  （更新失败，保留已有内容）"
  else
    rm -rf "$dir"
    git clone --depth 1 --filter=blob:none --sparse "$url" "$dir" >/dev/null
  fi
  git -C "$dir" sparse-checkout set --no-cone "$@" >/dev/null
}

if [ "$WHAT" = "all" ] || [ "$WHAT" = "tedit" ]; then
  echo "→ TEdit（MS-PL）：示例蓝图与测试用 .TEditSch"
  need curl
  mkdir -p "$DEST/tedit"
  # TEdit 仓库很大，只按文件下载
  base=https://raw.githubusercontent.com/TEdit/Terraria-Map-Editor/main
  for f in LICENSE schematics/Castle.TEditHGSch schematics/SampleHouse.TEditHGSch \
           src/TEdit.Tests/WorldFiles/modloader-chest.TEditSch src/TEdit.Tests/WorldFiles/modloader-chest-fixed.TEditSch; do
    curl -fsSL --retry 3 -o "$DEST/tedit/$(basename "$f")" "$base/$f" || echo "  下载失败：$f"
  done
fi

if [ "$WHAT" = "all" ] || [ "$WHAT" = "ceteris" ]; then
  echo "→ CeterisParibus51/51s-Terraria-TEdit-Schematics（无明确许可证，仅本机使用）"
  sparse_clone https://github.com/CeterisParibus51/51s-Terraria-TEdit-Schematics.git "$DEST/51s-schematics" '/*'
fi

cat > "$DEST/README.txt" <<'TXT'
本目录由 scripts/download-community-assets.sh 生成，内容来自第三方社区仓库。
多数素材没有明确许可证：只可在本机使用，不得提交、不得打进镜像、不得分发。
TXT

count=$(find "$DEST" -iname '*.TEditSch' | wc -l | tr -d ' ')
echo "完成：$DEST 下共有 $count 个 .TEditSch 文件"
echo "提示：要在本机游戏服里使用，可把单个文件复制到 TShock 容器的 /server/schematics/（docker cp），"
echo "      再在城镇布局里加 { t: 'schematic', file: '文件名.TEditSch', x, y } 图元。"
