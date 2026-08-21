# Agent Note: UI 四区布局与皮肤否决

Status: implemented

## Problem

发行包 UI 插件（dsh-nav / dsh-tabs / dsh-my-ui / console 界面）需要统一的布局落点，否则各插件各自注入界面会混乱；皮肤中心（换肤）是否引入也需要定夺。

## Decision

**UI 四区布局**（2026-08 定），发行包 UI 插件分布利用四个区域：

| 区域 | 职责 | 插件 |
| --- | --- | --- |
| 顶部区域 | 全局导航与状态（实例跳转/在线）、全局操作入口 | dsh-nav + 快捷操作 |
| tab 区 | 会话级切换（固定标签 + Alt+1..9 跨工作区） | dsh-tabs |
| 侧边栏 | 工作区/会话树管理 | 官方原生 + better-sidebar 增强（社区） |
| 左侧设置上方按钮区 | 功能区快捷入口（console 管理、inbox/投递、命令面板） | console 入口 + 快捷按钮 |

**皮肤中心否决**：用户明确"不喜欢换皮肤，功能优先"——不引入 dsh-web-ui 的 skin-center v2；dsh-my-ui 自定义维度收敛为**布局 + 插件组合**（vendored 全家桶时可不装 skin-center 包）。

## Alternatives

- 引入皮肤中心（社区成熟方案）——否决：用户无换肤需求，功能优先；少一个依赖面。
- UI 插件各自随意挂载——否决：四区统一规划避免顶栏/侧边栏混乱。

## Consequences

- dsh-nav 定位于顶部区域、dsh-tabs 定位于 tab 区；console 界面入口在左侧按钮区；侧边栏走官方+better-sidebar。
- §9 皮肤中心项已否决勾除；§5 矩阵 dsh-my-ui/全家桶描述去掉皮肤；AGENTS.md 分层图同步。
- vendored dsh-web-ui 时按需组合（不装 skin-center），体现"组合自定义"。
