# Agent Note: 会话行尾「⋯」菜单——置顶操作收敛到官方同款菜单

Status: implemented

## Problem

置顶区行尾原本是自绘的两个小按钮：`×`（取消钉）与 `#`（编辑标签）。形态与官方
行尾操作区（`dsh-client-ui-workspace` 的 `.rowActions` + `.iconButton`）不一致；
且**非置顶会话没有"添加到置顶区"的入口**——只能从置顶区移除，不能从别处加入。

## Decision

- **行尾统一为一个官方同款「⋯」菜单**（新模块 `src/client/menu.ts`，两个区共用）：
  - 触发按钮照官方 `.iconButton`：16×16、`--dsw-alias-label-tertiary`、hover
    `--dsw-alias-label-primary`、圆角 4、无边框、三点横排 svg；hover/focus/
    `aria-expanded=true` 时显示（对齐官方 `.rowActions` 的显隐契约）。
  - 弹层照官方 `.menu`：底 `--dsw-specific-menu`、`box-shadow:
    var(--dsw-elevation-prominent)`、`--dsw-elevation-stroke-color:
    var(--dsw-alias-border-l1)`、最大高 `min(360px,100vh - 96px)`。
  - 菜单项照官方 `.cell`：高 40、圆角 10、内边距 `0 10px`、`gap 8`、字号 14/行高 22、
    hover `--dsw-alias-interactive-bg-hover`。
- **置顶区行菜单**：「编辑标签…」+「从置顶区移除」（后者即原 `×` 的语义）。
- **活跃区行菜单**：「编辑标签…」+「**添加到置顶区**」（写回同一份 `dsh-focus-pinned`，
  置顶区行随之出现）。
- **`×` 与 `#` 按钮删除**：行尾只留一个 `⋯`；`makeTagButton` 与 `TAG_BUTTON_ATTR`
  随之移除（已无消费方）。
- 菜单**单例**（同时只开一个）；点菜单外或面板/菜单内按 Esc 关闭；打开时触发按钮
  `aria-expanded=true`，关闭复位。
- 样式注入用引用计数（两区共用一份，任一方卸载不摘掉另一方在用的样式）。

## Alternatives

- **保留 `×` / `#` 双按钮**：用户明确要求把 `×` 换成"和官方工作区一模一样的 ⋯ 菜单"。
- **自绘菜单样式**：违反"UI 默认与官方一致（抄官方）"纪律。否决——形状与配色值全部
  取自官方规则，不自创。
- **把「添加到置顶区」挂到官方侧栏会话行**：当前实例侧栏由 better-sidebar 接管，
  官方 `.sessionRow`/`.projectRow`/`.rowActions` 在页面上数量为 0（浏览器实测）——
  没有可注入的官方行。本仓库自持的活跃区才是"非置顶会话"的现有承载面。

## Consequences

- 标签编辑多一次点击（`⋯` → 「编辑标签…」）。
- 置顶区行的拖拽排序不受影响（整行可拖；菜单按钮的点击在事件委托里被排除）。
- **未接入面**：官方侧栏会话行（better-sidebar 接管时不存在）的「添加到置顶区」——
  若将来要接，注入点应是官方 `.rowActions`/`.sessionRow`（结构取值来源见本文档
  Decision 段与 `menu.ts` 注释）。
- `dsh-focus-pinned` 的写入入口从两个（置顶区 × / Alt+P）变为三个（+ 活跃区菜单），
  仍全部落在同一份 settings 数据上，两区天然同步。
