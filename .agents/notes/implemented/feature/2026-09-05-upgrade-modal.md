# Agent Note: 升级对话框（信息 + 4 步实时进度 + 过程日志）

Status: implemented

## Problem

升级原为「⋯ → 升级到 rc.1」立即执行 + toast——无过程反馈、不知道升级进行到哪，
且用户批评"垃圾设计"，要求看到：基本信息 + 升级操作页 + 过程。

## Decision

完整升级体验（跨插件：daemon + console + client）：

- **daemon**：升级事务每步落盘实例 home `.dsh-upgrade-status.json`
  （{step: snapshot|align|restart|health|rollback|done, done, ok, version,
  message, ts}）——快照/对齐/重启/健康/成功/失败回滚各阶段写状态。
- **console**：新增 `@Remote async getUpgradeStatus(instanceId)`——daemon 读本机
  状态文件；console 角色经 callRemote 转发守护查（async @Remote 可 await，
  typert 支持，brokerStatus 同模式）。
- **client**：行「⋯ → 升级」打开 **UpgradeDialog** modal：
  - 实例信息（名/主机/当前版本 → 目标）
  - 「开始升级」按钮 → upgradeInstances([id]) 下发
  - 4 步进度条（快照✓→对齐→滚动重启→健康探测，doing 转圈/fail 红）驱动自
    轮询 getUpgradeStatus（1s）的 step
  - 过程日志区（每条 message 追加）+ 结果（✓完成 / ✗失败(已回滚)+原因）

## Consequences

- 升级从"无反馈执行"变"可视化事务"：看到进行到哪步、成功/失败/回滚。
- daemon 状态文件 = 跨进程进度载体（事件不跨 relay 的既有约束下，文件 + 轮询）。
- host 侧需 web2/daemon 重启加载新 @Remote；client 刷新即见 modal。
- 测试 68（+2 getUpgradeStatus：无记录/状态文件读取）。
