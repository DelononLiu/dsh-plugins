# Agent Note: 删除设置「布局」页——区域显隐回归配置缺省

Status: implemented

## Problem

设置页左侧导航里的「布局」页（dsh-desk `settings.section`，含 topbar/tabs/
sidebar 显隐、工具入口与 git-graph 开关）在功能聚焦后不再需要：团队实际使用
面收敛到 dsh-console 与 dsh-focus-tabs，布局微调页无人配置、徒增设置噪音。

## Decision

- **删除「布局」设置页**：dsh-desk client 不再注册 `settings.section('layout')`；
  页面组件 `LayoutControl.tsx` 与其唯一消费者 `LayoutConsumer.ts`（sidebar.
  visible → 折叠官方侧边栏）一并删除（含 layout-consumer 单测）。
- **保留按默认工作的摆位/显隐**：工具入口组装器（foot/会话头顶部摆位）与 slots
  型显隐（git-graph）继续以 `my-ui-layout` 配置**缺省**运行（全部可见/默认摆位），
  不再有页面去改——`my-ui-layout` schema 与 `ctx.myUi`（host Config/settings）
  保留（组装器配置仍来自同一命名空间；实例级 cordis 配置仍可写）。
- **topbar/tabs 显隐回归缺省**：dsh-quick-nav / dsh-focus-tabs 各自读的
  `my-ui-layout.layout.topbar/tabs.visible` 不再有 UI 开关——未显式配置即全部
  可见；官方侧边栏折叠/展开走官方自身 toggle（不再有配置驱动的自动折叠）。
- 旧 LayoutConsumer 能力见
  [2026-08-23-dsh-desk-layout-consumer](../../implemented/architecture/2026-08-23-dsh-desk-layout-consumer.md)
  （已移除，保留决策历史）。

## Alternatives

- 保留页面但隐藏入口：功能已聚焦，留着配置面只会误导「还能调布局」。
- 连 `my-ui-layout`/`ctx.myUi` 一起删：组装器/slots 控制器仍读该命名空间与
  实例 Config，删除会牵动 schema/service/quick-nav/dsh-focus-tabs 的读取契约——超出
  「删页面」的范围，未做。

## Consequences

- 设置页不再有「布局」项；区域显隐只能经实例 cordis 配置/缺省控制。
- 组装器与 git-graph 显隐保持缺省行为；官方侧栏折叠回到官方手动语义。
- dsh-desk client 注入减少（不再需要 slots/layout 服务）。
