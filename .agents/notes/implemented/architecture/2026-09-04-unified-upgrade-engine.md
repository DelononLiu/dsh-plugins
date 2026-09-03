# Agent Note: 统一升级引擎——console 批次编排 + daemon 事务执行（快照/回滚）

Status: implemented

## Problem

控制台「升级」页是 UI 骨架（假按钮/静态目标版本）；「升级回滚策略」文档已定
（[distro-version-mechanism](2026-08-21-distro-version-mechanism.md)：快照→patch
校验→滚动重启→心跳确认→失败自动回滚，保留 3 份）但无执行者——实例侧的
'upgrade' 控制指令停在 v1 占位（daemon 默认分支不处理）。

## Decision（两级一致：console 决策编排 / daemon 事务执行）

复用 deploy 的两级模型——**daemon 拥有发行包源与进程，是升级执行面**：

### 1. console 批次编排（决策面，typert @Remote）

`upgradeInstances(instanceIds: string[], version: string): UpgradeBatchResult`：
逐实例路由到其守护宿主（`launch[id].host` → 档案 `record.host`），
`sendControl(daemonAgent, { type: 'upgrade', payload: { instanceId, version } })`；
`ok=true` 仅代表已下发（完成态经实例状态 / 事件呈现）。守卫：守护本体
（`host\d+`）与管理端自身不可升级；无宿主 / 守护未注册 / 空版本逐条失败说明。

### 2. daemon 事务执行（执行面，handleDaemonControl 'upgrade' → daemonUpgrade）

1. **快照**：`<dshHome>/.dsh-upgrade-snapshots/<instanceId>/<ts>/` 整体复制实例
   profile 发行包，滚动保留 **3 份**（最新一份即回滚点）；
2. **reconcile 对齐发行包源**：从守护发行包源（`config.templateHome` 对应
   profile——Docker 镜像类比，测试矩阵 = `~/.dsh-web3`）重拷发行包条目
   （package.json/cordis.yml/node_modules…），**保留实例 patch**
   （cordis.patch.yml：端口/令牌/身份不随发行包更新），写版本标记
   `.dsh-release.json`；
3. **滚动重启**：守护子进程 → kill 等退出再拉起；非守护拉起的在线实例 →
   本机端口定位 kill（无 broker 也能停，SSH 一次性引导纪律）等端口释放再拉起；
   离线 → 直接拉起；
4. **健康确认**：有端口 → 轮询监听（500ms×80≈40s；超时但子进程存活视为健康，
   监听可能慢于窗口）；无端口 → 固定宽限；
5. **失败自动回滚**：恢复最近快照；发行包已被替换过（applied）→ 回滚后重启；
   回滚也失败 → 事件带错误留档。

结果经 channel task 平面 `system.upgrade.result` 回流：console 订阅落 inbox
（upgrade.done/失败）+ 同步实例档案 version/health。

## v1 边界（诚实声明）

- **升级以守护本机发行包源为实**：version 参数为记录值（写入实例 .dsh-release.json）；
  多版本发行包源（`releases/<version>`）与真内核/bundle 实体切换 = 二期。
- 单版本源下"升级" = 重新对齐源 + 滚动重启——同时是**实例发行包漂移修复**
  （实例 home 被手动改坏/过期时一键归位）。
- 管理端自身与守护本体（host-*）不可升级（v1）；「部署主机」半自动引导不变。

## Alternatives

- 每实例独立装发行包/推送 profile —— 否决：浪费且 headless 未必有网，复用守护
  本地源（deploy 闭环同模型）。
- 全量停机升级 —— 否决：小团队也要在线，逐实例滚动。
- console 直接执行升级 —— 否决：控制面/执行面分离，执行在 daemon（本地进程与
  发行包源所在）。

## Consequences

- 升级页从骨架变可用：多选实例 → 统一升级 → 逐条下发结果；守护执行快照/回滚，
  实例重启后由守护接管（原独立进程被守护替换——矩阵 E2E 见下）。
- 快照保留 3 份 = 手工回滚点（引擎只自动回滚最近一次）。
- 升级期间实例短暂离线；健康探测通过才视为完成。
- backlog：多版本发行包源、patch 适配校验（target id 在新 rc 存在性）、升级
  进度事件 UI、跨进程 task 事件可靠投递确认。

## 测试

- 单测 +4（共 45）：引擎 happy 路径（快照→对齐→spawn，patch 保留+版本标记）、
  应用失败注入回滚（快照恢复+事件 rolledBack+不重启）、编排路由（launch.host
  下发 payload / 守护未注册·无宿主·守护本体逐条失败）。
- E2E（web2 管理端 → daemon host1 对 web4 升级×2）：daemon 日志完整事务
  （对齐自 ~/.dsh-web3 → 停旧 pid → 拉起 → 3084 健康监听）；`.dsh-release.json`
  version=0.1.2-rc.1；快照 2 份轮转（≤3）。

相关：[deploy-instance-closed-loop](../../proposed/architecture/2026-09-04-deploy-instance-closed-loop.md)
· [daemon-host-supervisor](2026-08-22-daemon-host-supervisor.md) ·
[distro-version-mechanism](../process/2026-08-21-distro-version-mechanism.md)
