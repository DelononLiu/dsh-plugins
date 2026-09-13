#!/usr/bin/env bash
# 搭建 skills 的**功能测试现场**（确定性、可重建）——不是校验语法，而是造出真故障，
# 让 skill 走一遍，看它能不能得出正确结论。期望结论见同目录 GROUND-TRUTH.md。
#
# 产出（默认 $TMPDIR/dsh-skills-fn/）：
#   forensics/            真 bug（模块重复副本 → Symbol 不一致）+ 陈旧产物 lib
#                         + 有人"顺手修过"（TypeError 已变成静默 undefined）→ 证据只剩在 HEAD 里
#   phase0-clean/         干净现场：已提交、复现确定、无并发写者 → Phase 0 应判"干净"
#   phase0-contaminated/  受污染现场：未提交在途改动 + 未跟踪残留 + 陈旧 stash + 活跃写者 → 应判"受污染"
#
# 用法：bash scripts/tests/fixtures/skills-fn/build-scenes.sh [输出根目录]
set -euo pipefail

OUT="${1:-${TMPDIR:-/tmp}/dsh-skills-fn}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
rm -rf "$OUT"; mkdir -p "$OUT"

gitq() { git -c user.email=t@t -c user.name=t "$@"; }

# ---------------------------------------------------------------- forensics
# 真因：consumer 导入了 dup/registry 这份**重复副本**；Symbol("scheduler") 不是注册表
# 全局 Symbol，两份副本各自一个 → ctx[SCHED] 取不到 → undefined.prepare。
# 陷阱：lib/ 是陈旧构建（当初导入的是正规 registry）→ 跑生产路径反而是绿的。
FOR="$OUT/forensics"
mkdir -p "$FOR/packages/registry/src" "$FOR/packages/registry/lib" \
         "$FOR/packages/consumer/src" "$FOR/packages/consumer/lib" \
         "$FOR/dup/registry" "$FOR/app"

REGISTRY='export const SCHED = Symbol("scheduler")

export function createCtx() {
  return { [SCHED]: { prepare: () => 42 } }
}
'
CONSUMER_CANONICAL='import { SCHED } from "../../registry/lib/index.mjs"

export function run(ctx) {
  return ctx[SCHED].prepare()
}
'
CONSUMER_DUP='import { SCHED } from "../../../dup/registry/index.mjs"

export function run(ctx) {
  return ctx[SCHED].prepare()
}
'
MAIN='const target = process.argv[2] === "src"
  ? "../packages/consumer/src/index.mjs"
  : "../packages/consumer/lib/index.mjs"
const { run } = await import(target)
const { createCtx } = await import("../packages/registry/lib/index.mjs")
console.log("prepare =", run(createCtx()))
'
printf '%s' "$REGISTRY" > "$FOR/packages/registry/src/index.mjs"
printf '%s' "$REGISTRY" > "$FOR/packages/registry/lib/index.mjs"
printf '%s' "$REGISTRY" > "$FOR/dup/registry/index.mjs"
printf '%s' "$CONSUMER_CANONICAL" > "$FOR/packages/consumer/src/index.mjs"
printf '%s' "$CONSUMER_CANONICAL" > "$FOR/packages/consumer/lib/index.mjs"
printf '%s' "$MAIN" > "$FOR/app/main.mjs"
cat > "$FOR/run.sh" <<'EOF'
#!/usr/bin/env bash
# 生产路径：跑构建产物 lib/（陈旧但绿）
cd "$(dirname "$0")"; node app/main.mjs lib
EOF
cat > "$FOR/run-src.sh" <<'EOF'
#!/usr/bin/env bash
# 源码路径：跑 src/
cd "$(dirname "$0")"; node app/main.mjs src
EOF
chmod +x "$FOR/run.sh" "$FOR/run-src.sh"

cd "$FOR"; git init -q .
gitq add -A; gitq commit -qm "consumer 构建通过（lib 与 src 一致）"
touch -d '-2 hours' packages/consumer/lib/index.mjs          # lib 构建时间早于下面的 src 提交
printf '%s' "$CONSUMER_DUP" > packages/consumer/src/index.mjs
gitq add -A; gitq commit -qm "consumer: 改用 dup/registry（lib 未重建）"
sed -i 's/ctx\[SCHED\]\.prepare()/ctx[SCHED]?.prepare()/' packages/consumer/src/index.mjs   # 顺手修：症状被抹掉
printf '先别动，我看看\n' > scene-notes.txt

# ------------------------------------------------------------ phase0-clean
# 已提交且复现确定：total 忘了乘数量 → check 稳定红。无人改动 = 干净现场。
CL="$OUT/phase0-clean"; mkdir -p "$CL/src"
cat > "$CL/src/calc.mjs" <<'EOF'
export function total(items) {
  return items.reduce((a, b) => a + b.price, 0)
}
EOF
cat > "$CL/check.mjs" <<'EOF'
import { total } from './src/calc.mjs'
const got = total([{ price: 2, qty: 3 }])
console.log('total =', got, '（期望 6）')
process.exit(got === 6 ? 0 : 1)
EOF
cd "$CL"; git init -q .; gitq add -A; gitq commit -qm "calc + check（总数未乘数量）"

# ----------------------------------------------------- phase0-contaminated
CT="$OUT/phase0-contaminated"
mkdir -p "$CT/src"
cp "$CL/src/calc.mjs" "$CT/src/calc.mjs"; cp "$CL/check.mjs" "$CT/check.mjs"
cd "$CT"; git init -q .
gitq add -A; gitq commit -qm "calc + check（总数未乘数量）"
echo "旧实验" > src/calc.orig
gitq add src/calc.orig
gitq stash push -q -m "别人的半成品"                          # 陈旧 stash（先做，免得把在途改动一起收走）
echo "// 半成品：正在改成优惠价，还没改完" >> src/calc.mjs   # 另一个 agent 的在途改动（未提交）
echo "wip" > src/discount.wip                                # 未跟踪残留

echo "现场已建好：$OUT"
( cd "$FOR" && bash run.sh 2>&1 | tail -1 | sed 's/^/  forensics  生产路径 run.sh     → /' )
( cd "$FOR" && bash run-src.sh 2>&1 | tail -1 | sed 's/^/  forensics  源码路径 run-src.sh → /' )
( cd "$CL"; rc=0; node check.mjs >/dev/null 2>&1 || rc=$?; echo "  phase0-clean        node check.mjs  → exit $rc" )
echo "  phase0-contaminated 并发写者：bash $HERE/start-writer.sh $CT"
echo
echo "对照结论见 $HERE/GROUND-TRUTH.md"
