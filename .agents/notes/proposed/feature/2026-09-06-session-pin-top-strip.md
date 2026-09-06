# Agent Note (proposed): 顶部「置顶会话」条——钉住活的会话，紧贴会话头/tab

Status: proposed（已评审定方向，待实现）

## Problem

右侧 better-sidebar 的「任务管理」页（看当前会话的子 agent/进度）放侧栏不方便。想把几个**正在盯的会话**「置顶」到**工作区上方一条**（紧贴会话头/tab），作为对 session 的快捷入口。与 dsh-tabs 同域（会话即 tab 的实质）。

## Decision（评审后定案）

- **钉 = 对 session 的操作**：`pinned = { sessionId, 展示名, 置顶时间 }`。绑 session 生命周期——**session 失效/结束即从钉列表移除**（不是跨 session 的持久收藏）。
- **持久**：钉列表持久化；**重启后加载时 prune 掉已失效的 session**。
- **显式手动钉**（不做"进 tabs 自动镜像置顶"，避免噪音；两者相关但不同源，关 tab ≠ 取消置顶）。
- **放哪**：dsh-desk 顶部区加一条（dsh-quick-nav / tabs 上方）；dsh-desk 只负责摆位。
- **谁拥有数据/状态**：dsh-tabs 是 tab/会话持有者 → 把"钉"作为 **dsh-tabs 里 session 的一个 pin 状态**（持久化 + 订阅 session 生命周期）。
- **子 agent/进度数据 = 系统的 `ctx.session`**（sessions / sessionId / subagent 树，官方内核；better-sidebar 也读它）——**自研顶部条自己画，不抄/import better-sidebar 内部组件**，仅**视觉参考**其「任务管理」那几行。
- **子树（子 agent 视图）**：若在顶部条内做不了简洁子树，**先不做子树**（不跳右侧、与右侧无耦合）；第一版条内只放钉住的会话入口（聚焦该会话）。

## MVP 范围

1. dsh-tabs：给 session 加显式 `pin` 状态 + 持久化 + 订阅失效移除。
2. dsh-desk 顶部摆一条只读的「置顶会话」胶囊（点＝聚焦该会话）。
3. 自绘数据源 = `ctx.session`；先不做条内子树/快捷键联动。

## Alternatives

- 复用/import better-sidebar 的子树组件 —— 否决：vendored 内部耦合，升级易碎；数据本在 `ctx.session`，自绘即可。
- 进 tabs 自动置顶（镜像）—— 否决：去掉"置顶=显式挑重点"语义，噪音多。
- 置顶做成跨 session 的"收藏任务" —— 否决：用户定要绑 session 生命周期、失效即删。

## Consequences

- 需要一个 UI 层新 slot / dsh-desk 顶部布局扩展（沿用 UI 可替换、不进核心契约）。
- 依赖官方 `ctx.session` 会话/子 agent 数据面（rc.1 内核已暴露，better-sidebar 已在用）。
- 涉及 dsh-tabs + dsh-desk 两个 UI 插件，走 worktree 分支（`.worktree/feat-<…>`）；实现委托 subagent（显式带模型）。
- 待确认实现细节：钉列表落盘位置/键；`ctx.session` 具体取子 agent/进度的 API（以 better-sidebar 消费方式为参考）。
