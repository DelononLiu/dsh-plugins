# Agent Note: worktree 分支开发流程

Status: implemented

## Problem

大功能开发需要与 main 稳定基线隔离，避免并行开发互相影响（用户明确要求）。

## Decision

**大功能在独立 worktree 分支开发**：

```sh
git worktree add ../dsh-plugins-feat-xxx feat/xxx   # 独立工作目录 + 功能分支
# 开发/自检/提交后：
git merge feat/xxx --no-ff                          # 合入 main
git worktree remove ../dsh-plugins-feat-xxx         # 删除 worktree
```

- main 保持稳定基线：小改动/文档可直接提交；**大功能（跨多文件/多提交）一律走 worktree 分支**，分支命名 `feat/<功能名>`。
- 功能完成自检（typecheck/测试/文档/Agent Note）后合入；合入 = 一个功能单元（见提交规则 note）。
- worktree 是独立目录，各自 `pnpm install`（node_modules 不共享）。

## Alternatives

- 单分支直接开发——否决：大功能中途 main 不可用，并行功能互相干扰。
- 普通分支（非 worktree）——worktree 的额外收益：物理隔离工作目录，同一仓库可同时 checkout 多分支（并行开发不互相污染工作区）。

## Consequences

- 开发流程 = worktree 分支（大功能）+ main 原子提交（小改动/文档）；AGENTS.md「开发流程」章节已写入。
