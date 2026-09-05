# Agent Note: 实例行「⋯ 更多」菜单——批量升级改单实例操作

Status: implemented

## Problem

实例页顶部"批量升级"按钮 + 展开勾选面板 + 长说明文字，UI 冗余且不符合
"常规列表"直觉（用户：好的 UI 一看就懂）。升级是单实例操作，不该用
批量勾选面板承载。

## Decision

- 实例列表回归常规列表：行尾 [跳转][停止/启动][重启] + **「⋯ 更多」下拉**。
- 「⋯」菜单：升级到 0.1.2-rc.1（单实例执行，调 host.upgradeInstances([id])，
  结果 toast + 行状态轮询收敛）。当前实例（self）不显示「⋯」。
- 删除：顶部"批量升级"按钮、showUpgrade 面板、勾选模式（checked/onSelect/
  upgradeSel/upgradeTarget 批量状态、runUpgrade、toggleUpgradeSel）。
- 菜单样式 dsh-console-menu-item（对齐 alias token）；点击外部关闭。

## Consequences

- 升级入口收敛到每实例行「⋯」→ 单实例升级，语义直接。
- 实例列表每行操作 = 常用（启停/重启/跳转）+ 更多（升级…）——标准列表形态。
- host/typert 契约不变（upgradeInstances 仍支持多，UI 单实例调用）。
