# Agent Note: dsh-my-ui 实现（平台服务 + 布局配置）

Status: implemented

## Problem

UI 平台（四区布局 + 插件组合自定义）的 host 服务与布局配置实现。

## Decision

**实现落地（2026-08-21）**：MyUiService 类插件（static Config + default export，cordis 自动注册 ctx.myUi）：
- 四区布局配置（topbar/tabs/sidebar/actions 的 visible/order/size），Config schema（实例级本地配置，cordis.yml 可配）。
- `ctx.myUi.layout()` / `ctx.myUi.region()`：布局查询（默认布局 DEFAULT_LAYOUT，自定义覆盖）。
- 聚合职责：dependencies 拉入 dsh-quick-nav / dsh-tabs（meta 包）。
- client 半区最小注册骨架（布局应用列入 client 集成步）。
- 3 项单测通过（默认/自定义/单区查询）。

## Alternatives

- 完整布局应用（client 渲染驱动）——列入 client 集成步（同其他 UI 插件）。

## Consequences

- 6 个自研插件全部实现（user/channel/console/console-ui/nav/tabs/my-ui）——依赖链完成。
- my-ui 布局配置按实例存（v1 从简）；每用户布局 v2。
