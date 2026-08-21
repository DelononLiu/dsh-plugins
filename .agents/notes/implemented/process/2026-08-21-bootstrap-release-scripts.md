# Agent Note: bootstrap / release 脚本实现

Status: implemented

## Problem

部署链路的 SSH 一次性引导（装最小 agent）与版本矩阵 bump 需要可执行脚本。

## Decision

**scripts/bootstrap/agent.mjs**（node 脚本）：
- 生成实例令牌（32 hex，bootstrap 注入 agent，注册/心跳校验——见 channel-auth note）。
- 生成 agent profile（发行包最小集：dsh-base + dsh-channel + dsh-user + 令牌 patch 层——见 agent-minimal-set note）。
- 输出 SSH 引导命令序列（推送 → dsh bootstrap 起 headless 实例 → 确认）。

**scripts/release/bump.mjs**：读 profiles/ 各 dsh.lock.json，bump 自研家族包（dsh-/dst- 前缀）版本（patch/minor/major；rc 阶段只推进 rc 序号），官方/社区保持锁定——跟随 DSH rc 整体升级（见 distro-version-mechanism note）。

测试：node --test，5 项（令牌/profile 生成/SSH 序列/lock bump/rc 处理）。

## Consequences

- 部署链路与版本矩阵有了可执行载体；SSH 执行与 agent 实际拉起由运维/console 触发（脚本输出命令序列）。
- 后续：dsh-daemon 守护、agent 注册接入（channel register）作为 agent 侧实现。
