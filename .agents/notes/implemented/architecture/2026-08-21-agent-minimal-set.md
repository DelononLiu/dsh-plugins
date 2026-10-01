# Agent Note: agent 最小组件集

Status: implemented

## Problem

bootstrap 引导装"最小 agent"（headless host 实例）需要明确的最小组件集清单。

## Decision

**agent = dsh-base + dsh-console（`role: 'agent'`）+ dsh-user**（无管理面、无 UI）：

- `dsh-base`：官方基线（内核启动/生命周期）。
- `dsh-console`（`role: 'agent'`）：只挂通信面——注册/心跳上报/控制指令接收/事件订阅（执行面通道）；通信面 2026-10 随 `dsh-channel` 并入本包（见 [merge-channel-into-console](2026-10-01-merge-channel-into-console.md)）。
- `dsh-user`：实例归属身份。
- **无管理面 / 无 UI 插件**——agent 只执行不管理，控制面/执行面分离的落地。
- 守护可选：dsh-daemon（watchdog + /health，常驻自愈）。

## Alternatives

- agent 带 console——否决：agent 是执行面，管理逻辑在 console（控制面）。
- agent 带 UI——否决：headless，无界面。

## Consequences

- scripts/bootstrap 按此清单部署远程主机最小集；引导后按需装其他组件（升级为完整实例）。
- §9 agent 组件集项已勾除。
