# Agent Note: 多机（broker-free）——console 单入站口 + worker 出站拉取

Status: proposed

## Problem

目标形态（2026-09-11 提出）：总控主机跑**唯一**一个 web 实例（dsh-console + dsh-channel）作为全集群控制面；每台工作主机跑一个 headless daemon（dsh-channel）管理本机 web 实例；实例之间经 dsh-channel 通信；不用 broker。

现状（逐条读码 + 运行态核对）：

1. **跨进程面有两处，都不通用于多机**：
   - 官方 `/api/{ns}/{method}`（client-request 信封）在 web 实例上被 BrowserAuth fence 挡：实测 POST 到 3082/3083 均 `401 unauthorized`。该 fence 由 `dsh-client-connection` 注册在官方 webserver 上的 `/api` prefix 路由承担，**不是全局中间件**；webserver 自身只做 exact → prefix → fallback 分发，插件经 `webServer.register` 注册的 exact 路由先命中，因而连同 Host/Origin 检查一起绕过——实测 `/api/console/instances`(3082) 与 `/api/quick-nav/instances`(3083) 免凭据 200。
   - daemon 的 `ConsoleService.startControlServer`（管理组件里手写的 http server，绑 `127.0.0.1:controlPort`、无凭据校验、分派 5 个方法）是**可用的非 broker 跨进程载体**，`callRemote → directRpc` 直连它即可（daemon.log 有它监听 3089 的记录）。它绑回环、只在 daemon 角色存在，且通信面落在管理组件里（分层不符）。
2. **投递静默**：`sendControl` 在无 relay 时回环本地 handler，console 角色不注册 handler → 空转；relay 已配置但 broker 不可达时 `relaySendControl` 的 catch 吞错 → 同样静默（当前 web2 属后者：进程 env 有 `DSH_RELAY_AGENT`/`DSH_RELAY_BROKER_URL`/`DSH_RELAY_SECRET`）。`upgradeInstances` 另有"守护未注册"显式前置失败，`deployInstance` 没有。
3. **broker 组件在本仓库无实现**：`packages/dsh-agent-relay` 缺失；已部署 home 内 `node_modules/dsh-agent-relay` 是指向该路径的死链；19121 无监听。
4. **channel 无自己的 server**：`register`/`heartbeat`/`declare`/`emit`/`subscribe`/`ack` 均为进程内 API，事件总线无任何远端投递。只有 `list`/`get`/`brokerStatus` 带 `@Remote`，经官方 typert gateway 可 HTTP 到达（即 `directRpc` 的目标面）。
5. **身份与地址语义**：自身身份取自 `ctx.channel.relay?.agent` 或 `DSH_RELAY_AGENT`（不要求 broker 存活——19121 无监听时 3082 仍返回 `self: true`）；实例 id 由 launch/instances 配置的 `declare` 提供。daemon 为本机实例构造的 addr 是 `http://127.0.0.1:<port>`，管理端 `probeLaunch` 直接 fetch 该 addr 判活。
6. **探活已覆盖带 addr 的 host 条目**（当前 host1 的 addr 即 daemon controlPort），判据是"有响应即活"（fetch 不抛就续心跳）——端口被无关进程占用同样算在线；`isPortFree` 硬编码 `127.0.0.1`，仅适用于本机。
7. **console 两个路由无凭据校验**：`/api/console/instances`（GET）与 `/api/console/control`（POST，直通 `controlInstance`）经 `webServer.register` 注册，不读任何凭据——实测无凭据 POST 非法指令得到 `400 unsupported command: bogus`（handler 已执行）。当前只在回环可及；绑 `0.0.0.0` 即等同裸暴露。
8. **注册面默认信任**：`register()` 仅在 `config.tokens[id]` 已配置时才校验，未配置即无条件接受；且 `instances.set()` 无条件覆写 `declare` 写入的 addr。
9. **内核绑定约束**：`webserver.host` 只接受 `127.0.0.1 | 0.0.0.0`。
10. **半完成状态无主**：daemon 的运行时实例清单不持久化，而 `killPortProcess`/`logPathFor`/`listLogFiles` 只认静态清单 → daemon 重启后部署出的实例成为孤儿（进程在跑、端口被占、console 无记录）。
11. **事件参数未生效**：`emit` 只记 `ts`，sweep 用常量 TTL，每事件 `ttl` 实际不起作用；去重表与 inbox 都在内存（重启即重放）。

## Decision

1. **唯一入站面 = console**。worker（daemon 与实例）全部只出站：注册/保活、拉取指令、上报结果、上报事件。console 不拨号 worker，也不需要 worker 的地址与端口——纯出站主机可用，防火墙只需放通 console 一个端口。
2. **控制指令 = daemon 长轮询拉取**：`GET {console}/api/channel/commands?since=<seq>&wait=25s` → 返回定向给该 daemon 的指令批次（commandId、目标实例、动作、载荷）→ daemon 本地执行（复用现成的 `daemonStart/Stop/Restart/Upgrade`）→ `POST {console}/api/channel/result`（commandId、ok、error、观测值）。幂等键 = commandId，daemon 按已执行集合去重。
3. **console 持落盘指令台账**：指令状态 pending/dispatched/done/failed，console 重启后从台账恢复。`sendControl` 契约改为返回入队/路由结果（现状为 void 返回，console 角色下静默）。
4. **注册与归属**：`POST {console}/api/channel/register`（id、instances[{id, profile, port, dshHome}]、上报时间）周期执行，兼作保活与清单刷新。**默认 deny**：`tokens` 未登记的 id 一律拒绝；注册只能声明归属为空或等于自己的实例，冲突显式拒绝 + 审计。归属唯一权威 = console 实例档案的 `host` 字段（launch 配置降为期望态）；`controlInstance`/`upgradeInstances`/`listInstances` 统一读档案。
5. **令牌在 v1 内闭环**：console 用 `crypto.randomBytes` 生成实例令牌，经部署回执/注册响应下发，daemon 以 0600 落盘；console 侧 `tokens` 是唯一登记表。所有 channel 端点（register/commands/result/event/events）与 console 现有控制面（`/api/console/instances`、`/api/console/control`）在 v1 内加校验；控制面默认只绑回环，非回环必须显式开关且强制令牌（浏览器会话级鉴权依赖独立网关，见 [alpha5-auth](2026-09-03-alpha5-auth-official-token-vs-user-login.md)，留 P3）。
6. **在线判定 = 正向存活证据**：daemon 在线 = 最近一次成功注册/长轮询在阈值内；实例在线 = daemon 在注册载荷中上报的本机探测结果（daemon 探本机回环端口，主机相对语义天然正确）。console 不跨机探测 worker 地址，也不要求实例绑非回环来判活。
7. **事件面经 hub 中继**：实例 → `POST {console}/api/channel/event`；console 落 append-only 事件日志 + 单调 seq；订阅方 `GET {console}/api/channel/events?since=<seq>`，游标 = seq；去重（按 event id）随日志持久化；每事件 TTL 生效。平面可见性：control/session 需显式授权，task 默认对同集群实例开放。
8. **地址语义分列两个字段**：`localAddr`（主机相对，daemon 内部与本机探测用）与 `browserAddr`（人可访问 URL，quick-nav/跳转用）。v1 跳转 = 实例 webserver 绑 `0.0.0.0` + `browserAddr` = 主机 LAN IP（内核只允许这两个绑定值）；跳转后的登录仍走官方 `?token=` 手动登录。
9. **不建 peer 面**：不引入推送、服务端验签端、地址通告与逐主机端口分配。

## Alternatives

- **自建直连 peer 面（推送，方案 D）** —— 否决（2026-09-11）：入站面随主机数增长，需要地址通告、逐主机端口分配、服务端验签/nonce/时钟窗口与逐方法授权；而"实例不开面、生命周期全经本机 daemon"一旦定下，唯一必需方向是 console→daemon，该方向可以拉。D 的收益（低延迟推送）不足以换取这些新增攻击面与未决决策。
- **恢复或自建 broker** —— 否决：多一个进程与单点、需分发共享密钥、仍需完整地址表；NAT 穿透与离线队列在"单入站口 + 长轮询"下已基本获得。
- **借官方 `/api` RPC 面直连（携带 token/cookie 过 fence）** —— 否决：实测 401；要维护浏览器会话凭据（`?token=` 每次启动变化），且该 fence 是官方对浏览器划的边界，服务间调用借它等于把内部方法与浏览器凭据绑在一起。
- **每个实例都开 peer 面** —— 否决（2026-09-11 定）：攻击面随实例数放大，且与"控制面/执行面分离"冲突。
- **v1 不做远程跳转**（实例继续绑回环）—— 备选：省掉 LAN 暴露实例 GUI 的决策，代价是跨机只能管不能进；本方案选 0.0.0.0 + `browserAddr`。
- **SSH 反向隧道承载** —— 否决：与"SSH 仅一次性引导"冲突，需常驻隧道进程与凭据。
- **mDNS / 自动发现** —— 否决（§9 已定）：地址由登记获得。
- **新造协议** —— 否决：跨机调用仍是 typert（`InvokeRemoteRequest`/`RemoteResult`）语义，只换 carrier。

## Consequences

- worker 无需入站可达、无需 peer 端口分配与地址通告；令牌单方向（console 签发 → worker 持有）；注册与保活天然携带正向存活证据（"最近一次成功"而非"某端口有响应"）。
- 代价：指令延迟取决于长轮询周期与唤醒方式（秒级，可接受）；console 需落盘台账并在重启后恢复；console 仍是单点（ADR #7 已接受）。
- 安全：入站面收敛到 console，但 console 的两个现存免鉴权路由必须在 v1 内加校验——它们直达 `controlInstance`（含 `upgrade`）。
- 可测性：验收环境必须是容器桥接网络（非 host 网络），loopback 双 home 模拟测不出绑定地址、地址通告、端口冲突、时钟偏差、防火墙与延迟。

## 实施拆解

**v1 = P1a + P1b + P2**；P3 为 v1 之后。

### P1a 控制闭环（先把模型立住，不碰真实跨机）

1. channel 配置与身份：`Config` 增 `id`/`console`/`token`；`selfId` 解析 `id → relay.agent → DSH_RELAY_AGENT`。
2. console 侧自建路由（插件 exact 路由，免 fence）：`/api/channel/register`、`/api/channel/commands`、`/api/channel/result`，带实例令牌校验；默认绑回环，非回环需显式开关 + 令牌。
3. worker 侧出站客户端：周期注册（兼保活）+ 长轮询取指令 + 回传结果；断线退避（指数 + 抖动，间隔与上限可配）。
4. console 落盘指令台账 + `sendControl` 契约改造，同步改 `controlInstance`/`deployInstance`/`upgradeInstances` 调用点与 UI 结果面。
5. 归属与默认 deny：未登记 id 拒绝注册；注册声明归属校验（冲突拒绝 + 审计）；控制与列表统一读实例档案。
6. P1a 指令面只做 `start/stop/restart`；daemon 侧复用现成进程管理，操作进行中回 409。
7. 契约澄清（实现前必须定）：守护/实例 id 命名规则统一（代码 `^host\d+$`、配置为 `host1`、部分文档写 `host-<id>`）；daemon 侧并发上限与"操作进行中"回执语义；配置迁移对 `DSH_RELAY_*` 的 fail-fast 或显式降级。
8. 测试：令牌（缺/错/未登记）、注册合并与冲突、指令幂等（重复 commandId）、长轮询超时与重连、console 重启后台账恢复、`sendControl` 静默丢弃路径的回归用例。

### P1b 部署、升级、状态与日志接同一通道

8. `deployInstance` 经台账下发；daemon 落地后回执；实例清单**落盘**（`<DSH_HOME>/instances.json`）并在启动时 reconcile（报告孤儿进程与端口占用）；`killPortProcess`/`logPathFor`/`listLogFiles` 统一读清单。
9. 状态由 daemon 注册载荷上报；console 不跨机 fetch worker 地址。
10. 日志：`readLog`/`listLogFiles` 改异步语义（现为同步 fallback 空结果，见 [console-structured-log](../../implemented/architecture/2026-09-06-console-structured-log.md)）。
11. 升级：v1 明确"各主机本地发行包源"（现状即如此，见 [unified-upgrade-engine](../../implemented/architecture/2026-09-04-unified-upgrade-engine.md)），console 编排 + 校验各机版本；跨机推发行包 = v1 之后（否则跨机升级验收不可测）。
12. 审计：指令记录发起者（可得用户身份记 id，否则 `system`）、时间、目标、结果。

### P2 事件面（v1 完成）

13. `POST /api/channel/event` + append-only 日志 + 单调 seq；去重随日志持久化；每事件 TTL 真正生效（修 `emit`/sweep 的常量 TTL）。
14. `GET /api/channel/events?since=<seq>` 游标拉取；游标过旧 → 明确"全量重同步"或"报错要求重置"（二选一写进契约）。
15. 平面可见性（control/session 需授权，task 默认开放）+ 跨机 inbox 聚合。

### P3 v1 之后

16. 引导可执行：`bootstrapHost`/`scripts/bootstrap/agent.mjs` 生成 channel 配置（id/console/token），命令序列可执行（`dsh --profile agent-<id>`；官方 CLI 只有 `web`/`plugin`，无 `bootstrap`），并统一两处 bundles 差异（`base+web-app` vs `base+channel+user`）。
17. 令牌轮换/吊销；主机与实例摘除（含 tombstone，避免 keepalive 把已摘除主机注册回来）。
18. 用户级会话鉴权 + 网关联动（依赖网关独立部署）。
19. 跳转自动登录（官方 `?token=` 派发或网关统一登录）。

## 验收

**环境：容器桥接网络（非 host 网络），两容器 = 两台主机。**

- worker 侧无任何入站监听端口；console 只对外开显式启用的端口。
- 无 `DSH_RELAY_*`、19121 无监听：host1/host2 的 daemon 注册后列表可见，其下实例状态由 daemon 上报（实例被杀后状态随之离线）。
- console 对 host2 的 web3 执行 stop/start/restart → 指令经长轮询到达 host2 daemon、本地执行、结果回执进台账；daemon 掉线时指令留在台账并呈现"未送达"。
- deploy 新实例到 host2 → 落地、拉起、回执 ok；daemon 重启后清单从落盘恢复，孤儿进程/端口占用被报告。
- 令牌缺失/错误/未登记 → 拒绝且不执行任何操作；两主机声明同一实例 → 冲突被拒绝并留审计。
- console 重启 → 台账恢复、worker 重连、状态在阈值内回在线。
- 事件：web3 emit task → console 收讫并 ack，重复 id 去重（console 重启后仍去重）；web2 用 `?since=` 拉到该事件。
- 静态测试：`src` 中不得把 `127.0.0.1` 用作通告/绑定值（本机探测辅助除外）；上报给 console 的地址不得是回环。
- 失败路径补测：`nc` 占端口验"假活"、`kill -9` 于升级中途验半完成状态、`tc netem` 验退避与超时。

## 已定范围（2026-09-11）

- 传输形态：**console 单入站口 + worker 出站拉取**；不建 peer 面、不做推送。
- 实例侧控制面：不暴露任何入站面，生命周期全经本机 daemon。
- 事件面：进 v1（P2），订阅用游标 pull（seq），不引入长连接订阅。
- daemon 上行注册：进 v1（P1a）。
- 最小服务间鉴权与令牌生成/登记：**并入 v1**；用户级会话鉴权留 P3（依赖网关独立部署）。
- relay / broker：代码保留为可选后端，主路径不配；新配置出现时对 `DSH_RELAY_*` 做 fail-fast 或显式降级（迁移语义写进实现）。
- 落地方式：另起 worktree 分支（`feat/multihost-channel-pull`），顺序 channel → console（channel 是 console 的下层，先合入再上层接入）。

相关：[multi-dsh-collaboration](2026-09-03-multi-dsh-collaboration.md) · [daemon-host-supervisor](../../implemented/architecture/2026-08-22-daemon-host-supervisor.md) · [unified-upgrade-engine](../../implemented/architecture/2026-09-04-unified-upgrade-engine.md) · [deploy-instance-closed-loop](2026-09-04-deploy-instance-closed-loop.md) · [console-structured-log](../../implemented/architecture/2026-09-06-console-structured-log.md) · [channel-auth](../../implemented/architecture/2026-08-21-channel-auth.md)
