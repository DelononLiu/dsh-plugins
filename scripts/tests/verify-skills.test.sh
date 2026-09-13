#!/usr/bin/env bash
# verify-skills.sh 的行为测试（闸门本身要能红能绿，否则是假闸门）：
#   真阳性：frontmatter 名字不符 / description 空 / 命令块语法错 / 悬空链接 → 必须非零退出
#   真阴性：干净树 / 模板占位符块 / 校准样例文件的示例链接 → 必须零退出
#   快照非破坏性：incident-forensics A1 的快照命令不得改动工作区
#
# 用法：bash scripts/tests/verify-skills.test.sh
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"
GATE="$ROOT/scripts/verify-skills.sh"

# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"   # 共用断言与抽块工具（PASS/FAIL/t/c/block_with）

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
TREE="$TMP/skills"

fixture() { # 造一棵最小 skills 树；$1 = 变体
  rm -rf "$TREE"; mkdir -p "$TREE/demo-skill"
  # 链接目标的实体文件（校验相对链接用）
  mkdir -p "$TMP/repo/docs"; : > "$TMP/repo/AGENTS.md"; : > "$TMP/repo/docs/architecture.md"
  case "$1" in
    clean)
      cat > "$TREE/demo-skill/SKILL.md" <<'EOF'
---
name: demo-skill
description: 演示用
---

命令：

```sh
git status --short
```
EOF
      ;;
    name-mismatch) printf -- '---\nname: other-name\ndescription: 演示用\n---\n\n正文\n' > "$TREE/demo-skill/SKILL.md" ;;
    empty-desc)    printf -- '---\nname: demo-skill\ndescription:\n---\n\n正文\n'        > "$TREE/demo-skill/SKILL.md" ;;
    no-frontmatter) printf -- '# 没有 frontmatter\n'                                     > "$TREE/demo-skill/SKILL.md" ;;
    bad-sh)
      cat > "$TREE/demo-skill/SKILL.md" <<'EOF'
---
name: demo-skill
description: 演示用
---

```sh
echo "未闭合的引号
```
EOF
      ;;
    dangling-link) printf -- '---\nname: demo-skill\ndescription: 演示用\n---\n\n见 [arch](../nowhere/architecture.md)。\n' > "$TREE/demo-skill/SKILL.md" ;;
    template-block)  # 规范写法：$VAR 或中文占位名——不该报错，也不该进"尖括号占位符"警告
      cat > "$TREE/demo-skill/SKILL.md" <<'EOF'
---
name: demo-skill
description: 演示用
---

```sh
BRANCH=分支名
git push origin "$BRANCH"
cp -a ~/.dsh-实例名 /tmp/实例名
```
EOF
      ;;
    arg-placeholder)  # 参数位置的 <branch> 也是重定向，一样过不了 shell
      cat > "$TREE/demo-skill/SKILL.md" <<'EOF'
---
name: demo-skill
description: 演示用
---

```sh
git push origin <branch>
```
EOF
      ;;
    path-placeholder)
      cat > "$TREE/demo-skill/SKILL.md" <<'EOF'
---
name: demo-skill
description: 演示用
---

```sh
cp a.txt /tmp/out/<name>.txt       # <name> 在路径位置 → shell 当重定向
```
EOF
      ;;
    assign-placeholder)  # 赋值位置的占位符同样过不了 shell（<x> 是重定向，不是占位符）
      cat > "$TREE/demo-skill/SKILL.md" <<'EOF'
---
name: demo-skill
description: 演示用
---

```sh
NAME=<文件名>
cp a.txt "/tmp/$NAME.txt"
```
EOF
      ;;
    quoted-placeholder)  # 引号内 / 注释里的尖括号是文字，不该误报
      cat > "$TREE/demo-skill/SKILL.md" <<'EOF'
---
name: demo-skill
description: 演示用
---

```sh
# 别写 <pkg>，shell 会当重定向
git commit -m "docs: <name> 说明"
```
EOF
      ;;
    excluded)  # 用真实被排除的路径（排除表按相对路径匹配）
      rm -rf "$TREE/demo-skill"; mkdir -p "$TREE/domain-modeling"
      printf -- '---\nname: domain-modeling\ndescription: 演示用\n---\n\n正文\n' > "$TREE/domain-modeling/SKILL.md"
      printf -- '# 校准样例\n\n- [示例](./src/billing/CONTEXT.md)\n' > "$TREE/domain-modeling/CONTEXT-FORMAT.md"
      ;;
  esac
}

echo "== 真阴性 =="
fixture clean
t ok "干净树全过"               env DSH_SKILLS_DIR="$TREE" bash "$GATE"
fixture template-block
t ok "规范占位写法（变量式 / 中文名）不误报" env DSH_SKILLS_DIR="$TREE" bash "$GATE"
fixture excluded
t ok "校准样例文件的示例链接被跳过"  env DSH_SKILLS_DIR="$TREE" bash "$GATE"

echo "== 真阳性（闸门必须红）=="
fixture name-mismatch
t fail "frontmatter name ≠ 目录名"  env DSH_SKILLS_DIR="$TREE" bash "$GATE"
fixture empty-desc
t fail "description 为空"          env DSH_SKILLS_DIR="$TREE" bash "$GATE"
fixture no-frontmatter
t fail "缺 frontmatter"            env DSH_SKILLS_DIR="$TREE" bash "$GATE"
fixture bad-sh
t fail "命令块语法错误"            env DSH_SKILLS_DIR="$TREE" bash "$GATE"
fixture dangling-link
t fail "悬空相对链接"              env DSH_SKILLS_DIR="$TREE" bash "$GATE"
fixture path-placeholder
t fail "占位符出现在路径位置"       env DSH_SKILLS_DIR="$TREE" bash "$GATE"
fixture assign-placeholder
t fail "占位符出现在赋值位置"       env DSH_SKILLS_DIR="$TREE" bash "$GATE"
fixture arg-placeholder
t fail "占位符出现在参数位置"       env DSH_SKILLS_DIR="$TREE" bash "$GATE"
fixture quoted-placeholder
t ok   "引号/注释里的尖括号不误报"   env DSH_SKILLS_DIR="$TREE" bash "$GATE"

# ---------- skill 内联命令的实跑验证 ----------
# 不复制一份命令来测（会漂移），而是从 SKILL.md 里抽出真块跑——skill 文本改了这里立刻失配。
block_with() { # block_with <SKILL.md> <关键字>
  awk -v key="$2" '
    /^[[:space:]]*```(sh|bash)[[:space:]]*$/ { f=1; buf=""; next }
    /^[[:space:]]*```/ { if (f && buf ~ key) { printf "%s", buf; exit } f=0; next }
    f { buf = buf $0 "\n" }
  ' "$1"
}

echo "== 快照非破坏性（diagnosing-bugs Phase 0 / incident-forensics A1 的快照块）=="
SNAPREPO="$TMP/snaprepo"; mkdir -p "$SNAPREPO"; cd "$SNAPREPO" || exit 1
git init -q .; echo tracked > a.txt; git add a.txt
git -c user.email=t@t -c user.name=t commit -qm init
echo modified >> a.txt; echo untracked > b.txt
SNAP_BLOCK="$(block_with "$ROOT/.agents/skills/diagnosing-bugs/SKILL.md" 'stash create')"
if [ -z "$SNAP_BLOCK" ]; then
  printf '  ✗ 未能从 diagnosing-bugs/SKILL.md 抽出快照命令块\n'; FAIL=$((FAIL + 1))
else
  before="$(git status --short --untracked-files=all | sort)"
  bash -c "$SNAP_BLOCK" >"$TMP/snap.out" 2>&1
  after="$(git status --short --untracked-files=all | sort)"
  if [ "$before" = "$after" ]; then
    printf '  ✓ 快照后工作区状态不变\n'; PASS=$((PASS + 1))
  else
    printf '  ✗ 快照改动了工作区：\n      before=%s\n      after=%s\n' "$before" "$after"; FAIL=$((FAIL + 1))
  fi
  REF="$(git for-each-ref refs/forensics --format='%(refname:short)' | head -1)"
  if [ -n "$REF" ] && git rev-parse -q --verify "$REF" >/dev/null; then
    printf '  ✓ 快照 ref 建立（%s）\n' "$REF"; PASS=$((PASS + 1))
  else
    printf '  ✗ 快照 ref 未建立\n'; FAIL=$((FAIL + 1))
  fi
fi

echo "== 陈旧产物判据能红能绿（incident-forensics A3）=="
STALEREPO="$TMP/stalerepo"; mkdir -p "$STALEREPO/packages/p/src" "$STALEREPO/packages/p/lib"
cd "$STALEREPO" || exit 1
git init -q .
: > packages/p/lib/index.js          # lib 构建时间 = 1 小时前
touch -d '-1 hour' packages/p/lib/index.js
echo "export const x = 1" > packages/p/src/index.ts
git add -A; git -c user.email=t@t -c user.name=t commit -qm "src"
A3_BLOCK="$(block_with "$ROOT/.agents/skills/dsh-incident-forensics/SKILL.md" 'STALE')"
if [ -z "$A3_BLOCK" ]; then
  printf '  ✗ 未能从 dsh-incident-forensics/SKILL.md 抽出陈旧产物命令块\n'; FAIL=$((FAIL + 1))
else
  out="$(bash -c "$A3_BLOCK" 2>&1)"
  case "$out" in
    *STALE*) printf '  ✓ 陈旧 lib（构建早于 src 提交）被标红\n'; PASS=$((PASS + 1)) ;;
    *) printf '  ✗ 陈旧 lib 未标红：%s\n' "$out"; FAIL=$((FAIL + 1)) ;;
  esac
  touch packages/p/lib/index.js      # 重建后（mtime 晚于 src 提交）不应标红
  out="$(bash -c "$A3_BLOCK" 2>&1)"
  case "$out" in
    *STALE*) printf '  ✗ 新鲜 lib 误报：%s\n' "$out"; FAIL=$((FAIL + 1)) ;;
    *) printf '  ✓ 新鲜 lib 不误报\n'; PASS=$((PASS + 1)) ;;
  esac
fi

echo
if [ "$FAIL" -eq 0 ]; then
  echo "verify-skills.test: 全部通过（$PASS 项）"
else
  echo "verify-skills.test: $FAIL 项失败（$PASS 项通过）"
fi
exit "$FAIL"
