#!/usr/bin/env bash
# scripts/tests 下各测试脚本共用的小工具（source 引入，不单独执行）。

# t <期望 ok|fail> <名称> <命令...>：断言命令的退出码
PASS=0; FAIL=0
t() {
  local want="$1" name="$2"; shift 2
  local out rc
  out="$("$@" 2>&1)"; rc=$?
  if { [ "$want" = ok ] && [ "$rc" -eq 0 ]; } || { [ "$want" = fail ] && [ "$rc" -ne 0 ]; }; then
    printf '  ✓ %s\n' "$name"; PASS=$((PASS + 1))
  else
    printf '  ✗ %s（期望 %s，实际 rc=%s）\n' "$name" "$want" "$rc"
    printf '%s\n' "$out" | sed 's/^/      /'
    FAIL=$((FAIL + 1))
  fi
}

# 断言布尔条件：c <名称> <条件...>
c() {
  local name="$1"; shift
  if "$@" >/dev/null 2>&1; then
    printf '  ✓ %s\n' "$name"; PASS=$((PASS + 1))
  else
    printf '  ✗ %s\n' "$name"; FAIL=$((FAIL + 1))
  fi
}

# block_with <SKILL.md> <关键字>：抽出 SKILL.md 里含关键字的第一个 ```sh/```bash 块
# （fence 可缩进）。测试跑的是 skill 正文里的真命令，文本漂移即失配。
block_with() {
  awk -v key="$2" '
    /^[[:space:]]*```(sh|bash)[[:space:]]*$/ { f=1; buf=""; next }
    /^[[:space:]]*```/ { if (f && buf ~ key) { printf "%s", buf; exit } f=0; next }
    f { buf = buf $0 "\n" }
  ' "$1"
}
