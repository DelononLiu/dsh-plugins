# Agent Note: 多 dsh 协同——从主端集群控制到自主协同干活

Status: proposed

## Problem

用户逐步澄清的最终目标：**多个 dsh（可跨主机）相互感知、协同干活**。分解为用户可描述的诉求：

1. 登录**一个主的**（管理端 console）；
2. **便捷部署并启动其他主机上的 dsh**（不用 SSH 手工装）；
3. 最好能在主端**打开其他主机的工作区**直接干活；不能则**便捷跳转**到该主机 dsh 再开工作区；
4. 多 dsh 的**插件升级从主端统一操作**；
5. 最终：多 dsh **自主协同干活**（不只是主从管理，而是对等协作）。

## Decision

**方向（用户已确认，2026-09）**：
- **协作拓扑 = A 星型**：console 是协调者/调度员（它已知全部成员——channel 发现 + launch 配置）。
- **干活形态 = C 两者都要**：干活型（派他机执行命令/查文件，≈远程工具调用，typert RPC 已承载）+ 动脑型（派他机起独立 agent 会话思考，结论回传，需跨实例子会话机制）。
- **信任 = B 显式授权（邀请制）**：协作关系显式建立（owner 发邀请 → 对方接受 → 记录），不是同 owner 自动互信。

**能力线（v1/v2/v3 切分）**：

| 阶段 | 能力 | 内容 | 现有基础 |
| --- | --- | --- | --- |
| v1 | **部署新主机 dsh** | console UI 填 SSH → 调 bootstrap → 显示进度（daemon 上线 → 注册 launch） | `scripts/bootstrap/agent.mjs`（生成令牌/profile/SSH 引导命令）已实现；console `deployInstance` 有骨架 |
| v1 | **统一升级** | 主端选实例 → 推版本（复用 release lock + upgrade 指令）——捡起挂起的"升级回滚" | channel `upgrade` 指令 + dsh.lock.json 版本矩阵 |
| v1 | **便捷跳转** | 点击跳转他机（已在 quick-nav 实现，三实例验证过） | ✅ 已实现 |
| v2 | **远程工作区** | 主端打开他机工作区直接干活（跨实例会话平面共享——官方无此概念，需设计） | 无；§9 预留"远程工作区 = 跨实例继续会话" |
| v3 | **自主协同** | console 当调度员：拆任务 → 挑成员（在线+能力+受邀）→ 分派（干活型 RPC / 动脑型子会话）→ 汇总；A+C+B 模型 | 跨实例 RPC 已实现；缺能力发现/可用性/任务委托协议 |

## Alternatives

- 用社区散件拼（deploy/update/remote 各自单机插件）：无一体化方案，且各是单机视角 → 不满足主端统一管理。
- 对等网拓扑（B）：无中心更"同事互帮"，但 console 已是唯一知道全部成员处、且是 natural 调度点 → 不选，v1 星型。
- 同 owner 自动互信（信任 A）：省事但"B 凭什么帮我干"无边界 → 不选，邀请制。

## Consequences

- dsh-console 从"管理"扩展为"**集群控制台**"（档案/生命周期/部署编排 + 统一升级）——符合其既定定位（管理组件自研主体）。
- v1 全是"补 UI/补链路"（bootstrap 脚本已实现，deploy/upgrade 指令已有），**不需要发明新机制**——是现有地基的整合。
- v2（远程工作区）是最难项（跨实例会话共享，官方无概念），v1 用跳转替代（用户接受）。
- v3（自主协同）是最终愿景，v1/v2 的部署+感知+升级是它的前提（先让多 dsh 存在且可管，再谈协同）。
- 后续推进时：v1 各能力按功能拆 worktree；本 note 从 proposed → implemented（逐项落地时更新）。

相关：[daemon-host-supervisor](../../implemented/architecture/2026-08-22-daemon-host-supervisor.md) · [profile-matrix](../../implemented/process/2026-08-21-profile-matrix.md)
