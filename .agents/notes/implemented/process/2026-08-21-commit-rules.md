# Agent Note: 提交规则（按功能提交，main 分支纪律）

Status: implemented

## Problem

仓库需要统一的提交规范：避免混合提交（无关改动塞一起）、碎提交（临时修改/调试残留）污染 main 历史，保证 main 上每个提交可独立回滚、可追溯。

## Decision

**一个提交 = 一个逻辑单元**（功能/修复/文档/重构），按功能拆分；main 分支纪律：

- 功能开发在**分支**进行，自检通过后合入 main；main 上每个提交必须**可独立成立**（原子、可回滚、不依赖未提交的兄弟改动）；一次合并 = 一个功能，不留半成品。
- 语义化前缀：`feat:` / `fix:` / `docs:` / `chore:` / `refactor:` / `test:` / `style:`。
- 文档与实现同步变更、Agent Note 与实现**同一提交**。
- 提交前自检：typecheck 通过（除已知占位期）、无调试残留、文档同步、已附 Agent Note。
- 提交信息格式：`<prefix>: <摘要>`，正文说明为什么（不是做了什么）。

规则全文见根 AGENTS.md「提交规则」章节。

## Alternatives

- 不设规则，随手提交——否决：main 历史不可追溯，混合提交难回滚。
- 引入 git hook/CI 强制校验（commit-msg 前缀检查、main push 保护）——暂不采用：单人或小团队规模，先靠文档纪律；需要时再加 Lefthook/CI 门禁。

## Consequences

- main 历史 = 按功能组织的原子提交序列，可 `git revert` 单个功能。
- 本仓库既有提交已符合该格式（feat:/docs:/chore: 前缀），无需历史重写。
