#!/usr/bin/env bash
# dsh 实例一键启停/重启：实例清单读**注册表**，不扫描目录。见 AGENTS.md「测试环境」。
#
# 权威源（约定）：`~/.dsh-home/registry.json`（覆盖用 DSH_REGISTRY）——实例清单的**唯一入口**，
#   主键 `<host>/<id>`，字段见 scripts/dsh-registry.mjs。运行时**不做目录扫描**：
#   老实例（`~/.dsh-<名>` per-instance 布局、自带安装）由一次显式 `import` 登记；
#   新实例（`~/.dsh-home/instance-<名>`、引用 runtime 池）由创建流程登记。
#   port 从该实例自己的 cordis.patch.yml 读（webserver.config.port）；无 webserver = headless。
#   未在注册表 → 报错退出（不静默别名/不猜）。
#
# 🔴 自操作防护：当前 shell 的 DSH_HOME 就是目标实例时 stop/restart 拒绝
#   （自己杀自己）；在实例环境外（无 DSH_HOME）执行。
# 🔴 会话变量清洗：启动环境剔除 DSH_SESSION_ID/DSH_SESSION_JSONL/DSH_SHELL/
#   DSH_WEB_URL/DSH_WEB_MODE（调用方 env 与旧进程继承两条路径都过滤）——这类变量
#   由 DSH 在 agent 会话内注入，带进别的实例会让它指向别的实例的会话与 home，
#   破坏「测试环境目录隔离」。
# ✅ restart 等待就绪：进程在 + 端口监听（headless 只看进程），超时打印日志尾部并非零退出。
# 🔴 永不触碰正式 ~/.dsh（3080 禁令，见 AGENTS.md）。
#
# 用法：
#   scripts/dsh-profile.sh status                              # 列出注册表内全部实例
#   scripts/dsh-profile.sh import                              # 显式登记现有实例（幂等）
#   scripts/dsh-profile.sh resolve <name>                      # 打印解析结果（排障/测试用）
#   scripts/dsh-profile.sh start|stop|restart <name> [...]     # 操作指定实例（可多个）

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REGISTRY_CLI="$SCRIPT_DIR/dsh-registry.mjs"

# 内核 0.1.2-rc.1 独立 CLI（测试环境不与正式 ~/.dsh 共用内核；覆盖用 DSH_BIN）。
DSH_BIN="${DSH_BIN:-/home/long2015/dsh-alpha5-cli/node_modules/.bin/dsh}"

# broker 共享配置（daemon 与实例 patch 的 test-secret-relay-2026 一致；仅 relay 部署用）。
RELAY_BROKER_URL="http://127.0.0.1:19121"
RELAY_SECRET="test-secret-relay-2026"

# 启动后就绪等待上限（秒）：轮询「进程在 + 端口监听」；超时打印日志尾部并非零退出。
READY_TIMEOUT="${READY_TIMEOUT:-20}"

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
# 解析实例：<name> → 读注册表（唯一权威，不扫描）→ 校验布局 → 输出
# "home|profile|port(空=headless)|relay"
# relay：daemon 特判总控守护 `host-master`（守护 agent 名规范形态 `host-<id>`，
# id 是字符串）；其它 = 实例名（web3 → DSH_RELAY_AGENT=web3）。
# 返回 0=有效（echo 元数据），1=无效（已打印原因）。
resolve_instance() {
  local name="$1"
  local meta
  if ! meta="$(node "$REGISTRY_CLI" get "$name" --format tsv 2>&1)"; then
    echo "[$name] ✗ $meta" >&2
    echo "        现有实例：$(node "$REGISTRY_CLI" list 2>/dev/null | awk -F'\t' '{printf "%s ", $1}')" >&2
    echo "        新实例先登记：$REGISTRY_CLI import（或由创建流程写入）" >&2
    return 1
  fi
  local home prof host layout role version port status
  IFS=$'\t' read -r home prof host layout role version port status <<< "$meta"
  if [[ "$home" == "$OFFICIAL_HOME" && "$name" != "web" ]]; then
    echo "[$name] 🔴 拒绝：正式 home（~/.dsh，3080 禁令）" >&2
    return 1
  fi
  [[ -d "$home" ]] || { echo "[$name] ✗ 目录缺失：$home（注册表有档案但目录不在）" >&2; return 1; }
  [[ -d "$home/profiles/$prof" ]] || {
    echo "[$name] ✗ 布局无效：无 $home/profiles/$prof（注册表的 profileDir=$prof）" >&2
    return 1
  }
  # port：优先读实例自己 webserver 段（注册表里的 port 是登记时的快照，可能过期）。
  local live_port=""
  if [[ -f "$home/profiles/$prof/cordis.patch.yml" ]]; then
    live_port="$(read_instance_port "$home" "$prof" 2>/dev/null || true)"
  fi
  [[ -n "$live_port" ]] || live_port="$port"
  local relay="$name"
  [[ "$name" == "daemon" ]] && relay="host-master"
  echo "$home|$prof|$live_port|$relay"
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

# —— 旧进程 env 继承（restart 用）——
# 只继承「实例作用域配置 + provider 凭证」（GUI 模型路由依赖凭证，脚本不硬编码），
# 一律**不继承会话/宿主作用域**变量：DSH_SESSION_ID / DSH_SESSION_JSONL / DSH_SHELL /
# DSH_WEB_URL 由 DSH 在 agent 会话内注入，带进另一个实例会让它把别的实例的会话当成
# 自己的（实测：web3 带着 web2 的 DSH_SESSION_JSONL → 它派生的 shell 指向
# ~/.dsh-web2/sessions/…，破坏「测试环境目录隔离」）；CLAUDE_/VSCODE_/WSL/XDG_/DBUS_
# 等宿主噪声同理。
# 注意：前缀项必须写成 `PREFIX.*`——锚定的 `^PREFIX=` 只匹配完全同名变量
#（旧过滤器写成 `^(…|CLAUDE_|XDG_|DBUS_)='`，于是 CLAUDE_CODE_XXX / XDG_RUNTIME_DIR
# 全部漏过，连 DSH_SESSION_* 也被继承）。
ENV_DENY_EXACT_RE='^(DSH_HOME|DSH_RELAY_AGENT|DSH_RELAY_BROKER_URL|DSH_RELAY_SECRET|DSH_SESSION_ID|DSH_SESSION_JSONL|DSH_SHELL|DSH_WEB_URL|DSH_WEB_MODE|PWD|OLDPWD|SHLVL|_|PATH|HOME|USER|LOGNAME|SHELL|LANG|LC_ALL|TERM|HOSTNAME|NAME|MAIL|HOSTTYPE|MACHTYPE|OSTYPE|PAGER|GIT_PAGER|NO_COLOR|COLORTERM|COLUMNS|LINES|HISTFILE|HISTCONTROL|HISTSIZE|LS_COLORS|TMPDIR|GOPROXY|VIPSHOME|WSLENV|WSL_DISTRO_NAME|WSL_INTEROP|PULSE_SERVER|WAYLAND_DISPLAY|DISPLAY)='
ENV_DENY_PREFIX_RE='^(DSH_SESSION_|CLAUDE|VSCODE|COPILOT|OPENWIKI|WSL|XDG_|DBUS_|GIT_|SSH_|PULSE_|WAYLAND_)'

# 收集可继承的 env（stdout：`VAR=value` 行）。
collect_inherit_env() {
  local pid="$1"
  tr '\0' '\n' < "/proc/$pid/environ" 2>/dev/null \
    | grep -E '^[A-Za-z_][A-Za-z0-9_]*=' \
    | grep -vE "$ENV_DENY_EXACT_RE" \
    | grep -vE "$ENV_DENY_PREFIX_RE" \
    || true
}

# 端口是否在监听（与 status 同一判据）。
port_listening() {
  ss -tln 2>/dev/null | grep -q ":$1 "
}

# 启动实例并等待就绪（port 监听；headless 只看进程存活），超时打印日志尾部。
# 参数：<name> <home> <profile> <port|空=headless> <relay> [额外 env VAR=value ...]
# 返回 0=就绪，1=超时未就绪。
launch_instance() {
  local name="$1" home="$2" profile="$3" port="$4" relay="$5"; shift 5
  local log="/tmp/dsh-$name.log"
  echo "[$name] 启动：DSH_HOME=$home dsh --profile $profile（port ${port:-headless}）"
  # 启动环境 = 调用方 env（`env` 只叠加、不清除）→ 必须先踢掉会话/宿主作用域变量，
  # 否则从 agent shell 里执行 start/restart 时，**调用方自己的** DSH_SESSION_ID /
  # DSH_SESSION_JSONL / DSH_SHELL / DSH_WEB_URL 会随 env 传进实例（与旧进程继承是
  # 两条独立泄漏路径）。
  # web 实例带 --no-open：否则每次启动都会在主机上尝试打开浏览器（headless profile
  # 不认该旗标，故仅在读到 webserver port 时传）。
  local -a launch_args=(--profile "$profile")
  [[ -n "$port" ]] && launch_args+=(--no-open)
  env -u DSH_SESSION_ID -u DSH_SESSION_JSONL -u DSH_SHELL -u DSH_WEB_URL -u DSH_WEB_MODE \
    DSH_HOME="$home" \
    "DSH_RELAY_AGENT=$relay" \
    "DSH_RELAY_BROKER_URL=$RELAY_BROKER_URL" \
    "DSH_RELAY_SECRET=$RELAY_SECRET" \
    "$@" \
    nohup "$DSH_BIN" "${launch_args[@]}" > "$log" 2>&1 &
  local deadline=$((SECONDS + READY_TIMEOUT)) pid http_code=""
  while (( SECONDS < deadline )); do
    pid="$(is_running "$home" || true)"
    if [[ -n "$pid" ]]; then
      if [[ -z "$port" ]]; then
        echo "[$name] 就绪 pid=$pid（headless）"
        return 0
      fi
      # 端口监听 ≠ 应用就绪：实测启动窗口期内端口已监听，但应用仍返回 404。
      # 因此再探一次 HTTP：200/303/401 都说明应用在服务（401 = 未登录的正常应答），
      # 404/000 视为未就绪，继续等。
      if port_listening "$port"; then
        if command -v curl >/dev/null 2>&1; then
          http_code="$(curl -s -o /dev/null -m 2 -w '%{http_code}' "http://127.0.0.1:$port/" || true)"
          if [[ "$http_code" == "200" || "$http_code" == "303" || "$http_code" == "401" ]]; then
            echo "[$name] 就绪 pid=$pid port=$port（HTTP $http_code）"
            print_login_url "$name"
            return 0
          fi
        else
          echo "[$name] 就绪 pid=$pid port=$port（监听；无 curl，未做 HTTP 探测）"
          print_login_url "$name"
          return 0
        fi
      fi
    fi
    sleep 0.5
  done
  echo "[$name] ✗ 未就绪（${READY_TIMEOUT}s 内${port:+ 端口 $port 已监听但应用未应答，最后 HTTP ${http_code:-000}}）——日志尾部 $log：" >&2
  tail -n 10 "$log" 2>/dev/null | sed 's/^/    /' >&2 || true
  return 1
}

# 打印该实例的登录链接（dsh web 每次启动打印新 token；重启会让旧标签页过期，
# 这里直接把新链接给出来，省得用户去翻日志）。
print_login_url() {
  local name="$1" log="/tmp/dsh-$name.log" url
  url="$(grep -oE 'http://[^[:space:]]+/\?token=[A-Za-z0-9_-]+' "$log" 2>/dev/null | tail -1 || true)"
  [[ -n "$url" ]] && echo "[$name] 登录链接（旧标签页需重新打开）：$url"
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
  # relay 三件套由 launch_instance 注入（仅通信插件部署：web2/3/4/daemon 经 broker 联调；
  # 作传输兜底——实例发现权威源是管理端 launch 配置，不依赖 broker）。
  launch_instance "$name" "$home" "$profile" "$port" "$relay"
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

# 重启：保留旧进程的**实例作用域** env（KILO_API_KEY 等 provider 凭证——GUI LLM provider
# 依赖，脚本不硬编码），过滤掉会话/宿主作用域变量（见 ENV_DENY_*），stop 后以继承的 env
# 重启并等待就绪。避免 restart 后 GUI 模型失效（早期手动带 key 启动的原因）。
restart_one() {
  local name="$1"
  local info; info="$(resolve_instance "$name")" || return 1
  IFS='|' read -r home profile port relay <<< "$info"
  local pid; pid="$(is_running "$home" || true)"
  local -a inherit=()
  if [[ -n "$pid" ]]; then
    local total kv
    total="$(tr '\0' '\n' < "/proc/$pid/environ" 2>/dev/null | grep -cE '^[A-Za-z_][A-Za-z0-9_]*=' || true)"
    while IFS= read -r kv; do inherit+=("$kv"); done < <(collect_inherit_env "$pid")
    # 只打印变量名：值可能含 provider 凭证（KILO_API_KEY 等），不进终端回滚缓冲。
    local names=""
    for kv in ${inherit[@]+"${inherit[@]}"}; do names+="${names:+,}${kv%%=*}"; done
    echo "[$name] 继承旧进程 env：${names:-（无）}（${#inherit[@]} 项；已过滤 $(( ${total:-0} - ${#inherit[@]} )) 项会话/宿主变量）"
  fi
  stop_one "$name"
  launch_instance "$name" "$home" "$profile" "$port" "$relay" ${inherit[@]+"${inherit[@]}"}
}

# 注册表内的实例名（唯一权威；不含墓碑，按名排序）。运行时**不扫描目录**。
list_instances() {
  node "$REGISTRY_CLI" list 2>/dev/null | awk -F'\t' 'NF {print $1}' | sort
}

status() {
  echo "实例状态（读注册表 $(node "$REGISTRY_CLI" path)，见 AGENTS.md「测试环境」）："
  local any=0 name
  while IFS= read -r name; do
    [[ -n "$name" ]] || continue
    any=1
    local info
    if ! info="$(resolve_instance "$name" 2>&1)"; then
      echo "  $name: 不可用 —— $(printf '%s' "$info" | head -1)"
      continue
    fi
    local home profile port relay
    IFS='|' read -r home profile port relay <<< "$info"
    local pid; pid="$(is_running "$home" || true)"
    local port_txt="port=headless"
    if [[ -n "$port" ]]; then
      port_txt="port=$port$(ss -tln 2>/dev/null | grep -q ":$port " && echo ' (监听)' || echo ' (未监听)')"
    fi
    if [[ -n "$pid" ]]; then
      echo "  $name: RUNNING pid=$pid $port_txt  $home"
    else
      echo "  $name: stopped  $port_txt  $home"
    fi
  done < <(list_instances)
  [[ $any -eq 1 ]] || echo "  （注册表为空：先跑 $0 import 登记现有实例，或由创建流程写入）"
}

main() {
  local cmd="${1:-status}"
  shift || true
  local targets=("$@")
  case "$cmd" in
    start | stop | restart | resolve)
      # 破坏性/定点操作**必须显式点名**：无参时注册表内可能包含开发实例（web5 等），
      # 一把操作会误碰一片（2026-09 用户定）。
      if [[ ${#targets[@]} -eq 0 ]]; then
        echo "✗ 必须显式点名实例（无参操作已禁用——注册表内可能含开发实例）" >&2
        echo "  在册实例：$(list_instances | tr '\n' ' ')" >&2
        echo "  例：$0 $cmd web2" >&2
        exit 2
      fi
      ;;
  esac
  case "$cmd" in
    start | stop | restart)
      # 单个实例失败不中断其余（注册表里可能有过期/被拒条目）——最后统一非零退出。
      local failed=0 t
      for t in "${targets[@]}"; do
        "${cmd}_one" "$t" || { failed=$((failed + 1)); echo "[$t] ✗ $cmd 失败（继续其余实例）" >&2; }
      done
      [[ $failed -eq 0 ]] || { echo "✗ 有 $failed 个实例操作失败" >&2; exit 1; }
      ;;
    status)
      status
      ;;
    import)
      # 显式登记现有实例（唯一允许扫描目录的动作）；幂等，不改已有条目。
      node "$REGISTRY_CLI" import
      ;;
    resolve)
      for t in "${targets[@]}"; do resolve_instance "$t"; done
      ;;
    *)
      echo "用法: $0 {start|stop|restart|status|import|resolve} <实例名> [...]" >&2
      echo "      实例清单权威源 = 注册表（$REGISTRY_CLI path）；import = 登记现有实例。" >&2
      echo "      start/stop/restart/resolve 必须点名实例（无参禁用）；status 列出全部。" >&2
      exit 2
      ;;
  esac
}

main "$@"
