# Agent Note: vendoring 统一 npm 安装（取代 submodule）

Status: implemented

## Problem

原 vendoring 双模式（[2026-08-21-vendoring-policy](../../implemented/process/2026-08-21-vendoring-policy.md)）：轻量单包（dst-agent-teams/dsh-memento）submodule 本地安装；全家桶（dsh-web-ui）npm 安装 + lock 锁版本。用户质疑：npm 有发布版为何还要 submodule？查证确认两个轻量包 npm 均有发布版（dsh-memento v0.4.4、@nanmicoder/dsh-agent-teams v0.1.12），submodule 冗余。

## Decision

- **统一 npm 安装**（2026-08 定）：vendored 插件一律走 `dependencies`（npm 发布版）+ `dsh.lock.json` 锁版本 + `cordis.patch.yml` 补丁层——**不再用 submodule**。
- submodule 仅保留给**无 npm 发布版或需深度改造审查**的例外（当前无）。
- 已移除 submodule：dsh-memento、dst-agent-teams（连同已移除的 dsh-agent-relay），`.gitmodules` 已清空，vendored/ 改为清单 README。
- 两包状态：**选定未接入**（v1 无消费方 / 发行包未来成员），接入时直接加 dependencies + lock。
- 命名/改造/License 纪律不变：社区包保留原名、不 fork、走 patch 层、License 红线同前。

## Alternatives

- 保留轻量单包 submodule（原双模式）：npm 有发布版，submodule 的"源码快照审查"价值未兑现（dsh-web-ui submodule 从未初始化），且拖慢 clone/维护 → 不选。
- 全部移除（含 lock 记录）：两包是文档已定的发行包成员，锁版本记录保留 → 部分保留。

## Consequences

- vendored/ 目录：README 清单（npm 方式），无 submodule。
- dsh.lock.json vendored 段：保留两包版本记录（npm 方式），TBD 项（update-checker/prometheus）不变。
- 接入新社区插件：npm 发布版 + lock + patch 层，无 submodule 流程。
- 相关文档已同步：AGENTS.md（Vendoring policy/仓库布局/命名空间）、architecture.md（§5 矩阵/§9）、vendored/README.md。

相关：[vendoring-policy（被取代）](../../implemented/process/2026-08-21-vendoring-policy.md) · [命名决策](../../implemented/process/2026-08-21-naming-decisions.md)
