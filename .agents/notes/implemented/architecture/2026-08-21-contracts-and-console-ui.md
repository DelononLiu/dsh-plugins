# Agent Note: 契约按语义分居（channel 基础 + console 管理）

Status: implemented

> 2026-08 两次修正：①撤销独立 contracts 包（契约不适合单独搞一个插件）；②基础契约不放 console（名字承载不了"基础组件"职责）——最终按语义分居。

## Problem

实例档案共享契约的载体。约束：不单独建契约包；基础契约不能塞进业务名（dsh-console）的插件里。

## Decision

**契约类型按语义归属定义，不单独建契约包**：

- **实例基础契约 → dsh-channel**（系统层）：`InstanceIdentity`（id/name/addr/status/health）+ 发现/心跳/状态 @Remote 服务签名——实例首先是通信层发现的实体，channel 名字承载得了。
- **管理档案契约 → dsh-console**（管理组件）：`InstanceRecord extends Identity`（+owner/type/host/version）+ 生命周期/部署 @Remote 服务签名。
- 消费者 `import type`（运行时零依赖）+ `ctx.remote`（client 面）：
  - dsh-nav → channel 的 Identity（导航只需 id/name/addr/status），**依赖降到系统层**（UI → 系统，不碰管理组件）
  - dsh-console-ui → console 的 InstanceRecord（管理界面）

## Alternatives

- 独立 types-only 契约包（dsh-contracts）——否决（修正 1）：契约不适合单独搞一个插件。
- 基础契约全放 console——否决（修正 2）：console 是管理控制台，承载不了"基础组件"语义。
- 全放 channel——否决：owner/type/生命周期等管理概念属管理组件，L2 不该持有 L3 语义。

## Consequences

- 实例概念分层落地：身份/状态（channel）→ 管理档案（console）→ 消费（nav/console-ui）。
- nav 对 console 无依赖（仅 channel）；console-ui 对 console type-only。
- packages/ = 7 自研插件，无独立契约包；profiles bundles 不变（无 contracts 项）。
