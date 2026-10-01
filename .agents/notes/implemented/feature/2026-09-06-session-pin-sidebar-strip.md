# Agent Note: 左侧栏「置顶」会话区——只读镜像固定会话，点击打开

Status: implemented

> 现状（2026-10-01）：`dsh-focus-tabs` 已整包删除，Alt+P 与会话 tab 行不存在；置顶区
> （行菜单 + 拖拽排序 + 取消钉）成为钉住的唯一管理面——见
> [drop-desk-and-focus-tabs](../architecture/2026-10-01-drop-desk-and-focus-tabs.md)。

## Problem

把几个**正在盯的会话**在侧栏里放一个快捷区。dsh-focus-tabs 已把 Alt+P 固定的会话做成顶部
会话 tab 行；用户还要在**左侧栏「会话/工作区列表」之上**再放一块只读「置顶」区，
作为同一批固定会话的第二处常驻入口（非顶部 tab 行、非右侧 better-sidebar）。

## Decision

> 包归属已变：置顶区随 [会话关注层拆分](2026-09-06-focus-session-tabs-split.md)
> 迁到 `dsh-focus-session`（本文下方路径已同步为新位置）。

- **钉仍是 session 操作，数据同源**：置顶区显示的是 dsh-focus-session 的 `pinned`
  列表——聚焦层唯一一份钉数据。置顶区定位 = 钉子集**管理面**：行尾 × / 行菜单取消钉、
  整行拖拽排序写回（顺序即置顶区行序）。
- **落点在 dsh-focus-session client**：`packages/dsh-focus-session/src/client/PinnedStrip.ts`（dsh-focus-session
  已持有钉数据 + 官方 `ctx.uiWorkspace.openSession`，无需动 dsh-desk、不新增 UI slot、不另起包）。
- **官方会话行入口 = 官方 slot 注册**（2026-10 由 DOM 注入改为官方 slot；本机内核
  0.1.7-rc.2 的 `dsh-client-ui-workspace` 向 `ctx.slots` 声明的 `session.menu.item`
  list slot，第三方按 order 插入）：`packages/dsh-focus-session/src/client/sessionRowSlot.tsx`
  把「全局置顶」注册进 `sidebar.workspaces.session.menu.item`（order 500；官方 pin=100 /
  rename=200 / fork=300 / archive=400；第三方在 500+ 追加）。入口只在会话行「⋯」菜单里
  提供，不在行 hover 动作区（`sidebar.workspaces.session.row.action`）加图标。
  点 = 钉入/移出本插件的置顶区（同一份 `pinned` settings，复用两个区的 deps 通道，
  不新建数据模型），故不再有 DOM 注入 / 自愈 / 幂等零写逻辑。
  **两套置顶语义不同、并存**（按官方 0.1.7-rc.2 源码核实，非"官方只作用于工作区"）：
  - 官方图钉把会话 id 写进 `dsh-workspace` registry 的**注册表级** `pinnedSessionIds`
    集合（`ctx.workspaces.list` 快照），效果 = 会话排到**它所在工作的区分组/平铺
    列表的前列**，会话不离开原工作区、不形成跨工作区聚合。
  - 本入口钉入侧栏列表上方**跨工作区的独立置顶区**。
- **可区分**：官方图标集无「跨工作区 + 图钉」复合字形、且官方置顶已占用
  `IconPinOutline/FillRegular`，故本入口复用官方导出 `IconGlobeOutlineRegular`
  （自 `@deepseek-ai/dsh-client-ui-primitives`，不再内联 artwork）——「跨工作区」
  正是与官方行级置顶的语义差别；菜单文案为「添加到置顶区」/「从置顶区移除」。
  本入口在官方 slot 里渲染，菜单行用官方 `MenuItemButton`（16px 图标 + 文案）。
- **两个侧栏区的行菜单前置官方会话动作**（用户决定：只放官方 rename/fork，去 pin/archive）：
  `packages/dsh-focus-session/src/client/sessionActions.tsx` 提供
  rename(200) / fork(300)——同 id、同顺序、同图标、同文案（文案取自官方 zh locale：
  重命名、分叉会话）。官方「置顶会话」与「归档会话」**不进关注区菜单**：置顶由本插件的
  「添加到置顶区 / 从置顶区移除」承担，归档在官方会话行里做。
  - fork 调官方 `ctx.uiWorkspace.forkSession`（官方 `ForkSessionMenuItem.tsx` 的同一入口）。
  - rename 的官方菜单项只把请求写进 ui-workspace 私有的 `shortcutControls.rename`（无
    客户端服务暴露），故本包用官方 `Modal`/`Input`/`Button` 基元自建弹框收集标题，再走
    **官方同一条改名调用路径** `ctx.sessions.using(id, { source }, ref =>
    ref.binding.session.rename(title))`（即官方 `SessionRenameDialog` 的 `renameSession`
    实现）。
  官方动作之后接我们自己的项：编辑标签 + 「添加到置顶区 / 从置顶区移除」（地球字形，写回
  本插件 `pinned`，与官方置顶数据独立）。
  **关注区菜单项 = `menu.ts` 手写 DOM 克隆，不是官方 `MenuItemButton`**（DOM 契约见
  [session-row-menu](2026-09-06-session-row-menu.md)）；官方 `MenuItemButton` 只用在
  `sessionRowSlot.tsx` 的官方会话行 slot 里。
- **挂载 = DOM 注入**（照 dsh-desk 工具入口组装器先例）：MutationObserver 等官方
  侧边栏渲染后，把置顶区插到 sidebar root 的 `regionArea` **之前**（列表区上方）；
  React 重挂/重排导致丢失时自愈重插；折叠（rail，frame 带 `data-sidebar-collapsed`）
  时整区 CSS `display:none`（不干扰窄列图标）；无钉会话/无座位时整区移除。
  **同步必须幂等收敛**：observer 只响应置顶区**之外**的 body 变更（本区写入全部自持，
  被忽略），且每次 sync 在状态/内容未变时**零 DOM 写**——否则「sync 写 DOM →
  observer → sync」微任务自触发死循环会把渲染主线程饿死（发消息出状态点即整页卡死，
  曾现网发生，见 [session-pin-status-sync-convergence](../../implemented/feature/2026-09-06-session-pin-status-sync-convergence.md)）。
- **行派生**：`pinned ∩ 现存会话 ids`（钉序、去重）；标题 = `byId.displayTitle`
  （缺省回退 id）；行可见文本带 `N.` 编号前缀（钉序第 N；行增删自动重编号，
  tooltip/aria 为纯标题）；点击行 = 官方 `ctx.uiWorkspace.openSession(SessionId(id))`——
  与官方左侧栏会话行点击**同一入口**（`UiWorkspace.openSession`，`SessionId(id)` 是内核
  品牌构造，运行时恒等）；内核 `ctx.sessions` 从没有 `open` 方法，不得再接线到它。
- **当前会话行的选中态 = 观察官方侧栏 DOM 反推**（2026-10 实现）：官方
  `ctx.sessions.list` 快照（`SessionListState`）**不含当前选择**——ui-workspace 的
  selection store 是私有的、无公开 client 服务，`SessionRowOwnerProps` 也只有
  `{ sessionId, displayTitle }`，故不能从会话快照取当前会话。唯一可观测来源 = 官方会话行
  自身渲染的选中态（本机内核 0.1.7-rc.2，`dsh-client-ui-workspace` 的 `SessionNodeItem`）：
  行 = `div[role="treeitem"]` + `data-row-key="session:<id>"` +
  `aria-selected={node.id === currentId}`。`packages/dsh-focus-session/src/client/currentSession.ts`
  读出 `[data-row-key^="session:"][aria-selected="true"]` 行的 id，作为两个区行的「当前会话」；
  官方行未渲染 / 属性缺失 / id 为空 → 视为无当前会话（不标记任何行）。
  - **视觉照官方**：选中行底色用官方 `.sessionRow._selected` 同一 token
    `var(--dsw-alias-interactive-bg-hover)`（官方选中只改底色、标题不改色，故不自创标题色）。
  - **ARIA 与官方不同**：官方行是 `role="treeitem"` 才用 `aria-selected`；我们的行是
    `role="button"`——`aria-selected` 在 button 上无效，故用 `aria-current="true"`。
  - **变更观察**：两个区的 MutationObserver 在 `childList/subtree` 之外额外观察
    `attributes` 的 `aria-selected`（官方切会话只改该属性、不产生 childList）；标记写入
    幂等（一致时零 DOM 写）且只写 `aria-current`，不触发自身观察。
- **行状态点（对齐官方会话行）**：行首 16px 槽内按官方语义/视觉显示状态点——
  优先级 pending（approval/plan-review/question→warning 橙）> running（ongoing
  追逐矩阵）> 子代理运行计数（ongoing + `N 个子代理运行`）> completed（done 绿）
  > 空闲（无点、槽保位）。数据 = 会话快照 byId 字段（running/completed/blank/
  parentId/origin，纯函数 `indexRunningSubagents` 算子代理链）+ 新依赖
  `uiSession.pendingInteractions` 订阅（pending kind）。tooltip = `状态 · 标题`。
- **视觉**：抄官方侧边栏行契约（Rows.module.css 同款 tokens：行 32px/圆角 8/
  hover `--dsw-alias-interactive-bg-hover`、标题 14px、label 用 `--dsw-alias-label-tertiary`），
  dot 抄 ui-primitives StateDot（done/warning 圆点 + ongoing 追逐动画），不自造风格。
- **测试**：dsh-focus-session 新增 `vitest.config.ts`（happy-dom；devDep `happy-dom ^20.11.6`，
  与 dsh-user 同版本；官方 `ui-primitives` 在测试期别名到 `tests/stubs/ui-primitives.tsx`，
  因官方发布版 `lib/index.js` 引用未随包发布的 `simple-icons`）；`tests/pinned-strip.spec.ts`
  （DOM 注入/同步/状态点/点击/自愈/折叠/disposer）+ `tests/session-status.spec.ts`
  （纯状态派生/子代理计数）+ `tests/session-row-slot.spec.tsx`（slot 注册元数据/菜单行/
  切换/图标区分）+ `tests/session-actions.spec.tsx`（官方 rename/fork 顺序与文案/
  官方动作落点/rename 弹框）+ 行菜单官方前缀断言 + `tests/wiring.spec.ts`
  （接线层：装配 `apply` 后点击置顶区/活跃区行 → 官方 `uiWorkspace.openSession` 收到该行
  会话 id）+ `tests/current-session.spec.ts`（官方 DOM 反推当前会话：选中行 id / 全 false /
  缺属性 / 空 id / 非会话行 → null；两区标记随官方选中切换、dispose 后观察者停止），
  全绿 130 用例（11 个 spec）。
- **明确不做（MVP）**：子树/子 agent 视图；跳右侧 better-sidebar；新快捷键；设置页；
  进 tabs 自动镜像置顶（关 tab ≠ 取消钉，延续旧提案语义）。

## Alternatives

- **顶部「置顶会话」条 / dsh-desk 顶部区摆位**：旧提案（[rejected](../../rejected/feature/2026-09-06-session-pin-top-strip.md)）。
  最终被用户口径取代——放左侧栏列表上方、由 dsh-focus-session client 自持，不扩 dsh-desk slot。
- **import/reuse 官方 workspace 行组件渲染置顶行**：数据本在 `ctx.sessions`，自绘轻量
  行即可，避免依赖官方内部组件结构；视觉契约（tokens/几何）仍照抄官方。
- **置顶区提供取消钉入口（如行尾 ×）**：MVP 只读、取消钉走 tab 行；后置顶区补齐
  该入口，并随 focus-tabs 删除成为唯一管理面（见上）。

## Consequences

- 纯 client 半区改动，无 host/共享契约变更；UI 层（可替换）内自洽，不进核心契约。
- web2 验收：profile 的 `dsh-focus-session` 链接需切到本分支构建并重启实例。
- 生命周期：订阅/observer/样式均随 `ctx.effect` dispose 释放；无钉时空 DOM 不残留。
- 后续可扩展（非 MVP）：行内右键取消钉。
