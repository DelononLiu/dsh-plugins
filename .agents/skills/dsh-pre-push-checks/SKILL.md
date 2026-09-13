---
name: dsh-pre-push-checks
description: Use before pushing, merging a worktree branch into main, or claiming checks pass in this repository (dsh-plugins) — run the repository's standing pre-commit/pre-merge self-checks for the outgoing change
---

# dsh Pre-Push / Pre-Merge Checks

Use this skill to run the repository's standing self-checks once before a push or before merging a worktree feature branch into main. 规则来源：[AGENTS.md](../../../AGENTS.md)（提交规则 / 开发流程）。

**本 skill 同时是正向链（想法→拷问→规格→实施→**验证**→发布）的验证阶段闸门**：实施与发布之间必过这里（内核升级另加 `scripts/verify-kernel-upgrade.sh`）。方法论与三类约束的区分见 [Agent Note：AICoding 方法论吸纳](../../notes/implemented/process/2026-09-13-aicoding-methodology.md)。

## Inspect the outgoing change

1. Confirm checkout and branch:

```sh
git status --short --branch
git rev-parse --show-toplevel
```

2. Inspect the change scope（worktree 分支开发时：`git diff main...HEAD --stat`；main 直提时：`git diff HEAD --stat`）。

3. **本人改动清单**——确认这次只带上了自己的逻辑单元，没有混入别人的/无关的东西：

```sh
git status --short --untracked-files=all   # 未跟踪残留（临时文件/实验产物）应清掉
git stash list                             # 既有 stash 不是你的改动，别误提交
git worktree list                          # 并行 worktree 在改别的目录：确认没跨目录混提
```

4. **产物同步**——实例跑的是 `lib/`，源码改了没重建 = 陈旧产物（"陈旧产物 = 污染源"）。
   用**提交时间**比，别用文件 mtime（`git checkout` 会刷新 mtime，误报）；lib 不存在时不能拿 0 当真
   （那会把每个包都报成陈旧）：

```sh
for p in packages/*/; do
  c=$(git log -1 --format=%ct -- "$p/src" 2>/dev/null || true)
  l=$(find "$p/lib" -type f \( -name '*.js' -o -name '*.mjs' \) -printf '%T@\n' 2>/dev/null | sort -n | tail -1 | cut -d. -f1)
  if [ -n "$c" ] && [ -n "$l" ] && [ "$l" -lt "$c" ]; then
    echo "STALE $(basename "$p")：lib 最新产物 $(date -d @$l '+%F %T') 早于 src 最后提交 $(date -d @$c '+%F %T') → 先 pnpm build 再验证"
  fi
done
```

## 提交前自检（全部通过才 push/merge）

**机械检查**——用确切命令执行（命令输出即判据，不靠自觉）：

```sh
# typecheck：报错即失败（全为 TS18003 且对应文件无 src = 预期占位，通过）
pnpm typecheck

# diff 卫生：git diff --check 有输出 = 空白错误
git diff --check

# 产物/依赖树误入：有输出即需清理（node_modules/lib/tsbuildinfo/lock 不应是新提交内容）
git status --short | grep -E 'node_modules/|\.tsbuildinfo|/lib/|pnpm-lock\.yaml' || echo clean

# 残留否决术语：只查本次变更新增行（全库含历史决策记录/note/本命令自身，会误报——
# 排除 .agents/skills/dsh-pre-push-checks 与 AGENTS.md 命名决策源）。
# worktree 分支用 main...HEAD；main 直提用 HEAD。
git diff main...HEAD --unified=0 | grep '^+' | grep -v '^+++' \
  | grep -vE '\.agents/skills/dsh-pre-push-checks/|AGENTS\.md' \
  | grep -oE 'dsh-hub|dsh-web-ui2|dsh-contracts|皮肤中心|L0-L4' | sort -u \
  || echo clean

# 官方内核包双实例（Symbol 键服务跨实例不共享 → 工具调用崩，禁止进自研包 dependencies）
grep -l '"@deepseek-ai/dsh-tools"\|"@deepseek-ai/dsh-session"\|"@deepseek-ai/dsh-llm"' \
  packages/*/package.json 2>/dev/null || echo clean

# skills 自身的闸门（本次改到 .agents/skills/** 才跑）：frontmatter / 内联命令块语法 / 相对链接
# 四个来源都看：未提交、已暂存、未跟踪新文件（新 skill 目录）、以及分支上相对 main 的提交
if { git diff HEAD --name-only; git diff --cached --name-only; git ls-files --others --exclude-standard; \
     git diff main...HEAD --name-only 2>/dev/null; } | sort -u | grep -q '^\.agents/skills/'; then
  bash scripts/verify-skills.sh || echo "→ 闸门失败，先修再推（闸门自测：bash scripts/tests/verify-skills.test.sh）"
else echo "未改 skills，跳过"; fi

# 变更范围确认
git diff main...HEAD --stat   # worktree 合入前；main 直提用 git diff HEAD --stat
```

**语义检查**——无命令可替代，逐项人工/模型判断（属"结构化约束/纯判断"，不许伪装成机械闸门）：
- [ ] **提交规则**：一个提交 = 一个逻辑单元；前缀合规（feat:/fix:/docs:/chore:/refactor:/test:）；main 上原子可回滚。
- [ ] **文档同步**：行为/接口/配置变更的文档（architecture.md / README / AGENTS.md）同提交更新。
- [ ] **Agent Note**：非平凡变更已附 note（.agents/notes/，implemented 用现在时）。
- [ ] **依赖方向**：新增依赖符合分层（严格向下；UI 层内部聚合例外）。
- [ ] **验证命令**：有**一条已跑过的命令**能支撑"这个改动是对的"（跑不出的改动不算验证过）。

## Worktree 合入 main

功能分支自检通过后合入：`git merge feat/xxx --no-ff`（合入 = 一个功能单元）；合入后删除 worktree。合入后验证 main 干净、无冲突残留。

## 失败处理

任何自检失败：停下修复或说明阻塞，不要"先推了再说"。环境相关问题：记录确切命令/失败/平台差异，证明非环境问题后再重试。
