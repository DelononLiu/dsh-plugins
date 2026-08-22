# Agent Note: 每主机守护（dsh-console daemon 角色）——启动离线实例的执行面

Status: implemented

## Problem

- `start` 离线实例收不到 broker 消息（进程已死），必须由外部拉起；console 本地 `spawn` 仅限本机。
- 多机管理需要每主机一个执行者；SSH 远程执行被否（入站端口 + 凭据面），选每主机**出站**守护，经统一 broker 通信。
- daemon 若独立成包，与 dsh-console 同属实例生命周期管理，功能重叠、包膨胀。
- `role: 'agent'` 与 broker 的 agent 概念（`x-relay-agent` 头、peers 的 agent 名）语义冲突：所有注册方都是 agent。

## Decision

1. **守护 = dsh 可执行程序 + 极简 profile**（只插 `dsh-channel` + `dsh-console`），不新写二进制。启动方式与实例统一：`dsh --profile daemon`（带 `DSH_HOME` 与 `DSH_RELAY_*`）。
2. **dsh-console 一个包三角色，角色 = 部署位置**：
   - `console`：管理端（档案/inbox/HTTP API/编排，决策面）；
   - `daemon`：主机守护（spawn/kill/追踪子进程，执行面）；
   - `instance`：实例自退兜底（原 `agent` 改名，收到 stop/restart 自退）。
3. **守护登记制**：只管理自己 `instances` 清单内的实例，不扫描主机进程。启动统一收敛到守护；停止双路径——守护拉起的直接 kill，非守护拉起的在线实例经 channel 发 stop 自退兜底；状态各看各的（守护看自己子进程，console 看 broker peers）。
4. **寻址**：守护 agent 名 = `host-<hostId>`；console 的 `launch` 配置加 `host` 字段指向目标守护。
5. **控制路由**（console 决策面 → 执行面）：
   - `start` 有守护配置 → **一律发守护**（守护侧幂等：已在运行则忽略）——不依赖 broker 在线判断，绕开「进程死后 90s TTL 内仍标 online → start 误判 noop」的滞后；
   - `stop` 在线有守护 → daemon kill；在线无守护 → 实例自退；离线 → ack 已离线；
   - `restart` 有守护 → daemon 三分支（见 11）；无守护在线 → 实例自退（需外部拉起）；无守护离线 → 报错。
   - console 投递前检查目标守护是否注册（launch.host 拼错 → 显式失败，不静默丢失）。
6. **dsh-channel relay 加 `stateFile`**：recv 增量游标落盘，防守护重启后重放 broker 积压指令；叠加 daemon 侧幂等（已在运行的实例忽略 start）。
7. **webServer 从静态 inject 移除，改 `ctx.inject(['webServer'])` 等待**：daemon/instance 角色部署在不装 webServer 的 profile 也能加载，保持守护轻量。注：`ctx.get` 在构造时过早（webServer 尚未提供），`ctx.inject` 是 cordis 原生等待机制。
8. **崩溃实例 v1 不自动拉起**（restartPolicy=never）：崩溃保持离线、UI 可见、手动启动；自动拉起（需 crash-loop 保护）放 v2。
9. **UI 实例面板加「主机守护」状态行**：实例列表 API 顺带返回 `host-*` 守护 peers。
10. **deploy 语义**：新实例部署须写入守护 `instances` 清单（v1 占位，随 deploy 实现）。
11. **守护端 restart 三分支 + per-instance busy 锁**（修「重启不生效」竞态）：
    - 守护拉起的实例（children 有且运行中）→ kill（SIGTERM → 宽限 SIGKILL），等 exit 后拉起，watchdog 超时解锁；
    - 非守护拉起的在线实例（守护重启后的孤儿等）→ 发 stop 自退，**轮询端口释放**（`spec.port`，最可靠；未配则固定窗口）后拉起；
    - 离线 → 直接拉起。
    - busy 锁（`Map<id, 'starting'|'restarting'>`）：start/restart 共用，积压指令只处理一次；spawn `error` 与 `exit` 都清理 children（防死条目阻塞后续 start）。
    - 依赖：实例与守护均配 `DSH_RELAY_POLL_PEERS_MS`（实例收件周期默认 30s，stop 投递延迟可控）；分支 2 建议守护 instances 配置 `port`。
12. **relay recv 落盘时序**：先处理全部消息、后推进游标落盘——崩溃在处理中途 → 游标未推进 → 重启重读（重复投递由消费方幂等吸收），保证 at-least-once 不丢指令。
13. **UI 离线覆盖（即时显示）**：broker 对下线判定有 90s TTL 滞后（上线即时、下线滞后）。console 本地 `Map<instanceId, {op: 'stop'|'restart', ts}>`——stop/restart 下发后立即显示 offline；stop 覆盖保持到实例真离线（channel offline）或用户 start；restart 覆盖窗口 15s 后回到 channel 状态（实例已重启完成）。start 下发清除覆盖。

## Alternatives

- **独立 node 守护脚本直接讲 relay wire 协议**：重复实现 HMAC 签名/游标/信封，违背复用纪律 → 否决。
- **每实例一个守护**：每机 N+1 个常驻进程、守护的守护递归 → 否决。
- **独立 dsh-daemon 包**：与 dsh-console 同为实例生命周期管理，功能重叠 → 否决，合并三角色。
- **实例端角色名 `executor`**：用户否决（不佳）→ 用 `instance`（部署位置命名轴：console/daemon/instance 一目了然装在哪）。

## Consequences

- profile 配置：web3 的 `role: agent` → `role: instance`；新增守护 profile（daemon 角色 + `hostId` + `instances` 清单）。
- dsh-console 包级依赖不变；daemon/instance 角色运行时不加载 dsh-user/webServer 逻辑。
- 守护进程无 HTTP 面、不监听端口，只经 broker 出站。
- 实例日志落盘 `~/.dsh-daemon/logs/<id>.log`（守护 spawn 时 append）。
- 后续：`profiles/` daemon 模板 + systemd 常驻；自动拉起 v2；deploy 写清单；守护自身升级经同一通道（v1 占位）。

## 验证（测试环境：~/.dsh-daemon + ~/.dsh-web2/web3 独立 home）

- 守护 profile 只插 `dsh-channel` + `dsh-console`（role: daemon），无 webserver、不监听端口。
- broker peers：`host-lab1` / `web2` / `web3` 在线；实例 API 返回 `{instances, hosts}`（hosts 含 `host-lab1`）。
- `start` 离线 web3 → console 路由到守护 → 守护 spawn → web3 上线（3083 恢复）——核心缺陷（离线收不到 broker 消息）解决。
- `stop` → 守护 SIGTERM kill；`restart` → 守护拉起的 kill+exit+spawn；**守护重启后的孤儿实例 restart → 发 stop 自退 → 端口释放探测 → 拉起**（原始 bug 场景）。
- TTL 内 `start`：kill 后立即 start → 守护即时拉起（不等 broker 90s TTL）。
- 连续两次 restart → busy 锁只执行一轮（第二次「忽略 restart」）。
- UI 即时显示：stop 后 3s 内面板 offline（修复前 90s TTL 滞后）；restart 后 5s offline（重启中）→ 19s online。
- stateFile 防重放：实例侧配 `DSH_RELAY_STATE_FILE` 后，broker 积压指令不再重放（清库重验无自退循环）。
- web3 的 `role: agent` → `role: instance` 生效（收到 stop/restart 自退兜底）。

交叉链接：[channel-link-console-control](../../implemented/architecture/2026-08-22-channel-link-console-control.md) · [console-ui-control-panel](../../implemented/architecture/2026-08-22-console-ui-control-panel.md) · [naming-decisions](../../implemented/process/2026-08-21-naming-decisions.md)
