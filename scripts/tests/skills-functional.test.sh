#!/usr/bin/env bash
# skills **功能测试**里可机械断言的部分：现场与判据本身对不对。
#
# 分两层：
#   1. 确定性（本脚本）——把 GROUND-TRUTH.md 里能用命令判定的部分钉住：现场真的坏、
#      篡改真的抹掉了症状、HEAD 真的能恢复证据、陈旧判据能红能绿、污染信号真的齐。
#   2. 结论层（模型跑 skill）——照 skill 走一遍，结论与 GROUND-TRUTH.md 对照。
#      这一层不可 CI 化（要 LLM），协议见 fixtures/skills-fn/GROUND-TRUTH.md。
#
# 用法：bash scripts/tests/skills-functional.test.sh
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"
FIX="$ROOT/scripts/tests/fixtures/skills-fn"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"; rm -f /tmp/forensics-untracked-snaprepo-*.tgz' EXIT
SCENES="$TMP/scenes"
bash "$FIX/build-scenes.sh" "$SCENES" >/dev/null

FOR="$SCENES/forensics"; CL="$SCENES/phase0-clean"; CT="$SCENES/phase0-contaminated"
FORENSICS_SKILL="$ROOT/.agents/skills/dsh-incident-forensics/SKILL.md"
GRILLING_SKILL="$ROOT/.agents/skills/grilling/SKILL.md"

echo "== 现场 1：forensics（反向排错现场）=="
WT="$TMP/wt"; mkdir -p "$WT"; cp -r "$FOR/packages" "$FOR/dup" "$FOR/app" "$WT/"
out="$( cd "$WT" && node app/main.mjs src 2>&1 )"
case "$out" in
  *"prepare = undefined"*) printf '  ✓ 工作区版本：症状已被顺手改抹平（%s）\n' "$out"; PASS=$((PASS + 1)) ;;
  *) printf '  ✗ 工作区版本症状不符：%s\n' "$out"; FAIL=$((FAIL + 1)) ;;
esac
HD="$TMP/hd"; mkdir -p "$HD"; cp -r "$FOR/packages" "$FOR/dup" "$FOR/app" "$HD/"
( cd "$FOR" && git show HEAD:packages/consumer/src/index.mjs ) > "$HD/packages/consumer/src/index.mjs"
out="$( cd "$HD" && node app/main.mjs src 2>&1 )"
case "$out" in
  *"TypeError: Cannot read properties of undefined (reading 'prepare')"*)
    printf '  ✓ HEAD 版本：原始症状可恢复（TypeError，exit 1）\n'; PASS=$((PASS + 1)) ;;
  *) printf '  ✗ HEAD 版本未复现原始症状：%s\n' "$out"; FAIL=$((FAIL + 1)) ;;
esac
c "真因在 src（导入 dup 副本）" grep -q 'dup/registry' "$FOR/packages/consumer/src/index.mjs"
c "陈旧产物陷阱：生产路径 run.sh 反而绿" bash "$FOR/run.sh"

echo "== 陈旧产物判据（skill 内联命令，能红能绿）=="
A3="$(block_with "$FORENSICS_SKILL" 'STALE')"
if [ -z "$A3" ]; then
  printf '  ✗ 未能从 dsh-incident-forensics/SKILL.md 抽出陈旧产物命令块\n'; FAIL=$((FAIL + 1))
else
  out="$( cd "$FOR" && bash -c "$A3" 2>&1 )"
  case "$out" in
    *"STALE consumer"*) printf '  ✓ 陈旧 lib 被标红（%s）\n' "${out%%$'\n'*}"; PASS=$((PASS + 1)) ;;
    *) printf '  ✗ 陈旧 lib 未标红：%s\n' "$out"; FAIL=$((FAIL + 1)) ;;
  esac
  case "$out" in
    *STALE*registry*|*STALE*app*) printf '  ✗ 误报（只该报 consumer）：%s\n' "$out"; FAIL=$((FAIL + 1)) ;;
    *) printf '  ✓ 不误报其它目录\n'; PASS=$((PASS + 1)) ;;
  esac
  case "$A3" in
    *"stash create"*) printf '  ✗ 抽出的块里混进了别的 A 步骤（粒度不对）\n'; FAIL=$((FAIL + 1)) ;;
    *) printf '  ✓ 抽出的块只含陈旧判据（未混入快照等其它步骤）\n'; PASS=$((PASS + 1)) ;;
  esac
  touch "$FOR/packages/consumer/lib/index.mjs"
  out="$( cd "$FOR" && bash -c "$A3" 2>&1 )"
  case "$out" in
    *STALE*) printf '  ✗ 重建后仍标红：%s\n' "$out"; FAIL=$((FAIL + 1)) ;;
    *) printf '  ✓ 重建后静默\n'; PASS=$((PASS + 1)) ;;
  esac
fi

echo "== 现场 2/3：Phase 0 两个入口现场 =="
c "clean：无未提交改动" test -z "$( cd "$CL" && git status --porcelain --untracked-files=all )"
c "clean：无陈旧 stash" test -z "$( cd "$CL" && git stash list )"
( cd "$CL" && node check.mjs >/dev/null 2>&1 ); rc1=$?
( cd "$CL" && node check.mjs >/dev/null 2>&1 ); rc2=$?
if [ "$rc1" -eq 1 ] && [ "$rc2" -eq 1 ]; then
  printf '  ✓ clean：复现确定红（两次都是 exit 1）\n'; PASS=$((PASS + 1))
else
  printf '  ✗ clean：复现不确定（rc1=%s rc2=%s）\n' "$rc1" "$rc2"; FAIL=$((FAIL + 1))
fi
c "contaminated：有在途改动" grep -q '^ M src/calc.mjs' <( cd "$CT" && git status --porcelain --untracked-files=all )
c "contaminated：有未跟踪残留" grep -q '^?? src/discount.wip' <( cd "$CT" && git status --porcelain --untracked-files=all )
c "contaminated：有陈旧 stash" grep -q 'stash@{0}' <( cd "$CT" && git stash list )
W8_OUT="$("$FIX/start-writer.sh" "$CT" 8)"; W8_PID="$(printf '%s\n' "$W8_OUT" | sed -n 's/.*pid=\([0-9]*\).*/\1/p')"
sleep 4
if find "$CT/src" -newermt '-6 seconds' -name 'calc.mjs' | grep -q .; then
  printf '  ✓ contaminated：并发写者确实在写（写者每 2 秒 append 一次）\n'; PASS=$((PASS + 1))
else
  printf '  ✗ contaminated：未观察到并发写者\n'; FAIL=$((FAIL + 1))
fi
[ -n "$W8_PID" ] && kill "$W8_PID" 2>/dev/null || true

echo "== Phase 0 的活体写者探针（skill 内联命令，能红能绿）=="
PROBE="$(block_with "$ROOT/.agents/skills/diagnosing-bugs/SKILL.md" 'fingerprint')"
if [ -z "$PROBE" ]; then
  printf '  ✗ 未能从 diagnosing-bugs/SKILL.md 抽出写者探针块\n'; FAIL=$((FAIL + 1))
else
  out="$( cd "$CL" && bash -c "$PROBE" 2>&1 )"
  ga="$(printf '%s\n' "$out" | grep '^A ' | awk '{print $2}')"
  gb="$(printf '%s\n' "$out" | grep '^B ' | awk '{print $2}')"
  if [ -n "$ga" ] && [ "$ga" = "$gb" ]; then
    printf '  ✓ clean：两次指纹一致（判"无写者"）\n'; PASS=$((PASS + 1))
  else
    printf '  ✗ clean：探针误报写者（A=%s B=%s）\n' "$ga" "$gb"; FAIL=$((FAIL + 1))
  fi
  WRITER_OUT="$("$FIX/start-writer.sh" "$CT" 20)"
  WRITER_PID="$(printf '%s\n' "$WRITER_OUT" | sed -n 's/.*pid=\([0-9]*\).*/\1/p')"
  sleep 2
  out="$( cd "$CT" && bash -c "$PROBE" 2>&1 )"
  ga="$(printf '%s\n' "$out" | grep '^A ' | awk '{print $2}')"
  gb="$(printf '%s\n' "$out" | grep '^B ' | awk '{print $2}')"
  if [ -n "$ga" ] && [ "$ga" != "$gb" ]; then
    printf '  ✓ contaminated：两次指纹不同（抓到活体写者）\n'; PASS=$((PASS + 1))
  else
    printf '  ✗ contaminated：探针没抓到写者（A=%s B=%s）\n' "$ga" "$gb"; FAIL=$((FAIL + 1))
  fi
  # 按 pid 收：pkill -f 的模式不会匹配 mktemp 出来的现场路径，而且会误杀别的会话
  [ -n "$WRITER_PID" ] && kill "$WRITER_PID" 2>/dev/null || true
fi

echo "== 现场 4：grilling 种子的查证命令可跑 =="
base="$( cd "$ROOT" && grep -rho '"@deepseek-ai/[^"]*": "[^"]*"' packages/*/package.json | sort -u )"
[ -n "$base" ] && { printf '  ✓ 种子 1（内核基线查询）有输出\n'; PASS=$((PASS + 1)); } || { printf '  ✗ 种子 1 无输出\n'; FAIL=$((FAIL + 1)); }
out="$( cd "$ROOT" && grep -l '"@deepseek-ai/dsh-\(tools\|session\|llm\)"' packages/*/package.json 2>/dev/null )"
[ -z "$out" ] && { printf '  ✓ 种子 2（双实例扫描）clean\n'; PASS=$((PASS + 1)); } || { printf '  ✗ 种子 2 检出：%s\n' "$out"; FAIL=$((FAIL + 1)); }

echo
if [ "$FAIL" -eq 0 ]; then
  echo "skills-functional.test: 全部通过（$PASS 项）"
else
  echo "skills-functional.test: $FAIL 项失败（$PASS 项通过）"
fi
exit "$FAIL"
