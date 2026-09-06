# Agent Note: 左侧栏「置顶」会话区——只读镜像固定会话，点击打开

Status: implemented

## Problem

把几个**正在盯的会话**在侧栏里放一个快捷区。dsh-tabs 已把 Alt+P 固定的会话做成顶部
会话 tab 行；用户还要在**左侧栏「会话/工作区列表」之上**再放一块只读「置顶」区，
作为同一批固定会话的第二处常驻入口（非顶部 tab 行、非右侧 better-sidebar）。

## Decision

- **钉仍是 session 操作，数据同源**：置顶区显示的是 dsh-tabs settings 命名空间
  `dsh-tabs-pinned` 的 `pinned` 列表——与会话 tab 行**同一份数据**；钉/取消钉仍由
  dsh-tabs 的 Alt+P（及 tab ×）负责。置顶区**只读**：无钉/取消钉入口。
- **落点在 dsh-tabs client**：`packages/dsh-tabs/src/client/PinnedStrip.ts`（dsh-tabs
  已持有钉数据 + `ctx.sessions.open`，无需动 dsh-desk、不新增 UI slot、不另起包）。
- **挂载 = DOM 注入**（照 dsh-desk 工具入口组装器先例）：MutationObserver 等官方
  侧边栏渲染后，把置顶区插到 sidebar root 的 `regionArea` **之前**（列表区上方）；
  React 重挂/重排导致丢失时自愈重插；折叠（rail，frame 带 `data-sidebar-collapsed`）
  时整区 CSS `display:none`（不干扰窄列图标）；无钉会话/无座位时整区移除。
  **同步必须幂等收敛**：observer 只响应置顶区**之外**的 body 变更（本区写入全部自持，
  被忽略），且每次 sync 在状态/内容未变时**零 DOM 写**——否则「sync 写 DOM →
  observer → sync」微任务自触发死循环会把渲染主线程饿死（发消息出状态点即整页卡死，
  曾现网发生，见 [session-pin-status-sync-convergence](../../implemented/feature/2026-09-06-session-pin-status-sync-convergence.md)）。
- **行派生**：`pinned ∩ 现存会话 ids`（钉序、去重）；标题 = `byId.displayTitle`
  （缺省回退 id）；行可见文本带 `N.` 编号前缀（钉序第 N，与会话 tab 行编号一致；
  行增删自动重编号，tooltip/aria 为纯标题）；当前会话行带标记（标题用会话 tab
  划线的品牌色）。点击行 = `ctx.sessions.open(id)`——与点击左侧会话同一路径，
  dsh-tabs 自己的 current 订阅接着更新 tab 划线等派生状态，两边天然同步。
- **行状态点（对齐官方会话行）**：行首 16px 槽内按官方语义/视觉显示状态点——
  优先级 pending（approval/plan-review/question→warning 橙）> running（ongoing
  追逐矩阵）> 子代理运行计数（ongoing + `N 个子代理运行`）> completed（done 绿）
  > 空闲（无点、槽保位）。数据 = 会话快照 byId 字段（running/completed/blank/
  parentId/origin，纯函数 `indexRunningSubagents` 算子代理链）+ 新依赖
  `uiSession.pendingInteractions` 订阅（pending kind）。tooltip = `状态 · 标题`。
- **视觉**：抄官方侧边栏行契约（Rows.module.css 同款 tokens：行 32px/圆角 8/
  hover `--dsw-alias-interactive-bg-hover`、标题 14px、label 用 `--dsw-alias-label-tertiary`），
  dot 抄 ui-primitives StateDot（done/warning 圆点 + ongoing 追逐动画），不自造风格。
- **测试**：dsh-tabs 新增 `vitest.config.ts`（happy-dom；devDep `happy-dom ^20.11.6`，
  与 dsh-desk/dsh-user 同版本）；`tests/pinned-strip.spec.ts`（DOM 注入/同步/状态点/
  点击/自愈/折叠/disposer）+ `tests/session-status.spec.ts`（纯状态派生/子代理计数），
  全绿 36 用例。
- **明确不做（MVP）**：子树/子 agent 视图；跳右侧 better-sidebar；新快捷键；设置页；
  进 tabs 自动镜像置顶（关 tab ≠ 取消钉，延续旧提案语义）。

## Alternatives

- **顶部「置顶会话」条 / dsh-desk 顶部区摆位**：旧提案（[rejected](../../rejected/feature/2026-09-06-session-pin-top-strip.md)）。
  最终被用户口径取代——放左侧栏列表上方、由 dsh-tabs client 自持，不扩 dsh-desk slot。
- **import/reuse 官方 workspace 行组件渲染置顶行**：数据本在 `ctx.sessions`，自绘轻量
  行即可，避免依赖官方内部组件结构；视觉契约（tokens/几何）仍照抄官方。
- **置顶区提供取消钉入口（如行尾 ×）**：MVP 只读，不扩入口；取消钉继续走 tab 行。

## Consequences

- 纯 client 半区改动，无 host/共享契约变更；UI 层（可替换）内自洽，不进核心契约。
- web2 验收：profile 的 `dsh-tabs` 链接需切到本分支构建并重启实例（会话内自操作
  保护：由外部终端执行 `scripts/dsh-run-fg.sh web2`）。
- 生命周期：订阅/observer/样式均随 `ctx.effect` dispose 释放；无钉时空 DOM 不残留。
- 后续可扩展（非 MVP）：行内右键取消钉；置顶区显隐是否联动布局配置
  `my-ui-layout tabs.visible`（当前不联动）。
