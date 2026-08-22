# Agent Note: dsh-channel 联通 + console 远程控制验证方案（feat/channel-link）

Status: proposed

## 目标

验证 dsh-channel 跨实例联通 + dsh-console 远程控制完整链路：**web2（console 端）对 web3（agent 端）执行 restart → web3 收到指令后重启自己**。

## 完整链路（从注册开始）

```
① broker（dsh-agent-relay，独立进程 127.0.0.1:19121，共享密钥 test-secret-relay-2026）
     │
② 实例注册（每实例 dsh-channel relay 配置，env: DSH_RELAY_*）
     web2 启动 → channel 保活注册 POST /register（HMAC-SHA256 签名）
     web3 启动 → 同上
     → broker peers：web2/web3 均 online（常驻在线，周期保活）
     → 各自周期轮询 GET /peers → 远端实例进 channel.list()（status 用 broker 判定）
     │
③ 角色（dsh-console 按配置区分）
     web2：dsh-console role=console（默认）——档案 / inbox / controlInstance
     web3：dsh-console role=agent —— channel.onControl 执行器
     │
④ 控制指令（web2 → web3）
     web2 调 console.controlInstance('web3', {type:'restart'})
       → channel.sendControl('web3', restart)（'web3' ≠ 本机 agent 名 web2 → 经 broker）
       → POST /messages（kind=request、指令本体 body.command——broker 只接受 type message|ack）
       → broker 投递到 web3 收件箱
       → web3 的 channel relay 轮询 recv（增量游标）→ onControl 触发
       → web3 的 dsh-console agent 执行器（resolveControlAction：restart→exit）
       → process.exit(0)——进程退出，重启由外部守护拉起（测试环境：脚本/手动）
```

## 验证步骤（测试环境）

1. broker 运行中（127.0.0.1:19121）
2. web2/web3 实例带 relay env 启动（channel 保活注册）
3. 检查：broker `peers` 显示 web2/web3 online
4. web3 的 cordis.patch.yml 加 `dsh-console` config `role: agent`
5. 触发 web2 的 `console.controlInstance('web3', 'restart')`（临时触发点，见下）
6. 观察：web3 日志 `[dsh-console/agent] 收到 web2 的 restart 指令，执行重启` → web3 进程退出
7. 外部拉起 web3 → 重新注册 → peers online（恢复）

## 触发点（web2 调 controlInstance）

console 纯服务端、无 UI/CLI——验证需要触发点：
- **临时**：web2 侧临时插件调用 `ctx.console.controlInstance('web3','restart')`（验证链路）
- **正式化（后续）**：console 提供命令/工具入口（或 console-ui 控制按钮）

## 验收

- [ ] broker peers：web2/web3 online
- [ ] web2 调 controlInstance 后：web3 收到指令（日志）、进程退出（重启执行）
- [ ] web3 重启恢复后重新注册、peers online

## 现状（feat/channel-link 已实现，测试全绿）

- dsh-channel relay：保活注册 / peers 轮询 / 控制指令跨实例（18 测试）
- dsh-console agent 端执行器：role=agent / resolveControlAction（11 测试）
- 真实链路已用 demo 插件验证（web3 请求 → web2 批准 → web3 重启）
