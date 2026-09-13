#!/usr/bin/env bash
# scripts/dsh-run-fg.sh — 前台运行一个 dsh 实例并捕获退出原因（stdout + 进程信号）。
#
# 背景：dsh-profile.sh start/restart 用 nohup 后台跑并把输出重定向到
# /tmp/dsh-<名>.log，子进程是被信号杀死还是自己退出、被谁杀，后台模型吞掉了信号，
# 查"web2 为何总断"困难。本脚本改为**前台**跑：子进程以我们可见的方式退出，
# 用 `wait` 拿它的真实退出状态（0=正常；>128 = 128+致死信号号），并把信号名、
# 存活时长、退出瞬间日志尾部一并打出来。
#
# 用法：
#   scripts/dsh-run-fg.sh <实例名> [--log <文件>]   # 前台跑，Ctrl-C 停止
#   scripts/dsh-run-fg.sh <实例名> --loop            # 自动重启循环，每次退出上报一次
#   scripts/dsh-run-fg.sh --dry-run web2             # 只解析并打印将执行的命令，不启动
#
# 防护与 dsh-profile.sh 一致：
#   - 目标 home == 当前 shell 的 DSH_HOME → 拒绝（自操作，会杀掉承载本命令的实例）。
#   - 正式 ~/.dsh（web，3080 禁令）→ 拒绝。
#   - 目标已在运行 → 拒绝（端口冲突；先 stop 再前台观察）。

set -u

DSH_BIN="${DSH_BIN:-/home/long2015/dsh-alpha5-cli/node_modules/.bin/dsh}"
RELAY_BROKER_URL="http://127.0.0.1:19121"
RELAY_SECRET="test-secret-relay-2026"
OFFICIAL_HOME="$HOME/.dsh"

usage() {
  echo "用法: $0 <实例名> [--log <文件>] [--loop]     # e.g. $0 web2"
  echo "      $0 --dry-run <实例名>"
  exit 0
}

# 从实例自己 cordis.patch.yml 的 webserver 段读 port（daemon 无 webserver → 空）。
read_port() {
  local home="$1" prof="$2" patch="$home/profiles/$prof/cordis.patch.yml"
  [[ -f "$patch" ]] || return 0
  awk -v f=0 '/^- id: webserver$/ { f=1; next }
    /^- id:/ { if (f) exit }
    f && /^[[:space:]]*port:[[:space:]]*[0-9]+$/ {
      gsub(/[^0-9]/,"",$0); print; exit
    }' "$patch"
}

# 解析实例名 → home|profile|port|relay；rc=0 有效 / 1 无效（原因已打印到 stderr）。
resolve() {
  local name="$1" home="$HOME/.dsh-$name" prof="$name"
  [[ "$name" == "web" ]] && { home="$OFFICIAL_HOME"; prof="web"; }
  if [[ "$home" == "$OFFICIAL_HOME" ]]; then
    echo "[$name] 🔴 拒绝：正式 home（~/.dsh，3080 禁令）" >&2; return 1
  fi
  [[ -d "$home" ]] || { echo "未知实例: $name（无 $home）" >&2; return 1; }
  [[ -d "$home/profiles/$prof" ]] || {
    echo "[$name] ✗ 布局无效：无 $home/profiles/$prof" >&2; return 1
  }
  local port; port="$(read_port "$home" "$prof")"
  local relay="$name"; [[ "$name" == "daemon" ]] && relay="host-master"
  echo "$home|$prof|$port|$relay"
}

# 是否已有该 home 的 dsh 进程在跑（仅认 node 主进程，排除 bash/gateway 子进程）。
is_running() {
  local home="$1"
  for pid in $(pgrep -f 'dsh --profile' 2>/dev/null || true); do
    local cmd; cmd="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
    case "$cmd" in node*/dsh*--profile*) ;; *) continue ;; esac
    if [[ "$(tr '\0' '\n' < "/proc/$pid/environ" 2>/dev/null | grep '^DSH_HOME=' | cut -d= -f2)" == "$home" ]]; then
      echo "$pid"; return 0
    fi
  done
  return 1
}

# 退出状态解码：<code> <uptime_s> → 打人类可读的退出原因。
report_exit() {
  local code="$1" up="$2"
  local reason
  if [[ "$code" -eq 0 ]]; then
    reason="正常退出（exit 0）"
  elif [[ "$code" -gt 128 ]]; then
    local sig=$((code - 128))
    local signame; signame="$(kill -l "$sig" 2>/dev/null || echo "信号#$sig")"
    reason="被信号杀死：$signame（SIG$sig，退出码 $code）"
  else
    reason="异常退出：exit $code"
  fi
  echo "═══ [$name] 进程结束：${reason} · 存活 ${up}s ═══"
}

# 前台跑一次实例；退出后 report_exit。rc 返回子进程退出码。
run_once() {
  local home="$1" profile="$2" port="$3" relay="$4" log="${5:-}"
  local start; start="$(date +%s)"
  echo "[$name] 启动：DSH_HOME=$home dsh --profile $profile（port ${port:-headless}） → ${log:-终端}"
  local cmd=()
  if [[ -n "$log" ]]; then
    # 输出落文件；用 tail --pid 跟随实时打到终端，直到子进程退出。
    env DSH_HOME="$home" DSH_RELAY_AGENT="$relay" DSH_RELAY_BROKER_URL="$RELAY_BROKER_URL" \
      DSH_RELAY_SECRET="$RELAY_SECRET" "$DSH_BIN" --profile "$profile" >"$log" 2>&1 &
    local pid=$!
    tail --pid="$pid" -n +1 -f "$log" &
    local tailpid=$!
    wait "$pid"; local code=$?
    kill "$tailpid" 2>/dev/null
    wait "$tailpid" 2>/dev/null
  else
    env DSH_HOME="$home" DSH_RELAY_AGENT="$relay" DSH_RELAY_BROKER_URL="$RELAY_BROKER_URL" \
      DSH_RELAY_SECRET="$RELAY_SECRET" "$DSH_BIN" --profile "$profile" &
    local pid=$!
    wait "$pid"; local code=$?
  fi
  local up=$(( $(date +%s) - start ))
  report_exit "$code" "$up"
  return "$code"
}

# ---- 参数解析 ----
name=""; log=""; loop=0; dry=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --log) log="${2:-}"; shift 2 ;;
    --loop) loop=1; shift ;;
    --dry-run) dry=1; shift ;;
    -h|--help) usage ;;
    *) name="$1"; shift ;;
  esac
done
[[ -n "$name" ]] || usage

info="$(resolve "$name")" || exit 1
IFS='|' read -r home profile port relay <<< "$info"

# 自操作防护：目标 == 当前 shell 的 DSH_HOME → 拒绝（本脚本前台跑，会杀掉承载自身）。
if [[ -n "${DSH_HOME:-}" && "$home" == "$DSH_HOME" ]]; then
  echo "[$name] 🔴 自操作拒绝：当前 shell 的 DSH_HOME（$DSH_HOME）就是目标实例——"
  echo "        前台跑会杀掉承载当前命令的进程。请在实例环境外（无 DSH_HOME 的终端）执行。"
  exit 1
fi

if [[ "$dry" -eq 1 ]]; then
  echo "[$name] --dry-run：将执行 →"
  echo "  env DSH_HOME=$home DSH_RELAY_AGENT=$relay DSH_RELAY_BROKER_URL=$RELAY_BROKER_URL DSH_RELAY_SECRET=$RELAY_SECRET $DSH_BIN --profile $profile"
  echo "  （port ${port:-headless}；log=${log:-终端}；loop=${loop}）"
  exit 0
fi

pid="$(is_running "$home" || true)"
if [[ -n "$pid" ]]; then
  echo "[$name] 🔴 已在运行 pid=$pid（$home）——前台观察需先 stop。或直接看 /tmp/dsh-$name.log。"
  exit 1
fi

# 前台观察：默认不自动重启；--loop 则崩溃后自动重拉并每次上报。
[[ "$loop" -eq 0 ]] && { run_once "$home" "$profile" "$port" "$relay" "$log"; exit $?; }
while :; do
  run_once "$home" "$profile" "$port" "$relay" "$log"
  code=$?
  if [[ "$code" -eq 0 ]]; then
    echo "[$name] 正常退出（--loop）——不再自动重启；Ctrl-C 可随时停。"
    exit 0
  fi
  echo "[$name] （--loop）5s 后自动重启…"
  sleep 5
done
