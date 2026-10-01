# Agent Note: 插件协作模式（服务提供者/消费者）

Status: implemented

> 2026-08 三次演进：①独立契约包（否决：契约不适合单独搞一个插件）→ ②跟随数据所有者（否决：console 名字承载不了基础职责）→ ③**最终：不提"契约"概念，按插件设计模式表达**。

## Problem

实例类型定义与服务的归属（nav 等 UI 消费者需要读实例数据）。

## Decision

**插件协作模式（DSH 官方 capability seam：Service Definition / Provider / Consumer），不引入独立"契约"概念**：

- **dsh-console 通信面（原 dsh-channel，2026-10 并入本包）= 实例服务提供者**：定义实例类型（id/name/addr/status/health）+ 暴露发现/心跳/状态服务（@Remote，host 面）——实例是通信层发现的对象，放通信面名正言顺（见 [merge-channel-into-console](2026-10-01-merge-channel-into-console.md)）。
- **dsh-console = 实例管理服务提供者**：定义管理档案类型（在 channel 实例类型上扩展 owner/type/host/version）+ 暴露生命周期/部署服务。
- **dsh-console（client 半区）/ dsh-quick-nav = 消费者**：`import type` 引用提供者类型（编译期，运行时零依赖）+ 经 Typert `ctx.remote` 调用（client 面）：
  - dsh-console（client 半区）→ console（管理界面）
  - dsh-quick-nav → dsh-console（导航只需实例身份/状态；type-only 依赖）——保留源码但不随任何 profile 加载，故 **通信面的 @Remote 面当前无客户端消费者**（见 [drop-desk-and-focus-tabs](2026-10-01-drop-desk-and-focus-tabs.md)）。
- 依赖方向向下；"一套概念模型"由提供者唯一定义类型保证。

## Alternatives

- "契约"概念（独立包 / 归属某层）——否决/演进：本质是简单的"谁提供服务、谁消费"，用设计模式语言表达即可，不需要额外概念。

## Consequences

- 文档统一用"服务提供者/消费者"语言（架构 §1、§5、§9 同步）。
- packages/ 自研插件（见 AGENTS.md 分层图）；nav 依赖 dsh-console（type-only，通信面类型同包）、console client 半区依赖 console（type-only），但 nav 不加载时该消费路径无运行时实例。
- **实现落地（2026-08-21）**：ConsoleService（2026-10 起为 dsh-console 的内部管理面，入口改为函数插件 `apply(ctx, config)`：先挂 `ctx.channel`，再按角色挂管理面）；主机/实例档案（InstanceRecord 扩展 InstanceIdentity：owner/type/host/version）、生命周期编排（controlInstance/deployInstance 经 channel.sendControl 回环）、inbox（按 owner 隔离，订阅 channel task 平面 system.* 事件）；8 项单测通过。档案/inbox v1 内存存储；Typert 远程化留待消费端。
