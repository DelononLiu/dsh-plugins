# Agent Note: UI 四区布局与皮肤否决

Status: implemented

> 现状（2026-10-01）：tab 区（`dsh-focus-tabs`）与 UI 平台 `dsh-desk` 已整包删除，顶部区域
> `dsh-quick-nav` 保留源码但不随任何 profile 加载——四区收敛为下表。决策反转见
> [drop-desk-and-focus-tabs](2026-10-01-drop-desk-and-focus-tabs.md)。

## Problem

发行包 UI 插件（dsh-quick-nav / dsh-focus-session / console 界面）需要统一的布局落点，否则各插件各自注入界面会混乱；皮肤中心（换肤）是否引入也需要定夺。

## Decision

**UI 四区布局**（2026-08 定），发行包 UI 插件分布利用四个区域：

| 区域 | 职责 | 插件 |
| --- | --- | --- |
| 顶部区域 | 全局导航与状态（实例跳转/在线）、全局操作入口 | dsh-quick-nav（保留源码，不随 profile 加载） |
| 侧边栏 | 工作区/会话树管理 + 会话关注区（置顶/活跃/标签） | 官方原生 + dsh-focus-session |
| 左侧设置上方按钮区 | 功能区快捷入口（console 管理、inbox/投递、命令面板） | console 入口 + 快捷按钮 |

原 tab 区（会话级切换，dsh-focus-tabs）已随插件删除；实例跳转收敛到 dsh-console 面板每实例的「跳转」。

**皮肤中心否决**：用户明确"不喜欢换皮肤，功能优先"——不引入 dsh-web-ui 的 skin-center v2；自定义维度收敛为**插件组合**（dsh-desk 已删除，布局配置面随之消失）。

## Alternatives

- 引入皮肤中心（社区成熟方案）——否决：用户无换肤需求，功能优先；少一个依赖面。
- UI 插件各自随意挂载——否决：四区统一规划避免顶栏/侧边栏混乱。

## Consequences

- dsh-quick-nav 定位于顶部区域（保留不加载）、dsh-focus-session 定位于侧边栏关注区；console 界面入口在左侧按钮区；侧边栏走官方原生。
- §9 皮肤中心项已否决勾除；§5 矩阵 dsh-desk/全家桶描述去掉皮肤；AGENTS.md 分层图同步。
- vendored dsh-web-ui 时按需组合（不装 skin-center），体现"组合自定义"。
