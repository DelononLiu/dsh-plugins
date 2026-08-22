# Agent Note: console-ui 实例控制面板（UI 可操作的远程控制）——方案

Status: proposed

## 需求（用户明确）

**验收/使用要在 UI 上可操作**：用户点击按钮对实例执行控制（重启/停止等），而不是命令行。目标场景：在 3082（web2）的 web UI 上看到实例列表（web2/web3），点击「重启」→ web3 重启。

## 现状

- **链路已通**（feat/channel-link 已验证）：web2 console.controlInstance('web3','restart') → channel.sendControl 经 broker → web3 agent 执行器 → 重启
- **dsh-console**：纯服务端（档案/inbox/controlInstance）——无 UI
- **dsh-console-ui**：仅「Console」徽标（header.actions 按钮 + 占位浮层）
- **缺口**：client（浏览器 UI）拿不到 host 的实例数据、调不了 host 的控制方法——**需要 client→host 通道**（远程化）

## 方案

### UI 形态

「Console」徽标浮层扩展为**实例控制面板**：
```
┌ Console ──────────────────────┐
│ 实例控制（主机分组）             │
│  主机 host-1（本机）            │
│    ● web2（当前） 3082  [重启]  │
│    ● web3          3083  [重启] │
│ 主机 host-2（远程）             │
│    ○ web4（离线）      [重启]   │
└───────────────────────────────┘
```
点击「重启」→ 确认 → 调 host `console.controlInstance(instanceId, 'restart')` → 实例重启（UI 提示"已下发指令"）。

### client→host 通道（关键决策）

| 方案 | 内容 | 工程量 |
|---|---|---|
| **A. Typert 远程化** | host `@Remote` 暴露 console.listInstanceRecords / controlInstance → client `ctx.remote` 消费 | 大（官方构建体系移植） |
| **B. 简化 HTTP 适配** | host 挂 `/api/console/instances`（GET）+ `/api/console/control`（POST，重启）→ client fetch | 小但 hack（绕过官方远程机制） |

**建议**：先做 **B（简化 HTTP）** 让 UI 可操作（验收/使用），**Typert（A）作为发行包后续大工程**（统一远程化面）。B 的端点带鉴权（与 webServer 同 loopback 或会话校验）。

### 数据与操作链路

```
UI（client）：fetch GET /api/console/instances → 实例列表（channel.list 含远端 + 档案）
  → 渲染实例面板
UI 点击「重启」：fetch POST /api/console/control {instanceId, command:'restart'}
  → host：console.controlInstance(instanceId,'restart')
  → channel.sendControl 经 broker → 目标 agent 执行器 → 重启
```

## 待确认

1. 通道方案：**B（简化 HTTP，先可用）** vs A（Typert，大）——建议 B 先行
2. UI 位置：Console 徽标浮层（现有入口）——确认
3. 操作范围：v1 只「重启」（stop/upgrade 按钮后续）

## 验收（UI 可操作）

1. 打开 3082 → 会话 header 点「Console」徽标 → 浮层显示实例列表（web2/web3）
2. 点 web3 的「重启」→ 确认 → 提示"指令已下发"
3. 观察：web3（3083）重启（退出后拉起）
4. 恢复：web3 重新注册、UI 实例列表 online
