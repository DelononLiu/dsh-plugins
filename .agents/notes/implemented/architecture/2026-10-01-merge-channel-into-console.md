# Agent Note: dsh-channel 整包并入 dsh-console

Status: implemented

## Problem

通信面（发现/心跳、事件总线 at-least-once、实例令牌鉴权、控制指令通道、hub/worker 多机回路）一直以独立包 `dsh-channel` 存在于系统层，管理面 `dsh-console` 依赖它。这带来四个具体成本：

- **改动总是成对**：console 的 `inject: ['channel']`、每条控制指令、每个实例档案都经 channel；一次"去 broker 化"同时改 channel + console + 配置面，却要跨两个包协调版本。
- **名字撞名**：`dsh-channel` 与社区 `ZinkLu/dsh-channel`（IM 消息渠道）同名异义，每次对外解释都要澄清。
- **构建双份**：typert 的 host/remote 产物按包各生成一份，构建期 generator 跑两遍。
- **部署面多一个条目**：被引导的执行面主机（agent）原本要装 `dsh-channel` + `dsh-user`，profile 里也是两条 insert。

## Decision

**`dsh-channel` 整包并入 `dsh-console`**（2026-10-01 用户拍板 B1）：

- `packages/dsh-channel` 目录删除；`ChannelService` 搬进 `packages/dsh-console/src/channel/`，仍注册为 `ctx.channel`（发现/心跳、事件总线、鉴权、控制指令通道、hub/worker 多机回路原样保留）。
- console 入口从类插件改为函数插件 `apply(ctx, config)`：先挂 `ctx.channel`（通信面），再按角色挂管理面。
- 新增角色 **`role: 'agent'`**：被引导的执行面主机，只挂通信面，不启管理面。
- 配置形状：原 `dsh-channel` 的配置字段整体挪到 console 条目的 `channel:` 子字段——`tokens` / `heartbeatTimeoutMs` / `mode` / `id` / `console` / `token` / `pollWaitMs` / `registerIntervalMs` / `commandLeaseMs` / `ledgerFile`；profile 里不再有 `- id: dsh-channel` 条目。
- `dsh-quick-nav` 的 type 依赖从 `dsh-channel` 改指 `dsh-console`。

## Alternatives

- **用包子路径入口（`dsh-console/agent`）分流** —— 否决：官方 profile 解析器按**目录**找候选包（`packages/boot/app-boot/src/profile-resolution/resolver.ts` 的 `nativePackageDir`：`join(searchPath, name)` + 读 `package.json`），不认包子路径，`role` 也无从按入口拆。改用**同包 role 分流**（`agent` 只挂通信面）。
- **保留两个包，只合并职责** —— 否决：包边界与"通信面/管理面其实是同一台上层下层的两半"继续错位，构建、发布、版本 bump 仍是两套，撞名问题也还在。
- **薄包装包 `dsh-console-agent`** —— 否决：只为 `role: 'agent'` 一个入口多出一个包名、一次发布、一份构建；它依赖 console 才能拿到通信面，解耦只是假象。

## Consequences

- **控制面/执行面分离改为按角色、不按包**：daemon / agent 角色跑的是同一个 `dsh-console` 包，只挂各自那一面（daemon 挂管理面的执行侧，agent 只挂通信面）——"分离"落到角色配置上。
- **分层图系统层只剩 `dsh-user`**：通信面随包进了管理组件层，系统层判据只剩下"身份"这一项基础设施；通信能力本身没有消失，而是内置于管理组件。
- **bootstrap 最小集 = `base + dsh-console + user`**：原 `base + dsh-channel + user` 少一个包条目（见 [agent 最小组件集](2026-08-21-agent-minimal-set.md)）。
- **`DSH_CHANNEL_ID` 环境变量名保留**：改名会波及已部署的活实例与 `scripts/dsh-profile.sh` 的 env 继承，不值当；变量名与包名解耦。
- 分层/包结构与既有 note 的事实同步：见 [分层架构](2026-08-21-layered-architecture.md) · [插件协作模式](2026-08-21-contracts-and-console-ui.md) · [通道鉴权](2026-08-21-channel-auth.md) · [事件总线语义](2026-08-21-event-bus-semantics.md) · [多机拉取](../../proposed/architecture/2026-09-11-multihost-channel-pull.md)。
