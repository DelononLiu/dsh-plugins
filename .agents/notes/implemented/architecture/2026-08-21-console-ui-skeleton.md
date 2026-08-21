# Agent Note: dsh-console-ui 骨架（可加载版）

Status: implemented

## Problem

总览/管理界面的 client 半区实现需要官方 client 框架集成（ClientContext / slots 插槽 / React 渲染 / Typert ctx.remote 消费）——这是 4 个 UI 插件（console-ui/nav/tabs/my-ui）的共性工作块。

## Decision

**v1 骨架（2026-08-21）**：dsh-console-ui 提供可加载形态——
- host 面：空 apply（纯 UI 插件，host 占位让插件出现在 Loader）。
- client 面：最小注册骨架（inject ['slots']，apply 预留插槽注册点），经 exports["./client"] + dsh.client 声明挂载。
- 数据面：console（host）服务已就绪（档案/生命周期/inbox）；client 渲染经 ctx.remote 消费——**Typert 远程化 + React/slots 渲染为 client 集成步**（UI 4 插件一起做）。

## Alternatives

- 直接完整实现 React UI——否决：client 构建链（tsdown/JSX/React 依赖 + slots 挂载细节）是独立工作块，先保证依赖链可加载。

## Consequences

- console-ui 可加载（host + client 双入口 + 依赖配置），typecheck/build 通过；完整总览渲染列入 client 集成步。
