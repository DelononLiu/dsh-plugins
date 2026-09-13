#!/usr/bin/env bash
# .agents/skills 的机械闸门（确定性校验，代替"靠自觉"）：
#   1. frontmatter：每个 skill 目录有 SKILL.md，name 与目录同名，description 非空
#   2. 内联命令块：```sh/```bash 代码块语法正确（bash -n）——skill 里的命令跑不通
#      是静默失效：提示词看着没问题，执行即报错
#   3. 相对链接：指向的仓库文件必须存在——悬空指针 = 陈旧文档 = 污染源
#
# 用法：
#   scripts/verify-skills.sh              # 校验全部
#   scripts/verify-skills.sh grilling     # 只校验一个 skill（含其链接到仓库其他位置的目标）
#
# 退出码：0 = 全过；非零 = 有失败项（逐条打印）。
# 例外：见 EXCLUDE_LINK_FILES——那些文件里的"链接"是校准样例文本，不是引用目标。
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
# DSH_SKILLS_DIR 覆盖 = 自测用的测试缝（scripts/tests/verify-skills.test.sh 用假 skills 树验证本脚本能红能绿）
SKILLS_DIR="${DSH_SKILLS_DIR:-$ROOT/.agents/skills}"

# 样例/校准文件：正文中的链接是示例 prose 的一部分，不作为引用目标校验
EXCLUDE_LINK_FILES=(
  "domain-modeling/CONTEXT-FORMAT.md"
  "dsh-trim-cot-leakage/references/examples.md"
  "dsh-trim-cot-leakage/references/recall-batteries.md"
)

FAIL=0
fail() { printf '  ✗ %s\n' "$*"; FAIL=1; }
ok()   { printf '  ✓ %s\n' "$*"; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

is_excluded() {
  local rel="$1"
  for e in "${EXCLUDE_LINK_FILES[@]}"; do [ "$rel" = "$e" ] && return 0; done
  return 1
}

# ---------- 1 + 2：逐 skill 校验 ----------
SELECTED=("$@")
if [ ${#SELECTED[@]} -gt 0 ]; then
  DIRS=()
  for s in "${SELECTED[@]}"; do DIRS+=("$SKILLS_DIR/$s"); done
else
  DIRS=("$SKILLS_DIR"/*/)
fi

for d in "${DIRS[@]}"; do
  [ -d "$d" ] || { fail "skill 目录不存在：$d"; continue; }
  name="$(basename "$d")"
  f="$d/SKILL.md"
  printf '%s\n' "== $name =="

  # 1. frontmatter
  if [ ! -f "$f" ]; then
    fail "缺少 SKILL.md"
    continue
  fi
  if [ "$(head -1 "$f")" != "---" ]; then
    fail "SKILL.md 未以 --- 开头（frontmatter 缺失）"
  fi
  fm_name="$(awk '/^---$/{c++;next} c==1 && /^name:/{sub(/^name:[[:space:]]*/,"");print;exit}' "$f")"
  fm_desc="$(awk '/^---$/{c++;next} c==1 && /^description:/{sub(/^description:[[:space:]]*/,"");print;exit}' "$f")"
  [ "$fm_name" = "$name" ] && ok "name: $fm_name" || fail "frontmatter name='$fm_name' ≠ 目录名 '$name'（skill 无法被正确路由）"
  [ -n "$fm_desc" ] && ok "description 非空（${#fm_desc} 字）" || fail "description 为空"

  # 2. 内联命令块语法
  rm -f "$TMP"/block*.sh
  awk -v out="$TMP" '
    /^[[:space:]]*```(sh|bash)[[:space:]]*$/ { f=1; n++; next }
    /^[[:space:]]*```/ { f=0; next }
    f { print > (out "/block" n ".sh") }
  ' "$f"
  blocks=0; bad=0; templated=0
  for b in "$TMP"/block*.sh; do
    [ -e "$b" ] || continue
    blocks=$((blocks + 1))
    # <占位符> 替换为 dummy 后再校验：模板块也要保证"占位符之外"的语法正确
    if grep -qE '<[^<>[:space:]]+>' "$b"; then
      templated=$((templated + 1))
      sed -E 's/<[^<>[:space:]]+>/__PH__/g' "$b" > "$b.san"
      check="$b.san"
    else
      check="$b"
    fi
    if ! bash -n "$check" 2>"$TMP/err"; then
      bad=$((bad + 1))
      fail "命令块语法错误（$(head -1 "$TMP/err")）"
    fi
  done
  [ "$bad" -eq 0 ] && ok "内联命令块 $blocks 段语法通过（$templated 段含 <> 占位符，按模板校验）"

  # 3. 相对链接（本 skill 的全部 md）
  broken=0; links=0
  while IFS= read -r md; do
    rel="${md#"$SKILLS_DIR"/}"
    is_excluded "$rel" && continue
    dir="$(dirname "$md")"
    while IFS= read -r link; do
      case "$link" in http*|mailto:*|\#*|"") continue ;; esac
      target="${link%%#*}"
      [ -z "$target" ] && continue
      links=$((links + 1))
      if [ ! -e "$dir/$target" ]; then
        broken=$((broken + 1))
        fail "悬空链接 $rel → $link"
      fi
    done < <(grep -oE '\]\([^)]+\)' "$md" 2>/dev/null | sed 's/^](//; s/)$//')
  done < <(find "$d" -name '*.md' | sort)
  [ "$broken" -eq 0 ] && ok "相对链接 $links 个全部可解析"
done

# ---------- 汇总 ----------
echo
if [ "$FAIL" -eq 0 ]; then
  echo "verify-skills: 全部通过"
else
  echo "verify-skills: 存在失败项（见上 ✗）"
fi
exit "$FAIL"
