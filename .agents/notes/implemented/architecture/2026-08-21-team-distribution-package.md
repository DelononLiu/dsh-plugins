# Agent Note: 团队发行包定位

Status: implemented

## Problem

DSH（DeepSeek Harness）本身是单机开发环境（内核）。团队要使用多个 DSH 实例（多用户、多实例、跨机器），官方不提供"团队开箱即用"的组装物。社区已有个人全家桶（dsh-web-ui-all）和个人复刻包（dsh-plugin-pack-web），但**没有面向团队的发行包**——这是本仓库的差异化定位。

## Decision

**DSH 是内核，本仓库产出面向团队的发行包**：内核（官方 rc 锁定）+ 自研核心插件（系统 → 管理组件 → UI）+ 社区聚合插件（vendored）+ 版本锁。一条命令/一次 clone 得到可用团队环境。

- **分发形态**：(c) 完整 profile 模板——git clone 现成 profile 目录直接用（非 meta npm 包、非 manifest 驱动）。
- **版本矩阵**：发行包 = 内核 rc.x + 自研插件 x.y + 社区插件 a.b 的锁定组合，跟随 DSH rc 整体 bump，不散装升级。

## Alternatives

- **单插件集合**（只发几个独立插件，不做发行包）——否决：无法保证组合兼容（版本矩阵），团队上手成本高。
- **meta npm 包分发**（`dsh plugin add <发行包>` 装齐）——否决：版本锁定与升级路径不如完整 profile 模板直观，且与社区插件包形态重复。
- **monorepo 学官方二级结构**（packages/<domain>/<leaf>）——否决（2026-08 用户明确）：目录结构不必照搬官方，按本仓库规模用一级结构。

## Consequences

- 仓库 = 发行包源码（packages/ 自研 + vendored/ 社区 + profiles/ 模板 + scripts/ bootstrap/release）。
- profiles/web 是分发的核心，dsh.lock.json 是版本矩阵的机器可读形式（格式未定，见开放问题）。
- 团队部署、升级、实例创建都围绕"发行包模板"展开——模板即实例种子。

相关：[分层架构](2026-08-21-layered-architecture.md) · [部署链路](2026-08-21-deployment-chain.md)
