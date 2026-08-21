# Agent Note: 插件协作模式（服务提供者/消费者）

Status: implemented

> 2026-08 三次演进：①独立契约包（否决：契约不适合单独搞一个插件）→ ②跟随数据所有者（否决：console 名字承载不了基础职责）→ ③**最终：不提"契约"概念，按插件设计模式表达**。

## Problem

实例类型定义与服务的归属（nav 等 UI 消费者需要读实例数据）。

## Decision

**插件协作模式（DSH 官方 capability seam：Service Definition / Provider / Consumer），不引入独立"契约"概念**：

- **dsh-channel = 实例服务提供者**：定义实例类型（id/name/addr/status/health）+ 暴露发现/心跳/状态服务（@Remote，host 面）——实例是通信层发现的对象，放 channel 名正言顺。
- **dsh-console = 实例管理服务提供者**：定义管理档案类型（在 channel 实例类型上扩展 owner/type/host/version）+ 暴露生命周期/部署服务。
- **dsh-nav / dsh-console-ui = 消费者**：`import type` 引用提供者类型（编译期，运行时零依赖）+ 经 Typert `ctx.remote` 调用（client 面）：
  - dsh-nav → channel（导航只需实例身份/状态，依赖降到系统层）
  - dsh-console-ui → console（管理界面）
- 依赖方向向下；"一套概念模型"由提供者唯一定义类型保证。

## Alternatives

- "契约"概念（独立包 / 归属某层）——否决/演进：本质是简单的"谁提供服务、谁消费"，用设计模式语言表达即可，不需要额外概念。

## Consequences

- 文档统一用"服务提供者/消费者"语言（架构 §1、§5、§9 同步）。
- packages/ = 7 自研插件；nav 依赖 channel（系统层）、console-ui 依赖 console（type-only）。
