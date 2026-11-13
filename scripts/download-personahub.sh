#!/usr/bin/env bash
# 下载 PersonaHub 小子集（约 1 万条）到 data/seeds/personahub.jsonl（不入库）
# 数据集：https://huggingface.co/datasets/proj-persona/PersonaHub （CC-BY-NC-SA-4.0，仅用于研究与内部测试）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/data/seeds"; mkdir -p "$OUT"
N="${1:-10000}"
URL="https://huggingface.co/datasets/proj-persona/PersonaHub/resolve/main/persona.jsonl"
echo "下载 $URL 的前 $N 行 …"
curl -fsSL "$URL" | head -n "$N" > "$OUT/personahub.jsonl" || true
wc -l "$OUT/personahub.jsonl"
