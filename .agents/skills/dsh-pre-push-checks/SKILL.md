---
name: dsh-pre-push-checks
description: Use before pushing, merging a worktree branch into main, or claiming checks pass in this repository (dsh-plugins) — run the repository's standing pre-commit/pre-merge self-checks for the outgoing change
---

# dsh Pre-Push / Pre-Merge Checks

Use this skill to run the repository's standing self-checks once before a push or before merging a worktree feature branch into main. 规则来源：[AGENTS.md](../../AGENTS.md)（提交规则 / 开发流程）。

## Inspect the outgoing change

1. Confirm checkout and branch:

```sh
git status --short --branch
git rev-parse --show-toplevel
```

2. Inspect the change scope（worktree 分支开发时：`git diff main...HEAD --stat`；main 直提时：`git diff HEAD --stat`）。

## 提交前自检（全部通过才 push/merge）

- [ ] **typecheck**：`pnpm typecheck` 通过（除已知占位期——无 src 时 TS18003 属预期；实现类变更必须真过）。
- [ ] **提交规则**：一个提交 = 一个逻辑单元；前缀合规（feat:/fix:/docs:/chore:/refactor:/test:）；main 上原子可回滚。
- [ ] **文档同步**：行为/接口/配置变更的文档（architecture.md / README / AGENTS.md）同提交更新。
- [ ] **Agent Note**：非平凡变更已附 note（.agents/notes/，implemented 用现在时）。
- [ ] **无残留**：无调试残留、无已否决术语残留（如 dsh-hub/dsh-web-ui2/dsh-contracts/皮肤中心/L0-L4）、无依赖悬空。
- [ ] **diff 卫生**：`git diff --check`（无空白错误）；无 node_modules/lib 等产物误入。
- [ ] **依赖方向**：新增依赖符合分层（严格向下；UI 层内部聚合例外）。

## Worktree 合入 main

功能分支自检通过后合入：`git merge feat/xxx --no-ff`（合入 = 一个功能单元）；合入后删除 worktree。合入后验证 main 干净、无冲突残留。

## 失败处理

任何自检失败：停下修复或说明阻塞，不要"先推了再说"。环境相关问题：记录确切命令/失败/平台差异，证明非环境问题后再重试。
