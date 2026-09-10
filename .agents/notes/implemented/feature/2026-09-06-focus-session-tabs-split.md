# Agent Note: 会话关注层拆分——dsh-tabs → dsh-focus-tabs + 新建 dsh-focus-session

Status: implemented

## Problem

`dsh-tabs` 一个包承担了两件不同的会话 UI 职责：顶部**会话标签行**（Alt+P 固定、
Alt+1..9 切换、编号标题、状态圆点）与侧栏**「置顶」区**（钉住会话的管理面：拖拽
排序、行尾取消钉）。两者数据同源（`dsh-tabs-pinned`），但定位不同——一个是切换器，
一个是组织面。

用户还要在侧栏继续加能力：**活跃区**（最近活跃的会话，自动、时间序）与**会话标题
胶囊标签**（人工自定义标签）。三件事叠在一个"tabs"名下已经名不副实。

## Decision

- **拆成两个包**：
  - **`dsh-focus-session`**（新）＝ 会话关注层：侧栏「置顶」区 + 「活跃」区 +
    胶囊标签；**拥有**钉住/标签两份 settings 数据。
  - **`dsh-focus-tabs`**（原 `dsh-tabs` 改名）＝ 顶部会话标签行，只读消费同一份
    钉住数据。
- **数据契约**：`dsh-focus-pinned`（钉住列表，顺序即两处行序）与
  `dsh-focus-tags`（会话 → 胶囊标签）由 `dsh-focus-session` 的 host 面注册并
  拥有；`dsh-focus-tabs` 只读同一命名空间（settings 是跨插件共享配置，同命名空间
  各自 bind 即读同一份）。**命名空间只能注册一次**，因此 focus-tabs 的 host 面
  不做注册（`apply` 空实现）。
- **迁移**：拆分前的 `dsh-tabs-pinned` 同样注册（官方 `settings.register` 无只读
  标志、`describe()` 会列出每个已注册命名空间——它并非只读，只是本包除迁移外不写
  它）。client 在旧 scope 就绪（`status === 'ready'`）后搬运一次并**清空旧值**：
  同步读一次快照会在 mirror 完成异步 `describe()` 之前读到空而静默不迁移；不清旧
  值则「全部取消钉」（新空旧非空）会被误判为「尚未迁移」而让旧钉复活。决策抽为
  纯函数 `planPinMigration`（有单测）。
- **活跃区**（`ActiveStrip`）：按官方 `SessionSummary.updatedAt` 降序（会话 list
  本身即按它排序），剔除已在置顶区/子代理（`origin === 'subagent'`）/空白
  （`blank`）会话，上限 5 条；纯派生视图，不写任何 settings。挂载复刻置顶区的
  幂等 DOM 注入（置顶区之后，无置顶区时插到 `regionArea` 前）。
- **命名**：`dsh-focus-*` 前缀（focus = 聚焦/关注的会话）。已实查：npm 无占用；
  社区有 `dsh-focus-chat`（聚焦阅读视图）与 `dsh-plugin-focus`，**语义不同**
  （社区 focus = 专注视图，本仓库 focus = 会话关注层），按 `dsh-channel` 撞名先例
  （dsh- 为自研家族标记）接受并存。
- 状态工具（`session-status.ts`：状态点判定 + 子代理计数）在两个包里**各留一份**
  ——它们是纯函数，而两个 client bundle 各自独立构建，跨 client 包的运行时依赖
  会引入打包/加载耦合，不值得为 ~100 行重复代码买单。

## Alternatives

- **保持一个包、只改名为 dsh-focus-session**：职责仍混在一起，tab 行与侧栏区无法
  独立启用/替换；用户明确要拆。
- **抽第三个公共包 `dsh-focus-core`**（共享状态工具）：多一个包与依赖链，收益只是
  去重复纯函数。否决。
- **`dsh-pinned-sessions` / `dsh-session-pins` 命名**：更贴 pin 语义，但社区已密集
  占用同族名（fallow5/dsh-pin-sessions、PerryLink/dsh-session-pin、
  NattoCB/dsh-plugin-pin-session），且无法覆盖后来加入的活跃区/标签（不只 pin）。
- **活跃区用状态驱动**（运行中/待审批）：用户选了"最近活跃时间序"——自动、
  无需维护，与置顶区（手动）互补。

## Consequences

- 两个包**成对使用**：`dsh-focus-tabs` 读的命名空间由 `dsh-focus-session` 注册，
  单独装 focus-tabs 时命名空间缺失（profile 模板已同时列两者）。
- 会话关注数据的所有权从 tabs 移到 focus-session：改动钉住/标签的入口在
  focus-session（置顶区取消钉/拖拽、标签编辑），focus-tabs 的 Alt+P 仍在 tab 行侧
  写同一命名空间（共享配置，非所有权冲突）。
- 旧 note 的落点事实同步：[session-pin-sidebar-strip](../../implemented/feature/2026-09-06-session-pin-sidebar-strip.md)
  记录的置顶区实现已迁至 `packages/dsh-focus-session/src/client/PinnedStrip.ts`。
- 部署侧：profile 模板（web/web2/web3）、`tsconfig.host.json`、dsh-desk meta 包、
  dsh-console 的 launch 默认 bundles 全部同步；已运行实例需重新安装链接并重启
  （web2 会话内自操作需用户确认）。
- 胶囊标签的渲染与编辑入口见 [session-tag-pills](2026-09-06-session-tag-pills.md)（实现时同属本 worktree 分支）。
