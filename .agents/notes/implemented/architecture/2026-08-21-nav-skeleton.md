# Agent Note: dsh-quick-nav 骨架（可加载版）

Status: implemented

> 现状（2026-10-01）：本骨架已长成完整的顶栏实例下拉（host + client），但 dsh-quick-nav
> 保留源码、不随任何 profile 加载；实例跳转收敛到 dsh-console 面板每实例的「跳转」——见
> [drop-desk-and-focus-tabs](2026-10-01-drop-desk-and-focus-tabs.md)。

## Problem

顶栏实例导航（跳转/在线状态）的 client 半区实现依赖官方 client 框架集成（共性工作块，同 console-ui）。

## Decision

**v1 骨架（2026-08-21）**：host 面空 apply（占位）；client 面最小注册骨架（inject ['slots']）；实例数据源 = channel 实例服务（InstanceIdentity，type-only 引用 + 运行时 ctx.remote——Typert 远程化接入后启用）。渲染与跳转列入 client 集成步。

## Alternatives

- 直接完整实现——否决：client 集成是共性工作块（同 console-ui）。

## Consequences

- dsh-quick-nav 可加载（host + client + 依赖），typecheck/build 通过；顶栏渲染列入 client 集成步。
