#!/usr/bin/env bash
# dsh 实例一键启停/重启：按名字动态发现，不写死清单。见 AGENTS.md「测试环境」。
#
# 发现规则（约定）：
#   实例名 → DSH_HOME = ~/.dsh-<实例名>，profile = 同名（per-instance 布局：
#   ~/.dsh-web2/profiles/web2、~/.dsh-web3/profiles/web3 …），
#   dsh --profile <名> 即 boot $DSH_HOME/profiles/<名>。
#   port 从该实例自己的 cordis.patch.yml 读（webserver.config.port）；daemon 无
#   webserver = headless。web2/3/4 内容同源（web 全家桶），目录各归各实例。
#   传名不在 ~/.dsh-<名> 或布局不合法 → 报错退出（不静默别名/不猜）。
#   默认（无参数）= 扫描 ~/.dsh-*/ 下全部 per-instance 布局实例。
#
# 🔴 自操作防护：当前 shell 的 DSH_HOME 就是目标实例时 stop/restart 拒绝
#   （自己杀自己）；在实例环境外（无 DSH_HOME）执行。
# 🔴 永不触碰正式 ~/.dsh（3080 禁令，见 AGENTS.md）。
#
# 用法：
#   scripts/dsh-profile.sh status                              # 扫描全部实例
#   scripts/dsh-profile.sh start|stop|restart <name> [...]     # 操作指定实例（可多个）

set -euo pipefail

# 内核 0.1.2-rc.1 独立 CLI（测试环境不与正式 ~/.dsh 共用内核；覆盖用 DSH_BIN）。
DSH_BIN="${DSH_BIN:-/home/long2015/dsh-alpha5-cli/node_modules/.bin/dsh}"

# broker 共享配置（daemon 与实例 patch 的 test-secret-relay-2026 一致；仅 relay 部署用）。
RELAY_BROKER_URL="http://127.0.0.1:19121"
RELAY_SECRET="test-secret-relay-2026"

# 禁止触碰的正式 home（3080 禁令）。
OFFICIAL_HOME="$HOME/.dsh"

# 从实例自己 cordis.patch.yml 读 webserver.config.port（该段下第一个 port: N）。
# 返回 0=有 port（echo），1=无 webserver（headless，如 daemon）。
read_instance_port() {
  local home="$1" prof="$2" patch="$home/profiles/$prof/cordis.patch.yml"
  [[ -f "$patch" ]] || return 1
  # webserver 段（"- id: webserver"）到下一顶级 "- id:" 之间的 "port: <n>"。
  # awk 程序整体单引号——双引号内 $0 会被外层 shell 展开成空导致语法错。
  awk -v f=0 '
    /^- id: webserver$/ { f=1; next }
    /^- id:/ { if (f) exit }
    f && /^[[:space:]]*port:[[:space:]]*[0-9]+$/ {
      line=$0; gsub(/[^0-9]/,"",line); print line; exit
    }
  ' "$patch"
}
# 解析实例：<name> → 校验布局 → 输出 "home|profile|port(空=daemon|relay"
# relay：daemon 特判 host1；其它 = 实例名（web3 → DSH_RELAY_AGENT=web3）。
# 返回 0=有效（echo 元数据），1=无效（已打印原因）。
resolve_instance() {
  local name="$1"
  local home="$HOME/.dsh-$name"
  if [[ "$home" == "$OFFICIAL_HOME" ]]; then
    echo "[$name] 🔴 拒绝：正式 home（~/.dsh，3080 禁令）" >&2
    return 1
  fi
  [[ -d "$home" ]] || { echo "未知实例: $name（无 $home）" >&2; return 1; }
  local prof="$name"
  [[ -d "$home/profiles/$prof" ]] || {
    echo "[$name] ✗ 布局无效：无 $home/profiles/$prof（per-instance 布局要求 profile 目录名 = 实例名）" >&2
    return 1
  }
  # port：读实例自己 webserver 段；daemon 无 webserver → headless（port 空）。
  local port=""
  if [[ -f "$home/profiles/$prof/cordis.patch.yml" ]]; then
    port="$(read_instance_port "$home" "$prof" 2>/dev/null || true)"
  fi
  local relay="$name"
  [[ "$name" == "daemon" ]] && relay="host1"
  echo "$home|$prof|$port|$relay"
}

# 自操作防护：目标 home == 当前环境 DSH_HOME → 拒绝（stop/restart 会杀掉承载
# 当前命令的实例进程）。返回 0=允许，1=拒绝（已打印原因）。
guard_no_self_operate() {
  local name="$1" home="$2"
  if [[ -n "${DSH_HOME:-}" && "$home" == "$DSH_HOME" ]]; then
    echo "[$name] 🔴 自操作拒绝：当前 shell 的 DSH_HOME（$DSH_HOME）就是目标实例——"
    echo "        stop/restart 会杀掉承载当前命令的进程（自己杀自己）。"
    echo "        请在实例环境外（无 DSH_HOME 的终端）执行，或改用 start/status。"
    return 1
  fi
  return 0
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
  local info; info="$(resolve_instance "$name")" || return 1
  IFS='|' read -r home profile port relay <<< "$info"
  local pid; pid="$(is_running "$home" || true)"
  if [[ -n "$pid" ]]; then
    echo "[$name] 已在运行 pid=$pid（$home）"
    return 0
  fi
  echo "[$name] 启动：DSH_HOME=$home dsh --profile $profile（port ${port:-headless}）"
  local env_args=()
  # relay 三件套：仅通信插件部署（web2/3/4/daemon 经 broker 联调）；作传输兜底
  # （实例发现权威源是管理端 launch 配置，不依赖 broker）。
  env_args+=(
    "DSH_RELAY_AGENT=$relay"
    "DSH_RELAY_BROKER_URL=$RELAY_BROKER_URL"
    "DSH_RELAY_SECRET=$RELAY_SECRET"
  )
  env DSH_HOME="$home" "${env_args[@]}" nohup "$DSH_BIN" --profile "$profile" > "/tmp/dsh-$name.log" 2>&1 &
}

stop_one() {
  local name="$1"
  local info; info="$(resolve_instance "$name")" || return 1
  IFS='|' read -r home profile port relay <<< "$info"
  guard_no_self_operate "$name" "$home" || return 1
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
# stop 后以继承的 env 重启。避免 restart 后 GUI 模型失效（早期手动带 key 启动的原因）。
restart_one() {
  local name="$1"
  local info; info="$(resolve_instance "$name")" || return 1
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
  env_args+=(
    "DSH_RELAY_AGENT=$relay"
    "DSH_RELAY_BROKER_URL=$RELAY_BROKER_URL"
    "DSH_RELAY_SECRET=$RELAY_SECRET"
  )
  echo "[$name] 重启：DSH_HOME=$home dsh --profile $profile（port ${port:-headless}）"
  env DSH_HOME="$home" "${inherit[@]}" "${env_args[@]}" nohup "$DSH_BIN" --profile "$profile" > "/tmp/dsh-$name.log" 2>&1 &
}

# 扫描 ~/.dsh-*/ 下全部 per-instance 布局实例（~/.dsh-<名>/profiles/<名>），按名排序。
list_instances() {
  for d in "$HOME"/.dsh-*; do
    [[ -d "$d" ]] || continue
    local name; name="$(basename "$d")"; name="${name#.dsh-}"
    [[ "$name" == "dsh" || -z "$name" ]] && continue
    # 只认 per-instance 布局；老布局（profiles/web）不列（resolve 时会提示）。
    [[ -d "$d/profiles/$name" ]] && echo "$name"
  done | sort
}

status() {
  echo "实例状态（动态扫描 ~/.dsh-<名>/profiles/<名>，见 AGENTS.md「测试环境」）："
  local any=0
  for name in $(list_instances); do
    any=1
    local info; info="$(resolve_instance "$name")" || continue
    IFS='|' read -r home profile port relay <<< "$info"
    local pid; pid="$(is_running "$home" || true)"
    local port_txt="headless"
    if [[ -n "$port" ]]; then
      port_txt=":$(ss -tln 2>/dev/null | grep ":$port " >/dev/null && echo "$port (监听)" || echo "$port (未监听)")"
    fi
    if [[ -n "$pid" ]]; then
      echo "  $name: RUNNING pid=$pid port$port_txt  $home"
    else
      echo "  $name: stopped  port$port_txt  $home"
    fi
  done
  [[ $any -eq 1 ]] || echo "  （无 per-instance 布局实例：$HOME 下未见 ~/.dsh-<名>/profiles/<名>）"
}

main() {
  local cmd="${1:-status}"
  shift || true
  local targets=()
  if [[ $# -eq 0 ]]; then
    targets=(daemon web2 web3 web4)   # status/默认操作仅知名实例集（避免误碰 web5 等开发目录）
    # 注：无参数时操作哪些实例——daemon/web2/3/4 是"已知矩阵"；其余实例需显式点名。
  else
    targets=("$@")
  fi
  case "$cmd" in
    start)
      for t in "${targets[@]}"; do start_one "$t"; done
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
      echo "用法: $0 {start|stop|restart|status} [<实例名> ...]   # 如 dsh-profile.sh restart web2 web77" >&2
      echo "      实例 = ~/.dsh-<名>/profiles/<名>（per-instance 布局）；不写死清单。" >&2
      exit 2
      ;;
  esac
}

main "$@"
