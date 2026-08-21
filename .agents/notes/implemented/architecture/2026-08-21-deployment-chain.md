# Agent Note: 部署链路（SSH 引导 → agent → channel）

Status: implemented

## Problem

dsh-console 要管理远程主机上的实例（部署/创建/启停/升级），需要解决两条关键问题：主机上还没有任何可指挥对象时的"鸡生蛋"引导问题；以及 console 持有主机凭据的安全风险。

## Decision

**混合方案，默认向 agent 倾斜**：

```
SSH（仅一次性引导）──► 装最小 agent ──► 之后全走 agent/channel
```

- **最小 agent 形态**：发行包的 headless host 实例（无 web UI 的最小组件集），即远程主机的常驻代表。agent 即 DSH 实例——可随时升级为完整实例直接调试，扩展能力不加新协议。
- **凭据不出主机**：SSH 只用于一次性引导（局域网内零成本）；日常管理 console 只对接 agent，凭据留在各主机本地。
- **管理通道**：console → agent 的结构化指令（deploy/create/stop/start/upgrade，typert RPC），agent 本地执行并回传结构化回执；心跳经 channel 上报。
- **console 单控制面**：v1 接受单点（console 自身跑在一个 host 实例上），不做接管机制，设计上留扩展余量。
- **网络环境**：小团队局域网——SSH 引导与 agent 出站通信均简单，无需 NAT 穿透方案。

## Alternatives

- **全程 SSH**（console 持所有主机凭据，命令流管理）——否决：凭据集中（console 被攻破=全部主机沦陷）、非结构化 shell 流（多平台差异大）、主机 NAT 后不可直连、权限粒度粗（shell 全权）。
- **纯 agent 出站**（连引导都不碰 SSH）——备用：仅当主机完全在 NAT 后且 console 无公网时采用（人肉/脚本预装 agent）。

## Consequences

- 部署状态机：主机登记 → SSH 引导装 agent → agent 上线注册 → 按需创建实例 → 升级（版本矩阵整体推进）→ 下线/移除。
- agent 最小组件集清单未定（bootstrap 脚本依赖它，见 AGENTS.md 未定项 5）。
- 升级只有滚动重启，**回滚策略未定**（未定项 3）。

相关：[团队发行包定位](2026-08-21-team-distribution-package.md) · [实例模型](2026-08-21-instance-model.md)
