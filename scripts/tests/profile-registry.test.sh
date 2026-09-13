#!/usr/bin/env bash
# dsh-profile.sh 读注册表（唯一入口、运行时**不扫描目录**）——R6 的验收判据。
# 用法：bash scripts/tests/profile-registry.test.sh
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"
PROFILE="$ROOT/scripts/dsh-profile.sh"

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
H="$TMP/home"
mkdir -p "$H/.dsh/profiles/web" "$H/.dsh-web2/profiles/web2" "$H/.dsh-home"
cat > "$H/.dsh-web2/profiles/web2/cordis.patch.yml" <<'YML'
- id: webserver
  config:
    port: 3082
YML

export HOME="$H" DSH_REGISTRY="$H/.dsh-home/registry.json" DSH_HOST_ID=master
unset DSH_HOME || true

has() { # has <名称> <子串> <文本>
  local n="$1" needle="$2" hay="$3"
  if [[ "$hay" == *"$needle"* ]]; then
    printf '  ✓ %s\n' "$n"; PASS=$((PASS + 1))
  else
    printf '  ✗ %s（未出现：%s）\n' "$n" "$needle"
    printf '%s\n' "$hay" | sed 's/^/      /'
    FAIL=$((FAIL + 1))
  fi
}

echo "== import：显式登记现有实例 =="
out="$(bash "$PROFILE" import 2>&1)"; rc=$?
t ok "import 成功退出" true
[[ $rc -eq 0 ]] || { printf '  ✗ import 失败 rc=%s\n' "$rc"; printf '%s\n' "$out" | sed 's/^/      /'; FAIL=$((FAIL + 1)); }
reg="$(cat "$DSH_REGISTRY" 2>/dev/null || echo '{}')"
has "注册表含本机 web（正式实例，legacy）" '"master/web"' "$reg"
has "注册表含本机 web2（legacy）" '"master/web2"' "$reg"

echo "== status：列出注册表实例 =="
out="$(bash "$PROFILE" status 2>&1)"
has "列出 web2" "web2:" "$out"
has "列出 web（正式实例也在册，只是不参与无参操作）" "web:" "$out"

echo "== 不扫描：磁盘上新增的实例不在册就不出现 =="
mkdir -p "$H/.dsh-late/profiles/late"
out="$(bash "$PROFILE" status 2>&1)"
if [[ "$out" == *"late"* ]]; then
  printf '  ✗ 未登记的 late 出现在 status（仍在扫描目录）\n'; FAIL=$((FAIL + 1))
else
  printf '  ✓ 未登记的实例不出现（注册表是唯一入口）\n'; PASS=$((PASS + 1))
fi
out="$(bash "$PROFILE" resolve late 2>&1)"; rc=$?
[[ $rc -ne 0 ]] && printf '  ✓ 未登记实例解析失败\n' && PASS=$((PASS + 1)) || { printf '  ✗ 未登记实例居然解析成功\n'; FAIL=$((FAIL + 1)); }
has "失败信息点明未在注册表" "未在注册表" "$out"

echo "== resolve：输出解析结果 =="
out="$(bash "$PROFILE" resolve web2 2>&1)"
has "home|profile|port|relay 四段" "$H/.dsh-web2|web2|3082|web2" "$out"

echo "== 3080 禁令：注册表里 home 指向正式 ~/.dsh 的非 web 实例 =="
node -e '
const fs = require("fs"); const f = process.env.DSH_REGISTRY
const reg = JSON.parse(fs.readFileSync(f, "utf8"))
reg.instances["master/hacker"] = { id: "hacker", name: "hacker", host: "master", home: process.env.HOME + "/.dsh", profileDir: "web", template: null, templateFingerprint: null, version: null, port: null, role: "console", layout: "legacy", addr: null, status: "active", createdAt: new Date().toISOString(), deletedAt: null }
fs.writeFileSync(f, JSON.stringify(reg, null, 2))
'
out="$(bash "$PROFILE" resolve hacker 2>&1)"; rc=$?
[[ $rc -ne 0 ]] && printf '  ✓ 拒绝解析（退出非零）\n' && PASS=$((PASS + 1)) || { printf '  ✗ 未被拒绝\n'; FAIL=$((FAIL + 1)); }
has "拒绝理由 = 3080 禁令" "3080 禁令" "$out"

echo "== 无参操作被禁用（注册表内可能含开发实例）=="
out="$(bash "$PROFILE" stop 2>&1)"; rc=$?
[[ $rc -ne 0 ]] && printf '  ✓ 无参 stop 非零退出\n' && PASS=$((PASS + 1)) || { printf '  ✗ 无参 stop 居然执行了\n'; FAIL=$((FAIL + 1)); }
has "拒绝理由 = 必须显式点名" "必须显式点名" "$out"
if [[ "$out" == *"[web]"* || "$out" == *"[web2]"* ]]; then
  printf '  ✗ 无参操作触碰了实例\n'; FAIL=$((FAIL + 1))
else
  printf '  ✓ 无参操作未触碰任何实例\n'; PASS=$((PASS + 1))
fi
has "提示里列出在册实例" "web2" "$out"

echo "== 注册表有档案但目录不在：报不可用，不静默跳过 =="
rm -rf "$H/.dsh-web2"
out="$(bash "$PROFILE" status 2>&1)"
has "web2 标为不可用" "web2: 不可用" "$out"

echo
if [[ $FAIL -eq 0 ]]; then
  printf 'profile-registry.test: 全部通过（%d 项）\n' "$PASS"
else
  printf 'profile-registry.test: %d 项失败 / %d 项通过\n' "$FAIL" "$PASS"
  exit 1
fi
