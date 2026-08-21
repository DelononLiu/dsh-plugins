# Agent Note: 事件总线投递语义

Status: implemented

## Problem

dsh-channel 的事件总线投递语义未定（at-least-once？顺序？），控制指令类消息必须可靠。

## Decision

**at-least-once + 幂等 + TTL + 退避**（参考 dsh-agent-relay / dsh-weave）：

- **投递语义**：at-least-once；消费者**游标增量轮询 + 租约确认**；消息 **UUID 幂等去重**；7 天 TTL 队列；失败**指数退避重试**（2s/4s/8s…）。
- **事件三平面分类**（参考 dsh-weave）：
  - `control`：request/ack——控制指令（启停/部署/升级）
  - `task`：幂等任务投递（远程工具调用）
  - `session`：仅显式共享的会话同步
- **顺序**：不保证全局顺序（分区内尽力）——控制指令靠幂等 + 回执确认，不依赖顺序。
- Privacy-by-Design：消息体只为本机 TTL 队列留存，不转发他处。

## Alternatives

- exactly-once——否决：跨实例分布式语义成本高，at-least-once + 幂等已满足控制指令需求。
- 全局有序——否决：无全局时钟/单点，成本不成比例。

## Consequences

- dsh-channel 事件总线按此语义实现；§9 事件总线项已勾除。
