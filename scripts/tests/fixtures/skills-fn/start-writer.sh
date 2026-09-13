#!/usr/bin/env bash
# 在 phase0-contaminated 现场启动一个**并发写者**：每 2 秒改一次 src/calc.mjs。
# Phase 0 闸门必须能发现"还有人在写这个目录"，否则它判"干净"就是误判。
#
# 用法：bash scripts/tests/fixtures/skills-fn/start-writer.sh <现场目录> [持续秒数，默认 600]
set -uo pipefail
SCENE="${1:?用法: start-writer.sh <现场目录> [秒数]}"
DURATION="${2:-600}"
LOG="${TMPDIR:-/tmp}/dsh-skills-fn-writer.log"

nohup bash -c '
  scene="$1"; dur="$2"; end=$(( $(date +%s) + dur ))
  while [ "$(date +%s)" -lt "$end" ]; do
    echo "// 在途改动 $(date +%T)" >> "$scene/src/calc.mjs"
    sleep 2
  done
' _ "$SCENE" "$DURATION" >"$LOG" 2>&1 &
echo "并发写者 pid=$! 现场=$SCENE 时长=${DURATION}s 日志=$LOG"
echo "停止：kill $!"
