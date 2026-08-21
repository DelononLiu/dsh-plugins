# Agent Note: inbox（系统事件消息，实例级）

Status: implemented

## Problem

dsh-console 的 inbox/投递语义未定（目标/格式/落点）。用户确认：**实例级 + 聚焦系统级消息**（事件/异常），非用户聊天。

## Decision

- **实例级**：每实例一份 inbox（console 持久化，按 owner 隔离）；跨实例事件经 channel 同步。
- **聚焦系统级消息**：升级完成 / 任务结果 / 健康异常 / 部署事件——user 类投递（用户间消息）v2 / 业务 app 再做。
- 消息结构：`{id, sender, owner, type, title, body, ts, read}`。
- **投递语义**：复用事件总线（at-least-once + 幂等 + TTL）；跨实例事件经 channel 的 **task 平面**（幂等投递）进入本实例 inbox。
- UI：console-ui 消息区（未读角标 + 列表）。
- v1 归属：console（管理组件）承载，未来可独立为业务 app。

## Alternatives

- 用户级收件箱（跨实例聚合）——否决：需用户级存储 + 多实例聚合，v2。
- user 类消息投递——延后：聚焦系统事件，用户间消息留业务 app。

## Consequences

- console 实现 inbox 存储（持久化 + owner 隔离）+ 消费 channel task 平面事件；console-ui 提供消息区。
- architecture.md 概念模型新增 inbox 小节；§9 无需新增项（决策已定）。
