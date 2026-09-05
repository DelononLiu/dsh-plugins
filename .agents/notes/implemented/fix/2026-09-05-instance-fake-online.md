# Agent Note: 实例假在线修复（重启即绿 → 探测结果驱动状态）

Status: implemented

## Problem

web2（管理端 console）重启后，launch 配置里的 web3/web4 全部显示绿色 online，
即使它们进程根本没起来。用户反馈："重启 web2，起来的时候 web3 和 web4 都是
绿色的，这逻辑"。

根因：状态模型是"声明 + 被动超时"而非"探测结果驱动"——
1. dsh-console 构造时 `ctx.channel.declare({status:'online'})` 无条件把 launch
   全表标 online（lastSeen=now）；
2. probeLaunch 周期 15s（setInterval 首拍也要等 15s），探测失败只"不续期"；
3. channel sweep 30s 才把 lastSeen 超时的标 offline。

→ 从 declare 到 sweep 存在 15~30s 的"假在线"窗口，UI 全绿但实例可能已停。

## Decision

探测结果驱动状态，消除假绿窗口：

- **dsh-channel**：新增 `setStatus(instanceId, 'online'|'offline')`（进程内管理面，
  不 @Remote——防远端越权改状态；未声明实例静默）。online 时刷新 lastSeen。
- **dsh-console**：
  - declare 后**立即首轮 probeLaunch()**（不等 setInterval 首拍 15s）；
  - probeLaunch 探测失败（不可达/超时）→ `channel.setStatus(id,'offline')`
    **立即标离线**（不再"不续期等 sweep"）；
  - 探测成功 → heartbeat 续期 online（不变）。

declare 保持初始 online（身份 + 本机已跑实例立即直连的前提，channel 测试
callRemote 依赖 status online）——靠首轮立即 probe 把不可达的秒级转 offline，
而非把 declare 改 offline（那会破坏 callRemote 直连前提）。

## Alternatives

- declare 初始改 offline，probe 成功再转 online：破坏 channel 测试 + callRemote
  直连条件（status online 才走直连），本机已跑实例会有一拍不可直连 → 否决。

## Consequences

- 假绿窗口：30s（sweep）→ 秒级（首轮 probe 完成，5s 超时兜底）。
- 状态语义：管理端视角的 online = 最近探测可达（探测驱动），不再 = 声明即真。
- 测试：console 65（原 64 + 1「构造后 launch 不可达实例即刻 offline」）；改造
  原「不可达不续期仍 online」断言为新行为「不可达立即 offline」+「恢复可达
  回 online」。channel 25 不变。
- 行为变更（probe 立即跑）影响：daemon/console 带 port 的既有测试会真 fetch
  127.0.0.1:port（不可达被 .catch 静默，无断言依赖）——测试仍全绿。
