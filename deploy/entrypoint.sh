#!/bin/sh
# 容器入口：先把数据库迁移到位、让随包居民住进城里（都可重复执行），再启动世界服务、接口、网关（以及示例产品）
set -e
cd /app
echo "[jobs] 准备数据库与居民…"
n=0
until node_modules/.bin/tsx apps/cli/src/index.ts init --no-demos; do
  n=$((n + 1)); [ "$n" -ge 20 ] && { echo "[jobs] 初始化一直失败，退出"; exit 1; }
  echo "[jobs] 依赖服务还没就绪，5 秒后重试（$n/20）"; sleep 5
done
exec node scripts/jobsworld.mjs
