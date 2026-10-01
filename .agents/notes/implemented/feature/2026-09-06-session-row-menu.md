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
  - 弹层照官方 `ui-primitives` 的 `Menu.module.css` + `MenuSurface.module.css`
    （2026-09-13 更正：此前按 `.menu`/`.cell` 手挑近似值——圆角/最小宽/最大高/层级都
    对不上；2026-10-04 再按 kernel 0.1.7-rc.2 复检，见
    [official-menu-modal-alignment](2026-09-13-focus-strips-official-menu-modal.md)）：
    `padding:4px`、圆角 `--dsw-radius-lg`（16px）、`min-width:144px`、`max-width:360px`、
    `max-height:calc(100vh - 12px - max(12px, var(--dsh-frame-top-clearance, 12px)))`、
    `z-index:1100`、底与模糊在 `MenuSurface` 的 `.material` 层
    （`--dsw-menu-surface-fill` + `backdrop-filter:var(--dsw-menu-backdrop-filter)`）、
    `box-shadow:var(--dsw-elevation-prominent)`、`--dsw-elevation-stroke-color:
    var(--dsw-alias-border-l1)`、内层 `.viewport` 承担滚动。
  - 菜单项照官方 `.item`：`min-height:34px`、圆角 `--dsw-radius-md`（12px）、内边距
    `6px 8px`、`gap 6`、字号 13/行高 20、图标槽 14×14（`--dsw-alias-menu-icon`）、
    hover/focus-visible `--dsw-alias-interactive-bg-hover`、disabled `opacity:.4`、
    danger 用 `--dsw-alias-state-error-primary`（hover `--dsw-alias-interactive-bg-hover-danger`）。
- **两个区行菜单共同的前置项 = 官方会话动作**（2026-10 更新，用户要求去 pin/archive）：
  官方 `rename`(200) / `fork`(300)，同 id/顺序/图标/文案，动作落官方数据面
  （`ctx.uiWorkspace.forkSession` 与官方改名调用路径）——见
  [session-pin-sidebar-strip](2026-09-06-session-pin-sidebar-strip.md)。官方的「置顶会话」
  与「归档会话」**不进关注区菜单**：置顶由本插件的「添加到置顶区 / 从置顶区移除」承担，
  归档在官方会话行里做。
- **两个区菜单项 = `menu.ts` 手写 DOM 克隆，不是官方 `MenuItemButton`**：两个区经 DOM
  注入挂进侧栏，菜单卡片/项按官方 `Menu.module.css`/`MenuSurface.module.css` 的 DOM 结构
  与 CSS 机制手写（含图标槽，图标为 React 节点经独立 root 渲染）；官方 `MenuItemButton`
  只用在 `sessionRowSlot.tsx` 的官方会话行 slot 里。
- **置顶区自研项**：「编辑标签」+「从置顶区移除」（后者即原 `×` 的语义，写回本插件的
  `pinned`）。
- **活跃区自研项**：「编辑标签」+「**添加到置顶区**」（写回同一份 `pinned`，
  置顶区行随之出现）。
- **`×` 与 `#` 按钮删除**：行尾只留一个 `⋯`；`makeTagButton` 与 `TAG_BUTTON_ATTR`
  随之移除（已无消费方）。
- 菜单**单例**（同时只开一个）；点菜单外或面板/菜单内按 Esc 关闭；打开时触发按钮
  `aria-expanded=true`，关闭复位。（2026-09-13 补齐官方 portal 语义：按锚点矩形固定定位、
  开着期间跟随 scroll/resize、指针离开触发按钮与卡片后 200ms 宽限关闭、行保持 hover 底。）
- 样式注入用引用计数（两区共用一份，任一方卸载不摘掉另一方在用的样式）。

## 已接受的偏差

- **rename 弹框自建，但复用官方改名调用**：官方 `RenameSessionMenuItem` 只把请求写进
  ui-workspace 模块私有的 `shortcutControls.rename`（没有对应的客户端服务可拿），本包
  拿不到那个请求 store，因此用官方 `Modal`/`Input`/`Button` 基元自建弹框收集标题；提交
  仍走**官方同一条** `sessions.using(id, { source }, ref => ref.binding.session.rename(title))`
  （即官方 `SessionRenameDialog` 的 `renameSession` 实现）。除弹框外观外无自研逻辑。

## Alternatives

- **保留 `×` / `#` 双按钮**：用户明确要求把 `×` 换成"和官方工作区一模一样的 ⋯ 菜单"。
- **自绘菜单样式**：违反"UI 默认与官方一致（抄官方）"纪律。否决——形状与配色值全部
  取自官方规则，不自创。
- **把「添加到置顶区」挂到官方侧栏会话行**：当前实例侧栏由 better-sidebar 接管，
  官方 `.sessionRow`/`.projectRow`/`.rowActions` 在页面上数量为 0（浏览器实测）——
  没有可注入的官方行。（2026-10：官方行改走官方 slot 注册接入，不再依赖 DOM 可
  注入性——见 [session-pin-sidebar-strip](2026-09-06-session-pin-sidebar-strip.md)。）

## Consequences

- 标签编辑多一次点击（`⋯` → 「编辑标签」）。
- 置顶区行的拖拽排序不受影响（整行可拖；菜单按钮的点击在事件委托里被排除）。
- **官方侧栏会话行**（2026-10 已接入）：「添加到置顶区 / 从置顶区移除」入口经官方 slot
  `sidebar.workspaces.session.menu.item` 注册（只在会话行「⋯」菜单里提供入口，不在行
  hover 动作区加图标），不再依赖 better-sidebar 是否渲染官方行 DOM——见
  [session-pin-sidebar-strip](2026-09-06-session-pin-sidebar-strip.md)。
- `dsh-focus-pinned` 的写入入口从两个（置顶区 × / Alt+P）变为三个（+ 活跃区菜单），
  仍全部落在同一份 settings 数据上，两区天然同步。
