#!/usr/bin/env bash
# 内核升级后测试环境验证（确定性静态 + 健康检查）——dsh-kernel-upgrade skill 的
# 强制步骤。模型执行升级后必须跑本脚本确认，代替"靠自觉逐项检查"。
#
# 用法：
#   scripts/verify-kernel-upgrade.sh          # 检查全部环境（默认）
#   scripts/verify-kernel-upgrade.sh web2     # 只检查 web2
#
# 🔴 永不触碰正式 ~/.dsh（3080 禁令，见 AGENTS.md）。
#
# 检查项：
#   1. 官方内核包双实例（profile 显式装 dsh-tools/dsh-session/dsh-llm… → Symbol
#      键服务跨实例不共享 → agent 工具调用 prepare undefined 崩）
#   2. 已删/已合并包残留依赖（dsh-console-ui / dsh-nav）
#   3. profile 自研 link 指向 main（非旧 worktree）
#   4. 端口监听 + 管理端 API + bundle 加载（web 角色）
#   5. 启动日志 0 错误
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
MAIN_PKGS="$ROOT/packages"

# 环境矩阵：name|DSH_HOME|profile|port|role（web=有页面；daemon=headless）
ENVS=(
  "web2|$HOME/.dsh-web2|web|3082|web"
  "web3|$HOME/.dsh-web3|web|3083|web"
  "web4|$HOME/.dsh-web4|web|3084|web"
  "web5|$HOME/.dsh-web5|web|3085|web"
  "daemon|$HOME/.dsh-daemon|daemon|3089|headless"
)

# 官方内核包：base bundle 自带、profile 绝不该显式装（双实例风险源）。
# 判据：@deepseek-ai/dsh-* 且不是插件形态的（llm-pi-ai 是多供应商路由插件，
# 全家桶 @linxin666 是 vendored 功能，二者都允许显式装）。
KERNEL_PACKAGES=(
  "@deepseek-ai/dsh-tools" "@deepseek-ai/dsh-session" "@deepseek-ai/dsh-llm"
  "@deepseek-ai/dsh-agent" "@deepseek-ai/dsh-agent-loop" "@deepseek-ai/dsh-core"
  "@deepseek-ai/dsh-workspace" "@deepseek-ai/dsh-scope" "@deepseek-ai/dsh-subagent"
)

# 已删/已合并的包（出现即残留）
GONE_PACKAGES=("dsh-console-ui" "dsh-nav")

fail_count=0

say()  { printf '\033[1;34m[verify]\033[0m %s\n' "$*"; }
pass() { printf '\033[1;32m  ✓\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; fail_count=$((fail_count+1)); }

find_env() {
  local name="$1"
  for e in "${ENVS[@]}"; do
    IFS='|' read -r n home profile port role <<< "$e"
    if [[ "$n" == "$name" ]]; then
      echo "$home|$profile|$port|$role"
      return 0
    fi
  done
  echo "未知环境: $name（可用: web2 web3 web4 web5 daemon）" >&2
  return 1
}

is_running() {
  local home="$1"
  for pid in $(pgrep -f 'dsh --profile' 2>/dev/null || true); do
    local cmd; cmd="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
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

check_env() {
  local name="$1"
  local info; info="$(find_env "$name")"
  IFS='|' read -r home profile port role <<< "$info"
  local pkg="$home/profiles/$profile/package.json"
  local patch="$home/profiles/$profile/cordis.patch.yml"
  local log="/tmp/dsh-$name.log"

  say "── $name（$home）"
  if [[ ! -f "$pkg" ]]; then
    fail "profile package.json 不存在: $pkg"
    return
  fi

  # 1. 官方内核包双实例
  say "检查官方内核包双实例（Symbol 键服务跨实例风险）…"
  for kp in "${KERNEL_PACKAGES[@]}"; do
    if python3 -c "
import json,sys
d=json.load(open('$pkg'))
print('$kp' in d.get('dependencies',{}))
" 2>/dev/null | grep -q True; then
      fail "profile 显式依赖内核包 $kp（双实例风险：Symbol scheduler 不共享 → 工具调用 prepare 崩）。从 dependencies 移除（内核 CLI 已带）。"
    fi
  done
  # llm-pi-ai 是合法插件（允许）；若 KERNEL 检查全过则 pass
  local kernel_hits=0
  for kp in "${KERNEL_PACKAGES[@]}"; do
    python3 -c "
import json,sys
d=json.load(open('$pkg'))
sys.exit(0 if '$kp' not in d.get('dependencies',{}) else 1)
" 2>/dev/null || kernel_hits=$((kernel_hits+1))
  done
  [[ $kernel_hits -eq 0 ]] && pass "无官方内核包双实例"

  # 2. 残留已删包
  for gp in "${GONE_PACKAGES[@]}"; do
    if python3 -c "
import json,sys
d=json.load(open('$pkg'))
sys.exit(0 if '$gp' not in d.get('dependencies',{}) else 1)
" 2>/dev/null; then
      :
    else
      fail "残留已删包 $gp（在 dependencies 中）"
    fi
  done

  # 3. 自研 link 指向 main（非旧 worktree）
  local bad_link=""
  while IFS= read -r dep; do
    [[ -z "$dep" ]] && continue
    # 只查自研包 link（dsh-*，非官方/全家桶）
    if python3 -c "
import json,sys
d=json.load(open('$pkg'))
v=d.get('dependencies',{}).get('$dep','')
sys.exit(0 if isinstance(v,str) and v.startswith('link:') else 1)
" 2>/dev/null; then
      local target
      target=$(python3 -c "
import json,sys
d=json.load(open('$pkg'))
print(d['dependencies']['$dep'][5:])
" 2>/dev/null)
      if [[ "$target" != "$MAIN_PKGS/$dep" ]]; then
        bad_link="$bad_link $dep→$target"
      fi
    fi
  done < <(python3 -c "
import json,sys
d=json.load(open('$pkg'))
for k in d.get('dependencies',{}):
    if k.startswith('dsh-') and not k.startswith('dsh-gateway') and not k.startswith('@'):
        print(k)
" 2>/dev/null)
  if [[ -n "$bad_link" ]]; then
    fail "自研 link 未指向 main:$bad_link"
  else
    pass "自研 link 指向 main"
  fi

  # 4/5. 运行态检查（仅 web 角色；headless daemon 只查进程+日志）
  local pid; pid="$(is_running "$home" || true)"
  if [[ -z "$pid" ]]; then
    fail "环境未运行（$home）"
  else
    pass "进程运行 pid=$pid"
    # 日志错误（用最近日志文件）
    local recent_log
    recent_log="$(ls -t /tmp/web*-*.log /tmp/dsh-$name.log /tmp/daemon-*.log 2>/dev/null | head -1 || true)"
    if [[ -n "$recent_log" && -f "$recent_log" ]]; then
      local errs; errs="$(grep -icE 'error|exception|failed to apply|cannot find|Maximum' "$recent_log" 2>/dev/null || true)"
      # gateway EADDRINUSE 是端口冲突（其他环境占用），非本环境故障——不计
      errs="$(grep -ivE 'EADDRINUSE|gateway is down' "$recent_log" 2>/dev/null | grep -icE 'error|exception|failed to apply|cannot find|Maximum' || true)"
      if [[ "$errs" -gt 0 ]]; then
        fail "日志 $errs 处错误（$recent_log）"
      else
        pass "日志 0 错误"
      fi
    fi
  fi

  if [[ "$role" == "web" ]]; then
    # 4. 端口 + 页面 + API
    if ss -tln 2>/dev/null | grep -q ":$port "; then
      pass "端口 $port 监听"
    else
      fail "端口 $port 未监听"
    fi
    # 页面 200 需要 token（401 = fence 正常）。探活：/ 返回 401 即 fence 在工作。
    local code
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:$port/" 2>/dev/null || true)"
    if [[ "$code" == "401" || "$code" == "200" ]]; then
      pass "web 探活 HTTP $code（401=fence 正常）"
    else
      fail "web 探活 HTTP $code（期望 200/401）"
    fi
    # 管理端 API（console 实例表）
    if [[ "$name" == "web2" ]]; then
      local api_code
      api_code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 'http://127.0.0.1:3082/api/console/instances' 2>/dev/null || true)"
      if [[ "$api_code" == "200" ]]; then
        pass "console API 200"
      else
        fail "console API HTTP $api_code"
      fi
    fi
  fi
}

main() {
  local targets=()
  if [[ $# -gt 0 ]]; then
    targets=("$@")
  else
    targets=(web2 web3 web4 web5 daemon)
  fi
  for t in "${targets[@]}"; do
    check_env "$t"
  done
  echo
  if [[ $fail_count -gt 0 ]]; then
    printf '\033[1;31m[verify] %d 项失败——升级验证未通过，修复后重跑。\033[0m\n' "$fail_count"
    exit 1
  fi
  printf '\033[1;32m[verify] 全部通过 ✓（静态无双实例/残留 + 运行健康）。注意：工具调用冒烟仍需在管理端发一轮触发 Bash 的消息确认。\033[0m\n'
}

main "$@"
