# Agent Note (rejected): 顶部「置顶会话」条——钉住活的会话，紧贴会话头/tab

Status: rejected（2026-09-06 被用户「左侧栏置顶区」口径取代，实现见 [implemented: 左侧栏「置顶」会话区](../../implemented/feature/2026-09-06-session-pin-sidebar-strip.md)）

> 被取代说明：本提案曾定「顶部一条 / dsh-desk 顶部区摆位」；最终实现改为
> **左侧栏「会话/工作区列表」之上的只读置顶区，由 dsh-tabs client 自持**。
> 下列 Problem/曾定决策/Alternatives 作为历史保留——其中「钉 = 对 session 的操作、
> 持久化 + prune、显式手动钉、先不做子树」等语义在最终实现中延续。

## Problem

右侧 better-sidebar 的「任务管理」页（看当前会话的子 agent/进度）放侧栏不方便。想把几个**正在盯的会话**「置顶」到**工作区上方一条**（紧贴会话头/tab），作为对 session 的快捷入口。与 dsh-tabs 同域（会话即 tab 的实质）。

## 曾定决策（已取代，仅作历史）

- **钉 = 对 session 的操作**：`pinned = { sessionId, 展示名, 置顶时间 }`。绑 session 生命周期——**session 失效/结束即从钉列表移除**（不是跨 session 的持久收藏）。
- **持久**：钉列表持久化；**重启后加载时 prune 掉已失效的 session**。
- **显式手动钉**（不做"进 tabs 自动镜像置顶"，避免噪音；两者相关但不同源，关 tab ≠ 取消置顶）。
- **放哪（已改）**：原定 dsh-desk 顶部区加一条（dsh-quick-nav / tabs 上方），dsh-desk 只负责摆位；最终改为左侧栏置顶区（见上 implemented note）。
- **谁拥有数据/状态**：dsh-tabs 是 tab/会话持有者 → 把"钉"作为 **dsh-tabs 里 session 的一个 pin 状态**（持久化 + 订阅 session 生命周期）——此点最终实现沿用。
- **子 agent/进度数据 = 系统的 `ctx.session`**（sessions / sessionId / subagent 树，官方内核；better-sidebar 也读它）——自绘，不抄/import better-sidebar 内部组件，仅视觉参考其「任务管理」那几行。
- **子树（子 agent 视图）**：先不做子树（不跳右侧、与右侧无耦合）；第一版只放钉住的会话入口（聚焦该会话）。

## Alternatives（历史保留）

- 复用/import better-sidebar 的子树组件 —— 否决：vendored 内部耦合，升级易碎；数据本在 `ctx.session`，自绘即可。
- 进 tabs 自动置顶（镜像）—— 否决：去掉"置顶=显式挑重点"语义，噪音多。
- 置顶做成跨 session 的"收藏任务" —— 否决：用户定要绑 session 生命周期、失效即删。

## Consequences（被取代后不再适用）

- ~~需要一个 UI 层新 slot / dsh-desk 顶部布局扩展~~：最终不扩 slot，走 dsh-tabs client DOM 注入。
- 依赖官方 `ctx.session` 会话数据面（rc.1 内核已暴露）——沿用。
- 涉及 dsh-tabs + dsh-desk 两个 UI 插件 → 实际只动 dsh-tabs（独立包，无依赖链阻塞）。
