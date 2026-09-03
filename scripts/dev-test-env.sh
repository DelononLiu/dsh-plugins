#!/usr/bin/env bash
# 测试环境一键启停：固定矩阵（DSH_HOME/端口/角色），见 AGENTS.md「测试环境」。
# 用法：
#   scripts/dev-test-env.sh start [web2|web3|web4|daemon]   # 启动指定环境（默认全部）
#   scripts/dev-test-env.sh stop  [web2|web3|web4|daemon]   # 停止指定环境（默认全部）
#   scripts/dev-test-env.sh status                          # 查看各环境端口/进程
#
# 🔴 永不触碰正式 ~/.dsh（3080 禁令，见 AGENTS.md）。

set -euo pipefail

# 内核 0.1.2-alpha.5 独立 CLI（测试环境不与正式 ~/.dsh 共用内核；覆盖用 DSH_BIN）。
DSH_BIN="${DSH_BIN:-/home/long2015/dsh-alpha5-cli/node_modules/.bin/dsh}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 环境矩阵：name|DSH_HOME|profile|port|DSH_RELAY_AGENT
# 通信插件部署（三实例联调）：web2/web3/web4 + daemon 连同一 broker（19121，
# 共享 secret——broker 注册表 agent 名唯一）。relay 经 env 注入（channel 兜底）。
ENVS=(
  "web2|$HOME/.dsh-web2|web|3082|web2"
  "web3|$HOME/.dsh-web3|web|3083|web3"
  "web4|$HOME/.dsh-web4|web|3084|web4"
  "daemon|$HOME/.dsh-daemon|daemon|0|host1"
)

# broker 共享配置（与 daemon patch 的 test-secret-relay-2026 一致）。
RELAY_BROKER_URL="http://127.0.0.1:19121"
RELAY_SECRET="test-secret-relay-2026"

find_env() {
  local name="$1"
  for e in "${ENVS[@]}"; do
    IFS='|' read -r n home profile port relay <<< "$e"
    if [[ "$n" == "$name" ]]; then
      echo "$home|$profile|$port|$relay"
      return 0
    fi
  done
  echo "未知环境: $name（可用: web2 web3 web4 daemon）" >&2
  return 1
}

is_running() {
  local home="$1"
  for pid in $(pgrep -f 'dsh --profile' 2>/dev/null || true); do
    local cmd; cmd="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
    # 只认 node 主进程（命令行以 node …/dsh --profile 开头，兼容 .bin/dsh 与 alpha5 CLI）；
    # 排除 bash 包装/gateway 子进程（同样继承 DSH_HOME 且命令行含 --profile，误匹配会 kill 错对象）。
    case "$cmd" in
      node*/dsh*--profile*) ;;
      *) continue ;;
    esac
    if [[ "$(cat /proc/$pid/environ 2>/dev/null | tr '\0' '\n' | grep '^DSH_HOME=' | cut -d= -f2)" == "$home" ]]; then
      echo "$pid"
      return 0
    fi
  done
  return 1
}

start_one() {
  local name="$1"
  local info; info="$(find_env "$name")"
  IFS='|' read -r home profile port relay <<< "$info"
  local pid; pid="$(is_running "$home" || true)"
  if [[ -n "$pid" ]]; then
    echo "[$name] 已在运行 pid=$pid（$home）"
    return 0
  fi
  mkdir -p "$home"
  echo "[$name] 启动：DSH_HOME=$home dsh --profile $profile（port ${port:-headless}）"
  local env_args=()
  if [[ -n "$relay" ]]; then
    # 通信插件部署：relay 三件套（agent/broker/secret）——broker 仅作跨实例传输
    # 兜底（实例发现权威源是管理端 launch 配置，不依赖 broker）。
    env_args+=(
      "DSH_RELAY_AGENT=$relay"
      "DSH_RELAY_BROKER_URL=$RELAY_BROKER_URL"
      "DSH_RELAY_SECRET=$RELAY_SECRET"
    )
  fi
  env DSH_HOME="$home" "${env_args[@]}" nohup "$DSH_BIN" --profile "$profile" > "/tmp/dsh-$name.log" 2>&1 &
}

stop_one() {
  local name="$1"
  local info; info="$(find_env "$name")"
  IFS='|' read -r home profile port relay <<< "$info"
  local pid; pid="$(is_running "$home" || true)"
  if [[ -n "$pid" ]]; then
    echo "[$name] 停止 pid=$pid"
    kill "$pid"
    # 等待优雅退出（gateway/webserver 端口释放），避免紧跟的 start 竞态 bind 失败。
    for _ in $(seq 1 40); do
      is_running "$home" >/dev/null 2>&1 || break
      sleep 0.5
    done
  else
    echo "[$name] 未在运行"
  fi
}

status() {
  echo "环境状态（矩阵见 AGENTS.md「测试环境」）："
  for e in "${ENVS[@]}"; do
    IFS='|' read -r name home profile port relay <<< "$e"
    local pid; pid="$(is_running "$home" || true)"
    local port_txt="headless"
    if [[ "$port" != "0" ]]; then
      port_txt=":$(ss -tln 2>/dev/null | grep ":$port " >/dev/null && echo "$port (监听)" || echo "$port (未监听)")"
    fi
    if [[ -n "$pid" ]]; then
      echo "  $name: RUNNING pid=$pid port$port_txt  $home"
    else
      echo "  $name: stopped  port$port_txt  $home"
    fi
  done
}

main() {
  local cmd="${1:-status}"
  shift || true
  local targets=("${@:-web2 web3 web4 daemon}")
  case "$cmd" in
    start)
      for t in "${targets[@]}"; do start_one "$t"; done
      echo "已请求启动；数秒后 logs 见 /tmp/dsh-<name>.log，端口见 scripts/dev-test-env.sh status"
      ;;
    stop)
      for t in "${targets[@]}"; do stop_one "$t"; done
      ;;
    status)
      status
      ;;
    *)
      echo "用法: $0 {start|stop|status} [web2|web3|web4|daemon ...]" >&2
      exit 2
      ;;
  esac
}

main "$@"
