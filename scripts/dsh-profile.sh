#!/usr/bin/env bash
# dsh 测试实例一键启停/重启：固定矩阵（实例/DSH_HOME/端口/角色），见 AGENTS.md「测试环境」。
#
# 命名（两层，勿混）：
#   profile 目录名 = 实例名：每个实例在自家 DSH_HOME 下持有一份以自己命名的 profile
#                   （~/.dsh-web2/profiles/web2、~/.dsh-web3/profiles/web3 …），
#                   dsh --profile <名> 即 boot $DSH_HOME/profiles/<名>；web2/3/4 内容
#                   同源（web 全家桶），目录各归各实例——console launch 逐实例指向、各自补丁。
#   实例名        = 数据根 DSH_HOME 目录后缀（~/.dsh-<实例名>）。
# 本脚本参数 = **实例名**（web2/web3/web4/daemon）；"web" 是 web2 的日常简称（管理端）。
#   dsh-profile.sh restart web    # = 重启 web2（管理端 console，3082）
#   dsh-profile.sh start daemon   # = 启动守护宿主（daemon profile，headless）
# 默认（无参数）= 全部实例。
#
# 日志落盘：各实例自己的 DSH_HOME 下（~/.dsh-web2/console.log、~/.dsh-daemon/daemon.log…），
# 由 dsh-console 按 roleDataRoot(process.env.DSH_HOME) 解析，天然隔离。
#
# 🔴 永不触碰正式 ~/.dsh（3080 禁令，见 AGENTS.md）。

set -euo pipefail

# 内核 0.1.2-rc.1 独立 CLI（测试环境不与正式 ~/.dsh 共用内核；覆盖用 DSH_BIN）。
DSH_BIN="${DSH_BIN:-/home/long2015/dsh-alpha5-cli/node_modules/.bin/dsh}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 环境矩阵：name|DSH_HOME|profile|port|DSH_RELAY_AGENT
# profile = 实例名（profile 目录名 = 实例名，彻底隔离：~/.dsh-web2/profiles/web2 等，
# dsh --profile <名> 即 boot $DSH_HOME/profiles/<名>；发行包模板（profiles/web 等）是
# 另一层命名，勿混）。
# 通信插件部署（三实例联调）：web2/web3/web4 + daemon 连同一 broker（19121，
# 共享 secret——broker 注册表 agent 名唯一）。relay 经 env 注入（channel 兜底）。
ENVS=(
  "web2|$HOME/.dsh-web2|web2|3082|web2"
  "web3|$HOME/.dsh-web3|web3|3083|web3"
  "web4|$HOME/.dsh-web4|web4|3084|web4"
  "daemon|$HOME/.dsh-daemon|daemon|0|host1"
)

# broker 共享配置（与 daemon patch 的 test-secret-relay-2026 一致）。
RELAY_BROKER_URL="http://127.0.0.1:19121"
RELAY_SECRET="test-secret-relay-2026"

# 实例名 → 规范实例名：web（日常叫法）= web2（管理端实例）；web2/3/4/daemon 原样。
# 注意：web 是 web2 的简称；web2/3/4 的 profile 目录名 = 实例名（profiles/web2 等）。
canonical() {
  case "$1" in
    web) echo web2 ;;
    web2|web3|web4|daemon) echo "$1" ;;
    *) echo "" ;;
  esac
}

find_env() {
  local name="$1"
  for e in "${ENVS[@]}"; do
    IFS='|' read -r n home profile port relay <<< "$e"
    if [[ "$n" == "$name" ]]; then
      echo "$home|$profile|$port|$relay"
      return 0
    fi
  done
  echo "未知环境: $name（可用: web(=web2) web3 web4 daemon）" >&2
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
  echo "[$name] 启动：DSH_HOME=$home dsh --profile $profile（port ${port:-headless}）  ← 实例 $name 用 $profile 模板"
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

# 重启：保留旧进程的关键 env（KILO_API_KEY 等——GUI LLM provider 依赖，脚本不硬编码），
# stop 后以继承的 env 重启。避免 `restart web2` 后 GUI 模型失效（早期手动带 key 启动的原因）。
restart_one() {
  local name="$1"
  local info; info="$(find_env "$name")"
  IFS='|' read -r home profile port relay <<< "$info"
  local pid; pid="$(is_running "$home" || true)"
  local -a inherit=()
  if [[ -n "$pid" ]]; then
    # 收集旧进程自定义 env（DSH_HOME/relay 三件套除外——脚本自己管理），
    # 以 VAR=value 形式继承。只挑显式赋值项，避开 PATH/HOME 等自动变量噪音。
    while IFS= read -r kv; do
      inherit+=("$kv")
    done < <(tr '\0' '\n' < "/proc/$pid/environ" 2>/dev/null \
      | grep -E '^[A-Za-z_][A-Za-z0-9_]*=' \
      | grep -vE '^(DSH_HOME|DSH_RELAY_AGENT|DSH_RELAY_BROKER_URL|DSH_RELAY_SECRET|PWD|SHLVL|_|PATH|HOME|USER|SHELL|LANG|LOGNAME|TERM|SSH_|DISPLAY|XDG_|DBUS_|CLAUDE_)=' \
      || true)
    echo "[$name] 继承旧进程 env: ${inherit[*]:-（无额外）}"
  fi
  stop_one "$name"
  local env_args=()
  if [[ -n "$relay" ]]; then
    env_args+=( "DSH_RELAY_AGENT=$relay" "DSH_RELAY_BROKER_URL=$RELAY_BROKER_URL" "DSH_RELAY_SECRET=$RELAY_SECRET" )
  fi
  mkdir -p "$home"
  echo "[$name] 重启：DSH_HOME=$home dsh --profile $profile（port ${port:-headless}）  ← 实例 $name 用 $profile 模板"
  env DSH_HOME="$home" "${inherit[@]}" "${env_args[@]}" nohup "$DSH_BIN" --profile "$profile" > "/tmp/dsh-$name.log" 2>&1 &
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
      echo "  $name: RUNNING pid=$pid port$port_txt  $home（profile $profile）"
    else
      echo "  $name: stopped  port$port_txt  $home（profile $profile）"
    fi
  done
}

main() {
  local cmd="${1:-status}"
  shift || true
  # 参数规范化：web → web2；非法名报错。缺省 = 全部（web2 web3 web4 daemon）。
  local targets=()
  if [[ $# -eq 0 ]]; then
    targets=(web2 web3 web4 daemon)
  else
    for raw in "$@"; do
      local c; c="$(canonical "$raw")"
      if [[ -z "$c" ]]; then
        echo "未知环境: $raw（可用: web web2 web3 web4 daemon）" >&2
        exit 2
      fi
      targets+=("$c")
    done
  fi
  case "$cmd" in
    start)
      for t in "${targets[@]}"; do start_one "$t"; done
      echo "已请求启动；数秒后 logs 见 /tmp/dsh-<name>.log，状态见 scripts/dsh-profile.sh status"
      ;;
    stop)
      for t in "${targets[@]}"; do stop_one "$t"; done
      ;;
    restart)
      for t in "${targets[@]}"; do restart_one "$t"; done
      ;;
    status)
      status
      ;;
    *)
      echo "用法: $0 {start|stop|restart|status} [web|web2|web3|web4|daemon ...]   # web = web2（管理端实例）" >&2
      exit 2
      ;;
  esac
}

main "$@"
