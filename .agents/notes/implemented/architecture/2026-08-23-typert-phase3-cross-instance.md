# Agent Note: typert 第三期——跨实例 RPC（channel 传输路由 + 自研跨主机投递）

Status: implemented

## Problem

typert 第一二期已打通**同 host** 链路（channel/console @Remote → gateway `/api` RPC）。第三期目标：**跨实例方法调用**——console（web2）调 web3/web4/daemon 实例的 typert 方法（如 `console.controlInstance` 直达目标、daemon 的实例管理方法）。

## 调研结论（rc.2 源码确认，2026-08）

**typert 跨主机：协议支持、传输未实现**：
- `InvokeRemoteRequest` carrier-independent（"after a carrier has decoded its envelope"）——调用帧不绑定主机。
- `TypertLookup<Host, Wire>`：Wire 身份任意泛型——lookup resolver 可把 id 解析到任意目标（官方默认 = 本地 Agent，单进程假设）。
- 官方 Connection `/api` RPC **只连本地 host**——无远程地址路由；官方无多进程模型（无 relay/broker 包）。

**结论**：跨主机调用 = **typert 做调用协议（现成）+ channel 自研传输路由（我们的分层定义）**。

## 现状（可复用）

- **channel 已实现 broker 消息投递**：`relaySendControl`（POST /messages，kind=request 承载控制指令）+ `relayRecvControls`（GET /messages 轮询触发 onControl）——**已有跨进程消息通道（broker）**。
- **目标侧已收控制**：daemon/instance 角色 `ctx.channel.onControl` → 本地执行。
- **channel @Remote**：list/get/brokerStatus 已可同 host 调用。

## Decision（第三期方案）

### 核心：channel 新增「实例 RPC」——`callRemote(instanceId, namespace, method, args)` 

复用 broker 消息通道承载 typert 帧（**先走 broker，直连后续**）：

```
console（web2）                                web3/daemon
ctx.remote.channel.callRemote('web3', 'console', 'listInstances', {})
  → channel 组 typert 调用帧（namespace/method/args）
  → relaySendControl 扩展为「RPC 帧」（kind=request, body.rpc={ns,method,args}）
  → broker 投递 web3
                                               channel 收到 RPC 帧
                                               → 调本地 typert gateway invoke（同 host 机制）
                                               → relaySendControl 回执（replyTo）
  → relayRecvControls 收到回执 → Promise resolve
```

### 分阶段

**阶段 A（本方案）：基于 broker 的请求-回执 RPC**
1. **channel 帧扩展**：`relaySendControl` 支持 `kind: 'request'` + `body.rpc = { id, namespace, method, args }`（复用消息通道，新增 RPC 语义）。
2. **channel 收侧**：`relayRecvControls` 识别 RPC 帧 → 目标侧 channel **调本地 typert gateway invoke**（`ctx.typertGateway.invoke(InvokeRemoteRequest)`——目标实例的 gateway 已存在）→ 结果经 `replyTo` 回执。
3. **callRemote API**：channel 暴露 `callRemote<T>(instanceId, namespace, method, args): Promise<RemoteResult<T>>`（Promise + 回执关联，请求-回执超时）。
4. **console 消费**：`controlInstance` 内部改 `ctx.channel.callRemote(instanceId, 'console', 'controlInstance', ...)` 直达目标（替换当前 sendControl 单向下发）——**拿到目标回执**（现在 sendControl 无回执）。
5. **鉴权**：复用 broker 的 HMAC 签名（已有 x-relay-* 头）+ 实例令牌（目标侧校验调用方）。

**阶段 B（后续）：直连 transport**
- 目标实例 addr 可达时，channel `callRemote` 直连目标 `/api` RPC（HTTP/WS）——绕过 broker（低延迟）。
- transport 选择策略：可达→直连，不可达/daemon 出站→broker。

### 边界

- **同 host 调用**（浏览器→本地）继续走 `ctx.remote`（第一二期机制，不经过 callRemote）。
- **跨实例**：console 业务层经 `callRemote` 显式指定目标（实例 id），channel 负责路由。
- **事件面**（forwardable events ↔ channel 三平面）：第三期先不接（回执 RPC 已足够 console 控制闭环），事件映射留第四期。

## Alternatives

- **官方 @RemoteScope**：官方语义是**单进程多 agent 上下文**（agent 是进程内对象）——不解决跨进程。我们跨实例是**跨进程**，须自研传输路由（方案如上）。@RemoteScope 可作为同进程 scoped 增强（阶段 C，低优先）。
- **直连优先**：目标需开放入站（daemon headless 无 webserver 不适用）→ broker 先做，直连后续。

## Consequences

- channel 成为 typert 的**跨实例传输底座**（分层落地：typert 帧经 channel，broker 可选后端）。
- console 控制指令从"单向下发"升级为"请求-回执"（拿到目标执行结果）。
- broker 消息通道扩展 RPC 语义（与现有 control 指令共存）。
- 阶段 B 直连 + 事件面后续。


## Implementation（2026-08-23 落地）

- **channel.callRemote**：InvokeRemoteRequest 帧 + RemoteResult 回执（复用官方协议类型，不定义新 RPC）；传输双路径（broker 可选）：目标 addr 可达 → 直连 HTTP RPC（POST {addr}/api/...，官方 client-request 信封）；不可达 → broker 消息通道帧。目标侧经本地 ctx.typertGateway.invoke 执行（daemon 的 dsh-base 含 gateway，headless 也可用——invoke 纯进程内）。
- **console.controlInstance**：daemon/instance 路由改 callRemote 直达目标 console.controlInstance（目标侧本地执行 + 回执）；不可达降级 sendControl。
- **目标侧部署要求**（用户确认）：目标实例/守护装 dsh-console（@Remote 管理方法）+ dsh-channel（callRemote 接收）+ 完整 typert 运行时（daemon 的 dsh-base 自带 gateway/loader）。
- **验证**：116 测试全绿（含降级路径）、全仓 typecheck/build 全绿；直连信封 web2 实测可达。
- **剩余**：transport 选择策略细化（当前 addr 可达即直连）、typert forwardable events ↔ channel 三平面映射（事件面）。

### 联调落地事实（2026-08-23 目标侧部署，三实例真实互联）

- **listInstances boundary**：HostRecord.version 必填而 peers 无版本 → hosts 组装补空串。
- **remoteControl wire args**：必填 payload 参数（target 侧校验）→ args 补 `payload: {}`。
- **daemon 角色 RPC 面执行**：daemon 经 callRemote 收到 controlInstance → 本机清单内实例直接本机执行
  （复用 handleDaemonControl），不落入 console 决策路由（否则无 launch → route=instance 转发回实例）。
- **目标实例自退短路**：RPC 到达本机（instanceId === relay.agent）直接自退，杜绝 RPC 递归。
- **接收端积压判定**：ControlCommand 带发送时间戳 ts（sendControl 自动打）——事件面按
  `ts < 实例启动时刻` 忽略积压旧指令（broker 持久队列补投的旧 stop/restart 会"起来就被杀"），
  当前指令（ts ≥ 启动）照常执行；RPC 面无 ts（官方协议不加字段）→ 保留启动窗口（45s）兜底。
  注：去 broker 后主路径（直连 RPC + 本机进程管理）无持久队列，积压仅存在于 broker 兜底路径。

### 去 broker 化（2026-08-23，用户确认"broker 仅作兜底"）

- **实例发现权威源 = 管理端**：console 构造时把 launch 配置（实例矩阵）逐条 `channel.register`
  （带 addr）；daemon 把 instances 清单同样注册（本机实例 addr 用 `127.0.0.1:port`）。
  删除 channel 的 peers 轮询填充（peers 无地址信息，轮询覆盖会让 callRemote 直连失效）。
- **直连状态探测**：注册即 online，但无心跳续期会被 sweep（30s）误标离线 → 管理端/daemon
  周期（15s）探测 addr 可达性，可达 → `channel.heartbeat` 续期；不可达不续期（sweep 标离线）。
- **daemon 本机控制端口**：`controlPort` 配置（headless 也有可直连 addr）——处理官方
  client-request 信封（与 callRemote 直连路径一致），管理端经 launch 配置的 daemon addr 直连控制。
- **无 broker 停非守护实例**：跨进程 sendControl 无 relay 时只本地回环（会递归）→ daemon 本机
  端口定位 kill（`lsof -ti tcp:<port>` + SIGTERM），同机守护能力。
- **callRemote**：直连失败降级 broker 兜底（原直连失败直接 reject）；启动即 recv + 周期 5s
  （原 30s > 回执超时 15s，跨实例 RPC 回执必然超时）。
- **实测（无 broker）**：web2(管理端)/web3(instance)/daemon(headless host1) 不带 relay env——
  web2 发现 web3/web4/host1（launch 注册 + 探测续期）；web2→web3 restart 全链路
  （web2 直连 daemon 3089 → 本机端口 kill → spawn 拉起），连续 3 次重启稳定，全程无 broker。
