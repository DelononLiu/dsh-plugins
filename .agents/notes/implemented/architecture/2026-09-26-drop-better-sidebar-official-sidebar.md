# Agent Note: 移除 vendored dsh-better-sidebar——侧边栏一律用官方原生

Status: implemented

## Problem

发行包里 vendored 了社区侧边栏框架 `dsh-better-sidebar`（master 0.15.2 / dev
0.18.0-alpha.0），它接管整个侧边栏（文件/编辑器/终端/Git 面板 + 自带面板 toggle）：

- **与官方 UI 的唯一基准冲突**：本仓纪律是「UI 默认与官方一致（抄官方）」——官方
  组件实现即样式契约；better-sidebar 顶掉官方侧边栏后，侧栏形态、会话行的
  「添加到置顶区」入口（`dsh-focus-session` 的行菜单）等一堆面都变成"未接入面"
  （见 [session-row-menu](2026-09-06-session-row-menu.md) 的未接入项）。
- **升级负担**：0.1.7 内核升级要求把 vendored 全家桶一起 bump（peer 已要求
  ≥0.1.7-rc.2），better-sidebar 目标版本 0.21.1 与我们的自研侧栏关注层职责重叠。

用户决定：**删除该插件，后期都用官方侧边栏**。

## Decision

- 从四个 profile 模板中移除：
  - `profiles/master/package.json`（依赖 + `dsh.profile.bundles`）、`dsh.lock.json` 的 bundles
  - `profiles/dev/package.json`（依赖）、`dsh.lock.json` 的 bundles
  - `profiles/dev/cordis.patch.yml` 的 insert 行（保留同组的 git-graph）
  - `scripts/tests/profiles-templates.test.mjs` 的 `EXPECTED_BUNDLES.master`（模板=启用清单的机械闸门）
- 文档同步：`AGENTS.md` 分层表 UI 行、`docs/architecture.md`（四区布局表 side bar 行 /
  §5 vendored 矩阵 / §9 已实现项 / vendored 清单行）、`docs/community-reference.md`
  里"我们已 vendored"的表述。
- 代码注释同步：`dsh-desk` 的 `AssembledSlotId` 与 `SlotsController` 不再提
  better-sidebar（v1 slots 型插件只剩 git-graph）。
- **运行环境**：web2（`~/.dsh-web2/profiles/web2`，唯一装了它的活环境）同步删除依赖
  与 patch insert；3080/web（`~/.dsh`）与 daemon 本来就没装，不受影响。
- 社区调研结论**保留**在 `docs/community-reference.md`（上游项目的设计参考价值不变），
  只在 vendored 矩阵中标为已移除。

## Alternatives

- **保留但关掉**：侧栏仍由它接管（关掉面板不等于交还官方侧栏），且升级要跟着 bump
  到 0.21.1——用户要的是"都用官方侧边栏"，保留无意义。
- **保留并在 0.1.7 升级里 bump 到 0.21.1**：与"官方唯一基准"冲突，徒增验证面。

## Consequences

- 侧边栏回归官方原生：官方侧栏插槽/会话行重新成为可用面——`dsh-focus-session` 的
  行菜单此前记为"未接入面"的**官方侧栏会话行「添加到置顶区」**从此可以接（待办，
  不属本变更）。
- 0.1.7 升级的 vendored 清单少一项：只剩 `@linxin666/*` 4 包需要随内核 bump。
- web2 下次启动即无该插件；其侧栏文件/编辑器/终端/Git 面板能力随之下线（用户已确认）。
- 已装该插件的既有实例（若有）需自行 `dsh plugin --profile <p> remove dsh-better-sidebar`
  ——本仓只负责模板与活环境。
