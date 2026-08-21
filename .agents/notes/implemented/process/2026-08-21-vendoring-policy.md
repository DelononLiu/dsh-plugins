# Agent Note: vendoring 策略

Status: implemented

## Problem

发行包聚合社区插件（dsh-web-ui 全家桶、dsh-agent-teams），需要明确的引入、标记、改造、升级策略。

## Decision

- **引入方式**：git submodule 锁定 commit/tag（放 `vendored/`），不 copy 源码进 git 历史（避免丢失上游更新）。
- **命名标记**：`dst-*` 前缀 = vendored 第三方，非家族（`dst-agent-teams`）；**例外**：`vendored/dsh-web-ui` 保留社区原名（UI 全家桶来源）。
- **改造方式**：**不 fork**——改造走 DSH 原生 `cordis.patch.yml` 补丁层（配置覆盖、UI 插入点）；社区全家桶自身也是通过官方 profile 机制挂载、不改源码，我们继承同一手法。
- **升级**：随版本矩阵整体推进——submodule bump + 补丁层回归验证（submodule 机制已定：轻量单包本地安装/全家桶 npm 安装 + lock 锁版本）。
- **License**：dsh-web-ui Apache-2.0（fork 允许但需署名）、dsh-agent-teams MIT——vendored 需保留 LICENSE 与出处。

## Alternatives

- 深度 fork 改造（dsh-web-ui2 思路）——否决（2026-08）：fork 要持续同步上游，维护成本高；patch 层够用时优先 patch。
- 上游 PR 合入——长期方向，v1 不阻塞。

## Consequences

- vendored/ 目前为空（dst-agent-teams 标"已装"但仓库未引入——以实际为准，待落地）。
- 皮肤中心 v2（纯资产目录）机制随 dsh-web-ui **不引入**（皮肤否决 2026-08，功能优先）。

相关：[团队发行包定位](2026-08-21-team-distribution-package.md) · [命名决策](2026-08-21-naming-decisions.md)
